/*
 * Copyright 2012 Adobe Systems Incorporated. All Rights Reserved.
 */

/*jslint vars: true, plusplus: true, devel: true, browser: true, nomen: true, indent: 4, maxerr: 50 */
/*global define: false */

define(function (require, exports, module) {
    'use strict';
    
    /**
     * @private
     * moves the current context backwards by one token
     * @param {editor:{CodeMirror}, pos:{ch:{string}, line:{number}}, token:{object}} ctx
     * @return {boolean} whether the context changed
     */
    function _movePrevToken(ctx) {
        if (ctx.pos.ch <= 0 || ctx.token.start <= 0) {
            //move up a line
            if (ctx.pos.line <= 0) {
                return false; //at the top already
            }
            ctx.pos.line--;
            ctx.pos.ch = ctx.editor.getLine(ctx.pos.line).length;
        } else {
            ctx.pos.ch = ctx.token.start;
        }
        ctx.token = ctx.editor.getTokenAt(ctx.pos);
        return true;
    }
    
    /**
     * @private
     * moves the current context forward by one token
     * @param {editor:{CodeMirror}, pos:{ch:{string}, line:{number}}, token:{object}} ctx
     * @return {boolean} whether the context changed
     */
    function _moveNextToken(ctx) {
        var eol = ctx.editor.getLine(ctx.pos.line).length;
        if (ctx.pos.ch >= eol || ctx.token.end >= eol) {
            //move down a line
            if (ctx.pos.line === ctx.editor.lineCount()) {
                return false; //at the bottom
            }
            ctx.pos.line++;
            ctx.pos.ch = 0;
        } else {
            ctx.pos.ch = ctx.token.end + 1;
        }
        ctx.token = ctx.editor.getTokenAt(ctx.pos);
        return true;
    }

   /**
     * @private
     * creates a context object
     * @param {CodeMirror} editor
     * @param {{ch:{string}, line:{number}} pos
     * @return {editor:{CodeMirror}, pos:{ch:{string}, line:{number}}, token:{object}}
     */
    function _getInitialContext(editor, pos) {
        return {
            "editor": editor,
            "pos": pos,
            "token": editor.getTokenAt(pos)
        };
    }
 
   /**
     * @private
     * Sometimes as attr values are getting typed, if the quotes aren't balanced yet
     * some extra 'non attribute value' text gets included in the token. This attempts
     * to assure the attribute value we grab is always good
     * @param {editor:{CodeMirror}, pos:{ch:{string}, line:{number}}, token:{object}} context
     * @return {string}
     */
    function _extractAttrVal(ctx) {
        var attrValue = ctx.token.string;
        var startChar = attrValue.charAt(0);
        var endChar = attrValue.charAt(attrValue.length - 1);
        
        //If this is a fully quoted value, return the whole
        //thing regardless of position
        if (attrValue.length > 1 &&
                (startChar === "'" || startChar === '"') &&
                endChar === startChar) {
            //strip the quotes and return;
            return attrValue.substring(1, attrValue.length - 1);
        }
        
        //The att value it getting edit in progress. There is possible extra
        //stuff in this token state since the quote isn't closed, so we assume
        //the stuff from the quote to the current pos is definitely in the attribute 
        //value.
        var posInTokenStr = ctx.pos.ch - ctx.token.start;
        if (posInTokenStr < 0) {
            console.log("CodeHintUtils: _extractAttrVal - Invalid context: the pos what not in the current token!");
        } else {
            attrValue = attrValue.substring(0, posInTokenStr);
        }
        
        //If the attrValue start with a quote, trim that now
        startChar = attrValue.charAt(0);
        if (startChar === "'" || startChar === '"') {
            attrValue = attrValue.substring(1);
        }
        
        return attrValue;
    }
    
      /**
     * @private
     * Gets the tagname from where ever you are in the currect state
     * @param {editor:{CodeMirror}, pos:{ch:{string}, line:{number}}, token:{object}} context
     * @return {string}
     */
    function _extractTagName(ctx) {
        if (ctx.token.state.tagName) {
            return ctx.token.state.tagName; //XML mode
        } else {
            return ctx.token.state.htmlState.tagName; //HTML mode
        }
    }
    
    /**
     * Creates a tagInfo object and assures all the values are entered or are empty strings
     * @param {string} tagName The name of the tag
     * @param {string} attrName The name of the attribute
     * @param {string} attrValue The value of the attribute
     * @return {{tagName:string, attr{name:string, value:string}} A tagInfo object with some context
     *              about the current tag hint. 
     */
    function createTagInfo(tagName, attrName, attrValue) {
        return { tagName: tagName || "",
                 attr:
                    { name: attrName || "",
                     value: attrValue || ""} };
    }
    
    
    function _getTagInfoStartingFromAttrValue(ctx) {
        // Assume we in the attr value
        // and validate that by going backwards
        var attrVal = _extractAttrVal(ctx);
        
        //Move to the prev token, and check if it's "="
        if (!_movePrevToken(ctx) || ctx.token.string !== "=") {
            return createTagInfo();
        }
        
        //Move to the prev token, and check if it's an attribute
        if (!_movePrevToken(ctx) || ctx.token.className !== "attribute") {
            return createTagInfo();
        }
        
        var attrName = ctx.token.string;
        var tagName = _extractTagName(ctx);
 
        //We're good. 
        return createTagInfo(tagName, attrName, attrVal);
    }
    
    function _getTagInfoStartingFromAttrName(ctx) {
        //Verify We're in the attribute name, move forward and try to extract the rest of
        //the info. If the user it typing the attr the rest might not be here
        if (ctx.token.className !== "attribute") {
            return createTagInfo();
        }
        
        var tagName = _extractTagName(ctx);
        var attrName = ctx.token.string;
        
        if (!_moveNextToken(ctx) || ctx.token.string !== "=") {
            return createTagInfo(tagName, attrName);
        }
        
        if (!_moveNextToken(ctx)) {
            return createTagInfo(tagName, attrName);
        }
        //this should be the attrvalue
        var attrVal = _extractAttrVal(ctx);
        
        return createTagInfo(tagName, attrName, attrVal);
    }
    
    /**
     * Figure out if we're in a tag, and if we are
     * An example token stream for this tag is <span id="open-files-disclosure-arrow"></span> : 
     *      className:tag       string:"<span"
     *      className:          string:" "
     *      className:attribute string:"id"
     *      className:          string:"="
     *      className:string    string:""open-files-disclosure-arrow""
     *      className:tag       string:"></span>"
     * @param {CodeMirror} editor An instance of a CodeMirror editor
     * @param {{ch: number, line: number}} pos  A CM pos (likely from editor.getCursor())
     * @return {{tagName:string, attr{name:string, value:string}} A tagInfo object with some context
     *              about the current tag hint. 
     */
    function getTagInfo(editor, pos) {
        var ctx = _getInitialContext(editor, pos);
        
        //check and see where we are in the tag
        //first check, if we're in an all whitespace token and move back
        //and see what's before us
        if (ctx.token.string.length > 0 && ctx.token.string.trim().length === 0) {
            if (!_movePrevToken(ctx)) {
                return createTagInfo();
            }
            
            if (ctx.token.className !== "tag") {
                //if wasn't the tag name, assume it was an attr value
                var tagInfo = _getTagInfoStartingFromAttrValue(ctx);
                //We don't want to give context for the previous attr
                return createTagInfo(tagInfo.tagName);
            }
        }
        
        if (ctx.token.className === "tag") {
            //check to see if this is the closing of a tag (either the start or end)
            if (ctx.token.string === ">") {
                return createTagInfo();
            }
            //we're actually in the tag, just return that as we have no relevant 
            //info about what attr is selected
            return createTagInfo(_extractTagName(ctx));
        }
        
        if (ctx.token.string === "=") {
            //we could be between the attr and the value
            //step back and check
            if (!_movePrevToken(ctx) || ctx.token.className !== "attribute") {
                return createTagInfo();
            }
        }
        
        if (ctx.token.className === "attribute") {
            return _getTagInfoStartingFromAttrName(ctx);
        }
        
        // if we're not at a tag, "=", or attribute name, assume we're in the value
        return _getTagInfoStartingFromAttrValue(ctx);
    }
    
    // Define public API
    exports.getTagInfo = getTagInfo;
    //The createTagInfo is really only for the unit tests so they can make the same structure to 
    //compare results with
    exports.createTagInfo = createTagInfo;
});

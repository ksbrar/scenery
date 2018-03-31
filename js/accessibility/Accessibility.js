// Copyright 2017, University of Colorado Boulder

/**
 * A trait that is meant to be composed with Node, adding accessibility by defining content for the Parallel DOM.
 *
 * The parallel DOM is an HTML structure that provides semantics for assistive technologies. For web content to be
 * accessible, assistive technologies require HTML markup, which is something that pure graphical content does not
 * include. This trait adds the accessible HTML content for any Node in the scene graph.
 *
 * Any Node can have accessible content, but they have to opt into it. The structure of the accessible content will
 * match the structure of the scene graph.
 *
 * Say we have the following scene graph:
 *
 *   A
 *  / \
 * B   C
 *    / \
 *   D   E
 *        \
 *         F
 *
 * And say that nodes A, B, C, D, and F specify accessible content for the DOM.  Scenery will render the accessible
 * content like so:
 *
 * <div id="node-A">
 *   <div id="node-B"></div>
 *   <div id="node-C">
 *     <div id="node-D"></div>
 *     <div id="node-F"></div>
 *   </div>
 * </div>
 *
 * In this example, each element is represented by a div, but any HTML element could be used. Note that in this example,
 * node E did not specify accessible content, so node F was added as a child under node C.  If node E had specified
 * accessible content, content for node F would have been added as a child under the content for node E.
 *
 * --------------------------------------------------------------------------------------------------------------------
 * #BASIC EXAMPLE
 *
 * In a basic example let's say that we want to make a Node an unordered list. To do this, add the `tagName` option to
 * the Node, and assign it to the string "ul". Here is what the code could look like:
 *
 * var myUnorderedList = new Node( { tagName: 'ul' } );
 *
 * To get the desired list html, we can assign the `li` `tagName` to children Nodes, like:
 *
 * var listItem1 = new Node( { tagName: 'li' } );
 * myUnorderedList.addChild( listItem1 );
 *
 * Now we have a single list element in the unordered list. To assign content to this <li>, use the `innerContent`
 * option (all of these Node options have getters and setters, just like any other Node option):
 *
 * listItem1.innerContent = 'I am a list item number 1';
 *
 * The above operations will create the following pDOM structure (note that actual ids will be different):
 *
 * <ul id='myUnorderedList'>
 *   <li>I am a list item number 1</li>
 * </ul
 *
 * --------------------------------------------------------------------------------------------------------------------
 * #DOM SIBLINGS
 *
 * The api in this trait allows you to add additional structure to the accessible DOM content if necessary. Each node
 * can have multiple DOM Elements associated with it. A Node can have a label DOM Element, and a description DOM Element.
 * These are called siblings. The Node's direct DOM Element (the DOM element you create with the `tagName` option)
 * is called the "primary sibling." You can also have a container parent DOM Elmenet that surrounds all of these
 * siblings. With three siblings and a parent container, each Node can have up to 4 DOM Elements representing it in the
 * pDOM. Here is an example of how a Node may use these features:
 *
 * <div>
 *   <label for="myInput">This great label for input</label
 *   <input id="myInput"/>
 *   <p>This is a description for the input</p>
 * </div>
 *
 * Although you can create this structure with four nodes (`input` A, `label B, and `p` C children to `div` D),
 * this structure can be created with one single Node. It is often preferable to do this to limit the number of new
 * Nodes that have to be created just for accessibility purposes. To accomplish this we have the following Node code.
 *
 * new Node( {
 *  tagName: 'input'
 *  labelTagName: 'label',
 *  labelContent: 'This great label for input'
 *  descriptionTagName: 'p',
 *  descriptionContent: 'This is a description for the input',
 *  containerTagName: 'div'
 * });
 *
 * A few notes:
 * 1. Notice the names of the content setters for siblings parallel the `innerContent` option for setting the primary
 *    sibling.
 * 2. To make this example actually work, you would need the `inputType` option to set the "type" attribute on the `input`.
 * 3. When you specify the  <label> tag for the label sibling, the "for" attribute is automatically added to the sibling.
 * 4. Finally, the example above doesn't utilize the default tags that we have in place for the parent and siblings.
 *      default labelTagName: 'label'
 *      default descriptionTagName: 'p'
 *      default containerTagName: 'div'
 *    so the following will yield the same pDOM structure:
 *
 *    new Node( {
 *     tagName: 'input'
 *     labelContent: 'This great label for input'
 *     descriptionContent: 'This is a description for the input',
 *    });
 *
 * The Accessibility trait is smart enough to know when there needs to be a container parent to wrap multiple siblings, we
 * don't need that here either.
 *
 * --------------------------------------------------------------------------------------------------------------------
 *
 * For additional accessibility options, please see the options listed in ACCESSIBILITY_OPTION_KEYS. For more
 * documentation on Scenery, Nodes, and the scene graph, please see http://phetsims.github.io/scenery/
 *
 * @author Jesse Greenberg (PhET Interactive Simulations)
 * @author Sam Reid (PhET Interactive Simulations)
 * @author Michael Kauzmann (PhET Interactive Simulations)
 */
define( function( require ) {
  'use strict';

  // modules
  var AccessibilityUtil = require( 'SCENERY/accessibility/AccessibilityUtil' );
  var AccessiblePeer = require( 'SCENERY/accessibility/AccessiblePeer' );
  var Emitter = require( 'AXON/Emitter' );
  var extend = require( 'PHET_CORE/extend' );
  var scenery = require( 'SCENERY/scenery' );

  // specific HTML tag names
  var INPUT_TAG = 'INPUT';
  var LABEL_TAG = 'LABEL';
  var BUTTON_TAG = 'BUTTON';
  var TEXTAREA_TAG = 'TEXTAREA';
  var SELECT_TAG = 'SELECT';
  var OPTGROUP_TAG = 'OPTGROUP';
  var DATALIST_TAG = 'DATALIST';
  var OUTPUT_TAG = 'OUTPUT';
  var DIV_TAG = 'DIV';
  var A_TAG = 'A';
  var P_TAG = 'P';

  // default tag names for siblings
  var DEFAULT_CONTAINER_TAG_NAME = DIV_TAG;
  var DEFAULT_DESCRIPTION_TAG_NAME = P_TAG;
  var DEFAULT_LABEL_TAG_NAME = LABEL_TAG;

  // these elements are typically associated with forms, and support certain attributes
  var FORM_ELEMENTS = [ INPUT_TAG, BUTTON_TAG, TEXTAREA_TAG, SELECT_TAG, OPTGROUP_TAG, DATALIST_TAG, OUTPUT_TAG, A_TAG ];

  // these elements do not have a closing tag, so they won't support features like innerHTML
  // var ELEMENTS_WITHOUT_CLOSING_TAG = [ INPUT_TAG ];

  // these elements require a minimum width to be visible in Safari
  var ELEMENTS_REQUIRE_WIDTH = [ INPUT_TAG, A_TAG ];

  // these events change the input value on the dom element
  var INPUT_CHANGE_EVENTS = [ 'input', 'change' ];

  // valid types of DOM events that can be added to a node
  var DOM_EVENTS = [ 'input', 'change', 'click', 'keydown', 'keyup', 'focus', 'blur' ];

  var ACCESSIBILITY_OPTION_KEYS = [
    'tagName', // Sets the tag name for the primary sibling DOM element in the parallel DOM
    'inputType', // Sets the input type for the primary sibling DOM element, only relevant if tagName is 'input'
    'inputValue', // Sets the input value for the primary sibling DOM element, only relevant if tagName is 'input'
    'accessibleChecked', // Sets the 'checked' state for inputs of type radio and checkbox, see setAccessibleChecked()
    'containerTagName', // Sets the tag name for an element that contains this node's DOM element and its peers
    'labelTagName', // Sets the tag name for the DOM element labelling this node, usually a paragraph
    'descriptionTagName', // Sets the tag name for the DOM element describing this node, usually a paragraph
    'focusHighlight', // Sets the focus highlight for the node, see setFocusHighlight()
    'focusHighlightLayerable', // Flag to determine if the focus highlight node can be layered in the scene graph, see setFocusHighlightLayerable()
    'groupFocusHighlight', // Sets the outer focus highlight for this node when a descendant has focus, see setGroupFocusHighlight()
    'labelContent', // Set the label content for the node, see setLabelContent()
    'innerContent', // set the inner text or HTML for a node's primary sibling element, see setInnerContent()
    'accessibleDescription', // Set the description content for the node, see setAccessibleDescription()
    'accessibleDescriptionAsHTML', // Set the description content for the node as innerHTML, see setAccessibleDescriptionContentAsHTML()
    'accessibleVisible', // Sets whether or not the node's DOM element is visible in the parallel DOM
    'accessibleContentDisplayed', // sets whether or not the accessible content of the node (and its subtree) is displayed, see setAccessibleContentDisplayed()
    'focusable', // Sets whether or not the node can receive keyboard focus
    'ariaLabel', // Sets the value of the 'aria-label' attribute, see setAriaLabel()
    'ariaRole', // Sets the ARIA role for the DOM element, see setAriaRole() for documentation
    'containerAriaRole', // Sets the ARIA role for the container parent DOM element, see setContainerAriaRole()
    'prependLabels', // Sets whether we want to prepend labels above the node's HTML element, see setPrependLabels()
    'ariaDescriptionContent', // Sets the content that will describe another node through aria-describedby, see setAriaDescriptionContent()
    'ariaLabelContent', // Sets the content that will label another node through aria-labelledby, see setAriaLabelledByContent()
    'ariaDescribedContent', // Sets the content that will be described by another node through aria-describedby, see setAriaDescribedContent()
    'ariaLabelledContent', // sets the content that will be labelled by another node through aria-labelledby, see setAriaLabelledContent()
    'accessibleOrder', // Modifies the keyboard accessibility order, see setAccessibleOrder() for more documentation
    'accessibleContent' // Sets up accessibility handling, see setAccessibleContent() for more documentation
  ];

  var Accessibility = {

    /**
     * Given the constructor for Node, add accessibility functions into the prototype.
     *
     * @param {function} type - the constructor for Node
     */
    compose: function( type ) {
      // Can't avoid circular dependency, so no assertion here. Ensure that 'type' is the constructor for Node.
      var proto = type.prototype;

      /**
       * These properties and methods are put directly on the prototype of Node.
       */
      extend( proto, {

        /**
         * {Array.<string>} - String keys for all of the allowed options that will be set by node.mutate( options ), in
         * the order they will be evaluated.  Beware that order matters for accessibility options, changing the order
         * of ACCESSIBILITY_OPTION_KEYS could break the trait.
         * @protected
         *
         * NOTE: See Node's _mutatorKeys documentation for more information on how this operates, and potential special
         *       cases that may apply.
         */
        _mutatorKeys: ACCESSIBILITY_OPTION_KEYS.concat( proto._mutatorKeys ),

        /**
         * This should be called in the constructor to initialize the accessibility-specific parts of Node.
         * @protected
         */
        initializeAccessibility: function() {

          //REVIEW: Including the 'null' case in type documentation here would help.

          // @private {string} - the HTML tag name of the element representing this node in the DOM
          this._tagName = null;

          // @private {string} - the HTML tag name for a container parent element for this node in the DOM. This
          // container parent will contain the node's DOM element, as well as peer elements for any label or description
          // content. See setContainerTagName() for more documentation. If this option is needed (like to
          // contain multiple siblings with the primary sibling), it will default to the value of DEFAULT_CONTAINER_TAG_NAME.
          this._containerTagName = null;

          // @private {string} - the HTML tag name for the label element that will contain the label content for
          // this dom element. There are ways in which you can have a label without specifying a label tag name,
          // see setLabelContent() for the list of ways.
          this._labelTagName = null;

          // @private {string} - the HTML tag name for the description element that will contain descsription content
          // for this dom element. If a description is set before a tag name is defined, a paragraph element
          // will be created for the description.
          this._descriptionTagName = null;

          // @private {string} - the type for an element with tag name of INPUT.  This should only be used
          // if the element has a tag name INPUT.
          this._inputType = null;

          // @private {string} - the value of the input, only relevant if the tag name is of type "INPUT".
          this._inputValue = null;

          // @private {boolean} - whether or not the accessible input is considered 'checked', only useful for inputs of
          // type 'radio' and 'checkbox'
          this._accessibleChecked = false;

          // @private {boolean} - determines whether or not labels should be prepended above the node's DOM element.
          // All labels will be placed inside containerParent, which will be automatically created if option
          // not provided. The labels are sorted relative to the node's DOM element under the container parent.
          // TODO: document this, https://github.com/phetsims/scenery/issues/748
          this._prependLabels = null;

          // @private {array.<Object> - array of attributes that are on the node's DOM element.  Objects will have the
          // form { attribute:{string}, value:{string|number} }
          this._accessibleAttributes = [];

          // @private {string} - the label content for this node's DOM element.  There are multiple ways that a label
          // can be associated with a node's dom element, see setLabelContent() for more documentation
          this._labelContent = null;

          // @private {null|string} - the inner label content for this node's primary sibling. Set as inner HTML
          // or text content of the actual DOM element. If this is used, the node should not have children.
          this._innerContent = null;

          // @private {string} - the description content for this node's DOM element.
          this._accessibleDescription = null;

          // @private {string} - whether or not the accessible description is set as innerHTML. Internal flag
          // that is set when updating description content.
          this._descriptionIsHTML = false;

          // @private {string} - if provided, "aria-label" will be added as an inline attribute on the node's DOM
          // element and set to this value. This will determine how the Accessible Name is provided for the DOM element.
          this._ariaLabel = null;

          // @private {string} - the ARIA role for this node's DOM element, added as an HTML attribute.  For a complete
          // list of ARIA roles, see https://www.w3.org/TR/wai-aria/roles.  Beware that many roles are not supported
          // by browsers or assistive technologies, so use vanilla HTML for accessibility semantics where possible.
          this._ariaRole = null;

          // @private {string} - the ARIA role for the container parent element, added as an HTML attribute. For a
          // complete list of ARIA roles, see https://www.w3.org/TR/wai-aria/roles. Beware that many roles are not
          // supported by browsers or assistive technologies, so use vanilla HTML for accessibility semantics where
          // possible.
          this._containerAriaRole = null;

          // @private {Node|null} - A node with accessible content that labels this node through the aria-labelledby
          // ARIA attribute.  The other node can be anywhere in the scene graph.  The behavior for aria-labelledby
          // is such that when this node receives focus, the accessible content under the other node will be read
          // (before any description content). Use with ariaLabelledContent to specify what portion of this node's
          // acccessible content is labelled (DOM element, label element, description element or container parent
          // element).
          this._ariaLabelledByNode = null;

          // @private {string} - A string referenceing which portion of this node's accessible content will receive
          // the aria-labelledby attribute.  Can be the DOM element, the label element, the description element,
          // or the container parent element. By default, points to this node's DOM element.
          this._ariaLabelledContent = AccessiblePeer.NODE;

          // @private {Node|null} - The Node this node labels through the aria-labelledby association. See
          // _ariaLabelledByNode for more information.
          this._ariaLabelsNode = null;

          // @private {string} - The content on this node that is used to label another node through the
          // aria-labelledby ARIA attribute.  Can be the node's label, description, container parent, or DOM
          // element.  See setAriaLabelContent()
          this._ariaLabelContent = AccessiblePeer.NODE; // element associated with the other node's content

          // @private {Node|null} - A node with accessible content that describes this node through the aria-describedby
          // ARIA attribute. The other node can be anywhere in the scene graph.  The behavior for aria-describedby
          // is such that when this node receives focus, the accessible content under the other node will be read
          // (after any label content). Use with ariaDescribedContent to specify what portion of this node's
          // acccessible content is described (DOM element, label element, description element or container parent
          // element).
          this._ariaDescribedByNode = null;

          // @private {string} - A string referenceing which portion of this node's accessible content will receive
          // the aria-describedby attribute.  Can be the DOM element, the label element, the description element,
          // or the container parent element. By default, points to this node's DOM element.
          this._ariaDescribedContent = AccessiblePeer.NODE;

          // @private {Node|null} - The Node this node describes through the aria-describedby association. See
          // _ariaLabelledByNode for more information.
          this._ariaDescribesNode = null;

          // @private {string} - The description content on this node that is used to describe another node through the
          // aria-describedby ARIA attribute. Can be the node's label, description, container parent, or DOM
          // element.  See ariaDescribessNodoe for more information
          this._ariaDescriptionContent = AccessiblePeer.NODE;

          // @private {boolean} - whether or not this node's DOM element can receive focus from tab navigation.
          // Sets the tabIndex attribute on the node's DOM element.  Setting to false will not remove the node's DOM
          // from the document, but will ensure that it cannot receive focus by pressing 'tab'.  Several HTMLElements
          // (such as HTML form elements) can be focusable by default, without setting this property.
          this._focusable = null;

          // @private {Shape|Node|string.<'invisible'>} - the focus highlight that will surround this node when it
          // is focused.  By default, the focus highlight will be a pink rectangle that surrounds the Node's local
          // bounds.
          this._focusHighlight = null;

          // @private {boolean} - A flag that allows prevents focus highlight from being displayed in the FocusOverlay.
          // If true, the focus highlight for this node will be layerable in the scene graph.  Client is responsible
          // for placement of the focus highlight in the scene graph.
          this._focusHighlightLayerable = false;

          // @private {boolean|Node} - Adds a group focus highlight that surrounds this node when a descendant has
          // focus. Typically useful to indicate focus if focus enters a group of elements. If 'true', group
          // highlight will go around local bounds of this node. Otherwise the custom node will be used as the highlight
          this._groupFocusHighlight = false;

          // @private {boolean} - Whether or not the accessible content will be visible from the browser and assistive
          // technologies.  When accessibleVisible is false, the node's DOM element will not be focusable, and it cannot
          // be found by the assistive technology virtual cursor. For more information on how assistive technologies
          // read with the virtual cursor see
          // http://www.ssbbartgroup.com/blog/how-windows-screen-readers-work-on-the-web/
          this._accessibleVisible = true;

          // @private {boolean} - Whether or not the accessible content will be visible from the browser and assistive
          // technologies.  When accessible content is not displayed, the node will not be focusable, and it cannot
          // be found by assistive technology with the virtual cursor.  Content should almost always be set invisible with
          // setAccessibleVisible(), see that function and setAccessibleContentDisplayed() for more information.
          this._accessibleContentDisplayed = true;

          // @private {Array.<Function>} - For accessibility input handling {keyboard/click/HTML form}
          this._accessibleInputListeners = [];

          // @private {boolean} - if true, all accessible input will be halted on this Node.
          this._accessibleInputEnabled = true;

          // @public (scenery-internal) - emitters for when state properties change
          this.accessibleVisibilityChangedEmitter = new Emitter();

          // @public - emits when focus changes. This will trigger with the 'focus' event and the 'blur' event.
          // Listener receives 1 parameter, {boolean} - isFocused. see Display.focus
          this.focusChangedEmitter = new Emitter();

          // @private {Array.<Node>} - (a11y) If provided, it will override the focus order between children (and optionally
          // descendants). If not provided, the focus order will default to the rendering order (first children first, last
          // children last) determined by the children array.
          this._accessibleOrder = [];


          // @private {null|Object} - If non-null, this node will be represented in the parallel DOM by the accessible content.
          // The accessibleContent object will be of the form:
          // {
          //   createPeer: function( {AccessibleInstance} ): {AccessiblePeer},
          //   [focusHighlight]: {Bounds2|Shape|Node|string.<'invisible'>}
          // }
          // The focus highlight can be a custom Shape, Node, contain the Node's local bounds, or be invisible.
          this._accessibleContent = null;

          // @protected {Array.<AccessibleInstance>} - Empty unless the node contains some accessible instance.
          this._accessibleInstances = [];

        },

        /**
         * Adds an accessible input listener. The listener's keys should be DOM event names, and the values should be
         * functions to be called when that event is fired on the dom element. No input listeners will be fired
         * if this.accessibleInputEnabled is false.
         * @public
         *
         * @param {Object} accessibleInput
         * @returns {Object} - the actually added listener, so it can be removed via removeAccessibleInputListener
         */
        addAccessibleInputListener: function( accessibleInput ) {
          var self = this;
          var addedAccessibleInput = {};

          var keys = Object.keys( accessibleInput );
          for ( var i = 0; i < keys.length; i++ ) {
            var ev = keys[ i ];
            if ( _.includes( DOM_EVENTS, ev ) ) {

              // wrap the listener with another function so that we can update state of this Node's
              // accessible content if necessary, and prevent firing when input not enabled
              addedAccessibleInput[ ev ] = function( event ) {
                if ( self._accessibleInputEnabled ) {

                  if ( _.includes( INPUT_CHANGE_EVENTS, event.type ) ) {
                    self._inputValue = event.target.value;
                  }

                  // call the original input listener
                  accessibleInput[ event.type ]( event );
                }
              };
            }
          }

          var listenerAlreadyAdded = ( _.indexOf( this._accessibleInputListeners, addedAccessibleInput ) > 0 );
          assert && assert( !listenerAlreadyAdded, 'accessibleInput listener already added' );

          // add the listener directly to any AccessiblePeers that are representing this node
          this._accessibleInputListeners.push( addedAccessibleInput );
          this.updateAccessiblePeers( function( accessiblePeer ) {
            self.addDOMEventListeners( addedAccessibleInput, accessiblePeer.primarySibling );
          } );

          return addedAccessibleInput;
        },

        /**
         * Removes an input listener that was previously added with addAccessibleInputListener.
         * @public
         *
         * @param {Object} accessibleInput
         * @returns {Node} - Returns 'this' reference, for chaining
         */
        removeAccessibleInputListener: function( accessibleInput ) {

          // ensure the listener is in our list, or will be added in invalidation
          var addedIndex = _.indexOf( this._accessibleInputListeners, accessibleInput );
          assert && assert( addedIndex > -1, 'accessibleInput listener was not added' );

          this._accessibleInputListeners.splice( addedIndex, 1 );

          // remove the event listeners from any peers
          var self = this;
          this.updateAccessiblePeers( function( accessiblePeer ) {
            self.removeDOMEventListeners( accessibleInput, accessiblePeer.primarySibling );
          } );

          return this;
        },

        /**
         * Returns a copy of all input listeners related to accessibility.
         * @public
         *
         * @returns {Array.<Object>}
         */
        getAccessibleInputListeners: function() {
          return this._accessibleInputListeners.slice( 0 ); // defensive copy
        },
        get accessibleInputListeners() { return this.getAccessibleInputListeners(); },

        /**
         * Prevents all accessible input listeners from being called on this Node.  Should only
         * be used internally by scenery for now.
         * @public (scenery-internal)
         *
         * REVIEW: Instead of just setting all children, we should just set one Node and then
         * traverse specific trails to see if input is enabled.
         */
        setAccessibleInputEnabled: function( accessibleInputEnabled ) {
          this._accessibleInputEnabled = accessibleInputEnabled;

          for ( var i = 0; i < this._children.length; i++ ) {
            this._children[ i ].accessibleInputEnabled = accessibleInputEnabled;
          }
        },
        set accessibleInputEnabled( accessibleInputEnabled ) { this.setAccessibleInputEnabled( accessibleInputEnabled ); },

        /**
         * Get whether or not we are preventing accessible input listeners from firing when this node receives
         * accessible input events.
         * @return {boolean}
         */
        getAccessibleInputEnabled: function() {
          return this._accessibleInputEnabled;
        },
        get accessibleInputEnabled() { return this.getAccessibleInputEnabled(); },

        /**
         * Set the tag name representing this element in the DOM. DOM element tag names are read-only, so this
         * function will create a new DOM element for the Node and reset the accessible content.
         * TODO: fix doc, https://github.com/phetsims/scenery/issues/748
         * REVIEW: Setting the tag name multiple times results in incorrect behavior with many functions, e.g.:
         *   var node = new scenery.Node();
         *   node.tagName = 'div';
         *   node.focusable = true;
         *   node.primarySibling.tabIndex // 0 (as expected)
         *   node.tagName = 'p';
         *   node.primarySibling.tabIndex // -1 (yikes!, even when node.focusable returns true)
         *
         * @param {string} tagName
         */
        setTagName: function( tagName ) {
          assert && assert( tagName === null || typeof tagName === 'string' );

          this._tagName = tagName;
          this.invalidateAccessibleContent();
        },
        set tagName( tagName ) { this.setTagName( tagName ); },

        /**
         * Get the tag name of the DOM element representing this node for accessibility.
         * @public
         *
         * REVIEW: Return type should include null, since new scenery.Node().tagName is null.
         *
         * @returns {string}
         */
        getTagName: function() {
          return this._tagName;
        },
        get tagName() { return this.getTagName(); },

        /**
         * Set the tag name for the accessible label for this Node.  DOM element tag names are read-only, so this will
         * require creating a new label element.
         *
         * REVIEW: Same problem with after-the-fact modification as tagName:
         *   var node = new scenery.Node()
         *   node.tagName = 'div';
         *   node.labelTagName = 'p'
         *   node.labelContent = 'Label';
         *   node.getLabelElement() // <p>Label</p>
         *   node.labelTagName = 'div';
         *   node.getLabelElement() // <div></div> -- NO label specified, even though accessibleLabel is still set
         * TODO: fix this doc, https://github.com/phetsims/scenery/issues/748
         * REVIEW: null used in unit tests, so this should be marked as accepting null
         *
         * @param {string|null} tagName
         */
        setLabelTagName: function( tagName ) {
          assert && assert( tagName === null || typeof tagName === 'string' );

          this._labelTagName = tagName;

          // to have a label sibling, you need a container
          if ( !this._containerTagName ) {
            this.setContainerTagName( DEFAULT_CONTAINER_TAG_NAME );
          }

          this.invalidateAccessibleContent();
        },
        set labelTagName( tagName ) { this.setLabelTagName( tagName ); },

        /**
         * Get the label element HTML tag name.
         * @public
         *
         * REVIEW: Return type should include null, since new scenery.Node().labelTagName is null.
         *
         * @returns {string}
         */
        getLabelTagName: function() {
          return this._labelTagName;
        },
        get labelTagName() { return this.getLabelTagName(); },

        /**
         * Set the tag name for the description. HTML element tag names are read-only, so this will require creating
         * a new HTML element, and inserting it into the DOM.
         * @public
         *
         * REVIEW: Has same issue with setting tagName and labelTagName (see those review comments)
         *
         * @param {string} tagName
         */
        setDescriptionTagName: function( tagName ) {
          assert && assert( tagName === null || typeof tagName === 'string' );

          this._descriptionTagName = tagName;

          // to have a description sibling, you need a container
          if ( !this._containerTagName ) {
            this.setContainerTagName( DEFAULT_CONTAINER_TAG_NAME );
          }

          this.invalidateAccessibleContent();
        },
        set descriptionTagName( tagName ) { this.setDescriptionTagName( tagName ); },

        /**
         * Get the HTML get name for the description element.
         * @public
         *
         * @returns {string|null}
         */
        getDescriptionTagName: function() {
          return this._descriptionTagName;
        },
        get descriptionTagName() { return this.getDescriptionTagName(); },

        /**
         * Sets the type for an input element.  Element must have the INPUT tag name. The input attribute is not
         * specified as readonly, so invalidating accessible content is not necessary.
         *
         * @param {string} inputType
         */
        setInputType: function( inputType ) {
          assert && assert( this._tagName.toUpperCase() === INPUT_TAG, 'tag name must be INPUT to support inputType' );

          this._inputType = inputType;
          this.updateAccessiblePeers( function( accessiblePeer ) {
            accessiblePeer.primarySibling.type = inputType;
          } );
        },
        set inputType( inputType ) { this.setInputType( inputType ); },

        /**
         * Get the input type. Input type is only relevant if this node's DOM element has tag name "INPUT".
         * @public
         *
         * @returns {string}
         */
        getInputType: function() {
          return this._inputType;
        },
        get inputType() { return this.getInputType(); },

        /**
         * Set whether or not we want to prepend labels above the node's HTML element.  If the node does not have
         * a container parent element, one will be created. If prepending labels, the label and description elements
         * will be located above the HTML element like:
         *
         * <div id='parent-container'>
         *   <p>Label</p>
         *   <p>Description</p>
         *   <div id="node-content"></div>
         * </div>
         *
         * By default, label and description elements are placed below the node's HTML element.
         *
         * @param {boolean} prependLabels
         */
        setPrependLabels: function( prependLabels ) {
          this._prependLabels = prependLabels;

          // TODO: can we do this without recomputing everything?
          this.invalidateAccessibleContent();
        },
        set prependLabels( prependLabels ) { this.setPrependLabels( prependLabels ); },

        /**
         * Get whether or not this node adds labels and descriptions above the representative DOM element.
         * @public
         *
         * @returns {boolean}
         */
        getPrependLabels: function() {
          return this._prependLabels;
        },
        get prependLabels() { return this.getPrependLabels(); },

        /**
         * Set the container parent tag name.  By specifying this container parent, an element will be created that
         * acts as a container for this node's DOM element and its label and description peers.  For instance, a button
         * element with a label and description will be contained like the following if the container parent tag name
         * is specified as 'section'.
         *
         * <section id='parent-container-trail-id'>
         *   <button>Press me!</button>
         *   <p>Button label</p>
         *   <p>Button description</p>
         * </section>
         *
         * @param {string} tagName
         */
        setContainerTagName: function( tagName ) {
          assert && assert( tagName === null || typeof tagName === 'string', 'invalid tagName argument: ' + tagName );

          this._containerTagName = tagName;
          this.invalidateAccessibleContent();
        },
        set containerTagName( tagName ) { this.setContainerTagName( tagName ); },

        /**
         * Get the tag name for the container parent element.
         *
         * @returns {string}
         */
        getcontainerTagName: function() {
          return this._containerTagName;
        },
        get containerTagName() { return this.getcontainerTagName(); },

        /**
         * Set the content of the label sibling for the this node.  The label sibling will default to a
         * <label> tag if no `labelTagName` is provided. If the label sibling is a `label` html element,
         * then the `for` attribute will automatically be added, pointing to the node's primary sibling DOM Element.
         *
         * This method supports adding content in two ways, with HTMLElement.textContent and HTMLElement.innerHTML.
         * The DOM setter is chosen based on if the label passes the `usesFormatting
         * @param {string|null} label
         */
        setLabelContent: function( label ) {
          this._labelContent = label;

          // If there
          var useHTML = AccessibilityUtil.usesFormattingTagsExclusive( label );

          var self = this;

          // if trying to set labelContent, make sure that there is a labelTagName default
          if ( !this._labelTagName ) {
            this.setLabelTagName( DEFAULT_LABEL_TAG_NAME );
          }

          this.updateAccessiblePeers( function( accessiblePeer ) {
            if ( accessiblePeer.labelSibling ) {
              setTextContent( accessiblePeer.labelSibling, self._labelContent, useHTML );

              // if the label element happens to be a 'label', associate with 'for' attribute
              if ( self._labelTagName.toUpperCase() === LABEL_TAG ) {
                accessiblePeer.labelSibling.setAttribute( 'for', accessiblePeer.primarySibling.id );
              }
            }
          } );

        },
        set labelContent( label ) { this.setLabelContent( label ); },

        /**
         * Get the label content for this node's DOM element.
         *
         * @returns {string}
         */
        getLabelContent: function() {
          return this._labelContent;
        },
        get labelContent() { return this.getLabelContent(); },

        /**
         * Set the inner content for the primary sibling of the AccessiblePeers of this node. Will be set as textContent
         * unless content is html which uses exclusively formatting tags. A node with inner content cannot
         * have accessible descendants because this content will override the the HTML of descendants of this node.
         *
         * @param {string|null} content
         * @public
         */
        setInnerContent: function( content ) {
          this._innerContent = content;

          // make sure HTML is exclusively text or formatting tags
          var useHTML = AccessibilityUtil.usesFormattingTagsExclusive( content );

          var self = this;
          this.updateAccessiblePeers( function( accessiblePeer ) {
            assert && assert( accessiblePeer.accessibleInstance.children.length === 0, 'descendants exist with accessible content, innerContent cannot be used' );
            setTextContent( accessiblePeer.primarySibling, self._innerContent, useHTML );
          } );
        },
        set innerContent( content ) { this.setInnerContent( content ); },

        /**
         * Get the inner content, the string that is the innerHTML or innerText for the node's primary sibling element.
         *
         * @return {string|null}
         * @public
         */
        getInnerContent: function() {
          return this._innerContent;
        },
        get innerContent() { return this.getInnerContent(); },

        /**
         * Set the description content for this node's DOM element. A description element must exist and that element
         * must support inner HTML.  If a description element does not exist yet, we assume that a default paragraph
         * should be used.
         *
         * @param {string} textContent
         */
        setAccessibleDescription: function( textContent ) {
          this._descriptionIsHTML = false;
          this.setDescriptionContent( textContent );
        },
        set accessibleDescription( textContent ) { this.setAccessibleDescription( textContent ); },

        /**
         * Get the accessible description content that is describing this Node.
         *
         * @returns {string}
         */
        getAccessibleDescription: function() {
          return this._accessibleDescription;
        },
        get accessibleDescription() { return this.getAccessibleDescription(); },

        /**
         * Should be used rarely and with caution, typically you should use setAccessibleDescription instead.
         * Sets the accessible descriptions as innerHTML instead of textContent. This allows you to include
         * formatting tags in the descriptions which are typically read with distinction by a screen reader.
         * But innerHTML is less performant because it triggers DOM restyling and insertions.
         *
         * If the content includes anything other than styling tags or has malformed HTML, we will fallback
         * to textContent.
         *
         * @param {string} textContent
         */
        setAccessibleDescriptionAsHTML: function( textContent ) {
          var formattingExclusive = AccessibilityUtil.usesFormattingTagsExclusive( textContent );

          this._descriptionIsHTML = formattingExclusive;
          this.setDescriptionContent( textContent );
        },
        set accessibleDescriptionAsHTML( textContent ) { this.setAccessibleDescriptionAsHTML( textContent ); },

        /**
         * Set the ARIA role for this node's DOM element. According to the W3C, the ARIA role is read-only for a DOM
         * element.  So this will create a new DOM element for this Node with the desired role, and replace the old
         * element in the DOM.
         * @public
         *
         * @param {string} ariaRole - role for the element, see
         *                            https://www.w3.org/TR/html-aria/#allowed-aria-roles-states-and-properties
         *                            for a list of roles, states, and properties.
         */
        setAriaRole: function( ariaRole ) {
          this._ariaRole = ariaRole;
          this.setAccessibleAttribute( 'role', ariaRole );

          this.invalidateAccessibleContent();
        },
        set ariaRole( ariaRole ) { this.setAriaRole( ariaRole ); },

        /**
         * Get the ARIA role representing this node.
         * @public
         *
         * @returns {string}
         */
        getAriaRole: function() {
          return this._ariaRole;
        },
        get ariaRole() { return this.getAriaRole(); },

        /**
         * Set the ARIA role for this node's container parent element.  According to the W3C, the ARIA role is read-only
         * for a DOM element. This will create a new DOM element for the container parent with the desired role, and
         * replace it in the DOM.
         * @public
         *
         * @param {string} ariaRole - role for the element, see
         *                            https://www.w3.org/TR/html-aria/#allowed-aria-roles-states-and-properties
         *                            for a lsit of roles, states, and properties.
         */
        setContainerAriaRole: function( ariaRole ) {
          this._containerAriaRole = ariaRole;
          this.invalidateAccessibleContent();
        },
        set containerAriaRole( ariaRole ) { this.setContainerAriaRole( ariaRole ); },

        /**
         * Get the ARIA role assigned to the container parent element.
         * @public
         * @returns {string|null}
         */
        getContainerAriaRole: function() {
          return this._containerAriaRole;
        },
        get containerAriaRole() { return this.getContainerAriaRole(); },

        /**
         * Sets the 'aria-label' attribute for labelling the node's DOM element. By using the
         * 'aria-label' attribute, the label will be read on focus, but can not be found with the
         * virtual cursor.
         * @public
         *
         * @param {string} ariaLabel - the text for the aria label attribute
         */
        setAriaLabel: function( ariaLabel ) {
          this._ariaLabel = ariaLabel;

          this.setAccessibleAttribute( 'aria-label', ariaLabel );
        },
        set ariaLabel( ariaLabel ) { this.setAriaLabel( ariaLabel ); },

        /**
         * Get the value of the aria-label attribute for this node's DOM element.
         *
         * @returns {string}
         */
        getAriaLabel: function() {
          return this._ariaLabel;
        },
        get ariaLabel() { return this.getAriaLabel(); },

        /**
         * Set the focus highlight for this node. By default, the focus highlight will be a pink rectangle that
         * surrounds the node's local bounds.  If focus highlight is set to 'invisible', the node will not have
         * any highlighting when it receives focus.
         * @public
         *
         * @param {Node|Shape|string.<'invisible'>} focusHighlight
         */
        setFocusHighlight: function( focusHighlight ) {
          this._focusHighlight = focusHighlight;

          var isFocused = false;
          if ( this.isFocused() ) {
            isFocused = true;
          }

          this.invalidateAccessibleContent();

          // if the focus highlight is layerable in the scene graph, update visibility so that it is only
          // visible when associated node has focus
          if ( this._focusHighlightLayerable ) {

            // if focus highlight is layerable, it must be a node in the scene graph
            assert && assert( focusHighlight instanceof phet.scenery.Node );
            focusHighlight.visible = this.focused;
          }

          // Reset the focus after invalidating the content.
          isFocused && this.focus();

        },
        set focusHighlight( focusHighlight ) { this.setFocusHighlight( focusHighlight ); },

        /**
         * Get the focus highlight for this node.
         * @public
         *
         * @returns {Node|Shape|string<'invisible'>}
         */
        getFocusHighlight: function() {
          return this._focusHighlight;
        },
        get focusHighlight() { return this.getFocusHighlight(); },

        /**
         * Setting a flag to break default and allow the focus highlight to be (z) layered into the scene graph.
         * This will set the visibility of the layered focus highlight, it will always be invisible until this node has
         * focus.
         *
         * @param {Boolean} focusHighlightLayerable
         */
        setFocusHighlightLayerable: function( focusHighlightLayerable ) {
          this._focusHighlightLayerable = focusHighlightLayerable;

          // if a focus highlight is defined (it must be a node), update its visibility so it is linked to focus
          // of the associated node
          if ( this._focusHighlight ) {
            assert && assert( this._focusHighlight instanceof phet.scenery.Node );
            this._focusHighlight.visible = this.focused;
          }

          this.invalidateAccessibleContent();
        },
        set focusHighlightLayerable( focusHighlightLayerable ) { this.setFocusHighlightLayerable( focusHighlightLayerable ); },

        /**
         * Get the flag for if this node is layerable in the scene graph (or if it is always on top, like the default).
         * @public
         *
         * @returns {Boolean}
         */
        getFocusHighlightLayerable: function() {
          return this._focusHighlightLayerable;
        },
        get focusHighlightLayerable() { return this.getFocusHighlightLayerable(); },

        /**
         * Set whether or not this node has a group focus highlight. If this node has a group focus highlight, an extra
         * focus highlight will surround this node whenever a descendant node has focus. Generally
         * useful to indicate nested keyboard navigation. If true, the group focus highlight will surround
         * this node's local bounds. Otherwise, the Node will be used.
         *
         * TODO: Support more than one group focus highlight (multiple ancestors could have groupFocusHighlight)
         *
         * @public
         * @param {boolean|Node} groupHighlight
         */
        setGroupFocusHighlight: function( groupHighlight ) {
          this._groupFocusHighlight = groupHighlight;
        },
        set groupFocusHighlight( groupHighlight ) { this.setGroupFocusHighlight( groupHighlight ); },

        /**
         * Get whether or not this node has a 'group' focus highlight, see setter for more information.
         * @public
         *
         * @returns {Boolean}
         */
        getGroupFocusHighlight: function() {
          return this._groupFocusHighlight;
        },
        get groupFocusHighlight() { return this.getGroupFocusHighlight(); },

        /**
         * Sets the node that labels this node through the ARIA attribute aria-labelledby. The value of the
         * 'aria-labelledby' attribute  is a string id that references another HTMLElement in the DOM.
         * Upon focus, a screen reader should read the content under the HTML element referenced by the id,
         * before any description content. Exact behavior will depend on user agent. The specific content
         * used for the label can be specified by using setAriaLabelledContent, see that function for more info.
         *
         * @public
         * @param {Node} node - the node with accessible content that labels this one.
         */
        setAriaLabelledByNode: function( node ) {
          assert && assert( node._accessibleInstances.length < 2, 'cannot be labelled by a node using DAG' );

          this._ariaLabelledByNode = node;

          // needs to track what node it labels so when that node changes, it can trigger invalidation of this node
          node._ariaLabelsNode = this;

          //  accessible content required for both nodes
          var thisHasContent = this._accessibleInstances.length > 0;
          var otherHasContent = node._accessibleInstances.length > 0;
          if ( thisHasContent && otherHasContent ) {
            var self = this;
            this.updateAccessiblePeers( function( accessiblePeer ) {
              var otherPeer = node._accessibleInstances[ 0 ].peer;

              var labelledElement = accessiblePeer.getElementByAssociation( self._ariaLabelledContent );
              var labelSibling = otherPeer.getElementByAssociation( node._ariaLabelContent );

              // if both associated elements defined, set up the attribute, otherwise remove the attribute
              if ( labelledElement && labelSibling ) {
                labelledElement.setAttribute( 'aria-labelledby', labelSibling.id );
              }
              else if ( labelledElement ) {
                labelledElement.removeAttribute( 'aria-labelledby' );
              }
            } );
          }
        },
        set ariaLabelledByNode( node ) { this.setAriaLabelledByNode( node ); },

        /**
         * Get the node that labels this node through  the aria-labelledby relation. See setAriaLabelledByNode
         * for documentation on the behavior of aria-labelledby.
         *
         * @return {Node}
         */
        getAriaLabelledByNode: function() {
          return this._ariaLabelledByNode;
        },
        get ariaLabelledByNode() { return this.getAriaLabelledByNode(); },

        /**
         * Set the accessible content on this node that is labelled through aria-labelledby. Can be the node's
         * DOM element, label element, description element, or container parent element. This will determine
         * which element of this node's accessible content will hold the aria-labelledby attribute.
         *
         * @public
         * @param {string} content - 'LABEL|NODE|DESCRIPTION|PARENT_CONTAINER'
         */
        setAriaLabelledContent: function( content ) {
          this._ariaLabelledContent = content;
          this._ariaLabelledByNode && this.setAriaLabelledByNode( this._ariaLabelledByNode );
        },
        set ariaLabelledContent( content ) { this.setAriaLabelledContent( content ); },


        /**
         * Get a string the determines what element on this node has the aria-labelledby attribute. Does not return
         * a label string. See setAriaLabelledContent for more information.
         *
         * @public
         * @return {string} - one of 'LABEL'|'DESCRIPTION'|'NODE'|'PARENT_CONTAINER'
         */
        getAriaLabelledContent: function() {
          return this._ariaLabelledContent;
        },
        get ariaLabelledContent() { return this.getAriaLabelledContent(); },

        /**
         * Set the aria label content on this node which labels another node through the aria-labelledby
         * association. Can be the node's DOM element, label element, description element, or container parent
         * element. See setAriaLabelledBy for more information on aria-labelledby. This will determine the
         * value of the aria-labelledby attribute for another node when it is labelled by this one.
         *
         * @public
         * @param {string} content - 'LABEL'|'DESCRIPTION'|'NODE'|'PARENT_CONTAINER'
         */
        setAriaLabelContent: function( content ) {
          this._ariaLabelContent = content;
          this._ariaLabelsNode && this._ariaLabelsNode.setAriaLabelledByNode( this );
        },
        set ariaLabelContent( content ) { this.setAriaLabelContent( content ); },

        /**
         * Sets the node that describes this node through the ARIA attribute aria-describedby. The value of the
         * 'aria-describedby' attribute  is a string id that references another HTMLElement in the DOM.
         * Upon focus, a screen reader should read the content under the HTML element referenced by the id,
         * after any label content. Exact behavior will depend on user agent. The specific content
         * used for the description can be specified by using setAriaDescribedContent, see that function for more info.
         *
         * @public
         * @param {Node} node - the node with accessible content that labels this one.
         */
        setAriaDescribedByNode: function( node ) {
          assert && assert( node._accessibleInstances.length < 2, 'cannot be described by a node using DAG' );

          this._ariaDescribedByNode = node;

          // the other node needs to track this one so that when it changes, it can trigger invalidation of this node
          node._ariaDescribesNode = this;

          // accessible content required for both nodes
          var thisHasContent = this._accessibleInstances.length > 0;
          var otherHasContent = node._accessibleInstances.length > 0;
          if ( thisHasContent && otherHasContent ) {
            var self = this;
            this.updateAccessiblePeers( function( accessiblePeer ) {
              var otherPeer = node._accessibleInstances[ 0 ].peer;

              var describedElement = accessiblePeer.getElementByAssociation( self._ariaDescribedContent );
              var descriptionSibling = otherPeer.getElementByAssociation( node._ariaDescriptionContent );

              // if both associated elements exist, set the attribute, otherwise make sure attribute is removed
              if ( describedElement && descriptionSibling ) {
                describedElement.setAttribute( 'aria-describedby', descriptionSibling.id );
              }
              else if ( describedElement ) {
                describedElement.removeAttribute( 'aria-describedby' );
              }
            } );
          }
        },
        set ariaDescribedByNode( node ) { this.setAriaDescribedByNode( node ); },

        /**
         * Set the accessible content on this node that is described through aria-describedby. Can be the node's
         * DOM element, label element, description element, or container parent element. This will determine
         * which element of this node's accessible content has the aria-describedby attribute.
         *
         * @public
         * @param {string} content - 'LABEL|NODE|DESCRIPTION|PARENT_CONTAINER'
         */
        setAriaDescribedContent: function( content ) {
          this._ariaDescribedContent = content;
          this._ariaDescribedByNode && this.setAriaDescribedByNode( this._ariaDescribedByNode );
        },
        set ariaDescribedContent( content ) { this.setAriaDescribedContent( content ); },

        /**
         * Get the described content of this node's accessible content that is described through an aria-describedby
         * association.  Doesn't return a description, but a string describing wich of this node's accessible elements
         * are described.
         *
         * @return {string} -'LABEL|NODE|DESCRIPTION|PARENT_CONTAINER'
         */
        getAriaDescribedContent: function() {
          return this._ariaDescribedContent;
        },
        get ariaDescribedContent() { return this.getAriaDescribedContent; },

        /**
         * Set the aria description content on this node which describes another node through the aria-describedby
         * association. Can be the node's DOM element, label element, description element, or container parent
         * element. This will determine the value for aria-describedby when another node
         * is described by this one.  See setAriaLabelledBy for more information on aria-labelledby.
         *
         * @public
         * @param {string} content - one of 'LABEL'|'DESCRIPTION'|'NODE'|'PARENT_CONTAINER'
         */
        setAriaDescriptionContent: function( content ) {
          this._ariaDescriptionContent = content;
          this._ariaDescribesNode && this._ariaDescribesNode.setAriaDescribedByNode( this );
        },
        set ariaDescriptionContent( content ) { this.setAriaDescriptionContent( content ); },

        getAriaDescriptionContent: function() {
          return this._ariaDescriptionContent;
        },
        get ariaDescriptionContent() { return this.getAriaDescriptionContent(); },

        /**
         * Returns the accessible (focus) order for this node.
         * @public
         *
         * @returns {Array.<Node>|null}
         */
        getAccessibleOrder: function() {
          return this._accessibleOrder;
        },
        get accessibleOrder() { return this.getAccessibleOrder(); },


        /**
         * Sets the accessible focus order for this node. This includes not only focused items, but elements that can be
         * placed in the parallel DOM. If provided, it will override the focus order between children (and
         * optionally descendants). If not provided, the focus order will default to the rendering order (first children
         * first, last children last), determined by the children array.
         * @public
         *
         * @param {Array.<Node>} accessibleOrder
         */
        setAccessibleOrder: function( accessibleOrder ) {
          assert && assert( Array.isArray( accessibleOrder ), 'Array expected, received: ' + typeof accessibleOrder );

          // Only update if it has changed
          if ( this._accessibleOrder !== accessibleOrder ) {
            this._accessibleOrder = accessibleOrder;

            // Get all trails where the root node of the trail has at least one rootedDisplay
            var trails = this.getTrails( Node.hasRootedDisplayPredicate );
            for ( var i = 0; i < trails.length; i++ ) {
              var trail = trails[ i ];
              var rootedDisplays = trail.rootNode()._rootedDisplays;
              for ( var j = 0; j < rootedDisplays.length; j++ ) {
                rootedDisplays[ j ].changedAccessibleOrder( trail );
              }
            }

            this.trigger0( 'accessibleOrder' );
          }
        },
        set accessibleOrder( value ) { this.setAccessibleOrder( value ); },

        /**
         * Returns a recursive data structure that represents the nested ordering of accessible content for this Node's
         * subtree. Each "Item" will have the type { trail: {Trail}, children: {Array.<Item>} }, forming a tree-like
         * structure.
         * @public
         *
         * @returns {Array.<Item>}
         */
        getNestedAccessibleOrder: function() {
          var currentTrail = new scenery.Trail( this );
          var pruneStack = []; // {Array.<Node>} - A list of nodes to prune

          // {Array.<Item>} - The main result we will be returning. It is the top-level array where child items will be
          // inserted.
          var result = [];

          // {Array.<Array.<Item>>} A stack of children arrays, where we should be inserting items into the top array.
          // We will start out with the result, and as nested levels are added, the children arrays of those items will be
          // pushed and poppped, so that the top array on this stack is where we should insert our next child item.
          var nestedChildStack = [ result ];

          function addTrailsForNode( node, overridePruning ) {
            // If subtrees were specified with accessibleOrder, they should be skipped from the ordering of ancestor subtrees,
            // otherwise we could end up having multiple references to the same trail (which should be disallowed).
            var pruneCount = 0;
            // count the number of times our node appears in the pruneStack
            _.each( pruneStack, function( pruneNode ) {
              if ( node === pruneNode ) {
                pruneCount++;
              }
            } );

            // If overridePruning is set, we ignore one reference to our node in the prune stack. If there are two copies,
            // however, it means a node was specified in a accessibleOrder that already needs to be pruned (so we skip it instead
            // of creating duplicate references in the tab order).
            if ( pruneCount > 1 || ( pruneCount === 1 && !overridePruning ) ) {
              return;
            }

            // Pushing item and its children array, if accessible
            if ( node.accessibleContent ) {
              var item = {
                trail: currentTrail.copy(),
                children: []
              };
              nestedChildStack[ nestedChildStack.length - 1 ].push( item );
              nestedChildStack.push( item.children );
            }

            // push specific focused nodes to the stack
            pruneStack = pruneStack.concat( node._accessibleOrder );

            // Visiting trails to ordered nodes.
            _.each( node._accessibleOrder, function( descendant ) {
              // Find all descendant references to the node.
              // NOTE: We are not reordering trails (due to descendant constraints) if there is more than one instance for
              // this descendant node.
              _.each( node.getLeafTrailsTo( descendant ), function( descendantTrail ) {
                descendantTrail.removeAncestor(); // strip off 'node', so that we handle only children

                // same as the normal order, but adding a full trail (since we may be referencing a descendant node)
                currentTrail.addDescendantTrail( descendantTrail );
                addTrailsForNode( descendant, true ); // 'true' overrides one reference in the prune stack (added above)
                currentTrail.removeDescendantTrail( descendantTrail );
              } );
            } );

            // Visit everything. If there is an accessibleOrder, those trails were already visited, and will be excluded.
            var numChildren = node._children.length;
            for ( var i = 0; i < numChildren; i++ ) {
              var child = node._children[ i ];

              currentTrail.addDescendant( child, i );
              addTrailsForNode( child, false );
              currentTrail.removeDescendant();
            }

            // pop focused nodes from the stack (that were added above)
            _.each( node._accessibleOrder, function( descendant ) {
              pruneStack.pop();
            } );

            // Popping children array if accessible
            if ( node.accessibleContent ) {
              nestedChildStack.pop();
            }
          }

          addTrailsForNode( this, false );

          return result;
        },

        /**
         * Hide completely from a screen reader and the browser by setting the hidden attribute on the node's
         * representative DOM element. If the sibling DOM Elements have a container parent, the container
         * should be hidden so that all peers are hidden as well.  Hiding the element will remove it from the focus
         * order.
         *
         * @public
         *
         * @param {boolean} visible
         */
        setAccessibleVisible: function( visible ) {
          this._accessibleVisible = visible;

          // accessible visibility updated in each AccessibleInstane
          this.accessibleVisibilityChangedEmitter.emit();
        },
        set accessibleVisible( visible ) { this.setAccessibleVisible( visible ); },

        /**
         * Get whether or not this node's representative DOM element is visible.
         * @public
         *
         * @returns {boolean}
         */
        getAccessibleVisible: function() {
          return this._accessibleVisible;
        },
        get accessibleVisible() { return this.getAccessibleVisible(); },

        /**
         * Sets whether or not the accessible content should be displayed in the DOM. Almost always, setAccessibleVisible
         * should be used instead of this function.  This should behave exactly like setAccessibleVisible. If removed
         * from display, content will be removed from focus order and undiscoverable with the virtual cursor. Sometimes,
         * hidden attribute is not handled the same way across screen readers, so this function can be used to
         * completely remove the content from the DOM.
         * @public
         *
         * @param {boolean} contentDisplayed
         */
        setAccessibleContentDisplayed: function( contentDisplayed ) {
          this._accessibleContentDisplayed = contentDisplayed;

          for ( var j = 0; j < this._children.length; j++ ) {
            var child = this._children[ j ];
            child.setAccessibleContentDisplayed( contentDisplayed );
          }
          this.invalidateAccessibleContent();
        },
        set accessibleContentDisplayed( contentDisplayed ) { this.setAccessibleContentDisplayed( contentDisplayed ); },

        getAccessibleContentDisplayed: function() {
          return this._accessibleContentDisplayed;
        },
        get accessibleContentDisplayed() { return this.getAccessibleContentDisplayed(); },

        /**
         * Set the value of an input element.  Element must be a form element to support the value attribute. The input
         * value is converted to string since input values are generally string for HTML.
         * @public
         *
         * @param {string|number} value
         */
        setInputValue: function( value ) {
          if ( this._tagName ) {
            assert && assert( _.includes( FORM_ELEMENTS, this._tagName.toUpperCase() ), 'dom element must be a form element to support value' );
          }

          value = '' + value;
          this._inputValue = value;

          this.updateAccessiblePeers( function( accessiblePeer ) {
            accessiblePeer.primarySibling.value = value;
          } );
        },
        set inputValue( value ) { this.setInputValue( value ); },

        /**
         * Get the value of the element. Element must be a form element to support the value attribute.
         * @public
         *
         * @returns {string}
         */
        getInputValue: function() {
          return this._inputValue;
        },
        get inputValue() { return this.getInputValue(); },

        /**
         * Set whether or not the checked attribute appears on the dom elements associated with this Node's
         * accessible content.  This is only useful for inputs of type 'radio' and 'checkbox'. A 'checked' input
         * is considered selected to the browser and assistive technology.
         *
         * @public
         * @param {boolean} checked
         */
        setAccessibleChecked: function( checked ) {
          this._accessibleChecked = checked;

          this.updateAccessiblePeers( function( accessiblePeer ) {
            accessiblePeer.primarySibling.checked = checked;
          } );
        },
        set accessibleChecked( checked ) { this.setAccessibleChecked( checked ); },

        /**
         * Get whether or not the accessible input is 'checked'.
         *
         * @public
         * @return {boolean}
         */
        getAccessibleChecked: function() {
          return this._accessibleChecked;
        },
        get accessibleChecked() { return this.getAccessibleChecked(); },

        /**
         * Get an array containing all accessible attributes that have been added to this node's DOM element.
         * @public
         *
         * @returns {string[]}
         */
        getAccessibleAttributes: function() {
          return this._accessibleAttributes.slice( 0 ); // defensive copy
        },
        get accessibleAttributes() { return this.getAccessibleAttributes(); },

        /**
         * Set a particular attribute for this node's DOM element, generally to provide extra semantic information for
         * a screen reader.
         *
         * @param {string} attribute - string naming the attribute
         * @param {string|boolean} value - the value for the attribute
         * @public
         */
        setAccessibleAttribute: function( attribute, value ) {

          // if the accessible attribute already exists in the list, remove it - no need
          // to remove from the peers, existing attributes will simply be replaced in the DOM
          for ( var i = 0; i < this._accessibleAttributes.length; i++ ) {
            if ( this._accessibleAttributes[ i ].attribute === attribute ) {
              this._accessibleAttributes.splice( i, 1 );
            }
          }

          this._accessibleAttributes.push( { attribute: attribute, value: value } );
          this.updateAccessiblePeers( function( accessiblePeer ) {
            accessiblePeer.primarySibling.setAttribute( attribute, value );
          } );
        },

        /**
         * Remove a particular attribute, removing the associated semantic information from the DOM element.
         *
         * @param {string} attribute - name of the attribute to remove
         * @public
         */
        removeAccessibleAttribute: function( attribute ) {

          var attributeRemoved = false;
          for ( var i = 0; i < this._accessibleAttributes.length; i++ ) {
            if ( this._accessibleAttributes[ i ].attribute === attribute ) {
              this._accessibleAttributes.splice( i, 1 );
              attributeRemoved = true;
            }
          }
          assert && assert( attributeRemoved, 'Node does not have accessible attribute ' + attribute );

          this.updateAccessiblePeers( function( accessiblePeer ) {
            accessiblePeer.primarySibling.removeAttribute( attribute );
          } );
        },

        /**
         * Remove all attributes from this node's dom element.
         * @public
         */
        removeAccessibleAttributes: function() {

          // all attributes currently on this node's DOM element
          var attributes = this.getAccessibleAttributes();

          for ( var i = 0; i < attributes.length; i++ ) {
            var attribute = attributes[ i ].attribute;
            this.removeAccessibleAttribute( attribute );
          }
        },

        /**
         * Make the DOM element explicitly focusable with a tab index. Native HTML form elements will generally be in
         * the navigation order without explicitly setting focusable.  If these need to be removed from the navigation
         * order, call setFocusable( false ).  Removing an element from the focus order does not hide the element from
         * assistive technology.
         * @public
         *
         * @param {boolean} isFocusable
         */
        setFocusable: function( isFocusable ) {
          this._focusable = isFocusable;

          this.updateAccessiblePeers( function( accessiblePeer ) {
            if ( accessiblePeer.primarySibling ) {
              accessiblePeer.primarySibling.tabIndex = isFocusable ? 0 : -1;
            }
          } );
        },
        set focusable( isFocusable ) { this.setFocusable( isFocusable ); },

        /**
         * Get whether or not the node is focusable.
         * @public
         *
         * REVIEW: Usually boolean getters would be called something like isFocusable().
         *
         * @returns {boolean}
         */
        getFocusable: function() {
          return this._focusable;
        },
        get focusable() { return this.getFocusable(); },

        /**
         * Get whether this node's DOM element currently has focus.
         * @public
         *
         * @returns {boolean}
         */
        isFocused: function() {
          var isFocused = false;
          if ( this._accessibleInstances.length > 0 ) {
            isFocused = document.activeElement === this._accessibleInstances[ 0 ].peer.primarySibling;
          }

          return isFocused;
        },
        get focused() { return this.isFocused(); },

        /**
         * Focus this node's dom element. The element must not be hidden, and it must be focusable. If the node
         * has more than one instance, this will fail because the DOM element is not uniquely defined. If accessibility
         * is not enabled, this will be a no op. When Accessibility is more widely used, the no op can be replaced
         * with an assertion that checks for accessible content.
         *
         * @public
         */
        focus: function() {
          if ( this._accessibleInstances.length > 0 ) {

            // when accessibility is widely used, this assertion can be added back in
            // assert && assert( this._accessibleInstances.length > 0, 'there must be accessible content for the node to receive focus' );
            assert && assert( this._focusable, 'trying to set focus on a node that is not focusable' );
            assert && assert( this._accessibleVisible, 'trying to set focus on a node with invisible accessible content' );
            assert && assert( this._accessibleInstances.length === 1, 'focus() unsupported for Nodes using DAG, accessible content is not unique' );

            this._accessibleInstances[ 0 ].peer.primarySibling.focus();
          }
        },

        /**
         * Remove focus from this DOM element.  The focus highlight will dissapear, and the element will not receive
         * keyboard events when it doesn't have focus.
         * @public
         */
        blur: function() {
          if ( this._accessibleInstances.length > 0 ) {
            this._accessibleInstances[ 0 ].peer.primarySibling.blur();
          }
        },

        /**
         * Add DOM event listeners contained in the accessibleInput directly to the DOM elements on each
         * accessibleInstance.  Never use this directly, use addAccessibleInputListener()
         * @private
         *
         * @param {Object} accessibleInput
         * @param {HTMLElement} domElement
         */
        addDOMEventListeners: function( accessibleInput, domElement ) {
          for ( var event in accessibleInput ) {
            if ( accessibleInput.hasOwnProperty( event ) && _.includes( DOM_EVENTS, event ) ) {
              domElement.addEventListener( event, accessibleInput[ event ] );
            }
          }
        },

        /**
         * Remove a DOM event listener contained in an accesssibleInput.  Never to be used directly, see
         * removeAccessibilityInputListener().
         * @private
         *
         * @param {Object} accessibleInput
         * @param {HTMLElement} domElement
         */
        removeDOMEventListeners: function( accessibleInput, domElement ) {
          for ( var event in accessibleInput ) {
            if ( accessibleInput.hasOwnProperty( event ) && _.includes( DOM_EVENTS, event ) ) {
              domElement.removeEventListener( event, accessibleInput[ event ] );
            }
          }
        },

        /**
         * Do not use this function directly, it is private. Updates the accessible description,
         * setting content as innerHTML or textContent based no the state of this._descriptionIsHTML flag.
         *
         * @private
         * @param {string} description
         */
        setDescriptionContent: function( description ) {
          this._accessibleDescription = description;

          // if there is no description element, assume that a paragraph element should be used
          if ( !this._descriptionTagName ) {
            this.setDescriptionTagName( DEFAULT_DESCRIPTION_TAG_NAME );
          }

          var self = this;
          this.updateAccessiblePeers( function( accessiblePeer ) {
            setTextContent( accessiblePeer.descriptionSibling, description, self._descriptionIsHTML );
          } );
        },

        /**
         * Update all AccessiblePeers representing this node with the callback, which takes the AccessiblePeer
         * as an argument.
         * @private
         * @param {function} callback
         */
        updateAccessiblePeers: function( callback ) {
          for ( var i = 0; i < this._accessibleInstances.length; i++ ) {
            this._accessibleInstances[ i ].peer && callback( this._accessibleInstances[ i ].peer );
          }
        },

        /**
         * Sets the accessible content for a Node. See constructor for more information.
         * @public (scenery-internal)
         *
         * @param {null|Object} accessibleContent
         */
        setAccessibleContent: function( accessibleContent ) {
          assert && assert( accessibleContent === null || accessibleContent instanceof Object );

          if ( this._accessibleContent !== accessibleContent ) {
            var oldAccessibleContent = this._accessibleContent;
            this._accessibleContent = accessibleContent;

            var trails = this.getTrails( Node.hasRootedDisplayPredicate );
            for ( var i = 0; i < trails.length; i++ ) {
              var trail = trails[ i ];
              var rootedDisplays = trail.rootNode()._rootedDisplays;
              for ( var j = 0; j < rootedDisplays.length; j++ ) {
                rootedDisplays[ j ].changedAccessibleContent( trail, oldAccessibleContent, accessibleContent );
              }
            }

            this.trigger0( 'accessibleContent' );
          }
        },
        set accessibleContent( value ) { this.setAccessibleContent( value ); },

        /**
         * Returns the accessible content for this node.
         * @public (scenery-internal)
         *
         *
         * @returns {null|Object}
         */
        getAccessibleContent: function() {
          return this._accessibleContent;
        },
        get accessibleContent() { return this.getAccessibleContent(); },


        /**
         * Called when the node is added as a child to this node AND the node's subtree contains accessible content.
         * We need to notify all Displays that can see this change, so that they can update the AccessibleInstance tree.
         * @private
         *
         * @param {Node} node
         */
        onAccessibleAddChild: function( node ) {
          // All trails starting with nodes that have display roots, and ending with the added node.
          var trails = node.getTrails( Node.hasRootedDisplayPredicate );
          for ( var i = 0; i < trails.length; i++ ) {
            var trail = trails[ i ];

            // Ignore trails where this node is not the child node's parent. See https://github.com/phetsims/scenery/issues/491
            if ( trail.nodeFromTop( 1 ) !== this ) {
              continue;
            }

            // Notify each Display of the trail
            var rootedDisplays = trail.rootNode()._rootedDisplays;
            for ( var j = 0; j < rootedDisplays.length; j++ ) {
              rootedDisplays[ j ].addAccessibleTrail( trail );
            }
          }
        },

        /**
         * Called when the node is removed as a child from this node AND the node's subtree contains accessible content.
         * We need to notify all Displays that can see this change, so that they can update the AccessibleInstance tree.
         * @private
         *
         * @param {Node} node
         */
        onAccessibleRemoveChild: function( node ) {
          // All trails starting with nodes that have display roots, and ending with the removed node.
          var trails = node.getTrails( Node.hasRootedDisplayPredicate );
          for ( var i = 0; i < trails.length; i++ ) {
            var trail = trails[ i ];

            // Ignore trails where this node is not the child node's parent. See https://github.com/phetsims/scenery/issues/491
            if ( trail.nodeFromTop( 1 ) !== this ) {
              continue;
            }

            // Notify each Display of the trail
            var rootedDisplays = trail.rootNode()._rootedDisplays;
            for ( var j = 0; j < rootedDisplays.length; j++ ) {
              rootedDisplays[ j ].removeAccessibleTrail( trail );
            }
          }
        },

        /*---------------------------------------------------------------------------*
        * Accessible Instance handling
        *----------------------------------------------------------------------------*/

        /**
         * Returns a reference to the accessible instances array.
         * @public (scenery-internal)
         *
         * @returns {Array.<AccessibleInstance>}
         */
        getAccessibleInstances: function() {
          return this._accessibleInstances;
        },
        get accessibleInstances() { return this.getAccessibleInstances(); },

        /**
         * Adds an AccessibleInstance reference to our array.
         * @public (scenery-internal)
         *
         * @param {AccessibleInstance} accessibleInstance
         */
        addAccessibleInstance: function( accessibleInstance ) {
          assert && assert( accessibleInstance instanceof scenery.AccessibleInstance );
          this._accessibleInstances.push( accessibleInstance );
        },

        /**
         * Removes an AccessibleInstance reference from our array.
         * @public (scenery-internal)
         *
         * @param {AccessibleInstance} accessibleInstance
         */
        removeAccessibleInstance: function( accessibleInstance ) {
          assert && assert( accessibleInstance instanceof scenery.AccessibleInstance );
          var index = _.indexOf( this._accessibleInstances, accessibleInstance );
          assert && assert( index !== -1, 'Cannot remove an AccessibleInstance from a Node if it was not there' );
          this._accessibleInstances.splice( index, 1 );
        },
      } );

      /**
       * If the text content uses formatting tags, set the content as innerHTML. Otherwise, set as textContent.
       * In general, textContent is more secure and more performant because it doesn't trigger DOM styling and
       * element insertions.
       *
       * @param {HTMLElement} domElement
       * @param {string} textContent
       * @param {boolean} isHTML - whether or not to set the content as HTML
       */
      function setTextContent( domElement, textContent, isHTML ) {
        if ( isHTML ) {
          domElement.innerHTML = textContent;
        }
        else {
          domElement.textContent = textContent;
        }
      }

      /**
       * Returns whether or not the element supports innerHTML.
       * @private
       * @param {HTMLElement} domElement
       * @returns {boolean}
       * TODO: uncomment this, it will be needed later in https://github.com/phetsims/scenery/issues/748
       */
      // function elementSupportsInnerHTML( domElement ) {
      //   return !_.includes( ELEMENTS_WITHOUT_CLOSING_TAG, domElement.tagName );
      // }

      /**
       * Create an HTML element.  Unless this is a form element or explicitly marked as focusable, add a negative
       * tab index. IE gives all elements a tabIndex of 0 and handles tab navigation internally, so this marks
       * which elements should not be in the focus order.
       *
       * @param  {string} tagName
       * @param {boolean} focusable - should the element be explicitly added to the focus order?
       * @returns {HTMLElement}
       */
      function createElement( tagName, focusable ) {
        var domElement = document.createElement( tagName );
        var upperCaseTagName = tagName.toUpperCase();

        // give all non-focusable elements a tabindex of -1 for browser consistency
        if ( !_.includes( FORM_ELEMENTS, upperCaseTagName ) && !focusable ) {
          domElement.tabIndex = -1;
        }

        // Safari requires that certain input elements have dimension, otherwise it will not be keyboard accessible
        if ( _.includes( ELEMENTS_REQUIRE_WIDTH, upperCaseTagName ) ) {
          domElement.style.width = '1px';
          domElement.style.height = '1px';
        }

        return domElement;
      }

      /**
       * Called by invalidateAccessibleContent.  'this' will be bound by call. The contentElement will either be a
       * label or description element.  The contentElement will be sorted relative to this node's DOM element or its
       * containerParent.  Its placement will also depend on whether or not this node wants to prepend labels,
       * see setPrependLabels().
       * @private
       *
       * @param {AccessiblePeer} accessiblePeer
       * @param {HTMLElement} contentElement
       * @param {boolean} prependLabels
       */
      function insertContentElement( accessiblePeer, contentElement, prependLabels ) {
        assert && assert( accessiblePeer.containerParent, 'Cannot add sibling if there is no container element' );
        if ( accessiblePeer.containerParent ) {
          if ( prependLabels && accessiblePeer.containerParent === accessiblePeer.primarySibling.parentNode ) {
            accessiblePeer.containerParent.insertBefore( contentElement, accessiblePeer.primarySibling );
          }
          else {
            accessiblePeer.containerParent.appendChild( contentElement );
          }
        }
        else if ( accessiblePeer.primarySibling ) {
          accessiblePeer.primarySibling.appendChild( contentElement );
        }
      }

      /**
       * Invalidate our current accessible content, triggering recomputation
       * of anything that depended on the old accessible content. This can be
       * combined with a client implementation of invalidateAccessibleContent.
       *
       * @protected
       */
      function invalidateAccessibleContent() {
        var self = this;

        // iteration variable used through this function
        var i = 0;

        // for each accessible peer, clear the container parent if it exists since we will be reinserting labels and
        // the dom element in createPeer
        this.updateAccessiblePeers( function( accessiblePeer ) {
          var containerElement = accessiblePeer.containerParent;
          while ( containerElement && containerElement.hasChildNodes() ) {
            containerElement.removeChild( containerElement.lastChild );
          }
        } );

        // if any parents are flagged as removed from the accessibility tree, set content to null
        var contentDisplayed = this._accessibleContentDisplayed;
        for ( i = 0; i < this._parents.length; i++ ) {
          if ( !this._parents[ i ].accessibleContentDisplayed ) {
            contentDisplayed = false;
          }
        }

        var accessibleContent = null;
        if ( contentDisplayed && this._tagName ) {
          accessibleContent = {
            createPeer: function( accessibleInstance ) {

              var uniqueId = accessibleInstance.trail.getUniqueId();

              // create the base DOM element representing this accessible instance
              var primarySibling = createElement( self._tagName, self._focusable );
              primarySibling.id = uniqueId;

              // create the container parent for the dom siblings
              var containerElement = null;
              if ( self._containerTagName ) {
                containerElement = createElement( self._containerTagName, false );
                containerElement.id = 'container-' + uniqueId;

                // provide the aria-role if it is specified
                if ( self._containerAriaRole ) {
                  containerElement.setAttribute( 'role', self._containerAriaRole );
                }
              }

              // create the label DOM element representing this instance
              var labelSibling = null;
              if ( self._labelTagName ) {
                labelSibling = createElement( self._labelTagName, false );
                labelSibling.id = 'label-' + uniqueId;

                if ( self._labelTagName.toUpperCase() === LABEL_TAG ) {
                  labelSibling.setAttribute( 'for', uniqueId );
                }
              }

              // create the description DOM element representing this instance
              var descriptionSibling = null;
              if ( self._descriptionTagName ) {
                descriptionSibling = createElement( self._descriptionTagName, false );
                descriptionSibling.id = 'description-' + uniqueId;
              }

              var accessiblePeer = new AccessiblePeer( accessibleInstance, primarySibling, {
                containerParent: containerElement,
                labelSibling: labelSibling,
                descriptionSibling: descriptionSibling
              } );
              accessibleInstance.peer = accessiblePeer;

              // restore whether or not this element is focusable
              if ( self._focusable === null ) {
                self._focusable = _.includes( FORM_ELEMENTS, self._tagName.toUpperCase() );
              }
              self.setFocusable( self._focusable );

              // set the accessible label now that the element has been recreated again
              if ( self._labelContent ) {
                self.setLabelContent( self._labelContent );
              }

              // restore the innerContent
              if ( self._innerContent ) {
                self.setInnerContent( self._innerContent );
              }

              // set if using aria-label
              if ( self._ariaLabel ) {
                self.setAriaLabel( self._ariaLabel );
              }

              // restore visibility
              self.setAccessibleVisible( self._accessibleVisible );

              // restore checked
              self.setAccessibleChecked( self._accessibleChecked );

              // restore input value
              self._inputValue && self.setInputValue( self._inputValue );

              // set the accessible attributes, restoring from a defenseive copy
              var defensiveAttributes = self.accessibleAttributes;
              for ( i = 0; i < defensiveAttributes.length; i++ ) {
                var attribute = defensiveAttributes[ i ].attribute;
                var value = defensiveAttributes[ i ].value;
                self.setAccessibleAttribute( attribute, value );
              }

              // set the accessible description
              if ( self._accessibleDescription ) {
                if ( self._descriptionIsHTML ) {
                  self.setAccessibleDescriptionAsHTML( self._accessibleDescription );
                }
                else {
                  self.setAccessibleDescription( self._accessibleDescription );
                }
              }

              // if element is an input element, set input type
              if ( self._tagName.toUpperCase() === INPUT_TAG && self._inputType ) {
                self.setInputType( self._inputType );
              }

              // restore aria-labelledby associations
              var labelledByNode = self._ariaLabelledByNode;
              labelledByNode && self.setAriaLabelledByNode( labelledByNode, self._ariaLabelledContent, labelledByNode._ariaLabelContent );

              // if this node aria-labels another node, restore label associations for that node
              var ariaLabelsNode = self._ariaLabelsNode;
              ariaLabelsNode && ariaLabelsNode.setAriaLabelledByNode( self, ariaLabelsNode._ariaLabelledContent, self._ariaLabelContent );

              // restore aria-describedby asssociations
              var describedByNode = self._ariaDescribedByNode;
              describedByNode && self.setAriaDescribedByNode( describedByNode, self._ariaDescribedContent, describedByNode._ariaDescribedContent );

              // if this node aria-describes another node, restore description asssociations for that node
              var ariaDescribesNode = self._ariaDescribesNode;
              ariaDescribesNode && ariaDescribesNode.setAriaDescribedByNode( self, ariaDescribesNode._ariaDescribedContent, self._ariaDescriptionContent );

              // add all listeners to the dom element
              for ( i = 0; i < self._accessibleInputListeners.length; i++ ) {
                self.addDOMEventListeners( self._accessibleInputListeners[ i ], primarySibling );
              }

              // insert the label and description elements in the correct location if they exist
              labelSibling && insertContentElement( accessiblePeer, labelSibling, self._prependLabels );
              descriptionSibling && insertContentElement( accessiblePeer, descriptionSibling, self._prependLabels );

              // Default the focus highlight in this special case to be invisible until selected.
              if ( self._focusHighlightLayerable ) {
                self._focusHighlight.visible = false;
              }

              return accessiblePeer;
            }
          };
        }

        this.accessibleContent = accessibleContent;
      }

      // Patch in a sub-type call if it already exists on the prototype
      if ( proto.invalidateAccessibleContent ) {
        var subtypeInvalidateAccesssibleContent = proto.invalidateAccessibleContent;
        proto.invalidateAccessibleContent = function() {
          subtypeInvalidateAccesssibleContent.call( this );
          invalidateAccessibleContent.call( this );
        };
      }
      else {
        proto.invalidateAccessibleContent = invalidateAccessibleContent;
      }
    }
  };

  scenery.register( 'Accessibility', Accessibility );

  return Accessibility;
} );
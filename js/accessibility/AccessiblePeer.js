// Copyright 2015-2016, University of Colorado Boulder

/**
 * An accessible peer controls the appearance of an accessible Node's instance in the parallel DOM. An AccessiblePeer can
 * have up to four HTMLElements displayed in the PDOM, see constructor for details.
 *
 * @author Jonathan Olson <jonathan.olson@colorado.edu>
 * @author Jesse Greenberg
 */

define( function( require ) {
  'use strict';

  var AccessibilityUtil = require( 'SCENERY/accessibility/AccessibilityUtil' );
  var Bounds2 = require( 'DOT/Bounds2' );
  var Focus = require( 'SCENERY/accessibility/Focus' );
  var inherit = require( 'PHET_CORE/inherit' );
  var Matrix3 = require( 'DOT/Matrix3' );
  var Poolable = require( 'PHET_CORE/Poolable' );
  var scenery = require( 'SCENERY/scenery' );
  var TransformTracker = require( 'SCENERY/util/TransformTracker' );
  // so RequireJS doesn't complain about circular dependency
  // var Display = require( 'SCENERY/display/Display' );

  var globalId = 1;

  // constants
  var PRIMARY_SIBLING = 'PRIMARY_SIBLING';
  var LABEL_SIBLING = 'LABEL_SIBLING';
  var DESCRIPTION_SIBLING = 'DESCRIPTION_SIBLING';
  var CONTAINER_PARENT = 'CONTAINER_PARENT';
  var LABEL_TAG = AccessibilityUtil.TAGS.LABEL;
  var INPUT_TAG = AccessibilityUtil.TAGS.INPUT;

  // constants
  // DOM observers that apply new css transformations are triggered when children, attributes, or inner content change
  var OBSERVER_CONFIG = { attributes: false, childList: true, characterData: true };

  // matrices reused in calculations
  var LABEL_SCALING_MATRIX = Matrix3.scaling( 0.05, 0.05 );

  // mutable matrices, to avoid creating lots of them unnecessarily
  var labelTranslationMatrix = new Matrix3();
  var globalNodeTranslationMatrix = new Matrix3();
  var globalToClientScaleMatrix = new Matrix3();
  var nodeScaleMagnitudeMatrix = new Matrix3();

  // will become
  var siblingScratchBounds = new Bounds2( 0, 0, 0, 0 );

  /**
   * @param {AccessibleInstance} accessibleInstance
   * @param {Object} [options]
   * @constructor
   */
  function AccessiblePeer( accessibleInstance, options ) {
    this.initializeAccessiblePeer( accessibleInstance, options );
  }

  scenery.register( 'AccessiblePeer', AccessiblePeer );

  inherit( Object, AccessiblePeer, {

    /**
     * Initializes the object (either from a freshly-created state, or from a "disposed" state brought back from a
     * pool)
     * @private
     *
     * @param {AccessibleInstance} accessibleInstance
     * @param {Object} [options]
     * @returns {AccessiblePeer} - Returns 'this' reference, for chaining
     */
    initializeAccessiblePeer: function( accessibleInstance, options ) {
      options = _.extend( {
        primarySibling: null // {HTMLElement|null} primarySibling - The main DOM element used for this peer
      }, options );

      assert && assert( !this.id || this.disposed, 'If we previously existed, we need to have been disposed' );

      // @public {number} - unique ID
      this.id = this.id || globalId++;

      // @public {AccessibleInstance}
      this.accessibleInstance = accessibleInstance;

      // @public {Node|null} only null for the root accessibleInstance
      this.node = this.accessibleInstance.node;

      // @public {Display} - Each peer is associated with a specific Display.
      this.display = accessibleInstance.display;

      // @public {Trail} - NOTE: May have "gaps" due to accessibleOrder usage.
      this.trail = accessibleInstance.trail;

      // @private {boolean|null} - whether or not this AccessiblePeer is visible in the PDOM
      // Only initialized to null, should not be set to it. isVisible() will return true if this.visible is null
      // (because it hasn't been set yet).
      this.visible = null;

      // @private {HTMLElement|null} - Optional label/description elements
      this._labelSibling = null;
      this._descriptionSibling = null;

      // @private {HTMLElement|null} - A parent element that can contain this primarySibling and other siblings, usually
      // the label and description content.
      this._containerParent = null;

      // @public {Array.<HTMLElement>} Rather than guarantee that a peer is a tree with a root DOMElement,
      // allow multiple HTMLElements at the top level of the peer. This is used for sorting the instance.
      // See this.orderElements for more info.
      this.topLevelElements = [];

      // @private {MutationObserver|null} - an observer that will change the transformation for the primary
      // sibling if its inner content or child list changes
      this._primaryObserver = null;

      // @private - flag that indicates that this peer has accessible content that changed and so the element
      // transforms need to be updated in the next animation frame
      this.transformDirty = false;

      // @private - flag that this peer has an AccessibleInstance with some descendant with a dirty transform that
      // needs to be updated in the next animation frame
      this.descendantTransformDirty = false;

      // @private - the matrix that transforms the HTML sibling elements to the local coordinate frame of this peer's
      // node, identity until the sibling has client bounds
      this.domToLocalMatrix = Matrix3.IDENTITY;

      // @private - the difference between the nodes along this trail and the nodes of the parent accessible instance's
      // trail, including this node - populated in update
      this.visibleNodesToAccessibleParent = [];

      // @private - the trail to the visual instance since due to 
      this.visualTrail = this.accessibleInstance.guessVisualTrail();

      // walk up the visual trail, trying to find the ancestor accessible instance along the visual trail (not
      // necessarily the accessible instance parent)
      this.visibleNodesToAccessibleParent.push( this.node );
      for ( var i = this.visualTrail.length - 2; i >= 0; i-- ) {
        var visualParent = this.visualTrail.get( i );

        // ancestor needs to come first in the array, so we add these to front
        if ( !visualParent.tagName ) {
          this.visibleNodesToAccessibleParent.unshift( visualParent );
        }
        else {

          // we found the parent instance along the visual trail so we can break without adding it to the array
          break;
        }
      }

      // @private {boolean} - Whether we are currently in a "disposed" (in the pool) state, or are available to be
      // interacted with.
      this.disposed = false;

      // edge case for root accessibility, which is passed in through options for some reason
      if ( options.primarySibling ) {

        // @private {HTMLElement} - The main element associated with this peer. If focusable, this is the element that gets
        // the focus. It also will contain any children.
        this._primarySibling = options.primarySibling;

        // if testing mobile a11y, give the root primary sibling style attributes to support transforming the HTML'
        if ( window.phet && phet.chipper.queryParameters.mobileA11yTest ) {

          // root is relatively styled so that descendants can be positioned absolutely
          this._primarySibling.style.position = 'relative';
        }

        return this;
      }

      //REVIEW: Why doesn't this need to be done for "root" peers where the primarySibling is passed in? Seems like
      //REVIEW: it would still be needed.
      //ZEPUMPH: Since the root doesn't have a node, it couldn't have a container or sibling elements, so this all isn't
      //ZEPUMPH: needed I think.
      // for each accessible peer, clear the container parent if it exists since we will be reinserting labels and
      // the dom element in createPeer
      while ( this._containerParent && this._containerParent.hasChildNodes() ) {
        this._containerParent.removeChild( this._containerParent.lastChild );
      }

      // @private {TransformTracker} - update CSS bounds when transform of this node changes
      this.transformTracker = new TransformTracker( this.trail );

      // attach a MutationObserver that will update the transformation of the element when content or children change
      // only create new one if not from pool
      var self = this;
      this._primaryObserver = this._primaryObserver || new MutationObserver( function( mutations ) {

        // there is no need to iterate over the entire list of mutations because a single mutation is all that is
        // required to mark dirty for the next Display.updateDisplay
        self.invalidateCSSTransforms();
      } );

      // @private - must be removed on disposal
      this.transformListener = this.transformListener || function() {
        self.invalidateCSSTransforms();
      };
      this.transformTracker.addListener( this.transformListener );

      //REVIEW: Most of these are cleared on disposal and declared above. What is the purpose of clearing them here?
      // clear out elements to be recreated below
      this._primarySibling = null;
      this._labelSibling = null;
      this._descriptionSibling = null;
      this._containerParent = null;

      // REVIEW: Why is this a separate function call? It's never called to "update" things.
      this.update();

      return this;
    },

    /**
     * Update the content of the peer
     * @private
     *
     * REVIEW: This appears to be only called from initializeAccessiblePeer, and never from anywhere else. Is that
     * REVIEW: correct, and if so could they be combined?
     */
    update: function() {
      var i;
      var uniqueId = this.accessibleInstance.trail.getUniqueId();

      var options = this.node.getBaseOptions();

      // REVIEW: Since this includes rewriting of options, does the long-term order matter? I could imagine writing code.
      // REVIEW:
      // REVIEW: Ahh yup, found one where it creates buggy behavior with defaults. heading/accessibleName both mess with
      // REVIEW: labelTagName/labelContent.
      // REVIEW: In the scenery playground:
      // REVIEW:   var n = new scenery.Node();
      // REVIEW:   n.accessibleName = 'aname';
      // REVIEW:   n.tagName = 'input';
      // REVIEW:   scene.addChild( n );
      // REVIEW:   n.accessibleHeading = 'header';
      // REVIEW: The accessible name (executed here first) then gets overwritten with the header. I'm also not quite sure
      // REVIEW: why, but the tag is 'hnull', e.g.:
      // REVIEW:   <div class="accessibility">
      // REVIEW:     <hnull tabindex="-1" id="label-2-11">header</hnull>
      // REVIEW:     <input tabindex="0" id="2-11" style="width: 1px; height: 1px;">
      // REVIEW:   </div>
      // REVIEW: Ideally the order is "what is best", and hopefully the defaults (with normal usage) would not run into
      // REVIEW: this. But think about what may happen in the future (all settings), and about all the potential ways
      // REVIEW: we would want to overwrite behaviors.
      //ZEPUMPH: These were developed as two fully separate apis, not ever to be used together in their default form.
      //ZEPUMPH: I'm not sure how best to document that though. From a use case perspective, you either have a heading,
      //ZEPUMPH: Or an accessibleName.

      //ZEPUMPH: This is something JG and I have discussed quite a bit. On one hand these options are all so complicated
      //ZEPUMPH: and hard to fully understand everything (lower level api), on the other, when we try to create higher level
      //ZEPUMPH: abstractions, there will be conflicts with each other.
      // REVIEW:
      // REVIEW: As a generalization, how would we handle "arbitrary" behaviors that don't depend on one parameter?
      // REVIEW: What if there was a "pipeline" of behaviors that the client could insert general things into?
      // REVIEW: It's probably overkill and just brainstorming but if you have this._behaviors = [ b1, b2, b3 ],
      // REVIEW: then options = b3( node, b2( node, b1( node, options ) ) )?
      //ZEPUMPH: Intereseting! Let's talk about this on Friday
      if ( this.node.accessibleName !== null ) {
        options = this.node.accessibleNameBehavior( this.node, options, this.node.accessibleName );
      }

      if ( this.node.accessibleHeading !== null ) {
        options = this.node.accessibleHeadingBehavior( this.node, options, this.node.accessibleHeading );
      }

      if ( this.node.helpText !== null ) {
        options = this.node.helpTextBehavior( this.node, options, this.node.helpText );
      }


      // create the base DOM element representing this accessible instance
      //REVIEW: Do we want to check options.focusable instead? Should no accessibleNameBehavior/helpTextBehavior be
      //REVIEW: able to modify whether something is focusable?
      //ZEPUMPH: I think we need to have a larger discussion about what behavior functions' role should be, I totally
      //ZEPUMPH: understand your thought here.
      this._primarySibling = AccessibilityUtil.createElement( options.tagName, this.node.focusable, {
        namespace: options.accessibleNamespace
      } );
      this._primarySibling.id = uniqueId;

      // create the container parent for the dom siblings
      if ( options.containerTagName ) {
        this._containerParent = AccessibilityUtil.createElement( options.containerTagName, false );
        this._containerParent.id = 'container-' + uniqueId;
      }

      // create the label DOM element representing this instance
      if ( options.labelTagName ) {
        this._labelSibling = AccessibilityUtil.createElement( options.labelTagName, false );
        this._labelSibling.id = 'label-' + uniqueId;
      }

      // create the description DOM element representing this instance
      if ( options.descriptionTagName ) {
        this._descriptionSibling = AccessibilityUtil.createElement( options.descriptionTagName, false );
        this._descriptionSibling.id = 'description-' + uniqueId;

        // descriptions are just pushed off screen, only inputs are required to be transformed
        // TODO: factor this out
        AccessibilityUtil.hideElement( this._descriptionSibling );
      }

      this.orderElements( options );

      // assign listeners (to be removed or detached during disposal)

      // @private {function} - Referenced for disposal
      this.focusEventListener = this.focusEventListener || this.onFocus.bind( this );
      this.blurEventListener = this.blurEventListener || this.onBlur.bind( this );

      // Hook up listeners for when our primary element is focused or blurred.
      this._primarySibling.addEventListener( 'blur', this.blurEventListener );
      this._primarySibling.addEventListener( 'focus', this.focusEventListener );

      this._primaryObserver.observe( this._primarySibling, OBSERVER_CONFIG );

      // set the accessible label now that the element has been recreated again, but not if the tagName
      // has been cleared out
      if ( options.labelContent && options.labelTagName !== null ) {
        this.setLabelSiblingContent( options.labelContent );
      }

      // restore the innerContent
      if ( options.innerContent && options.tagName !== null ) {
        this.setPrimarySiblingContent( options.innerContent );
      }

      // set the accessible description, but not if the tagName has been cleared out.
      if ( options.descriptionContent && options.descriptionTagName !== null ) {
        this.setDescriptionSiblingContent( options.descriptionContent );
      }

      // if element is an input element, set input type
      if ( options.tagName.toUpperCase() === INPUT_TAG && options.inputType ) {
        // REVIEW: This looks like something that should be a behavior?
        //ZEPUMPH: I'm not sure I understand
        this.setAttributeToElement( 'type', options.inputType );
      }

      // recompute and assign the association attributes that link two elements (like aria-labelledby)
      this.onAriaLabelledbyAssociationChange();
      this.onAriaDescribedbyAssociationChange();

      // add all listeners to the dom element
      for ( i = 0; i < this.node.accessibleInputListeners.length; i++ ) {
        this.addDOMEventListeners( this.node.accessibleInputListeners[ i ] );
      }

      // update all attributes for the peer, should cover aria-label, role, and others
      // REVIEW: Maybe it's unlikely, but I can TOTALLY see our behaviors above wanting to adjust arbitrary attributes.
      // REVIEW: Since this ONLY inspects things directly on the node (not the overridden a11y options above), this is
      // REVIEW: not possible. Is that something to consider?
      // REVIEW: Upon further review, this totally seems like the case (since it's already being kinda done for aria-label).
      // REVIEW: Can the accessible attributes be included with the "options" object, and can behaviors adjust them as
      // REVIEW: they see fit?
      //ZEPUMPH: TODO: Let's talk about this more as part of https://github.com/phetsims/scenery/issues/867

      this.onAttributeChange( options );

      // update input value attribute for the peer
      this.onInputValueChange();

      this.node.updateOtherNodesAriaLabelledby();
      this.node.updateOtherNodesAriaDescribedby();
    },

    /**
     * Handle the internal ordering of the elements in the peer, this involves setting the proper value of
     * this.topLevelElements
     * REVIEW: Maybe change the parameter name a bit? I can see someone saying "but options should be optional" and
     * REVIEW: the object isn't optional here. Or actually make it optional.
     * @param {Object} options - the computed mixin options to be applied to the peer.
     * @private
     */
    orderElements: function( options ) {
      if ( this._containerParent ) {
        // The first child of the container parent element should be the peer dom element
        // if undefined, the insertBefore method will insert the this._primarySibling as the first child
        this._containerParent.insertBefore( this._primarySibling, this._containerParent.children[ 0 ] || null );
        this.topLevelElements = [ this._containerParent ];
      }
      else {

        // Wean out any null siblings
        this.topLevelElements = [ this._labelSibling, this._descriptionSibling, this._primarySibling ].filter( _.identity );
      }

      // insert the label and description elements in the correct location if they exist
      this._labelSibling && this.arrangeContentElement( this._labelSibling, options.appendLabel );
      this._descriptionSibling && this.arrangeContentElement( this._descriptionSibling, options.appendDescription );

    },

    /**
     * Get the primary sibling element for the peer
     * @public
     * @returns {HTMLElement|null}
     */
    getPrimarySibling: function() {
      return this._primarySibling;
    },
    get primarySibling() { return this.getPrimarySibling(); },

    /**
     * Get the primary sibling element for the peer
     * @public
     * @returns {HTMLElement|null}
     */
    getLabelSibling: function() {
      return this._labelSibling;
    },
    get labelSibling() { return this.getLabelSibling(); },

    /**
     * Get the primary sibling element for the peer
     * @public
     * @returns {HTMLElement|null}
     */
    getDescriptionSibling: function() {
      return this._descriptionSibling;
    },
    get descriptionSibling() { return this.getDescriptionSibling(); },

    /**
     * Get the primary sibling element for the peer
     * @public
     * @returns {HTMLElement|null}
     */
    getContainerParent: function() {
      return this._containerParent;
    },
    get containerParent() { return this.getContainerParent(); },

    /**
     * Recompute the aria-labelledby attributes for all of the peer's elements
     * @public
     */
    onAriaLabelledbyAssociationChange: function() {
      // REVIEW: Is there a good list of attributes for which should NOT be set by the node (because it will be buggy)?
      // REVIEW: It seems like it's just a11y-dev knowledge that you shouldn't node.setAccessibleAttribute( 'aria-labelledby' ).
      // REVIEW: It probably is the best to keep it that way?
      this.removeAttributeFromAllElements( 'aria-labelledby' );

      for ( var i = 0; i < this.node.ariaLabelledbyAssociations.length; i++ ) {
        var associationObject = this.node.ariaLabelledbyAssociations[ i ];

        // Assert out if the model list is different than the data held in the associationObject
        assert && assert( associationObject.otherNode.nodesThatAreAriaLabelledbyThisNode.indexOf( this.node ) >= 0,
          'unexpected otherNode' );


        this.setAssociationAttribute( 'aria-labelledby', associationObject );
      }
    },

    /**
     * Recompute the aria-describedby attributes for all of the peer's elements
     * @public
     */
    onAriaDescribedbyAssociationChange: function() {
      this.removeAttributeFromAllElements( 'aria-describedby' );

      for ( var i = 0; i < this.node.ariaDescribedbyAssociations.length; i++ ) {
        var associationObject = this.node.ariaDescribedbyAssociations[ i ];

        // Assert out if the model list is different than the data held in the associationObject
        assert && assert( associationObject.otherNode.nodesThatAreAriaDescribedbyThisNode.indexOf( this.node ) >= 0,
          'unexpected otherNode' );


        this.setAssociationAttribute( 'aria-describedby', associationObject );
      }
    },

    /**
     * Set all accessible attributes onto the peer elements from the model's stored data objects
     * @private
     *
     * @param {Object} [a11yOptions] - these can override the values of the node, see this.update()
     */
    onAttributeChange: function( a11yOptions ) {

      for ( var i = 0; i < this.node.accessibleAttributes.length; i++ ) {
        var dataObject = this.node.accessibleAttributes[ i ];
        var attribute = dataObject.attribute;
        var value = dataObject.value;

        // allow overriding of aria-label for accessibleName setter
        // TODO: this is a specific workaround, it would be nice to sort out a general case for this, #795
        // REVIEW: See note in update() above, handling the general case of this seems nice. We're likely to run into
        // REVIEW: other cases in the future.
        // REVIEW: ALSO we run into weird cases right now of "did you update the aria-label attribute or something that
        // REVIEW: ran update() last?" -- the attribute could potentially change unpredictably.
        if ( attribute === 'aria-label' && a11yOptions && typeof a11yOptions.ariaLabel === 'string' && dataObject.options.elementName === PRIMARY_SIBLING ) {
          value = a11yOptions.ariaLabel;
        }
        this.setAttributeToElement( attribute, value, dataObject.options );
      }

      // REVIEW: How are "removed" attributes handled here? Do we never need to worry about it?
    },

    /**
     * Set the input value on the peer's primary sibling element. Using the value setter seems to be the only way
     * to have the value be set correctly so we cannot use onAttributeChange for this.
     * @public (scenery-internal)
     */
    onInputValueChange: function() {
      if ( this.node.inputValue === null ) {
        this.primarySibling.removeAttribute( 'value' );
      }
      else {
        this.primarySibling.value = this.node.inputValue;

      }
    },

    /**
     * Called when our parallel DOM element gets focused.
     * @private
     *
     * @param {DOMEvent} event
     */
    onFocus: function( event ) {
      if ( event.target === this._primarySibling ) {
        // NOTE: The "root" peer can't be focused (so it doesn't matter if it doesn't have a node).
        if ( this.accessibleInstance.node.focusable ) {
          scenery.Display.focus = new Focus( this.accessibleInstance.display, this.accessibleInstance.guessVisualTrail() );
          this.display.pointerFocus = null;
        }
      }
    },

    /**
     * Called when our parallel DOM element gets blurred (loses focus).
     * @private
     *
     * @param {DOMEvent} event
     */
    onBlur: function( event ) {
      if ( event.target === this._primarySibling ) {
        scenery.Display.focus = null;
      }
    },

    /**
     * Get an element on this node, looked up by the elementName flag passed in.
     * @public (scenery-internal)
     *
     * @param {string} elementName - see AccessibilityUtil for valid associations
     * @return {HTMLElement}
     */
    getElementByName: function( elementName ) {
      if ( elementName === AccessiblePeer.PRIMARY_SIBLING ) {
        return this._primarySibling;
      }
      else if ( elementName === AccessiblePeer.LABEL_SIBLING ) {
        return this._labelSibling;
      }
      else if ( elementName === AccessiblePeer.DESCRIPTION_SIBLING ) {
        return this._descriptionSibling;
      }
      else if ( elementName === AccessiblePeer.CONTAINER_PARENT ) {
        return this._containerParent;
      }

      assert && assert( false, 'invalid elementName name: ' + elementName );
    },

    /**
     * Add DOM Event listeners to the peer's primary sibling.
     * @public (scenery-internal)
     *
     * @param {Object} accessibleInput - see Accessibility.addAccessibleInputListener
     */
    addDOMEventListeners: function( accessibleInput ) {
      AccessibilityUtil.addDOMEventListeners( accessibleInput, this._primarySibling );
    },

    /**
     * Remove DOM Event listeners from the peer's primary sibling.
     * @public (scenery-internal)
     * @param {Object} accessibleInput - see Accessibility.addAccessibleInputListener
     */
    removeDOMEventListeners: function( accessibleInput ) {
      AccessibilityUtil.removeDOMEventListeners( accessibleInput, this._primarySibling );
    },

    /**
     * Sets a attribute on one of the peer's HTMLElements.
     * NOTE: If the attributeValue is a boolean, then it will be set as a javascript property on the HTMLElement rather than an attribute
     * @public (scenery-internal)
     * @param {string} attribute
     * @param {*} attributeValue
     * @param {Object} [options]
     */
    setAttributeToElement: function( attribute, attributeValue, options ) {

      options = _.extend( {
        // {string|null} - If non-null, will set the attribute with the specified namespace. This can be required
        // for setting certain attributes (e.g. MathML).
        namespace: null,

        elementName: PRIMARY_SIBLING // see this.getElementName() for valid values, default to the primary sibling
      }, options );

      var element = this.getElementByName( options.elementName );

      if ( options.namespace ) {
        element.setAttributeNS( options.namespace, attribute, attributeValue );
      }
      // treat it like a property
      else if ( typeof attributeValue === 'boolean' ) {
        element[ attribute ] = attributeValue;
      }
      else {
        element.setAttribute( attribute, attributeValue );
      }
    },

    /**
     * Remove attribute from one of the peer's HTMLElements.
     * @public (scenery-internal)
     * @param {string} attribute
     * @param {Object} [options]
     */
    removeAttributeFromElement: function( attribute, options ) {

      options = _.extend( {
        // {string|null} - If non-null, will set the attribute with the specified namespace. This can be required
        // for setting certain attributes (e.g. MathML).
        namespace: null,

        elementName: PRIMARY_SIBLING // see this.getElementName() for valid values, default to the primary sibling
      }, options );

      var element = this.getElementByName( options.elementName );

      if ( options.namespace ) {
        element.removeAttributeNS( options.namespace, attribute );
      }
      else {
        element.removeAttribute( attribute );
      }
    },

    /**
     * Remove the given attribute from all peer elements
     * @public (scenery-internal)
     * @param {string} attribute
     */
    removeAttributeFromAllElements: function( attribute ) {
      assert && assert( typeof attribute === 'string' );
      this._primarySibling && this._primarySibling.removeAttribute( attribute );
      this._labelSibling && this._labelSibling.removeAttribute( attribute );
      this._descriptionSibling && this._descriptionSibling.removeAttribute( attribute );
      this._containerParent && this._containerParent.removeAttribute( attribute );
    },

    /**
     * Set either association attribute (aria-labelledby/describedby) on one of this peer's Elements
     * @public (scenery-internal)
     * @param {string} attribute - either aria-labelledby or aria-describedby
     * @param {Object} associationObject - see addAriaLabelledbyAssociation() for schema
     */
    setAssociationAttribute: function( attribute, associationObject ) {
      assert && assert( attribute === 'aria-labelledby' || attribute === 'aria-describedby',
        'unsupported attribute for setting with association object: ' + attribute );
      assert && AccessibilityUtil.validateAssociationObject( associationObject );

      var otherNodeAccessibleInstances = associationObject.otherNode.getAccessibleInstances();

      // If the other node hasn't been added to the scene graph yet, it won't have any accessible instances, so no op.
      // This will be recalculated when that node is added to the scene graph
      if ( otherNodeAccessibleInstances.length > 0 ) {

        // We are just using the first AccessibleInstance for simplicity, but it is OK because the accessible
        // content for all AccessibleInstances will be the same, so the Accessible Names (in the browser's
        // accessibility tree) of elements that are referenced by the attribute value id will all have the same content
        var firstAccessibleInstance = otherNodeAccessibleInstances[ 0 ];

        // Handle a case where you are associating to yourself, and the peer has not been constructed yet.
        if ( firstAccessibleInstance === this.accessibleInstance ) {
          firstAccessibleInstance.peer = this;
        }

        assert && assert( firstAccessibleInstance.peer, 'peer should exist' );

        // we can use the same element's id to update all of this Node's peers
        var otherPeerElement = firstAccessibleInstance.peer.getElementByName( associationObject.otherElementName );

        var element = this.getElementByName( associationObject.thisElementName );

        // to support any option order, no-op if the peer element has not been created yet.
        if ( element && otherPeerElement ) {

          // only update associations if the requested peer element has been created
          // NOTE: in the future, we would like to verify that the association exists but can't do that yet because
          // we have to support cases where we set label association prior to setting the sibling/parent tagName
          var previousAttributeValue = element.getAttribute( attribute ) || '';
          assert && assert( typeof previousAttributeValue === 'string' );

          var newAttributeValue = [ previousAttributeValue.trim(), otherPeerElement.id ].join( ' ' ).trim();

          // add the id from the new association to the value of the HTMLElement's attribute.
          this.setAttributeToElement( attribute, newAttributeValue, {
            elementName: associationObject.thisElementName
          } );
        }
      }
    },

    /**
     * The contentElement will either be a label or description element. The contentElement will be sorted relative to
     * the primarySibling. Its placement will also depend on whether or not this node wants to append this element,
     * see setAppendLabel() and setAppendDescription(). By default, the "content" element will be placed before the
     * primarySibling.
     * @private
     *
     * @param {HTMLElement} contentElement
     * @param {boolean} appendElement
     */
    arrangeContentElement: function( contentElement, appendElement ) {

      // if there is a containerParent
      if ( this.topLevelElements[ 0 ] === this._containerParent ) {
        assert && assert( this.topLevelElements.length === 1 );

        if ( appendElement ) {
          this._containerParent.appendChild( contentElement );
        }
        else {
          this._containerParent.insertBefore( contentElement, this._primarySibling );
        }
      }

      // If there are multiple top level nodes
      else {
        assert && assert( this.topLevelElements.indexOf( contentElement ) >= 0, 'element is not part of this peer, thus cannot be arranged' );

        // keep this.topLevelElements in sync
        // REVIEW: PHET_CORE/arrayRemove could help?
        this.topLevelElements.splice( this.topLevelElements.indexOf( contentElement ), 1 );

        var indexOffset = appendElement ? 1 : 0;
        var indexOfContentElement = this.topLevelElements.indexOf( this._primarySibling ) + indexOffset;
        // REVIEW: I'm confused, how could this come up? If the primarySibling was not found?
        indexOfContentElement = indexOfContentElement < 0 ? 0 : indexOfContentElement; //support primarySibling in the first position
        this.topLevelElements.splice( indexOfContentElement, 0, contentElement );
      }
    },

    /**
     * Is this peer hidden in the PDOM
     * @public
     *
     * @returns {boolean}
     */
    isVisible: function() {
      if ( assert ) {

        var visibleElements = 0;
        this.topLevelElements.forEach( function( element ) {

          // support property or attribute
          if ( !element.hidden && !element.hasAttribute( 'hidden' ) ) {
            visibleElements += 1;
          }
        } );
        assert( this.visible ? visibleElements === this.topLevelElements.length : visibleElements === 0,
          'some of the peer\'s elements are visible and some are not' );

      }
      return this.visible === null ? true : this.visible; // default to true if visibility hasn't been set yet.
    },

    /**
     * Set whether or not the peer is visible in the PDOM
     * @public
     *
     * @param {boolean} visible
     */
    setVisible: function( visible ) {
      assert && assert( typeof visible === 'boolean' );
      if ( this.visible !== visible ) {

        this.visible = visible;
        for ( var i = 0; i < this.topLevelElements.length; i++ ) {
          var element = this.topLevelElements[ i ];
          if ( visible ) {
            element.removeAttribute( 'hidden' );
          }
          else {
            element.setAttribute( 'hidden', '' );
          }
        }

        // invalidate CSS transforms because when 'hidden' the content will have no dimensions in the viewport, see 
        // updateCSSTransforms
        this.invalidateCSSTransforms();
      }
    },

    /**
     * Returns if this peer is focused. A peer is focused if its primarySibling is focused.
     * @public (scenery-internal)
     * @returns {boolean}
     */
    isFocused: function() {
      return document.activeElement === this._primarySibling;
    },

    /**
     * Focus the primary sibling of the peer.
     * @public (scenery-internal)
     */
    focus: function() {
      assert && assert( this._primarySibling, 'must have a primary sibling to focus' );
      this._primarySibling.focus();
    },

    /**
     * Blur the primary sibling of the peer.
     * @public (scenery-internal)
     */
    blur: function() {
      assert && assert( this._primarySibling, 'must have a primary sibling to blur' );
      this._primarySibling.blur();
    },

    /**
     * Responsible for setting the content for the label sibling
     * @public (scenery-internal)
     * @param {string} content - the content for the label sibling.
     */
    setLabelSiblingContent: function( content ) {
      assert && assert( typeof content === 'string', 'incorrect label content type' );

      // no-op to support any option order
      if ( !this._labelSibling ) {
        return;
      }

      AccessibilityUtil.setTextContent( this._labelSibling, content );

      // if the label element happens to be a 'label', associate with 'for' attribute
      // REVIEW: Should we check _labelTagName directly? Or use a behavior-like strategy for this?
      if ( this._labelSibling.tagName.toUpperCase() === LABEL_TAG ) {
        this._labelSibling.setAttribute( 'for', this._primarySibling.id );
      }
    },

    /**
     * Responsible for setting the content for the description sibling
     * @public (scenery-internal)
     * @param {string} content - the content for the description sibling.
     */
    setDescriptionSiblingContent: function( content ) {
      assert && assert( typeof content === 'string', 'incorrect description content type' );

      // no-op to support any option order
      if ( !this._descriptionSibling ) {
        return;
      }
      AccessibilityUtil.setTextContent( this._descriptionSibling, content );
    },

    /**
     * Responsible for setting the content for the primary sibling
     * @public (scenery-internal)
     * @param {string} content - the content for the primary sibling.
     */
    setPrimarySiblingContent: function( content ) {
      assert && assert( typeof content === 'string', 'incorrect inner content type' );
      assert && assert( this.accessibleInstance.children.length === 0, 'descendants exist with accessible content, innerContent cannot be used' );
      assert && assert( AccessibilityUtil.tagNameSupportsContent( this._primarySibling.tagName ),
        'tagName: ' + this._tagName + ' does not support inner content' );

      // no-op to support any option order
      if ( !this._primarySibling ) {
        return;
      }
      AccessibilityUtil.setTextContent( this._primarySibling, content );
    },

    /**
     * Mark that this AccessiblePeer has a transform that needs to be updated in the next animation frame. Does nothing
     * if the transform has already been marked as dirty.
     * 
     * @private
     */
    invalidateCSSTransforms: function() {
      if ( !this.transformDirty ) {

        // mar that this instance needs to be updated
        this.transformDirty = true;

        // mark all ancestors to indicate that this instance will require an update to CSS transforms, so that we
        // can find this AccessiblePeer in Display.updateDisplay
        var parent = this.accessibleInstance.parent;
        while ( parent ) {
          parent.peer.descendantTransformDirty = true;
          parent = parent.parent;
        }
      }
    },

    /**
     * Update the CSS transform of the primary element.
     */
    updateCSSTransforms: function() {
      assert && assert( window.phet && phet.chipper.queryParameters.mobileA11yTest, 'should only be hit when testing' );
      assert && assert( this.primarySibling, 'a primary sibling should be defined to receive a transform' );

      // CSS transformation only needs to be applied if the node is focusable - otherwise, the element will be found
      // by gesture navigation with the virtual cursor. Bounds for non-focusable elements in the Viewport don't need to
      // be accurate because the AT doesn't need send events to them.
      if ( this.node.focusable ) {

        var localBounds = this.node.localBounds;

        if ( localBounds.isFinite() ) {
          var localToGlobalMatrix = this.node.getLocalToGlobalMatrix();
          var globalBounds = localBounds.transformed( localToGlobalMatrix );
          var nodeScaleVector = this.node.getScaleVector();

          var primaryBounds = getClientBounds( this.primarySibling );
          var primaryWidth = primaryBounds.width;
          var primaryHeight = primaryBounds.height;

          if ( primaryWidth > 0 && primaryHeight > 0 ) {
            siblingScratchBounds.setMinMax( 0, 0, primaryWidth, primaryHeight );
            
            // calculate the matrix that would transform the sibling into the global coordinate frame, and set as bounds
            // so that we can use it to set the dimensions with css
            var primaryMatrix = getCSSMatrix( this.primarySibling, primaryWidth, primaryHeight, globalBounds, nodeScaleVector );
            siblingScratchBounds.transform( primaryMatrix );

            // apply CSS
            this.primarySibling.style.top = siblingScratchBounds.top + 'px';
            this.primarySibling.style.left = siblingScratchBounds.left + 'px';
            this.primarySibling.style.width = siblingScratchBounds.width + 'px';
            this.primarySibling.style.height = siblingScratchBounds.height + 'px';
          }

          if ( this.labelSibling ) {

            // If there is a label sibling, it needs to be transformed as well because VoiceOver will include its
            // bounding rectangle in its calculation to determine where to send the fake pointer event after a click
            // gesture. However, if the label overlaps the focusable element, the element becomes un-touchable with
            // VO touch navigation. So we add an extra transform to shift the label out of the way This is a workaround,
            // but other CSS attributes like zIndex, visibility, hidden, and other things haven't been able to get this
            // to work otherwise.
            var labelBounds = getClientBounds( this.labelSibling );
            var labelWidth = labelBounds.width;
            var labelHeight = labelBounds.height;

            if ( labelHeight > 0 && labelWidth > 0 ) {

              // calculate the matrix that would transform the label and shift it out of the way
              var labelMatrix = getCSSMatrix( this.labelSibling, labelWidth, labelHeight, globalBounds, nodeScaleVector );
              labelTranslationMatrix.setToTranslation( labelWidth / 2, labelHeight );
              labelMatrix.multiplyMatrix( labelTranslationMatrix ).multiplyMatrix( LABEL_SCALING_MATRIX );

              // transform scratch bounds that will position the element
              siblingScratchBounds.setMinMax( 0, 0, labelWidth, labelHeight );
              siblingScratchBounds.transform( labelMatrix );

              // apply CSS
              this.labelSibling.style.top = siblingScratchBounds.top + 'px';
              this.labelSibling.style.left = siblingScratchBounds.left + 'px';
              this.labelSibling.style.width = siblingScratchBounds.width + 'px';
              this.labelSibling.style.height = siblingScratchBounds.height + 'px';
            }
          }
        }
      }
      else {

        // otherwise, just make sure the element is off screen (but doesn't impact other transformations)
        AccessibilityUtil.hideElement( this.primarySibling );
        this.labelSibling && AccessibilityUtil.hideElement( this.labelSibling );
      }
    },

    /**
     * Removes external references from this peer, and places it in the pool.
     * @public (scenery-internal)
     */
    dispose: function() {
      this.disposed = true;

      // remove focus if the disposed peer currently has a focus highlight
      if ( scenery.Display.focus &&
           scenery.Display.focus.trail &&
           scenery.Display.focus.trail.equals( this.trail ) ) {

        scenery.Display.focus = null;
      }

      // remove listeners
      this._primarySibling.removeEventListener( 'blur', this.blurEventListener );
      this._primarySibling.removeEventListener( 'focus', this.focusEventListener );
      this._primarySibling.removeEventListener( 'pointerdown', this.pointerDownListener );
      this.transformTracker.removeListener( this.transformListener );
      this._primaryObserver.disconnect();

      // zero-out references
      this.accessibleInstance = null;
      this.node = null;
      this.display = null;
      this.trail = null;
      this._primarySibling = null;
      this._labelSibling = null;
      this._descriptionSibling = null;
      this._containerParent = null;

      // for now
      this.freeToPool();
    }
  }, {

    // @public {string} - specifies valid associations between related AccessiblePeers in the DOM
    PRIMARY_SIBLING: PRIMARY_SIBLING, // associate with all accessible content related to this peer
    LABEL_SIBLING: LABEL_SIBLING, // associate with just the label content of this peer
    DESCRIPTION_SIBLING: DESCRIPTION_SIBLING, // associate with just the description content of this peer
    CONTAINER_PARENT: CONTAINER_PARENT // associate with everything under the container parent of this peer
  } );

  // Set up pooling
  Poolable.mixInto( AccessiblePeer, {
    initalize: AccessiblePeer.prototype.initializeAccessiblePeer
  } );

  //--------------------------------------------------------------------------
  // Helper functions
  //--------------------------------------------------------------------------

  /**
   * Gets an object with the width and height of an HTML element in pixels, prior to any scaling. clientWidth and
   * clientHeight are zero for elements with inline layout and elemetns without CSS. For those elements we fall back
   * to the boundingClientRect, which at that point will describe the dimensions of the element prior to scaling.
   * 
   * @param  {HTMLElement} siblingElement
   * @return {Object} - Returns an object with two entries, { width: {number}, height: {number} }
   */
  function getClientBounds( siblingElement ) {
    var clientWidth = siblingElement.clientWidth;
    var clientHeight = siblingElement.clientHeight;

    if ( clientWidth === 0 && clientHeight === 0 ) {
      clientWidth = siblingElement.getBoundingClientRect().width;
      clientHeight = siblingElement.getBoundingClientRect().height;
    }

    return { width: clientWidth, height: clientHeight };
  }

  /**
   * Get a matrix that can be used as the CSS transform for elements in the DOM.
   * @param  {HTMLElement} element - the element to receive the CSS transform
   * @param  {number} clientWidth - width of the element to transform in pixels
   * @param  {number} clientHeight - height of the element to transform in pixels
   * @param  {Bounds2} globalBounds - Bounds of the AccessiblePeer's node in the global coordinate frame.
   * @param  {Vector2} scaleVector - the scale magnitude Vector for the Node.
   * @return {Matrix3}
   */
  function getCSSMatrix( element, clientWidth, clientHeight, globalBounds, scaleVector ) {

    // inefficient version, can potentially combine later to not create extra matrices that aren't used
    // the translation matrix for the node's bounds in its local coordinate frame
    globalNodeTranslationMatrix.setToTranslation( globalBounds.minX, globalBounds.minY );

    // scale matrix for "client" HTML element, scale to make the HTML element's DOM bounds match the
    // local bounds of the node
    globalToClientScaleMatrix.setToScale( globalBounds.width / clientWidth, globalBounds.height / clientHeight );
    nodeScaleMagnitudeMatrix.setToScale( scaleVector.x, scaleVector.y );

    // combine these two in a single transformation matrix
    return globalNodeTranslationMatrix.multiplyMatrix( globalToClientScaleMatrix ).multiplyMatrix( nodeScaleMagnitudeMatrix );
  }

  return AccessiblePeer;
} );

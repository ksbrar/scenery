// Copyright 2013-2015, University of Colorado Boulder

/**
 * Text
 *
 * TODO: newlines (multiline)
 * TODO: don't get bounds until the Text node is fully mutated?
 *
 * Useful specs:
 * http://www.w3.org/TR/css3-text/
 * http://www.w3.org/TR/css3-fonts/
 * http://www.w3.org/TR/SVG/text.html
 *
 * @author Jonathan Olson <jonathan.olson@colorado.edu>
 */

define( function( require ) {
  'use strict';

  var inherit = require( 'PHET_CORE/inherit' );
  var escapeHTML = require( 'PHET_CORE/escapeHTML' );
  var platform = require( 'PHET_CORE/platform' );
  var Bounds2 = require( 'DOT/Bounds2' );
  var Matrix3 = require( 'DOT/Matrix3' );

  var scenery = require( 'SCENERY/scenery' );

  var Node = require( 'SCENERY/nodes/Node' ); // inherits from Node
  var Renderer = require( 'SCENERY/display/Renderer' );
  var Paintable = require( 'SCENERY/nodes/Paintable' );
  require( 'SCENERY/util/Font' );
  require( 'SCENERY/util/Util' ); // for canvasAccurateBounds and CSS transforms
  require( 'SCENERY/util/CanvasContextWrapper' );
  var DOMSelfDrawable = require( 'SCENERY/display/DOMSelfDrawable' );
  var SVGSelfDrawable = require( 'SCENERY/display/SVGSelfDrawable' );
  var CanvasSelfDrawable = require( 'SCENERY/display/CanvasSelfDrawable' );
  var SelfDrawable = require( 'SCENERY/display/SelfDrawable' );
  var WebGLSelfDrawable = require( 'SCENERY/display/WebGLSelfDrawable' );

  // TODO: change this based on memory and performance characteristics of the platform
  var keepDOMTextElements = true; // whether we should pool DOM elements for the DOM rendering states, or whether we should free them when possible for memory
  var keepSVGTextElements = true; // whether we should pool SVG elements for the SVG rendering states, or whether we should free them when possible for memory

  // scratch matrix used in DOM rendering
  var scratchMatrix = Matrix3.dirtyFromPool();

  var textSizeContainerId = 'sceneryTextSizeContainer';
  var textSizeElementId = 'sceneryTextSizeElement';
  var svgTextSizeContainer = document.getElementById( textSizeContainerId );
  var svgTextSizeElement = document.getElementById( textSizeElementId );

  // SVG bounds seems to be malfunctioning for Safari 5. Since we don't have a reproducible test machine for
  // fast iteration, we'll guess the user agent and use DOM bounds instead of SVG.
  // Hopefully the two contraints rule out any future Safari versions (fairly safe, but not impossible!)
  var useDOMAsFastBounds = window.navigator.userAgent.indexOf( 'like Gecko) Version/5' ) !== -1 &&
                           window.navigator.userAgent.indexOf( 'Safari/' ) !== -1;

  var hybridTextNode; // a node that is used to measure SVG text top/height for hybrid caching purposes
  var initializingHybridTextNode = false;

  // Some browsers (IE/Edge) can't handle our UTF-8 embedding marks AND SVG textLength/spacingAndGlyphs. We disable
  // using these features, because they aren't necessary on these browsers.
  // See https://github.com/phetsims/scenery/issues/455 for more information.
  var useSVGTextLengthAdjustments = !platform.ie && !platform.edge;

  // Maps CSS {string} => {Bounds2}, so that we can cache the vertical font sizes outside of the Font objects themselves.
  var hybridFontVerticalCache = {};

  function Text( text, options ) {
    this._text = '';                   // filled in with mutator
    this._font = scenery.Font.DEFAULT; // default font, usually 10px sans-serif
    this._direction = 'ltr';           // ltr, rtl, inherit -- consider inherit deprecated, due to how we compute text bounds in an off-screen canvas
    this._boundsMethod = 'hybrid';     // fast (SVG/DOM, no canvas rendering allowed), fastCanvas (SVG/DOM, canvas rendering allowed without dirty regions),
    // accurate (Canvas accurate recursive), or hybrid (cache SVG height, use canvas measureText for width)

    // whether the text is rendered as HTML or not. if defined (in a subtype constructor), use that value instead
    this._isHTML = this._isHTML === undefined ? false : this._isHTML;

    // {null|string} - The actual string displayed (can have non-breaking spaces and embedding marks rewritten).
    // When this is null, its value needs to be recomputed
    this._cachedRenderedText = null;

    // ensure we have a parameter object
    options = options || {};

    // default to black filled text
    if ( options.fill === undefined ) {
      options.fill = '#000000';
    }

    if ( text !== undefined ) {
      // set the text parameter so that setText( text ) is effectively called in the mutator from the super call
      options.text = text;
    }

    this.initializePaintable();

    Node.call( this, options );
    this.updateTextFlags(); // takes care of setting up supported renderers
  }

  scenery.register( 'Text', Text );

  inherit( Node, Text, {
    /**
     * {Array.<string>} - String keys for all of the allowed options that will be set by node.mutate( options ), in the
     * order they will be evaluated in.
     * @protected
     *
     * NOTE: See Node's _mutatorKeys documentation for more information on how this operates, and potential special
     *       cases that may apply.
     */
    _mutatorKeys: [ 'boundsMethod', 'text', 'font', 'fontWeight', 'fontFamily', 'fontStretch', 'fontStyle', 'fontSize',
                    'lineHeight', 'direction' ].concat( Node.prototype._mutatorKeys ),

    /**
     * {Array.<String>} - List of all dirty flags that should be available on drawables created from this node (or
     *                    subtype). Given a flag (e.g. radius), it indicates the existence of a function
     *                    drawable.markDirtyRadius() that will indicate to the drawable that the radius has changed.
     * @public (scenery-internal)
     * @override
     */
    drawableMarkFlags: Node.prototype.drawableMarkFlags.concat( [ 'text', 'font', 'bounds', 'direction' ] ),

    domUpdateTransformOnRepaint: true, // since we have to integrate the baseline offset into the CSS transform, signal to DOMLayer

    // TODO: documentation!
    setText: function( text ) {
      assert && assert( text !== null && text !== undefined, 'Text should be defined and non-null. Use the empty string if needed.' );

      // cast it to a string (for numbers, etc., and do it before the change guard so we don't accidentally trigger on non-changed text)
      text = '' + text;

      if ( text !== this._text ) {
        var oldText = this._text;
        this._text = text;
        this._cachedRenderedText = null;

        var stateLen = this._drawables.length;
        for ( var i = 0; i < stateLen; i++ ) {
          this._drawables[ i ].markDirtyText();
        }

        this.invalidateText();
        this.trigger2( 'text', oldText, text );
      }
      return this;
    },

    getText: function() {
      return this._text;
    },

    /**
     * Returns a potentially modified version of this.text, where spaces are replaced with non-breaking spaces,
     * and embedding marks are potentially simplified.
     * @public
     *
     * @returns {string}
     */
    getRenderedText: function() {
      if ( this._cachedRenderedText === null ) {
        // Using the non-breaking space (&nbsp;) encoded as 0x00A0 in UTF-8
        this._cachedRenderedText = this._text.replace( ' ', '\xA0' );

        if ( platform.edge ) {
          // Simplify embedding marks to work around an Edge bug, see https://github.com/phetsims/scenery/issues/520
          this._cachedRenderedText = Text.simplifyEmbeddingMarks( this._cachedRenderedText );
        }
      }

      return this._cachedRenderedText;
    },
    get renderedText() { return this.getRenderedText(); },

    setBoundsMethod: function( method ) {
      assert && assert( method === 'fast' || method === 'fastCanvas' || method === 'accurate' || method === 'hybrid', 'Unknown Text boundsMethod' );
      if ( method !== this._boundsMethod ) {
        this._boundsMethod = method;
        this.updateTextFlags();

        var stateLen = this._drawables.length;
        for ( var i = 0; i < stateLen; i++ ) {
          this._drawables[ i ].markDirtyBounds();
        }

        this.invalidateText();

        this.trigger0( 'boundsMethod' );

        this.trigger0( 'selfBoundsValid' ); // whether our self bounds are valid may have changed
      }
      return this;
    },

    getBoundsMethod: function() {
      return this._boundsMethod;
    },

    getTextRendererBitmask: function() {
      var bitmask = 0;

      // canvas support (fast bounds may leak out of dirty rectangles)
      if ( this._boundsMethod !== 'fast' && !this._isHTML ) {
        bitmask |= Renderer.bitmaskCanvas;
      }
      if ( !this._isHTML ) {
        bitmask |= Renderer.bitmaskSVG;
      }

      // fill and stroke will determine whether we have DOM text support
      bitmask |= Renderer.bitmaskDOM;

      return bitmask;
    },

    invalidateSupportedRenderers: function() {
      this.setRendererBitmask( this.getFillRendererBitmask() & this.getStrokeRendererBitmask() & this.getTextRendererBitmask() );
    },

    updateTextFlags: function() {
      this.invalidateSupportedRenderers();
    },

    invalidateText: function() {
      this.invalidateSelf();

      // TODO: consider replacing this with a general dirty flag notification, and have DOM update bounds every frame?
      var stateLen = this._drawables.length;
      for ( var i = 0; i < stateLen; i++ ) {
        this._drawables[ i ].markDirtyBounds();
      }

      // we may have changed renderers if parameters were changed!
      this.updateTextFlags();
    },

    /**
     * Computes a more efficient selfBounds for our Text.
     * @protected
     * @override
     *
     * @returns {boolean} - Whether the self bounds changed.
     */
    updateSelfBounds: function() {
      // TODO: don't create another Bounds2 object just for this!
      var selfBounds;

      // investigate http://mudcu.be/journal/2011/01/html5-typographic-metrics/
      if ( this._isHTML || ( useDOMAsFastBounds && this._boundsMethod !== 'accurate' ) ) {
        selfBounds = this.approximateDOMBounds();
      }
      else if ( this._boundsMethod === 'hybrid' ) {
        selfBounds = this.approximateHybridBounds();
      }
      else if ( this._boundsMethod === 'fast' || this._boundsMethod === 'fastCanvas' ) {
        selfBounds = this.approximateSVGBounds();
      }
      else {
        selfBounds = this.accurateCanvasBounds();
      }

      // for now, just add extra on, ignoring the possibility of mitered joints passing beyond
      if ( this.hasStroke() ) {
        selfBounds.dilate( this.getLineWidth() / 2 );
      }

      var changed = !selfBounds.equals( this._selfBounds );
      if ( changed ) {
        this._selfBounds.set( selfBounds );
      }
      return changed;
    },

    /**
     * Called from (and overridden in) the Paintable mixin, invalidates our current stroke, triggering recomputation of
     * anything that depended on the old stroke's value.
     * @protected (scenery-internal)
     */
    invalidateStroke: function() {
      // stroke can change both the bounds and renderer
      this.invalidateText();
    },

    /**
     * Called from (and overridden in) the Paintable mixin, invalidates our current fill, triggering recomputation of
     * anything that depended on the old fill's value.
     * @protected (scenery-internal)
     */
    invalidateFill: function() {
      // fill type can change the renderer (gradient/fill not supported by DOM)
      this.invalidateText();
    },

    /**
     * Draws the current Node's self representation, assuming the wrapper's Canvas context is already in the local
     * coordinate frame of this node.
     * @protected
     * @override
     *
     * @param {CanvasContextWrapper} wrapper
     */
    canvasPaintSelf: function( wrapper ) {
      Text.TextCanvasDrawable.prototype.paintCanvas( wrapper, this );
    },

    /**
     * Creates a DOM drawable for this Text.
     * @public (scenery-internal)
     * @override
     *
     * @param {number} renderer - In the bitmask format specified by Renderer, which may contain additional bit flags.
     * @returns {DOMSelfDrawable}
     */
    createDOMDrawable: function( renderer, instance ) {
      return Text.TextDOMDrawable.createFromPool( renderer, instance );
    },

    /**
     * Creates a SVG drawable for this Text.
     * @public (scenery-internal)
     * @override
     *
     * @param {number} renderer - In the bitmask format specified by Renderer, which may contain additional bit flags.
     * @returns {SVGSelfDrawable}
     */
    createSVGDrawable: function( renderer, instance ) {
      return Text.TextSVGDrawable.createFromPool( renderer, instance );
    },

    /**
     * Creates a Canvas drawable for this Text.
     * @public (scenery-internal)
     * @override
     *
     * @param {number} renderer - In the bitmask format specified by Renderer, which may contain additional bit flags.
     * @returns {CanvasSelfDrawable}
     */
    createCanvasDrawable: function( renderer, instance ) {
      return Text.TextCanvasDrawable.createFromPool( renderer, instance );
    },

    /**
     * Creates a WebGL drawable for this Text.
     * @public (scenery-internal)
     * @override
     *
     * @param {number} renderer - In the bitmask format specified by Renderer, which may contain additional bit flags.
     * @returns {WebGLSelfDrawable}
     */
    createWebGLDrawable: function( renderer, instance ) {
      return Text.TextWebGLDrawable.createFromPool( renderer, instance );
    },

    // a DOM node (not a Scenery DOM node, but an actual DOM node) with the text
    getDOMTextNode: function() {
      if ( this._isHTML ) {
        var span = document.createElement( 'span' );
        span.innerHTML = this._text;
        return span;
      }
      else {
        return document.createTextNode( this.renderedText );
      }
    },

    /*---------------------------------------------------------------------------*
     * Bounds
     *----------------------------------------------------------------------------*/

    getVerticalBounds: function() {
      if ( !hybridTextNode ) {
        return Bounds2.NOTHING; // we are the hybridTextNode, ignore us
      }

      var css = this._font.toCSS();
      var verticalBounds = hybridFontVerticalCache[ css ];
      if ( !verticalBounds ) {
        hybridTextNode.setFont( this._font );
        verticalBounds = hybridFontVerticalCache[ css ] = hybridTextNode.getBounds().copy();
      }

      return verticalBounds;
    },

    accurateCanvasBounds: function() {
      var self = this;
      var svgBounds = this.approximateSVGBounds(); // this seems to be slower than expected, mostly due to Font getters

      //If svgBounds are zero, then return the zero bounds
      if ( !this._text || svgBounds.width === 0 ) {
        return svgBounds;
      }

      // NOTE: should return new instance, so that it can be mutated later
      return scenery.Util.canvasAccurateBounds( function( context ) {
        context.font = self.font;
        context.direction = self.direction;
        context.fillText( self.renderedText, 0, 0 );
        if ( self.hasStroke() ) {
          var fakeWrapper = new scenery.CanvasContextWrapper( null, context );
          self.beforeCanvasStroke( fakeWrapper );
          context.strokeText( self.renderedText, 0, 0 );
          self.afterCanvasStroke( fakeWrapper );
        }
      }, {
        precision: 0.5,
        resolution: 128,
        initialScale: 32 / Math.max( Math.abs( svgBounds.minX ), Math.abs( svgBounds.minY ), Math.abs( svgBounds.maxX ), Math.abs( svgBounds.maxY ) )
      } );
    },

    approximateCanvasWidth: function() {
      var context = scenery.scratchContext;
      context.font = this.font;
      context.direction = this.direction;
      return context.measureText( this.renderedText ).width;
    },

    // NOTE: should return new instance, so that it can be mutated later
    approximateSVGBounds: function() {
      if ( !svgTextSizeContainer.parentNode ) {
        if ( document.body ) {
          document.body.appendChild( svgTextSizeContainer );
        }
        else {
          // TODO: better way to handle the hybridTextNode being added inside the HEAD? Requiring a body for proper operation might be a problem.
          if ( initializingHybridTextNode ) {
            // if this is almost assuredly the hybridTextNode, return nothing for now. TODO: better way of handling this! it's a hack!
            return Bounds2.NOTHING;
          }
          else {
            throw new Error( 'No document.body and trying to get approximate SVG bounds of a Text node' );
          }
        }
      }
      updateSVGTextToMeasure( svgTextSizeElement, this );
      var rect = svgTextSizeElement.getBBox();
      return new Bounds2( rect.x, rect.y, rect.x + rect.width, rect.y + rect.height );
    },

    // NOTE: should return new instance, so that it can be mutated later
    approximateHybridBounds: function() {
      var verticalBounds = this.getVerticalBounds();

      var canvasWidth = this.approximateCanvasWidth();

      // it seems that SVG bounds generally have x=0, so we hard code that here
      return new Bounds2( 0, verticalBounds.minY, canvasWidth, verticalBounds.maxY );
    },

    // NOTE: should return new instance, so that it can be mutated later
    approximateDOMBounds: function() {
      var maxHeight = 1024; // technically this will fail if the font is taller than this!
      var isRTL = this.direction === 'rtl';

      // <div style="position: absolute; left: 0; top: 0; padding: 0 !important; margin: 0 !important;"><span id="baselineSpan" style="font-family: Verdana; font-size: 25px;">QuipTaQiy</span><div style="vertical-align: baseline; display: inline-block; width: 0; height: 500px; margin: 0 important!; padding: 0 important!;"></div></div>

      var div = document.createElement( 'div' );
      $( div ).css( {
        position: 'absolute',
        left: 0,
        top: 0,
        padding: '0 !important',
        margin: '0 !important',
        display: 'hidden'
      } );

      var span = document.createElement( 'span' );
      $( span ).css( 'font', this.getFont() );
      span.appendChild( this.getDOMTextNode() );
      span.setAttribute( 'direction', this._direction );

      var fakeImage = document.createElement( 'div' );
      $( fakeImage ).css( {
        'vertical-align': 'baseline',
        display: 'inline-block',
        width: 0,
        height: maxHeight + 'px',
        margin: '0 !important',
        padding: '0 !important'
      } );

      div.appendChild( span );
      div.appendChild( fakeImage );

      document.body.appendChild( div );
      var rect = span.getBoundingClientRect();
      var divRect = div.getBoundingClientRect();
      // add 1 pixel to rect.right to prevent HTML text wrapping
      var result = new Bounds2( rect.left, rect.top - maxHeight, rect.right + 1, rect.bottom - maxHeight ).shifted( -divRect.left, -divRect.top );
      // console.log( 'result: ' + result );
      document.body.removeChild( div );

      var width = rect.right - rect.left;
      return result.shiftedX( isRTL ? -width : 0 ); // should we even swap here?
    },

    approximateImprovedDOMBounds: function() {
      // TODO: reuse this div?
      var div = document.createElement( 'div' );
      div.style.display = 'inline-block';
      div.style.font = this.getFont();
      div.style.color = 'transparent';
      div.style.padding = '0 !important';
      div.style.margin = '0 !important';
      div.style.position = 'absolute';
      div.style.left = '0';
      div.style.top = '0';
      div.setAttribute( 'direction', this._direction );
      div.appendChild( this.getDOMTextNode() );

      document.body.appendChild( div );
      var bounds = new Bounds2( div.offsetLeft, div.offsetTop, div.offsetLeft + div.offsetWidth + 1, div.offsetTop + div.offsetHeight + 1 );
      document.body.removeChild( div );

      // Compensate for the baseline alignment
      var verticalBounds = this.getVerticalBounds();
      return bounds.shiftedY( verticalBounds.minY );
    },

    // @override from Node
    getSafeSelfBounds: function() {
      var expansionFactor = 1; // we use a new bounding box with a new size of size * ( 1 + 2 * expansionFactor )

      var selfBounds = this.getSelfBounds();

      // NOTE: we'll keep this as an estimate for the bounds including stroke miters
      return selfBounds.dilatedXY( expansionFactor * selfBounds.width, expansionFactor * selfBounds.height );
    },

    /*---------------------------------------------------------------------------*
     * Self setters / getters
     *----------------------------------------------------------------------------*/

    setFont: function( font ) {
      if ( this.font !== font ) {
        this._font = font instanceof scenery.Font ? font : new scenery.Font( font );

        var stateLen = this._drawables.length;
        for ( var i = 0; i < stateLen; i++ ) {
          this._drawables[ i ].markDirtyFont();
        }

        this.invalidateText();
      }
      return this;
    },

    // NOTE: returns mutable copy for now, consider either immutable version, defensive copy, or note about invalidateText()
    getFont: function() {
      return this._font.getFont();
    },

    setDirection: function( direction ) {
      this._direction = direction;

      var stateLen = this._drawables.length;
      for ( var i = 0; i < stateLen; i++ ) {
        this._drawables[ i ].markDirtyDirection();
      }

      this.invalidateText();
      return this;
    },

    getDirection: function() {
      return this._direction;
    },

    /**
     * Whether this Node itself is painted (displays something itself).
     * @public
     * @override
     *
     * @returns {boolean}
     */
    isPainted: function() {
      // Always true for Text nodes
      return true;
    },

    /**
     * Whether this Node's selfBounds are considered to be valid (always containing the displayed self content
     * of this node). Meant to be overridden in subtypes when this can change (e.g. Text).
     * @public
     * @override
     *
     * If this value would potentially change, please trigger the event 'selfBoundsValid'.
     *
     * @returns {boolean}
     */
    areSelfBoundsValid: function() {
      return this._boundsMethod === 'accurate';
    },

    /**
     * Override for extra information in the debugging output (from Display.getDebugHTML()).
     * @protected (scenery-internal)
     * @override
     *
     * @returns {string}
     */
    getDebugHTMLExtras: function() {
      return ' "' + escapeHTML( this.renderedText ) + '"' + ( this._isHTML ? ' (html)' : '' );
    },

    /**
     * Returns a string containing constructor information for Node.string().
     * @protected
     * @override
     *
     * @param {string} propLines - A string representing the options properties that need to be set.
     * @returns {string}
     */
    getBasicConstructor: function( propLines ) {
      return 'new scenery.Text( \'' + escapeHTML( this._text.replace( /'/g, '\\\'' ) ) + '\', {' + propLines + '} )';
    },

    /**
     * Returns the property object string for use with toString().
     * @protected (scenery-internal)
     * @override
     *
     * @param {string} spaces - Whitespace to add
     * @param {boolean} [includeChildren]
     */
    getPropString: function( spaces, includeChildren ) {
      var result = Node.prototype.getPropString.call( this, spaces, includeChildren );
      result = this.appendFillablePropString( spaces, result );
      result = this.appendStrokablePropString( spaces, result );

      // TODO: if created again, deduplicate with Node's getPropString
      function addProp( key, value, nowrap ) {
        if ( result ) {
          result += ',\n';
        }
        if ( !nowrap && typeof value === 'string' ) {
          result += spaces + key + ': \'' + value + '\'';
        }
        else {
          result += spaces + key + ': ' + value;
        }
      }

      if ( this.font !== new scenery.Font().getFont() ) {
        addProp( 'font', this.font.replace( /'/g, '\\\'' ) );
      }

      if ( this._direction !== 'ltr' ) {
        addProp( 'direction', this._direction );
      }

      return result;
    }
  } );

  /*---------------------------------------------------------------------------*
   * Font setters / getters
   *----------------------------------------------------------------------------*/

  function addFontForwarding( propertyName, fullCapitalized, shortUncapitalized ) {
    var getterName = 'get' + fullCapitalized;
    var setterName = 'set' + fullCapitalized;

    Text.prototype[ getterName ] = function() {
      // use the ES5 getter to retrieve the property. probably somewhat slow.
      return this._font[ shortUncapitalized ];
    };

    Text.prototype[ setterName ] = function( value ) {
      // create a full copy of our font instance
      var ob = {};
      ob[ shortUncapitalized ] = value;
      var newFont = this._font.copy( ob );

      // apply the new Font. this should call invalidateText() as normal
      // TODO: do more specific font dirty flags in the future, for how SVG does things
      this.setFont( newFont );
      return this;
    };

    Object.defineProperty( Text.prototype, propertyName, {
      set: Text.prototype[ setterName ],
      get: Text.prototype[ getterName ]
    } );
  }

  addFontForwarding( 'fontWeight', 'FontWeight', 'weight' );
  addFontForwarding( 'fontFamily', 'FontFamily', 'family' );
  addFontForwarding( 'fontStretch', 'FontStretch', 'stretch' );
  addFontForwarding( 'fontStyle', 'FontStyle', 'style' );
  addFontForwarding( 'fontSize', 'FontSize', 'size' );
  addFontForwarding( 'lineHeight', 'LineHeight', 'lineHeight' );

  // font-specific ES5 setters and getters are defined using addFontForwarding above
  Object.defineProperty( Text.prototype, 'font', { set: Text.prototype.setFont, get: Text.prototype.getFont } );
  Object.defineProperty( Text.prototype, 'text', { set: Text.prototype.setText, get: Text.prototype.getText } );
  Object.defineProperty( Text.prototype, 'direction', {
    set: Text.prototype.setDirection,
    get: Text.prototype.getDirection
  } );
  Object.defineProperty( Text.prototype, 'boundsMethod', {
    set: Text.prototype.setBoundsMethod,
    get: Text.prototype.getBoundsMethod
  } );

  // mix in support for fills and strokes
  Paintable.mixin( Text );

  /*---------------------------------------------------------------------------*
   * Unicode embedding marks workaround for https://github.com/phetsims/scenery/issues/520
   *----------------------------------------------------------------------------*/

  // Unicode embedding marks that we can combine to work around the Edge issue
  var LTR = '\u202a';
  var RTL = '\u202b';
  var POP = '\u202c';

  /**
   * Replaces embedding mark characters with visible strings. Useful for debugging for strings with embedding marks.
   * @public
   *
   * @param {string} string
   * @returns {string} - With embedding marks replaced.
   */
  Text.embeddedDebugString = function( string ) {
    return string.replace( /\u202a/g, '[LTR]' ).replace( /\u202b/g, '[RTL]' ).replace( /\u202c/g, '[POP]' );
  };

  /**
   * Returns a (potentially) modified string where embedding marks have been simplified.
   * @public
   *
   * This simplification wouldn't usually be necessary, but we need to prevent cases like
   * https://github.com/phetsims/scenery/issues/520 where Edge decides to turn [POP][LTR] (after another [LTR]) into
   * a 'box' character, when nothing should be rendered.
   *
   * This will remove redundant nesting:
   *   e.g. [LTR][LTR]boo[POP][POP] => [LTR]boo[POP])
   * and will also combine adjacent directions:
   *   e.g. [LTR]Mail[POP][LTR]Man[POP] => [LTR]MailMan[Pop]
   *
   * Note that it will NOT combine in this way if there was a space between the two LTRs:
   *   e.g. [LTR]Mail[POP] [LTR]Man[Pop])
   * as in the general case, we'll want to preserve the break there between embeddings.
   *
   * TODO: A stack-based implementation that doesn't create a bunch of objects/closures would be nice for performance.
   *
   * @param {string} string
   * @returns {string}
   */
  Text.simplifyEmbeddingMarks = function( string ) {
    // First, we'll convert the string into a tree form, where each node is either a string object OR an object of the
    // node type { dir: {LTR||RTL}, children: {Array.<node>}, parent: {null|node} }. Thus each LTR...POP and RTL...POP
    // become a node with their interiors becoming children.

    // Root node (no direction, so we preserve root LTR/RTLs)
    var root = {
      dir: null,
      children: [],
      parent: null
    };
    var current = root;
    for ( var i = 0; i < string.length; i++ ) {
      var chr = string.charAt( i );

      // Push a direction
      if ( chr === LTR || chr === RTL ) {
        var node = {
          dir: chr,
          children: [],
          parent: current
        };
        current.children.push( node );
        current = node;
      }
      // Pop a direction
      else if ( chr === POP ) {
        assert && assert( current.parent, 'Bad nesting of embedding marks: ' + Text.embeddedDebugString( string ) );
        current = current.parent;
      }
      // Append characters to the current direction
      else {
        current.children.push( chr );
      }
    }
    assert && assert( current === root, 'Bad nesting of embedding marks: ' + Text.embeddedDebugString( string ) );

    // Remove redundant nesting (e.g. [LTR][LTR]...[POP][POP])
    function collapseNesting( node ) {
      for ( var i = node.children.length - 1; i >= 0; i-- ) {
        var child = node.children[ i ];
        if ( node.dir === child.dir ) {
          Array.prototype.splice.apply( node.children, [ i, 1 ].concat( child.children ) );
        }
      }
    }

    // Remove overridden nesting (e.g. [LTR][RTL]...[POP][POP]), since the outer one is not needed
    function collapseUnnecessary( node ) {
      if ( node.children.length === 1 && node.children[ 0 ].dir ) {
        node.dir = node.children[ 0 ].dir;
        node.children = node.children[ 0 ].children;
      }
    }

    // Collapse adjacent matching dirs, e.g. [LTR]...[POP][LTR]...[POP]
    function collapseAdjacent( node ) {
      for ( var i = node.children.length - 1; i >= 1; i-- ) {
        var previousChild = node.children[ i - 1 ];
        var child = node.children[ i ];
        if ( child.dir && previousChild.dir === child.dir ) {
          previousChild.children = previousChild.children.concat( child.children );
          node.children.splice( i, 1 );

          // Now try to collapse adjacent items in the child, since we combined children arrays
          collapseAdjacent( previousChild );
        }
      }
    }

    // Simplifies the tree using the above functions
    function simplify( node ) {
      if ( typeof node === 'string' ) {
        return;
      }

      for ( var i = 0; i < node.children.length; i++ ) {
        simplify( node.children[ i ] );
      }

      collapseUnnecessary( node );
      collapseNesting( node );
      collapseAdjacent( node );

      return node;
    }

    // Turns a tree into a string
    function stringify( node ) {
      if ( typeof node === 'string' ) {
        return node;
      }
      var childString = node.children.map( stringify ).join( '' );
      if ( node.dir ) {
        return node.dir + childString + '\u202c';
      }
      else {
        return childString;
      }
    }

    return stringify( simplify( root ) );
  };

  /*---------------------------------------------------------------------------*
   * Rendering State mixin (DOM/SVG)
   *----------------------------------------------------------------------------*/

  /**
   * A mixin to drawables for Text that need to store state about what the current display is currently showing,
   * so that updates to the Text will only be made on attributes that specifically changed (and no change will be
   * necessary for an attribute that changed back to its original/currently-displayed value). Generally, this is used
   * for DOM and SVG drawables.
   */
  Text.TextStatefulDrawable = {
    /**
     * Given the type (constructor) of a drawable, we'll mix in a combination of:
     * - initialization/disposal with the *State suffix
     * - mark* methods to be called on all drawables of nodes of this type, that set specific dirty flags
     *
     * This will allow drawables that mix in this type to do the following during an update:
     * 1. Check specific dirty flags (e.g. if the fill changed, update the fill of our SVG element).
     * 2. Call setToCleanState() once done, to clear the dirty flags.
     *
     * @param {function} drawableType - The constructor for the drawable type
     */
    mixin: function( drawableType ) {
      var proto = drawableType.prototype;

      /**
       * Initializes the stateful mixin state, starting its "lifetime" until it is disposed with disposeState().
       * @protected
       *
       * @param {number} renderer - Renderer bitmask, see Renderer's documentation for more details.
       * @param {Instance} instance
       * @returns {TextStatefulDrawable} - Returns 'this' reference, for chaining
       */
      proto.initializeState = function( renderer, instance ) {
        // @protected {boolean} - Flag marked as true if ANY of the drawable dirty flags are set (basically everything except for transforms, as we
        //                        need to accelerate the transform case.
        this.paintDirty = true;
        this.dirtyText = true;
        this.dirtyFont = true;
        this.dirtyBounds = true;
        this.dirtyDirection = true;

        // After adding flags, we'll initialize the mixed-in PaintableStateful state.
        this.initializePaintableState( renderer, instance );

        return this; // allow for chaining
      };

      /**
       * Disposes the stateful mixin state, so it can be put into the pool to be initialized again.
       * @protected
       */
      proto.disposeState = function() {
        this.disposePaintableState();
      };

      /**
       * A "catch-all" dirty method that directly marks the paintDirty flag and triggers propagation of dirty
       * information. This can be used by other mark* methods, or directly itself if the paintDirty flag is checked.
       * @public (scenery-internal)
       *
       * It should be fired (indirectly or directly) for anything besides transforms that needs to make a drawable
       * dirty.
       */
      proto.markPaintDirty = function() {
        this.paintDirty = true;
        this.markDirty();
      };

      proto.markDirtyText = function() {
        this.dirtyText = true;
        this.markPaintDirty();
      };
      proto.markDirtyFont = function() {
        this.dirtyFont = true;
        this.markPaintDirty();
      };
      proto.markDirtyBounds = function() {
        this.dirtyBounds = true;
        this.markPaintDirty();
      };
      proto.markDirtyDirection = function() {
        this.dirtyDirection = true;
        this.markPaintDirty();
      };

      /**
       * Clears all of the dirty flags (after they have been checked), so that future mark* methods will be able to flag them again.
       * @public (scenery-internal)
       */
      proto.setToCleanState = function() {
        this.paintDirty = false;
        this.dirtyText = false;
        this.dirtyFont = false;
        this.dirtyBounds = false;
        this.dirtyDirection = false;
      };

      Paintable.PaintableStatefulDrawable.mixin( drawableType );
    }
  };

  /*---------------------------------------------------------------------------*
   * DOM rendering
   *----------------------------------------------------------------------------*/

  /**
   * A generated DOMSelfDrawable whose purpose will be drawing our Text node. One of these drawables will be created
   * for each displayed instance of a Text node.
   * @constructor
   *
   * @param {number} renderer - Renderer bitmask, see Renderer's documentation for more details.
   * @param {Instance} instance
   */
  Text.TextDOMDrawable = function TextDOMDrawable( renderer, instance ) {
    this.initialize( renderer, instance );
  };
  inherit( DOMSelfDrawable, Text.TextDOMDrawable, {
    /**
     * Initializes this drawable, starting its "lifetime" until it is disposed. This lifecycle can happen multiple
     * times, with instances generally created by the SelfDrawable.Poolable mixin (dirtyFromPool/createFromPool), and
     * disposal will return this drawable to the pool.
     * @private
     *
     * This acts as a pseudo-constructor that can be called multiple times, and effectively creates/resets the state
     * of the drawable to the initial state.
     *
     * @param {number} renderer - Renderer bitmask, see Renderer's documentation for more details.
     * @param {Instance} instance
     * @returns {TextDOMDrawable} - Returns 'this' reference, for chaining
     */
    initialize: function( renderer, instance ) {
      // Super-type initialization
      this.initializeDOMSelfDrawable( renderer, instance );

      // Stateful mix-in initialization
      this.initializeState( renderer, instance );

      // only create elements if we don't already have them (we pool visual states always, and depending on the platform may also pool the actual elements to minimize
      // allocation and performance costs)
      if ( !this.domElement ) {
        this.domElement = document.createElement( 'div' );
        this.domElement.style.display = 'block';
        this.domElement.style.position = 'absolute';
        this.domElement.style.pointerEvents = 'none';
        this.domElement.style.left = '0';
        this.domElement.style.top = '0';
      }

      // Apply CSS needed for future CSS transforms to work properly.
      scenery.Util.prepareForTransform( this.domElement, this.forceAcceleration );

      return this; // allow for chaining
    },

    /**
     * Updates our DOM element so that its appearance matches our node's representation.
     * @protected
     *
     * This implements part of the DOMSelfDrawable required API for subtypes.
     */
    updateDOM: function() {
      var node = this.node;

      var div = this.domElement;

      if ( this.paintDirty ) {
        if ( this.dirtyFont ) {
          div.style.font = node.getFont();
        }
        if ( this.dirtyStroke ) {
          div.style.color = node.getCSSFill();
        }
        if ( this.dirtyBounds ) { // TODO: this condition is set on invalidateText, so it's almost always true?
          div.style.width = node.getSelfBounds().width + 'px';
          div.style.height = node.getSelfBounds().height + 'px';
          // TODO: do we require the jQuery versions here, or are they vestigial?
          // $div.width( node.getSelfBounds().width );
          // $div.height( node.getSelfBounds().height );
        }
        if ( this.dirtyText ) {
          // TODO: actually do this in a better way
          div.innerHTML = node.renderedText;
        }
        if ( this.dirtyDirection ) {
          div.setAttribute( 'dir', node._direction );
        }
      }

      if ( this.transformDirty || this.dirtyText || this.dirtyFont || this.dirtyBounds ) {
        // shift the text vertically, postmultiplied with the entire transform.
        var yOffset = node.getSelfBounds().minY;
        scratchMatrix.set( this.getTransformMatrix() );
        var translation = Matrix3.translation( 0, yOffset );
        scratchMatrix.multiplyMatrix( translation );
        translation.freeToPool();
        scenery.Util.applyPreparedTransform( scratchMatrix, div, this.forceAcceleration );
      }

      // clear all of the dirty flags
      this.setToCleanState();
      this.cleanPaintableState();
      this.transformDirty = false;
    },

    /**
     * Disposes the drawable.
     * @public
     * @override
     */
    dispose: function() {
      this.disposeState();

      if ( !keepDOMTextElements ) {
        // clear the references
        this.domElement = null;
      }

      DOMSelfDrawable.prototype.dispose.call( this );
    }
  } );
  Text.TextStatefulDrawable.mixin( Text.TextDOMDrawable );
  // This sets up TextDOMDrawable.createFromPool/dirtyFromPool and drawable.freeToPool() for the type, so
  // that we can avoid allocations by reusing previously-used drawables.
  SelfDrawable.Poolable.mixin( Text.TextDOMDrawable );

  /*---------------------------------------------------------------------------*
   * SVG rendering
   *----------------------------------------------------------------------------*/

  /**
   * A generated SVGSelfDrawable whose purpose will be drawing our Text. One of these drawables will be created
   * for each displayed instance of a Text node.
   * @constructor
   *
   * @param {number} renderer - Renderer bitmask, see Renderer's documentation for more details.
   * @param {Instance} instance
   */
  Text.TextSVGDrawable = function TextSVGDrawable( renderer, instance ) {
    this.initialize( renderer, instance );
  };
  inherit( SVGSelfDrawable, Text.TextSVGDrawable, {
    /**
     * Initializes this drawable, starting its "lifetime" until it is disposed. This lifecycle can happen multiple
     * times, with instances generally created by the SelfDrawable.Poolable mixin (dirtyFromPool/createFromPool), and
     * disposal will return this drawable to the pool.
     * @private
     *
     * This acts as a pseudo-constructor that can be called multiple times, and effectively creates/resets the state
     * of the drawable to the initial state.
     *
     * @param {number} renderer - Renderer bitmask, see Renderer's documentation for more details.
     * @param {Instance} instance
     * @returns {TextSVGDrawable} - Returns 'this' reference, for chaining
     */
    initialize: function( renderer, instance ) {
      // Super-type initialization
      this.initializeSVGSelfDrawable( renderer, instance, true, keepSVGTextElements ); // usesPaint: true

      if ( !this.svgElement ) {
        // @protected {SVGTextElement} - Sole SVG element for this drawable, implementing API for SVGSelfDrawable
        var text = this.svgElement = document.createElementNS( scenery.svgns, 'text' );
        text.appendChild( document.createTextNode( '' ) );

        // TODO: flag adjustment for SVG qualities
        text.setAttribute( 'dominant-baseline', 'alphabetic' ); // to match Canvas right now
        text.setAttribute( 'text-rendering', 'geometricPrecision' );
        if ( useSVGTextLengthAdjustments ) {
          text.setAttribute( 'lengthAdjust', 'spacingAndGlyphs' );
        }
        text.setAttributeNS( 'http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve' );
      }

      return this;
    },

    updateSVGSelf: function() {
      var text = this.svgElement;

      if ( this.dirtyDirection ) {
        text.setAttribute( 'direction', this.node._direction );
      }

      // set all of the font attributes, since we can't use the combined one
      if ( this.dirtyFont ) {
        text.setAttribute( 'font-family', this.node._font.getFamily() );
        text.setAttribute( 'font-size', this.node._font.getSize() );
        text.setAttribute( 'font-style', this.node._font.getStyle() );
        text.setAttribute( 'font-weight', this.node._font.getWeight() );
        text.setAttribute( 'font-stretch', this.node._font.getStretch() );
      }

      // update the text-node's value
      if ( this.dirtyText ) {
        text.lastChild.nodeValue = this.node.renderedText;
      }

      // text length correction, tested with scenery/tests/text-quality-test.html to determine how to match Canvas/SVG rendering (and overall length)
      if ( this.dirtyBounds && useSVGTextLengthAdjustments && isFinite( this.node.selfBounds.width ) ) {
        text.setAttribute( 'textLength', this.node.selfBounds.width );
      }

      this.updateFillStrokeStyle( text );
    }
  } );
  Text.TextStatefulDrawable.mixin( Text.TextSVGDrawable );
  // This sets up TextSVGDrawable.createFromPool/dirtyFromPool and drawable.freeToPool() for the type, so
  // that we can avoid allocations by reusing previously-used drawables.
  SelfDrawable.Poolable.mixin( Text.TextSVGDrawable );

  /*---------------------------------------------------------------------------*
   * Canvas rendering
   *----------------------------------------------------------------------------*/

  /**
   * A generated CanvasSelfDrawable whose purpose will be drawing our Text. One of these drawables will be created
   * for each displayed instance of a Text node.
   * @constructor
   *
   * @param {number} renderer - Renderer bitmask, see Renderer's documentation for more details.
   * @param {Instance} instance
   */
  Text.TextCanvasDrawable = function TextCanvasDrawable( renderer, instance ) {
    this.initialize( renderer, instance );
  };
  inherit( CanvasSelfDrawable, Text.TextCanvasDrawable, {
    /**
     * Initializes this drawable, starting its "lifetime" until it is disposed. This lifecycle can happen multiple
     * times, with instances generally created by the SelfDrawable.Poolable mixin (dirtyFromPool/createFromPool), and
     * disposal will return this drawable to the pool.
     * @private
     *
     * This acts as a pseudo-constructor that can be called multiple times, and effectively creates/resets the state
     * of the drawable to the initial state.
     *
     * @param {number} renderer - Renderer bitmask, see Renderer's documentation for more details.
     * @param {Instance} instance
     * @returns {TextCanvasDrawable} - Returns 'this' reference, for chaining
     */
    initialize: function( renderer, instance ) {
      this.initializeCanvasSelfDrawable( renderer, instance );
      this.initializePaintableStateless( renderer, instance );
      return this;
    },

    /**
     * Paints this drawable to a Canvas (the wrapper contains both a Canvas reference and its drawing context).
     * @public
     *
     * Assumes that the Canvas's context is already in the proper local coordinate frame for the node, and that any
     * other required effects (opacity, clipping, etc.) have already been prepared.
     *
     * This is part of the CanvasSelfDrawable API required to be implemented for subtypes.
     *
     * @param {CanvasContextWrapper} wrapper - Contains the Canvas and its drawing context
     * @param {Node} node - Our node that is being drawn
     */
    paintCanvas: function( wrapper, node ) {
      var context = wrapper.context;

      // extra parameters we need to set, but should avoid setting if we aren't drawing anything
      if ( node.hasFill() || node.hasStroke() ) {
        wrapper.setFont( node._font.getFont() );
        wrapper.setDirection( node._direction );
      }

      if ( node.hasFill() ) {
        node.beforeCanvasFill( wrapper ); // defined in Paintable
        context.fillText( node.renderedText, 0, 0 );
        node.afterCanvasFill( wrapper ); // defined in Paintable
      }
      if ( node.hasStroke() ) {
        node.beforeCanvasStroke( wrapper ); // defined in Paintable
        context.strokeText( node.renderedText, 0, 0 );
        node.afterCanvasStroke( wrapper ); // defined in Paintable
      }
    },

    // stateless dirty functions
    markDirtyText: function() { this.markPaintDirty(); },
    markDirtyFont: function() { this.markPaintDirty(); },
    markDirtyBounds: function() { this.markPaintDirty(); },
    markDirtyDirection: function() { this.markPaintDirty(); },

    /**
     * Disposes the drawable.
     * @public
     * @override
     */
    dispose: function() {
      CanvasSelfDrawable.prototype.dispose.call( this );
      this.disposePaintableStateless();
    }
  } );
  Paintable.PaintableStatelessDrawable.mixin( Text.TextCanvasDrawable );
  // This sets up TextCanvasDrawable.createFromPool/dirtyFromPool and drawable.freeToPool() for the type, so
  // that we can avoid allocations by reusing previously-used drawables.
  SelfDrawable.Poolable.mixin( Text.TextCanvasDrawable );

  /*---------------------------------------------------------------------------*
   * WebGL rendering
   *----------------------------------------------------------------------------*/

  /**
   * A generated WebGLSelfDrawable whose purpose will be drawing our Text. One of these drawables will be created
   * for each displayed instance of a Text node.
   * @constructor
   *
   * @param {number} renderer - Renderer bitmask, see Renderer's documentation for more details.
   * @param {Instance} instance
   */
  Text.TextWebGLDrawable = function TextWebGLDrawable( renderer, instance ) {
    this.initialize( renderer, instance );
  };
  inherit( WebGLSelfDrawable, Text.TextWebGLDrawable, {
    /**
     * Initializes this drawable, starting its "lifetime" until it is disposed. This lifecycle can happen multiple
     * times, with instances generally created by the SelfDrawable.Poolable mixin (dirtyFromPool/createFromPool), and
     * disposal will return this drawable to the pool.
     * @private
     *
     * This acts as a pseudo-constructor that can be called multiple times, and effectively creates/resets the state
     * of the drawable to the initial state.
     *
     * @param {number} renderer - Renderer bitmask, see Renderer's documentation for more details.
     * @param {Instance} instance
     */
    initialize: function( renderer, instance ) {
      this.initializeWebGLSelfDrawable( renderer, instance );
    },

    onAddToBlock: function( webglBlock ) {
      var self = this;
      this.node.toImageNodeAsynchronous( function( imageNodeContainer ) {
        //toImageNode returns a containerNode with its first child set as ImageNode
        var imageNode = imageNodeContainer.children[ 0 ];
        self.textHandle = webglBlock.webGLRenderer.textureRenderer.createFromImageNode( imageNode, 0.4 );

        // TODO: Don't call this each time a new item is added.
        webglBlock.webGLRenderer.textureRenderer.bindVertexBuffer();
        webglBlock.webGLRenderer.textureRenderer.bindDirtyTextures();
        self.updateText();
      } );

      //TODO: Update the state in the buffer arrays
    },

    onRemoveFromBlock: function( webglBlock ) {

    },

    //Nothing necessary since everything currently handled in the uModelViewMatrix below
    //However, we may switch to dynamic draw, and handle the matrix change only where necessary in the future?
    updateText: function() {
      if ( this.textHandle ) {
        this.textHandle.update();
      }
    },

    render: function( shaderProgram ) {
      // This is handled by the ColorTriangleRenderer
    },

    /**
     * Disposes the drawable.
     * @public
     * @override
     */
    dispose: function() {
      this.disposeWebGLBuffers();
      // super
      WebGLSelfDrawable.prototype.dispose.call( this );
    },

    disposeWebGLBuffers: function() {
      this.webglBlock.webGLRenderer.colorTriangleRenderer.colorTriangleBufferData.dispose( this.rectangleHandle );
    },

    markDirtyText: function() {
      this.markDirty();
    },

    markDirtyBounds: function() {
      this.markDirty();
    },

    /**
     * A "catch-all" dirty method that directly marks the paintDirty flag and triggers propagation of dirty
     * information. This can be used by other mark* methods, or directly itself if the paintDirty flag is checked.
     * @public (scenery-internal)
     *
     * It should be fired (indirectly or directly) for anything besides transforms that needs to make a drawable
     * dirty.
     */
    markPaintDirty: function() {
      this.markDirty();
    },

    //TODO: Make sure all of the dirty flags make sense here.  Should we be using fillDirty, paintDirty, dirty, etc?
    update: function() {
      //if ( this.dirty ) {
      this.updateText();
      this.dirty = false;
      //}
    }
  } );

  // include stubs (stateless) for marking dirty stroke and fill (if necessary). we only want one dirty flag, not multiple ones, for WebGL (for now)
  Paintable.PaintableStatefulDrawable.mixin( Text.TextWebGLDrawable );
  // This sets up TextWebGLDrawable.createFromPool/dirtyFromPool and drawable.freeToPool() for the type, so
  // that we can avoid allocations by reusing previously-used drawables.
  SelfDrawable.Poolable.mixin( Text.TextWebGLDrawable );

  /*---------------------------------------------------------------------------*
   * Hybrid text setup (for bounds testing)
   *----------------------------------------------------------------------------*/

  function createSVGTextToMeasure() {
    var text = document.createElementNS( scenery.svgns, 'text' );
    text.appendChild( document.createTextNode( '' ) );

    // TODO: flag adjustment for SVG qualities
    text.setAttribute( 'dominant-baseline', 'alphabetic' ); // to match Canvas right now
    text.setAttribute( 'text-rendering', 'geometricPrecision' );
    text.setAttributeNS( 'http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve' );
    return text;
  }

  function updateSVGTextToMeasure( textElement, textNode ) {
    textElement.setAttribute( 'direction', textNode._direction );
    textElement.setAttribute( 'font-family', textNode._font.getFamily() );
    textElement.setAttribute( 'font-size', textNode._font.getSize() );
    textElement.setAttribute( 'font-style', textNode._font.getStyle() );
    textElement.setAttribute( 'font-weight', textNode._font.getWeight() );
    textElement.setAttribute( 'font-stretch', textNode._font.getStretch() );
    textElement.lastChild.nodeValue = textNode.renderedText;
  }

  if ( !svgTextSizeContainer ) {
    // set up the container and text for testing text bounds quickly (using approximateSVGBounds)
    svgTextSizeContainer = document.createElementNS( scenery.svgns, 'svg' );
    svgTextSizeContainer.setAttribute( 'width', '2' );
    svgTextSizeContainer.setAttribute( 'height', '2' );
    svgTextSizeContainer.setAttribute( 'id', textSizeContainerId );
    svgTextSizeContainer.setAttribute( 'style', 'visibility: hidden; pointer-events: none; position: absolute; left: -65535px; right: -65535px;' ); // so we don't flash it in a visible way to the user
  }
  // NOTE! copies createSVGElement
  if ( !svgTextSizeElement ) {
    svgTextSizeElement = createSVGTextToMeasure();
    svgTextSizeElement.setAttribute( 'id', textSizeElementId );
    svgTextSizeContainer.appendChild( svgTextSizeElement );
  }

  initializingHybridTextNode = true;
  hybridTextNode = new Text( 'm', { boundsMethod: 'fast' } );
  initializingHybridTextNode = false;

  return Text;
} );



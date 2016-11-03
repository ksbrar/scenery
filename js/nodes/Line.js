// Copyright 2013-2015, University of Colorado Boulder

/**
 * A line that inherits Path, and allows for optimized drawing,
 * and improved line handling.
 *
 * TODO: add DOM support
 *
 * @author Jonathan Olson <jonathan.olson@colorado.edu>
 */

define( function( require ) {
  'use strict';

  var inherit = require( 'PHET_CORE/inherit' );
  var scenery = require( 'SCENERY/scenery' );
  var KiteLine = require( 'KITE/segments/Line' ); // eslint-disable-line require-statement-match
  var Path = require( 'SCENERY/nodes/Path' );
  var Shape = require( 'KITE/Shape' );
  var Bounds2 = require( 'DOT/Bounds2' );
  var Vector2 = require( 'DOT/Vector2' );
  var Renderer = require( 'SCENERY/display/Renderer' );
  var LineCanvasDrawable = require( 'SCENERY/display/drawables/LineCanvasDrawable' );
  var LineSVGDrawable = require( 'SCENERY/display/drawables/LineSVGDrawable' );

  /**
   * @constructor
   * @mixes Paintable
   *
   * Currently, all numerical parameters should be finite.
   * x1:         x-position of the start
   * y1:         y-position of the start
   * x2:         x-position of the end
   * y2:         y-position of the end
   *
   * Available constructors:
   * new Line( x1, y1, x2, y2, { ... } )
   * new Line( new Vector2( x1, y1 ), new Vector2( x2, y2 ), { ... } )
   * new Line( { x1: x1, y1: y1, x2: x2, y2: y2,  ... } )
   */
  function Line( x1, y1, x2, y2, options ) {
    if ( typeof x1 === 'object' ) {
      if ( x1 instanceof Vector2 ) {
        // assumes Line( Vector2, Vector2, options );
        this._x1 = x1.x;
        this._y1 = x1.y;
        this._x2 = y1.x;
        this._y2 = y1.y;
        options = x2 || {};
      }
      else {
        // assumes Line( { ... } ), init to zero for now
        this._x1 = 0;
        this._y1 = 0;
        this._x2 = 0;
        this._y2 = 0;
        options = x1 || {};
      }
    }
    else {
      // new Line(  x1, y1, x2, y2, [options] )
      this._x1 = x1;
      this._y1 = y1;
      this._x2 = x2;
      this._y2 = y2;

      // ensure we have a parameter object
      options = options || {};
    }
    // fallback for non-canvas or non-svg rendering, and for proper bounds computation

    Path.call( this, null, options );
  }

  scenery.register( 'Line', Line );

  inherit( Path, Line, {
    /**
     * {Array.<string>} - String keys for all of the allowed options that will be set by node.mutate( options ), in the
     * order they will be evaluated in.
     * @protected
     *
     * NOTE: See Node's _mutatorKeys documentation for more information on how this operates, and potential special
     *       cases that may apply.
     */
    _mutatorKeys: [ 'p1', 'p2', 'x1', 'y1', 'x2', 'y2' ].concat( Path.prototype._mutatorKeys ),

    /**
     * {Array.<String>} - List of all dirty flags that should be available on drawables created from this node (or
     *                    subtype). Given a flag (e.g. radius), it indicates the existence of a function
     *                    drawable.markDirtyRadius() that will indicate to the drawable that the radius has changed.
     * @public (scenery-internal)
     * @override
     */
    drawableMarkFlags: Path.prototype.drawableMarkFlags.concat( [ 'line', 'p1', 'p2', 'x1', 'x2', 'y1', 'y2' ] ).filter( function( flag ) {
      // We don't want the shape flag, as that won't be called for Path subtypes.
      return flag !== 'shape';
    } ),

    /**
     * Set the geometry of the line, including stand and end point.
     * @param {number} x1 - the start x coordinate
     * @param {number} y1 - the start y coordinate
     * @param {number} x2 - the end x coordinate
     * @param {number} y2 - the end y coordinate
     */
    setLine: function( x1, y1, x2, y2 ) {
      assert && assert( x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined, 'parameters need to be defined' );

      this._x1 = x1;
      this._y1 = y1;
      this._x2 = x2;
      this._y2 = y2;

      var stateLen = this._drawables.length;
      for ( var i = 0; i < stateLen; i++ ) {
        var state = this._drawables[ i ];
        state.markDirtyLine();
      }

      this.invalidateLine();
    },

    setPoint1: function( x1, y1 ) {
      if ( typeof x1 === 'number' ) {
        // setPoint1( x1, y1 );
        assert && assert( x1 !== undefined && y1 !== undefined, 'parameters need to be defined' );
        this._x1 = x1;
        this._y1 = y1;
      }
      else {
        // setPoint1( Vector2 )
        assert && assert( x1.x !== undefined && x1.y !== undefined, 'parameters need to be defined' );
        this._x1 = x1.x;
        this._y1 = x1.y;
      }
      var stateLen = this._drawables.length;
      for ( var i = 0; i < stateLen; i++ ) {
        var state = this._drawables[ i ];
        state.markDirtyP1();
      }
      this.invalidateLine();
    },
    set p1( point ) { this.setPoint1( point ); },
    get p1() { return new Vector2( this._x1, this._y1 ); },

    setPoint2: function( x2, y2 ) {
      if ( typeof x2 === 'number' ) {
        // setPoint2( x2, y2 );
        assert && assert( x2 !== undefined && y2 !== undefined, 'parameters need to be defined' );
        this._x2 = x2;
        this._y2 = y2;
      }
      else {
        // setPoint2( Vector2 )
        assert && assert( x2.x !== undefined && x2.y !== undefined, 'parameters need to be defined' );
        this._x2 = x2.x;
        this._y2 = x2.y;
      }
      var stateLen = this._drawables.length;
      for ( var i = 0; i < stateLen; i++ ) {
        var state = this._drawables[ i ];
        state.markDirtyP2();
      }
      this.invalidateLine();
    },
    set p2( point ) { this.setPoint2( point ); },
    get p2() { return new Vector2( this._x2, this._y2 ); },

    createLineShape: function() {
      return Shape.lineSegment( this._x1, this._y1, this._x2, this._y2 ).makeImmutable();
    },

    invalidateLine: function() {
      assert && assert( isFinite( this._x1 ), 'A rectangle needs to have a finite x1 (' + this._x1 + ')' );
      assert && assert( isFinite( this._y1 ), 'A rectangle needs to have a finite y1 (' + this._y1 + ')' );
      assert && assert( isFinite( this._x2 ), 'A rectangle needs to have a finite x2 (' + this._x2 + ')' );
      assert && assert( isFinite( this._y2 ), 'A rectangle needs to have a finite y2 (' + this._y2 + ')' );

      // sets our 'cache' to null, so we don't always have to recompute our shape
      this._shape = null;

      // should invalidate the path and ensure a redraw
      this.invalidatePath();
    },

    /**
     * Computes whether the provided point is "inside" (contained) in this Line's self content, or "outside".
     * @protected
     * @override
     *
     * Since an unstroked Line contains no area, we can quickly shortcut this operation.
     *
     * @param {Vector2} point - Considered to be in the local coordinate frame
     * @returns {boolean}
     */
    containsPointSelf: function( point ) {
      if ( this._strokePickable ) {
        return Path.prototype.containsPointSelf.call( this, point );
      }
      else {
        return false; // nothing is in a line! (although maybe we should handle edge points properly?)
      }
    },

    /**
     * Returns whether this Line's selfBounds is intersected by the specified bounds.
     * @public
     *
     * @param {Bounds2} bounds - Bounds to test, assumed to be in the local coordinate frame.
     * @returns {boolean}
     */
    intersectsBoundsSelf: function( bounds ) {
      // TODO: optimization
      return new KiteLine( this.p1, this.p2 ).intersectsBounds( bounds );
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
      LineCanvasDrawable.prototype.paintCanvas( wrapper, this );
    },

    /**
     * Computes the bounds of the Line, including any applied stroke. Overridden for efficiency.
     * @public
     * @override
     *
     * @returns {Bounds2}
     */
    computeShapeBounds: function() {
      // optimized form for a single line segment (no joins, just two caps)
      if ( this._stroke ) {
        var lineCap = this.getLineCap();
        var halfLineWidth = this.getLineWidth() / 2;
        if ( lineCap === 'round' ) {
          // we can simply dilate by half the line width
          return new Bounds2(
            Math.min( this._x1, this._x2 ) - halfLineWidth, Math.min( this._y1, this._y2 ) - halfLineWidth,
            Math.max( this._x1, this._x2 ) + halfLineWidth, Math.max( this._y1, this._y2 ) + halfLineWidth );
        }
        else {
          // (dx,dy) is a vector p2-p1
          var dx = this._x2 - this._x1;
          var dy = this._y2 - this._y1;
          var magnitude = Math.sqrt( dx * dx + dy * dy );
          if ( magnitude === 0 ) {
            // if our line is a point, just dilate by halfLineWidth
            return new Bounds2( this._x1 - halfLineWidth, this._y1 - halfLineWidth, this._x2 + halfLineWidth, this._y2 + halfLineWidth );
          }
          // (sx,sy) is a vector with a magnitude of halfLineWidth pointed in the direction of (dx,dy)
          var sx = halfLineWidth * dx / magnitude;
          var sy = halfLineWidth * dy / magnitude;
          var bounds = Bounds2.NOTHING.copy();

          if ( lineCap === 'butt' ) {
            // four points just using the perpendicular stroked offsets (sy,-sx) and (-sy,sx)
            bounds.addCoordinates( this._x1 - sy, this._y1 + sx );
            bounds.addCoordinates( this._x1 + sy, this._y1 - sx );
            bounds.addCoordinates( this._x2 - sy, this._y2 + sx );
            bounds.addCoordinates( this._x2 + sy, this._y2 - sx );
          }
          else {
            assert && assert( lineCap === 'square' );

            // four points just using the perpendicular stroked offsets (sy,-sx) and (-sy,sx) and parallel stroked offsets
            bounds.addCoordinates( this._x1 - sx - sy, this._y1 - sy + sx );
            bounds.addCoordinates( this._x1 - sx + sy, this._y1 - sy - sx );
            bounds.addCoordinates( this._x2 + sx - sy, this._y2 + sy + sx );
            bounds.addCoordinates( this._x2 + sx + sy, this._y2 + sy - sx );
          }
          return bounds;
        }
      }
      else {
        // It might have a fill? Just include the fill bounds for now.
        var fillBounds = Bounds2.NOTHING.copy();
        fillBounds.addCoordinates( this._x1, this._y1 );
        fillBounds.addCoordinates( this._x2, this._y2 );
        return fillBounds;
      }
    },

    /**
     * Creates a SVG drawable for this Line.
     * @public (scenery-internal)
     * @override
     *
     * @param {number} renderer - In the bitmask format specified by Renderer, which may contain additional bit flags.
     * @param {Instance} instance - Instance object that will be associated with the drawable
     * @returns {SVGSelfDrawable}
     */
    createSVGDrawable: function( renderer, instance ) {
      return LineSVGDrawable.createFromPool( renderer, instance );
    },

    /**
     * Creates a Canvas drawable for this Line.
     * @public (scenery-internal)
     * @override
     *
     * @param {number} renderer - In the bitmask format specified by Renderer, which may contain additional bit flags.
     * @param {Instance} instance - Instance object that will be associated with the drawable
     * @returns {CanvasSelfDrawable}
     */
    createCanvasDrawable: function( renderer, instance ) {
      return LineCanvasDrawable.createFromPool( renderer, instance );
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
      return 'new scenery.Line( ' + this._x1 + ', ' + this._y1 + ', ' + this._x1 + ', ' + this._y1 + ', {' + propLines + '} )';
    },

    /**
     * It is impossible to set another shape on this Path subtype, as its effective shape is determined by other
     * parameters.
     * @public
     * @override
     *
     * @param {Shape|null} Shape - Throws an error if it is not null.
     */
    setShape: function( shape ) {
      if ( shape !== null ) {
        throw new Error( 'Cannot set the shape of a scenery.Line to something non-null' );
      }
      else {
        // probably called from the Path constructor
        this.invalidatePath();
      }
    },

    /**
     * Returns an immutable copy of this Path subtype's representation.
     * @public
     * @override
     *
     * NOTE: This is created lazily, so don't call it if you don't have to!
     *
     * @returns {Shape}
     */
    getShape: function() {
      if ( !this._shape ) {
        this._shape = this.createLineShape();
      }
      return this._shape;
    },

    /**
     * Returns whether this Path has an associated Shape (instead of no shape, represented by null)
     * @public
     * @override
     *
     * @returns {boolean}
     */
    hasShape: function() {
      return true;
    },

    // A line does not render its fill, so it supports all renderers.  Right?
    // - SR, 2014
    getFillRendererBitmask: function() {
      return Renderer.bitmaskCanvas | Renderer.bitmaskSVG | Renderer.bitmaskDOM;
    }
  } );

  function addLineProp( capitalizedShort ) {
    var lowerShort = capitalizedShort.toLowerCase();

    var getName = 'get' + capitalizedShort;
    var setName = 'set' + capitalizedShort;
    var privateName = '_' + lowerShort;
    var dirtyMethodName = 'markDirty' + capitalizedShort;

    Line.prototype[ getName ] = function() {
      return this[ privateName ];
    };

    Line.prototype[ setName ] = function( value ) {
      if ( this[ privateName ] !== value ) {
        this[ privateName ] = value;
        var stateLen = this._drawables.length;
        for ( var i = 0; i < stateLen; i++ ) {
          var state = this._drawables[ i ];
          state[ dirtyMethodName ]();
        }
        this.invalidateLine();
      }
      return this;
    };

    Object.defineProperty( Line.prototype, lowerShort, {
      set: Line.prototype[ setName ],
      get: Line.prototype[ getName ]
    } );
  }

  addLineProp( 'X1' );
  addLineProp( 'Y1' );
  addLineProp( 'X2' );
  addLineProp( 'Y2' );

  return Line;
} );

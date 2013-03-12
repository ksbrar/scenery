// Copyright 2002-2012, University of Colorado

/**
 * Tracks a single touch point
 *
 * IE guidelines for Touch-friendly sites: http://blogs.msdn.com/b/ie/archive/2012/04/20/guidelines-for-building-touch-friendly-sites.aspx
 *
 * @author Jonathan Olson <olsonsjc@gmail.com>
 */

define( function( require ) {
  
  var scenery = require( 'SCENERY/scenery' );
  
  var Pointer = require( 'SCENERY/input/Pointer' ); // extends Pointer
  
  scenery.Touch = function( id, point, event ) {
    Pointer.call( this );
    
    this.id = id;
    this.point = point;
    this.isTouch = true;
    this.trail = null;
    
    this.type = 'touch';
  };
  var Touch = scenery.Touch;
  
  Touch.prototype = _.extend( {}, Pointer.prototype, {
    constructor: Touch,
    
    move: function( point, event ) {
      this.point = point;
    },
    
    end: function( point, event ) {
      this.point = point;
    },
    
    cancel: function( point, event ) {
      this.point = point;
    }
  } );
  
  return Touch;
} );

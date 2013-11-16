// Copyright 2002-2013, University of Colorado

/**
 * An instance that is specific to the display (not necessarily a global instance, could be in a Canvas cache, etc),
 * that is needed to tracking instance-specific display information, and signals to the display system when other
 * changes are necessary.
 *
 * @author Jonathan Olson <olsonsjc@gmail.com>
 */

define( function( require ) {
  'use strict';
  
  var inherit = require( 'PHET_CORE/inherit' );
  var scenery = require( 'SCENERY/scenery' );
  
  var globalIdCounter = 1;
  
  /**
   * @param {DisplayInstance|null} parent
   */
  scenery.DisplayInstance = function DisplayInstance( trail, parent ) {
    this.id = globalIdCounter++;
    this.trail = trail;
    this.parent = parent;
  };
  var DisplayInstance = scenery.DisplayInstance;
  
  inherit( Object, DisplayInstance, {
    
  } );
  
  return DisplayInstance;
} );

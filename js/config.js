// Copyright 2013-2016, University of Colorado Boulder

/**
 * Configuration file for development and production deployments.
 *
 * @author Jonathan Olson <jonathan.olson@colorado.edu>
 */

require.config( {
  // depends on all of Scenery, Kite, Dot, Axon and phet-core
  deps: [ 'main', 'KITE/main', 'DOT/main', 'AXON/main', 'PHET_CORE/main' ],

  paths: {

    // plugins
    image: '../../chipper/js/requirejs-plugins/image',
    ifphetio: '../../chipper/js/requirejs-plugins/ifphetio',

    // third-party libs
    text: '../../sherpa/lib/text-2.0.12',

    AXON: '../../axon/js',

    DOT: '../../dot/js',
    KITE: '../../kite/js',
    PHET_CORE: '../../phet-core/js',
    SCENERY: '.',
    TANDEM: '../../tandem/js',

    REPOSITORY: '..'
  },

  // optional cache buster to make browser refresh load all included scripts, can be disabled with ?cacheBuster=false
  urlArgs: Date.now()
} );

// Copyright 2002-2012, University of Colorado

/** @define {boolean} */
var phetDebug = true;

var phet = phet || {};

phet.assert = function ( predicate, msg ) {
  if ( !predicate ) {
    throw new Error( "Assertion failed: " + msg );
  }
};

// an assertion that is removed for the optimized (minified) form
phet.debugAssert = function( predicateFunction, msg ) {
  if ( phetDebug && !predicateFunction() ) {
    throw new Error( "Assertion failed: " + msg );
  }
};

// util
phet.util = phet.util || {};
(function () {
  "use strict";
  
  // TODO: convert most of these usages to LoDash, and consider pull requests for the rest
  
  phet.util.remove = function ( array, ob ) {
    array.splice( array.indexOf( ob ), 1 );
  };

  phet.util.isArray = function ( array ) {
    // yes, this is actually how to do this. see http://stackoverflow.com/questions/4775722/javascript-check-if-object-is-array
    return Object.prototype.toString.call( array ) === '[object Array]';
  };

  // for arrays
  phet.util.foreach = function ( array, callback ) {
    for ( var i = 0; i < array.length; i++ ) {
      callback.call( undefined, array[i] );
    }
  };

  // for arrays
  phet.util.map = function ( array, mapper ) {
    var result = [];
    phet.util.foreach( array, function ( ob ) {
      result.push( mapper.call( undefined, ob ) );
    } );
    return result;
  };

  // Returns an array of integers from A to B (including both A to B)
  phet.util.rangeInclusive = function ( a, b ) {
    var result = new Array( b - a + 1 );
    for ( var i = a; i <= b; i++ ) {
      result[i] = i;
    }
    return result;
  };

  phet.util.mkString = function ( array, separator ) {
    var result = "";
    separator = separator === undefined ? ', ' : separator;
    var first = true;
    phet.util.foreach( array, function ( ob ) {
      if ( !first ) {
        result += separator;
      }
      first = false;

      if ( ob === undefined ) {
        result += "undefined";
      }
      else {
        result += ob.toString();
      }
    } );
    return result;
  };

  // a faster variant of combinations(), unrolled for pairs of elements
  phet.util.pairs = function ( array ) {
    var result = [];
    var size = array.length;
    for ( var i = 0; i < size - 1; i++ ) {
      var t = array[i];
      for ( var j = i + 1; j < size; j++ ) {
        result.push( [t, array[j]] );
      }
    }
    return result;
  };

  // Returns two lists filtered by the predicate. I.e., the first list will contain every element where predicate( element ) == true, and the second list will contain the rest
  phet.util.partition = function ( array, predicate ) {
    var trueResult = [];
    var falseResult = [];
    for ( var i = 0; i < array.length; i++ ) {
      var element = array[i];
      if ( predicate.call( undefined, element ) ) {
        trueResult.push( element );
      }
      else {
        falseResult.push( element );
      }
    }
    return [trueResult, falseResult];
  };

  // Returns a list filtered by the predicate. I.e., the list will contain every element where predicate( element ) == true
  phet.util.filter = function ( array, predicate ) {
    var result = [];
    for ( var i = 0; i < array.length; i++ ) {
      var element = array[i];
      if ( predicate.call( undefined, element ) ) {
        result.push( element );
      }
    }
    return result;
  };

  // Returns a unique list from a collection, in no particular order
  phet.util.unique = function ( array, equalityPredicate ) {
    if ( !equalityPredicate ) {
      equalityPredicate = function ( a, b ) {
        return a === b;
      };
    }

    var result = [];
    for ( var i = 0; i < array.length; i++ ) {
      var addIt = true;
      var element = array[i];
      for ( var j = 0; j < result.length; j++ ) {
        if ( equalityPredicate( element, result[j] ) ) {
          addIt = false;
          break;
        }
      }
      if ( addIt ) {
        result.push( element );
      }
    }
    return result;
  };

  // Returns the first object in the collection that satisfies the predicate, or undefined
  phet.util.first = function ( array, predicate ) {
    for ( var i = 0; i < array.length; i++ ) {
      if ( predicate( array[i] ) ) {
        return array[i];
      }
    }
    return undefined;
  };

  phet.util.firstOrNull = function ( array, predicate ) {
    var result = phet.util.first( array, predicate );
    return result === undefined ? null : result;
  };

  // a list with all elements of the minuend that are not in the subtrahend
  phet.util.subtract = function ( minuend, subtrahend ) {
    return phet.util.filter( minuend, function ( item ) { return subtrahend.indexOf( item ) === -1;} );
  };

  // Returns the number of items in the collection for which the predicate returns true
  phet.util.count = function ( array, predicate ) {
    var result = 0;
    for ( var i = 0; i < array.length; i++ ) {
      if ( predicate( array[i] ) ) {
        result++;
      }
    }
    return result;
  };
})();

// some polyfills or workarounds
(function () {
  // Object.create polyfill
  if ( !Object.create ) {
    Object.create = function ( o ) {
      if ( arguments.length > 1 ) {
        throw new Error( 'Object.create implementation only accepts the first parameter.' );
      }
      function F() {}

      F.prototype = o;
      return new F();
    };
  }
  
  // IE9 does not support Float32Array, so we back it up by a standard array
  if ( !window.Float32Array ) {
    window.Float32Array = Array;
  }
  
  /*---------------------------------------------------------------------------*
   * window.requestAnimationFrame polyfill, by Erik Moller (http://my.opera.com/emoller/blog/2011/12/20/requestanimationframe-for-smart-er-animating)
   * referenced by initial Paul Irish article at http://paulirish.com/2011/requestanimationframe-for-smart-animating/
   *----------------------------------------------------------------------------*/
  (function() {
    var lastTime = 0;
    var vendors = ['ms', 'moz', 'webkit', 'o'];
    for ( var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x ) {
      window.requestAnimationFrame = window[vendors[x]+'RequestAnimationFrame'];
      window.cancelAnimationFrame = window[vendors[x]+'CancelAnimationFrame'] || window[vendors[x]+'CancelRequestAnimationFrame'];
    }
   
    if ( !window.requestAnimationFrame ) {
      window.requestAnimationFrame = function(callback) {
        var currTime = new Date().getTime();
        var timeToCall = Math.max(0, 16 - (currTime - lastTime));
        var id = window.setTimeout(function() { callback(currTime + timeToCall); },
          timeToCall);
        lastTime = currTime + timeToCall;
        return id;
      };
    }
   
    if ( !window.cancelAnimationFrame ) {
      window.cancelAnimationFrame = function(id) {
        clearTimeout(id);
      };
    }
  }());
})();


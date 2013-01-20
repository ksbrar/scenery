
var phet = phet || {};
phet.tests = phet.tests || {};

(function(){
    function buildBaseContext( main ) {
        var baseCanvas = document.createElement( 'canvas' );
        baseCanvas.id = 'base-canvas';
        baseCanvas.width = main.width();
        baseCanvas.height = main.height();
        main.append( baseCanvas );
        
        return phet.canvas.initCanvas( baseCanvas );
    }    
    
    phet.tests.textBounds = function( main ) {
        var context = buildBaseContext( main );
        
        // for text testing: see http://www.whatwg.org/specs/web-apps/current-work/multipage/the-canvas-element.html#2dcontext
        // context: font, textAlign, textBaseline, direction
        // metrics: width, actualBoundingBoxLeft, actualBoundingBoxRight, etc.
        
        // consider something like http://mudcu.be/journal/2011/01/html5-typographic-metrics/
        
        var x = 10;
        var y = 100;
        var str = "This is a test string";
        
        context.font = '30px Arial';
        var metrics = context.measureText( str );
        context.fillStyle = '#ccc';
        context.fillRect( x - metrics.actualBoundingBoxLeft, y - metrics.actualBoundingBoxAscent,
            x + metrics.actualBoundingBoxRight, y + metrics.actualBoundingBoxDescent );
        context.fillStyle = '#000';
        context.fillText( str, x, y, 500 );
        
        var testTransform = phet.math.Matrix3.translation( 50, 150 ).timesMatrix( phet.math.Matrix3.scaling( 10, 0.1 ) );
        testTransform.canvasSetTransform( context );
        context.fillText( 'This is a test string', 0, 0 );
        
        // return step function
        return function( timeElapsed ) {
            
        }
    };
    
    phet.tests.textBoundTesting = function( main ) {
        // maybe getBoundingClientRect(), after appending with position: absolute top: 0, left: 0?
        // offsetWidth / offsetHeight? -- try positioning absolutely, left0top0, then also check offsetLeft, offsetTop -- similar to getBoundingClientRect()
    };
})();

// Copyright 2002-2013, University of Colorado

/**
 * An instance that is specific to the display (not necessarily a global instance, could be in a Canvas cache, etc),
 * that is needed to tracking instance-specific display information, and signals to the display system when other
 * changes are necessary.
 *
 **********************
 * Relative transform system description:
 *
 * A "relative" transform here is the transform that a Trail would have, not necessarily rooted at the display's root. Imagine we have a
 * CSS-transformed backbone div, and nodes underneath that render to Canvas. On the Canvas, we will need to set the context's transform to
 * the matrix that will transform from the displayed instances' local coordinates frames to the CSS-transformed backbone instance. Notably,
 * transforming the backbone instance or any of its ancestors does NOT affect this "relative" transform from the instance to the displayed
 * instances, while any Node transform changes between (not including) the backbone instance and (including) the displayed instance WILL
 * affect that relative transform. This is key to setting the CSS transform on backbones, DOM nodes, having the transforms necessary for
 * the fastest Canvas display, and determining fitting bounds for layers.
 *
 * Each DisplayInstance has its own "relative trail", although these aren't stored. We use implicit hierarchies in the DisplayInstance tree
 * for this purpose. If a DisplayInstance is a CSS-transformed backbone, or any other case that requires drawing beneath to be done relative
 * to its local coordinate frame, we call it a transform "root", and it has instance.isTransformed set to true. This should NEVER change for
 * an instance (any changes that would do this require reconstructing the instance tree).
 *
 * There are implicit hierarchies for each root, with trails starting from that root's children (they won't apply that root's transform since
 * we assume we are working within that root's local coordinate frame). These should be effectively independent (if there are no bugs), so that
 * flags affecting one implicit hierarchy will not affect the other (dirty flags, etc.), and traversals should not cross these boundaries.
 * 
 * For various purposes, we want a system that can:
 * - every frame before repainting: notify listeners on instances whether its relative transform has changed (add|removeRelativeTransformListener)
 * - every frame before repainting: precompute relative transforms on instances where we know this is required (add|removeRelativeTransformPrecompute)
 * - any time during repainting:    provide an efficient way to lazily compute relative transforms when needed
 *
 * This is done by first having one step in the pre-repaint phase that traverses the tree where necessary, notifying relative transform listeners,
 * and precomputing relative transforms when they have changed (and precomputation is requested). This traversal leaves metadata on the instances
 * so that we can (fairly) efficiently force relative transform "validation" any time afterwards that makes sure the relativeMatrix property is up-to-date.
 *
 * First of all, to ensure we traverse the right parts of the tree, we need to keep metadata on what needs to be traversed. This is done by tracking counts
 * of listeners/precompution needs, both on the instance itself, and how many children have these needs. We use counts instead of boolean flags so that we can
 * update this quickly while (a) never requiring full children scans to update this metadata, and (b) minimizing the need to traverse all the way up to the root
 * to update the metadata. The end result is hasRelativeTransformListenerNeed and hasRelativeTransformComputeNeed which compute, respectively, whether we need
 * to traverse this instance for listeners and precomputation.
 *
 * The other tricky bits to remember for this traversal are the flags it sets, and how later validation uses and updates these flags.
 * First of all, we have relativeSelfDirty and relativeChildDirtyFrame. When a node's transform changes, we mark relativeSelfDirty on the node, and
 * relativeChildDirtyFrame for all ancestors up to (and including) the transform root. relativeChildDirtyFrame allows us to prune our traversal to only
 * modified subtrees. Additionally, so that we can retain the invariant that it is "set" parent node if it is set on a child, we store the rendering frame
 * ID (unique to traversals) instead of a boolean true/false. Our traversal may skip subtrees where relativeChildDirtyFrame is "set" due to no listeners
 * or precomputation needed for that subtree, so if we used booleans this would be violated. Violating that invariant would prevent us from "bailing out" when
 * setting the relativeChildDirtyFrame flag, and on EVERY transform change we would have to traverse ALL of the way to the root (instead of the efficient
 * "stop at the ancestor where it is also set").
 *
 * relativeSelfDirty is initially set on instances whose nodes had transform changes (they mark that this relative transform, and all transforms beneath, are dirty).
 * We maintain the invariant that if a relative transform needs to be recomputed, it or one of its ancestors WILL ALWAYS have this flag set. This is required
 * so that later validation of the relative transform can verify whether it has been changed in an efficient way. When we recompute the relative transform for one
 * instance, we have to set this flag on all children to maintain this invariant.
 *
 * Additionally, so that we can have fast "validation" speed, we also store into relativeFrameId the last rendering frame ID (counter) where we either verified that
 * the relative transform is up to date, or we have recomputed it. Thus when "validating" a relative transform that wasn't precomputed, we only need to scan up
 * the ancestors to the first one that was verified OK this frame (boolean flags are insufficient for this, since we would have to clear them all to false on every
 * frame, requiring a full tree traversal). In the future, we may set this flag to the frame proactively during traversal to speed up validation, but that is not done
 * at the time of this writing.
 **********************
 *
 * @author Jonathan Olson <olsonsjc@gmail.com>
 */

define( function( require ) {
  'use strict';
  
  var inherit = require( 'PHET_CORE/inherit' );
  var scenery = require( 'SCENERY/scenery' );
  var Matrix3 = require( 'DOT/Matrix3' );
  
  var globalIdCounter = 1;
  
  // TODO: handle allocations
  scenery.DisplayInstance = function DisplayInstance( display, trail ) {
    this.id = globalIdCounter++;
    this.display = display;
    this.trail = trail;
    this.node = trail.lastNode();
    this.parent = null; // will be set as needed
    this.children = [];
    this.childrenTracks = []; // TODO use this for tracking what children changes occurred, and thus where we need to stitch
    
    this.state = null; // filled in with rendering state later
    this.block = null; // filled in with a block if applicable (backbone at least, probably canvas multicache for sure also)
    
    this.selfDrawable = null;
    this.groupDrawable = null; // e.g. backbone or non-shared cache
    this.sharedCacheDrawable = null;
    
    // references into the linked list of drawables (null if nothing is drawable under this)
    this.firstDrawable = null;
    this.lastDrawable = null;
    
    // properties relevant to the "relative" transform to the closest transform root. Please see detailed docs at the top of the file!
    this.isTransformed = false;               // whether this instance creates a new "root" for the relative trail transforms
    this.relativeMatrix = new Matrix3();      // the actual cached transform to the root
    this.relativeSelfDirty = true;            // whether our relativeMatrix is dirty
    this.relativeChildDirtyFrame = -1;        // Whether children have dirty transforms (if it is the current frame) NOTE: used only for pre-repaint traversal,
                                              // and can be ignored if it has a value less than the current frame ID. This allows us to traverse and hit all listeners
                                              // for this particular traversal, without leaving an invalid subtree (a boolean flag here is insufficient, since our
                                              // traversal handling would validate our invariant of this.relativeChildDirtyFrame => parent.relativeChildDirtyFrame).
                                              // In this case, they are both effectively "false" unless they are the current frame ID, in which case that invariant holds.
    this.relativeTransformListeners = [];     // will be notified in pre-repaint phase that our relative transform has changed (but not computed by default)
    this.relativeChildrenListenersCount = 0;  // how many children have (or have descendants with) relativeTransformListeners
    this.relativePrecomputeCount = 0;         // if >0, indicates this should be precomputed in the pre-repaint phase
    this.relativeChildrenPrecomputeCount = 0; // how many children have (or have descendants with) >0 relativePrecomputeCount
    this.relativeFrameId = -1;                // used to mark what frame the transform was updated in (to accelerate non-precomputed relative transform access)
    
    // properties relevant to the node's direct transform
    this.transformDirty = true;               // whether the node's transform has changed (until the pre-repaint phase)
    // throw new Error( 'figure out transform listeners and flags here - immediate wanted? - error everywhere it was used' );
    // this.transformListeners = [];
    
    this.nodeTransformListener = this.markTransformDirty.bind( this );
    this.node.addEventListener( 'transform', this.nodeTransformListener );
  };
  var DisplayInstance = scenery.DisplayInstance;
  
  inherit( Object, DisplayInstance, {
    appendInstance: function( instance ) {
      this.children.push( instance );
      
      if ( instance.relativeTransformListeners.length || instance.relativeChildrenListenersCount ) {
        this.incrementTransformListenerChildren();
      }
      
      // mark the instance's transform as dirty, so that it will be reachable in the pre-repaint traversal pass
      instance.markTransformDirty();
    },
    
    removeInstance: function( instance ) {
      this.children.splice( _.indexOf( this.children, instance ), 1 ); // TODO: replace with a 'remove' function call
      
      if ( instance.relativeTransformListeners.length || instance.relativeChildrenListenersCount ) {
        this.decrementTransformListenerChildren();
      }
    },
    
    /*---------------------------------------------------------------------------*
    * Relative transform listener count recursive handling
    *----------------------------------------------------------------------------*/
    
    hasRelativeTransformListenerNeed: function() {
      // TODO: consider adding a separate count to speed this up
      return this.relativeChildrenListenersCount > 0 || this.relativeTransformListeners.length > 0;
    },
    incrementTransformListenerChildren: function() {
      this.relativeChildrenListenersCount++;
      if ( !this.isTransformed && this.relativeChildrenListenersCount === 1 && this.relativeTransformListeners.length === 0 ) {
        this.parent && this.parent.incrementTransformListenerChildren();
      }
    },
    decrementTransformListenerChildren: function() {
      this.relativeChildrenListenersCount--;
      if ( !this.isTransformed && this.relativeChildrenListenersCount === 0 && this.relativeTransformListeners.length === 0 ) {
        this.parent && this.parent.decrementTransformListenerChildren();
      }
    },
    addRelativeTransformListener: function( listener ) {
      this.relativeTransformListeners.push( listener );
      if ( !this.isTransformed && this.relativeTransformListeners.length === 1 && this.relativeChildrenListenersCount === 0 ) {
        this.parent && this.parent.incrementTransformListenerChildren();
      }
    },
    removeRelativeTransformListener: function( listener ) {
      this.relativeTransformListeners.splice( _.indexOf( this.relativeTransformListeners, listener ), 1 ); // TODO: replace with a 'remove' function call
      if ( !this.isTransformed && this.relativeTransformListeners.length === 0 && this.relativeChildrenListenersCount === 0 ) {
        this.parent && this.parent.decrementTransformListenerChildren();
      }
    },
    
    /*---------------------------------------------------------------------------*
    * Relative transform precompute flag recursive handling
    *----------------------------------------------------------------------------*/
    
    hasRelativeTransformComputeNeed: function() {
      // TODO: consider adding a separate count to speed this up
      return this.relativeChildrenPrecomputeCount > 0 || this.relativePrecomputeCount > 0;
    },
    incrementTransformPrecomputeChildren: function() {
      this.relativeChildrenPrecomputeCount++;
      if ( !this.isTransformed && this.relativeChildrenPrecomputeCount === 1 && this.relativePrecomputeCount === 0 ) {
        this.parent && this.parent.incrementTransformPrecomputeChildren();
      }
    },
    decrementTransformPrecomputeChildren: function() {
      this.relativeChildrenPrecomputeCount--;
      if ( !this.isTransformed && this.relativeChildrenPrecomputeCount === 0 && this.relativePrecomputeCount === 0 ) {
        this.parent && this.parent.decrementTransformPrecomputeChildren();
      }
    },
    addRelativeTransformPrecompute: function() {
      this.relativePrecomputeCount++;
      if ( !this.isTransformed && this.relativePrecomputeCount === 1 && this.relativeChildrenPrecomputeCount === 0 ) {
        this.parent && this.parent.incrementTransformPrecomputeChildren();
      }
    },
    removeRelativeTransformPrecompute: function() {
      this.relativePrecomputeCount--;
      if ( !this.isTransformed && this.relativePrecomputeCount === 0 && this.relativeChildrenPrecomputeCount === 0 ) {
        this.parent && this.parent.decrementTransformPrecomputeChildren();
      }
    },
    
    /*---------------------------------------------------------------------------*
    * Relative transform handling
    *----------------------------------------------------------------------------*/
    
    // called immediately when the corresponding node has a transform change (can happen multiple times between renders)
    markTransformDirty: function() {
      if ( !this.transformDirty ) {
        this.transformDirty = true;
        this.relativeSelfDirty = true;
        
        var frameId = this.display._frameId;
        
        // mark all ancestors with relativeChildDirtyFrame, bailing out when possible
        var node = this.parent;
        while ( node && node.relativeChildDirtyFrame !== frameId ) {
          node.relativeChildDirtyFrame = frameId;
          node = node.parent;
          
          // don't run outside of our current root
          if ( node.isTransformed ) {
            break;
          }
        }
      }
    },
    
    // updates our relativeMatrix based on any parents, and the node's current transform
    computeRelativeTransform: function() {
      var nodeMatrix = this.node.getTransform().getMatrix();
      
      if ( this.parent && !this.parent.isTransformed ) {
        // mutable form of parentMatrix * nodeMatrix
        this.relativeMatrix.set( this.parent.relativeMatrix );
        this.relativeMatrix.multiplyMatrix( nodeMatrix );
      } else {
        // we are the first in the trail transform, so we just directly copy the matrix over
        this.relativeMatrix.set( nodeMatrix );
      }
      
      // mark the frame where this transform was updated, to accelerate non-precomputed access
      this.relativeFrameId = this.display._frameId;
      this.relativeSelfDirty = false;
    },
    
    // Called from any place in the rendering process where we are not guaranteed to have a fresh relative transform. needs to scan up the tree, so it is
    // more expensive than precomputed transforms.
    // returns whether we had to update this transform
    validateRelativeTransform: function() {
      // if we are clean, bail out. If we have a compute "need", we will always be clean here since this is after the traversal step.
      // if we did not have a compute "need", we check whether we were already updated this frame by computeRelativeTransform
      if ( this.hasRelativeTransformComputeNeed() || this.relativeFrameId === this.display._frameId ) {
        return;
      }
      
      // if we are not the first transform from the root, validate our parent. isTransform check prevents us from passing a transform root
      if ( this.parent && !this.parent.isTransformed ) {
        this.parent.validateRelativeTransform();
      }
      
      // validation of the parent may have changed our relativeSelfDirty flag to true, so we check now (could also have been true before)
      if ( this.relativeSelfDirty ) {
        // compute the transform, and mark us as not relative-dirty
        this.computeRelativeTransform();
        
        // mark all children now as dirty, since we had to update (marked so that other children from the one we are validating will know that they need updates)
        // if we were called from a child's validateRelativeTransform, they will now need to compute their transform
        var len = this.children.length;
        for ( var i = 0; i < len; i++ ) {
          this.children[i].relativeSelfDirty = true;
        }
      }
    },
    
    // called during the pre-repaint phase to (a) fire off all relative transform listeners that should be fired, and (b) precompute transforms were desired
    updateTransformListenersAndCompute: function( ancestorWasDirty, ancestorIsDirty, frameId ) {
      var wasDirty = ancestorWasDirty || this.relativeSelfDirty;
      var wasSubtreeDirty = wasDirty || this.relativeChildDirtyFrame === frameId;
      var hasComputeNeed = this.hasRelativeTransformComputeNeed();
      var hasListenerNeed = this.hasRelativeTransformListenerNeed();
      
      // if our relative transform will be dirty but our parents' transform will be clean,  we need to mark ourselves as dirty (so that later access can identify we are dirty).
      if ( !hasComputeNeed && wasDirty && !ancestorIsDirty ) {
        this.relativeSelfDirty = true;
      }
      
      // check if traversal isn't needed (no instances marked as having listeners or needing computation)
      // either the subtree is clean (no traversal needed for compute/listeners), or we have no compute/listener needs
      if ( !wasSubtreeDirty || ( !hasComputeNeed && !hasListenerNeed ) ) {
        return;
      }
      
      // if desired, compute the transform
      if ( wasDirty && hasComputeNeed ) {
        // compute this transform in the pre-repaint phase, so it is cheap when always used/
        // we update when the child-precompute count >0, since those children will need 
        this.computeRelativeTransform();
      }
      
      if ( this.transformDirty ) {
        this.transformDirty = false;
        // throw new Error( 'ack, traversal for this is bad - do it somewhere global, and figure out if instead we want immediate listeners only' );
        // this.notifyTransformListeners();
      }
      
      // no hasListenerNeed guard needed?
      this.notifyRelativeTransformListeners();
      
      // only update children if we aren't transformed (completely other context)
      if ( !this.isTransformed ) {
        
        var isDirty = wasDirty && !hasComputeNeed;
        
        // continue the traversal
        var len = this.children.length;
        for ( var i = 0; i < len; i++ ) {
          this.children[i].updateTransformListenersAndCompute( wasDirty, isDirty, frameId );
        }
      }
    },
    
    notifyTransformListeners: function() {
      // throw new Error( 'ack, traversal for this is bad - do it somewhere global, and figure out if instead we want immediate listeners only' );
      // var len = this.transformListeners.length;
      // for ( var i = 0; i < len; i++ ) {
      //   this.transformListeners[i]();
      // }
    },
    
    notifyRelativeTransformListeners: function() {
      var len = this.relativeTransformListeners.length;
      for ( var i = 0; i < len; i++ ) {
        this.relativeTransformListeners[i]();
      }
    },
    
    /*---------------------------------------------------------------------------*
    * Miscellaneous
    *----------------------------------------------------------------------------*/
    
    // clean up listeners and garbage, so that we can be recycled (or pooled)
    dispose: function() {
      this.node.removeEventListener( 'transform', this.nodeTransformListener );
    }
  } );
  
  return DisplayInstance;
} );

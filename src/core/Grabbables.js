import * as THREE from 'three';

/**
 * Grabbables — grip-to-grab, swing-and-release throwing.
 *
 * Register any object (balls, darts, mallets…) with `add()`. The system
 * handles both XR hands and the desktop virtual hand:
 *  - XR: squeeze/trigger near an object grabs it, releasing throws it with
 *    the controller's recent velocity (see Input.computeThrowVelocity).
 *  - Desktop: click grabs the nearest object in front of the camera,
 *    clicking again throws it along the view direction.
 *
 * A grabbable with a physics `body` gets its body disabled while held and
 * re-enabled with the throw velocity on release. Objects without a body
 * (darts) receive the velocity via their `onThrow` callback instead.
 */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

const VR_REACH = 0.16;       // metres from grip centre
const DESKTOP_REACH = 1.4;   // desktop arm is longer for playability

export class Grabbable {
  constructor(object, opts = {}) {
    this.object = object;
    this.radius = opts.radius ?? 0.08;   // pick-up sphere around the object
    this.body = opts.body ?? null;       // SphereBody (optional)
    this.enabled = true;
    this.heldBy = null;
    // pose of the object relative to the hand while held (darts point forward)
    this.holdPosition = opts.holdPosition ?? new THREE.Vector3(0, 0, -0.03);
    this.holdQuaternion = opts.holdQuaternion ?? new THREE.Quaternion();
    /** throw assist multiplier — casual flicks should still reach the targets */
    this.throwBoost = opts.throwBoost ?? 1.3;
    this.onGrab = opts.onGrab ?? null;
    /** (velocity: Vector3, hand) — called on release for bodiless objects */
    this.onThrow = opts.onThrow ?? null;
  }
}

export class Grabbables {
  /**
   * @param {import('./World.js').World} world
   * @param {import('./Input.js').Input} input
   * @param {import('./AudioManager.js').AudioManager} audio
   */
  constructor(world, input, audio) {
    this.world = world;
    this.input = input;
    this.audio = audio;
    this.items = [];
    this.held = [null, null]; // per hand index
    world.onUpdate(() => this.#update());
  }

  add(object, opts) {
    const g = new Grabbable(object, opts);
    this.items.push(g);
    return g;
  }

  remove(g) {
    const i = this.items.indexOf(g);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** Force-drop whatever a hand is holding (no throw). */
  drop(handIndex) {
    const g = this.held[handIndex];
    if (!g) return;
    g.heldBy = null;
    this.held[handIndex] = null;
    if (g.body) {
      g.object.getWorldPosition(g.body.position);
      g.body.velocity.set(0, 0, 0);
      g.body.enabled = true;
      g.body.wake();
    }
  }

  #update() {
    const { hands, isXR } = this.input;
    for (const hand of hands) {
      if (!hand.connected) continue;
      const idx = hand.index;
      const holding = this.held[idx];

      if (hand.justGrabbed) {
        if (!holding) {
          this.#tryGrab(hand);
        } else if (!isXR) {
          // desktop: second click = throw forward
          this.#release(hand, /*desktopThrow*/ true);
        }
      }
      if (hand.justReleased && holding && isXR) {
        this.#release(hand, false);
      }
      // follow the hand while held
      const g = this.held[idx];
      if (g) {
        g.object.position.copy(g.holdPosition).applyQuaternion(hand.gripQuaternion)
          .add(hand.gripPosition);
        g.object.quaternion.copy(hand.gripQuaternion).multiply(g.holdQuaternion);
      }
    }
  }

  #tryGrab(hand) {
    const reach = this.input.isXR ? VR_REACH : DESKTOP_REACH;
    let best = null, bestD = Infinity;
    for (const g of this.items) {
      if (!g.enabled || g.heldBy) continue;
      g.object.getWorldPosition(_v1);
      const d = _v1.distanceTo(hand.gripPosition) - g.radius;
      if (d < reach && d < bestD) { best = g; bestD = d; }
    }
    if (!best) return;
    best.heldBy = hand;
    this.held[hand.index] = best;
    if (best.body) best.body.enabled = false;
    // reparent to scene root so rig motion doesn't double-transform
    this.world.scene.attach(best.object);
    hand.pulse(0.4, 30);
    if (best.onGrab) best.onGrab(hand);
  }

  #release(hand, desktopThrow) {
    const g = this.held[hand.index];
    if (!g) return;
    g.heldBy = null;
    this.held[hand.index] = null;

    // throw velocity
    if (desktopThrow) {
      // camera forward * speed + a touch of arc
      this.world.camera.getWorldDirection(_v1).multiplyScalar(7.5);
      _v1.y += 1.2;
    } else {
      hand.computeThrowVelocity(_v1);
      _v1.multiplyScalar(g.throwBoost);
    }

    if (g.body) {
      g.object.getWorldPosition(_v2);
      g.body.position.copy(_v2);
      g.body.velocity.copy(_v1);
      g.body.enabled = true;
      g.body.wake();
    }
    if (g.onThrow) g.onThrow(_v1.clone(), hand);
    hand.pulse(0.25, 20);
  }
}

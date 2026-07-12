import * as THREE from 'three';
import { REST_PITCH_DEG } from './Hands.js';

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
 * HOLDING IS NATURAL BY DEFAULT: grabbing captures the object's pose
 * relative to the hand at that instant, and the object rides the wrist from
 * there — pick a ball up sideways and it stays sideways in your fingers
 * until you turn it, exactly like lifting any real object. (Only the
 * POSITION eases toward the hand over a few frames, so a long-armed desktop
 * grab doesn't leave the object floating half a metre from the hand.)
 *
 * A grabbable can opt OUT of natural orientation with `holdQuat`: over the
 * same settle it swings into a canned hand-local pose. Darts use this —
 * however you pluck one from the tray it seats itself nose-out over the
 * fingertips, in the classic pinch grip, ready to throw (paired with the
 * glove's holdPose: 'pinch', see Hands.js).
 *
 * WHERE it settles is `holdOffset` — anatomical metres out of the palm /
 * along the fingers / out of the fist top, converted per hand by
 * #holdAnchor. Crucially the XR grip-space ORIGIN is the centroid of the
 * fist, so anchoring anywhere near (0,0,0) buries the object inside the
 * glove mesh; real objects sit against the palm surface and in the curled
 * fingers, a few centimetres out along the palm normal.
 *
 * A grabbable with a physics `body` gets its body disabled while held and
 * re-enabled with the throw velocity on release. Objects without a body
 * (darts) receive the velocity via their `onThrow` callback instead.
 *
 * TOOLS THAT FIRE WHILE HELD (the gallery six-shooters) set
 * `onTriggerFire`: in XR every trigger edge while holding calls it (the
 * edge that performed the grab itself doesn't also fire), and on desktop
 * a click while holding fires instead of throwing. Pair it with
 * `gripRelease: true` so only letting go of the SQUEEZE drops the object —
 * without it, a player who grabbed the gun with the trigger would drop it
 * on their first shot's release.
 */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

const VR_REACH = 0.16;       // metres from grip centre
const DESKTOP_REACH = 1.4;   // desktop arm is longer for playability
const SETTLE_TIME = 0.18;    // s for the grab point to ease into the hand

// the glove rides the grip pitched up REST_PITCH_DEG (see Hands.js), so the
// finger/fist-top hold directions pitch with it
const PITCH = THREE.MathUtils.degToRad(REST_PITCH_DEG);
const COS_P = Math.cos(PITCH), SIN_P = Math.sin(PITCH);
// desktop glove display offset + scale, mirrored from Hands.js #update
const DESKTOP_GLOVE_OFFSET = new THREE.Vector3(0.05, -0.05, 0);
const DESKTOP_GLOVE_SCALE = 0.8;

const _X = new THREE.Vector3(1, 0, 0);

/**
 * Canned hold orientation for an object modelled nose-along--Z (darts):
 * the nose runs out along the glove's finger axis, tipped back up toward
 * the fist top by noseUpDeg. In XR grip space the finger axis lies 90° -
 * REST_PITCH below the fist-top -Z, so the swing is a rotation about grip
 * X — the palm-normal axis, which is the same axis for both hands, so one
 * pair of quats mirrors correctly. On desktop the hand frame IS glove
 * model space (fingers along -Z), so the nose maps straight to -Z.
 */
export function noseOutHoldQuat(noseUpDeg = 0) {
  const up = THREE.MathUtils.degToRad(noseUpDeg);
  return {
    xr: new THREE.Quaternion().setFromAxisAngle(_X, -(Math.PI / 2 - PITCH - up)),
    desktop: new THREE.Quaternion().setFromAxisAngle(_X, up),
    noseUpDeg,   // kept so the DartGripTuner's reset restores the shipped angle
  };
}

export class Grabbable {
  constructor(object, opts = {}) {
    this.object = object;
    this.radius = opts.radius ?? 0.08;   // pick-up sphere around the object
    this.body = opts.body ?? null;       // SphereBody (optional)
    this.enabled = true;
    this.heldBy = null;
    /**
     * Where the object settles in the hand (position only — orientation is
     * always whatever it was when grabbed), in anatomical metres:
     *   palm    — out of the palm surface, into the curled fingers
     *   fingers — from the fist centre toward the fingertips
     *   up      — out of the top of the fist (thumb side in a handshake)
     * Mirrored automatically for the left hand by #holdAnchor.
     */
    this.holdOffset = { palm: 0.05, fingers: 0.02, up: 0, ...(opts.holdOffset ?? {}) };
    /** finger curl while holding this (0..1) — fat objects keep a wider fist */
    this.holdCurl = opts.holdCurl ?? 0.72;
    /**
     * Optional canned hand-local orientation `{ xr, desktop }` (see
     * noseOutHoldQuat). When set, the object swings from its grabbed pose
     * into this one as the grab settles instead of riding the wrist in
     * whatever orientation it was picked up in.
     */
    this.holdQuat = opts.holdQuat ?? null;
    /** named glove pose while held ('pinch' for darts) — read by Hands */
    this.holdPose = opts.holdPose ?? null;
    /** throw assist multiplier — casual flicks should still reach the targets */
    this.throwBoost = opts.throwBoost ?? 1.3;
    this.onGrab = opts.onGrab ?? null;
    /** (velocity: Vector3, hand) — called on release for bodiless objects */
    this.onThrow = opts.onThrow ?? null;
    /** (hand) — trigger edge while held fires the tool instead of nothing;
     *  on desktop, click-while-holding fires instead of throwing */
    this.onTriggerFire = opts.onTriggerFire ?? null;
    /** XR: only releasing the grip squeeze lets go (trigger taps never drop) */
    this.gripRelease = opts.gripRelease ?? false;
    this._grabbedThisFrame = false;
    // captured at grab time: hand-local pose of the object
    this._grabQuat = new THREE.Quaternion();
    this._grabPos = new THREE.Vector3();
    this._settle = 1;
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
    this._prevGrip = [false, false]; // squeeze state last frame (gripRelease)
    world.onUpdate((dt) => this.#update(dt));
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

  #update(dt) {
    const { hands, isXR } = this.input;
    for (const hand of hands) {
      if (!hand.connected) continue;
      const idx = hand.index;
      const holding = this.held[idx];

      // hover affordance: the glove's cuff lights up (and ticks once) when
      // something grabbable is in reach of an empty hand
      const wasHover = hand.hoverGrab;
      hand.hoverGrab = !holding && !!this.#findNearest(hand);
      if (hand.hoverGrab && !wasHover && isXR) hand.pulse(0.15, 12);

      if (hand.justGrabbed) {
        if (!holding) {
          this.#tryGrab(hand);
        } else if (!isXR) {
          // desktop: second click = fire the held tool, or throw forward
          if (holding.onTriggerFire) holding.onTriggerFire(hand);
          else this.#release(hand, /*desktopThrow*/ true);
        }
      }
      if (hand.justReleased && holding && isXR && !holding.gripRelease) {
        this.#release(hand, false);
      }
      // held tools: trigger edges fire; gripRelease items only leave the
      // hand when the squeeze is released (so shooting never drops the gun)
      const tool = this.held[idx];
      if (tool && isXR) {
        if (tool.onTriggerFire && hand.justTriggered && !tool._grabbedThisFrame) {
          tool.onTriggerFire(hand);
        }
        if (tool.gripRelease && this._prevGrip[idx] && !hand.gripPressed) {
          this.#release(hand, false);
        }
      }
      if (tool) tool._grabbedThisFrame = false;
      this._prevGrip[idx] = hand.gripPressed;
      // follow the hand while held: the pose captured at grab time rides
      // the wrist 1:1 — turn your hand, the object turns with it. A
      // holdQuat overrides that: the object swings into its canned grip
      // orientation over the same settle as the position.
      const g = this.held[idx];
      if (g) {
        g._settle = Math.min(1, g._settle + dt / SETTLE_TIME);
        const k = g._settle * (2 - g._settle); // ease-out
        _v1.lerpVectors(g._grabPos, this.#holdAnchor(g, hand, _v2), k);
        g.object.position.copy(_v1).applyQuaternion(hand.gripQuaternion)
          .add(hand.gripPosition);
        g.object.quaternion.copy(hand.gripQuaternion);
        if (g.holdQuat) {
          const snap = this.input.isXR ? g.holdQuat.xr : g.holdQuat.desktop;
          g.object.quaternion.multiply(_q1.copy(g._grabQuat).slerp(snap, k));
        } else {
          g.object.quaternion.multiply(g._grabQuat);
        }
      }
    }
  }

  /**
   * Hand-local point the held object settles to, from its anatomical
   * holdOffset. XR grip space (see the GRIP_ALIGN notes in Hands.js) puts
   * the ORIGIN at the fist centroid with ±X the palm normal — +X for the
   * left hand, -X for the right — -Y running out past the knuckles and -Z
   * out of the fist top; the visible glove is pitched up REST_PITCH_DEG on
   * top of that, so the finger/up directions here pitch with it. The
   * desktop hand is the camera frame with the glove drawn palm-down at a
   * small display offset — same anatomy, different axes.
   */
  #holdAnchor(g, hand, out) {
    const { palm, fingers, up } = g.holdOffset;
    if (this.input.isXR) {
      const px = hand.handedness === 'left' ? 1 : -1;
      return out.set(
        px * palm,
        -fingers * COS_P + up * SIN_P,
        -fingers * SIN_P - up * COS_P,
      );
    }
    // desktop glove: the hand frame IS glove model space, so the anatomy
    // maps exactly — palm faces -Y, fingers reach -Z, and the fist-top
    // "up" axis (the thumb side of a handshake grip) is -X of the right
    // glove the desktop hand always wears
    return out.copy(DESKTOP_GLOVE_OFFSET).add(_v1.set(
      -up * DESKTOP_GLOVE_SCALE,
      -palm * DESKTOP_GLOVE_SCALE,
      -fingers * DESKTOP_GLOVE_SCALE));
  }

  /** nearest free grabbable within this hand's reach, or null */
  #findNearest(hand) {
    const reach = this.input.isXR ? VR_REACH : DESKTOP_REACH;
    let best = null, bestD = Infinity;
    for (const g of this.items) {
      if (!g.enabled || g.heldBy) continue;
      g.object.getWorldPosition(_v1);
      const d = _v1.distanceTo(hand.gripPosition) - g.radius;
      if (d < reach && d < bestD) { best = g; bestD = d; }
    }
    return best;
  }

  #tryGrab(hand) {
    const best = this.#findNearest(hand);
    if (!best) return;
    best.heldBy = hand;
    this.held[hand.index] = best;
    if (best.body) best.body.enabled = false;
    // reparent to scene root so rig motion doesn't double-transform
    // (attach() preserves the world pose)
    this.world.scene.attach(best.object);
    // capture the object's pose in hand space AT THIS INSTANT — this is
    // what makes holding feel like picking up a real object: whatever
    // orientation you grabbed it in is the orientation it keeps
    _q1.copy(hand.gripQuaternion).invert();
    best._grabQuat.copy(_q1).multiply(best.object.quaternion);
    best._grabPos.copy(best.object.position).sub(hand.gripPosition).applyQuaternion(_q1);
    best._settle = 0;
    best._grabbedThisFrame = true; // the grabbing trigger edge mustn't also fire
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

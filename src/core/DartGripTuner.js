import * as THREE from 'three';
import { noseOutHoldQuat } from './Grabbables.js';

/**
 * DartGripTuner — tune the dart's hold pose FROM INSIDE the headset.
 *
 * The hand-lab page (/hand-lab.html) is great on a desktop browser but
 * useless mid-session on a Quest, so this brings the same knobs in-VR:
 *
 *   1. Hold a dart (any grabbable with holdPose 'pinch').
 *   2. SQUEEZE THE GRIP on your empty other hand — a numbers panel fades
 *      in above the dart and that hand's thumbstick starts nudging the
 *      dart around inside your grip:
 *        stick alone      →  x: side-to-side (up)   y: forward/back (fingers)
 *        stick + TRIGGER  →  y: out of palm (palm)  x: nose pitch (noseUp°)
 *        A / X button     →  reset to the shipped numbers
 *   3. Values apply to every dart live, persist in localStorage (so they
 *      survive re-entering VR) and stay on the panel while you hold a
 *      dart — read them off and bake the keepers into BalloonDartGame's
 *      holdOffset / noseOutHoldQuat and, if the pose itself needs work,
 *      PINCH in Hands.js.
 *
 * While the tuner owns a thumbstick it sets hand.stickClaimed, which
 * Locomotion honours — adjusting the grip never walks or snap-turns you.
 * XR-only; the desktop surface has the hand-lab.
 */

const STORE_KEY = 'carnival.dartGrip.v1';
const MOVE_RATE = 0.03;      // m/s at full stick — slow enough for mm work
const NOSE_RATE = 30;        // deg/s
const DEAD = 0.15;
const LIMITS = {
  palm: [0, 0.12], fingers: [-0.02, 0.12], up: [-0.05, 0.10], noseUp: [-45, 45],
};

const _v1 = new THREE.Vector3();

export class DartGripTuner {
  /**
   * @param {import('./World.js').World} world
   * @param {import('./Input.js').Input} input
   * @param {import('./Grabbables.js').Grabbables} grabbables
   */
  constructor(world, input, grabbables) {
    this.world = world;
    this.input = input;
    this.grabbables = grabbables;
    this.values = null;    // { palm, fingers, up, noseUp } once initialised
    this.defaults = null;  // shipped numbers, for the reset button
    this._panel = null;
    this._dirty = false;   // values changed since last canvas redraw
    this._saveAt = 0;      // throttle localStorage writes
    this._used = false;    // keep the panel up while a dart is held
    world.onUpdate((dt, t) => this.#update(dt, t));
  }

  /** all pinch-held grabbables (darts) — the things this tuner adjusts */
  #targets() {
    return this.grabbables.items.filter((g) => g.holdPose === 'pinch');
  }

  #lazyInit() {
    if (this.values) return true;
    const first = this.#targets()[0];
    if (!first) return false;
    this.defaults = { ...first.holdOffset, noseUp: 0 };
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { /* corrupt = ignore */ }
    this.values = { ...this.defaults, ...(saved ?? {}) };
    if (saved) this.#apply();
    return true;
  }

  #apply() {
    const v = this.values;
    for (const g of this.#targets()) {
      g.holdOffset.palm = v.palm;
      g.holdOffset.fingers = v.fingers;
      g.holdOffset.up = v.up;
      g.holdQuat = noseOutHoldQuat(v.noseUp);
    }
    this._dirty = true;
  }

  #save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.values)); } catch { /* full = ignore */ }
  }

  #update(dt, t) {
    if (!this.input.isXR || !this.#lazyInit()) {
      if (this._panel) this._panel.visible = false;
      return;
    }

    // who's holding a dart, and which hand is free to tune with?
    let heldHand = null, freeHand = null;
    for (const hand of this.input.hands) {
      if (!hand.connected) continue;
      const g = this.grabbables.held[hand.index];
      if (g?.holdPose === 'pinch') heldHand = hand;
      else if (!g) freeHand = hand;
    }
    const active = heldHand && freeHand && freeHand.gripValue > 0.5;

    if (active) {
      this._used = true;
      freeHand.stickClaimed = true;   // Locomotion skips this stick
      const x = Math.abs(freeHand.stick.x) > DEAD ? freeHand.stick.x : 0;
      const y = Math.abs(freeHand.stick.y) > DEAD ? freeHand.stick.y : 0;
      const v = this.values;
      if (freeHand.triggerValue > 0.5) {
        v.palm += -y * MOVE_RATE * dt;      // stick forward = out of the palm
        v.noseUp += x * NOSE_RATE * dt;
      } else {
        v.up += x * MOVE_RATE * dt;         // toward/away from the thumb side
        v.fingers += -y * MOVE_RATE * dt;   // stick forward = past the fingertips
      }
      for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
        v[k] = THREE.MathUtils.clamp(v[k], lo, hi);
      }
      // A/X on the tuning hand: back to the shipped grip
      if (freeHand._inputSource?.gamepad?.buttons?.[4]?.pressed) {
        Object.assign(v, this.defaults);
      }
      if (x || y) this.#apply();
      if (t > this._saveAt) { this.#save(); this._saveAt = t + 0.5; }
    }

    // panel: visible while tuning, and stays up while the dart is held
    // once the tuner has been used, so the numbers can be read at leisure
    const show = active || (this._used && !!heldHand);
    if (show) {
      const p = this.#panel();
      p.visible = true;
      p.position.copy(heldHand.gripPosition);
      p.position.y += 0.22;
      p.lookAt(this.world.camera.getWorldPosition(_v1));
      if (this._dirty) this.#draw(active);
    } else if (this._panel) {
      if (this._panel.visible && !active) this.#save();
      this._panel.visible = false;
    }
  }

  /* -------------------------------------------------- floating panel ---- */

  #panel() {
    if (this._panel) return this._panel;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 300;
    this._ctx = canvas.getContext('2d');
    this._tex = new THREE.CanvasTexture(canvas);
    this._tex.colorSpace = THREE.SRGBColorSpace;
    this._panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.152),
      new THREE.MeshBasicMaterial({ map: this._tex, transparent: true }),
    );
    this._panel.renderOrder = 10;
    this.world.scene.add(this._panel);
    this._dirty = true;
    return this._panel;
  }

  #draw(active) {
    const c = this._ctx, v = this.values;
    c.clearRect(0, 0, 512, 300);
    c.fillStyle = 'rgba(12, 14, 24, 0.86)';
    c.beginPath();
    c.roundRect(0, 0, 512, 300, 22);
    c.fill();
    c.strokeStyle = active ? '#ffd23f' : '#5a628a';
    c.lineWidth = 4;
    c.stroke();
    c.fillStyle = '#7fb4ff';
    c.font = 'bold 30px monospace';
    c.fillText('DART GRIP TUNER', 24, 44);
    c.font = 'bold 34px monospace';
    c.fillStyle = '#ffd23f';
    const rows = [
      ['palm', v.palm.toFixed(3)],
      ['fingers', v.fingers.toFixed(3)],
      ['up', v.up.toFixed(3)],
      ['nose', `${v.noseUp >= 0 ? '+' : ''}${v.noseUp.toFixed(1)}°`],
    ];
    rows.forEach(([k, val], i) => {
      c.fillText(k.padEnd(8) + val, 24, 92 + i * 42);
    });
    c.font = '22px monospace';
    c.fillStyle = '#9adf9a';
    c.fillText('stick: side/fwd   +trigger: palm/nose', 24, 266);
    c.fillText('A: reset          saved automatically', 24, 292);
    this._tex.needsUpdate = true;
    this._dirty = false;
  }
}

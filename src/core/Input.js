import * as THREE from 'three';

/**
 * Input — wraps the two XR controllers AND a desktop mouse/keyboard fallback
 * behind one interface, so games never care which one is active.
 *
 * Each "hand" exposes:
 *   .gripPosition / .gripQuaternion (world space)
 *   .velocity                     (world m/s, smoothed — used for throws)
 *   .justGrabbed / .justReleased  (edge-triggered each frame)
 *   .stick {x,y}                  (thumbstick)
 *   .pulse(intensity, ms)         (haptics)
 *
 * Desktop: one virtual hand floats 0.45m in front of the camera. Click =
 * grab / throw, E = poke buttons. Its velocity is derived from camera motion
 * plus a forward impulse so throws still work.
 */

const _v = new THREE.Vector3();

class Hand {
  constructor(index) {
    this.index = index;
    this.gripPosition = new THREE.Vector3();
    this.gripQuaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.stick = { x: 0, y: 0 };
    this.gripPressed = false;
    this.triggerPressed = false;
    this.gripValue = 0;         // analog 0..1 — drives the glove finger curl
    this.triggerValue = 0;
    this.justGrabbed = false;   // grip OR trigger went down this frame
    this.justReleased = false;  // both went up this frame
    this.justTriggered = false; // trigger edge (teleport confirm etc.)
    this.hoverGrab = false;     // a grabbable is within reach (set by Grabbables)
    this.connected = false;
    this._history = [];         // [{p: Vector3, t}] ring for throw velocity
    this._xrController = null;
    this._pulseFn = null;
  }

  /**
   * Throw velocity: direction from the ~90ms average (stable), magnitude
   * lifted to the PEAK frame-to-frame speed of the last 150ms. Players
   * release grip a beat after the arm's fastest point, so a plain average
   * loses a big chunk of the swing — this is what made throws feel weak.
   * Per-object assist (foam balls vs darts) is applied by Grabbables.
   */
  computeThrowVelocity(out) {
    const h = this._history;
    out.set(0, 0, 0);
    if (h.length < 2) return out;
    const newest = h[h.length - 1];
    // average over ~90ms
    let oldest = h[0];
    for (let i = h.length - 2; i >= 0; i--) {
      if (newest.t - h[i].t >= 0.09) { oldest = h[i]; break; }
      oldest = h[i];
    }
    const dt = newest.t - oldest.t;
    if (dt < 1e-4) return out;
    out.copy(newest.p).sub(oldest.p).divideScalar(dt);
    const avgSpeed = out.length();
    if (avgSpeed < 1e-3) return out;
    // peak instantaneous speed within the last 150ms
    let peak = 0;
    for (let i = h.length - 1; i > 0; i--) {
      const b = h[i], a = h[i - 1];
      if (newest.t - a.t > 0.15) break;
      const sdt = b.t - a.t;
      if (sdt > 1e-4) peak = Math.max(peak, b.p.distanceTo(a.p) / sdt);
    }
    out.multiplyScalar(Math.max(avgSpeed, peak * 0.85) / avgSpeed);
    return out;
  }

  pulse(intensity = 0.6, ms = 40) {
    if (this._pulseFn) this._pulseFn(intensity, ms);
  }

  _pushHistory(t) {
    const h = this._history;
    h.push({ p: this.gripPosition.clone(), t });
    while (h.length > 20) h.shift();
    // instantaneous smoothed velocity (for held-object inertia display)
    if (h.length >= 2) {
      const a = h[h.length - 2], b = h[h.length - 1];
      const dt = b.t - a.t;
      if (dt > 1e-4) {
        _v.copy(b.p).sub(a.p).divideScalar(dt);
        this.velocity.lerp(_v, 0.5);
      }
    }
  }
}

export class Input {
  /** @param {import('./World.js').World} world */
  constructor(world) {
    this.world = world;
    this.hands = [new Hand(0), new Hand(1)];
    this.isXR = false;
    // desktop state
    this.keys = new Set();
    this.desktopHand = this.hands[0];
    this.pointerLocked = false;
    this._desktopClick = false;
    this._interactAt = 0;
    this.look = { yaw: 0, pitch: 0 };

    this.#setupXR();
    this.#setupDesktop();
    world.onUpdate((dt, t) => this.#update(dt, t));
  }

  #setupXR() {
    const { renderer, rig } = this.world;
    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i];
      const grip = renderer.xr.getControllerGrip(i);
      const ray = renderer.xr.getController(i);
      rig.add(grip, ray);
      hand._grip = grip;
      hand._ray = ray;
      ray.addEventListener('connected', (e) => {
        hand.connected = true;
        hand.handedness = e.data.handedness;
        hand._inputSource = e.data;
        // (the visible hand — a carnival glove — is built by core/Hands.js
        // once handedness is known; 'connected' only fires in XR sessions)
        hand._pulseFn = (intensity, ms) => {
          const act = e.data.gamepad?.hapticActuators?.[0];
          if (act?.pulse) act.pulse(intensity, ms);
        };
      });
      ray.addEventListener('disconnected', () => { hand.connected = false; });
    }
    renderer.xr.addEventListener('sessionstart', () => { this.isXR = true; });
    renderer.xr.addEventListener('sessionend', () => { this.isXR = false; });
  }

  #setupDesktop() {
    const canvas = this.world.renderer.domElement;
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyE') this._interactAt = performance.now();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked || this.isXR) return;
      if (e.button === 0) this._desktopClick = true;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      document.getElementById('crosshair').style.display =
        this.pointerLocked ? 'block' : 'none';
    });
    addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || this.isXR) return;
      this.look.yaw -= e.movementX * 0.0022;
      this.look.pitch = THREE.MathUtils.clamp(
        this.look.pitch - e.movementY * 0.0022, -1.35, 1.35);
    });
  }

  requestPointerLock() {
    this.world.renderer.domElement.requestPointerLock();
  }

  #update(dt, t) {
    if (this.isXR) this.#updateXR(t);
    else this.#updateDesktop(dt, t);
  }

  #updateXR(t) {
    for (const hand of this.hands) {
      hand.justGrabbed = hand.justReleased = hand.justTriggered = false;
      if (!hand.connected) continue;
      hand._grip.getWorldPosition(hand.gripPosition);
      hand._grip.getWorldQuaternion(hand.gripQuaternion);
      hand._pushHistory(t);

      const gp = hand._inputSource?.gamepad;
      if (!gp) continue;
      hand.triggerValue = gp.buttons[0]?.value ?? 0;
      hand.gripValue = gp.buttons[1]?.value ?? 0;
      const trigger = hand.triggerValue > 0.5;
      const squeeze = hand.gripValue > 0.5;
      const held = trigger || squeeze;
      const wasHeld = hand.gripPressed || hand.triggerPressed;
      hand.justGrabbed = held && !wasHeld;
      hand.justReleased = !held && wasHeld;
      hand.justTriggered = trigger && !hand.triggerPressed;
      hand.triggerPressed = trigger;
      hand.gripPressed = squeeze;
      hand.stick.x = gp.axes[2] ?? 0;
      hand.stick.y = gp.axes[3] ?? 0;
    }
  }

  #updateDesktop(dt, t) {
    const cam = this.world.camera;
    // apply mouse look
    cam.rotation.set(this.look.pitch, this.look.yaw, 0, 'YXZ');

    // the virtual hand floats in front of the camera
    const hand = this.desktopHand;
    hand.connected = true;
    cam.getWorldPosition(hand.gripPosition);
    cam.getWorldQuaternion(hand.gripQuaternion);
    hand.gripPosition.add(_v.set(0.12, -0.14, -0.45).applyQuaternion(hand.gripQuaternion));
    hand._pushHistory(t);

    hand.justGrabbed = this._desktopClick;
    hand.justReleased = false; // desktop throw handled by Grabbables via click-again
    hand.justTriggered = this._desktopClick;
    this._desktopClick = false;

    // second hand disabled on desktop
    const other = this.hands[1];
    other.connected = false;
    other.justGrabbed = other.justReleased = other.justTriggered = false;
  }

  /**
   * Desktop "E" edge — consumed by PushButton / ExitBell checks. Expires
   * after 350ms so a press with nothing in range doesn't linger, while
   * still surviving a slow frame (the press and the in-range check can land
   * on different frames).
   */
  consumeInteract() {
    if (this._interactAt && performance.now() - this._interactAt < 350) {
      this._interactAt = 0;
      return true;
    }
    return false;
  }
}

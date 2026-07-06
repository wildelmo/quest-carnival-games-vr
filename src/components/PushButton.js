import * as THREE from 'three';

/**
 * PushButton — a big physical arcade dome button.
 *
 * VR: poke it with either controller (the grip has to dip into the dome).
 * Desktop: look at it from within 2m and press E.
 * The dome visibly depresses, gives a haptic tick and plays a clack.
 */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class PushButton {
  /**
   * @param {object} deps { input, audio, world }
   * @param {object} opts { color, label, onPress }
   */
  constructor({ input, audio, world }, { color = 0xe02249, label = '', onPress } = {}) {
    this.input = input;
    this.audio = audio;
    this.world = world;
    this.onPress = onPress;
    this.enabled = true;
    this._cooldown = 0;
    this._pressDepth = 0;

    this.group = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.1, 0.035, 16),
      new THREE.MeshLambertMaterial({ color: 0x2a2a35 }),
    );
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.062, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 }),
    );
    this.dome.position.y = 0.018;
    this.group.add(base, this.dome);

    if (label) {
      // little plaque in front of the button
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1d1d26'; ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = '#ffe9c9'; ctx.font = 'bold 34px Georgia, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 128, 34);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, 0.05),
        new THREE.MeshBasicMaterial({ map: tex }),
      );
      plaque.rotation.x = -Math.PI / 3;
      plaque.position.set(0, 0.005, 0.13);
      this.group.add(plaque);
    }

    world.onUpdate((dt) => this.#update(dt));
  }

  #update(dt) {
    this._cooldown = Math.max(0, this._cooldown - dt);
    // spring the dome back up
    this._pressDepth = Math.max(0, this._pressDepth - dt * 0.2);
    this.dome.position.y = 0.018 - this._pressDepth;
    this.dome.material.emissiveIntensity = this.enabled ? 0.25 : 0.05;
    if (!this.enabled || this._cooldown > 0) return;

    this.group.getWorldPosition(_v1);
    _v1.y += 0.05; // dome centre

    if (this.input.isXR) {
      for (const hand of this.input.hands) {
        if (!hand.connected) continue;
        if (hand.gripPosition.distanceTo(_v1) < 0.09) {
          this.#press(hand);
          return;
        }
      }
    } else {
      // desktop: E while looking roughly at the button from close range
      const head = this.world.camera;
      head.getWorldPosition(_v2);
      if (_v2.distanceTo(_v1) < 2.2 && this.input.consumeInteract()) {
        this.#press(null);
      }
    }
  }

  #press(hand) {
    this._cooldown = 0.6;
    this._pressDepth = 0.02;
    if (hand) hand.pulse(0.8, 60);
    this.audio.play('point', { at: this.group, volume: 0.5, rate: 0.7 });
    if (this.onPress) this.onPress();
  }
}

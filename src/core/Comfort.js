import * as THREE from 'three';
import { settings } from './settings.js';

/**
 * Comfort — a soft vignette iris that fades in while you smooth-walk in VR
 * and melts away the moment you stop. The single biggest motion-comfort
 * feature on Quest; off by a toggle on the operator panel for players who
 * don't need it. Desktop mode never shows it.
 *
 * Implementation: one camera-attached quad with a radial "clear centre,
 * dark edge" canvas texture, drawn after everything (renderOrder 999, no
 * depth test) so it irises over the scene.
 */

export class Comfort {
  /**
   * @param {import('./World.js').World} world
   * @param {import('./Input.js').Input} input
   * @param {import('./Locomotion.js').Locomotion} locomotion
   */
  constructor(world, input, locomotion) {
    this.input = input;
    this.locomotion = locomotion;
    this._level = 0;

    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.45, 'rgba(0,0,0,0)');
    g.addColorStop(0.72, 'rgba(0,0,0,0.75)');
    g.addColorStop(1, 'rgba(0,0,0,0.97)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0,
        depthTest: false, depthWrite: false, toneMapped: false,
      }),
    );
    this.mesh.position.z = -0.28;
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
    world.camera.add(this.mesh);
    world.onUpdate((dt) => this.#update(dt));
  }

  #update(dt) {
    const moving = this.input.isXR && settings.data.vignette
      && this.locomotion.smoothSpeed > 0.2;
    // quick in (~0.15s), gentler out (~0.35s)
    const rate = moving ? 7 : 3;
    this._level = THREE.MathUtils.lerp(this._level, moving ? 1 : 0,
      Math.min(1, dt * rate));
    this.mesh.material.opacity = this._level;
    this.mesh.visible = this._level > 0.015;
  }
}

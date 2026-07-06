import * as THREE from 'three';
import { Physics } from './Physics.js';

/**
 * World — renderer, scene, camera rig, fixed-step simulation loop, WebXR.
 *
 * The player is a `rig` group; the XR camera + controllers live inside it.
 * Moving/rotating the rig is how locomotion works, in VR and on desktop.
 */
export class World {
  constructor(container) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14060e);

    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 60);
    this.camera.position.set(0, 1.6, 0); // desktop eye height; XR overrides

    this.rig = new THREE.Group();
    this.rig.name = 'playerRig';
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setFoveation(1); // strongest fixed foveation = big perf win on Quest
    container.appendChild(this.renderer.domElement);

    this.physics = new Physics();

    /** per-frame subscribers: fn(dt, elapsed) — animation, games, input */
    this.updaters = [];
    this._elapsed = 0;
    this._accumulator = 0;
    this.PHYS_DT = 1 / 90; // Quest native refresh

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  onUpdate(fn) { this.updaters.push(fn); }

  start() {
    let last = 0;
    this.renderer.setAnimationLoop((time) => {
      const t = time / 1000;
      let dt = Math.min(t - last, 0.1); // clamp hitches (tab switch etc.)
      last = t;
      this._elapsed += dt;

      // fixed-step physics with accumulator so throws behave identically
      // at 72/90/120Hz headset refresh rates
      this._accumulator += dt;
      let steps = 0;
      while (this._accumulator >= this.PHYS_DT && steps < 4) {
        this.physics.step(this.PHYS_DT);
        this._accumulator -= this.PHYS_DT;
        steps++;
      }
      // if the frame rate tanks, drop the leftover time instead of running
      // the simulation in slow motion forever
      if (this._accumulator > this.PHYS_DT) this._accumulator = 0;

      for (const fn of this.updaters) fn(dt, this._elapsed);
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Head position in world space (works in XR and desktop). */
  getHeadPosition(out) {
    return this.camera.getWorldPosition(out);
  }
}

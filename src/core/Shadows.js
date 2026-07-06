import * as THREE from 'three';

/**
 * BlobShadows — cheap contact shadows for dynamic objects (balls, rings,
 * darts). Real shadow maps cost an extra scene pass per frame on Quest;
 * a pool of soft dark discs on the floor gives 90% of the grounding for
 * ~0 cost: one instanced draw call, no extra passes.
 *
 * The discs use MULTIPLY blending with a "white at the edges, grey in the
 * middle" radial texture, so they darken whatever floor texture they cover.
 * Per-instance fade is done through instance colour: pushing the colour
 * above white cancels the darkening (the framebuffer clamps at 1), which
 * lets each shadow fade smoothly with the object's height off the floor.
 */

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const MAX_HEIGHT = 1.9;   // shadows fade out completely above this

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgb(120,116,112)');
  g.addColorStop(0.55, 'rgb(200,198,196)');
  g.addColorStop(1, 'rgb(255,255,255)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class BlobShadows {
  /** @param {import('./World.js').World} world */
  constructor(world, max = 64) {
    this.max = max;
    this.tracked = []; // { object, radius, strength, enabled }
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: shadowTexture(),
        blending: THREE.MultiplyBlending,
        premultipliedAlpha: true, // required by MultiplyBlending
        transparent: true,
        depthWrite: false,
      }),
      max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // after the floor, before additive glows
    // park everything at zero scale
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, _m);
    world.scene.add(this.mesh);
    world.onUpdate(() => this.#update());
  }

  /**
   * Follow `object` with a contact shadow on the tent floor.
   * @param {THREE.Object3D} object
   * @param {{radius?: number, strength?: number}} opts
   */
  track(object, { radius = 0.09, strength = 0.85 } = {}) {
    const t = { object, radius, strength, enabled: true };
    if (this.tracked.length < this.max) this.tracked.push(t);
    return t;
  }

  #update() {
    const color = new THREE.Color();
    for (let i = 0; i < this.tracked.length; i++) {
      const t = this.tracked[i];
      let s = 0;
      if (t.enabled && t.object.visible) {
        t.object.getWorldPosition(_v);
        s = t.strength * Math.max(0, 1 - _v.y / MAX_HEIGHT);
      }
      if (s <= 0.02) {
        _m.makeScale(0, 0, 0);
      } else {
        // the disc grows and softens as the object rises
        const d = t.radius * 2.4 * (1 + _v.y * 0.55);
        _m.makeScale(d, 1, d);
        _m.setPosition(_v.x, 0.006, _v.z);
        // instance colour > 1 cancels the multiply-darkening => fade control
        const f = 1 / (0.42 + 0.58 * s);
        color.setRGB(f, f, f);
        this.mesh.setColorAt(i, color);
      }
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

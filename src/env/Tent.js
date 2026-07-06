import * as THREE from 'three';
import {
  stripesTexture, canopyTexture, woodTexture, signTexture, CARNIVAL_PALETTE,
} from '../core/textures.js';

/**
 * Tent — the funhouse big-top everything lives inside.
 *
 * A 12-sided canvas drum with a striped conical roof, wooden floor,
 * center pole, bunting banners, string lights, a bandstand speaker
 * (music source), prize shelves and an entrance curtain. Six booth pads
 * ring the wall; games claim pads via `getPad(i)`.
 *
 * Geometry is deliberately low-poly and material count is kept small
 * (Lambert + Basic) so the whole environment renders in ~1ms on Quest.
 */

// The drum must be wide enough that booth stalls (front edge at PAD_RADIUS,
// ~3m deep) sit fully inside it — otherwise balls hit the physics boundary
// before they reach the targets.
export const TENT_RADIUS = 8.4;
export const WALL_HEIGHT = 3.2;
const PEAK_HEIGHT = 6.6;
export const PAD_COUNT = 6;
/** distance from centre to a booth front edge */
export const PAD_RADIUS = 4.6;

export class Tent {
  /** @param {import('../core/World.js').World} world */
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'tent';
    world.scene.add(this.group);
    this.flickerLights = [];   // {mesh, phase} for bulb twinkle
    this._pennants = [];

    this.#buildShell();
    this.#buildLighting();
    this.#buildStringLights();
    this.#buildBunting();
    this.#buildCenterpiece();
    this.#buildEntrance();
    world.onUpdate((dt, t) => this.#update(dt, t));
  }

  /**
   * A booth pad: position + facing for game booths, spaced around the tent.
   * Pad 0 faces the entrance (which sits at angle PI, i.e. -Z side... the
   * entrance takes the slot at angle 4 so we skip it in the ring).
   * @returns {{position: THREE.Vector3, angle: number}}
   */
  getPad(i) {
    // 7 slots around the circle; slot 3 (directly behind the spawn point)
    // is reserved for the entrance archway.
    const slots = [0, 1, 2, 4, 5, 6];
    const angle = (slots[i] / 7) * Math.PI * 2;
    return {
      position: new THREE.Vector3(
        Math.sin(angle) * PAD_RADIUS, 0, -Math.cos(angle) * PAD_RADIUS),
      // rotation.y that points the booth's local +Z (its front) back at the
      // tent centre from this position
      angle: -angle,
    };
  }

  #buildShell() {
    // wooden floor disc
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(TENT_RADIUS + 0.5, 24),
      new THREE.MeshLambertMaterial({ map: woodTexture() }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    // canvas drum wall (striped), open-topped cylinder viewed from inside
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(TENT_RADIUS, TENT_RADIUS, WALL_HEIGHT, 24, 1, true),
      new THREE.MeshLambertMaterial({ map: stripesTexture('#a3173a', '#efe2c8', 4), side: THREE.BackSide }),
    );
    wall.material.map.repeat.set(6, 1);
    wall.position.y = WALL_HEIGHT / 2;
    this.group.add(wall);

    // conical roof
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(TENT_RADIUS + 0.15, PEAK_HEIGHT - WALL_HEIGHT, 24, 1, true),
      new THREE.MeshLambertMaterial({ map: canopyTexture('#a3173a', '#efe2c8', 16), side: THREE.BackSide }),
    );
    roof.position.y = WALL_HEIGHT + (PEAK_HEIGHT - WALL_HEIGHT) / 2;
    this.group.add(roof);

    // centre pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, PEAK_HEIGHT, 10),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2c }),
    );
    pole.position.y = PEAK_HEIGHT / 2;
    this.group.add(pole);
  }

  #buildLighting() {
    // warm hemisphere base so nothing is pitch black
    this.group.add(new THREE.HemisphereLight(0xffe1b8, 0x3a1a22, 0.75));
    // key light from the peak
    const top = new THREE.PointLight(0xffd9a0, 40, 22, 1.8);
    top.position.set(0, PEAK_HEIGHT - 1.2, 0);
    this.group.add(top);
    // two warm fills so booths on all sides read well
    for (const [x, z] of [[3.5, 3.5], [-3.5, -3.5]]) {
      const fill = new THREE.PointLight(0xffb28a, 14, 14, 1.9);
      fill.position.set(x, 2.6, z);
      this.group.add(fill);
    }
  }

  /** Strings of glowing bulbs from the peak to the eaves — pure emissive. */
  #buildStringLights() {
    const bulbGeo = new THREE.SphereGeometry(0.035, 6, 6);
    const strands = 8, perStrand = 14;
    const mesh = new THREE.InstancedMesh(
      bulbGeo,
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      strands * perStrand,
    );
    const color = new THREE.Color();
    const m = new THREE.Matrix4();
    let idx = 0;
    for (let s = 0; s < strands; s++) {
      const angle = (s / strands) * Math.PI * 2 + 0.2;
      const ex = Math.sin(angle) * (TENT_RADIUS - 0.3);
      const ez = -Math.cos(angle) * (TENT_RADIUS - 0.3);
      for (let i = 0; i < perStrand; i++) {
        const t = (i + 1) / (perStrand + 1);
        // sagging catenary-ish curve from peak to eave
        const sag = Math.sin(t * Math.PI) * 0.45;
        m.setPosition(
          ex * t,
          PEAK_HEIGHT - 0.9 + (WALL_HEIGHT - (PEAK_HEIGHT - 0.9)) * t - sag,
          ez * t,
        );
        mesh.setMatrixAt(idx, m);
        color.setHex(CARNIVAL_PALETTE[(s + i) % CARNIVAL_PALETTE.length]);
        mesh.setColorAt(idx, color);
        idx++;
      }
    }
    mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.bulbMesh = mesh;
  }

  /** Triangle pennant banners strung across the tent interior. */
  #buildBunting() {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute(
      [-0.09, 0, 0, 0.09, 0, 0, 0, -0.22, 0], 3));
    tri.computeVertexNormals();
    const flagCount = 3 * 16;
    const mesh = new THREE.InstancedMesh(
      tri, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), flagCount);
    const color = new THREE.Color();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    let idx = 0;
    // three swags criss-crossing below the roof
    const lines = [
      [new THREE.Vector3(-5.5, 2.9, -2.5), new THREE.Vector3(5.5, 2.9, 2.0)],
      [new THREE.Vector3(-5.0, 3.1, 3.5), new THREE.Vector3(5.0, 3.1, -3.5)],
      [new THREE.Vector3(0, 3.3, -5.8), new THREE.Vector3(0, 3.3, 5.8)],
    ];
    for (const [a, b] of lines) {
      for (let i = 0; i < 16; i++) {
        const t = (i + 0.5) / 16;
        p.lerpVectors(a, b, t);
        p.y -= Math.sin(t * Math.PI) * 0.5; // sag
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0),
          Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2);
        m.compose(p, q, new THREE.Vector3(1.6, 1.6, 1.6));
        mesh.setMatrixAt(idx, m);
        color.setHex(CARNIVAL_PALETTE[idx % CARNIVAL_PALETTE.length]);
        mesh.setColorAt(idx, color);
        idx++;
      }
    }
    mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Bandstand speaker box at the centre pole — anchor for the music. */
  #buildCenterpiece() {
    const stand = new THREE.Group();
    // old-timey speaker horn made of cones
    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.4, 12, 1, true),
      new THREE.MeshLambertMaterial({ color: 0xd4af37, side: THREE.DoubleSide }),
    );
    horn.rotation.x = Math.PI / 2.6;
    horn.position.y = 2.4;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x7a1f33 }),
    );
    box.position.y = 2.15;
    // bracket arm so the speaker visibly hangs off the centre pole
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.05, 0.05),
      new THREE.MeshLambertMaterial({ color: 0x3a2a1a }),
    );
    arm.position.set(-0.15, 2.28, 0);
    stand.add(horn, box, arm);
    stand.position.set(0.3, 0, 0);
    this.group.add(stand);
    /** attach the looping music PositionalAudio here */
    this.musicAnchor = box;

    // ring of popcorn-style floor lights around the pole base
    const ringGeo = new THREE.TorusGeometry(0.5, 0.04, 8, 24);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    this.group.add(ring);
  }

  /** Entrance archway with parted curtains at the reserved slot. */
  #buildEntrance() {
    const angle = (3 / 7) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(Math.sin(angle) * (TENT_RADIUS - 0.2), 0, -Math.cos(angle) * (TENT_RADIUS - 0.2));
    g.rotation.y = -angle; // face centre

    const curtainMat = new THREE.MeshLambertMaterial({ color: 0x5c1030, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      // gathered curtain = squashed cylinder
      const curtain = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 2.6, 10), curtainMat);
      curtain.position.set(side * 0.85, 1.3, 0);
      curtain.scale.z = 0.6;
      g.add(curtain);
    }
    // arch header
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.5, 0.2),
      new THREE.MeshLambertMaterial({ map: signTexture('WELCOME!', { bg: '#7a1f33' }) }),
    );
    header.position.y = 2.75;
    g.add(header);
    this.group.add(g);
  }

  #update(dt, t) {
    // gentle twinkle on the string lights: cycle emissive intensity by
    // re-tinting a few instances per frame (cheap, no shader work)
    // (InstancedMesh color writes are cheap for 112 bulbs)
    if (this.bulbMesh && ((t * 60) | 0) % 4 === 0) {
      const c = new THREE.Color();
      const i = (Math.random() * this.bulbMesh.count) | 0;
      c.setHex(CARNIVAL_PALETTE[(Math.random() * CARNIVAL_PALETTE.length) | 0]);
      const dim = 0.55 + Math.random() * 0.45;
      c.multiplyScalar(dim);
      this.bulbMesh.setColorAt(i, c);
      this.bulbMesh.instanceColor.needsUpdate = true;
    }
  }
}

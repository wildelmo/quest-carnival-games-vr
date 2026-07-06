import * as THREE from 'three';
import {
  stripesTexture, canopyTexture, signTexture, signPanelMaterials,
  barberPoleTexture, woodFloorMaps, floorVignetteTexture, CARNIVAL_PALETTE,
} from '../core/textures.js';
import { shiny, makeGlowPoints, glowTexture } from '../core/environment.js';

/**
 * Tent — the funhouse big-top everything lives inside.
 *
 * A 12-sided canvas drum with a striped conical roof, varnished wooden
 * floor, candy-striped centre pole, bunting banners, twinkling string
 * lights with real glow halos, drifting dust motes in the lamplight, a
 * bandstand speaker (music source) and an entrance curtain. Six booth pads
 * ring the wall; games claim pads via `getPad(i)`.
 *
 * Geometry is deliberately low-poly and the material budget is split on
 * purpose: the huge canvas/plush surfaces stay cheap Lambert, while the
 * floor and brass pick up the env map for sheen. Everything still renders
 * in ~1ms on Quest.
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

    this.#buildShell();
    this.#buildLighting();
    this.#buildStringLights();
    this.#buildBunting();
    this.#buildCenterpiece();
    this.#buildEntrance();
    this.#buildDustMotes();
    world.onUpdate((dt, t) => this.#update(dt, t));
  }

  /**
   * A booth pad: position + facing for game booths, spaced around the tent.
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
    // varnished wooden floor: colour + roughness maps from the same plank
    // layout, env-map sheen breaking along the boards
    const { map, roughnessMap } = woodFloorMaps('#7d5029', 5);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(TENT_RADIUS + 0.5, 32),
      shiny({ map, roughnessMap, roughness: 1, metalness: 0, envIntensity: 0.5 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);
    // baked bounce-light vignette where the boards meet the wall
    const vignette = new THREE.Mesh(
      new THREE.CircleGeometry(TENT_RADIUS + 0.5, 32),
      new THREE.MeshBasicMaterial({
        map: floorVignetteTexture(), transparent: true, depthWrite: false,
      }),
    );
    vignette.rotation.x = -Math.PI / 2;
    vignette.position.y = 0.002;
    this.group.add(vignette);

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

    // candy-striped centre pole with a brass finial where it meets the peak
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, PEAK_HEIGHT, 12),
      new THREE.MeshLambertMaterial({ map: barberPoleTexture('#b01030', '#efe2c8') }),
    );
    pole.position.y = PEAK_HEIGHT / 2;
    this.group.add(pole);
    const finial = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 14, 10),
      shiny({ color: 0xd4af37, metalness: 1, roughness: 0.28, envIntensity: 1.2 }),
    );
    finial.position.y = PEAK_HEIGHT - 0.5;
    this.group.add(finial);
    // brass base collar so the pole doesn't just spear into the boards
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.19, 0.1, 12),
      shiny({ color: 0xb08d2e, metalness: 1, roughness: 0.4 }),
    );
    collar.position.y = 0.05;
    this.group.add(collar);
  }

  #buildLighting() {
    // warm hemisphere base so nothing is pitch black
    this.group.add(new THREE.HemisphereLight(0xffe1b8, 0x3a1a22, 0.95));
    // key light from the peak — the big specular source
    const top = new THREE.PointLight(0xffd9a0, 52, 24, 1.8);
    top.position.set(0, PEAK_HEIGHT - 1.2, 0);
    this.group.add(top);
    // two warm fills so booths on all sides read well
    for (const [x, z] of [[3.5, 3.5], [-3.5, -3.5]]) {
      const fill = new THREE.PointLight(0xffb28a, 16, 14, 1.9);
      fill.position.set(x, 2.6, z);
      this.group.add(fill);
    }

    // faint volumetric shaft under the peak lamp (additive gradient cone)
    const c = document.createElement('canvas');
    c.width = 8; c.height = 128;
    const g2 = c.getContext('2d');
    const grad = g2.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,214,150,0.55)');
    grad.addColorStop(1, 'rgba(255,214,150,0)');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 8, 128);
    const beamTex = new THREE.CanvasTexture(c);
    beamTex.colorSpace = THREE.SRGBColorSpace;
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(1.9, 4.4, 20, 1, true),
      new THREE.MeshBasicMaterial({
        map: beamTex, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      }),
    );
    beam.position.set(0, PEAK_HEIGHT - 3.4, 0);
    beam.renderOrder = 5;
    this.group.add(beam);
  }

  /** Strings of glowing bulbs from the peak to the eaves, with halo points
   *  and visible cords — twinkling per-bulb every frame. */
  #buildStringLights() {
    const bulbGeo = new THREE.SphereGeometry(0.035, 6, 6);
    const strands = 8, perStrand = 14;
    const count = strands * perStrand;
    const mesh = new THREE.InstancedMesh(
      bulbGeo,
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      count,
    );
    const color = new THREE.Color();
    const m = new THREE.Matrix4();
    const positions = [];
    const cordPts = [];
    this._bulbBase = new Array(count);   // base colours
    this._bulbPhase = new Float32Array(count);
    let idx = 0;
    for (let s = 0; s < strands; s++) {
      const angle = (s / strands) * Math.PI * 2 + 0.2;
      const ex = Math.sin(angle) * (TENT_RADIUS - 0.3);
      const ez = -Math.cos(angle) * (TENT_RADIUS - 0.3);
      // nodes 0..perStrand+1 span peak → eave; bulbs hang at 1..perStrand
      let prev = null;
      for (let i = 0; i <= perStrand + 1; i++) {
        const t = i / (perStrand + 1);
        const sag = Math.sin(t * Math.PI) * 0.45;
        const p = new THREE.Vector3(
          ex * t,
          PEAK_HEIGHT - 0.9 + (WALL_HEIGHT - (PEAK_HEIGHT - 0.9)) * t - sag,
          ez * t,
        );
        // cord segments trace the same catenary the bulbs hang from
        if (prev) cordPts.push(prev, p);
        prev = p;
        if (i === 0 || i > perStrand) continue;
        m.setPosition(p);
        mesh.setMatrixAt(idx, m);
        color.setHex(CARNIVAL_PALETTE[(s + i - 1) % CARNIVAL_PALETTE.length]);
        mesh.setColorAt(idx, color);
        this._bulbBase[idx] = color.clone();
        this._bulbPhase[idx] = Math.random() * Math.PI * 2;
        positions.push(p);
        idx++;
      }
    }
    mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.bulbMesh = mesh;

    // dark cords (one draw call)
    const cordGeo = new THREE.BufferGeometry().setFromPoints(cordPts);
    const cords = new THREE.LineSegments(
      cordGeo, new THREE.LineBasicMaterial({ color: 0x1c0f12 }));
    this.group.add(cords);

    // additive halo points make the bulbs read as actual light sources
    this.bulbGlow = makeGlowPoints(positions, { size: 0.22, opacity: 0.42 });
    positions.forEach((_, i) => this.bulbGlow.setColor(i, this._bulbBase[i]));
    this.bulbGlow.commit();
    this.group.add(this.bulbGlow.points);
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
    // old-timey brass speaker horn
    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.4, 14, 1, true),
      shiny({
        color: 0xd4af37, metalness: 1, roughness: 0.3,
        envIntensity: 1.2, side: THREE.DoubleSide,
      }),
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
    // soft glow pooled around it
    const pool = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffc860, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    pool.scale.setScalar(1.6);
    pool.position.y = 0.12;
    this.group.add(pool);
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
      // golden rope tieback where the curtain is gathered
      const rope = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.028, 8, 18),
        shiny({ color: 0xd4af37, metalness: 0.9, roughness: 0.45 }),
      );
      rope.position.set(side * 0.85, 1.15, 0);
      rope.rotation.x = Math.PI / 2;
      rope.scale.z = 1.4;
      g.add(rope);
    }
    // arch header
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.5, 0.2),
      signPanelMaterials(signTexture('WELCOME!', { bg: '#7a1f33' }), 0x5c1030),
    );
    header.position.y = 2.75;
    g.add(header);
    this.group.add(g);
  }

  /** Dust motes drifting in the lamplight — depth + atmosphere for ~free. */
  #buildDustMotes() {
    const N = 140;
    this._moteBase = new Float32Array(N * 3);
    this._motePhase = new Float32Array(N);
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = Math.sqrt(Math.random()) * (TENT_RADIUS - 1.2);
      const a = Math.random() * Math.PI * 2;
      this._moteBase[i * 3] = Math.cos(a) * r;
      this._moteBase[i * 3 + 1] = 0.4 + Math.random() * 4.6;
      this._moteBase[i * 3 + 2] = Math.sin(a) * r;
      this._motePhase[i] = Math.random() * Math.PI * 2;
    }
    pos.set(this._moteBase);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.022,
      map: glowTexture(),
      color: 0xffe2b0,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }));
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  #update(dt, t) {
    // gentle per-bulb twinkle, mirrored into the glow halos (~112 colour
    // writes per frame — negligible)
    if (this.bulbMesh) {
      const c = new THREE.Color();
      for (let i = 0; i < this.bulbMesh.count; i++) {
        const tw = 0.72 + 0.28 * Math.sin(t * 2.4 + this._bulbPhase[i]);
        c.copy(this._bulbBase[i]).multiplyScalar(tw);
        this.bulbMesh.setColorAt(i, c);
        this.bulbGlow.setColor(i, c);
      }
      this.bulbMesh.instanceColor.needsUpdate = true;
      this.bulbGlow.commit();
    }

    // dust motes: slow figure-eight drift + rise
    if (this.motes) {
      const p = this.motes.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const ph = this._motePhase[i];
        p.array[i * 3] = this._moteBase[i * 3] + Math.sin(t * 0.14 + ph) * 0.35;
        p.array[i * 3 + 1] = this._moteBase[i * 3 + 1] + Math.sin(t * 0.09 + ph * 2) * 0.5;
        p.array[i * 3 + 2] = this._moteBase[i * 3 + 2] + Math.cos(t * 0.11 + ph) * 0.35;
      }
      p.needsUpdate = true;
    }
  }
}

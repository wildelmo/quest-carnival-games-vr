import * as THREE from 'three';
import {
  stripesTexture, signTexture, signPanelMaterials, barberPoleTexture,
  throwMatTexture, woodTexture, CARNIVAL_PALETTE,
} from '../core/textures.js';
import { shiny, makeGlowPoints } from '../core/environment.js';
import { Scoreboard } from './Scoreboard.js';
import { PushButton } from './PushButton.js';

/**
 * BoothBase — the reusable carnival stall every mini-game is built on.
 *
 * Provides: striped awning with scalloped edge, barber-pole corner posts,
 * back/side walls, a varnished counter with brass trim at 0.95m, a marquee
 * name sign ringed with REAL chasing bulbs, a scoreboard, a reset button,
 * a prize shelf with plushies, and a floor "step right up" mat. Games add
 * their own contents behind the counter.
 *
 * Local space: booth faces +Z (toward the player). The counter runs along
 * X at z = depth/2. `getPad()` placement rotates the whole group.
 */

const COUNTER_HEIGHT = 0.95;
const _c1 = new THREE.Color();

export class BoothBase {
  /**
   * @param {object} deps { world, input, audio }
   * @param {object} opts { name, width, depth, colorA, colorB, pad, onReset }
   */
  constructor(deps, opts) {
    this.deps = deps;
    this.name = opts.name;
    this.width = opts.width ?? 4;
    this.depth = opts.depth ?? 3;
    const { world } = deps;

    this.group = new THREE.Group();
    this.group.name = `booth:${this.name}`;
    if (opts.pad) {
      this.group.position.copy(opts.pad.position);
      this.group.rotation.y = opts.pad.angle;
      // push the booth back so its front (counter) sits at the pad position
      this.group.translateZ(-this.depth / 2);
    }
    world.scene.add(this.group);

    const colorA = opts.colorA ?? '#c2183c';
    const colorB = opts.colorB ?? '#f6ead7';
    this.#buildStructure(colorA, colorB, opts.signColors);
    this.#buildPrizeShelf(opts.shelfY ?? 2.25);

    // scoreboard perched on posts above the back wall, centred over the
    // game and tilted down toward the throw line — like the score display
    // on a real boardwalk cabinet. It sits above the prize shelf and the
    // targets, so nothing in the game is ever behind it.
    this.scoreboard = new Scoreboard(opts.scoreboardTitle ?? this.name);
    this.scoreboard.group.position.set(0, 3.25, -this.depth / 2 + 0.06);
    this.scoreboard.group.rotation.x = -0.35;
    this.scoreboard.group.scale.setScalar(1.35);
    this.group.add(this.scoreboard.group);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x2a2a35 });
    for (const sx of [-0.4, 0.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8), postMat);
      post.position.set(sx, 2.9, -this.depth / 2);
      this.group.add(post);
    }

    // the one big RESET button on the counter: it restores the booth to a
    // fresh round — the game itself starts on the player's first throw.
    // Games place it near their play area via resetButtonLocal so it's easy
    // to reach and reads straight-on.
    this.resetButton = new PushButton(deps, {
      color: 0xe02249,
      label: 'RESET',
      onPress: () => opts.onReset && opts.onReset(),
    });
    const rb = opts.resetButtonLocal
      ?? new THREE.Vector3(this.width / 2 - 0.55, COUNTER_HEIGHT + 0.03, this.depth / 2 - 0.18);
    this.resetButton.group.position.copy(rb);
    this.group.add(this.resetButton.group);

    // marquee chase animation
    world.onUpdate((dt, t) => this.#updateMarquee(t));

    // physics: players can't walk into the booth
    if (opts.pad) {
      this.#addBlockers(deps.locomotion);
    }
    // counter collider so balls bounce off the front
    deps.world.physics.colliderFromMesh(
      this.counter, new THREE.Vector3(this.width, COUNTER_HEIGHT, 0.5), { restitution: 0.3, tag: 'wood' });
  }

  get counterHeight() { return COUNTER_HEIGHT; }

  /** world-space point centred on the counter top (for trays, dart racks…) */
  counterAnchor() {
    return new THREE.Vector3(0, COUNTER_HEIGHT, this.depth / 2 - 0.25);
  }

  #buildStructure(colorA, colorB, signColors) {
    const w = this.width, d = this.depth;
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2c });
    // side walls wear the booth stripes so they read carnival from outside
    const sideMat = new THREE.MeshLambertMaterial({ map: stripesTexture(colorA, colorB, 6) });

    // back + side walls (thin boxes)
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(w, 2.6, 0.08),
      // deep tonal stripes instead of a flat black void — still dark enough
      // that targets pop against it, but it reads as draped fabric
      new THREE.MeshLambertMaterial({ map: stripesTexture('#3a2029', '#2b161e', 6) }),
    );
    back.position.set(0, 1.3, -d / 2);
    const sideGeo = new THREE.BoxGeometry(0.08, 2.6, d);
    const left = new THREE.Mesh(sideGeo, sideMat);
    left.position.set(-w / 2, 1.3, 0);
    const right = new THREE.Mesh(sideGeo, sideMat);
    right.position.set(w / 2, 1.3, 0);
    this.group.add(back, left, right);
    this.backWall = back;

    // varnished counter across the front — glossy top catches the tent lights
    this.counter = new THREE.Mesh(
      new THREE.BoxGeometry(w, COUNTER_HEIGHT, 0.5),
      shiny({ map: woodTexture('#6b4426'), roughness: 0.3, envIntensity: 0.7 }),
    );
    this.counter.position.set(0, COUNTER_HEIGHT / 2, this.depth / 2);
    // striped skirt on the counter front
    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(w, COUNTER_HEIGHT),
      new THREE.MeshLambertMaterial({ map: stripesTexture(colorA, colorB, 8) }),
    );
    skirt.position.set(0, 0, 0.251);
    this.counter.add(skirt);
    // brass rail along the counter's front lip
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, w, 8),
      shiny({ color: 0xc9a02e, metalness: 1, roughness: 0.35, envIntensity: 1.1 }),
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, COUNTER_HEIGHT / 2, 0.245);
    this.counter.add(rail);
    this.group.add(this.counter);

    // barber-pole corner posts + striped awning
    const poleMat = new THREE.MeshLambertMaterial({ map: barberPoleTexture(colorA, colorB) });
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 10);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, poleMat);
      post.position.set(sx * (w / 2 - 0.06), 1.3, d / 2 - 0.06);
      this.group.add(post);
      // brass caps top and bottom
      for (const [py, pr] of [[2.62, 0.06], [0.03, 0.065]]) {
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(pr, pr + 0.01, 0.06, 10),
          shiny({ color: 0xc9a02e, metalness: 1, roughness: 0.4 }),
        );
        cap.position.set(sx * (w / 2 - 0.06), py, d / 2 - 0.06);
        this.group.add(cap);
      }
    }
    // sloped striped canopy panel
    const canopy = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 0.3, 1.2),
      new THREE.MeshLambertMaterial({ map: stripesTexture(colorA, colorB, 10), side: THREE.DoubleSide }),
    );
    canopy.position.set(0, 2.85, d / 2 - 0.45);
    canopy.rotation.x = -0.5;
    this.group.add(canopy);

    // scalloped awning edge (little half-discs, alternating booth colours)
    const scallopGeo = new THREE.CircleGeometry(0.12, 10, Math.PI, Math.PI);
    const scallopMatA = new THREE.MeshLambertMaterial({ color: colorA, side: THREE.DoubleSide });
    const scallopMatB = new THREE.MeshLambertMaterial({ color: colorB, side: THREE.DoubleSide });
    const scallops = Math.floor((w + 0.3) / 0.24);
    for (let i = 0; i < scallops; i++) {
      const s = new THREE.Mesh(scallopGeo, i % 2 ? scallopMatB : scallopMatA);
      s.position.set(-(w + 0.3) / 2 + 0.12 + i * 0.24, 2.58, d / 2 + 0.09);
      this.group.add(s);
    }

    // marquee name sign above the awning, ringed with real chasing bulbs
    this.#buildMarquee(w, d, signColors);

    // "step right up" mat on the floor in front of the booth
    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.8, 0.7),
      new THREE.MeshLambertMaterial({ map: throwMatTexture(colorA) }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(0, 0.012, d / 2 + 0.85);
    this.group.add(mat);
  }

  /** Sign panel + a border of 3D bulbs that chase like a real marquee. */
  #buildMarquee(w, d, signColors) {
    const signW = w * 0.85, signH = signW / 4;
    const marquee = new THREE.Group();
    marquee.position.set(0, 3.5, d / 2 - 0.25);
    marquee.rotation.x = -0.15;
    this.group.add(marquee);

    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(signW, signH, 0.1),
      signPanelMaterials(signTexture(this.name, { ...signColors, bulbs: false })),
    );
    marquee.add(sign);

    // bulb ring around the panel edge (front face)
    const pts = [];
    const stepX = 0.145;
    const nx = Math.max(4, Math.round(signW / stepX));
    for (let i = 0; i <= nx; i++) {
      const x = -signW / 2 + (i / nx) * signW;
      pts.push(new THREE.Vector3(x, signH / 2 + 0.02, 0.05));
      pts.push(new THREE.Vector3(x, -signH / 2 - 0.02, 0.05));
    }
    for (const sy of [-0.5, 0.5]) {
      pts.push(new THREE.Vector3(-signW / 2 - 0.03, sy * signH * 0.45, 0.05));
      pts.push(new THREE.Vector3(signW / 2 + 0.03, sy * signH * 0.45, 0.05));
    }
    const bulbGeo = new THREE.SphereGeometry(0.028, 6, 6);
    const bulbs = new THREE.InstancedMesh(
      bulbGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => {
      m.setPosition(p);
      bulbs.setMatrixAt(i, m);
      bulbs.setColorAt(i, _c1.setHex(0xffe9b0));
    });
    bulbs.instanceColor.needsUpdate = true;
    marquee.add(bulbs);

    this._marqueeBulbs = bulbs;
    this._marqueeGlow = makeGlowPoints(pts, { size: 0.13, opacity: 0.5 });
    marquee.add(this._marqueeGlow.points);
  }

  #updateMarquee(t) {
    const bulbs = this._marqueeBulbs;
    if (!bulbs) return;
    // classic 3-phase chase: every third bulb bright, pattern advancing
    for (let i = 0; i < bulbs.count; i++) {
      const k = 0.5 + 0.5 * Math.sin(((i % 3) / 3 - t * 1.6) * Math.PI * 2);
      const v = 0.3 + 0.7 * k * k;
      _c1.setRGB(v, v * 0.88, v * 0.62);
      bulbs.setColorAt(i, _c1);
      this._marqueeGlow.setColor(i, _c1);
    }
    bulbs.instanceColor.needsUpdate = true;
    this._marqueeGlow.commit();
  }

  /** Shelf of low-poly plush prizes along the top of the back wall. */
  #buildPrizeShelf(shelfY) {
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(this.width - 0.3, 0.05, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x8a5a33 }),
    );
    shelf.position.set(0, shelfY, -this.depth / 2 + 0.2);
    this.group.add(shelf);

    // plushies: body sphere + head sphere + ears, vertex-colored
    const bodyGeo = new THREE.SphereGeometry(0.11, 10, 8);
    const headGeo = new THREE.SphereGeometry(0.075, 10, 8);
    const earGeo = new THREE.ConeGeometry(0.035, 0.07, 6);
    const count = Math.floor((this.width - 0.6) / 0.34);
    for (let i = 0; i < count; i++) {
      const color = CARNIVAL_PALETTE[(i * 3 + 1) % CARNIVAL_PALETTE.length];
      const m = new THREE.MeshLambertMaterial({ color });
      const plush = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, m);
      body.scale.y = 1.15;
      const head = new THREE.Mesh(headGeo, m);
      head.position.y = 0.16;
      const earL = new THREE.Mesh(earGeo, m);
      earL.position.set(-0.05, 0.24, 0);
      const earR = new THREE.Mesh(earGeo, m);
      earR.position.set(0.05, 0.24, 0);
      plush.add(body, head, earL, earR);
      plush.position.set(-(this.width - 0.6) / 2 + i * 0.34 + 0.1, shelfY + 0.15, -this.depth / 2 + 0.2);
      plush.rotation.y = (Math.random() - 0.5) * 0.7;
      plush.scale.setScalar(0.9 + Math.random() * 0.25);
      this.group.add(plush);
    }
  }

  /**
   * Keep the player out of the booth interior. The blocker is an ORIENTED
   * rectangle matching the stall's real footprint (back wall through the
   * counter's front lip) — a world AABB around a rotated booth would bulge
   * far into the walkway and read as an invisible wall.
   */
  #addBlockers(locomotion) {
    if (!locomotion) return;
    this.group.updateWorldMatrix(true, false);
    // footprint in booth-local space: x ±w/2, z from -d/2 (back wall) to
    // d/2 + 0.25 (counter front face), plus a small comfort margin
    const centre = this.group.localToWorld(new THREE.Vector3(0, 0, 0.125));
    locomotion.addBlocker(
      centre.x, centre.z,
      this.width / 2 + 0.1,
      this.depth / 2 + 0.225,
      this.group.rotation.y,
    );
  }
}

/**
 * ComingSoonBooth — decorated placeholder pad for future games.
 * Keeps the tent feeling full and marks the expansion hook visually.
 */
export class ComingSoonBooth {
  constructor(world, pad, futureName) {
    const g = new THREE.Group();
    g.position.copy(pad.position);
    g.rotation.y = pad.angle;
    g.translateZ(-0.4);

    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.5, 0.08),
      signPanelMaterials(
        signTexture(futureName, { bg: '#25252e', fg: '#8d8da8', sub: 'COMING SOON' }),
        0x1d1d26,
      ),
    );
    sign.position.y = 1.7;
    // brass rope-and-post barrier
    const postGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.95, 10);
    const postMat = shiny({ color: 0xd4af37, metalness: 1, roughness: 0.35, envIntensity: 1.1 });
    for (const sx of [-0.9, 0.9]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(sx, 0.48, 0.5);
      g.add(post);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), postMat);
      knob.position.set(sx, 0.98, 0.5);
      g.add(knob);
    }
    // velvet rope sags between the posts
    const sagPts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      sagPts.push(new THREE.Vector3(
        -0.9 + t * 1.8, 0.93 - Math.sin(t * Math.PI) * 0.14, 0.5));
    }
    const rope = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sagPts), 12, 0.022, 6),
      new THREE.MeshLambertMaterial({ color: 0x7a1f33 }),
    );
    g.add(rope, sign);
    world.scene.add(g);
  }
}

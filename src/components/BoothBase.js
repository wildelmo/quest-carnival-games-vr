import * as THREE from 'three';
import { stripesTexture, signTexture, CARNIVAL_PALETTE } from '../core/textures.js';
import { Scoreboard } from './Scoreboard.js';
import { PushButton } from './PushButton.js';

/**
 * BoothBase — the reusable carnival stall every mini-game is built on.
 *
 * Provides: striped awning, side posts, back/side walls, a counter at
 * 0.95m, a lit name sign, a scoreboard, a start button, a prize shelf
 * with plushies, and a floor "throw line" mat. Games add their own
 * contents behind the counter.
 *
 * Local space: booth faces +Z (toward the player). The counter runs along
 * X at z = depth/2. `getPad()` placement rotates the whole group.
 */

const COUNTER_HEIGHT = 0.95;

export class BoothBase {
  /**
   * @param {object} deps { world, input, audio }
   * @param {object} opts { name, width, depth, colorA, colorB, pad, onStart }
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

    // scoreboard hangs from the awning, tilted down toward the player
    this.scoreboard = new Scoreboard(opts.scoreboardTitle ?? this.name);
    this.scoreboard.group.position.set(this.width / 2 - 0.75, 2.05, this.depth / 2 - 0.15);
    this.scoreboard.group.rotation.x = -0.25;
    this.group.add(this.scoreboard.group);

    // start button on the counter, right of centre
    this.startButton = new PushButton(deps, {
      color: 0x2ecc71,
      label: 'START',
      onPress: () => opts.onStart && opts.onStart(),
    });
    this.startButton.group.position.set(this.width / 2 - 0.55, COUNTER_HEIGHT + 0.03, this.depth / 2 - 0.18);
    this.group.add(this.startButton.group);

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
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x33202b });
    // side walls wear the booth stripes so they read carnival from outside
    const sideMat = new THREE.MeshLambertMaterial({ map: stripesTexture(colorA, colorB, 6) });

    // back + side walls (thin boxes)
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, 0.08), wallMat);
    back.position.set(0, 1.3, -d / 2);
    const sideGeo = new THREE.BoxGeometry(0.08, 2.6, d);
    const left = new THREE.Mesh(sideGeo, sideMat);
    left.position.set(-w / 2, 1.3, 0);
    const right = new THREE.Mesh(sideGeo, sideMat);
    right.position.set(w / 2, 1.3, 0);
    this.group.add(back, left, right);
    this.backWall = back;

    // counter across the front
    this.counter = new THREE.Mesh(new THREE.BoxGeometry(w, COUNTER_HEIGHT, 0.5), woodMat);
    this.counter.position.set(0, COUNTER_HEIGHT / 2, this.depth / 2);
    // striped skirt on the counter front
    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(w, COUNTER_HEIGHT),
      new THREE.MeshLambertMaterial({ map: stripesTexture(colorA, colorB, 8) }),
    );
    skirt.position.set(0, 0, 0.251);
    this.counter.add(skirt);
    this.group.add(this.counter);

    // corner posts + striped awning
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, woodMat);
      post.position.set(sx * (w / 2 - 0.06), 1.3, d / 2 - 0.06);
      this.group.add(post);
    }
    // sloped striped canopy panel
    const canopy = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 0.3, 1.2),
      new THREE.MeshLambertMaterial({ map: stripesTexture(colorA, colorB, 10), side: THREE.DoubleSide }),
    );
    canopy.position.set(0, 2.85, d / 2 - 0.45);
    canopy.rotation.x = -0.5;
    this.group.add(canopy);

    // scalloped awning edge (little half-discs)
    const scallopGeo = new THREE.CircleGeometry(0.12, 10, Math.PI, Math.PI);
    const scallopMat = new THREE.MeshLambertMaterial({ color: colorA, side: THREE.DoubleSide });
    const scallops = Math.floor((w + 0.3) / 0.24);
    for (let i = 0; i < scallops; i++) {
      const s = new THREE.Mesh(scallopGeo, scallopMat);
      s.position.set(-(w + 0.3) / 2 + 0.12 + i * 0.24, 2.58, d / 2 + 0.09);
      this.group.add(s);
    }

    // big lit name sign above the awning
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.85, w * 0.85 / 4, 0.1),
      new THREE.MeshBasicMaterial({ map: signTexture(this.name, signColors), toneMapped: false }),
    );
    sign.position.set(0, 3.5, d / 2 - 0.25);
    sign.rotation.x = -0.15;
    this.group.add(sign);

    // throw-line mat on the floor in front of the booth
    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.8, 0.7),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(colorA).multiplyScalar(0.7) }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(0, 0.012, d / 2 + 0.85);
    this.group.add(mat);
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
      this.group.add(plush);
    }
  }

  /** Keep the player out of the booth interior (world-space AABB approx). */
  #addBlockers(locomotion) {
    if (!locomotion) return;
    const box = new THREE.Box3().setFromObject(this.counter);
    // expand to cover the whole stall footprint
    const full = new THREE.Box3().setFromObject(this.backWall).union(box);
    locomotion.addBlocker(full.min.x - 0.15, full.max.x + 0.15, full.min.z - 0.15, full.max.z + 0.15);
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
      new THREE.MeshBasicMaterial({
        map: signTexture(futureName, { bg: '#25252e', fg: '#8d8da8', sub: 'COMING SOON' }),
        toneMapped: false,
      }),
    );
    sign.position.y = 1.7;
    // rope-and-post barrier
    const postGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.95, 8);
    const postMat = new THREE.MeshLambertMaterial({ color: 0xd4af37 });
    for (const sx of [-0.9, 0.9]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(sx, 0.48, 0.5);
      g.add(post);
    }
    const rope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1.8, 6),
      new THREE.MeshLambertMaterial({ color: 0x7a1f33 }),
    );
    rope.rotation.z = Math.PI / 2;
    rope.position.set(0, 0.82, 0.5);
    g.add(rope, sign);
    world.scene.add(g);
  }
}

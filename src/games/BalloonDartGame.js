import * as THREE from 'three';
import { MiniGame } from './registry.js';
import { BoothBase } from '../components/BoothBase.js';
import { corkTexture, CARNIVAL_PALETTE } from '../core/textures.js';
import { shiny } from '../core/environment.js';

/**
 * BALLOON DARTS — pop the wall of balloons.
 *
 * A 1.9m x 1.55m (~6ft x 5ft) cork board carries a 7x5 grid of balloons,
 * each tied to a little brass nozzle. Darts lie flat in a tray on the
 * counter, noses already aimed at the board; throw them, they arc, stick
 * into the cork (or a balloon — POP, shards, points) and are quietly
 * re-racked by the invisible attendant a couple of seconds later.
 *
 * The round starts on the first dart you throw. The big red RESET button
 * re-racks every loose dart and runs the re-inflation show: nozzles hiss,
 * limp scraps of rubber swell back into balloons one after another with a
 * wobbly overshoot, then lock — no balloons ever just "appear".
 *
 * A held dart rides the hand rigidly: point the controller where you want
 * the dart to go and it goes there. No orientation cleverness — that made
 * darts pivot at the player's face when they cocked their arm back.
 *
 * Darts are NOT physics bodies: they fly on a swept segment each frame and
 * test balloon spheres + the board plane, which is cheaper and far more
 * reliable at Quest frame rates than collision-resolving a fast needle.
 */

const COLS = 7, ROWS = 5;
const BALLOON_R = 0.105;
const BOARD_W = 1.9, BOARD_H = 1.55;
const DART_COUNT = 6;
const GOLD_COUNT = 3;
const POP_POINTS = 10, GOLD_POINTS = 25, CLEAR_BONUS = 200;
const DART_GRAVITY = -5.5;   // darts fly a bit flat — feels accurate, not floaty
const RERACK_DELAY = 2.5;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _c1 = new THREE.Color();

export class BalloonDartGame extends MiniGame {
  constructor(deps, pad) {
    super(deps, 40);
    this.readyStatus = 'THROW A DART TO START';
    const { world } = deps;

    this.booth = new BoothBase(deps, {
      name: 'BALLOON DARTS',
      width: 3.6, depth: 2.6, pad,
      colorA: '#1d2a63', colorB: '#ffd23f',
      signColors: { bg: '#7a1f33', fg: '#ffd23f' },
      shelfY: 2.46, // the 5ft balloon board needs the wall below it clear
      // RESET sits just right of the dart tray so it's an easy,
      // straight-on reach from the throwing spot
      resetButtonLocal: new THREE.Vector3(0.35, 0.98, 1.45),
      onReset: () => this.requestReset(),
    });
    this.booth.group.updateWorldMatrix(true, true);
    this._now = 0;
    this.balloons = [];
    this.darts = [];
    this._inflateQueue = [];   // balloons waiting for their nozzle turn

    this.#buildBoard();
    this.#buildBalloons();
    this.#buildDarts();
    this.#buildShardPool();

    this.booth.scoreboard.setStatus(this.readyStatus);
  }

  /* ---------------------------------------------------------- build ---- */

  #buildBoard() {
    const g = this.booth.group;
    // cork board, tilted back a touch like the real thing
    this.board = new THREE.Group();
    this.board.position.set(0, 1.62, -1.12);
    this.board.rotation.x = 0.06;
    const cork = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W, BOARD_H, 0.05),
      new THREE.MeshLambertMaterial({ map: corkTexture() }),
    );
    // lacquered candy frame
    const frameMat = shiny({ color: 0xe02249, roughness: 0.26 });
    for (const [x, y, w, h] of [
      [0, BOARD_H / 2 + 0.04, BOARD_W + 0.16, 0.08],
      [0, -BOARD_H / 2 - 0.04, BOARD_W + 0.16, 0.08],
      [-BOARD_W / 2 - 0.04, 0, 0.08, BOARD_H],
      [BOARD_W / 2 + 0.04, 0, 0.08, BOARD_H],
    ]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), frameMat);
      bar.position.set(x, y, 0);
      this.board.add(bar);
    }
    this.board.add(cork);
    g.add(this.board);
    g.updateWorldMatrix(true, true);
  }

  #buildBalloons() {
    // shared geometry: pear-shaped balloon + knot
    const balloonGeo = new THREE.SphereGeometry(BALLOON_R, 12, 10);
    balloonGeo.scale(1, 1.18, 1);
    const knotGeo = new THREE.ConeGeometry(0.02, 0.03, 6);
    const nozzleGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.04, 8);
    const nozzleMat = shiny({ color: 0xd4af37, metalness: 1, roughness: 0.35 });

    // taut latex: tight speculars + env glints sell "balloon" instantly
    const mats = CARNIVAL_PALETTE.map(c => shiny({
      color: c, roughness: 0.16, envIntensity: 1.1,
      emissive: c, emissiveIntensity: 0.05,
    }));
    const goldMat = shiny({
      color: 0xffd23f, metalness: 0.65, roughness: 0.2, envIntensity: 1.3,
      emissive: 0xffb300, emissiveIntensity: 0.3,
    });

    // pick GOLD_COUNT random bonus balloons
    const goldSet = new Set();
    while (goldSet.size < GOLD_COUNT) goldSet.add((Math.random() * COLS * ROWS) | 0);

    const spanX = BOARD_W - 0.34, spanY = BOARD_H - 0.32;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const gold = goldSet.has(i);
        const x = -spanX / 2 + (c / (COLS - 1)) * spanX + (Math.random() - 0.5) * 0.02;
        const y = -spanY / 2 + (r / (ROWS - 1)) * spanY + (Math.random() - 0.5) * 0.02;

        // nozzle is always there — it's what "inflates" the balloon on reset
        const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
        nozzle.rotation.x = Math.PI / 2;
        nozzle.position.set(x, y, 0.045);
        this.board.add(nozzle);

        const mesh = new THREE.Mesh(balloonGeo, gold ? goldMat : mats[i % mats.length]);
        const knot = new THREE.Mesh(knotGeo, gold ? goldMat : mats[i % mats.length]);
        knot.position.y = -BALLOON_R * 1.18 - 0.012;
        mesh.add(knot);
        mesh.position.set(x, y + BALLOON_R * 0.9, 0.045 + 0.02);
        this.board.add(mesh);

        this.balloons.push({
          mesh, alive: true, gold,
          points: gold ? GOLD_POINTS : POP_POINTS,
          basePos: mesh.position.clone(),
          phase: Math.random() * Math.PI * 2,
          inflate: 1,            // 0..1 animated during reset
          inflateT: 0,
          radiusWorld: BALLOON_R, // slightly generous hitbox set below
          worldPos: new THREE.Vector3(),
        });
      }
    }
    this.#refreshBalloonWorldPositions();
  }

  #refreshBalloonWorldPositions() {
    for (const b of this.balloons) {
      b.mesh.getWorldPosition(b.worldPos);
    }
  }

  #buildDarts() {
    const g = this.booth.group;
    const h = this.booth.counterHeight;
    // shallow wooden tray on the counter: the darts lie flat in it, noses
    // already pointing at the balloon board, ready to pick up and throw
    const tray = new THREE.Group();
    tray.position.set(-0.4, h, 1.42);
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.02, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x2a2a35 }),
    );
    pad.position.y = 0.01;
    tray.add(pad);
    const trayMat = new THREE.MeshLambertMaterial({ color: 0x54371f });
    for (const [x, z, sx, sz] of [
      [0, -0.16, 0.64, 0.04],
      [0, 0.16, 0.64, 0.04],
      [-0.32, 0, 0.04, 0.36],
      [0.32, 0, 0.04, 0.36],
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.05, sz), trayMat);
      wall.position.set(x, 0.025, z);
      tray.add(wall);
    }
    g.add(tray);

    // Proper dart anatomy, modelled pointing along -Z (three.js "forward"):
    // steel needle -> colored metal barrel (where you grip) -> thin dark
    // shaft -> kite-shaped flights crossed in an X at the tail.
    const needleGeo = new THREE.ConeGeometry(0.0035, 0.05, 8);
    needleGeo.rotateX(-Math.PI / 2);                    // apex points -Z
    const barrelGeo = new THREE.CylinderGeometry(0.0065, 0.0065, 0.055, 10);
    barrelGeo.rotateX(Math.PI / 2);                     // axis along Z
    const shaftGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 0.055, 8);
    shaftGeo.rotateX(Math.PI / 2);
    // one kite-shaped flight blade in the YZ plane (contains the shaft axis);
    // a second copy rotated 90° around Z completes the classic X of fins
    const flightGeo = new THREE.BufferGeometry();
    flightGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.045,        // leading point on the shaft
      0, 0.024, 0.07,     // upper tip
      0, 0, 0.092,        // trailing point on the shaft
      0, -0.024, 0.07,    // lower tip
    ], 3));
    flightGeo.setIndex([0, 1, 2, 0, 2, 3]);
    flightGeo.computeVertexNormals();
    const steelMat = shiny({ color: 0xc7ccd8, metalness: 1, roughness: 0.22 });
    const shaftMat = shiny({ color: 0x2a2a35, metalness: 0.6, roughness: 0.35 });

    for (let i = 0; i < DART_COUNT; i++) {
      const color = CARNIVAL_PALETTE[(i * 2 + 1) % CARNIVAL_PALETTE.length];
      const dart = new THREE.Group();
      const needle = new THREE.Mesh(needleGeo, steelMat);
      needle.position.z = -0.075;                       // tip ends at z=-0.1
      // anodised metal barrel — the part you grip
      const barrel = new THREE.Mesh(barrelGeo,
        shiny({ color, metalness: 0.8, roughness: 0.3 }));
      barrel.position.z = -0.022;
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.z = 0.033;
      const f1 = new THREE.Mesh(flightGeo,
        shiny({ color, roughness: 0.2, side: THREE.DoubleSide }));
      const f2 = f1.clone();
      f2.rotation.z = Math.PI / 2;
      dart.add(needle, barrel, shaft, f1, f2);
      this.deps.world.scene.add(dart);
      this.deps.shadows?.track(dart, { radius: 0.07, strength: 0.55 });

      const rackPosLocal = new THREE.Vector3(-0.4 - 0.225 + i * 0.09, h + 0.035, 1.42);
      const d = {
        mesh: dart, state: 'racked',
        velocity: new THREE.Vector3(),
        prevPos: new THREE.Vector3(),
        rackPosLocal,
        rerackAt: 0,
        stickWobble: 0,
        grab: null,
      };
      d.grab = this.deps.grabbables.add(dart, {
        radius: 0.075,
        throwBoost: 1.45, // darts are precise, not powerful — help them along
        // rigid hold: the dart's nose tracks the controller's forward, so the
        // player aims it exactly like a real dart held in the fingers
        holdPosition: new THREE.Vector3(0, 0, -0.02),
        onGrab: () => { d.state = 'held'; },
        onThrow: (vel) => this.#throwDart(d, vel),
      });
      this.darts.push(d);
      this.#rackDart(d, true);
    }
  }

  /** pool of rubber shards reused for every pop */
  #buildShardPool() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [-0.02, 0, 0, 0.02, 0, 0, 0, 0.035, 0], 3));
    geo.computeVertexNormals();
    this.shards = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
      48,
    );
    this.shards.frustumCulled = false;
    this.deps.world.scene.add(this.shards);
    this._shardData = Array.from({ length: 48 }, () => ({
      life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: Math.random() * 6,
    }));
    this._shardCursor = 0;
    // park all instances at zero scale
    _m1.makeScale(0, 0, 0);
    for (let i = 0; i < 48; i++) this.shards.setMatrixAt(i, _m1);
    this.shards.instanceMatrix.needsUpdate = true;
  }

  /* -------------------------------------------------------- gameplay ---- */

  onRoundStart() {
    this.booth.scoreboard.setStatus('POP  THE  BALLOONS!');
  }

  onRoundEnd(reason) {
    this.booth.scoreboard.setStatus(
      reason === 'cleared' ? 'CLEARED! PRESS RESET' : 'TIME UP! PRESS RESET');
  }

  /** RESET: the attendant re-racks every loose dart, then re-inflates */
  onResetRound() {
    this.booth.scoreboard.setStatus('RE-INFLATING…');
    for (const d of this.darts) {
      if (d.state !== 'held') this.#rackDart(d, true);
    }
    // queue the nozzle show for every popped balloon, in random order;
    // #updateInflateQueue calls finishReset() once the board is whole again
    const dead = this.balloons.filter(b => !b.alive);
    dead.sort(() => Math.random() - 0.5);
    dead.forEach((b, i) => {
      this._inflateQueue.push({ balloon: b, at: this._now + 0.3 + i * 0.22 });
    });
  }

  #throwDart(dart, vel) {
    dart.state = 'flying';
    dart.velocity.copy(vel);
    dart.mesh.getWorldPosition(dart.prevPos);
    // too gentle to fly — it just tumbles to the counter or floor
    if (vel.length() < 1.2) return;
    this.tryStart(); // the first real throw begins the round
    dart.velocity.multiplyScalar(1.05);
    this.deps.audio.play('dispense', { volume: 0.15, rate: 2.2 }); // faint whoosh
  }

  #rackDart(dart, instant = false) {
    dart.state = 'racked';
    dart.mesh.position.copy(this.booth.group.localToWorld(dart.rackPosLocal.clone()));
    // lying flat in the tray, needle aimed at the board
    this.booth.group.getWorldQuaternion(dart.mesh.quaternion);
    if (!instant) this.deps.audio.play('targetUp', { at: dart.mesh, volume: 0.2, rate: 1.8 });
  }

  #popBalloon(balloon, popPos) {
    balloon.alive = false;
    balloon.mesh.visible = false;
    this.deps.audio.playPop(popPos.clone());
    this.#burstShards(popPos, balloon.mesh.material.color);
    if (this.state === 'running') {
      this.addScore(balloon.points, null);
      if (balloon.gold) this.deps.audio.play('win', { volume: 0.5, rate: 1.4 });
      if (this.balloons.every(b => !b.alive)) {
        this.score += CLEAR_BONUS;
        this.endRound('cleared');
      }
    }
  }

  #burstShards(pos, color) {
    for (let n = 0; n < 8; n++) {
      const s = this._shardData[this._shardCursor];
      this._shardCursor = (this._shardCursor + 1) % this._shardData.length;
      s.life = 0.45;
      s.pos.copy(pos);
      s.vel.set(
        (Math.random() - 0.5) * 3.2,
        Math.random() * 2.2 + 0.4,
        (Math.random() - 0.5) * 3.2,
      );
      this.shards.setColorAt(this._shardData.indexOf(s), _c1.copy(color));
    }
    if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;
  }

  onUpdate(dt, t) {
    this._now = t;
    this.#updateDarts(dt, t);
    this.#updateBalloons(dt, t);
    this.#updateShards(dt);
    this.#updateInflateQueue(t);
  }

  #updateDarts(dt, t) {
    for (const d of this.darts) {
      switch (d.state) {
        case 'flying': {
          d.prevPos.copy(d.mesh.position);
          d.velocity.y += DART_GRAVITY * dt;
          d.mesh.position.addScaledVector(d.velocity, dt);
          // nose follows the velocity vector. lookAt() points an object's
          // +Z at the target, and the nose is modelled on -Z — so look at
          // a point BEHIND the dart to make the needle lead.
          _v1.copy(d.velocity).normalize();
          _v2.copy(d.mesh.position).sub(_v1);
          d.mesh.lookAt(_v2);
          this.#sweepDart(d);
          // settle on whatever is below: the counter top when the dart is
          // over it (a gentle drop near the tray), otherwise the tent floor
          const rest = this.#restHeightAt(d.mesh.position);
          if (d.mesh.position.y < rest) {
            d.mesh.position.y = rest;
            d.state = 'fallen';
            d.rerackAt = t + RERACK_DELAY;
            this.deps.audio.play('thud', { at: d.mesh, volume: 0.25, rate: 1.6 });
          }
          break;
        }
        case 'stuck':
          // brief wobble after impact
          if (d.stickWobble > 0) {
            d.stickWobble -= dt;
            d.mesh.rotation.z += Math.sin(t * 40) * 0.02 * (d.stickWobble / 0.3);
          }
          if (t >= d.rerackAt) this.#rackDart(d);
          break;
        case 'fallen':
          if (t >= d.rerackAt) this.#rackDart(d);
          break;
      }
    }
  }

  /** where a falling dart comes to rest: counter top when over it, else floor */
  #restHeightAt(worldPos) {
    _v3.copy(worldPos);
    this.booth.group.worldToLocal(_v3);
    const overCounter = Math.abs(_v3.x) < this.booth.width / 2 &&
      Math.abs(_v3.z - this.booth.depth / 2) < 0.25;
    return overCounter ? this.booth.counterHeight + 0.02 : 0.03;
  }

  /** swept segment vs balloons, then vs the cork plane */
  #sweepDart(d) {
    const p0 = d.prevPos, p1 = d.mesh.position;

    // balloons: closest approach of segment to each alive balloon centre
    for (const b of this.balloons) {
      if (!b.alive || b.inflate < 0.85) continue;
      _v1.subVectors(p1, p0);
      const segLen2 = _v1.lengthSq();
      if (segLen2 < 1e-8) continue;
      _v2.subVectors(b.worldPos, p0);
      const s = THREE.MathUtils.clamp(_v2.dot(_v1) / segLen2, 0, 1);
      _v3.copy(p0).addScaledVector(_v1, s);
      if (_v3.distanceToSquared(b.worldPos) < (BALLOON_R * 1.12) ** 2) {
        this.#popBalloon(b, _v3);
        // dart keeps flying — often sticks into the cork right behind
      }
    }

    // cork board plane (board local z = 0.05 is the face)
    _v1.copy(p0); this.board.worldToLocal(_v1);
    _v2.copy(p1); this.board.worldToLocal(_v2);
    const FACE = 0.045;
    if (_v1.z > FACE && _v2.z <= FACE) {
      const s = (_v1.z - FACE) / (_v1.z - _v2.z);
      _v3.lerpVectors(_v1, _v2, s);
      if (Math.abs(_v3.x) < BOARD_W / 2 + 0.08 && Math.abs(_v3.y) < BOARD_H / 2 + 0.08) {
        // dart is fast enough to stick?
        if (d.velocity.lengthSq() > 4) {
          d.state = 'stuck';
          d.stickWobble = 0.3;
          d.rerackAt = this._now + RERACK_DELAY;
          // park the dart with ~2cm of needle in the cork (the nose reaches
          // 0.1 ahead of the origin), keeping its flight heading
          _v3.z = FACE + 0.08;
          d.mesh.position.copy(this.board.localToWorld(_v3.clone()));
          this.deps.audio.play('dartStick', { at: d.mesh, volume: 0.55, rate: 1.5 });
        } else {
          // bounced off
          d.velocity.multiplyScalar(-0.2);
          this.deps.audio.play('miss', { at: d.mesh, volume: 0.3, rate: 1.4 });
        }
      }
    }
  }

  #updateBalloons(dt, t) {
    for (const b of this.balloons) {
      if (!b.alive) continue;
      const m = b.mesh;
      if (b.inflate < 1) {
        // inflating: swell with a rubbery overshoot at the end
        b.inflateT += dt;
        const k = Math.min(1, b.inflateT / 0.55);
        const ease = k < 0.8 ? (k / 0.8) ** 1.6 : 1 + Math.sin((k - 0.8) / 0.2 * Math.PI) * 0.12;
        b.inflate = k;
        m.scale.setScalar(Math.max(0.08, ease));
        m.scale.y *= 0.75 + 0.25 * k; // starts limp/droopy, rounds out
        m.position.copy(b.basePos).setY(b.basePos.y - (1 - k) * BALLOON_R * 0.8);
        if (k >= 1) { m.scale.setScalar(1); m.position.copy(b.basePos); b.mesh.getWorldPosition(b.worldPos); }
      } else {
        // idle jiggle — tethered balloons are never quite still
        m.rotation.z = Math.sin(t * 2.1 + b.phase) * 0.055;
        m.rotation.x = Math.cos(t * 1.7 + b.phase) * 0.04;
      }
    }
  }

  #updateShards(dt) {
    let any = false;
    for (let i = 0; i < this._shardData.length; i++) {
      const s = this._shardData[i];
      if (s.life <= 0) continue;
      any = true;
      s.life -= dt;
      s.vel.y -= 6 * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.spin += dt * 10;
      const sc = Math.max(0, s.life / 0.45);
      _m1.makeRotationY(s.spin);
      _m1.scale(_v1.set(sc, sc, sc));
      _m1.setPosition(s.pos);
      this.shards.setMatrixAt(i, _m1);
    }
    if (any) this.shards.instanceMatrix.needsUpdate = true;
  }

  #updateInflateQueue(t) {
    for (let i = this._inflateQueue.length - 1; i >= 0; i--) {
      const job = this._inflateQueue[i];
      if (t < job.at) continue;
      this._inflateQueue.splice(i, 1);
      const b = job.balloon;
      b.alive = true;
      b.inflate = 0.01;
      b.inflateT = 0;
      b.mesh.visible = true;
      b.mesh.scale.setScalar(0.08);
      // nozzle hiss, pitch rising with the balloon
      this.deps.audio.play('inflate', { at: b.worldPos, volume: 0.45, rate: 0.9, jitter: 0.15 });
    }
    // reset finished?
    if (this.state === 'resetting' && this._inflateQueue.length === 0 &&
        this.balloons.every(b => b.alive && b.inflate >= 1)) {
      this.deps.audio.play('bell', { at: this.booth.group, volume: 0.5, rate: 1.2 });
      this.finishReset();
    }
  }
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MiniGame } from './registry.js';
import { BoothBase } from '../components/BoothBase.js';
import { BoxCollider, ForceZone, SphereBody } from '../core/Physics.js';
import { CARNIVAL_PALETTE } from '../core/textures.js';
import { shiny } from '../core/environment.js';
import { BallTossAudio } from './BallTossAudio.js';

/**
 * DOWN THE CLOWN — knock down the wall of plush clown dolls (5 wide,
 * 4 shelves high), boardwalk / Dave & Buster's style.
 *
 * A chute dispenses six dense fabric-skinned balls into a counter tray —
 * they throw and land like small sandbags, not bouncy rubber. Throw them
 * at the shelves of plush clowns; a solid hit punches THROUGH the doll
 * (it slams backwards on its hinge and the ball carries on, momentum
 * spent), glancing hits make it wobble and drop the ball dead. Balls land
 * with a low thunk, get swept to a grate spanning the base of the wall by
 * the sloped floor (a force zone), ride a return pipe, and pop back out
 * into the tray. A watchdog sweeps up any ball that comes to rest where
 * the player can't reach it, so the six balls always come back.
 *
 * Rows score 10/20/30/40 bottom→top. Clearing the whole wall ends the
 * round early with a +150 bonus and a fanfare.
 *
 * The round starts on the first ball you throw. The RESET button restores
 * everything: dolls winch back up, loose balls ride the return pipe back
 * to the tray, and the next throw begins a fresh round.
 *
 * Each clown is ONE mesh: all its parts (body, ruff, head, hair, face)
 * are merged into a single vertex-coloured geometry shared by every
 * doll, so the whole wall costs 20 draw calls.
 */

const BALL_COUNT = 6;
const BALL_RADIUS = 0.043;    // ~plum-sized foam ball (was 0.062, ~30% smaller)
const COLS = 5;
const ROWS = 4;               // 4 rows leaves real headroom between shelves
const ROW_SPACING = 0.36;     // dolls are ~0.27 tall; ~6cm of air above each
const KNOCK_SPEED = 1.5;      // m/s impact needed to knock a target down
const DOWN_ANGLE = -1.72;     // radians the pivot falls back to
const CLEAR_BONUS = 150;

const _v1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

export class BallTossGame extends MiniGame {
  constructor(deps, pad) {
    super(deps, 45);
    this.readyStatus = 'THROW A BALL TO START';
    const { world, audio, grabbables } = deps;

    // the booth's sandbag-on-doll voice (see BallTossAudio)
    this.sfx = new BallTossAudio(audio, world.scene);

    this.booth = new BoothBase(deps, {
      name: 'DOWN THE CLOWN',
      scoreboardTitle: 'DOWN THE CLOWN',
      width: 4, depth: 3, pad,
      colorA: '#c2183c', colorB: '#f6ead7',
      signColors: { bg: '#2a0f38', rainbow: true, sub: '6 BALLS · KNOCK EM ALL DOWN!' },
      shelfY: 2.46, // prize shelf clears the top clown row
      // RESET sits just right of the ball tray (tray centre x=0.35), near
      // the front of the counter so it's an easy straight-on reach
      resetButtonLocal: new THREE.Vector3(0.95, 0.98, 1.62),
      onReset: () => this.requestReset(),
    });
    const g = this.booth.group;
    g.updateWorldMatrix(true, true);
    this._worldQuat = g.getWorldQuaternion(new THREE.Quaternion());

    this.targets = [];
    this.balls = [];
    this._pendingReturns = []; // {ball, at} queued by the grate
    this._dispenseQueue = [];  // {ball, at} queued by round start
    this._downCount = 0;
    this._now = 0;

    // balls that somehow escape the world come back through the machine
    world.physics.onBodyLost = (body) => {
      const ball = this.balls.find(b => b.body === body);
      if (ball) { body.velocity.set(0, 0, 0); this.#dispense(ball); }
    };

    this.#buildWallColliders();
    this.#buildTargets();
    this.#buildTrayAndChute();
    this.#buildGutter();
    this.#spawnBalls(grabbables, audio, world);

    this.booth.scoreboard.setStatus(this.readyStatus);
  }

  /* ---------------------------------------------------------- build ---- */

  #localToWorld(x, y, z) {
    return this.booth.group.localToWorld(new THREE.Vector3(x, y, z));
  }
  #localDir(x, y, z) {
    return new THREE.Vector3(x, y, z).applyQuaternion(this._worldQuat);
  }

  /** back + side wall colliders so balls stay inside the stall */
  #buildWallColliders() {
    const { physics } = this.deps.world;
    const b = this.booth;
    // draped canvas soaks a heavy ball up — barely any bounce back
    physics.colliderFromMesh(b.backWall, new THREE.Vector3(b.width, 2.6, 0.08), { restitution: 0.15, friction: 0.6, tag: 'canvas' });
    for (const mesh of [b.group.children.filter(c => c.geometry?.parameters?.depth === b.depth)].flat()) {
      physics.colliderFromMesh(mesh, new THREE.Vector3(0.08, 2.6, b.depth), { restitution: 0.15, friction: 0.6, tag: 'canvas' });
    }
  }

  /**
   * One merged, vertex-coloured plush-clown geometry: white pear body,
   * yellow ruffled dress + collar, white head with orange hair puffs,
   * blue nose, bead eyes, red grin, yellow pom on top. Base sits at y=0
   * (the hinge line), face looks down +Z at the player.
   */
  static #buildClownGeometry() {
    const paint = (geo, hex) => {
      const c = new THREE.Color(hex).convertSRGBToLinear();
      const n = geo.attributes.position.count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.deleteAttribute('uv'); // mergeGeometries wants matching attributes
      return geo;
    };
    const PLUSH = '#ffffff', YELLOW = '#ffd23f', HAIR = '#ff6a2a';
    const parts = [
      // yellow dress skirt with white chest and arms above — mostly-white
      // doll with a yellow band, like the real boardwalk plush
      paint(new THREE.ConeGeometry(0.1, 0.13, 11), YELLOW).translate(0, 0.085, 0),
      paint(new THREE.SphereGeometry(0.06, 10, 8), PLUSH)
        .scale(1, 1.15, 0.85).translate(0, 0.16, 0),
      paint(new THREE.SphereGeometry(0.028, 7, 5), PLUSH).translate(-0.078, 0.14, 0),
      paint(new THREE.SphereGeometry(0.028, 7, 5), PLUSH).translate(0.078, 0.14, 0),
      // head
      paint(new THREE.SphereGeometry(0.058, 10, 8), PLUSH).translate(0, 0.235, 0),
      // hair puffs
      paint(new THREE.SphereGeometry(0.03, 7, 5), HAIR).translate(-0.056, 0.248, 0),
      paint(new THREE.SphereGeometry(0.03, 7, 5), HAIR).translate(0.056, 0.248, 0),
      // face: blue nose, bead eyes, red grin
      paint(new THREE.SphereGeometry(0.017, 7, 5), '#3a6bff').translate(0, 0.235, 0.05),
      paint(new THREE.SphereGeometry(0.009, 5, 4), '#1b1b1b').translate(-0.022, 0.256, 0.046),
      paint(new THREE.SphereGeometry(0.009, 5, 4), '#1b1b1b').translate(0.022, 0.256, 0.046),
      paint(new THREE.SphereGeometry(1, 8, 5), '#d4302f')
        .scale(0.028, 0.011, 0.009).translate(0, 0.207, 0.048),
    ];
    const merged = mergeGeometries(parts);
    // squat plush proportions; height stays clear of the shelf above
    merged.scale(1.14, 0.93, 0.93);
    return merged;
  }

  /** plush clowns on chunky cream-and-red shelf rows, hinged at the base */
  #buildTargets() {
    const g = this.booth.group;
    const { physics } = this.deps.world;
    const shelfTopMat = new THREE.MeshLambertMaterial({ color: 0xf2e6cd }); // cream boards
    const fasciaMat = shiny({ color: 0xc2183c, roughness: 0.28 });          // lacquered red lips
    const clownGeo = BallTossGame.#buildClownGeometry();
    const clownMat = new THREE.MeshLambertMaterial({ vertexColors: true });

    for (let row = 0; row < ROWS; row++) {
      // rows sit just above the counter and stop below the prize shelf
      const shelfY = 0.98 + row * ROW_SPACING;
      // shelf: cream board (visual + collider so balls ricochet off ledges)
      // with a red fascia strip along the front edge, like the real cabinet
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.03, 0.3), shelfTopMat);
      shelf.position.set(0, shelfY - 0.016, -1.05);
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.09, 0.02), fasciaMat);
      fascia.position.set(0, shelfY - 0.06, -0.89);
      g.add(shelf, fascia);
      physics.colliderFromMesh(shelf, new THREE.Vector3(2.4, 0.03, 0.3), { restitution: 0.3, tag: 'wood' });

      for (let col = 0; col < COLS; col++) {
        const x = -0.84 + col * 0.42;

        const root = new THREE.Group();          // hinge point on the shelf
        root.position.set(x, shelfY, -1.05);
        const pivot = new THREE.Group();          // rotates backwards when hit
        root.add(pivot);
        const doll = new THREE.Mesh(clownGeo, clownMat);
        pivot.add(doll);
        g.add(root);

        // world-space collider wrapping the standing doll
        root.updateWorldMatrix(true, true);
        const center = root.localToWorld(new THREE.Vector3(0, 0.135, 0));
        // a plush body over a wooden core: essentially zero bounce-back
        // (restitution near 0, heavy tangential grab), and when a hit
        // knocks the doll down the ball punches through the vacated space
        // keeping ~45% of its speed (see Physics punchThrough)
        const collider = physics.addCollider(new BoxCollider(
          center, new THREE.Vector3(0.115, 0.135, 0.05), this._worldQuat,
          { restitution: 0.04, friction: 0.85, punchThrough: 0.45, tag: 'target' },
        ));

        const target = {
          pivot, collider, row,
          state: 'up',        // up | falling | down | rising
          angVel: 0,
          wobble: 0, wobbleVel: 0,
          downTime: 0,
          points: 10 + row * 10,
          worldPos: center.clone(),
        };
        collider.onHit = (body, impact) => this.#onTargetHit(target, impact);
        this.targets.push(target);
      }
    }

    // cream beadboard backing keeps balls from wedging behind the shelves
    const backboard = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.9),
      new THREE.MeshLambertMaterial({ color: 0xd9c9a8 }),
    );
    backboard.position.set(0, 1.85, -1.32);
    this.booth.group.add(backboard);
  }

  #onTargetHit(target, impact) {
    if (target.state !== 'up') return;
    if (impact >= KNOCK_SPEED) {
      target.state = 'falling';
      target.angVel = -impact * 1.4;
      target.collider.enabled = false; // Physics sees this and lets the ball punch through
      this._downCount++;
      // the full sandbag-on-doll THUNK: synthesized wooden-core thump +
      // cloth whump under the recorded punch, pitched down for weight
      this.sfx.dollThunk(target.worldPos, impact);
      if (this.state === 'running') {
        this.addScore(target.points, target.worldPos);
        if (this._downCount >= ROWS * COLS) {
          this.score += CLEAR_BONUS;
          this.endRound('cleared');
        }
      }
    } else {
      // glancing blow: satisfying wobble but no points — the ball drops dead
      target.wobbleVel += impact * 3.5 * (Math.random() > 0.5 ? 1 : -1);
      this.sfx.dollTap(target.worldPos, impact);
    }
  }

  /** counter tray the balls live in + the return chute mouth beside it */
  #buildTrayAndChute() {
    const g = this.booth.group;
    const h = this.booth.counterHeight;
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x54371f });
    const { physics } = this.deps.world;

    // tray: open box sitting on the counter
    const tray = new THREE.Group();
    tray.position.set(0.35, h, 1.5);
    const wallSpecs = [
      // [x, z, sx, sz] tray walls (0.12 tall)
      [0, -0.21, 0.86, 0.04],
      [0, 0.21, 0.86, 0.04],
      [-0.41, 0, 0.04, 0.46],
      [0.41, 0, 0.04, 0.46],
    ];
    for (const [x, z, sx, sz] of wallSpecs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.12, sz), woodMat);
      wall.position.set(x, 0.06, z);
      tray.add(wall);
    }
    g.add(tray);
    g.updateWorldMatrix(true, true);
    for (const [x, z, sx, sz] of wallSpecs) {
      const center = tray.localToWorld(new THREE.Vector3(x, 0.06, z));
      physics.addCollider(new BoxCollider(
        center, new THREE.Vector3(sx / 2, 0.06, sz / 2), this._worldQuat,
        { restitution: 0.2, tag: 'wood' },
      ));
    }

    this.trayCenter = this.#localToWorld(0.35, h + 0.1, 1.5);

    // return spout: a short chute that rises from the left end of the tray and
    // pours balls back INTO the tray. Its mouth sits just above the tray's
    // left interior, angled down toward the middle so returned balls settle in
    // the tray rather than beside it.
    const metalMat = shiny({ color: 0xaab0c2, metalness: 0.75, roughness: 0.42 });
    const mouthLocal = new THREE.Vector3(0.02, h + 0.22, 1.5);
    // upright feeder housing behind the tray's left corner
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.16), metalMat);
    housing.position.set(-0.14, h + 0.17, 1.44);
    g.add(housing);
    // the angled spout coming off the housing, mouth over the tray
    const spout = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.07, 0.3, 12),
      metalMat,
    );
    spout.position.set(-0.06, h + 0.28, 1.48);
    spout.rotation.z = 0.85;   // tip the open mouth down toward the tray centre
    g.add(spout);
    // a rim ring at the mouth so the opening reads clearly
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 16), metalMat);
    rim.position.copy(mouthLocal);
    rim.rotation.set(Math.PI / 2 - 0.85, 0, 0);
    g.add(rim);
    this.chuteMouthLocal = mouthLocal.clone();
  }

  /** sloped-floor sweep + grate that swallows balls and feeds the chute */
  #buildGutter() {
    const { physics } = this.deps.world;
    const g = this.booth.group;

    // visible grate strip spanning the FULL base of the target wall —
    // wall to wall, so there is no dead corner a ball can rest in front of
    const grate = new THREE.Mesh(
      new THREE.BoxGeometry(3.85, 0.04, 0.34),
      new THREE.MeshLambertMaterial({ color: 0x1d1d26 }),
    );
    grate.position.set(0, 0.021, -1.28);
    g.add(grate);

    // sweep zone: whole booth floor pushes balls toward the grate. Spans
    // the full interior (side wall to side wall, all the way to the back
    // wall) so a ball hugging a wall still gets swept.
    physics.addZone(new ForceZone(
      this.#localToWorld(0, 0.15, 0.05),
      new THREE.Vector3(1.95, 0.18, 1.55),
      this._worldQuat,
      this.#localDir(0, 0, -2.2),
      { maxSpeed: 1.4 },
    ));

    // grate zone: consume the ball, then return it through the chute.
    // Full booth width and deep enough to reach the back wall — the old
    // narrower zone left the back corners uncovered and balls piled up
    // there for good.
    physics.addZone(new ForceZone(
      this.#localToWorld(0, 0.09, -1.3),
      new THREE.Vector3(1.95, 0.14, 0.24),
      this._worldQuat,
      new THREE.Vector3(0, 0, 0),
      {
        onEnter: (body) => this.#swallowBall(body),
      },
    ));
  }

  #swallowBall(body) {
    const ball = this.balls.find(b => b.body === body);
    if (!ball || !body.enabled) return;
    body.enabled = false;
    ball.mesh.visible = false;
    ball.grab.enabled = false;
    this.deps.audio.play('thud', { at: ball.mesh.getWorldPosition(_v1).clone(), volume: 0.4, rate: 1.05 });
    // ball travels the hidden pipe for a moment, then pops out at the tray
    this._pendingReturns.push({ ball, at: this._now + 1.6 });
  }

  #spawnBalls(grabbables, audio, world) {
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 14, 10);
    const seamMat = shiny({ color: 0xf6f2ea, roughness: 0.5 });
    for (let i = 0; i < BALL_COUNT; i++) {
      const color = CARNIVAL_PALETTE[i % CARNIVAL_PALETTE.length];
      // satin rubber sheen — matte enough to read as foam, glossy enough
      // to catch a highlight in flight
      const mesh = new THREE.Mesh(ballGeo, shiny({ color, roughness: 0.38 }));
      // seam ring makes the rolling visible
      const seam = new THREE.Mesh(
        new THREE.TorusGeometry(BALL_RADIUS, 0.006, 6, 18), seamMat);
      seam.rotation.x = Math.PI / 2.6;
      mesh.add(seam);
      world.scene.add(mesh);
      this.deps.shadows?.track(mesh, { radius: BALL_RADIUS * 1.5, strength: 0.85 });

      const body = new SphereBody(mesh, BALL_RADIUS, {
        // a dense fabric ball: barely bounces, grips on contact, stops
        // rolling fast — a small sandbag, not hollow plastic
        restitution: 0.28, friction: 0.5, rollFriction: 1.3,
        linearDamping: 0.05, tag: 'ball',
        gravityScale: 0.95, // near-real weight; throwBoost keeps it aimable
      });
      world.physics.addBody(body);
      // impact noises, rate-limited per ball. Target hits are voiced by the
      // target collider's onHit (the full doll thunk) — don't double them here.
      let lastSound = 0;
      body.onImpact = (speed, tag) => {
        if (this._now - lastSound < 0.09 || tag === 'ball' || tag === 'target') return;
        lastSound = this._now;
        this.sfx.surfaceThud(mesh.getWorldPosition(_v1).clone(), speed, tag);
      };

      const ball = {
        mesh, body,
        roll: audio.createRollLoop(mesh),
        stuckTime: 0, // watchdog: seconds at rest somewhere unreachable
        grab: grabbables.add(mesh, {
          radius: BALL_RADIUS + 0.03, body,
          // generous throw assist: a relaxed flick should reach the top
          // shelf even at near-real gravity
          throwBoost: 1.85,
          // the ball's CENTRE sits its own radius past the palm surface, so
          // it rests against the palm with the fingers curling around it —
          // the looser holdCurl keeps fingertips on, not through, the foam
          holdOffset: { palm: BALL_RADIUS + 0.015, fingers: 0.015 },
          holdCurl: 0.68,
          // the first real throw starts the round (a gentle drop doesn't)
          onThrow: (vel) => { if (vel.length() > 1) this.tryStart(); },
        }),
      };
      this.balls.push(ball);
      // start life resting in the tray
      body.warp(this.trayCenter.clone().add(new THREE.Vector3(
        (i % 3 - 1) * 0.14, 0.05, (i > 2 ? 0.09 : -0.09),
      )));
    }
  }

  /* ------------------------------------------------------- gameplay ---- */

  onRoundStart() {
    this.booth.scoreboard.setStatus('KNOCK  EM  DOWN!');
  }

  onRoundEnd(reason) {
    this.booth.scoreboard.setStatus(
      reason === 'cleared' ? 'CLEARED! PRESS RESET' : 'TIME UP! PRESS RESET');
    // knocked dolls stay down — the wall is only re-raised when the player
    // presses RESET for the next round (see onResetRound).
  }

  /** RESET: winch the whole wall back up and recall every loose ball */
  onResetRound() {
    this.booth.scoreboard.setStatus('RESETTING…');
    // pull every loose ball back through the machine, one at a time
    this._pendingReturns.length = 0;
    this._dispenseQueue.length = 0;
    let slot = 0;
    for (const ball of this.balls) {
      if (ball.grab.heldBy) continue; // let players keep balls in hand
      ball.body.enabled = false;
      ball.mesh.visible = false;
      ball.grab.enabled = false;
      this._dispenseQueue.push({ ball, at: this._now + 0.4 + slot * 0.35 });
      slot++;
    }
    for (const t of this.targets) if (t.state !== 'up') this.#startRise(t);
  }

  #startRise(target) {
    if (target.state === 'rising') return;
    target.state = 'rising';
    target.riseDelay = Math.random() * 0.5;
  }

  /** pop a ball out of the chute mouth so it rolls into the tray */
  #dispense(ball) {
    const mouth = this.booth.group.localToWorld(this.chuteMouthLocal.clone());
    ball.mesh.visible = true;
    ball.grab.enabled = true;
    ball.body.enabled = true;
    ball.body.warp(mouth);
    // gentle pour toward the tray centre — the mouth already sits above the
    // tray, so a soft nudge is enough to drop the ball in and let it settle
    ball.body.velocity.copy(this.#localDir(0.6, 0.15, 0));
    // soft contact tick as the ball tips out of the pipe — the tray thud
    // itself comes from the physics impact when it lands
    this.deps.audio.play('tick', { at: mouth, volume: 0.35, rate: 0.85, jitter: 0.15 });
  }

  onUpdate(dt, t) {
    this._now = t;

    // timed queues
    for (const q of [this._dispenseQueue, this._pendingReturns]) {
      for (let i = q.length - 1; i >= 0; i--) {
        if (t >= q[i].at) {
          this.#dispense(q[i].ball);
          q.splice(i, 1);
        }
      }
    }
    this.#animateTargets(dt, t);
    this.#updateBallAudio();
    this.#sweepStuckBalls(dt);

    if (this.state === 'resetting') {
      // a stray ball can knock a doll while the wall is rising — re-raise it
      // so the reset always converges on a full standing wall
      for (const target of this.targets) {
        if (target.state === 'down') this.#startRise(target);
      }
      // reset is done once every doll stands and the ball machine is quiet
      if (this._dispenseQueue.length === 0 && this._pendingReturns.length === 0 &&
          this.targets.every(x => x.state === 'up')) {
        this.finishReset();
      }
    }
  }

  /**
   * Watchdog: the zones cover the floor, but a ball can still come to rest
   * somewhere the sweep can't work on it — wedged in a corner seam, sitting
   * on a shelf between two dolls, asleep on a ledge. Any ball at rest
   * behind the counter line for a few seconds gets quietly swallowed into
   * the return pipe, exactly as if the attendant kicked it into the grate —
   * all six balls ALWAYS come back to the tray.
   */
  #sweepStuckBalls(dt) {
    for (const ball of this.balls) {
      const b = ball.body;
      if (!b.enabled || ball.grab.heldBy) { ball.stuckTime = 0; continue; }
      const still = b.asleep || b.velocity.lengthSq() < 0.01;
      const local = this.booth.group.worldToLocal(_v1.copy(b.position));
      if (still && local.z < 0.5) {
        ball.stuckTime += dt;
        if (ball.stuckTime > 3) {
          ball.stuckTime = 0;
          this.#swallowBall(b);
        }
      } else {
        ball.stuckTime = 0;
      }
    }
  }

  #animateTargets(dt, t) {
    let played = 0;
    for (const target of this.targets) {
      const p = target.pivot;
      switch (target.state) {
        case 'falling':
          // hinge physics: gravity torque + bounce at the stop
          target.angVel -= 6 * dt;
          p.rotation.x += target.angVel * dt;
          if (p.rotation.x <= DOWN_ANGLE) {
            p.rotation.x = DOWN_ANGLE;
            if (Math.abs(target.angVel) > 0.8) {
              target.angVel *= -0.35; // clatter bounce
            } else {
              target.state = 'down';
              target.downTime = t;
            }
          }
          break;
        case 'down':
          // a knocked-down doll stays down until the next round is started
          // (onRoundStart raises the whole wall) — it never self-rights.
          break;
        case 'rising': {
          if (target.riseDelay > 0) { target.riseDelay -= dt; break; }
          p.rotation.x += 2.6 * dt; // steady mechanical winch
          if (p.rotation.x >= 0) {
            p.rotation.x = 0;
            target.state = 'up';
            target.collider.enabled = true;
            this._downCount--;
            if (played++ < 3) {
              // doll clunks upright against its stop — real wood, no blip
              this.deps.audio.play('knock', { at: target.worldPos, volume: 0.25, rate: 1.15, jitter: 0.12 });
            }
          }
          break;
        }
        case 'up':
          // damped wobble spring on Z tilt
          if (Math.abs(target.wobble) > 0.001 || Math.abs(target.wobbleVel) > 0.001) {
            target.wobbleVel += -target.wobble * 60 * dt - target.wobbleVel * 6 * dt;
            target.wobble += target.wobbleVel * dt;
            p.rotation.z = THREE.MathUtils.clamp(target.wobble, -0.35, 0.35);
          }
          break;
      }
    }
  }

  #updateBallAudio() {
    for (const ball of this.balls) {
      const b = ball.body;
      const speed = Math.hypot(b.velocity.x, b.velocity.z);
      const rolling = b.enabled && b.grounded && !b.asleep && speed > 0.15;
      ball.roll.set(rolling ? Math.min(1, speed / 2.5) : 0, speed);
    }
  }
}

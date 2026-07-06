import * as THREE from 'three';
import { MiniGame } from './registry.js';
import { BoothBase } from '../components/BoothBase.js';
import { BoxCollider, ForceZone, SphereBody } from '../core/Physics.js';
import { targetFaceTexture, randomTargetKind, CARNIVAL_PALETTE } from '../core/textures.js';

/**
 * BALL TOSS — knock down the 5x5 wall of plush targets.
 *
 * A chute dispenses six foam softballs into a counter tray. Throw them at
 * the target wall; solid hits knock targets backwards on their hinges,
 * glancing hits make them wobble. Balls bounce around the booth, get swept
 * to a grate at the base of the wall by the sloped floor (a force zone),
 * ride a return pipe, and pop back out into the tray.
 *
 * Rows score 10/20/30/40/50 bottom→top. Clearing all 25 ends the round
 * early with a +150 bonus and a fanfare.
 */

const BALL_COUNT = 6;
const BALL_RADIUS = 0.062;
const GRID = 5;
const KNOCK_SPEED = 1.9;      // m/s impact needed to knock a target down
const DOWN_ANGLE = -1.72;     // radians the pivot falls back to
const CLEAR_BONUS = 150;

const _v1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

export class BallTossGame extends MiniGame {
  constructor(deps, pad) {
    super(deps, 45);
    const { world, audio, grabbables } = deps;

    this.booth = new BoothBase(deps, {
      name: 'BALL TOSS',
      width: 4, depth: 3, pad,
      colorA: '#c2183c', colorB: '#f6ead7',
      signColors: { bg: '#1d2a63', fg: '#ffd23f' },
      onStart: () => this.tryStart(),
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

    this.booth.scoreboard.setStatus('PRESS  START');
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
    physics.colliderFromMesh(b.backWall, new THREE.Vector3(b.width, 2.6, 0.08), { restitution: 0.35, tag: 'canvas' });
    for (const mesh of [b.group.children.filter(c => c.geometry?.parameters?.depth === b.depth)].flat()) {
      physics.colliderFromMesh(mesh, new THREE.Vector3(0.08, 2.6, b.depth), { restitution: 0.35, tag: 'canvas' });
    }
  }

  /** 5x5 plush faces on shelf rows, hinged at the base */
  #buildTargets() {
    const g = this.booth.group;
    const shelfMat = new THREE.MeshLambertMaterial({ color: 0x54371f });
    const plateGeo = new THREE.BoxGeometry(0.24, 0.26, 0.035);
    const faceGeo = new THREE.CircleGeometry(0.125, 20);
    const { physics } = this.deps.world;

    for (let row = 0; row < GRID; row++) {
      const shelfY = 1.12 + row * 0.3;
      // shelf board (visual + collider so balls ricochet off ledges)
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.03, 0.3), shelfMat);
      shelf.position.set(0, shelfY - 0.016, -1.05);
      g.add(shelf);
      physics.colliderFromMesh(shelf, new THREE.Vector3(2.4, 0.03, 0.3), { restitution: 0.3, tag: 'wood' });

      for (let col = 0; col < GRID; col++) {
        const x = -0.84 + col * 0.42;
        const kind = randomTargetKind(row * GRID + col);
        const tint = '#' + new THREE.Color(CARNIVAL_PALETTE[(row + col * 3) % CARNIVAL_PALETTE.length]).getHexString();

        const root = new THREE.Group();          // hinge point on the shelf
        root.position.set(x, shelfY, -1.05);
        const pivot = new THREE.Group();          // rotates backwards when hit
        root.add(pivot);
        const plate = new THREE.Mesh(plateGeo, new THREE.MeshLambertMaterial({ color: tint }));
        plate.position.y = 0.13;
        const face = new THREE.Mesh(faceGeo,
          new THREE.MeshLambertMaterial({ map: targetFaceTexture(kind, tint) }));
        face.position.set(0, 0.13, 0.019);
        pivot.add(plate, face);
        g.add(root);

        // world-space collider matching the standing plate
        root.updateWorldMatrix(true, true);
        const collider = physics.colliderFromMesh(plate, new THREE.Vector3(0.24, 0.26, 0.05), {
          restitution: 0.25, tag: 'target',
        });

        const target = {
          pivot, collider, row,
          state: 'up',        // up | falling | down | rising
          angVel: 0,
          wobble: 0, wobbleVel: 0,
          downTime: 0,
          points: 10 + row * 10,
          worldPos: plate.getWorldPosition(new THREE.Vector3()),
        };
        collider.onHit = (body, impact) => this.#onTargetHit(target, impact);
        this.targets.push(target);
      }
    }

    // backboard behind the targets keeps balls from wedging behind shelves
    const backboard = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.9),
      new THREE.MeshLambertMaterial({ color: 0x24122e }),
    );
    backboard.position.set(0, 1.85, -1.32);
    this.booth.group.add(backboard);
  }

  #onTargetHit(target, impact) {
    if (target.state !== 'up') return;
    const audio = this.deps.audio;
    if (impact >= KNOCK_SPEED) {
      target.state = 'falling';
      target.angVel = -impact * 1.4;
      target.collider.enabled = false;
      this._downCount++;
      audio.play('hit', { at: target.worldPos, volume: Math.min(1, impact / 5) });
      audio.play('fall', { at: target.worldPos, volume: 0.7, rate: 1.1 });
      if (this.state === 'running') {
        this.addScore(target.points, target.worldPos);
        if (this._downCount >= GRID * GRID) {
          this.score += CLEAR_BONUS;
          this.endRound('cleared');
        }
      }
    } else {
      // glancing blow: satisfying wobble but no points
      target.wobbleVel += impact * 3.5 * (Math.random() > 0.5 ? 1 : -1);
      audio.play('hit', { at: target.worldPos, volume: 0.35, rate: 1.25 });
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

    // return chute: angled pipe emerging left of the tray
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.5, 10, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x9aa0b4, side: THREE.DoubleSide }),
    );
    pipe.position.set(-1.15, h + 0.02, 1.45);
    pipe.rotation.z = 1.1;
    g.add(pipe);
    this.chuteMouthLocal = new THREE.Vector3(-0.95, h + 0.18, 1.45);
  }

  /** sloped-floor sweep + grate that swallows balls and feeds the chute */
  #buildGutter() {
    const { physics } = this.deps.world;
    const g = this.booth.group;

    // visible grate strip at the base of the target wall
    const grate = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.04, 0.34),
      new THREE.MeshLambertMaterial({ color: 0x1d1d26 }),
    );
    grate.position.set(0, 0.021, -1.28);
    g.add(grate);

    // sweep zone: whole booth floor pushes balls toward the grate
    physics.addZone(new ForceZone(
      this.#localToWorld(0, 0.15, 0.1),
      new THREE.Vector3(1.9, 0.18, 1.5),
      this._worldQuat,
      this.#localDir(0, 0, -2.2),
      { maxSpeed: 1.4 },
    ));

    // grate zone: consume the ball, then return it through the chute
    physics.addZone(new ForceZone(
      this.#localToWorld(0, 0.09, -1.28),
      new THREE.Vector3(1.3, 0.12, 0.18),
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
    this.deps.audio.play('thud', { at: ball.mesh.getWorldPosition(_v1).clone(), volume: 0.4, rate: 1.3 });
    // ball travels the hidden pipe for a moment, then pops out at the tray
    this._pendingReturns.push({ ball, at: this._now + 1.6 });
  }

  #spawnBalls(grabbables, audio, world) {
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 14, 10);
    for (let i = 0; i < BALL_COUNT; i++) {
      const color = CARNIVAL_PALETTE[i % CARNIVAL_PALETTE.length];
      const mesh = new THREE.Mesh(ballGeo, new THREE.MeshLambertMaterial({ color }));
      // seam ring makes the rolling visible
      const seam = new THREE.Mesh(
        new THREE.TorusGeometry(BALL_RADIUS, 0.006, 6, 18),
        new THREE.MeshLambertMaterial({ color: 0xffffff }),
      );
      seam.rotation.x = Math.PI / 2.6;
      mesh.add(seam);
      world.scene.add(mesh);

      const body = new SphereBody(mesh, BALL_RADIUS, {
        restitution: 0.62, rollFriction: 0.7, tag: 'ball',
      });
      world.physics.addBody(body);
      // impact noises, rate-limited per ball
      let lastSound = 0;
      body.onImpact = (speed, tag) => {
        if (this._now - lastSound < 0.09 || tag === 'ball') return;
        lastSound = this._now;
        audio.play(tag === 'target' ? 'hit' : 'thud',
          { at: mesh.getWorldPosition(_v1).clone(), volume: Math.min(0.9, speed / 6), rate: 1.15 });
      };

      const ball = {
        mesh, body,
        roll: audio.createRollLoop(mesh),
        grab: grabbables.add(mesh, { radius: BALL_RADIUS + 0.03, body }),
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
    // pull every loose ball back through the machine, one at a time
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
    // raise any targets that were knocked over while idling
    for (const t of this.targets) if (t.state !== 'up') this.#startRise(t);
  }

  onRoundEnd(reason) {
    this.booth.scoreboard.setStatus(
      reason === 'cleared' ? 'CLEARED!  +' + CLEAR_BONUS : 'TIME  UP!');
    // reset the wall after a short beat so players see what they hit
    this._resetAt = this._now + 2.6;
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
    ball.body.velocity.copy(this.#localDir(1.4, 0.9, 0));
    this.deps.audio.play('dispense', { at: mouth, volume: 0.6, rate: 1.3 });
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
    if (this._resetAt && t >= this._resetAt) {
      this._resetAt = 0;
      this.state = 'idle';
      this.booth.scoreboard.setStatus('PRESS  START');
      this.targets.forEach((target, i) => {
        if (target.state !== 'up') {
          this.#startRise(target);
          target.riseDelay = i * 0.06; // ripple across the wall
        }
      });
    }

    this.#animateTargets(dt, t);
    this.#updateBallAudio();
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
          // outside a round, targets pick themselves back up after a bit
          if (this.state !== 'running' && this.state !== 'over' && t - target.downTime > 2.5) {
            this.#startRise(target);
          }
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
              this.deps.audio.play('targetUp', { at: target.worldPos, volume: 0.35, rate: 1.4 });
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

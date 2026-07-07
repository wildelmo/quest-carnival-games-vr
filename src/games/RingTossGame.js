import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MiniGame } from './registry.js';
import { BoothBase } from '../components/BoothBase.js';
import { CARNIVAL_PALETTE } from '../core/textures.js';
import { shiny } from '../core/environment.js';

/**
 * RING TOSS — the classic wall-to-wall field of glass soda bottles.
 *
 * Modelled on the real boardwalk game: 324 green glass bottles packed
 * neck-to-neck in nine wooden soda crates (6x6 bottles each) covering a
 * full square table — front row an easy lob from the counter, back row a
 * long throw — with gold bonus bottles mixed in and a bucket of 20
 * plastic rings on the counter. Grab a ring however you like — it rides
 * the hand rigidly like the darts — and toss it at the bottles.
 *
 * SIZING (researched from real carnival games): real rings are ~40mm
 * inner diameter over a ~28mm bottle crown, land only when flat, and win
 * about 3% of the time. That's too cruel for VR, so our ring is 50mm ID
 * over the same lip — a flat, well-aimed lob ringers a few times per
 * bucket, but tilted rings still clatter off the necks like the real thing.
 * A held ring keeps the orientation it was grabbed in and turns with the
 * wrist like any free object (see Grabbables).
 *
 * Rings are NOT physics bodies (the engine only does spheres). Each flying
 * ring integrates ballistically in booth-local space and resolves against
 * the bottle lattice analytically: crossing the lip plane while flat and
 * centred over a neck is a RINGER (slide down the neck, score); clipping a
 * lip bounces it with a glass tink; anything that drops between necks
 * settles tilted in the valley between bottle shoulders. Misses land on
 * the table, counter or floor; rings that fall on the player's side can be
 * picked up and thrown again.
 *
 * RESET (the attendant's sweep): every loose ring — off the bottles, out
 * of the valleys, up off the floor — arcs back into the bucket one after
 * another, then the next throw starts a fresh round.
 */

// bottle lattice: a full square — 9 crates of 6x6 bottles, cells sized
// like a real soda crate (~78mm) so bottle bodies almost touch
const COLS = 18, ROWS = 18;
const SPACING = 0.078;
const CRATE_COLS = 6, CRATE_ROWS = 6; // bottles per crate
const TABLE_Y = 0.72;                 // table top (bottle bases)
const BOTTLE_H = 0.212;               // classic 7.5" glass soda bottle
const LIP_R = 0.0135;                 // crown lip outer radius (~27mm dia)
const BODY_R = 0.032;
const SHOULDER_Y = 0.135;             // where the body tapers to the neck
const NECK_TOP = TABLE_Y + BOTTLE_H;  // lip plane the rings must cross
const SHOULDER_TOP = TABLE_Y + SHOULDER_Y;
const RINGED_Y = TABLE_Y + 0.148;     // where a ringer comes to rest

const RING_COUNT = 20;
const RING_R = 0.030, TUBE_R = 0.005; // 50mm ID / 70mm OD plastic ring
const RING_INNER = RING_R - TUBE_R, RING_OUTER = RING_R + TUBE_R;
const RINGER_TOL = RING_INNER - LIP_R + 0.0035; // centre-to-axis tolerance
const FLAT_MIN = 0.72;                // |normal.y| needed to drop over a neck
const RING_GRAVITY = -8;
const MAX_BOUNCES = 5;

const RING_POINTS = 25, GOLD_POINTS = 100, GOLD_COUNT = 10;

// field extents in booth-local space (front row closest to the player)
const FIELD_X0 = -((COLS - 1) / 2) * SPACING;
const FIELD_Z_FRONT = 0.62;
const FIELD_MIN_X = FIELD_X0 - SPACING / 2;
const FIELD_MAX_X = -FIELD_MIN_X;
const FIELD_MIN_Z = FIELD_Z_FRONT - (ROWS - 1) * SPACING - SPACING / 2;
const FIELD_MAX_Z = FIELD_Z_FRONT + SPACING / 2;

const _v1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class RingTossGame extends MiniGame {
  constructor(deps, pad) {
    super(deps, 60);
    this.readyStatus = 'THROW A RING TO START';

    this.booth = new BoothBase(deps, {
      name: 'RING TOSS',
      width: 4, depth: 3, pad,
      colorA: '#0e7a5f', colorB: '#f6ead7',
      signColors: { bg: '#123a30', fg: '#ffd23f', sub: '20 RINGS · RING A BOTTLE TO WIN!' },
      // RESET sits just right of the ring bucket on the counter
      resetButtonLocal: new THREE.Vector3(0.35, 0.98, 1.6),
      onReset: () => this.requestReset(),
    });
    this.booth.group.updateWorldMatrix(true, true);
    this._invQuat = this.booth.group.getWorldQuaternion(new THREE.Quaternion()).invert();
    this._now = 0;

    this.bottles = [];
    this.rings = [];

    this.#buildTableAndCrates();
    this.#buildBottles();
    this.#buildBucketAndRings();

    this.booth.scoreboard.setStatus(this.readyStatus);
  }

  /* ---------------------------------------------------------- build ---- */

  #buildTableAndCrates() {
    const g = this.booth.group;
    const fieldW = FIELD_MAX_X - FIELD_MIN_X;
    const fieldD = FIELD_MAX_Z - FIELD_MIN_Z;
    const centerZ = (FIELD_MIN_Z + FIELD_MAX_Z) / 2;

    // low table the whole bottle field stands on — warm enough to read
    // under the booth's own shade
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(fieldW + 0.24, TABLE_Y, fieldD + 0.24),
      new THREE.MeshLambertMaterial({ color: 0x77502c }),
    );
    table.position.set(0, TABLE_Y / 2, centerZ);
    g.add(table);

    // six shallow wooden soda crates (6x4 cells each), merged into one mesh
    const t = 0.015, h = 0.1;
    const walls = [];
    const crate = (minX, maxX, minZ, maxZ) => {
      const w = maxX - minX, d = maxZ - minZ;
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      walls.push(
        new THREE.BoxGeometry(w, h, t).translate(cx, TABLE_Y + h / 2, minZ + t / 2),
        new THREE.BoxGeometry(w, h, t).translate(cx, TABLE_Y + h / 2, maxZ - t / 2),
        new THREE.BoxGeometry(t, h, d).translate(minX + t / 2, TABLE_Y + h / 2, cz),
        new THREE.BoxGeometry(t, h, d).translate(maxX - t / 2, TABLE_Y + h / 2, cz),
      );
    };
    for (let cc = 0; cc < COLS / CRATE_COLS; cc++) {
      for (let cr = 0; cr < ROWS / CRATE_ROWS; cr++) {
        crate(
          FIELD_X0 + (cc * CRATE_COLS - 0.5) * SPACING,
          FIELD_X0 + ((cc + 1) * CRATE_COLS - 0.5) * SPACING,
          FIELD_Z_FRONT - ((cr + 1) * CRATE_ROWS - 0.5) * SPACING,
          FIELD_Z_FRONT - (cr * CRATE_ROWS - 0.5) * SPACING,
        );
      }
    }
    const crates = new THREE.Mesh(
      mergeGeometries(walls),
      new THREE.MeshLambertMaterial({ color: 0x9c6c3f }),
    );
    g.add(crates);
  }

  /** 324 glass bottles as ONE InstancedMesh (a single draw call) */
  #buildBottles() {
    // low-poly contour-bottle profile: base, body, shoulder, neck, crown lip
    const profile = [
      [0.002, 0], [0.031, 0.004], [BODY_R, 0.075], [0.028, 0.125],
      [0.016, 0.165], [0.0115, 0.185], [LIP_R, 0.205], [0.0125, BOTTLE_H],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(profile, 8);
    // near-mirror roughness + env map = the whole field of glass GLINTS as
    // you move your head, which is the making of this booth
    const mat = shiny({ color: 0xffffff, roughness: 0.06, envIntensity: 1.35 });
    const mesh = new THREE.InstancedMesh(geo, mat, COLS * ROWS);

    const goldSet = new Set();
    while (goldSet.size < GOLD_COUNT) goldSet.add((Math.random() * COLS * ROWS) | 0);

    const glass = new THREE.Color('#3f9268');   // coke-bottle green
    const glassAlt = new THREE.Color('#4380a8'); // a few blue-glass bottles
    const gold = new THREE.Color('#ffd23f');
    let i = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = FIELD_X0 + col * SPACING;
        const z = FIELD_Z_FRONT - row * SPACING;
        _m1.makeRotationY(Math.random() * Math.PI); // hide the lathe seam
        _m1.setPosition(x, TABLE_Y, z);
        mesh.setMatrixAt(i, _m1);
        const isGold = goldSet.has(i);
        mesh.setColorAt(i, isGold ? gold : (Math.random() < 0.12 ? glassAlt : glass));
        this.bottles.push({
          x, z, gold: isGold,
          points: isGold ? GOLD_POINTS : RING_POINTS,
          ringsOn: 0, // ringers stack if a bottle is hit twice
        });
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // three culls instanced meshes by the BASE geometry's bounds — never cull
    mesh.frustumCulled = false;
    this.booth.group.add(mesh);
  }

  #buildBucketAndRings() {
    const g = this.booth.group;
    const h = this.booth.counterHeight;

    // galvanised ring bucket on the counter
    const bucket = new THREE.Group();
    bucket.position.set(-0.35, h, 1.5);
    const metal = shiny({
      color: 0xaab0c2, metalness: 0.75, roughness: 0.45, side: THREE.DoubleSide,
    });
    const side = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.115, 0.13, 14, 1, true), metal);
    side.position.y = 0.065;
    const base = new THREE.Mesh(new THREE.CircleGeometry(0.115, 14), metal);
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.005;
    bucket.add(side, base);
    g.add(bucket);
    this.bucketLocal = bucket.position.clone();

    // 20 plastic rings piled inside in three loose stacks
    const ringGeo = new THREE.TorusGeometry(RING_R, TUBE_R, 6, 16);
    ringGeo.rotateX(Math.PI / 2); // lie flat: hole axis = Y
    // glossy injection-moulded plastic
    const ringMats = CARNIVAL_PALETTE.map(c => shiny({ color: c, roughness: 0.18 }));
    for (let i = 0; i < RING_COUNT; i++) {
      const mesh = new THREE.Mesh(ringGeo, ringMats[(i * 3 + 2) % ringMats.length]);
      this.deps.world.scene.add(mesh);
      this.deps.shadows?.track(mesh, { radius: RING_OUTER * 1.3, strength: 0.7 });

      const ring = {
        mesh, state: 'bucket', // bucket|held|flying|ringing|settling|returning|resting|ringed
        p: new THREE.Vector3(),      // booth-local position while flying
        v: new THREE.Vector3(),      // booth-local velocity while flying
        prevY: 0,
        bounces: 0,
        playerSide: false,           // resting where the player can re-grab it
        anim: null,                  // {t0,dur,fromPos,toPos,fromQuat,toQuat,arc,then}
        bucketSlot: this.#bucketSlot(i),
        grab: null,
      };
      ring.grab = this.deps.grabbables.add(mesh, {
        radius: RING_OUTER + 0.035,
        throwBoost: 1.5,
        // palm anchor only — the ring keeps its grabbed orientation, so
        // you pick it up however it lies and level it with your wrist
        holdPosition: new THREE.Vector3(0, 0, -0.06),
        onGrab: () => { ring.state = 'held'; },
        onThrow: (vel) => this.#throwRing(ring, vel),
      });
      this.rings.push(ring);
      this.#placeInBucket(ring);
    }
  }

  /** stacked pile positions inside the bucket (booth-local) */
  #bucketSlot(i) {
    const stack = i % 3;
    const [ox, oz] = [[-0.05, 0.045], [0.055, 0.03], [0.0, -0.055]][stack];
    return new THREE.Vector3(
      this.bucketLocal.x + ox,
      this.bucketLocal.y + 0.016 + Math.floor(i / 3) * (TUBE_R * 2 + 0.001),
      this.bucketLocal.z + oz,
    );
  }

  #placeInBucket(ring) {
    ring.state = 'bucket';
    ring.grab.enabled = true;
    ring.mesh.position.copy(this.booth.group.localToWorld(ring.bucketSlot.clone()));
    this.booth.group.getWorldQuaternion(ring.mesh.quaternion);
    ring.mesh.rotateY(Math.random() * Math.PI);
    ring.mesh.rotateX((Math.random() - 0.5) * 0.15); // slightly askew pile
  }

  /* -------------------------------------------------------- gameplay ---- */

  onRoundEnd(reason) {
    this.booth.scoreboard.setStatus(
      reason === 'rings' ? 'OUT OF RINGS! PRESS RESET' : 'TIME UP! PRESS RESET');
  }

  /** RESET: the attendant sweeps every loose ring back into the bucket */
  onResetRound() {
    this.booth.scoreboard.setStatus('COLLECTING RINGS…');
    for (const b of this.bottles) b.ringsOn = 0;
    let slot = 0;
    for (const ring of this.rings) {
      // players keep rings in hand; bucket rings are already home
      if (ring.state === 'held' || ring.state === 'bucket') continue;
      this.#startAnim(ring, 'returning', {
        delay: slot * 0.06,
        dur: 0.5,
        toPos: ring.bucketSlot,
        toQuat: null, // flat with a random yaw, built at start time
        arc: 0.35,
        then: () => this.#placeInBucket(ring),
      });
      slot++;
    }
  }

  #throwRing(ring, vel) {
    // hand the ring to the local-space flight integrator
    ring.state = 'flying';
    ring.grab.enabled = false;
    ring.bounces = 0;
    ring.p.copy(ring.mesh.position);
    this.booth.group.worldToLocal(ring.p);
    ring.v.copy(vel).applyQuaternion(this._invQuat);
    ring.prevY = ring.p.y;
    if (vel.length() >= 1) {
      this.tryStart(); // the first real throw begins the round — silently
    }
  }

  /* --------------------------------------------------- flight physics ---- */

  #updateFlying(ring, dt) {
    const p = ring.p, v = ring.v;
    const prevX = p.x, prevZ = p.z;
    ring.prevY = p.y;
    v.y += RING_GRAVITY * dt;
    p.addScaledVector(v, dt);

    // in-flight stabilisation: a tossed ring planes toward flat, so a
    // roughly-level release arrives flat enough to ringer. Heavily tilted
    // releases stay tilted — and once it has clipped a crown it just
    // tumbles, no more self-levelling (that let tilted rings cheat on).
    if (ring.bounces === 0) {
      _v1.copy(UP).applyQuaternion(ring.mesh.quaternion);
      if (_v1.y < 0) _v1.negate();
      _q1.setFromUnitVectors(_v1, UP);
      _q2.copy(_q1).multiply(ring.mesh.quaternion);
      ring.mesh.quaternion.slerp(_q2, 1 - Math.exp(-3 * dt));
    }

    // booth walls (only apply inside the stall — the walkway is open)
    if (p.z < this.booth.depth / 2) {
      const wallX = this.booth.width / 2 - 0.1;
      if (Math.abs(p.x) > wallX) {
        p.x = Math.sign(p.x) * wallX;
        v.x *= -0.4;
        this.#knock(p, 0.2);
      }
      const backZ = -this.booth.depth / 2 + 0.1;
      if (p.z < backZ) {
        p.z = backZ;
        v.z *= -0.4;
        this.#knock(p, 0.25);
      }
    }

    // counter: front face, back face (from inside the booth), and the top —
    // which only catches rings arriving from ABOVE, so a ring bouncing
    // around underneath can never teleport up onto it
    const counterFront = this.booth.depth / 2 + 0.25;
    const counterBack = this.booth.depth / 2 - 0.25;
    const counterTop = this.booth.counterHeight;
    if (p.y < counterTop && v.z < 0 && p.z < counterFront && prevZ >= counterFront) {
      p.z = counterFront;
      v.z *= -0.35;
      this.#knock(p, 0.2);
    } else if (p.y < counterTop && v.z > 0 && p.z > counterBack && prevZ <= counterBack) {
      p.z = counterBack;
      v.z *= -0.35;
      this.#knock(p, 0.15);
    } else if (p.z > counterBack && p.z < counterFront && v.y < 0 &&
               ring.prevY >= counterTop + TUBE_R && p.y < counterTop + TUBE_R) {
      if (this.#trySettleFlat(ring, counterTop + TUBE_R, true)) return;
    }

    // the bottle field
    const inField = p.x > FIELD_MIN_X - RING_OUTER && p.x < FIELD_MAX_X + RING_OUTER &&
                    p.z > FIELD_MIN_Z - RING_OUTER && p.z < FIELD_MAX_Z + RING_OUTER;
    if (inField) {
      // flying in from the side below the necks: the packed glass is a wall
      const wasInField = prevX > FIELD_MIN_X - RING_OUTER && prevX < FIELD_MAX_X + RING_OUTER &&
                         prevZ > FIELD_MIN_Z - RING_OUTER && prevZ < FIELD_MAX_Z + RING_OUTER;
      if (!wasInField && p.y < NECK_TOP) {
        const slam = v.length();
        if (prevZ >= FIELD_MAX_Z + RING_OUTER) { p.z = FIELD_MAX_Z + RING_OUTER; v.z *= -0.3; }
        else if (prevX <= FIELD_MIN_X - RING_OUTER) { p.x = FIELD_MIN_X - RING_OUTER; v.x *= -0.3; }
        else if (prevX >= FIELD_MAX_X + RING_OUTER) { p.x = FIELD_MAX_X + RING_OUTER; v.x *= -0.3; }
        v.multiplyScalar(0.6);
        this.#clink(p, Math.min(0.85, 0.45 + slam * 0.07), slam);
        this.#syncMesh(ring);
        return;
      }

      // crossing the lip plane downward — the moment of truth
      if (ring.prevY > NECK_TOP && p.y <= NECK_TOP && v.y < 0) {
        const s = (ring.prevY - NECK_TOP) / (ring.prevY - p.y);
        const cx = prevX + (p.x - prevX) * s;
        const cz = prevZ + (p.z - prevZ) * s;
        const bottle = this.#nearestBottle(cx, cz);
        if (bottle) {
          const dx = cx - bottle.x, dz = cz - bottle.z;
          const d = Math.hypot(dx, dz);
          _v1.copy(UP).applyQuaternion(ring.mesh.quaternion);
          const flat = Math.abs(_v1.y);
          if (d < RINGER_TOL && flat > FLAT_MIN) {
            this.#ringer(ring, bottle, cx, cz);
            return;
          }
          if (d < RING_OUTER + LIP_R) {
            // clipped a crown — glassy bounce, ring loses its composure.
            // Dead-centre hits deflect in a random direction: a tilted ring
            // can't balance on a lip, it always skids off somewhere.
            p.set(cx, NECK_TOP + 0.002, cz);
            v.y = Math.abs(v.y) * 0.32;
            let nx = dx, nz = dz;
            if (d > 0.004) { nx /= d; nz /= d; }
            else { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); nz = Math.sin(a); }
            const kick = 0.35 + Math.random() * 0.4;
            v.x += nx * kick;
            v.z += nz * kick;
            _q1.setFromAxisAngle(
              _v1.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
              (Math.random() - 0.5) * 0.7);
            ring.mesh.quaternion.premultiply(_q1);
            ring.bounces++;
            this.#clink(p, Math.min(0.9, 0.4 + v.length() * 0.08), v.length());
            if (ring.bounces > MAX_BOUNCES || v.lengthSq() < 0.5) {
              this.#settleInValley(ring, p.x, p.z);
            } else {
              this.#syncMesh(ring);
            }
            return;
          }
          // fell cleanly between crowns — drops toward the shoulders below
        }
      }

      // sinking below the shoulders: wedge into the valley between bottles
      if (p.y <= SHOULDER_TOP && ring.prevY < NECK_TOP) {
        this.#settleInValley(ring, p.x, p.z);
        return;
      }
      if (p.y < TABLE_Y) { // tunnelled — snap back up into a valley
        this.#settleInValley(ring, p.x, p.z);
        return;
      }
    } else {
      // table top outside the crates
      const overTable = p.x > FIELD_MIN_X - 0.12 && p.x < FIELD_MAX_X + 0.12 &&
                        p.z > FIELD_MIN_Z - 0.12 && p.z < FIELD_MAX_Z + 0.12;
      if (overTable && p.y < TABLE_Y + TUBE_R && v.y < 0) {
        if (this.#trySettleFlat(ring, TABLE_Y + TUBE_R, false)) return;
      }
    }

    // tent floor
    if (p.y < TUBE_R + 0.003) {
      if (this.#trySettleFlat(ring, TUBE_R + 0.003, true)) return;
    }

    this.#syncMesh(ring);
  }

  /** write the local-space flight position back to the world-space mesh */
  #syncMesh(ring) {
    ring.mesh.position.copy(ring.p);
    this.booth.group.localToWorld(ring.mesh.position);
  }

  /** bounce on a horizontal surface, coming to rest flat once it's slow */
  #trySettleFlat(ring, restY, reachable) {
    const p = ring.p, v = ring.v;
    p.y = restY;
    ring.bounces++;
    if (Math.abs(v.y) < 0.9 || ring.bounces > MAX_BOUNCES + 2) {
      ring.state = 'resting';
      // "playerSide" rings still count as throwable: on the counter top, or
      // on the floor out in the walkway
      const onCounter = restY > this.booth.counterHeight - 0.05;
      ring.playerSide = reachable && (onCounter || p.z > this.booth.depth / 2 + 0.05);
      ring.grab.enabled = reachable;
      v.set(0, 0, 0);
      ring.mesh.position.copy(p);
      this.booth.group.localToWorld(ring.mesh.position);
      // lie flat with the yaw it landed at
      _v1.copy(UP).applyQuaternion(ring.mesh.quaternion);
      if (_v1.y < 0) _v1.negate();
      _q1.setFromUnitVectors(_v1, UP);
      ring.mesh.quaternion.premultiply(_q1);
      this.deps.audio.play('tick', { at: ring.mesh, volume: 0.25, jitter: 0.15 });
      return true;
    }
    v.y = Math.abs(v.y) * 0.35;
    v.x *= 0.6;
    v.z *= 0.6;
    this.deps.audio.play('tick', { at: ring.mesh, volume: 0.2, rate: 1.1, jitter: 0.15 });
    return false;
  }

  #nearestBottle(lx, lz) {
    const col = Math.round((lx - FIELD_X0) / SPACING);
    const row = Math.round((FIELD_Z_FRONT - lz) / SPACING);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return this.bottles[row * COLS + col];
  }

  /** RINGER! slide down the neck, settle on the shoulder, score */
  #ringer(ring, bottle, cx, cz) {
    ring.p.set(cx, NECK_TOP, cz);
    ring.v.set(0, 0, 0);
    const restY = RINGED_Y + bottle.ringsOn * (TUBE_R * 2 + 0.001);
    bottle.ringsOn++;
    this.#startAnim(ring, 'ringing', {
      dur: 0.22,
      toPos: new THREE.Vector3(bottle.x, restY, bottle.z),
      toQuat: null,
      arc: 0,
      then: () => {
        ring.state = 'ringed';
        const at = this.booth.group.localToWorld(new THREE.Vector3(bottle.x, NECK_TOP, bottle.z));
        // ring slides down the neck and lands on the glass shoulder — that
        // clink IS the ringer feedback; the scoreboard does the rest
        this.deps.audio.play('glassLight',
          { at, volume: 0.7, rate: 1.08, refDistance: 2.8, jitter: 0.1 });
        this.addScore(bottle.points, at);
      },
    });
  }

  /** wedge tilted into the gap between four bottle shoulders */
  #settleInValley(ring, lx, lz) {
    const vc = THREE.MathUtils.clamp(Math.round((lx - FIELD_X0) / SPACING - 0.5), 0, COLS - 2);
    const vr = THREE.MathUtils.clamp(Math.round((FIELD_Z_FRONT - lz) / SPACING - 0.5), 0, ROWS - 2);
    const toQuat = new THREE.Quaternion()
      .setFromAxisAngle(_v1.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
        0.3 + Math.random() * 0.35)
      .multiply(_q1.setFromAxisAngle(UP, Math.random() * Math.PI));
    this.#startAnim(ring, 'settling', {
      dur: 0.18,
      toPos: new THREE.Vector3(
        FIELD_X0 + (vc + 0.5) * SPACING,
        TABLE_Y + 0.115,
        FIELD_Z_FRONT - (vr + 0.5) * SPACING),
      toQuat,
      arc: 0,
      then: () => {
        ring.state = 'resting';
        ring.playerSide = false;
        // wedged between the bottle shoulders — glass on glass
        this.deps.audio.play('glassMedium',
          { at: ring.mesh, volume: 0.5, rate: 1.1, jitter: 0.1, refDistance: 2.5 });
      },
    });
  }

  /* ---------------------------------------------------- animation core ---- */

  /** short scripted move in booth-local space (ringer slide, valley wedge,
   *  attendant collecting rings back to the bucket) */
  #startAnim(ring, state, { delay = 0, dur, toPos, toQuat, arc, then }) {
    ring.state = state;
    ring.grab.enabled = false;
    ring.anim = {
      t0: this._now + delay, dur, arc, then,
      fromPos: null, // captured when the delay elapses
      toPos: toPos.clone(),
      toQuat,
    };
  }

  #updateAnims(t) {
    for (const ring of this.rings) {
      const a = ring.anim;
      if (!a || t < a.t0) continue;
      if (!a.fromPos) {
        a.fromPos = this.booth.group.worldToLocal(ring.mesh.position.clone());
        a.fromQuat = ring.mesh.quaternion.clone();
        if (!a.toQuat) { // default target: flat, random yaw, booth-aligned
          a.toQuat = this.booth.group.getWorldQuaternion(new THREE.Quaternion())
            .multiply(_q1.setFromAxisAngle(UP, Math.random() * Math.PI * 2));
        } else {
          a.toQuat = this.booth.group.getWorldQuaternion(new THREE.Quaternion()).multiply(a.toQuat);
        }
      }
      const k = Math.min(1, (t - a.t0) / a.dur);
      const e = k * (2 - k); // ease-out
      _v1.lerpVectors(a.fromPos, a.toPos, e);
      _v1.y += Math.sin(k * Math.PI) * a.arc; // little hop for returns
      ring.mesh.position.copy(_v1);
      this.booth.group.localToWorld(ring.mesh.position);
      ring.mesh.quaternion.slerpQuaternions(a.fromQuat, a.toQuat, e);
      if (k >= 1) {
        ring.anim = null;
        if (a.then) a.then();
      }
    }
  }

  /** ring clanking off the glass: light/medium/heavy by how hard it hit.
   *  Pitched up a touch and layered with a hard contact tick — that's the
   *  "cla-CHINK" of rigid plastic on a bottle, not a rubbery bounce. */
  #clink(localPos, volume, speed = 1) {
    const at = this.booth.group.localToWorld(localPos.clone());
    const name = speed > 1.8 ? 'glassHeavy' : speed > 0.8 ? 'glassMedium' : 'glassLight';
    this.deps.audio.play(name, { at, volume, rate: 1.12, jitter: 0.08, refDistance: 2.5 });
    this.deps.audio.play('tick', { at, volume: volume * 0.5, rate: 1.45, jitter: 0.1, refDistance: 2.5 });
  }

  /** ring knocking the booth woodwork (walls, counter faces) */
  #knock(localPos, volume) {
    const at = this.booth.group.localToWorld(localPos.clone());
    this.deps.audio.play('knock', { at, volume, rate: 1.2, jitter: 0.12 });
  }

  /* ----------------------------------------------------------- update ---- */

  onUpdate(dt, t) {
    this._now = t;
    for (const ring of this.rings) {
      if (ring.state === 'flying') this.#updateFlying(ring, dt);
    }
    this.#updateAnims(t);

    if (this.state === 'running') {
      // rings the player can still throw: in the bucket, in hand, or landed
      // back on their side of the counter
      let usable = 0, active = 0;
      for (const r of this.rings) {
        if (r.state === 'bucket' || r.state === 'held' ||
            (r.state === 'resting' && r.playerSide)) usable++;
        if (r.state === 'flying' || r.state === 'ringing' || r.state === 'settling') active++;
      }
      this.booth.scoreboard.setStatus(`${usable} RINGS LEFT`);
      if (usable === 0 && active === 0) this.endRound('rings');
    }

    if (this.state === 'resetting') {
      // a ring released mid-reset lands after the sweep started — collect
      // it too, so the reset always converges on a full bucket
      for (const r of this.rings) {
        if ((r.state === 'resting' || r.state === 'ringed') && !r.anim) {
          this.#startAnim(r, 'returning', {
            dur: 0.5, toPos: r.bucketSlot, toQuat: null, arc: 0.35,
            then: () => this.#placeInBucket(r),
          });
        }
      }
      // reset is done once every loose ring is back in the bucket
      if (this.rings.every(r => r.state === 'bucket' || r.state === 'held')) {
        this.finishReset();
      }
    }
  }
}

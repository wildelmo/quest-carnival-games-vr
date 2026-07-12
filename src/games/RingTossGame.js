import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MiniGame } from './registry.js';
import { BoothBase } from '../components/BoothBase.js';
import { CARNIVAL_PALETTE } from '../core/textures.js';
import { shiny } from '../core/environment.js';
import { RingTossAudio } from './RingTossAudio.js';

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
 * FLIGHT is a real (if tiny) rigid-body sim, because the whole feel of the
 * game is a hard plastic ring BOUNCING around the glass. Each flying ring
 * carries velocity AND tumble (angular velocity — seeded by the wrist
 * flick that threw it) and is integrated in booth-local space with short
 * substeps. Collision is the ring's rim — sample points around the torus —
 * against the analytic bottle lattice: crown-lip tori, tapering necks,
 * shoulders. Every contact applies a restitution+friction impulse at the
 * contact point, so an off-centre lip strike TUMBLES the ring and pings it
 * to the next crown; a ring dropping between necks pinballs down with a
 * quickening clatter before wedging tilted in the valley — exactly the
 * honest-but-brutal physics of the real game. Rings can also land flat
 * bridged across the crowns, skid and wobble out on the counter or table
 * (coin-style ring-down), or bounce clean off the front row back at you.
 *
 * A ring lobbed flat and centred over a crown is a RINGER: it drops over
 * the neck, rattles down it, chinks onto the glass shoulder and wobbles
 * itself flat — that clink is the scoring feedback, no jingles.
 *
 * SOUND: every contact is voiced by RingTossAudio — modal-synth glass
 * (each of the 324 bottles has its own persistent pitch) fused with a
 * hard-plastic clak, graded and brightened by impact speed, over the
 * repo's recorded Kenney impacts for body. Wood is real plank knocks.
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
const RING_GRAVITY = -8;              // touch light: keeps lobs aimable

const RING_POINTS = 25, GOLD_POINTS = 100, GOLD_COUNT = 10;

// ---- rigid-ring contact model ---------------------------------------------
// the rim is sampled at RIM_N points (each a TUBE_R sphere) against the
// bottles' analytic silhouette; impulses use unit mass + a scalar torus
// inertia — plenty for a 34-gram ring that only has to LOOK right
const RIM_N = 10;
const RIM_DIRS = Array.from({ length: RIM_N }, (_, i) => {
  const a = (i / RIM_N) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
});
const RING_I = 0.62 * RING_R * RING_R; // between the torus' two moments
const NECK_R = 0.012;                  // crown-neck radius (ringer rattle gap)
const Y_LIP = TABLE_Y + 0.2085;        // height of the crown-lip torus circle
const LIP_EDGE = 0.004;                // rounding of the crimped cap edge
const MAX_CONTACTS = 60;               // convergence guards — nothing
const MAX_AIR_TIME = 7;                // clatters forever
const MU_WOOD = 0.35, MU_FLOOR = 0.5;

// hard injection-moulded plastic on glass is LIVELY off the crowns and
// deadens as the ring sinks into the packed field; damp shades the voicing
const ZONES = {
  lip:      { e: 0.55, mu: 0.18, damp: 0.05 },
  neck:     { e: 0.42, mu: 0.20, damp: 0.30 },
  shoulder: { e: 0.33, mu: 0.24, damp: 0.50 },
  body:     { e: 0.30, mu: 0.26, damp: 0.62 },
};

// piecewise-linear bottle silhouette (height above table -> radius),
// matching the lathe profile below; _bUp is the outward normal's upward
// tilt on that segment (necks are steep, shoulders push a ring up and out)
const BOTTLE_KNOTS = [
  [0.004, 0.031], [0.075, 0.032], [0.125, 0.028],
  [0.165, 0.016], [0.185, 0.0115], [0.200, 0.012],
];
let _bR = 0, _bUp = 0;
function bottleSurfaceAt(hy) {
  const K = BOTTLE_KNOTS;
  if (hy <= K[0][0]) { _bR = K[0][1]; _bUp = 0; return; }
  for (let i = 1; i < K.length; i++) {
    if (hy <= K[i][0]) {
      const h0 = K[i - 1][0], r0 = K[i - 1][1];
      const s = (K[i][1] - r0) / (K[i][0] - h0);
      _bR = r0 + s * (hy - h0);
      _bUp = -s / Math.hypot(1, s);
      return;
    }
  }
  _bR = K[K.length - 1][1]; _bUp = 0;
}

// field extents in booth-local space (front row closest to the player)
const FIELD_X0 = -((COLS - 1) / 2) * SPACING;
const FIELD_Z_FRONT = 0.62;
const FIELD_MIN_X = FIELD_X0 - SPACING / 2;
const FIELD_MAX_X = -FIELD_MIN_X;
const FIELD_MIN_Z = FIELD_Z_FRONT - (ROWS - 1) * SPACING - SPACING / 2;
const FIELD_MAX_Z = FIELD_Z_FRONT + SPACING / 2;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _va = new THREE.Vector3(); // reserved for #impulse
const _vb = new THREE.Vector3(); // reserved for #impulse
const _sndV = new THREE.Vector3(); // world-space sound positions
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
    this._boothQuat = this.booth.group.getWorldQuaternion(new THREE.Quaternion());
    this._invQuat = this._boothQuat.clone().invert();
    this._now = 0;

    // the booth's plastic-on-glass voice (see RingTossAudio)
    this.sfx = new RingTossAudio(deps.audio, deps.world.scene);

    this.bottles = [];
    this.rings = [];
    this._valleys = new Map(); // valley cell -> wedged-ring stack height

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
          idx: i, // seeds this bottle's own glass pitch in RingTossAudio
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
    this._bucketWorld = this.booth.group.localToWorld(this.bucketLocal.clone());

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
        w: new THREE.Vector3(),      // booth-local tumble (rad/s)
        q: new THREE.Quaternion(),   // booth-local orientation while flying
        contacts: 0,                 // lifetime guard for this flight
        airTime: 0,
        lastSnd: 0,                  // per-ring clatter rate limit
        lipSup: 0,                   // crown supports this substep (bridging)
        playerSide: false,           // resting where the player can re-grab it
        anim: null,                  // lerp/wobble/ringer animation state
        bucketSlot: this.#bucketSlot(i),
        grab: null,
        _qPrev: null, _wEst: null, _qT: -1, // wrist-spin estimate while held
      };
      ring.grab = this.deps.grabbables.add(mesh, {
        radius: RING_OUTER + 0.035,
        throwBoost: 1.5,
        // anchor only — the ring keeps its grabbed orientation, so you pick
        // it up however it lies and level it with your wrist; it rides just
        // off the fist top so the hoop hangs from the hand, not around it
        holdOffset: { palm: 0.02, fingers: 0, up: 0.06 },
        onGrab: () => {
          ring.state = 'held';
          ring._qT = -1;
          if (ring._wEst) ring._wEst.set(0, 0, 0);
        },
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
    this._valleys.clear();
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
        then: () => {
          this.#placeInBucket(ring);
          this.sfx.bucketDrop(this._bucketWorld);
        },
      });
      slot++;
    }
  }

  #throwRing(ring, vel) {
    // hand the ring to the local-space rigid-ring integrator
    ring.state = 'flying';
    ring.grab.enabled = false;
    ring.contacts = 0;
    ring.airTime = 0;
    ring.lastSnd = 0;
    ring.p.copy(ring.mesh.position);
    this.booth.group.worldToLocal(ring.p);
    ring.v.copy(vel).applyQuaternion(this._invQuat);
    ring.q.copy(this._invQuat).multiply(ring.mesh.quaternion);
    // tumble: the wrist flick captured while held (XR), plus a natural flat
    // spin for desktop throws (a mouse can't twist on release)
    if (ring._wEst) {
      ring.w.copy(ring._wEst).applyQuaternion(this._invQuat);
      if (ring.w.lengthSq() > 25 * 25) ring.w.setLength(25);
    } else {
      ring.w.set(0, 0, 0);
    }
    if (!this.deps.input.isXR || ring.w.lengthSq() < 4) {
      ring.w.y += (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 3);
    }
    if (vel.length() >= 1) {
      this.tryStart(); // the first real throw begins the round — silently
    }
  }

  /** wrist-flick tracker: estimate angular velocity of a held ring so the
   *  throw inherits real spin (flat frisbee spin, end-over-end flip…) */
  #trackHeldSpin(ring, t) {
    if (!ring._qPrev) {
      ring._qPrev = new THREE.Quaternion();
      ring._wEst = new THREE.Vector3();
      ring._qT = -1;
    }
    if (ring._qT < 0) {
      ring._qPrev.copy(ring.mesh.quaternion);
      ring._qT = t;
      return;
    }
    const dt = t - ring._qT;
    if (dt < 1 / 200) return;
    _q1.copy(ring._qPrev).invert().premultiply(ring.mesh.quaternion); // Δq
    if (_q1.w < 0) { _q1.x *= -1; _q1.y *= -1; _q1.z *= -1; _q1.w *= -1; }
    const half = Math.acos(Math.min(1, _q1.w));
    const s = Math.sin(half);
    if (s > 1e-5) {
      _v1.set(_q1.x / s, _q1.y / s, _q1.z / s).multiplyScalar(2 * half / dt);
      if (_v1.lengthSq() > 900) _v1.setLength(30);
      ring._wEst.lerp(_v1, 0.35);
    } else {
      ring._wEst.multiplyScalar(0.7);
    }
    ring._qPrev.copy(ring.mesh.quaternion);
    ring._qT = t;
  }

  /* --------------------------------------------------- flight physics ---- */

  #inField(x, z) {
    return x > FIELD_MIN_X - RING_OUTER && x < FIELD_MAX_X + RING_OUTER &&
           z > FIELD_MIN_Z - RING_OUTER && z < FIELD_MAX_Z + RING_OUTER;
  }

  #updateFlying(ring, dt) {
    // substep so fast rings can't tunnel through a 12mm crown lip
    const steps = Math.min(8, Math.max(1, Math.ceil(ring.v.length() * dt / 0.02)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (this.#stepRing(ring, h)) return; // left flight (rest/wedge/ringer)
    }
    ring.airTime += dt;
    this.#syncMesh(ring);
  }

  /** one substep; returns true if the ring transitioned out of 'flying' */
  #stepRing(ring, h) {
    const p = ring.p, v = ring.v, w = ring.w;
    const prevX = p.x, prevY = p.y, prevZ = p.z;

    // convergence guards — a pathological clatterer gets tucked in
    if (ring.contacts > MAX_CONTACTS || ring.airTime > MAX_AIR_TIME) {
      if (this.#inField(p.x, p.z)) { this.#settleInValley(ring, p.x, p.z); return true; }
      const sy = this.#supportYUnder(ring);
      return this.#startWobbleSettle(ring, sy,
        sy < 0.01 ? 'floor' : 'wood', sy !== TABLE_Y);
    }

    v.y += RING_GRAVITY * h;
    v.multiplyScalar(1 - 0.04 * h);

    if (ring.contacts === 0) {
      // in-flight stabilisation: a tossed ring planes toward flat, so a
      // roughly-level release arrives flat enough to ringer. Once it has
      // touched glass it just tumbles — no more self-levelling (that let
      // tilted rings cheat on).
      _v1.copy(UP).applyQuaternion(ring.q);
      if (_v1.y < 0) _v1.negate();
      _q1.setFromUnitVectors(_v1, UP);
      _q2.copy(_q1).multiply(ring.q);
      ring.q.slerp(_q2, 1 - Math.exp(-3 * h));
      const d = Math.exp(-2.5 * h); // planing also damps end-over-end tumble
      w.x *= d;
      w.z *= d;
    } else {
      w.multiplyScalar(Math.exp(-0.8 * h)); // air slowly takes the tumble
    }

    // integrate the tumble into the orientation
    const wl = w.length();
    if (wl > 1e-4) {
      _q1.setFromAxisAngle(_v1.copy(w).divideScalar(wl), wl * h);
      ring.q.premultiply(_q1).normalize();
    }

    p.addScaledVector(v, h);

    // ---- stall woodwork (only binds inside the stall — the walkway is open)
    if (p.z < this.booth.depth / 2) {
      const wallX = this.booth.width / 2 - 0.1;
      if (Math.abs(p.x) > wallX) {
        const impact = Math.abs(v.x);
        p.x = Math.sign(p.x) * wallX;
        v.x *= -0.45;
        w.y += (Math.random() - 0.5) * 6;
        w.z += (Math.random() - 0.5) * 6;
        ring.contacts++;
        if (this.#sndOk(ring, 0.05)) {
          this.sfx.woodKnock(this.booth.group.localToWorld(_sndV.copy(p)), impact);
        }
      }
      const backZ = -this.booth.depth / 2 + 0.1;
      if (p.z < backZ) {
        const impact = Math.abs(v.z);
        p.z = backZ;
        v.z *= -0.45;
        w.x += (Math.random() - 0.5) * 6;
        w.y += (Math.random() - 0.5) * 6;
        ring.contacts++;
        if (this.#sndOk(ring, 0.05)) {
          this.sfx.woodKnock(this.booth.group.localToWorld(_sndV.copy(p)), impact);
        }
      }
    }

    // ---- counter: front face, back face (from inside the booth), and the
    // top — which only catches rings arriving from ABOVE, so a ring
    // bouncing around underneath can never teleport up onto it
    const counterFront = this.booth.depth / 2 + 0.25;
    const counterBack = this.booth.depth / 2 - 0.25;
    const counterTop = this.booth.counterHeight;
    if (p.z > counterBack && p.z < counterFront &&
        prevY >= counterTop - 0.001 && p.y < counterTop + 0.06) {
      // over the counter top and descending onto it (swept so a fast drop
      // can't pass the plane inside one substep)
      if (this.#surfaceContact(ring, counterTop, 0.38, MU_WOOD, 'wood', true, h)) return true;
    } else if (p.y < counterTop) {
      if (v.z < 0 && p.z < counterFront && prevZ >= counterFront) {
        const impact = Math.abs(v.z);
        p.z = counterFront;
        v.z *= -0.4;
        w.x += (Math.random() - 0.5) * 8;
        ring.contacts++;
        if (this.#sndOk(ring, 0.05)) {
          this.sfx.woodKnock(this.booth.group.localToWorld(_sndV.copy(p)), impact);
        }
      } else if (v.z > 0 && p.z > counterBack && prevZ <= counterBack) {
        const impact = Math.abs(v.z);
        p.z = counterBack;
        v.z *= -0.4;
        w.x += (Math.random() - 0.5) * 8;
        ring.contacts++;
        if (this.#sndOk(ring, 0.05)) {
          this.sfx.woodKnock(this.booth.group.localToWorld(_sndV.copy(p)), impact);
        }
      }
    }

    // ---- the bottle field
    if (this.#inField(p.x, p.z)) {
      // flying in low from the side smacks the crate rims, not the glass
      if (!this.#inField(prevX, prevZ) && p.y < TABLE_Y + 0.11) {
        const impact = v.length();
        if (prevZ >= FIELD_MAX_Z + RING_OUTER) { p.z = FIELD_MAX_Z + RING_OUTER; v.z *= -0.42; }
        else if (prevX <= FIELD_MIN_X - RING_OUTER) { p.x = FIELD_MIN_X - RING_OUTER; v.x *= -0.42; }
        else if (prevX >= FIELD_MAX_X + RING_OUTER) { p.x = FIELD_MAX_X + RING_OUTER; v.x *= -0.42; }
        v.multiplyScalar(0.75);
        w.x += (Math.random() - 0.5) * 8;
        w.z += (Math.random() - 0.5) * 8;
        ring.contacts++;
        if (this.#sndOk(ring, 0.05)) {
          this.sfx.woodKnock(this.booth.group.localToWorld(_sndV.copy(p)), impact);
        }
        return false;
      }

      _v1.copy(UP).applyQuaternion(ring.q);
      const flat = Math.abs(_v1.y);

      // crossing the lip plane downward — the moment of truth
      if (prevY > NECK_TOP && p.y <= NECK_TOP && v.y < 0 && flat > FLAT_MIN) {
        const s = (prevY - NECK_TOP) / (prevY - p.y);
        const cx = prevX + (p.x - prevX) * s;
        const cz = prevZ + (p.z - prevZ) * s;
        const bottle = this.#nearestBottle(cx, cz);
        if (bottle) {
          const dx = cx - bottle.x, dz = cz - bottle.z;
          if (dx * dx + dz * dz < RINGER_TOL * RINGER_TOL) {
            this.#startRinger(ring, bottle, cx, cz);
            return true;
          }
        }
      }

      // rim vs the glass: sample the torus against each point's own bottle
      ring.lipSup = 0;
      const droppingOn = flat > FLAT_MIN && v.y < -0.05;
      for (let i = 0; i < RIM_N; i++) {
        _v1.copy(RIM_DIRS[i]).applyQuaternion(ring.q).multiplyScalar(RING_R).add(p);
        const bottle = this.#nearestBottle(_v1.x, _v1.z);
        if (!bottle) continue;
        const hy = _v1.y - TABLE_Y;
        if (hy < 0 || hy > BOTTLE_H + TUBE_R + LIP_EDGE) continue;
        const dx = _v1.x - bottle.x, dz = _v1.z - bottle.z;
        const hd = Math.hypot(dx, dz);
        if (hd < 1e-5) continue;

        if (hy > 0.2) {
          // crown-lip torus. A flat ring already centred over THIS crown is
          // becoming a ringer — its inner edge grazes past, it doesn't bounce
          if (droppingOn) {
            const ox = p.x - bottle.x, oz = p.z - bottle.z;
            if (ox * ox + oz * oz < RINGER_TOL * RINGER_TOL) continue;
          }
          const ux = dx / hd, uz = dz / hd;
          const dr = hd - LIP_R, dy = _v1.y - Y_LIP;
          const d = Math.hypot(dr, dy);
          const pen = TUBE_R + LIP_EDGE - d;
          if (pen > 0 && d > 1e-5) {
            _v3.set((dr / d) * ux, dy / d, (dr / d) * uz);
            _v2.copy(_v1).sub(p);
            p.addScaledVector(_v3, pen);
            const impact = this.#impulse(ring, _v2, _v3, ZONES.lip.e, ZONES.lip.mu);
            if (impact > 0) {
              ring.contacts++;
              if (_v3.y > 0.55) ring.lipSup++;
              // crimped-cap knurling: crown hits skid off a little sideways
              const c = 0.2 * Math.min(impact, 2);
              v.x += (Math.random() - 0.5) * c;
              v.z += (Math.random() - 0.5) * c;
              this.#contactSound(ring, 'lip', bottle, _v1.x, _v1.y, _v1.z, impact);
            }
          }
        } else {
          // neck / shoulder / body silhouette
          bottleSurfaceAt(hy);
          const pen = _bR + TUBE_R - hd;
          if (pen > 0) {
            const zone = hy >= 0.155 ? 'neck' : hy >= 0.1 ? 'shoulder' : 'body';
            _v3.set(dx / hd, _bUp, dz / hd).normalize();
            _v2.copy(_v1).sub(p);
            p.addScaledVector(_v3, pen);
            const Z = ZONES[zone];
            const impact = this.#impulse(ring, _v2, _v3, Z.e, Z.mu);
            if (impact > 0) {
              ring.contacts++;
              if (bottle.ringsOn > 0 && hy < 0.16 && this.#sndOk(ring)) {
                // clipped a ring already sitting on this bottle: plastic
                this.booth.group.localToWorld(_sndV.set(_v1.x, _v1.y, _v1.z));
                this.sfx.plasticClack(_sndV, impact);
              } else {
                this.#contactSound(ring, zone, bottle, _v1.x, _v1.y, _v1.z, impact);
              }
            }
          }
        }
      }

      // rare and glorious: dead ring lying flat BRIDGED across the crowns
      if (ring.lipSup >= 2 && flat > 0.92 &&
          v.lengthSq() < 0.16 && w.lengthSq() < 50 &&
          Math.abs(p.y - (Y_LIP + TUBE_R)) < 0.015) {
        const b = this.#nearestBottle(p.x, p.z);
        return this.#startWobbleSettle(ring, Y_LIP, 'glass', false, b ? b.idx : 0);
      }

      // out of juice among the shoulders: wedge into the valley
      if (p.y <= SHOULDER_TOP + 0.005 &&
          (v.lengthSq() < 0.5 || p.y < TABLE_Y + 0.085)) {
        this.#settleInValley(ring, p.x, p.z);
        return true;
      }
    } else {
      // table top outside the crates (swept: catch even a substep that
      // stepped straight through the plane)
      const overTable = p.x > FIELD_MIN_X - 0.12 && p.x < FIELD_MAX_X + 0.12 &&
                        p.z > FIELD_MIN_Z - 0.12 && p.z < FIELD_MAX_Z + 0.12;
      if (overTable && prevY >= TABLE_Y - 0.001 && p.y < TABLE_Y + 0.06) {
        if (this.#surfaceContact(ring, TABLE_Y, 0.38, MU_WOOD, 'wood', false, h)) return true;
      }
    }

    // tent floor (canvas over dirt — a dead thud, rings die fast)
    if (p.y < RING_R + TUBE_R + 0.005) {
      if (this.#surfaceContact(ring, 0.004, 0.15, MU_FLOOR, 'floor', true, h)) return true;
    }

    return false;
  }

  /**
   * Impulse at contact offset rp (from ring centre) along normal n.
   * Unit mass + scalar torus inertia — enough for edge hits to tumble
   * right. Returns the approach speed (0 if the point was separating).
   */
  #impulse(ring, rp, n, e, mu) {
    _va.copy(ring.w).cross(rp).add(ring.v); // contact-point velocity v + w×rp
    const un = _va.dot(n);
    if (un >= -0.02) return 0;
    _vb.copy(rp).cross(n);
    const j = -(1 + e) * un / (1 + _vb.lengthSq() / RING_I);
    ring.v.addScaledVector(n, j);
    ring.w.addScaledVector(_vb, j / RING_I);
    // Coulomb-ish friction against the tangential slip at the same point
    _va.addScaledVector(n, -un);
    const s = _va.length();
    if (s > 1e-3) {
      const jt = Math.min(mu * j, 0.4 * s);
      _va.divideScalar(s);
      ring.v.addScaledVector(_va, -jt);
      _vb.copy(rp).cross(_va);
      ring.w.addScaledVector(_vb, -jt / RING_I);
    }
    if (ring.w.lengthSq() > 45 * 45) ring.w.setLength(45); // no strobing
    return -un;
  }

  /**
   * Collide the ring's lowest rim point with a horizontal surface (counter
   * top, table, floor). Returns true when the ring left flight for a
   * wobble-settle.
   */
  #surfaceContact(ring, surfY, e, mu, mat, reachable, h) {
    if (ring.v.y > 0.05) return false; // rising: never snag from below
    _v1.copy(UP).applyQuaternion(ring.q);
    if (_v1.y < 0) _v1.negate();
    // the rim point that hangs lowest: opposite UP's projection on the plane
    _v2.set(-_v1.x * _v1.y, 1 - _v1.y * _v1.y, -_v1.z * _v1.y);
    const L = _v2.length();
    if (L > 1e-4) _v2.divideScalar(L).multiplyScalar(-RING_R);
    else _v2.set(0, 0, 0); // dead flat: contact under the centre
    const lowY = ring.p.y + _v2.y - TUBE_R;
    if (lowY > surfY) return false;
    ring.p.y += surfY - lowY;
    const impact = this.#impulse(ring, _v2, _v3.copy(UP), e, mu);
    if (impact === 0) {
      // no impulse fired — the ring is skidding along the surface, not
      // striking it. Bounce impulses alone leave a flat ring gliding
      // frictionlessly forever; kinetic friction (μ·g·h) is what stops it.
      if (ring.v.y <= 0.25) {
        const s = Math.hypot(ring.v.x, ring.v.z);
        if (s > 1e-4) {
          const dec = Math.min(mu * 17 * h, s);
          ring.v.x -= (ring.v.x / s) * dec;
          ring.v.z -= (ring.v.z / s) * dec;
        }
        if (Math.abs(ring.v.y) < 0.3) ring.v.y = 0;
        ring.w.multiplyScalar(Math.max(0, 1 - 3 * h));
        if (ring.v.lengthSq() < 0.35 && ring.w.lengthSq() < 64) {
          return this.#startWobbleSettle(ring, surfY, mat, reachable);
        }
      }
      return false;
    }
    ring.contacts++;
    // the surface eats tumble — packed dirt far faster than springy planks
    ring.w.multiplyScalar(mat === 'floor' ? 0.7 : 0.85);
    if (impact > (mat === 'floor' ? 0.45 : 0.25) &&
        this.#sndOk(ring, mat === 'floor' ? 0.08 : 0.05)) {
      this.booth.group.localToWorld(_sndV.copy(ring.p));
      if (mat === 'wood') this.sfx.woodKnock(_sndV, impact);
      else this.sfx.floorTap(_sndV, impact);
    }
    // out of bounce: the scripted wobble ring-down takes it from here (a
    // still-spinning ring reads fine — that IS what the wobble looks like)
    if (ring.v.lengthSq() < 0.35 && Math.abs(ring.v.y) < 0.6 &&
        ring.w.lengthSq() < (mat === 'floor' ? 400 : 150)) {
      return this.#startWobbleSettle(ring, surfY, mat, reachable);
    }
    return false;
  }

  /** best guess of the surface under a ring (for the convergence guard) */
  #supportYUnder(ring) {
    const p = ring.p;
    const counterFront = this.booth.depth / 2 + 0.25;
    const counterBack = this.booth.depth / 2 - 0.25;
    if (p.z > counterBack && p.z < counterFront &&
        p.y > this.booth.counterHeight) return this.booth.counterHeight;
    if (p.x > FIELD_MIN_X - 0.12 && p.x < FIELD_MAX_X + 0.12 &&
        p.z > FIELD_MIN_Z - 0.12 && p.z < FIELD_MAX_Z + 0.12 &&
        p.y > TABLE_Y) return TABLE_Y;
    return 0.004;
  }

  /** per-ring clatter rate limit so cascades never machine-gun */
  #sndOk(ring, gap = 0.026) {
    if (this._now - ring.lastSnd < gap) return false;
    ring.lastSnd = this._now;
    return true;
  }

  /** glass contact -> that bottle's own voice, graded by impact speed */
  #contactSound(ring, zone, bottle, px, py, pz, impact) {
    if (impact < 0.15 || !this.#sndOk(ring)) return;
    this.booth.group.localToWorld(_sndV.set(px, py, pz));
    // a hard slam shakes the packed crate: a neighbour tinks faintly too
    const shimmer = impact > 2.2
      ? Math.min(COLS * ROWS - 1, Math.max(0, bottle.idx + (bottle.idx % 2 ? 1 : -1)))
      : -1;
    this.sfx.glassClink(_sndV, bottle.idx, impact, { damp: ZONES[zone].damp, shimmer });
  }

  /** write the local-space flight pose back to the world-space mesh */
  #syncMesh(ring) {
    ring.mesh.position.copy(ring.p);
    this.booth.group.localToWorld(ring.mesh.position);
    ring.mesh.quaternion.copy(this._boothQuat).multiply(ring.q);
  }

  #nearestBottle(lx, lz) {
    const col = Math.round((lx - FIELD_X0) / SPACING);
    const row = Math.round((FIELD_Z_FRONT - lz) / SPACING);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return this.bottles[row * COLS + col];
  }

  /* ------------------------------------------------------ coming to rest */

  /**
   * RINGER! The ring drops over the crown, rattles down the neck, chinks
   * onto the glass shoulder (score!) and wobbles itself flat — motion here,
   * sound scheduled sample-accurately by RingTossAudio with the same
   * timings.
   */
  #startRinger(ring, bottle, cx, cz) {
    const stack = bottle.ringsOn;
    bottle.ringsOn++;
    _v1.copy(UP).applyQuaternion(ring.q);
    const flat = Math.min(1, Math.abs(_v1.y));
    const a = {
      type: 'ringer', t0: this._now,
      rattle: 0.15 + Math.random() * 0.05,
      wobble: 0.28 + Math.random() * 0.09,
      x: bottle.x, z: bottle.z,
      startY: NECK_TOP + 0.004,
      restY: RINGED_Y + stack * (TUBE_R * 2 + 0.001),
      tilt0: THREE.MathUtils.clamp(Math.acos(flat), 0.1, 0.45),
      phase: Math.random() * Math.PI * 2,
      orbit: RING_INNER - NECK_R - 0.002, // slack between ring and neck
      scored: false, bottle, stacked: stack > 0,
    };
    ring.state = 'ringing';
    ring.grab.enabled = false;
    ring.anim = a;
    ring.p.set(cx, a.startY, cz);
    ring.v.set(0, 0, 0);
    ring.w.set(0, 0, 0);
    this.booth.group.localToWorld(_sndV.set(bottle.x, NECK_TOP, bottle.z));
    this.sfx.ringerRattle(_sndV, bottle.idx, a);
  }

  #updateRinger(ring, a, t, dt) {
    let tilt, y, r;
    const ka = (t - a.t0) / a.rattle;
    if (ka < 1) {
      // down the neck: pinballing between the glass and its own slack
      a.phase += 26 * dt;
      r = a.orbit * (1 - 0.65 * ka);
      y = a.startY + (a.restY - a.startY) * ka * ka;
      tilt = a.tilt0 + (0.13 - a.tilt0) * ka;
    } else {
      if (!a.scored) {
        a.scored = true; // the chink of plastic meeting the shoulder
        this.booth.group.localToWorld(_sndV.set(a.x, a.restY, a.z));
        this.addScore(a.bottle.points, _sndV);
      }
      const kb = Math.min(1, (t - a.t0 - a.rattle) / a.wobble);
      a.phase += Math.PI * 2 * (8 + 18 * kb * kb) * dt; // coin ring-down
      r = 0.0025 * (1 - kb);
      tilt = 0.13 * Math.pow(1 - kb, 1.7);
      y = a.restY + Math.sin(tilt) * RING_R * 0.3;
      if (kb >= 1) {
        ring.anim = null;
        ring.state = 'ringed';
        ring.p.set(a.x, a.restY, a.z);
        ring.q.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
        this.#syncMesh(ring);
        return;
      }
    }
    ring.p.set(a.x + Math.cos(a.phase) * r, y, a.z + Math.sin(a.phase) * r);
    ring.q.setFromAxisAngle(
      _v1.set(Math.cos(a.phase + Math.PI / 2), 0, Math.sin(a.phase + Math.PI / 2)), tilt);
    this.#syncMesh(ring);
  }

  /**
   * A slow ring on a flat surface falls onto its face and rings itself
   * still like a dropped coin — accelerating wobble, quieting clatter.
   */
  #startWobbleSettle(ring, surfY, mat, reachable, seed = 0) {
    _v1.copy(UP).applyQuaternion(ring.q);
    if (_v1.y < 0) _v1.negate();
    const tilt0 = Math.min(0.85, Math.acos(THREE.MathUtils.clamp(_v1.y, -1, 1)) + 0.03);
    const dur = 0.16 + tilt0 * 0.5;
    ring.state = 'settling';
    ring.grab.enabled = false;
    ring.v.set(0, 0, 0);
    ring.w.set(0, 0, 0);
    ring.anim = {
      type: 'wobble', t0: this._now, dur,
      x: ring.p.x, z: ring.p.z, surfY, mat, reachable, tilt0,
      phase: Math.atan2(_v1.z, _v1.x) + Math.PI / 2, // keep the current lean
      f: 7 + Math.random() * 3,
    };
    if (tilt0 > 0.1) {
      this.booth.group.localToWorld(_sndV.set(ring.p.x, surfY, ring.p.z));
      this.sfx.settleWobble(_sndV, dur, mat, seed);
    }
    return true;
  }

  #updateWobble(ring, a, t, dt) {
    const k = Math.min(1, (t - a.t0) / a.dur);
    const tilt = a.tilt0 * Math.pow(1 - k, 1.65);
    a.phase += Math.PI * 2 * (a.f + 20 * k * k) * dt;
    ring.p.set(a.x, a.surfY + TUBE_R * Math.cos(tilt) + RING_R * Math.sin(tilt), a.z);
    ring.q.setFromAxisAngle(_v1.set(Math.cos(a.phase), 0, Math.sin(a.phase)), tilt);
    this.#syncMesh(ring);
    if (k >= 1) this.#finishWobble(ring, a);
  }

  #finishWobble(ring, a) {
    ring.anim = null;
    ring.p.set(a.x, a.surfY + TUBE_R, a.z);
    ring.q.identity();
    this.#syncMesh(ring);
    const onCounter = a.surfY > this.booth.counterHeight - 0.05;
    if (onCounter &&
        Math.hypot(a.x - this.bucketLocal.x, a.z - this.bucketLocal.z) < 0.15) {
      // plopped down on the pail — call it caught and drop it in
      this.#startAnim(ring, 'returning', {
        dur: 0.22, toPos: ring.bucketSlot, toQuat: null, arc: 0.12,
        then: () => {
          this.#placeInBucket(ring);
          this.sfx.bucketDrop(this._bucketWorld);
        },
      });
      return;
    }
    ring.state = 'resting';
    // "playerSide" rings still count as throwable: on the counter top, or
    // on the floor out in the walkway
    ring.playerSide = a.reachable && (onCounter || ring.p.z > this.booth.depth / 2 + 0.05);
    ring.grab.enabled = a.reachable;
  }

  /** wedge tilted into the gap between four bottle shoulders */
  #settleInValley(ring, lx, lz) {
    const vc = THREE.MathUtils.clamp(Math.round((lx - FIELD_X0) / SPACING - 0.5), 0, COLS - 2);
    const vr = THREE.MathUtils.clamp(Math.round((FIELD_Z_FRONT - lz) / SPACING - 0.5), 0, ROWS - 2);
    const key = vr * 100 + vc;
    const stack = this._valleys.get(key) || 0;
    this._valleys.set(key, stack + 1);

    // keep the lean it arrived with (clamped into a believable wedge) so
    // no two wedged rings sit alike
    _v1.copy(UP).applyQuaternion(ring.q);
    if (_v1.y < 0) _v1.negate();
    _v2.set(_v1.x, 0, _v1.z);
    if (_v2.lengthSq() < 1e-6) _v2.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _v2.normalize();
    const tilt = THREE.MathUtils.clamp(
      Math.acos(THREE.MathUtils.clamp(_v1.y, -1, 1)), 0.3, 0.55);
    const toQuat = new THREE.Quaternion()
      .setFromAxisAngle(_v3.set(_v2.z, 0, -_v2.x), tilt);

    const toPos = new THREE.Vector3(
      FIELD_X0 + (vc + 0.5) * SPACING,
      TABLE_Y + 0.115 + stack * (TUBE_R * 2 + 0.002),
      FIELD_Z_FRONT - (vr + 0.5) * SPACING);
    const idxA = vr * COLS + vc, idxB = (vr + 1) * COLS + vc + 1;
    const speed = Math.min(2, ring.v.length() + 0.6);
    this.#startAnim(ring, 'settling', {
      dur: 0.13, toPos, toQuat, arc: 0,
      then: () => {
        ring.state = 'resting';
        ring.playerSide = false;
        // the quick cl-clink of coming to rest against two bottles
        this.booth.group.localToWorld(_sndV.copy(toPos));
        if (stack > 0) this.sfx.plasticClack(_sndV, speed);
        this.sfx.wedgeClink(_sndV, idxA, idxB, speed);
      },
    });
  }

  /* ---------------------------------------------------- animation core ---- */

  /** short scripted move in booth-local space (valley wedge, attendant
   *  collecting rings back to the bucket) */
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

  #updateAnims(t, dt) {
    for (const ring of this.rings) {
      const a = ring.anim;
      if (!a || t < a.t0) continue;
      if (a.type === 'wobble') { this.#updateWobble(ring, a, t, dt); continue; }
      if (a.type === 'ringer') { this.#updateRinger(ring, a, t, dt); continue; }
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

  /* ----------------------------------------------------------- update ---- */

  onUpdate(dt, t) {
    this._now = t;
    for (const ring of this.rings) {
      if (ring.state === 'held') this.#trackHeldSpin(ring, t);
      else if (ring.state === 'flying') this.#updateFlying(ring, dt);
    }
    this.#updateAnims(t, dt);

    if (this.state === 'running') {
      // rings the player can still throw: in the bucket, in hand, or landed
      // back on their side of the counter
      let usable = 0, active = 0;
      for (const r of this.rings) {
        if (r.state === 'bucket' || r.state === 'held' ||
            (r.state === 'resting' && r.playerSide)) usable++;
        if (r.state === 'flying' || r.state === 'ringing' ||
            r.state === 'settling' || r.state === 'returning') active++;
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
            then: () => {
              this.#placeInBucket(r);
              this.sfx.bucketDrop(this._bucketWorld);
            },
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

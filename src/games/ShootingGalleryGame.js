import * as THREE from 'three';
import { MiniGame } from './registry.js';
import { BoothBase } from '../components/BoothBase.js';
import { noseOutHoldQuat } from '../core/Grabbables.js';
import { shiny, glowTexture } from '../core/environment.js';
import { stripesTexture, woodTexture, barberPoleTexture, CARNIVAL_PALETTE } from '../core/textures.js';
import { buildRevolver } from './revolverMesh.js';
import { ShootingGalleryAudio } from './ShootingGalleryAudio.js';
import {
  galleryBackdropTexture, waveRailTexture, targetTexture, targetAlphaMask,
  bulletHoleTexture, prizeWheelTexture, lollipopTexture, pipTexture, bangTexture,
} from './galleryTextures.js';

/**
 * SHOOTING GALLERY — the deep double-wide booth of moving tin targets.
 *
 * A painted countryside cabinet fills the back of the stall: three stepped
 * conveyor rows of animal silhouettes (ducks waddling right, rabbits
 * hopping left, little bluebirds hurrying along the top) slide behind
 * scalloped water-wave rails, ducking out of sight behind the prize
 * cabinets at each end to turn around. Two spinning star targets flank the
 * centrepiece: a fez-wearing toy MONKEY with brass cymbals who claps a
 * celebration every time your score crosses a threshold — and chatters
 * indignantly if you shoot HIM.
 *
 * Two tethered toy SIX-SHOOTERS rest on the counter. Grip to pick one up
 * (the glove closes into a real pistol grip, trigger finger riding the
 * analog trigger), squeeze the trigger to fire. The hopper never runs
 * dry — no reloading, the cylinder just indexes a fresh chamber with
 * every shot. Shots are hitscan with a muzzle flash and a cork-gun POP;
 * hits ring the target's own tin TING and slap the plate down; misses
 * dent the painted backdrop. Letting go (or wandering off with one) lets
 * the counter tether reel the gun back to its cradle. Hits are tested
 * against each plate's actual painted SILHOUETTE (alpha mask on the
 * plate's plane, see #hitscan) — grazing the air beside a duck misses.
 *
 * Every 10–20 conveyor passes, one wrapping animal comes back as the
 * WILD CLOWN: shoot him for +150 and he throws a whole routine — spins,
 * hops, confetti, slide-whistle WHOOP and a squeeze-horn HONK.
 *
 * Around the conveyors the cabinet is crowded with SIDESHOW targets, the
 * way the real travelling galleries are:
 *   - a carnival PRIZE WHEEL on the left cabinet — shoot it and it spins
 *     against a clacking flapper, paying out whatever wedge it lands on
 *     (the gold 200 wedge gets a monkey ovation);
 *   - four small gold-rimmed precision PIPS (barely any aim assist) worth
 *     a fat payout, two high on the mural and two hiding behind the ducks;
 *   - a brass BELL over the monkey's big top that rings and swings;
 *   - two spiral LOLLIPOPS flanking the tent that whirl when clipped;
 *   - and the painted SUN itself hides a once-a-round bonus.
 *
 * Round: first shot starts the 40s clock. Downed targets pop back up when
 * their conveyor carries them behind a cabinet, so there's always
 * something to shoot. RESET re-racks the guns and runs the plate-rise
 * show, one target creaking back up at a time.
 */

const BOOTH_W = 5.4, BOOTH_D = 3.2;
const BACK_Z = -1.5;              // backdrop plane
const TRACK_HALF = 2.35;          // conveyor wrap point (hidden by cabinets)
const ROWS = [
  { kind: 'duck', count: 5, z: -0.55, y: 1.02, dir: 1, speed: 0.34, size: 0.30, points: 10 },
  { kind: 'rabbit', count: 5, z: -1.00, y: 1.24, dir: -1, speed: 0.50, size: 0.26, points: 15 },
  { kind: 'bird', count: 6, z: -1.30, y: 1.46, dir: 1, speed: 0.72, size: 0.19, points: 25 },
];
const SPINNER_POINTS = 50;
const GOLD_MULT = 3;
const CLAP_THRESHOLDS = [100, 250, 450, 700];

// the WILD CLOWN: a rare specialty plate that replaces a wrapping animal
// every SPECIAL_EVERY-ish conveyor passes, worth a show-stopping payout
const SPECIAL_POINTS = 150;
const SPECIAL_SCALE = 1.3;
const SPECIAL_EVERY = () => 10 + Math.random() * 10; // wraps between clowns

// sideshow payouts
const PIP_POINTS = 40;
const BELL_POINTS = 75;
const LOLLIPOP_POINTS = 20;
const SUN_BONUS = 100;
const WHEEL_WEDGES = [20, 50, 20, 75, 20, 100, 20, 50, 20, 75, 20, 200];
// the painted sun in the mural (booth-local; from galleryBackdropTexture)
const SUN_AT = { x: -1.153, y: 2.329, r: 0.14 };

const RETURN_TIME = 0.55;         // tether reeling a dropped gun home
const FLIP_TIME = 0.22, RISE_TIME = 0.3;
const HOLE_LIFE = 10;

/**
 * Hand-local hold for the six-shooter. XR numbers were DIALLED IN ON THE
 * HEADSET with the GunGripTuner (hold a gun, squeeze the empty hand's
 * grip) and baked back here — if the grip ever needs re-tuning, do it
 * there and copy the panel numbers, don't guess. Desktop overrides the
 * canned XR swing: the desktop hand frame IS the camera frame, so the
 * barrel just points straight down the view with a whisker of lift.
 */
const GUN_HOLD = { palm: 0.051, fingers: -0.006, up: 0.016, noseUp: 55.8 };
function gunHoldQuat(noseUpDeg) {
  const q = noseOutHoldQuat(noseUpDeg);
  q.desktop = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.05);
  return q;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();

export class ShootingGalleryGame extends MiniGame {
  constructor(deps, pad) {
    super(deps, 40);
    this.readyStatus = 'GRAB A GUN + SHOOT';
    const { world, audio } = deps;
    this.sfx = new ShootingGalleryAudio(audio, world.scene);

    this.booth = new BoothBase(deps, {
      name: 'SHOOTING GALLERY',
      width: BOOTH_W, depth: BOOTH_D, pad,
      colorA: '#c2183c', colorB: '#ffd23f',
      signColors: { bg: '#1d2a63', rainbow: true },
      shelfY: 2.72, // prizes strung along the very top, clear of the backdrop
      scoreboardY: 3.48, // above the plush shelf, which otherwise hides it
      resetButtonLocal: new THREE.Vector3(1.75, 0.98, 1.48),
      onReset: () => this.requestReset(),
    });
    this.booth.group.updateWorldMatrix(true, true);
    // booth-local ray space (the booth never moves after placement)
    this._boothInv = this.booth.group.matrixWorld.clone().invert();
    this._boothQuatInv = this.booth.group.getWorldQuaternion(new THREE.Quaternion()).invert();

    this._now = 0;
    this.targets = [];
    this.spinners = [];
    this.pips = [];
    this.lollipops = [];
    this.guns = [];
    this._riseQueue = [];
    this._attractAt = 20;
    this._sunBonusGiven = false;
    this._statusFlashUntil = 0;

    // silhouette hit masks: shots must strike the painted tin, not a
    // bounding sphere — "hit the outline" is the whole game
    this._masks = {
      duck: targetAlphaMask('duck'), rabbit: targetAlphaMask('rabbit'),
      bird: targetAlphaMask('bird'), star: targetAlphaMask('star'),
      clown: targetAlphaMask('clown'),
    };
    this._clownMat = new THREE.MeshLambertMaterial({
      map: targetTexture('clown'), alphaTest: 0.5, side: THREE.DoubleSide,
      emissive: 0xff6090, emissiveIntensity: 0.15,
    });
    this._wrapCount = 0;
    this._nextSpecialAt = SPECIAL_EVERY();
    this._specialActive = false;

    this.#buildStage();
    this.#buildTargets();
    this.#buildSpinners();
    this.#buildMonkey();
    this.#buildCabinets();
    this.#buildWheel();
    this.#buildSideshow();
    this.#buildGuns();
    this.#buildFx();

    this.booth.scoreboard.setStatus(this.readyStatus);
  }

  /* ---------------------------------------------------------- build ---- */

  /** painted backdrop + stepped stage tiers + wave rails */
  #buildStage() {
    const g = this.booth.group;

    // the mural
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(5.24, 1.28),
      new THREE.MeshLambertMaterial({ map: galleryBackdropTexture() }),
    );
    backdrop.position.set(0, 1.92, BACK_Z);
    g.add(backdrop);
    this._backdrop = backdrop;

    // stepped stage the conveyor rows ride on (dark red painted wood)
    const stepMat = new THREE.MeshLambertMaterial({ map: woodTexture('#5e2430') });
    for (const [h, zc, zd] of [
      [1.0, -0.975, 1.25],
      [1.22, -1.2, 0.8],
      [1.44, -1.425, 0.35],
    ]) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(5.24, h === 1.0 ? 1.0 : 0.22, zd), stepMat);
      step.position.set(0, h === 1.0 ? 0.5 : h - 0.11, zc);
      g.add(step);
    }

    // scalloped wave rails hiding each track
    const waveTex = waveRailTexture();
    for (const [z, y, deep, light] of [
      [-0.38, 0.98, '#155089', '#2f8fe0'],
      [-0.84, 1.20, '#1d5fa3', '#3aa0ff'],
      [-1.24, 1.42, '#2a72b8', '#55b4ff'],
    ]) {
      const tex = z === -0.84 ? waveTex : waveRailTexture(deep, light);
      tex.repeat.set(8, 1);
      const rail = new THREE.Mesh(
        new THREE.PlaneGeometry(5.24, 0.24),
        new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
      );
      rail.position.set(0, y, z);
      g.add(rail);
    }

    // comic BANG! starburst boards on the side walls, like the real stall
    const bangTex = bangTexture();
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.85, 0.85),
        new THREE.MeshLambertMaterial({ map: bangTex }),
      );
      panel.position.set(side * (BOOTH_W / 2 - 0.07), 1.75, 0.35);
      panel.rotation.y = -side * Math.PI / 2;
      g.add(panel);
    }
  }

  /** three conveyor rows of hinged tin silhouettes */
  #buildTargets() {
    const g = this.booth.group;
    const rodMat = new THREE.MeshLambertMaterial({ color: 0x2a2a35 });
    let seed = 0;
    for (let r = 0; r < ROWS.length; r++) {
      const row = ROWS[r];
      const tex = targetTexture(row.kind);
      const goldTex = targetTexture(row.kind, { gold: true });
      // one golden bonus animal per row (except the top birds — they're
      // already the sharpshooter's row)
      const goldIdx = r < 2 ? (Math.random() * row.count) | 0 : -1;
      const spacing = (TRACK_HALF * 2) / row.count;
      for (let i = 0; i < row.count; i++) {
        const gold = i === goldIdx;
        const carrier = new THREE.Group();
        carrier.position.set(-TRACK_HALF + i * spacing, row.y, row.z);
        // hinge at the plate's bottom edge so hits flip it backwards
        const plate = new THREE.Mesh(
          new THREE.PlaneGeometry(row.size, row.size).translate(0, row.size / 2, 0),
          new THREE.MeshLambertMaterial({
            map: gold ? goldTex : tex, alphaTest: 0.5, side: THREE.DoubleSide,
            ...(gold ? { emissive: 0xffb300, emissiveIntensity: 0.28 } : {}),
          }),
        );
        plate.scale.x = row.dir; // silhouettes face their direction of travel
        const rod = new THREE.Mesh(
          new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), rodMat);
        rod.position.y = -0.05;
        carrier.add(plate, rod);
        g.add(carrier);
        this.targets.push({
          carrier, plate, row,
          up: true, flipK: 1, riseK: 1, rising: false,
          gold, seed: seed++,
          special: false, celebrate: 0, baseMat: null,
          points: (gold ? GOLD_MULT : 1) * row.points,
        });
      }
    }
  }

  /** two spinning star targets flanking the monkey */
  #buildSpinners() {
    const g = this.booth.group;
    const tex = targetTexture('star');
    for (const sx of [-1.5, 1.5]) {
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6),
        new THREE.MeshLambertMaterial({ color: 0x2a2a35 }),
      );
      arm.rotation.x = Math.PI / 2;
      arm.position.set(sx, 2.1, BACK_Z + 0.05);
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.36, 0.36),
        new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
      );
      plate.position.set(sx, 2.1, BACK_Z + 0.11);
      g.add(arm, plate);
      this.spinners.push({
        plate, x: sx, y: 2.1, z: BACK_Z + 0.11,
        vel: 0.8, cooldownUntil: 0, seed: 100 + this.spinners.length,
      });
    }
  }

  /** the cymbal monkey on his barber-pole pedestal, under a mini big-top */
  #buildMonkey() {
    const g = this.booth.group;
    const root = new THREE.Group();
    root.position.set(0, 1.85, -1.42);
    g.add(root);

    // pedestal + a little striped proscenium behind him
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.16, 0.41, 12),
      new THREE.MeshLambertMaterial({ map: barberPoleTexture('#c2183c', '#f6ead7') }),
    );
    pedestal.position.y = -0.21;
    root.add(pedestal);
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 0.3, 12, 1, true),
      new THREE.MeshLambertMaterial({
        map: stripesTexture('#c2183c', '#f6ead7', 12), side: THREE.DoubleSide,
      }),
    );
    canopy.position.set(0, 0.62, -0.05);
    root.add(canopy);
    const finial = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      shiny({ color: 0xd4af37, metalness: 1, roughness: 0.3 }),
    );
    finial.position.set(0, 0.78, -0.05);
    root.add(finial);

    // the monkey himself
    const fur = new THREE.MeshLambertMaterial({ color: 0x6b4630 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9b38c });
    const monkey = new THREE.Group();
    root.add(monkey);

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), fur);
    body.scale.set(1, 1.2, 0.85);
    body.position.y = 0.1;
    // little red vest front
    const vest = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xc2183c }));
    vest.scale.set(0.92, 1.05, 0.55);
    vest.position.set(0, 0.1, 0.035);
    // legs folded in front, tail curling behind
    const legGeo = new THREE.CapsuleGeometry(0.024, 0.07, 3, 8);
    const legL = new THREE.Mesh(legGeo, fur);
    legL.rotation.z = Math.PI / 2.3;
    legL.position.set(-0.05, 0.0, 0.05);
    const legR = new THREE.Mesh(legGeo, fur);
    legR.rotation.z = -Math.PI / 2.3;
    legR.position.set(0.05, 0.0, 0.05);
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI * 1.4), fur);
    tail.position.set(0, 0.05, -0.08);
    tail.rotation.x = Math.PI / 2.4;
    monkey.add(body, vest, legL, legR, tail);

    // head group (bobs and shakes)
    const head = new THREE.Group();
    head.position.y = 0.27;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), fur);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), skin);
    face.scale.set(1, 0.85, 0.7);
    face.position.set(0, -0.008, 0.045);
    const earGeo = new THREE.SphereGeometry(0.02, 8, 6);
    const earL = new THREE.Mesh(earGeo, skin);
    earL.position.set(-0.062, 0.01, 0);
    const earR = new THREE.Mesh(earGeo, skin);
    earR.position.set(0.062, 0.01, 0);
    const eyeGeo = new THREE.SphereGeometry(0.007, 6, 5);
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0x14161f });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.02, 0.014, 0.058);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.02, 0.014, 0.058);
    // fez with a golden tassel
    const fez = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.036, 0.045, 10),
      shiny({ color: 0xc2183c, roughness: 0.4 }),
    );
    fez.position.set(0, 0.072, -0.005);
    fez.rotation.z = 0.12;
    const tassel = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 5),
      shiny({ color: 0xd4af37, metalness: 1, roughness: 0.35 }));
    tassel.position.set(0.02, 0.09, -0.005);
    head.add(skull, face, earL, earR, eyeL, eyeR, fez, tassel);
    monkey.add(head);

    // arms with brass cymbals: shoulder yaw swings the discs together
    const cymbalMat = shiny({ color: 0xd4af37, metalness: 1, roughness: 0.25, envIntensity: 1.2 });
    const armGeo = new THREE.CapsuleGeometry(0.017, 0.085, 3, 8).rotateX(Math.PI / 2);
    const cymGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.006, 14).rotateZ(Math.PI / 2);
    const arms = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.095, 0.17, 0.02);
      const arm = new THREE.Mesh(armGeo, fur);
      arm.position.z = 0.055;
      const cymbal = new THREE.Mesh(cymGeo, cymbalMat);
      cymbal.position.z = 0.12;
      shoulder.add(arm, cymbal);
      monkey.add(shoulder);
      // arms reach forward (+Z); yawing a side's shoulder AWAY from centre
      // (rotation.y = side * 0.9) spreads them, toward centre claps them
      arms.push({ shoulder, side, openY: side * 0.9, clapY: side * -0.72 });
      shoulder.rotation.y = side * 0.9;
    }

    this.monkey = {
      root, monkey, head, arms,
      clapsLeft: 0, clapPhase: 0, clapHit: false, bigClap: false,
      angryT: 0,
      // world position of the meeting point of the cymbals (for audio)
      cymbalAt: () => this.booth.group.localToWorld(_v4.set(0, 2.02, -1.29)),
      // hit spheres (booth-local)
      headC: new THREE.Vector3(0, 2.12, -1.42), headR: 0.1,
      bodyC: new THREE.Vector3(0, 1.96, -1.42), bodyR: 0.13,
    };
  }

  /** prize cabinets at both ends — they also hide the conveyor turnarounds */
  #buildCabinets() {
    const g = this.booth.group;
    const woodMat = new THREE.MeshLambertMaterial({ map: woodTexture('#6b4426') });
    const cubbyMat = new THREE.MeshLambertMaterial({ color: 0x1d1420 });
    const plushGeoBody = new THREE.SphereGeometry(0.075, 10, 8);
    const plushGeoHead = new THREE.SphereGeometry(0.05, 10, 8);
    const earGeo = new THREE.ConeGeometry(0.024, 0.05, 6);
    for (const side of [-1, 1]) {
      const x = side * 2.32;
      // deep enough (z -1.6 … -0.3) to hide every row's turnaround,
      // including the front duck row at z -0.55
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.5, 1.3), woodMat);
      box.position.set(x, 1.72, -0.95);
      g.add(box);
      // striped mini-awning across the cabinet top
      const awn = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.32),
        new THREE.MeshLambertMaterial({
          map: stripesTexture('#1d2a63', '#ffd23f', 6), side: THREE.DoubleSide,
        }),
      );
      awn.position.set(x, 2.52, -0.22);
      awn.rotation.x = -0.55;
      g.add(awn);
      // cubbies of carnival clutter: bottles below, plush in the middle,
      // a candy jar up top. The left cabinet keeps just the bottle row —
      // the prize wheel hangs where its upper cubbies would be.
      const cubbies = side < 0 ? 1 : 3;
      for (let i = 0; i < cubbies; i++) {
        const cy = 1.25 + i * 0.44;
        const cubby = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.36, 0.05), cubbyMat);
        cubby.position.set(x, cy, -0.29);
        g.add(cubby);
        if (i === 0) {
          // a row of painted glass bottles
          for (let b = 0; b < 3; b++) {
            const glass = new THREE.MeshLambertMaterial({
              color: [0x2e7d4f, 0xa4551e, 0x27618f][(b + (side > 0 ? 1 : 0)) % 3],
            });
            const bottle = new THREE.Group();
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.12, 10), glass);
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.02, 0.055, 8), glass);
            neck.position.y = 0.085;
            const cork = new THREE.Mesh(
              new THREE.CylinderGeometry(0.012, 0.012, 0.014, 8),
              new THREE.MeshLambertMaterial({ color: 0xc9a26b }));
            cork.position.y = 0.117;
            bottle.add(body, neck, cork);
            bottle.position.set(x + (b - 1) * 0.15, cy - 0.11, -0.25);
            g.add(bottle);
          }
        } else if (i === 1) {
          const color = CARNIVAL_PALETTE[(i * 2 + (side > 0 ? 3 : 0)) % CARNIVAL_PALETTE.length];
          const m = new THREE.MeshLambertMaterial({ color });
          const plush = new THREE.Group();
          const body = new THREE.Mesh(plushGeoBody, m);
          body.scale.y = 1.12;
          const head = new THREE.Mesh(plushGeoHead, m);
          head.position.y = 0.105;
          const eL = new THREE.Mesh(earGeo, m);
          eL.position.set(-0.032, 0.16, 0);
          const eR = new THREE.Mesh(earGeo, m);
          eR.position.set(0.032, 0.16, 0);
          plush.add(body, head, eL, eR);
          plush.position.set(x, cy - 0.09, -0.24);
          plush.rotation.y = (Math.random() - 0.5) * 0.6;
          g.add(plush);
        } else {
          // striped candy jar with a brass lid
          const jar = new THREE.Group();
          const body = new THREE.Mesh(
            new THREE.CylinderGeometry(0.055, 0.06, 0.16, 12),
            new THREE.MeshLambertMaterial({ map: barberPoleTexture('#e02249', '#fff6ec') }));
          const lid = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            shiny({ color: 0xc9a02e, metalness: 1, roughness: 0.4 }));
          lid.position.y = 0.08;
          jar.add(body, lid);
          jar.position.set(x, cy - 0.09, -0.25);
          g.add(jar);
        }
      }
    }
  }

  /** the shootable carnival prize wheel on the left cabinet */
  #buildWheel() {
    const g = this.booth.group;
    const root = new THREE.Group();
    root.position.set(-2.32, 1.92, -0.28);
    g.add(root);

    // wooden backboard with a brass rim
    const back = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 28),
      new THREE.MeshLambertMaterial({ map: woodTexture('#4a1f2a') }),
    );
    root.add(back);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.415, 0.014, 8, 36),
      shiny({ color: 0xc9a02e, metalness: 1, roughness: 0.4 }),
    );
    rim.position.z = 0.01;
    root.add(rim);

    // the wheel itself: painted face + a ring of pegs for the flapper
    const wheel = new THREE.Group();
    wheel.position.z = 0.035;
    root.add(wheel);
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.355, 48),
      new THREE.MeshLambertMaterial({ map: prizeWheelTexture(WHEEL_WEDGES) }),
    );
    wheel.add(face);
    const pegGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.045, 8).rotateX(Math.PI / 2);
    const pegMat = shiny({ color: 0xd4af37, metalness: 1, roughness: 0.35 });
    const step = (Math.PI * 2) / WHEEL_WEDGES.length;
    for (let i = 0; i < WHEEL_WEDGES.length; i++) {
      const peg = new THREE.Mesh(pegGeo, pegMat);
      peg.position.set(Math.cos(i * step) * 0.325, Math.sin(i * step) * 0.325, 0.012);
      wheel.add(peg);
    }
    const hub = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 10, 8),
      shiny({ color: 0xd4af37, metalness: 1, roughness: 0.3 }),
    );
    hub.position.z = 0.045;
    wheel.add(hub);

    // the flapper: a red leather tongue pinned at the top, tip riding the pegs
    const flapShape = new THREE.Shape();
    flapShape.moveTo(-0.025, 0);
    flapShape.lineTo(0.025, 0);
    flapShape.lineTo(0, -0.085);
    flapShape.closePath();
    const flapper = new THREE.Mesh(
      new THREE.ShapeGeometry(flapShape),
      new THREE.MeshLambertMaterial({ color: 0xe02249, side: THREE.DoubleSide }),
    );
    flapper.position.set(0, 0.415, 0.075);
    root.add(flapper);
    const pin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8).rotateX(Math.PI / 2),
      pegMat,
    );
    pin.position.set(0, 0.415, 0.06);
    root.add(pin);

    this.wheel = {
      root, disc: wheel, flapper,
      vel: 0, spinning: false, flap: 0, lastNotch: 0,
      // booth-local hit sphere over the face
      c: new THREE.Vector3(-2.32, 1.92, -0.245), r: 0.38,
    };
  }

  /** pips, bell and lollipops — the little payout targets everywhere */
  #buildSideshow() {
    const g = this.booth.group;

    // four small precision pips: two high on the mural, two on the middle
    // step's riser where the duck row keeps wandering across the shot
    const pipTex = pipTexture();
    const spots = [
      [-0.7, 2.44, BACK_Z + 0.03],
      [0.7, 2.44, BACK_Z + 0.03],
      [-1.6, 1.16, -0.785],
      [1.6, 1.16, -0.785],
    ];
    for (let i = 0; i < spots.length; i++) {
      const [x, y, z] = spots[i];
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 0.12),
        new THREE.MeshLambertMaterial({
          map: pipTex, alphaTest: 0.5, side: THREE.DoubleSide,
          emissive: 0xffb300, emissiveIntensity: 0,
        }),
      );
      plate.position.set(x, y, z);
      g.add(plate);
      this.pips.push({ plate, x, y, z, spin: 0, glow: 0, cooldownUntil: 0, seed: 200 + i });
    }

    // the brass bell, dangling on a wire just above the monkey's big top —
    // in front of the prize shelf so it reads from the counter
    const bell = new THREE.Group();
    bell.position.set(0, 2.74, -1.28);
    g.add(bell);
    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.62, 6),
      new THREE.MeshLambertMaterial({ color: 0x2a2a35 }),
    );
    wire.position.y = 0.32;
    bell.add(wire);
    const swing = new THREE.Group(); // pivot at the hanger
    bell.add(swing);
    const brass = shiny({ color: 0xd4af37, metalness: 1, roughness: 0.28, envIntensity: 1.2 });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), brass);
    dome.position.y = -0.05;
    const lip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.076, 0.028, 14), brass);
    lip.position.y = -0.102;
    const clapper = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x2a2a35 }));
    clapper.position.y = -0.115;
    const hanger = new THREE.Mesh(
      new THREE.TorusGeometry(0.016, 0.006, 6, 10), brass);
    swing.add(dome, lip, clapper, hanger);
    this.bell = {
      swing, rot: 0, rotV: 0, cooldownUntil: 0,
      c: new THREE.Vector3(0, 2.67, -1.28), r: 0.09,
    };

    // spiral lollipops flanking the monkey's tent
    const stickMat = new THREE.MeshLambertMaterial({ color: 0xf6ead7 });
    const flavours = ['#e02249', '#2f6fff'];
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? -0.62 : 0.62;
      const head = new THREE.Mesh(
        new THREE.CircleGeometry(0.11, 24),
        new THREE.MeshLambertMaterial({
          map: lollipopTexture(flavours[i]), side: THREE.DoubleSide,
        }),
      );
      head.position.set(x, 1.78, -1.44);
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.011, 0.011, 0.34, 8), stickMat);
      stick.position.set(x, 1.61, -1.445);
      g.add(head, stick);
      this.lollipops.push({
        head, x, y: 1.78, z: -1.44,
        vel: 0, cooldownUntil: 0, seed: 300 + i,
      });
    }
  }

  /** the two tethered six-shooters and their counter cradles */
  #buildGuns() {
    const g = this.booth.group;
    const h = this.booth.counterHeight;
    const cradleMat = new THREE.MeshLambertMaterial({ map: woodTexture('#54371f') });
    const accents = [0x2f6fff, 0xe02249]; // left blue, right red — like the cuffs
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? -0.75 : 0.75;
      // cradle: base plate + two forks the barrel rests across
      const cradle = new THREE.Group();
      cradle.position.set(x, h, 1.42);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.3), cradleMat);
      base.position.y = 0.01;
      cradle.add(base);
      for (const fz of [-0.09, 0.06]) {
        const fork = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.025), cradleMat);
        fork.position.set(0, 0.045, fz);
        cradle.add(fork);
      }
      g.add(cradle);

      const parts = buildRevolver(accents[i]);
      this.deps.world.scene.add(parts.group);

      // rest pose (world): sitting in the cradle, nose up a touch, aimed in
      const restPosLocal = new THREE.Vector3(x, h + 0.075, 1.42);
      const restQuatLocal = new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(0.16, i === 0 ? -0.08 : 0.08, 0));

      const gun = {
        parts, mesh: parts.group,
        restPosLocal, restQuatLocal,
        state: 'rest',
        recoil: 0, drumTurn: 0,
        returnT: 0, returnFromP: new THREE.Vector3(), returnFromQ: new THREE.Quaternion(),
        lastShotAt: 0,
        grab: null, flash: null, tether: null,
      };

      // muzzle flash sprite (hidden until a shot)
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xffc860, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      flash.scale.setScalar(0.12);
      flash.visible = false;
      this.deps.world.scene.add(flash);
      gun.flash = flash;
      gun.flashLife = 0;

      // tether cord from the counter to the lanyard ring
      const tetherGeo = new THREE.BufferGeometry();
      tetherGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
      const tether = new THREE.Line(tetherGeo, new THREE.LineBasicMaterial({ color: 0x1c0f12 }));
      tether.frustumCulled = false;
      g.add(tether);
      gun.tether = tether;
      gun.tetherAnchorLocal = new THREE.Vector3(x, h + 0.005, 1.56);

      gun.grab = this.deps.grabbables.add(parts.group, {
        radius: 0.14,
        holdOffset: { palm: GUN_HOLD.palm, fingers: GUN_HOLD.fingers, up: GUN_HOLD.up },
        holdCurl: 0.85,
        holdPose: 'pistol',
        holdQuat: gunHoldQuat(GUN_HOLD.noseUp),
        gripRelease: true,
        onTriggerFire: (hand) => this.#fireGun(gun, hand),
        onGrab: () => { gun.state = 'held'; },
        onThrow: () => this.#dropGun(gun),
      });

      this.#rackGun(gun);
      this.guns.push(gun);
    }
  }

  /** pooled effects: bullet holes in the backdrop, smoke/impact puffs */
  #buildFx() {
    // dents in the paintwork
    const holeTex = bulletHoleTexture();
    this.holes = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.05, 0.05),
      new THREE.MeshLambertMaterial({ map: holeTex, transparent: true, depthWrite: false }),
      24,
    );
    this.holes.renderOrder = 1;
    this.booth.group.add(this.holes);
    this._holeData = Array.from({ length: 24 }, () => ({ life: 0, x: 0, y: 0 }));
    this._holeCursor = 0;
    _m1.makeScale(0, 0, 0);
    for (let i = 0; i < 24; i++) this.holes.setMatrixAt(i, _m1);
    this.holes.instanceMatrix.needsUpdate = true;

    // smoke / impact puffs (world-space sprites)
    this._puffs = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xcfc8bd, transparent: true, opacity: 0,
        depthWrite: false,
      }));
      s.visible = false;
      this.deps.world.scene.add(s);
      this._puffs.push({ sprite: s, life: 0, vel: new THREE.Vector3(), maxLife: 0.5 });
    }
    this._puffCursor = 0;
  }

  #puff(worldPos, color = 0xcfc8bd, scale = 0.08, up = 0.25) {
    const p = this._puffs[this._puffCursor];
    this._puffCursor = (this._puffCursor + 1) % this._puffs.length;
    p.life = p.maxLife = 0.45;
    p.sprite.visible = true;
    p.sprite.position.copy(worldPos);
    p.sprite.material.color.setHex(color);
    p.sprite.scale.setScalar(scale);
    p.baseScale = scale;
    p.vel.set((Math.random() - 0.5) * 0.12, up, (Math.random() - 0.5) * 0.12);
  }

  /* -------------------------------------------------------- gun logic ---- */

  #rackGun(gun) {
    gun.state = 'rest';
    gun.recoil = 0;
    gun.drumTurn = 0;
    gun.parts.drum.rotation.z = 0;
    gun.grab.enabled = true;
    gun.mesh.position.copy(this.booth.group.localToWorld(gun.restPosLocal.clone()));
    gun.mesh.quaternion.copy(this._boothQuatInv).invert().multiply(gun.restQuatLocal);
    gun.parts.hammer.rotation.x = 0;
  }

  #dropGun(gun) {
    // the tether reels it back to the cradle
    gun.state = 'returning';
    gun.returnT = 0;
    gun.grab.enabled = false;
    gun.returnFromP.copy(gun.mesh.position);
    gun.returnFromQ.copy(gun.mesh.quaternion);
  }

  #fireGun(gun, hand) {
    if (gun.state !== 'held') return;
    if (this._now - gun.lastShotAt < 0.11) return;
    gun.lastShotAt = this._now;

    const muzzleWorld = gun.parts.muzzle.getWorldPosition(_v1);
    gun.recoil = 1;
    gun.drumTurn += Math.PI / 3; // the next chamber clicks round — never dry
    this.sfx.gunshot(muzzleWorld);
    hand?.pulse(0.9, 45);
    this.tryStart(); // the first live shot starts the round

    // muzzle flash + a wisp of smoke
    gun.flash.visible = true;
    gun.flash.position.copy(muzzleWorld);
    gun.flashLife = 0.055;
    this.#puff(muzzleWorld, 0xcfc8bd, 0.06, 0.3);

    // the shot ray: in XR it leaves from the SIGHT LINE (the aim anchor on
    // the notch/blade plane, see revolverMesh) so a carefully sighted shot
    // lands exactly on the point of aim; on desktop it's the view ray
    if (this.deps.input.isXR && hand) {
      _v2.set(0, 0, -1).applyQuaternion(gun.mesh.getWorldQuaternion(_q1));
      this.#hitscan(gun.parts.aim.getWorldPosition(_v1), _v2.normalize());
    } else {
      const cam = this.deps.world.camera;
      cam.getWorldPosition(_v1);
      cam.getWorldDirection(_v2);
      this.#hitscan(_v1, _v2);
    }
  }

  /* --------------------------------------------------------- hitscan ---- */

  /** trace one shot (world-space origin/dir) through the gallery */
  #hitscan(originW, dirW) {
    // into booth-local space (rotation only, so the quaternion handles dir)
    const o = _v3.copy(originW).applyMatrix4(this._boothInv);
    const d = _v4.copy(dirW).applyQuaternion(this._boothQuatInv).normalize();
    const assist = this.deps.input.isXR ? 0.06 : 0.03; // forgiving toy sights

    let bestT = Infinity, bestHit = null;
    const sphere = (cx, cy, cz, r, hit) => {
      _v1.set(cx - o.x, cy - o.y, cz - o.z);
      const tc = _v1.dot(d);
      if (tc < 0 || tc > 12) return;
      const d2 = _v1.lengthSq() - tc * tc;
      if (d2 < r * r && tc < bestT) { bestT = tc; bestHit = hit; }
    };

    // silhouette test: sample the plate's alpha mask where the ray meets
    // its plane, plus a thin ring of edge forgiveness — so a shot counts
    // only when it would actually plink the painted tin
    const maskHit = (mask, u, v, rPx) => {
      const M = mask.size;
      const probe = (px, py) =>
        px >= 0 && py >= 0 && px < M && py < M && mask.data[py * M + px];
      const cx = Math.round(u * (M - 1)), cy = Math.round((1 - v) * (M - 1));
      if (probe(cx, cy)) return true;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        if (probe(Math.round(cx + Math.cos(a) * rPx),
          Math.round(cy + Math.sin(a) * rPx))) return true;
      }
      return false;
    };
    // half the sphere-days assist, expressed in mask pixels for this plate
    const edgePx = (sizeM, mask) =>
      Math.max(1, Math.round((assist * 0.5 / sizeM) * mask.size));

    for (const tg of this.targets) {
      if (!tg.up || Math.abs(d.z) < 1e-5) continue;
      const t = (tg.row.z - o.z) / d.z;
      if (t < 0 || t > 12 || t >= bestT) continue;
      const s = tg.row.size * (tg.special ? SPECIAL_SCALE : 1);
      let u = (o.x + d.x * t - tg.carrier.position.x) / s + 0.5;
      const v = (o.y + d.y * t - tg.row.y) / s;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      if (tg.plate.scale.x < 0) u = 1 - u; // mirrored silhouettes
      const mask = this._masks[tg.special ? 'clown' : tg.row.kind];
      if (maskHit(mask, u, v, edgePx(s, mask))) {
        bestT = t;
        bestHit = { kind: 'target', tg };
      }
    }
    for (const sp of this.spinners) {
      if (Math.abs(d.z) < 1e-5) continue;
      const t = (sp.z - o.z) / d.z;
      if (t < 0 || t > 12 || t >= bestT) continue;
      // undo the plate's spin so the star's points are where the mask says
      const dx = o.x + d.x * t - sp.x, dy = o.y + d.y * t - sp.y;
      const ca = Math.cos(sp.plate.rotation.z), sa = Math.sin(sp.plate.rotation.z);
      const u = (dx * ca + dy * sa) / 0.36 + 0.5;
      const v = (-dx * sa + dy * ca) / 0.36 + 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      if (maskHit(this._masks.star, u, v, edgePx(0.36, this._masks.star))) {
        bestT = t;
        bestHit = { kind: 'spinner', sp };
      }
    }
    // the sideshow: pips are precision shots — barely any assist
    for (const pip of this.pips) {
      sphere(pip.x, pip.y, pip.z, 0.055 + assist * 0.4, { kind: 'pip', pip });
    }
    for (const lp of this.lollipops) {
      sphere(lp.x, lp.y, lp.z, 0.11 + assist * 0.5, { kind: 'lollipop', lp });
    }
    const bl = this.bell;
    sphere(bl.c.x, bl.c.y, bl.c.z, bl.r + assist * 0.5, { kind: 'bell' });
    const wh = this.wheel;
    sphere(wh.c.x, wh.c.y, wh.c.z, wh.r + assist * 0.5, { kind: 'wheel' });
    const mk = this.monkey;
    sphere(mk.headC.x, mk.headC.y, mk.headC.z, mk.headR, { kind: 'monkey' });
    sphere(mk.bodyC.x, mk.bodyC.y, mk.bodyC.z, mk.bodyR, { kind: 'monkey' });

    if (bestHit) {
      _v1.copy(o).addScaledVector(d, bestT);
      const at = this.booth.group.localToWorld(_v1.clone());
      if (bestHit.kind === 'target') this.#hitTarget(bestHit.tg, at);
      else if (bestHit.kind === 'spinner') this.#hitSpinner(bestHit.sp, at);
      else if (bestHit.kind === 'pip') this.#hitPip(bestHit.pip, at);
      else if (bestHit.kind === 'lollipop') this.#hitLollipop(bestHit.lp, at);
      else if (bestHit.kind === 'bell') this.#hitBell(at);
      else if (bestHit.kind === 'wheel') this.#hitWheel(at);
      else this.#hitMonkey(at);
      return;
    }

    // miss: does it reach the painted backdrop?
    if (d.z < -1e-4) {
      const t = (BACK_Z + 0.02 - o.z) / d.z;
      if (t > 0 && t < 12) {
        const hx = o.x + d.x * t, hy = o.y + d.y * t;
        const at = this.booth.group.localToWorld(_v1.set(hx, hy, BACK_Z + 0.02));
        // easter egg: plugging the painted sun pays a once-a-round bonus
        if (Math.hypot(hx - SUN_AT.x, hy - SUN_AT.y) < SUN_AT.r) {
          this.#hitSun(at);
          return;
        }
        if (Math.abs(hx) < 2.58 && hy > 1.3 && hy < 2.54) {
          this.#addHole(hx, hy);
          this.sfx.boardThunk(at);
          this.#puff(at, 0x9c8a72, 0.05, 0.12);
          return;
        }
        // wild shots rap the stall woodwork somewhere
        if (Math.abs(hx) < 3.0 && hy > 0 && hy < 3.0) {
          this.sfx.boardThunk(at);
          this.#puff(at, 0x9c8a72, 0.04, 0.1);
        }
      }
    }
  }

  #hitTarget(tg, at) {
    if (tg.special) return this.#hitSpecial(tg, at);
    tg.up = false;
    tg.flipK = 0;
    this.sfx.targetTing(at, tg.seed, 1);
    this.sfx.plateFlip(at);
    this.#puff(at, 0xffe9a0, 0.05, 0.18);
    const prev = this.score;
    if (this.addScore(tg.points, at)) this.#checkThresholds(prev);
  }

  /** the WILD CLOWN goes off: whoop-HONK, confetti, a spinning bow */
  #hitSpecial(tg, at) {
    tg.up = false;
    tg.flipK = 1;   // no tin flip — he does his own routine
    tg.celebrate = 1;
    this.sfx.targetTing(at, tg.seed, 0.8);
    this.sfx.clownWhoop(at);
    const confetti = [0xff5d73, 0xffd23f, 0x3aa0ff, 0x8bc34a];
    for (let i = 0; i < 7; i++) {
      _v2.copy(at);
      _v2.x += (Math.random() - 0.5) * 0.35;
      _v2.y += (Math.random() - 0.5) * 0.3;
      this.#puff(_v2, confetti[i % confetti.length], 0.06, 0.35);
    }
    const prev = this.score;
    if (this.addScore(SPECIAL_POINTS, at)) {
      this.#statusFlash('WILD CLOWN +' + SPECIAL_POINTS + '!');
      this.#celebrate(3, false);
      this.#checkThresholds(prev);
    }
  }

  #hitSpinner(sp, at) {
    sp.vel += 15 + Math.random() * 5;
    this.sfx.targetTing(at, sp.seed, 0.9);
    this.#puff(at, 0xffe9a0, 0.05, 0.18);
    if (this._now >= sp.cooldownUntil) {
      sp.cooldownUntil = this._now + 0.9;
      const prev = this.score;
      if (this.addScore(SPINNER_POINTS, at)) this.#checkThresholds(prev);
    }
  }

  #hitMonkey(at) {
    const mk = this.monkey;
    mk.angryT = 0.9;
    this.sfx.targetTing(at, 999, 0.25); // a dull tink off the toy's tin body
    this.sfx.monkeySqueak(at);
    this.#puff(at, 0xffe9a0, 0.04, 0.15);
  }

  /** a precision pip: small target, fat payout, a proud little light-up */
  #hitPip(pip, at) {
    pip.spin = 14;
    pip.glow = 1;
    this.sfx.targetTing(at, pip.seed, 1);
    this.#puff(at, 0xffe9a0, 0.05, 0.2);
    if (this._now >= pip.cooldownUntil) {
      pip.cooldownUntil = this._now + 1.0;
      const prev = this.score;
      if (this.addScore(PIP_POINTS, at)) this.#checkThresholds(prev);
    }
  }

  /** clip a lollipop and the swirl whirls like a pinwheel */
  #hitLollipop(lp, at) {
    lp.vel += 11 + Math.random() * 4;
    this.sfx.targetTing(at, lp.seed, 0.7);
    this.#puff(at, 0xffd7e2, 0.05, 0.18);
    if (this._now >= lp.cooldownUntil) {
      lp.cooldownUntil = this._now + 0.9;
      const prev = this.score;
      if (this.addScore(LOLLIPOP_POINTS, at)) this.#checkThresholds(prev);
    }
  }

  /** ring the brass bell over the big top */
  #hitBell(at) {
    const bl = this.bell;
    bl.rotV = THREE.MathUtils.clamp(bl.rotV + 5, -8, 8);
    this.sfx.bellDing(at);
    this.#puff(at, 0xffe9a0, 0.06, 0.22);
    if (this._now >= bl.cooldownUntil) {
      bl.cooldownUntil = this._now + 0.8;
      const prev = this.score;
      if (this.addScore(BELL_POINTS, at)) {
        this.#statusFlash('DING! +' + BELL_POINTS);
        this.#checkThresholds(prev);
      }
    }
  }

  /** send the prize wheel spinning — it pays whatever it lands on */
  #hitWheel(at) {
    const wh = this.wheel;
    wh.vel = Math.min(16, wh.vel + 8 + Math.random() * 4);
    wh.spinning = true;
    this.sfx.boardThunk(at);
    this.sfx.wheelTick(at, 1);
    this.#puff(at, 0xffe9a0, 0.06, 0.2);
  }

  /** the painted sun: a secret worth shooting exactly once a round */
  #hitSun(at) {
    this.sfx.targetTing(at, 777, 1);
    for (let i = 0; i < 4; i++) {
      _v2.copy(at);
      _v2.x += (Math.random() - 0.5) * 0.2;
      _v2.y += (Math.random() - 0.5) * 0.2;
      this.#puff(_v2, 0xffd23f, 0.07, 0.3);
    }
    if (!this._sunBonusGiven && this.addScore(SUN_BONUS, at)) {
      this._sunBonusGiven = true;
      this.#statusFlash('SUNSHINE BONUS +' + SUN_BONUS + '!');
      this.#celebrate(3, false);
    }
  }

  /** flash a payout message on the scoreboard, then fall back to the state line */
  #statusFlash(msg) {
    this.booth.scoreboard.setStatus(msg);
    this._statusFlashUntil = this._now + 2.2;
  }

  #baseStatus() {
    return this.state === 'running' ? 'KNOCK  EM  DOWN!'
      : this.state === 'over' ? 'TIME UP! PRESS RESET'
        : this.state === 'resetting' ? 'RESETTING…' : this.readyStatus;
  }

  #checkThresholds(prevScore) {
    for (let i = 0; i < CLAP_THRESHOLDS.length; i++) {
      const th = CLAP_THRESHOLDS[i];
      if (prevScore < th && this.score >= th) {
        this.#celebrate(3 + i, i >= 2);
      }
    }
  }

  #celebrate(claps, big = false) {
    const mk = this.monkey;
    mk.clapsLeft = Math.min(8, mk.clapsLeft + claps);
    mk.bigClap = big;
    if (mk.clapPhase <= 0) mk.clapPhase = 1e-4;
  }

  #addHole(x, y) {
    const h = this._holeData[this._holeCursor];
    this._holeCursor = (this._holeCursor + 1) % this._holeData.length;
    h.life = HOLE_LIFE;
    h.x = x + (Math.random() - 0.5) * 0.01;
    h.y = y + (Math.random() - 0.5) * 0.01;
  }

  /* -------------------------------------------------------- game flow ---- */

  onRoundStart() {
    this._sunBonusGiven = false;
    this._statusFlashUntil = 0;
    this.booth.scoreboard.setStatus('KNOCK  EM  DOWN!');
  }

  onRoundEnd() {
    this._statusFlashUntil = 0;
    this.booth.scoreboard.setStatus('TIME UP! PRESS RESET');
    // the monkey applauds the effort — generously for a hot round
    this.#celebrate(this.score >= 250 ? 6 : this.score > 0 ? 3 : 1, this.score >= 250);
  }

  /** RESET: re-rack the guns, then the plate-rise show */
  onResetRound() {
    this.booth.scoreboard.setStatus('RESETTING…');
    this._statusFlashUntil = 0;
    for (const gun of this.guns) {
      if (gun.state === 'rest') this.#rackGun(gun);   // square up cradled guns
    }
    this._sunBonusGiven = false;
    this.wheel.vel = 0;
    this.wheel.spinning = false;
    this.monkey.clapsLeft = 0;
    this.monkey.angryT = 0;
    // any mid-bow clown settles instantly so the rise show owns the plates
    for (const tg of this.targets) {
      if (tg.celebrate > 0) {
        tg.celebrate = 0;
        tg.plate.rotation.y = 0;
        tg.carrier.position.y = tg.row.y;
        tg.plate.scale.set(Math.sign(tg.plate.scale.x) * SPECIAL_SCALE, SPECIAL_SCALE, 1);
      }
    }
    const down = this.targets.filter(tg => !tg.up);
    down.sort(() => Math.random() - 0.5);
    down.forEach((tg, i) => {
      this._riseQueue.push({ tg, at: this._now + 0.25 + i * 0.14 });
    });
  }

  /* ----------------------------------------------------------- update ---- */

  onUpdate(dt, t) {
    this._now = t;
    this.#updateTargets(dt);
    this.#updateSpinners(dt);
    this.#updateWheel(dt);
    this.#updateSideshow(dt);
    this.#updateMonkey(dt, t);
    this.#updateGuns(dt);
    this.#updateFx(dt);
    this.#updateRiseQueue(t);

    // payout flashes fall back to the state line after a couple of seconds
    if (this._statusFlashUntil && t > this._statusFlashUntil) {
      this._statusFlashUntil = 0;
      this.booth.scoreboard.setStatus(this.#baseStatus());
    }

    // idle showmanship: an occasional slow clap invites passers-by
    if (this.state === 'ready' && t > this._attractAt) {
      this._attractAt = t + 22 + Math.random() * 10;
      this.#celebrate(2, false);
    }
  }

  /** wheel physics: spin, clack past the flapper, settle, PAY OUT */
  #updateWheel(dt) {
    const wh = this.wheel;
    // flapper springs back after each peg kick
    if (wh.flap > 0) {
      wh.flap = Math.max(0, wh.flap - dt * 9);
      wh.flapper.rotation.z = -0.42 * wh.flap;
    }
    if (!wh.spinning) return;

    wh.disc.rotation.z += wh.vel * dt;
    wh.vel -= (0.35 + wh.vel * 0.42) * dt;

    const step = (Math.PI * 2) / WHEEL_WEDGES.length;
    const notch = Math.floor(wh.disc.rotation.z / step);
    if (notch !== wh.lastNotch) {
      wh.lastNotch = notch;
      wh.flap = 1;
      this.sfx.wheelTick(
        this.booth.group.localToWorld(_v2.copy(wh.c)), Math.min(1.5, wh.vel / 8));
    }

    if (wh.vel <= 0.18) {
      wh.vel = 0;
      wh.spinning = false;
      // which wedge sits under the top pointer (see prizeWheelTexture)
      const rot = wh.disc.rotation.z;
      const idx = Math.floor(
        THREE.MathUtils.euclideanModulo(rot - Math.PI / 2, Math.PI * 2) / step);
      const value = WHEEL_WEDGES[idx];
      const at = this.booth.group.localToWorld(_v2.copy(wh.c));
      const jackpot = value >= 200;
      this.sfx.wheelWin(at, jackpot);
      for (let i = 0; i < (jackpot ? 6 : 3); i++) {
        _v1.copy(at);
        _v1.x += (Math.random() - 0.5) * 0.5;
        _v1.y += (Math.random() - 0.5) * 0.5;
        this.#puff(_v1, jackpot ? 0xffd23f : 0xffe9a0, 0.07, 0.3);
      }
      const prev = this.score;
      if (this.addScore(value, at)) {
        this.#statusFlash(jackpot ? 'WHEEL JACKPOT +' + value + '!' : 'WHEEL PAYS +' + value);
        if (value >= 100) this.#celebrate(jackpot ? 5 : 3, jackpot);
        this.#checkThresholds(prev);
      }
    }
  }

  /** pips light up and twirl; the bell swings itself quiet; lollipops whirl */
  #updateSideshow(dt) {
    for (const pip of this.pips) {
      if (pip.spin > 0) {
        pip.spin = Math.max(0, pip.spin - dt * 9);
        pip.plate.rotation.z += pip.spin * dt * 4;
      } else if (pip.plate.rotation.z !== 0) {
        // ease back onto the nearest upright detent
        const r = THREE.MathUtils.euclideanModulo(
          pip.plate.rotation.z + Math.PI, Math.PI * 2) - Math.PI;
        pip.plate.rotation.z = Math.abs(r) < 0.02 ? 0 : r - r * Math.min(1, dt * 6);
      }
      if (pip.glow > 0) {
        pip.glow = Math.max(0, pip.glow - dt * 1.6);
        pip.plate.material.emissiveIntensity = 0.5 * pip.glow;
      }
    }

    const bl = this.bell;
    if (bl.rotV !== 0 || bl.rot !== 0) {
      // pendulum spring: swings hard, rings down to rest
      bl.rotV += (-46 * bl.rot - 1.9 * bl.rotV) * dt;
      bl.rot += bl.rotV * dt;
      if (Math.abs(bl.rot) < 0.004 && Math.abs(bl.rotV) < 0.02) {
        bl.rot = 0; bl.rotV = 0;
      }
      bl.swing.rotation.z = bl.rot;
    }

    for (const lp of this.lollipops) {
      if (lp.vel <= 0) continue;
      lp.head.rotation.z += lp.vel * dt;
      lp.vel = Math.max(0, lp.vel - (0.4 + lp.vel * 0.5) * dt);
    }
  }

  #updateTargets(dt) {
    for (const tg of this.targets) {
      const { row } = tg;
      // ride the conveyor; turn around out of sight behind the cabinets
      let x = tg.carrier.position.x + row.dir * row.speed * dt;
      if (row.dir > 0 && x > TRACK_HALF) {
        x -= TRACK_HALF * 2;
        this.#onTargetWrapped(tg);
      } else if (row.dir < 0 && x < -TRACK_HALF) {
        x += TRACK_HALF * 2;
        this.#onTargetWrapped(tg);
      }
      tg.carrier.position.x = x;

      // the wild clown's victory lap: spins, hops, swells — then lies down
      if (tg.celebrate > 0) {
        tg.celebrate = Math.max(0, tg.celebrate - dt / 0.9);
        const k = 1 - tg.celebrate;
        tg.plate.rotation.y = k * Math.PI * 6;
        tg.carrier.position.y = row.y + Math.sin(k * Math.PI) * 0.16;
        const sc = SPECIAL_SCALE * (1 + 0.3 * Math.sin(k * Math.PI));
        tg.plate.scale.set(Math.sign(tg.plate.scale.x) * sc, sc, 1);
        if (tg.celebrate === 0) {
          tg.plate.rotation.y = 0;
          tg.carrier.position.y = row.y;
          tg.plate.scale.set(Math.sign(tg.plate.scale.x) * SPECIAL_SCALE, SPECIAL_SCALE, 1);
          tg.plate.rotation.x = -1.72; // takes a bow, back at the next wrap
        }
      }

      // flip-down animation (hit) / creak-up animation (reset show)
      if (!tg.up && tg.flipK < 1) {
        tg.flipK = Math.min(1, tg.flipK + dt / FLIP_TIME);
        const k = tg.flipK;
        tg.plate.rotation.x = -1.72 * (1 - (1 - k) * (1 - k));
      } else if (tg.rising) {
        tg.riseK = Math.min(1, tg.riseK + dt / RISE_TIME);
        const k = tg.riseK;
        // rise with a little overshoot wobble at the top
        const ang = -1.72 * (1 - k) + Math.sin(k * Math.PI) * -0.06;
        tg.plate.rotation.x = ang;
        if (k >= 1) {
          tg.rising = false;
          tg.up = true;
          tg.plate.rotation.x = 0;
        }
      }
    }
  }

  /** silently reset a downed plate while it's hidden behind a cabinet */
  #standTargetUp(tg) {
    if (tg.up || tg.rising) return;
    tg.up = true;
    tg.flipK = 1;
    tg.plate.rotation.x = 0;
  }

  /**
   * Every conveyor turnaround happens out of sight behind a cabinet — the
   * moment to stand plates back up, retire a spent clown, and every 10–20
   * animal passes, sneak the WILD CLOWN in wearing some animal's spot.
   */
  #onTargetWrapped(tg) {
    if (tg.special) this.#revertSpecial(tg);
    else if (!this._specialActive && ++this._wrapCount >= this._nextSpecialAt) {
      this.#makeSpecial(tg);
    }
    this.#standTargetUp(tg);
  }

  #makeSpecial(tg) {
    this._specialActive = true;
    this._wrapCount = 0;
    this._nextSpecialAt = SPECIAL_EVERY();
    tg.special = true;
    tg.baseMat = tg.plate.material;
    tg.plate.material = this._clownMat;
    tg.plate.scale.set(tg.row.dir * SPECIAL_SCALE, SPECIAL_SCALE, 1);
  }

  #revertSpecial(tg) {
    this._specialActive = false;
    tg.special = false;
    tg.celebrate = 0;
    tg.plate.material = tg.baseMat;
    tg.plate.rotation.y = 0;
    tg.carrier.position.y = tg.row.y;
    tg.plate.scale.set(tg.row.dir, 1, 1);
  }

  #updateSpinners(dt) {
    for (const sp of this.spinners) {
      sp.plate.rotation.z += sp.vel * dt;
      sp.vel += (0.8 - sp.vel) * Math.min(1, dt * 0.7); // spin down to idle
    }
  }

  #updateMonkey(dt, t) {
    const mk = this.monkey;
    // idle sway
    mk.monkey.rotation.z = Math.sin(t * 1.3) * 0.045;
    mk.monkey.rotation.y = Math.sin(t * 0.7) * 0.08;

    // indignant head shake (someone shot the monkey)
    if (mk.angryT > 0) {
      mk.angryT -= dt;
      mk.head.rotation.y = Math.sin(t * 26) * 0.38 * Math.min(1, mk.angryT / 0.6);
      if (mk.angryT <= 0) mk.head.rotation.y = 0;
    }

    // cymbal claps: each cycle swings in, CRASHES at the meeting point,
    // swings back out — audio fired exactly at the contact frame
    if (mk.clapsLeft > 0 || mk.clapPhase > 0) {
      const CYCLE = 0.34;
      mk.clapPhase += dt;
      const k = mk.clapPhase / CYCLE;
      const c = Math.sin(Math.min(1, k) * Math.PI); // 0→1→0 swing profile
      for (const a of mk.arms) {
        a.shoulder.rotation.y = THREE.MathUtils.lerp(a.openY, a.clapY, c);
      }
      mk.head.rotation.x = -0.16 * c;
      if (!mk.clapHit && k >= 0.5) {
        mk.clapHit = true;
        this.sfx.cymbal(mk.cymbalAt(), mk.bigClap);
      }
      if (k >= 1) {
        mk.clapPhase = 0;
        mk.clapHit = false;
        mk.clapsLeft = Math.max(0, mk.clapsLeft - 1);
        if (mk.clapsLeft === 0) {
          for (const a of mk.arms) a.shoulder.rotation.y = a.openY;
          mk.head.rotation.x = 0;
        } else {
          mk.clapPhase = 1e-4; // straight into the next clap
        }
      }
    }
  }

  #updateGuns(dt) {
    for (const gun of this.guns) {
      // recoil: the muzzle kicks up and the hammer snaps, then both settle.
      // Applied AFTER Grabbables has posed the held gun, so it stacks on
      // the grip — fanning fast keeps the barrel climbing, like it should.
      if (gun.recoil > 0) {
        gun.recoil = Math.max(0, gun.recoil - dt * 6.5);
        if (gun.state === 'held') {
          const k = gun.recoil * gun.recoil;
          gun.mesh.rotateX(0.2 * k);
          gun.mesh.translateZ(0.012 * k);
        }
        gun.parts.hammer.rotation.x = -0.7 * gun.recoil;
      }

      if (gun.state === 'held') {
        // a held gun dragged off the pitch gets reeled home by its tether
        _v1.copy(gun.mesh.position).applyMatrix4(this._boothInv);
        if (_v1.z > 3.4 || Math.abs(_v1.x) > 3.4) {
          const hand = gun.grab.heldBy;
          if (hand) this.deps.grabbables.drop(hand.index);
          this.#dropGun(gun);
        }
      }

      // the cylinder eases round to its next chamber after each shot
      const drumLag = gun.drumTurn - gun.parts.drum.rotation.z;
      if (drumLag > 1e-4) {
        gun.parts.drum.rotation.z += drumLag * Math.min(1, dt * 22);
      }

      // tether reeling a dropped gun back to its cradle
      if (gun.state === 'returning') {
        gun.returnT += dt / RETURN_TIME;
        const k = Math.min(1, gun.returnT);
        const e = k * k * (3 - 2 * k);
        this.booth.group.localToWorld(_v1.copy(gun.restPosLocal));
        gun.mesh.position.lerpVectors(gun.returnFromP, _v1, e);
        gun.mesh.position.y += Math.sin(k * Math.PI) * 0.08; // little hop
        _q1.copy(this._boothQuatInv).invert().multiply(gun.restQuatLocal);
        gun.mesh.quaternion.slerpQuaternions(gun.returnFromQ, _q1, e);
        if (k >= 1) {
          this.#rackGun(gun);
          this.deps.audio.play('tick', { at: gun.mesh, volume: 0.3, rate: 0.85, jitter: 0.1 });
        }
      }

      // muzzle flash decay
      if (gun.flashLife > 0) {
        gun.flashLife -= dt;
        if (gun.flashLife <= 0) gun.flash.visible = false;
      }

      // tether cord: sag from the counter anchor to the lanyard ring
      const pos = gun.tether.geometry.getAttribute('position');
      this.booth.group.worldToLocal(gun.mesh.getWorldPosition(_v1));
      _v1.y -= 0.05; // toward the butt ring
      const a = gun.tetherAnchorLocal;
      const slack = Math.max(0.06, 0.5 - a.distanceTo(_v1) * 0.35);
      for (let i = 0; i < 8; i++) {
        const s = i / 7;
        pos.setXYZ(i,
          THREE.MathUtils.lerp(a.x, _v1.x, s),
          THREE.MathUtils.lerp(a.y, _v1.y, s) - Math.sin(s * Math.PI) * slack,
          THREE.MathUtils.lerp(a.z, _v1.z, s));
      }
      pos.needsUpdate = true;
    }
  }

  #updateFx(dt) {
    // bullet dents fade out of the paintwork
    let dirty = false;
    for (let i = 0; i < this._holeData.length; i++) {
      const h = this._holeData[i];
      if (h.life <= 0) continue;
      h.life -= dt;
      dirty = true;
      const s = Math.min(1, h.life / 2); // hold, then shrink away
      _m1.makeScale(s, s, s);
      _m1.setPosition(h.x, h.y, BACK_Z + 0.015);
      this.holes.setMatrixAt(i, _m1);
    }
    if (dirty) this.holes.instanceMatrix.needsUpdate = true;

    // smoke wisps rise and fade
    for (const p of this._puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sprite.visible = false; continue; }
      const k = p.life / p.maxLife;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.material.opacity = 0.5 * k;
      p.sprite.scale.setScalar(p.baseScale * (1.6 - 0.6 * k));
    }
  }

  #updateRiseQueue(t) {
    for (let i = this._riseQueue.length - 1; i >= 0; i--) {
      const job = this._riseQueue[i];
      if (t < job.at) continue;
      this._riseQueue.splice(i, 1);
      const tg = job.tg;
      if (tg.up || tg.rising) continue;
      tg.rising = true;
      tg.riseK = 0;
      this.sfx.plateRise(tg.carrier.getWorldPosition(_v1));
    }
    if (this.state === 'resetting' && this._riseQueue.length === 0 &&
        this.targets.every(tg => tg.up || tg.rising)) {
      if (this.targets.every(tg => tg.up)) this.finishReset();
    }
  }
}

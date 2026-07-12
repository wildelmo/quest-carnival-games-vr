import * as THREE from 'three';
import { MiniGame } from './registry.js';
import { BoothBase } from '../components/BoothBase.js';
import { noseOutHoldQuat } from '../core/Grabbables.js';
import { shiny, glowTexture } from '../core/environment.js';
import { stripesTexture, woodTexture, barberPoleTexture, CARNIVAL_PALETTE } from '../core/textures.js';
import { buildRevolver } from './revolverMesh.js';
import { ShootingGalleryAudio } from './ShootingGalleryAudio.js';
import {
  galleryBackdropTexture, waveRailTexture, targetTexture, bulletHoleTexture,
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
 * analog trigger), squeeze the trigger to fire. Six shots, then the hammer
 * clicks dry and the cylinder whirls itself a reload — point the barrel at
 * the roof to speed it up, like a showman. Shots are hitscan with a
 * muzzle flash and a cork-gun POP; hits ring the target's own tin TING and
 * slap the plate down; misses dent the painted backdrop. Letting go (or
 * wandering off with one) lets the counter tether reel the gun back to its
 * cradle.
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

const GUN_AMMO = 6;
const RELOAD_TIME = 0.65;         // cylinder-whirl duration
const AUTO_RELOAD_DELAY = 1.0;    // dawdle after running dry before self-reload
const RETURN_TIME = 0.55;         // tether reeling a dropped gun home
const FLIP_TIME = 0.22, RISE_TIME = 0.3;
const HOLE_LIFE = 10;

/**
 * Hand-local hold for the six-shooter. XR numbers were seeded from the
 * dart's tuned grip geometry and are LIVE-TUNABLE on the headset with the
 * GunGripTuner (hold a gun, squeeze the empty hand's grip) — read the
 * panel and bake keepers back here. Desktop overrides the canned XR swing:
 * the desktop hand frame IS the camera frame, so the barrel just points
 * straight down the view with a whisker of lift.
 */
const GUN_HOLD = { palm: 0.02, fingers: 0.015, up: 0.01, noseUp: 55 };
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
    this.guns = [];
    this._riseQueue = [];
    this._attractAt = 20;

    this.#buildStage();
    this.#buildTargets();
    this.#buildSpinners();
    this.#buildMonkey();
    this.#buildCabinets();
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
      // three cubbies with plush prizes
      for (let i = 0; i < 3; i++) {
        const cy = 1.25 + i * 0.44;
        const cubby = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.36, 0.05), cubbyMat);
        cubby.position.set(x, cy, -0.29);
        g.add(cubby);
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
      }
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
        ammo: GUN_AMMO, state: 'rest',
        reloadT: 0, reloadAt: 0, recoil: 0, drumSpin: 0,
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
    gun.ammo = GUN_AMMO;
    gun.reloadT = 0;
    gun.reloadAt = 0;
    gun.recoil = 0;
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
    if (gun.state !== 'held' || gun.reloadT > 0) return;
    if (this._now - gun.lastShotAt < 0.11) return;
    gun.lastShotAt = this._now;

    const muzzleWorld = gun.parts.muzzle.getWorldPosition(_v1);
    if (gun.ammo <= 0) {
      this.sfx.dryFire(muzzleWorld);
      hand?.pulse(0.15, 15);
      return;
    }
    gun.ammo--;
    gun.recoil = 1;
    if (gun.ammo === 0) gun.reloadAt = this._now + AUTO_RELOAD_DELAY;
    this.sfx.gunshot(muzzleWorld);
    hand?.pulse(0.9, 45);
    this.tryStart(); // the first live shot starts the round

    // muzzle flash + a wisp of smoke
    gun.flash.visible = true;
    gun.flash.position.copy(muzzleWorld);
    gun.flashLife = 0.055;
    this.#puff(muzzleWorld, 0xcfc8bd, 0.06, 0.3);

    // the shot ray: the barrel in XR, the view (crosshair) on desktop
    if (this.deps.input.isXR && hand) {
      _v2.set(0, 0, -1).applyQuaternion(gun.mesh.getWorldQuaternion(_q1));
      this.#hitscan(muzzleWorld, _v2.normalize());
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

    for (const tg of this.targets) {
      if (!tg.up) continue;
      const r = tg.row.size * 0.55 + assist;
      sphere(tg.carrier.position.x, tg.row.y + tg.row.size / 2, tg.row.z, r,
        { kind: 'target', tg });
    }
    for (const sp of this.spinners) {
      sphere(sp.x, sp.y, sp.z, 0.19 + assist, { kind: 'spinner', sp });
    }
    const mk = this.monkey;
    sphere(mk.headC.x, mk.headC.y, mk.headC.z, mk.headR, { kind: 'monkey' });
    sphere(mk.bodyC.x, mk.bodyC.y, mk.bodyC.z, mk.bodyR, { kind: 'monkey' });

    if (bestHit) {
      _v1.copy(o).addScaledVector(d, bestT);
      const at = this.booth.group.localToWorld(_v1.clone());
      if (bestHit.kind === 'target') this.#hitTarget(bestHit.tg, at);
      else if (bestHit.kind === 'spinner') this.#hitSpinner(bestHit.sp, at);
      else this.#hitMonkey(at);
      return;
    }

    // miss: does it reach the painted backdrop?
    if (d.z < -1e-4) {
      const t = (BACK_Z + 0.02 - o.z) / d.z;
      if (t > 0 && t < 12) {
        const hx = o.x + d.x * t, hy = o.y + d.y * t;
        const at = this.booth.group.localToWorld(_v1.set(hx, hy, BACK_Z + 0.02));
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
    tg.up = false;
    tg.flipK = 0;
    this.sfx.targetTing(at, tg.seed, 1);
    this.sfx.plateFlip(at);
    this.#puff(at, 0xffe9a0, 0.05, 0.18);
    const prev = this.score;
    if (this.addScore(tg.points, at)) this.#checkThresholds(prev);
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
    this.booth.scoreboard.setStatus('KNOCK  EM  DOWN!');
  }

  onRoundEnd() {
    this.booth.scoreboard.setStatus('TIME UP! PRESS RESET');
    // the monkey applauds the effort — generously for a hot round
    this.#celebrate(this.score >= 250 ? 6 : this.score > 0 ? 3 : 1, this.score >= 250);
  }

  /** RESET: re-rack the guns, then the plate-rise show */
  onResetRound() {
    this.booth.scoreboard.setStatus('RESETTING…');
    for (const gun of this.guns) {
      if (gun.state === 'rest') this.#rackGun(gun);   // fresh ammo in the cradle
      else gun.ammo = GUN_AMMO;                       // held guns quietly refilled
    }
    this.monkey.clapsLeft = 0;
    this.monkey.angryT = 0;
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
    this.#updateMonkey(dt, t);
    this.#updateGuns(dt);
    this.#updateFx(dt);
    this.#updateRiseQueue(t);

    // idle showmanship: an occasional slow clap invites passers-by
    if (this.state === 'ready' && t > this._attractAt) {
      this._attractAt = t + 22 + Math.random() * 10;
      this.#celebrate(2, false);
    }
  }

  #updateTargets(dt) {
    for (const tg of this.targets) {
      const { row } = tg;
      // ride the conveyor; turn around out of sight behind the cabinets
      let x = tg.carrier.position.x + row.dir * row.speed * dt;
      if (row.dir > 0 && x > TRACK_HALF) {
        x -= TRACK_HALF * 2;
        this.#standTargetUp(tg);
      } else if (row.dir < 0 && x < -TRACK_HALF) {
        x += TRACK_HALF * 2;
        this.#standTargetUp(tg);
      }
      tg.carrier.position.x = x;

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
        // empty cylinder: reload after a beat — or right away if the
        // player points the barrel at the roof like a showman
        if (gun.ammo === 0 && gun.reloadT <= 0) {
          _v1.set(0, 0, -1).applyQuaternion(gun.mesh.getWorldQuaternion(_q1));
          const tiltUp = _v1.y > 0.75;
          if (tiltUp || this._now >= gun.reloadAt) {
            gun.reloadT = RELOAD_TIME;
            this.sfx.reloadSpin(gun.mesh.getWorldPosition(_v2), RELOAD_TIME);
            gun.grab.heldBy?.pulse(0.3, 30);
          }
        }
        // a held gun dragged off the pitch gets reeled home by its tether
        _v1.copy(gun.mesh.position).applyMatrix4(this._boothInv);
        if (_v1.z > 3.4 || Math.abs(_v1.x) > 3.4) {
          const hand = gun.grab.heldBy;
          if (hand) this.deps.grabbables.drop(hand.index);
          this.#dropGun(gun);
        }
      }

      // the reload whirl
      if (gun.reloadT > 0) {
        gun.reloadT -= dt;
        gun.parts.drum.rotation.z += 34 * dt;
        if (gun.reloadT <= 0) {
          gun.reloadT = 0;
          gun.ammo = GUN_AMMO;
          gun.parts.drum.rotation.z = 0;
        }
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

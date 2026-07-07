import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENTRANCE_ANGLE } from './Tent.js';
import { makeGlowPoints, glowTexture } from '../core/environment.js';
import { CARNIVAL_PALETTE, DISPLAY_FONT } from '../core/textures.js';

/**
 * Midway — the night carnival OUTSIDE the tent, seen through the doorway
 * and the laced windows in the drum wall. Pure scenery: the player never
 * walks out there (locomotion is clamped to the tent floor), so everything
 * is built for the view — a lit Ferris wheel turning on the entrance axis,
 * an arc of glowing food/game stalls, strolling silhouette crowds, distant
 * fireworks with delayed booms, sweeping searchlights, stars and a moon.
 *
 * PERFORMANCE: everything out here is UNLIT MeshBasicMaterial silhouette
 * geometry plus emissive bulbs/glows — no lights are added, the tent's warm
 * interior lighting can't leak onto it, and the whole midway is ~20 draw
 * calls. three.js sorts opaque objects front-to-back, so when the wall is
 * between you and the midway its fragments die on the early depth test.
 */

const OUT = ENTRANCE_ANGLE;                 // the midway is laid out on this axis
const STRUCTURE_COLOR = 0x161a26;           // near-silhouette steel/wood blue
const g = -2.8;                             // firework "gravity" (stylized, slow)

/** point at pad-angle a, distance d from the tent centre */
function radial(a, d, y = 0) {
  return new THREE.Vector3(Math.sin(a) * d, y, -Math.cos(a) * d);
}

export class Midway {
  /**
   * @param {import('../core/World.js').World} world
   * @param {import('../core/AudioManager.js').AudioManager} audio
   */
  constructor(world, audio) {
    this.world = world;
    this.audio = audio;
    this.group = new THREE.Group();
    this.group.name = 'midway';
    world.scene.add(this.group);

    this._structures = [];   // geometries merged into the one silhouette mesh

    this.#buildSky();
    this.#buildGround();
    this.#buildTreeline();
    this.#buildFerrisWheel();
    this.#buildStalls();
    this.#buildCarousel();
    this.#buildHighStriker();
    this.#buildPath();
    this.#buildCrowd();
    this.#buildSearchlights();
    this.#buildFireworks();
    this.#commitStructures();

    world.onUpdate((dt, t) => this.#update(dt, t));
  }

  /* ------------------------------------------------------------- sky ---- */

  #buildSky() {
    // deep night gradient dome; fog OFF so the sky stays a sky instead of
    // blending into the warm interior haze
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, '#070818');
    grad.addColorStop(0.45, '#101334');
    grad.addColorStop(0.75, '#33184a');
    grad.addColorStop(0.92, '#552541');
    grad.addColorStop(1.0, '#68333e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(46, 24, 14),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }),
    );
    this.group.add(sky);

    // warm "light pollution" glows on the horizon behind the attractions —
    // fake skyline bounce that makes the night feel inhabited
    for (const [off, colr, w] of [[0, 0xa04a38, 30], [3.05, 0x7a3c4a, 24], [-1.9, 0x6a3c2a, 20]]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: colr, transparent: true, opacity: 0.34,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      s.position.copy(radial(OUT + off, 43, 1.5));
      s.scale.set(w, w * 0.34, 1);
      this.group.add(s);
    }

    // stars: one Points cloud on the upper dome, warm/cool colour jitter
    const N = 620;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const tint = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const elev = Math.asin(0.06 + Math.random() * 0.92);
      const r = 44;
      pos[i * 3] = Math.cos(a) * Math.cos(elev) * r;
      pos[i * 3 + 1] = Math.sin(elev) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(elev) * r;
      tint.setHSL(Math.random() < 0.2 ? 0.08 : 0.62, 0.4, 0.75 + Math.random() * 0.25);
      tint.multiplyScalar(0.35 + Math.random() * 0.65);
      col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      size: 0.45, map: glowTexture(), vertexColors: true, transparent: true,
      opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
      fog: false, sizeAttenuation: true,
    }));
    this.group.add(stars);

    // gibbous moon, low over the stalls
    const mc = document.createElement('canvas');
    mc.width = mc.height = 128;
    const mctx = mc.getContext('2d');
    const mg = mctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    mg.addColorStop(0, 'rgba(255,248,225,1)');
    mg.addColorStop(0.35, 'rgba(255,244,214,0.95)');
    mg.addColorStop(0.5, 'rgba(240,228,200,0.35)');
    mg.addColorStop(1, 'rgba(240,228,200,0)');
    mctx.fillStyle = mg;
    mctx.fillRect(0, 0, 128, 128);
    const mtex = new THREE.CanvasTexture(mc);
    mtex.colorSpace = THREE.SRGBColorSpace;
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mtex, transparent: true, fog: false, depthWrite: false,
    }));
    moon.position.copy(radial(OUT + 0.85, 42, 20));
    moon.scale.setScalar(7);
    this.group.add(moon);
  }

  #buildGround() {
    // moonlit field the midway sits on (the tent floor covers the middle)
    const ground = new THREE.Mesh(
      new THREE.RingGeometry(8.6, 46, 48),
      new THREE.MeshBasicMaterial({ color: 0x0a0f14 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    this.group.add(ground);
  }

  #buildTreeline() {
    // ragged ring of conifer silhouettes closing off the horizon
    const N = 44;
    const trees = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.1, 3.6, 5),
      new THREE.MeshBasicMaterial({ color: 0x0a0d15, fog: false }),
      N,
    );
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.random() * 0.1;
      const d = 38 + Math.random() * 5;
      const s = 0.8 + Math.random() * 1.3;
      _s.set(s, s * (0.9 + Math.random() * 0.5), s);
      _m.compose(radial(a, d, 1.7 * _s.y), _q, _s);
      trees.setMatrixAt(i, _m);
    }
    this.group.add(trees);
  }

  /* ---------------------------------------------------------- wheel ---- */

  #buildFerrisWheel() {
    const HUB_H = 9.6, RADIUS = 8, DIST = 34;
    const root = new THREE.Group();
    root.position.copy(radial(OUT, DIST, HUB_H));
    root.rotation.y = -OUT;              // wheel disc faces the tent doorway
    this.group.add(root);

    // --- rotating part: rim + spokes + hub, merged to one silhouette mesh
    const parts = [new THREE.TorusGeometry(RADIUS, 0.11, 6, 44)];
    const _m = new THREE.Matrix4();
    for (let i = 0; i < 12; i++) {
      const spoke = new THREE.CylinderGeometry(0.05, 0.05, RADIUS, 5);
      spoke.applyMatrix4(_m.makeTranslation(0, RADIUS / 2, 0));
      spoke.applyMatrix4(_m.makeRotationZ((i / 12) * Math.PI * 2));
      parts.push(spoke);
    }
    const hub = new THREE.CylinderGeometry(0.42, 0.42, 0.5, 12);
    hub.applyMatrix4(_m.makeRotationX(Math.PI / 2));
    parts.push(hub);
    this.wheelSpin = new THREE.Group();
    this.wheelSpin.add(new THREE.Mesh(
      mergeGeometries(parts),
      new THREE.MeshBasicMaterial({ color: STRUCTURE_COLOR }),
    ));
    root.add(this.wheelSpin);

    // --- rim bulbs: instanced spheres + a glow cloud, chase-animated
    const NB = 36;
    this.wheelBulbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.14, 6, 5),
      new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }),
      NB,
    );
    const bulbPos = [];
    const color = new THREE.Color();
    for (let i = 0; i < NB; i++) {
      const a = (i / NB) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 0.12);
      _m.setPosition(p);
      this.wheelBulbs.setMatrixAt(i, _m);
      this.wheelBulbs.setColorAt(i, color.setHex(CARNIVAL_PALETTE[i % CARNIVAL_PALETTE.length]));
      bulbPos.push(p);
    }
    this.wheelSpin.add(this.wheelBulbs);
    this.wheelGlow = makeGlowPoints(bulbPos, { size: 1.15, opacity: 0.6 });
    this.wheelGlow.points.material.fog = false;
    this.wheelSpin.add(this.wheelGlow.points);

    // --- legs: two A-frames + crossbar (static), merged
    const leg = (x0, z0, x1, y1, z1) => {
      const from = new THREE.Vector3(x0, -HUB_H, z0);
      const to = new THREE.Vector3(x1, y1, z1);
      const len = from.distanceTo(to);
      const geo = new THREE.CylinderGeometry(0.1, 0.13, len, 6);
      geo.applyMatrix4(_m.makeTranslation(0, len / 2, 0));
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        to.clone().sub(from).normalize());
      geo.applyMatrix4(_m.makeRotationFromQuaternion(q));
      geo.applyMatrix4(_m.makeTranslation(from.x, from.y, from.z));
      return geo;
    };
    const legs = [
      leg(-3.4, 1.4, 0, -0.2, 0.35), leg(-3.4, -1.4, 0, -0.2, -0.35),
      leg(3.4, 1.4, 0, -0.2, 0.35), leg(3.4, -1.4, 0, -0.2, -0.35),
    ];
    const bar = new THREE.CylinderGeometry(0.07, 0.07, 4.4, 5);
    bar.applyMatrix4(_m.makeRotationZ(Math.PI / 2));
    bar.applyMatrix4(_m.makeTranslation(0, -HUB_H * 0.45, 0));
    legs.push(bar);
    root.add(new THREE.Mesh(
      mergeGeometries(legs),
      new THREE.MeshBasicMaterial({ color: STRUCTURE_COLOR }),
    ));

    // --- gondolas: instanced, hang upright, gentle pendulum sway
    const body = new THREE.BoxGeometry(0.95, 0.6, 0.6);
    body.applyMatrix4(_m.makeTranslation(0, -0.62, 0));
    const roof = new THREE.BoxGeometry(1.05, 0.1, 0.7);
    roof.applyMatrix4(_m.makeTranslation(0, -0.27, 0));
    const arm = new THREE.BoxGeometry(0.07, 0.3, 0.07);
    arm.applyMatrix4(_m.makeTranslation(0, -0.1, 0));
    this.gondolas = new THREE.InstancedMesh(
      mergeGeometries([body, roof, arm]),
      new THREE.MeshBasicMaterial({}),
      12,
    );
    const gc = new THREE.Color();
    for (let i = 0; i < 12; i++) {
      gc.setHex(CARNIVAL_PALETTE[i % CARNIVAL_PALETTE.length]).multiplyScalar(0.42);
      this.gondolas.setColorAt(i, gc);
    }
    root.add(this.gondolas);
    this._wheelAngle = 0;
    this._wheelRadius = RADIUS;

    // hub beacon in the static warm-glow cloud
    this._bigGlows = [{ p: radial(OUT, DIST - 0.3, HUB_H), color: 0xffd9a0, size: 1 }];
  }

  /* ---------------------------------------------------------- stalls ---- */

  /** One painted night-stall facade: striped awning, glowing counter,
   *  silhouette wares, painted bulb string. All the light is in the paint. */
  #stallTexture(sign, hueA, hueB) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    // body silhouette
    ctx.fillStyle = '#131623';
    ctx.fillRect(24, 88, 208, 168);
    // striped awning (moonlit — dim, desaturated)
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? hueA : hueB;
      ctx.fillRect(16 + i * 28, 56, 28, 40);
    }
    ctx.beginPath();                       // peaked canvas top
    ctx.moveTo(16, 58); ctx.lineTo(128, 8); ctx.lineTo(240, 58);
    ctx.closePath();
    ctx.fillStyle = hueA;
    ctx.fill();
    // warm glowing counter window — the "life" of the stall
    const wg = ctx.createLinearGradient(0, 110, 0, 218);
    wg.addColorStop(0, '#ffd27a');
    wg.addColorStop(1, '#c96a2a');
    ctx.fillStyle = wg;
    ctx.fillRect(48, 110, 160, 108);
    // vendor + hanging wares as cutout silhouettes inside the glow
    ctx.fillStyle = '#131623';
    ctx.beginPath(); ctx.arc(128, 176, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(112, 188, 32, 30);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(64 + i * 32, 122 + (i % 2) * 6, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    // counter board
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(40, 214, 176, 20);
    // sign
    ctx.fillStyle = '#ffe9c9';
    ctx.font = `26px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(sign, 128, 84);
    // painted bulb dots along the awning edge
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = ['#ffd23f', '#ff5d73', '#2ee6d0'][i % 3];
      ctx.beginPath(); ctx.arc(24 + i * 26, 100, 3.4, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  #buildStalls() {
    // stalls ring the whole tent so EVERY window looks out at something lit:
    // the main arc flanks the path to the wheel, smaller clusters cover the
    // sides and the back (where the carousel and high striker live)
    const defs = [
      { off: -1.05, d: 21, sign: 'POPCORN', a: '#4a2030', b: '#3a3040' },
      { off: -0.72, d: 21, sign: 'HOT DOGS', a: '#403022', b: '#332638' },
      { off: -0.4, d: 21, sign: 'PRIZES', a: '#30203c', b: '#402a2a' },
      { off: 0.4, d: 21, sign: 'LEMONADE', a: '#3c3220', b: '#2c2c3c' },
      { off: 0.74, d: 21, sign: 'CANDY FLOSS', a: '#44202c', b: '#343044' },
      { off: 1.08, d: 21, sign: 'SHOOTING GALLERY', a: '#28303c', b: '#403024' },
      { off: 1.72, d: 21.5, sign: 'PRETZELS', a: '#3c2c20', b: '#2c3038' },
      { off: 2.3, d: 20, sign: 'DUCK POND', a: '#20303c', b: '#3c2c30' },
      { off: 2.72, d: 21.5, sign: 'ICE CREAM', a: '#38202e', b: '#2c3434' },
      { off: 3.42, d: 21, sign: 'FUNNEL CAKE', a: '#403024', b: '#302840' },
      { off: -2.42, d: 21, sign: 'BALLOONS', a: '#34203c', b: '#3c3028' },
      { off: -1.55, d: 22, sign: 'CORN DOGS', a: '#2c3040', b: '#402424' },
    ];
    this._bigGlows ??= [];
    this._stringBulbs = [];               // { p, base }
    const stallTops = [];
    for (const d of defs) {
      const a = OUT + d.off;
      const p = radial(a, d.d);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 3.4),
        new THREE.MeshBasicMaterial({
          map: this.#stallTexture(d.sign, d.a, d.b),
          transparent: true, alphaTest: 0.5, fog: false, side: THREE.DoubleSide,
        }),
      );
      mesh.position.set(p.x, 1.7, p.z);
      mesh.rotation.y = -a;                // face the tent
      this.group.add(mesh);
      // warm pool of light at each counter
      this._bigGlows.push({ p: radial(a, d.d - 0.3, 1.5), color: 0xffb35c, size: 1 });
      stallTops.push(radial(a, d.d - 0.2, 3.1));
    }
    // string lights swagged between neighbouring stall tops
    for (let s = 0; s < stallTops.length - 1; s++) {
      const A = stallTops[s], B = stallTops[s + 1];
      if (B.distanceTo(A) > 9.5) continue;   // don't span the big gaps
      for (let i = 1; i < 10; i++) {
        const t = i / 10;
        const p = A.clone().lerp(B, t);
        p.y -= Math.sin(t * Math.PI) * 0.7;
        this._stringBulbs.push({
          p, base: new THREE.Color(CARNIVAL_PALETTE[(s * 3 + i) % CARNIVAL_PALETTE.length]),
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
  }

  /* -------------------------------------------------------- carousel ---- */

  #buildCarousel() {
    // small merry-go-round on the far side of the tent — back windows get
    // their own centrepiece. A striped cone roof over a platform, with a
    // rotating ring of bulbs and poles.
    const A = OUT + 3.05, D = 20;
    const root = new THREE.Group();
    root.position.copy(radial(A, D));
    this.group.add(root);
    const dark = new THREE.MeshBasicMaterial({ color: STRUCTURE_COLOR });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.3, 14), dark);
    platform.position.y = 0.3;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.4, 8), dark);
    pole.position.y = 1.9;
    const roofTex = this.#stripedRoofTexture('#5a2034', '#3c3448');
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(3.1, 1.5, 12),
      new THREE.MeshBasicMaterial({ map: roofTex, fog: false }),
    );
    roof.position.y = 4.1;
    root.add(platform, pole, roof);

    // rotating rotor: 6 pony poles + a ring of bulbs under the eave
    this.carouselRotor = new THREE.Group();
    const poleGeos = [];
    const _m = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const gp = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 5);
      gp.applyMatrix4(_m.makeTranslation(Math.cos(a) * 2.0, 1.9, Math.sin(a) * 2.0));
      poleGeos.push(gp);
      // pony blob on each pole
      const pony = new THREE.SphereGeometry(0.22, 6, 5);
      pony.applyMatrix4(_m.makeScale(1.5, 0.9, 0.7));
      pony.applyMatrix4(_m.makeTranslation(Math.cos(a) * 2.0, 1.35 + (i % 2) * 0.35, Math.sin(a) * 2.0));
      poleGeos.push(pony);
    }
    this.carouselRotor.add(new THREE.Mesh(mergeGeometries(poleGeos), dark));
    const bulbPos = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      bulbPos.push(new THREE.Vector3(Math.cos(a) * 2.9, 3.45, Math.sin(a) * 2.9));
    }
    this.carouselGlow = makeGlowPoints(bulbPos, { size: 0.7, opacity: 0.7 });
    this.carouselGlow.points.material.fog = false;
    this._carouselBulbBase = bulbPos.map((_, i) =>
      new THREE.Color(CARNIVAL_PALETTE[i % CARNIVAL_PALETTE.length]));
    this.carouselRotor.add(this.carouselGlow.points);
    root.add(this.carouselRotor);
    // warm heart of the carousel
    this._bigGlows.push({ p: radial(A, D, 1.6), color: 0xffc07a, size: 1.2 });
  }

  /** dim striped cone-roof canvas for distant attractions */
  #stripedRoofTexture(colA, colB) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 32;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? colA : colB;
      ctx.fillRect(i * 16, 0, 16, 32);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* ---------------------------------------------------- high striker ---- */

  #buildHighStriker() {
    // the classic strength-tester tower: every few seconds somebody out
    // there takes a swing and a light races up toward the bell
    const A = OUT - 1.9, D = 19;
    const base = radial(A, D);
    const tower = new THREE.BoxGeometry(0.3, 6.4, 0.3);
    tower.translate(base.x, 3.2, base.z);
    this._structures.push(tower);
    const bell = new THREE.SphereGeometry(0.28, 8, 6);
    bell.translate(base.x, 6.6, base.z);
    this._structures.push(bell);

    this.strikerLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false, fog: false }),
    );
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffd23f, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    }));
    halo.scale.setScalar(1.1);
    this.strikerLight.add(halo);
    this.strikerLight.position.set(base.x, 0.5, base.z);
    this.group.add(this.strikerLight);
    this._strikerBase = base;
    this._strikerT = -2;      // <0 = waiting; 0..1 = riding up
    this._strikerWins = false;
  }

  /* ------------------------------------------------------------ path ---- */

  #buildPath() {
    // trampled boardwalk from the doorway out toward the wheel
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#191410';
    ctx.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 16) {     // plank seams
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, y, 64, 2);
      ctx.fillStyle = 'rgba(255,220,160,0.05)';
      ctx.fillRect(0, y + 2, 64, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 18),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9 }),
    );
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = -OUT;
    const mid = radial(OUT, 17.5);
    path.position.set(mid.x, 0.005, mid.z);
    this.group.add(path);

    // rope barrier just outside the door — you can look, not leave
    const post = (a, d) => {
      const p = radial(a, d);
      const geo = new THREE.CylinderGeometry(0.035, 0.045, 1.05, 6);
      geo.translate(p.x, 0.52, p.z);
      this._structures.push(geo);
      return new THREE.Vector3(p.x, 0.95, p.z);
    };
    const L = post(OUT - 0.115, 10.4), Rr = post(OUT + 0.115, 10.4);
    const ropeCurve = new THREE.QuadraticBezierCurve3(
      L, L.clone().lerp(Rr, 0.5).setY(0.72), Rr);
    this._structures.push(new THREE.TubeGeometry(ropeCurve, 8, 0.02, 5));

    // lantern posts leading down the path
    for (const d of [12.5, 15.5, 18.5]) {
      for (const side of [-0.09, 0.09]) {
        const p = radial(OUT + side, d + (side > 0 ? 0.4 : 0));
        const geo = new THREE.CylinderGeometry(0.04, 0.05, 2.6, 6);
        geo.translate(p.x, 1.3, p.z);
        this._structures.push(geo);
        this._bigGlows.push({ p: new THREE.Vector3(p.x, 2.7, p.z), color: 0xffc978, size: 0.7 });
      }
    }

    // ticket booth silhouette beside the path, its window lit
    const bc = document.createElement('canvas');
    bc.width = 128; bc.height = 192;
    const bctx = bc.getContext('2d');
    bctx.clearRect(0, 0, 128, 192);
    bctx.fillStyle = '#1a1526';
    bctx.fillRect(20, 40, 88, 152);
    bctx.beginPath();                        // onion-dome cap
    bctx.moveTo(12, 44); bctx.quadraticCurveTo(64, -14, 116, 44);
    bctx.closePath(); bctx.fill();
    const bw = bctx.createLinearGradient(0, 84, 0, 150);
    bw.addColorStop(0, '#ffd27a'); bw.addColorStop(1, '#cf7030');
    bctx.fillStyle = bw;
    bctx.fillRect(38, 84, 52, 66);
    bctx.fillStyle = '#1a1526';
    bctx.beginPath(); bctx.arc(64, 128, 11, 0, Math.PI * 2); bctx.fill();
    bctx.fillRect(52, 138, 24, 14);
    bctx.fillStyle = '#ffe9c9';
    bctx.font = `20px ${DISPLAY_FONT}`;
    bctx.textAlign = 'center';
    bctx.fillText('TICKETS', 64, 70);
    const btex = new THREE.CanvasTexture(bc);
    btex.colorSpace = THREE.SRGBColorSpace;
    const booth = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 2.55),
      new THREE.MeshBasicMaterial({
        map: btex, transparent: true, alphaTest: 0.5, fog: false, side: THREE.DoubleSide,
      }),
    );
    const bp = radial(OUT - 0.28, 12.4);
    booth.position.set(bp.x, 1.27, bp.z);
    booth.rotation.y = -(OUT - 0.28);
    this.group.add(booth);
    this._bigGlows.push({ p: new THREE.Vector3(bp.x, 1.3, bp.z), color: 0xffb35c, size: 0.8 });
  }

  /* ----------------------------------------------------------- crowd ---- */

  #buildCrowd() {
    const _m = new THREE.Matrix4();
    const bodyGeo = new THREE.CapsuleGeometry(0.16, 0.62, 3, 8);
    bodyGeo.applyMatrix4(_m.makeTranslation(0, 0.92, 0));
    const headGeo = new THREE.SphereGeometry(0.11, 8, 6);
    headGeo.applyMatrix4(_m.makeTranslation(0, 1.52, 0));
    this.crowd = new THREE.InstancedMesh(
      mergeGeometries([bodyGeo, headGeo]),
      new THREE.MeshBasicMaterial({ color: 0x07080e }),
      22,
    );
    this.group.add(this.crowd);

    this._walkers = [];
    for (let i = 0; i < 22; i++) {
      const onPath = i < 4;
      const scale = i % 5 === 4 ? 0.62 : 0.85 + Math.random() * 0.25; // some kids
      if (onPath) {
        this._walkers.push({
          from: radial(OUT + (Math.random() - 0.5) * 0.1, 11.5),
          to: radial(OUT + (Math.random() - 0.5) * 0.1, 19.5),
          speed: 0.03 + Math.random() * 0.04, phase: Math.random(), scale,
        });
      } else {
        // stroll a stretch of the midway loop — anywhere around the ring,
        // weighted toward the main stall arc by the wheel
        const centre = i < 12
          ? OUT + (Math.random() - 0.5) * 2.2
          : Math.random() * Math.PI * 2;
        const a0 = centre - 0.15 - Math.random() * 0.3;
        const a1 = centre + 0.15 + Math.random() * 0.3;
        const d = 19.2 + Math.random() * 1.8;
        this._walkers.push({
          arc: [a0, a1], d,
          speed: Math.random() < 0.2 ? 0 : 0.02 + Math.random() * 0.035,
          phase: Math.random(), scale,
        });
      }
    }
  }

  /* ---------------------------------------------------- searchlights ---- */

  #buildSearchlights() {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(210,225,255,0)');      // top of cone (wide end)
    grad.addColorStop(1, 'rgba(210,225,255,0.7)');    // base (apex)
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._beams = [];
    for (const [off, tilt, speed] of [[-0.55, 0.32, 0.11], [0.62, 0.36, -0.085]]) {
      const pivot = new THREE.Group();
      const p = radial(OUT + off, 25);
      pivot.position.set(p.x, 0, p.z);
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, 26, 12, 1, true),
        new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false,
          fog: false, toneMapped: false,
        }),
      );
      beam.position.y = 13;                // apex at the ground
      beam.rotation.z = tilt;
      pivot.add(beam);
      this.group.add(pivot);
      this._beams.push({ pivot, speed, phase: Math.random() * Math.PI * 2 });
    }
  }

  /* ------------------------------------------------------- fireworks ---- */

  #buildFireworks() {
    const BURSTS = 3, PER = 60;
    this._bursts = [];
    const total = BURSTS * PER;
    const pos = new Float32Array(total * 3).fill(-100);
    const col = new Float32Array(total * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.fireworks = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.5, map: glowTexture(), vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      toneMapped: false, sizeAttenuation: true,
    }));
    this.fireworks.frustumCulled = false;
    this.group.add(this.fireworks);
    for (let b = 0; b < BURSTS; b++) {
      this._bursts.push({
        state: 'idle', t: 0, offset: b * PER, n: PER,
        origin: new THREE.Vector3(), launch: new THREE.Vector3(),
        vel: new Float32Array(PER * 3), color: new THREE.Color(), dur: 1.8,
      });
    }
    this._nextLaunch = 2.5 + Math.random() * 3;
  }

  #launchFirework() {
    const burst = this._bursts.find((b) => b.state === 'idle');
    if (!burst) return;
    const a = OUT + (Math.random() - 0.5) * 1.3;
    const d = 30 + Math.random() * 10;
    burst.origin.copy(radial(a, d, 13 + Math.random() * 9));
    burst.launch.copy(radial(a, d, 0.5));
    burst.color.setHex(CARNIVAL_PALETTE[(Math.random() * CARNIVAL_PALETTE.length) | 0]);
    burst.state = 'rising';
    burst.t = 0;
    burst.riseDur = 1.0 + Math.random() * 0.4;
    for (let i = 0; i < burst.n; i++) {
      // random directions on a sphere, speed spread for a full blossom
      const u = Math.random() * 2 - 1;
      const ph = Math.random() * Math.PI * 2;
      const s = 3.2 + Math.random() * 3.4;
      const rxy = Math.sqrt(1 - u * u);
      burst.vel[i * 3] = rxy * Math.cos(ph) * s;
      burst.vel[i * 3 + 1] = u * s;
      burst.vel[i * 3 + 2] = rxy * Math.sin(ph) * s;
    }
  }

  #updateFireworks(dt, t) {
    this._nextLaunch -= dt;
    if (this._nextLaunch <= 0) {
      this.#launchFirework();
      this._nextLaunch = 4 + Math.random() * 7;
      if (Math.random() < 0.25) this._nextLaunch = 0.35; // occasional double
    }
    const posA = this.fireworks.geometry.getAttribute('position');
    const colA = this.fireworks.geometry.getAttribute('color');
    const _p = new THREE.Vector3();
    for (const b of this._bursts) {
      if (b.state === 'idle') continue;
      b.t += dt;
      if (b.state === 'rising') {
        // one bright comet climbing to the burst point
        const k = Math.min(1, b.t / b.riseDur);
        _p.lerpVectors(b.launch, b.origin, k * (2 - k));
        posA.setXYZ(b.offset, _p.x, _p.y, _p.z);
        colA.setXYZ(b.offset, 1.4, 1.2, 0.9);
        if (k >= 1) {
          b.state = 'burst';
          b.t = 0;
          // the boom arrives late, like it should from 30m away
          const dist = this.world.camera.getWorldPosition(_p).distanceTo(b.origin);
          const at = b.origin.clone();
          setTimeout(() => this.audio.play('mittThudSoft', {
            at, volume: 1.1, rate: 0.42, jitter: 0.1, refDistance: 9, rolloff: 1,
          }), (dist / 340) * 1000);
        }
      } else {
        const k = b.t / b.dur;
        if (k >= 1) {
          b.state = 'idle';
          for (let i = 0; i < b.n; i++) posA.setXYZ(b.offset + i, 0, -100, 0);
        } else {
          const fade = (1 - k) * (1 - k);
          for (let i = 0; i < b.n; i++) {
            const j = b.offset + i;
            posA.setXYZ(j,
              b.origin.x + b.vel[i * 3] * b.t,
              b.origin.y + b.vel[i * 3 + 1] * b.t + 0.5 * g * b.t * b.t,
              b.origin.z + b.vel[i * 3 + 2] * b.t);
            const spark = i % 7 === 0 ? 1.6 : 1;   // a few white-hot sparkles
            colA.setXYZ(j, b.color.r * fade * spark, b.color.g * fade * spark,
              b.color.b * fade * spark);
          }
        }
      }
    }
    posA.needsUpdate = true;
    colA.needsUpdate = true;
  }

  /* ------------------------------------------------------- assembly ---- */

  #commitStructures() {
    // rope posts, lantern poles etc — one dark mesh
    if (this._structures.length) {
      this.group.add(new THREE.Mesh(
        mergeGeometries(this._structures),
        new THREE.MeshBasicMaterial({ color: 0x1c1a22 }),
      ));
      this._structures = [];
    }
    // warm glow pools (stall counters, lanterns, ticket window, wheel hub)
    const big = makeGlowPoints(this._bigGlows.map((o) => o.p), { size: 2.2, opacity: 0.4 });
    big.points.material.fog = false;
    const c = new THREE.Color();
    this._bigGlows.forEach((o, i) => big.setColor(i, c.setHex(o.color).multiplyScalar(o.size)));
    big.commit();
    this.group.add(big.points);
    // tiny string-light bulbs, twinkled per frame
    this.stringGlow = makeGlowPoints(this._stringBulbs.map((o) => o.p), { size: 0.55, opacity: 0.8 });
    this.stringGlow.points.material.fog = false;
    this.group.add(this.stringGlow.points);
  }

  /* ---------------------------------------------------------- update ---- */

  #update(dt, t) {
    // wheel turns at ~0.8 rpm; gondolas stay upright with a hint of sway
    this._wheelAngle += dt * 0.085;
    this.wheelSpin.rotation.z = this._wheelAngle;
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(1, 1, 1);
    const _p = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      const a = this._wheelAngle + (i / 12) * Math.PI * 2;
      _p.set(Math.cos(a) * this._wheelRadius, Math.sin(a) * this._wheelRadius, 0.0);
      _q.setFromAxisAngle(_v_Z, Math.sin(t * 1.1 + i * 1.7) * 0.05);
      _m.compose(_p, _q, _s);
      this.gondolas.setMatrixAt(i, _m);
    }
    this.gondolas.instanceMatrix.needsUpdate = true;

    // rim bulb chase
    const c = new THREE.Color();
    const step = Math.floor(t * 5);
    for (let i = 0; i < this.wheelBulbs.count; i++) {
      c.setHex(CARNIVAL_PALETTE[(i + step) % CARNIVAL_PALETTE.length]);
      const lit = (i + step) % 3 === 0 ? 1.25 : 0.55;
      c.multiplyScalar(lit);
      this.wheelBulbs.setColorAt(i, c);
      this.wheelGlow.setColor(i, c);
    }
    this.wheelBulbs.instanceColor.needsUpdate = true;
    this.wheelGlow.commit();

    // string-light twinkle
    for (let i = 0; i < this._stringBulbs.length; i++) {
      const b = this._stringBulbs[i];
      c.copy(b.base).multiplyScalar(0.65 + 0.35 * Math.sin(t * 2.1 + b.phase));
      this.stringGlow.setColor(i, c);
    }
    this.stringGlow.commit();

    // crowd strolling
    for (let i = 0; i < this._walkers.length; i++) {
      const w = this._walkers[i];
      const cyc = w.speed === 0 ? 0.5 : (t * w.speed + w.phase) % 2;
      const k = cyc < 1 ? cyc : 2 - cyc;   // ping-pong
      if (w.arc) {
        const a = w.arc[0] + (w.arc[1] - w.arc[0]) * k;
        _p.copy(radial(a, w.d));
      } else {
        _p.lerpVectors(w.from, w.to, k);
      }
      const bob = w.speed === 0
        ? Math.sin(t * 1.2 + i) * 0.015
        : Math.abs(Math.sin(t * 2.4 + i * 2.1)) * 0.04;
      _p.y = bob;
      _q.setFromAxisAngle(_v_Y, Math.atan2(_p.x, _p.z) + (cyc < 1 ? 0 : Math.PI));
      _s.setScalar(w.scale);
      _m.compose(_p, _q, _s);
      this.crowd.setMatrixAt(i, _m);
      _s.set(1, 1, 1);
    }
    this.crowd.instanceMatrix.needsUpdate = true;

    // searchlights sweep
    for (const b of this._beams) {
      b.pivot.rotation.y = b.phase + t * b.speed * Math.PI * 2 * 0.16;
    }

    // carousel turns; its bulbs shimmer
    this.carouselRotor.rotation.y = t * 0.4;
    for (let i = 0; i < this._carouselBulbBase.length; i++) {
      c.copy(this._carouselBulbBase[i])
        .multiplyScalar(0.7 + 0.3 * Math.sin(t * 3 + i * 1.9));
      this.carouselGlow.setColor(i, c);
    }
    this.carouselGlow.commit();

    // high striker: pause … WHACK — the light races up, sometimes rings out
    this._strikerT += dt * (this._strikerT < 0 ? 0.45 : 1.6);
    if (this._strikerT >= 1.4) {
      this._strikerT = -1 - Math.random() * 2;           // reset + wait
      this._strikerWins = Math.random() < 0.4;
      this._strikerPeak = this._strikerWins ? 1 : 0.4 + Math.random() * 0.3;
    }
    const st = THREE.MathUtils.clamp(this._strikerT, 0, 1);
    const height = (this._strikerPeak ?? 0.6) * st * (2 - st); // ease-out rise
    this.strikerLight.position.y = 0.5 + height * 5.9;
    const ringing = this._strikerWins && this._strikerT > 0.95;
    this.strikerLight.material.color.setHex(ringing ? 0xffffff : 0xffd23f);
    this.strikerLight.scale.setScalar(ringing ? 1.8 : 1);

    this.#updateFireworks(dt, t);
  }
}

const _v_Z = new THREE.Vector3(0, 0, 1);
const _v_Y = new THREE.Vector3(0, 1, 0);

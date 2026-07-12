import * as THREE from 'three';

/**
 * ShootingGalleryAudio — the tin-and-cork voice of the shooting gallery.
 *
 * Nothing here sounds like a firearm: these are boardwalk gallery guns.
 * A shot is a cork-gun POP (a burst of band-limited noise with a low
 * pneumatic thump under it), a hit is the iconic metal-target TING — a
 * handful of inharmonic partials rings out and every target keeps its own
 * pitch, same trick as the ring toss bottles — and the celebrations are a
 * toy monkey crashing two little brass cymbals together.
 *
 * Everything is synthesized on the WebAudio clock through a small pool of
 * positional panners (RingTossAudio's pattern), so rapid fanning the
 * hammer or the prize wheel's peg clatter stays sample-accurate even when
 * frames hitch. The couple of woody thumps (a shot burying itself in the
 * painted backdrop, a target plate slapping down) layer the repo's real
 * recorded Kenney knocks underneath for body.
 */

const POOL_SIZE = 10;
const REF_DIST = 2.6;
const ROLLOFF = 1.3;

/** deterministic per-seed PRNG so target #7 tings the same all night */
function prng(seed) {
  let a = (seed * 0x9E3779B9 + 0x6D2B79F5) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ShootingGalleryAudio {
  /**
   * @param {import('../core/AudioManager.js').AudioManager} audio
   * @param {THREE.Scene} scene panners are parked at scene root
   */
  constructor(audio, scene) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.scene = scene;
    this._slots = null;
    this._noiseBuf = null;
    this._voices = new Map(); // target seed -> tin-plate voicing
  }

  /* ------------------------------------------------------ infrastructure */

  #ensure() {
    if (this._slots) return;
    this._slots = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const input = this.ctx.createGain();
      const pa = new THREE.PositionalAudio(this.audio.listener);
      pa.setNodeSource(input);
      pa.setRefDistance(REF_DIST);
      pa.setRolloffFactor(ROLLOFF);
      this.scene.add(pa);
      this._slots.push({ pa, input, freeAt: 0 });
    }
  }

  #noise() {
    if (!this._noiseBuf) {
      const len = (this.ctx.sampleRate * 0.4) | 0;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this._noiseBuf;
  }

  #slot(at, holdFor) {
    this.#ensure();
    const now = this.ctx.currentTime;
    let best = this._slots[0];
    for (const s of this._slots) if (s.freeAt < best.freeAt) best = s;
    best.freeAt = now + holdFor;
    best.pa.position.copy(at);
    return best.input;
  }

  /**
   * A tin target plate's modal identity: fundamental in the bright
   * 2–3.2kHz "struck sheet metal" band, stretched inharmonic partials,
   * longer ring than the bottles — the TING that carries across a fair.
   */
  #voice(seed) {
    let v = this._voices.get(seed);
    if (v) return v;
    const r = prng(seed);
    const f0 = 1950 + r() * 1250;
    v = {
      f: [f0, f0 * (2.05 + r() * 0.35), f0 * (3.2 + r() * 0.6), f0 * (4.4 + r() * 0.9)],
      t: [0.34 + r() * 0.18, 0.2 + r() * 0.08, 0.12 + r() * 0.05, 0.07 + r() * 0.03],
      a: [1, 0.5 + r() * 0.2, 0.3 + r() * 0.14, 0.18 + r() * 0.1],
    };
    this._voices.set(seed, v);
    return v;
  }

  /* ------------------------------------------------- synthesis primitives */

  #partial(ctx, out, t0, freq, amp, decay, glideTo = 0) {
    if (amp < 0.004 || freq > ctx.sampleRate * 0.45) return;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq * (1 + (Math.random() - 0.5) * 0.004), t0);
    if (glideTo > 0) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(amp, t0 + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.008, decay));
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + decay + 0.03);
  }

  #burst(ctx, out, t0, fc, q, amp, decay) {
    if (amp < 0.004) return;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fc;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(amp, t0 + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.006, decay));
    src.connect(bp).connect(g).connect(out);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + decay + 0.03);
  }

  /* ------------------------------------------------------------ the gun */

  /** Cork-gun POP: a snappy crack over a short pneumatic thump. */
  gunshot(at) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.25);
    const t0 = this.ctx.currentTime + 0.002;
    this.#burst(this.ctx, input, t0, 1500 + Math.random() * 400, 0.7, 0.95, 0.022);
    this.#burst(this.ctx, input, t0, 4800, 1.1, 0.5, 0.009);        // mechanism snap
    this.#burst(this.ctx, input, t0 + 0.004, 330, 0.5, 0.75, 0.07); // air thump
    this.#partial(this.ctx, input, t0 + 0.002, 820 + Math.random() * 160, 0.14, 0.04);
  }

  /* ---------------------------------------------------------- sideshow */

  /**
   * The prize wheel's flapper clacking over a peg. Pitch rises a touch
   * with the wheel's speed so a hard spin sounds frantic, then lazy.
   */
  wheelTick(at, speed = 1) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.06);
    const t0 = this.ctx.currentTime + 0.002;
    this.#burst(this.ctx, input, t0, 2500 + speed * 500, 1.2, 0.3, 0.006);
    this.#burst(this.ctx, input, t0 + 0.003, 1050, 0.8, 0.16, 0.008);
  }

  /** The wheel settling on a wedge: a rising little payout fanfare. */
  wheelWin(at, jackpot = false) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.8);
    let t = this.ctx.currentTime + 0.02;
    const steps = jackpot ? [880, 1100, 1320, 1760] : [880, 1100, 1320];
    for (const f of steps) {
      this.#partial(this.ctx, input, t, f, 0.3, 0.22);
      this.#partial(this.ctx, input, t, f * 2.02, 0.12, 0.14);
      t += 0.09;
    }
    if (jackpot) this.#burst(this.ctx, input, t, 5200, 0.5, 0.35, 0.2);
  }

  /**
   * The WILD CLOWN going off: a slide-whistle swoop up, a rude two-note
   * squeeze-horn HONK, and a sprinkle of sparkle on top. Pure circus.
   */
  clownWhoop(at) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 1.0);
    const t0 = this.ctx.currentTime + 0.002;
    // slide whistle swooping up
    this.#partial(this.ctx, input, t0, 520, 0.3, 0.3, 1250);
    this.#partial(this.ctx, input, t0, 1040, 0.1, 0.3, 2500);
    // squeeze-horn honk (two blasts, slightly flat the second time)
    for (const [dt, det] of [[0.34, 1], [0.5, 0.94]]) {
      this.#burst(this.ctx, input, t0 + dt, 340 * det, 2.4, 0.4, 0.12);
      this.#partial(this.ctx, input, t0 + dt, 289 * det, 0.3, 0.14);
      this.#partial(this.ctx, input, t0 + dt, 434 * det, 0.2, 0.12);
      this.#partial(this.ctx, input, t0 + dt, 578 * det, 0.1, 0.1);
    }
    // sparkle on top
    this.#partial(this.ctx, input, t0 + 0.66, 2093, 0.12, 0.25);
    this.#partial(this.ctx, input, t0 + 0.74, 2637, 0.1, 0.3);
  }

  /** The counter bell: a bright long brass DING that carries. */
  bellDing(at) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 1.3);
    const t0 = this.ctx.currentTime + 0.002;
    this.#burst(this.ctx, input, t0, 3000, 0.8, 0.4, 0.008); // strike
    for (const [f, a, d] of [[590, 0.22, 1.0], [1180, 0.55, 0.85],
      [1585, 0.3, 0.5], [2360, 0.2, 0.32], [3540, 0.1, 0.18]]) {
      this.#partial(this.ctx, input, t0, f * (1 + (Math.random() - 0.5) * 0.006), a, d);
    }
  }

  /* --------------------------------------------------------- the targets */

  /**
   * A BB smacking a tin silhouette: the fairground TING. Each target seed
   * keeps its own pitch; `solid` (0..1) grades level and ring length.
   */
  targetTing(at, seed, solid = 1) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.6);
    const t0 = this.ctx.currentTime + 0.002;
    const v = this.#voice(seed);
    const g0 = 0.3 + 0.55 * solid;
    let b = 1;
    for (let k = 0; k < v.f.length; k++) {
      this.#partial(this.ctx, input, t0, v.f[k], v.a[k] * g0 * b, v.t[k] * (0.7 + 0.5 * solid));
      b *= 0.95;
    }
    // impact click before the plate starts singing
    this.#burst(this.ctx, input, t0, 3400, 0.9, 0.65 * g0, 0.006);
  }

  /** The hinged plate slapping backwards onto its stop. */
  plateFlip(at) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.2);
    const t0 = this.ctx.currentTime + 0.03; // the fall takes a beat
    this.#burst(this.ctx, input, t0, 900, 0.8, 0.4, 0.02);
    this.#partial(this.ctx, input, t0, 1300 + Math.random() * 200, 0.18, 0.06);
    this.audio.play('knock', { at, volume: 0.35, rate: 1.3, jitter: 0.12, refDistance: 2.4 });
  }

  /** A plate creaking back upright during the reset show. */
  plateRise(at) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.15);
    const t0 = this.ctx.currentTime + 0.002;
    this.#burst(this.ctx, input, t0, 2100, 1.2, 0.16, 0.006);
    this.#burst(this.ctx, input, t0 + 0.12, 1500, 0.9, 0.28, 0.012);
  }

  /** A miss thudding into the painted backdrop boards. */
  boardThunk(at) {
    if (this.ctx.state !== 'running') return;
    this.audio.play('knock', { at, volume: 0.4, rate: 0.85, jitter: 0.15, refDistance: 2.6 });
    const input = this.#slot(at, 0.1);
    this.#burst(this.ctx, input, this.ctx.currentTime + 0.002, 420, 0.6, 0.35, 0.03);
  }

  /* ----------------------------------------------------------- the monkey */

  /**
   * One cymbal crash from the toy monkey: bright noise sizzle + a spread
   * of clangy inharmonic partials. `big` crashes ring longer and louder.
   */
  cymbal(at, big = false) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.9);
    const t0 = this.ctx.currentTime + 0.002;
    const amp = big ? 0.75 : 0.55;
    const ring = big ? 1.25 : 1;
    this.#burst(this.ctx, input, t0, 5400, 0.4, amp, 0.16 * ring);
    this.#burst(this.ctx, input, t0, 8200, 0.6, amp * 0.6, 0.09 * ring);
    this.#burst(this.ctx, input, t0 + 0.01, 3600, 0.5, amp * 0.5, 0.28 * ring);
    for (const [f, a, d] of [[3130, 0.2, 0.4], [4890, 0.16, 0.3], [6510, 0.12, 0.22], [2210, 0.1, 0.34]]) {
      this.#partial(this.ctx, input, t0, f * (1 + (Math.random() - 0.5) * 0.02), a * amp, d * ring);
    }
  }

  /** The monkey's indignant "ee-ee!" when someone shoots HIM. */
  monkeySqueak(at) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.5);
    let t = this.ctx.currentTime + 0.002;
    for (let i = 0; i < 2; i++) {
      // squeaky downward chirp — two partials gliding together
      this.#partial(this.ctx, input, t, 2900 + Math.random() * 200, 0.3, 0.1, 2100);
      this.#partial(this.ctx, input, t + 0.004, 4300, 0.12, 0.08, 3200);
      t += 0.16;
    }
  }

  /* -------------------------------------------------------------- tests */

  /**
   * Tuning/test seam: render one synthesized voice into an arbitrary
   * context (OfflineAudioContext included) for numeric verification.
   */
  synthInto(ctx, dest, t0, kind, { seed = 0, solid = 1 } = {}) {
    if (kind === 'ting') {
      const v = this.#voice(seed);
      const g0 = 0.3 + 0.55 * solid;
      for (let k = 0; k < v.f.length; k++) {
        this.#partial(ctx, dest, t0, v.f[k], v.a[k] * g0, v.t[k]);
      }
    } else if (kind === 'shot') {
      this.#burst(ctx, dest, t0, 1600, 0.7, 0.95, 0.022);
      this.#burst(ctx, dest, t0 + 0.004, 330, 0.5, 0.75, 0.07);
    }
  }
}

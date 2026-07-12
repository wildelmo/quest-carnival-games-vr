import * as THREE from 'three';

/**
 * RingTossAudio — the plastic-on-glass voice of the ring toss booth.
 *
 * The real game has a sound you can pick out across a fairground: a hard
 * plastic ring skittering over a packed field of empty glass bottles.
 * Recorded one-shots alone can't do it justice, because the character
 * comes from three things no static sample bank has:
 *
 *  1. EVERY BOTTLE HAS ITS OWN PITCH. Tap two "identical" soda bottles
 *     and they tink at different notes. A ring hopping crown-to-crown
 *     plays a little atonal melody — that's the fingerprint of the game.
 *  2. TWO MATERIALS PER HIT. Each contact is a hard-plastic "clak" (the
 *     ring) fused with a glass "tink" (the bottle). Slow grazes are mostly
 *     plastic; hard slams ring the glass bright and long.
 *  3. RHYTHM. Rattles-down-the-neck, wobble ring-downs and skitters are
 *     rapid sequences (25–60ms gaps) that need sample-accurate WebAudio
 *     clock scheduling — frame-timed playback smears them into mush.
 *
 * So each contact is MODAL SYNTHESIS (a handful of exponentially decaying
 * inharmonic partials + a noise transient, per-bottle voicing derived from
 * a deterministic seed) layered, on the harder hits, over the repo's real
 * recorded Kenney glass impacts, which supply body and grit. Wood and
 * floor contacts stay pure recordings (plank knocks are hard to fake and
 * we ship good ones) with a synthesized plastic clak on top.
 *
 * All positional output runs through a small pool of PositionalAudio
 * panners (no per-hit allocations of panner graphs), and callers rate-limit
 * per-ring so a three-ring cascade never machine-guns the mix.
 */

const POOL_SIZE = 14;
const REF_DIST = 2.4;
const ROLLOFF = 1.35;

/** deterministic per-seed PRNG so bottle #117 tinks the same all night */
function prng(seed) {
  let a = (seed * 0x9E3779B9 + 0x6D2B79F5) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RingTossAudio {
  /**
   * @param {import('../core/AudioManager.js').AudioManager} audio
   * @param {THREE.Scene} scene panners are parked at scene root
   */
  constructor(audio, scene) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.scene = scene;
    this._slots = null;      // pooled positional panners, built on first hit
    this._noiseBuf = null;   // one shared white-noise buffer for every burst
    this._voices = new Map(); // bottle seed -> modal voicing
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

  /** Claim a pooled panner at a world position for `holdFor` seconds. */
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
   * Each bottle's modal identity: a fundamental somewhere in the 2–3.5kHz
   * "empty soda bottle" band plus inharmonic upper partials, deterministic
   * per seed. This is what makes the field sound like 324 individuals.
   */
  #voice(seed) {
    let v = this._voices.get(seed);
    if (v) return v;
    const r = prng(seed);
    const f0 = 2050 + r() * 1400;
    v = {
      f: [f0, f0 * (1.92 + r() * 0.3), f0 * (2.6 + r() * 0.5), f0 * (3.55 + r() * 0.8)],
      t: [0.11 + r() * 0.08, 0.07 + r() * 0.04, 0.05 + r() * 0.025, 0.035 + r() * 0.02],
      a: [1, 0.55 + r() * 0.2, 0.35 + r() * 0.15, 0.22 + r() * 0.12],
    };
    this._voices.set(seed, v);
    return v;
  }

  /* ------------------------------------------------- synthesis primitives */

  #partial(ctx, out, t0, freq, amp, decay) {
    if (amp < 0.004 || freq > ctx.sampleRate * 0.45) return;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.004);
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

  /** The bottle's half of a contact: strike transient + ringing modes. */
  #glassStrike(ctx, out, t0, voice, speed, damp) {
    const g0 = Math.min(0.85, 0.05 + speed * 0.2) * (1 - 0.45 * damp);
    if (g0 < 0.01) return;
    // harder hits excite the upper modes more (brightness follows velocity)
    const bright = Math.min(1.3, 0.6 + speed * 0.3) * (1 - 0.4 * damp);
    const tScale = (1 - 0.55 * damp) * (0.85 + Math.random() * 0.3);
    let b = 1;
    for (let k = 0; k < voice.f.length; k++) {
      this.#partial(ctx, out, t0, voice.f[k], voice.a[k] * g0 * b, voice.t[k] * tScale);
      b *= bright;
    }
    // contact click — the moment of impact before the glass starts singing
    this.#burst(ctx, out, t0, 2800 + Math.min(speed, 3) * 500, 0.9, 0.7 * g0, 0.005);
  }

  /** The ring's half: hard hollow plastic — a dead "clak", all attack. */
  #plasticStrike(ctx, out, t0, speed, damp = 0) {
    const g0 = Math.min(0.8, 0.1 + speed * 0.18) * (1 - 0.4 * damp);
    if (g0 < 0.01) return;
    this.#burst(ctx, out, t0, 1450 + Math.random() * 500, 1.3, g0, 0.011);
    this.#burst(ctx, out, t0, 620 + Math.random() * 150, 0.9, 0.55 * g0, 0.006);
    this.#partial(ctx, out, t0, 980 + Math.random() * 260, 0.3 * g0, 0.009);
  }

  /* ------------------------------------------------------- one-shot hits */

  /**
   * A ring contacting a bottle: plastic clak + that bottle's glass tink.
   * @param {THREE.Vector3} at world position
   * @param {number} seed bottle index (stable voicing)
   * @param {number} speed impact speed m/s (grades level + brightness)
   * @param {object} o { damp: 0 crown … ~0.6 buried in the shoulders,
   *                     shimmer: neighbour bottle seed to tap faintly (hard
   *                     hits shake the whole packed crate) }
   */
  glassClink(at, seed, speed, o = {}) {
    if (this.ctx.state !== 'running') return;
    const damp = o.damp ?? 0;
    const input = this.#slot(at, 0.4);
    const t0 = this.ctx.currentTime + 0.002;
    this.#plasticStrike(this.ctx, input, t0, speed * 0.8, damp * 0.5);
    this.#glassStrike(this.ctx, input, t0 + 0.0008, this.#voice(seed), speed, damp);
    if (o.shimmer !== undefined && o.shimmer >= 0) {
      this.#glassStrike(this.ctx, input, t0 + 0.006 + Math.random() * 0.006,
        this.#voice(o.shimmer), speed * 0.25, 0.55);
    }
    // hard slams get a quiet REAL glass recording underneath for body
    if (speed > 1.6) {
      this.audio.play('glassLight', {
        at, volume: Math.min(0.4, speed * 0.09), rate: 1.22, jitter: 0.1,
        refDistance: REF_DIST,
      });
    }
  }

  /** Plastic on plastic — a flying ring clipping one already on the field. */
  plasticClack(at, speed, damp = 0) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.15);
    const t0 = this.ctx.currentTime + 0.002;
    this.#plasticStrike(this.ctx, input, t0, speed, damp);
    if (speed > 1) this.#plasticStrike(this.ctx, input, t0 + 0.012, speed * 0.45, damp);
  }

  /** Ring rapping the stall woodwork / counter / crate rims. */
  woodKnock(at, speed) {
    if (this.ctx.state !== 'running') return;
    this.audio.play('knock', {
      at, volume: Math.min(0.55, 0.1 + speed * 0.13),
      rate: 1.1 + Math.min(speed * 0.06, 0.25), jitter: 0.12, refDistance: 2.2,
    });
    const input = this.#slot(at, 0.1);
    this.#plasticStrike(this.ctx, input, this.ctx.currentTime + 0.002, speed * 0.8, 0.15);
  }

  /** Ring slapping the tent floor — canvas over dirt eats most of it. */
  floorTap(at, speed) {
    if (this.ctx.state !== 'running') return;
    this.audio.play('tick', {
      at, volume: Math.min(0.22, 0.08 + speed * 0.06), rate: 0.8, jitter: 0.15,
    });
    const input = this.#slot(at, 0.1);
    this.#plasticStrike(this.ctx, input, this.ctx.currentTime + 0.002, speed * 0.6, 0.55);
  }

  /* ------------------------------------------------- scripted sequences */

  /**
   * RINGER: the ring drops over a crown, rattles down the neck (quickening
   * alternating taps), lands on the shoulder with the scoring chink, then
   * wobbles itself flat like a dropped coin. Scheduled up-front on the
   * audio clock so the rhythm is machine-tight even if frames hitch.
   * Timings mirror the mesh animation in RingTossGame (same constants).
   */
  ringerRattle(at, seed, { rattle, wobble, stacked }) {
    if (this.ctx.state !== 'running') return;
    const voice = this.#voice(seed);
    const input = this.#slot(at, rattle + wobble + 0.4);
    let t = this.ctx.currentTime + 0.004;
    const tLand = t + rattle;

    // down the neck: 3 quickening taps, plastic against muted glass
    let a = 0.55;
    for (const gap of [0.052, 0.04, 0.031]) {
      this.#plasticStrike(this.ctx, input, t, a, 0.35);
      this.#glassStrike(this.ctx, input, t + 0.001, voice, a * 0.9, 0.55);
      t += gap * (0.9 + Math.random() * 0.25);
      a *= 0.82;
    }

    // the landing chink on the glass shoulder — THE ringer sound
    if (stacked) {
      // second ring on this bottle lands on the first one: plastic on plastic
      this.#plasticStrike(this.ctx, input, tLand, 1.4);
      this.#plasticStrike(this.ctx, input, tLand + 0.014, 0.7);
    } else {
      this.#plasticStrike(this.ctx, input, tLand, 0.9, 0.1);
      this.#glassStrike(this.ctx, input, tLand + 0.001, voice, 1.5, 0.15);
      this.audio.play('glassLight', {
        at, volume: 0.55, rate: 1.1, jitter: 0.08, refDistance: 2.8,
      });
    }

    // wobble ring-down: accelerating, quieting flutter until it lies flat
    let tw = tLand + 0.05, gap = 0.062, aw = 0.42;
    while (tw < tLand + wobble && aw > 0.05) {
      this.#plasticStrike(this.ctx, input, tw, aw, 0.3);
      this.#glassStrike(this.ctx, input, tw + 0.0012, voice, aw * 0.8, 0.6);
      tw += gap;
      gap *= 0.8;
      aw *= 0.78;
    }
  }

  /**
   * Tilted ring coming to rest wedged between bottle shoulders: a quick
   * "cl-clink" against the two bottles it lands on, over a quiet real
   * glass-impact recording for body.
   */
  wedgeClink(at, seedA, seedB, speed = 1) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.3);
    const t0 = this.ctx.currentTime + 0.002;
    this.#plasticStrike(this.ctx, input, t0, speed * 0.7, 0.2);
    this.#glassStrike(this.ctx, input, t0 + 0.002, this.#voice(seedA), speed * 0.75, 0.35);
    this.#glassStrike(this.ctx, input, t0 + 0.02, this.#voice(seedB), speed * 0.55, 0.45);
    this.audio.play('glassMedium', {
      at, volume: 0.32, rate: 1.18, jitter: 0.08, refDistance: 2.5,
    });
  }

  /**
   * A ring falling flat on a surface and wobbling itself still — the
   * accelerating "clatatatat" of a dropped coaster. mat 'wood' for the
   * counter/table, 'glass' for a ring bridged across bottle crowns.
   * @param {number} dur seconds — matches the mesh wobble animation
   * @param {number} seed bottle voicing for mat 'glass' (ignored for wood)
   */
  settleWobble(at, dur, mat, seed = 0) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, dur + 0.2);
    let t = this.ctx.currentTime + 0.003;
    const tEnd = t + dur;
    let gap = Math.max(0.045, dur * 0.22), a = 0.5;
    if (mat === 'wood') {
      this.audio.play('tick', { at, volume: 0.18, rate: 1.25, jitter: 0.12 });
    }
    while (t < tEnd && a > 0.05) {
      this.#plasticStrike(this.ctx, input, t, a, mat === 'wood' ? 0.1 : 0.3);
      if (mat === 'glass') {
        this.#glassStrike(this.ctx, input, t + 0.001, this.#voice(seed), a * 0.7, 0.55);
      }
      t += gap;
      gap *= 0.78;
      a *= 0.8;
    }
  }

  /** The attendant's sweep dropping a ring back into the galvanised pail. */
  bucketDrop(at) {
    if (this.ctx.state !== 'running') return;
    const input = this.#slot(at, 0.2);
    const t0 = this.ctx.currentTime + 0.002;
    this.#plasticStrike(this.ctx, input, t0, 1.1);
    this.#partial(this.ctx, input, t0, 520 + Math.random() * 90, 0.22, 0.055);
    this.#plasticStrike(this.ctx, input, t0 + 0.03, 0.5);
    this.audio.play('tick', { at, volume: 0.28, rate: 0.82, jitter: 0.1 });
  }

  /* -------------------------------------------------------------- tests */

  /**
   * Tuning/test seam: render one synthesized contact into an arbitrary
   * context (OfflineAudioContext included) so its spectrum and envelope can
   * be measured numerically — headless checks assert the "struck glass"
   * signature (fast attack, inharmonic 2–6kHz partials, sub-second decay).
   */
  synthInto(ctx, dest, t0, kind, { seed = 0, speed = 1, damp = 0 } = {}) {
    if (kind === 'glass') {
      this.#glassStrike(ctx, dest, t0, this.#voice(seed), speed, damp);
    } else {
      this.#plasticStrike(ctx, dest, t0, speed, damp);
    }
  }
}

import * as THREE from 'three';

/**
 * BallTossAudio — the dead "THUNK" voice of Down the Clown.
 *
 * The target sound: a small sandbag hitting a cloth-wrapped wooden doll.
 * That's three things happening in the same 100ms, and no single recording
 * in the repo carries all of them:
 *
 *  1. BODY — a low, pitch-dropping thump (the doll's wooden core taking
 *     the momentum and rocking on its hinge). Synthesized: a sine that
 *     starts around 100Hz and sags as it decays, louder and slightly
 *     deeper the harder the hit.
 *  2. CLOTH — a short band-limited noise "whump" (canvas skin and
 *     stuffing compressing). Synthesized: filtered noise burst around
 *     300Hz, all attack, no ring.
 *  3. GRIT — the recorded Kenney punch impacts the repo already ships
 *     (mittThud), pitched DOWN so they read heavy rather than snappy,
 *     plus a quiet low wood knock for the frame.
 *
 * The same low thump also underpins every other ball contact (floor,
 * shelves, walls) so a dead foam-and-sand ball never sounds like a ping
 * pong ball anywhere in the stall — surfaces differ only in how much
 * knock/tick sits on top.
 *
 * Positional output runs through a small pool of PositionalAudio panners
 * (same no-per-hit-allocation pattern as RingTossAudio).
 */

const POOL_SIZE = 6;
const REF_DIST = 2.8;
const ROLLOFF = 1.15;

export class BallTossAudio {
  /**
   * @param {import('../core/AudioManager.js').AudioManager} audio
   * @param {THREE.Scene} scene panners are parked at scene root
   */
  constructor(audio, scene) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.scene = scene;
    this._slots = null;    // pooled positional panners, built on first hit
    this._noiseBuf = null; // one shared white-noise buffer for every whump
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
      const len = (this.ctx.sampleRate * 0.3) | 0;
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

  /* ------------------------------------------------- synthesis primitives */

  /** The wooden core: a low sine whose pitch sags as it decays. */
  #thump(ctx, out, t0, f0, amp, decay) {
    if (amp < 0.005) return;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(f0 * (1 + (Math.random() - 0.5) * 0.08), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(38, f0 * 0.45), t0 + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(amp, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.02, decay));
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + decay + 0.05);
  }

  /** The cloth skin: a short band-limited noise burst, all attack. */
  #whump(ctx, out, t0, fc, amp, decay) {
    if (amp < 0.005) return;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fc;
    bp.Q.value = 0.75;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(amp, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.015, decay));
    src.connect(bp).connect(g).connect(out);
    src.start(t0, Math.random() * 0.2);
    src.stop(t0 + decay + 0.05);
  }

  /* ------------------------------------------------------- one-shot hits */

  /**
   * Solid knockdown: the full sandbag-on-doll THUNK.
   * @param {THREE.Vector3} at world position
   * @param {number} impact m/s into the doll (grades weight + brightness)
   */
  dollThunk(at, impact) {
    if (this.ctx.state !== 'running') return;
    const k = Math.min(1, impact / 6); // 0..1 hit weight
    const input = this.#slot(at, 0.3);
    const t0 = this.ctx.currentTime + 0.002;
    // wooden core: deeper and louder the harder the hit
    this.#thump(this.ctx, input, t0, 105 - 20 * k, 0.35 + 0.5 * k, 0.11 + 0.05 * k);
    // cloth skin compressing
    this.#whump(this.ctx, input, t0, 320, 0.2 + 0.35 * k, 0.05);
    // recorded punch, pitched down for weight — the grit on top
    this.audio.play('mittThud', {
      at, volume: Math.min(1, 0.55 + impact / 8), rate: 0.78, jitter: 0.07,
      refDistance: REF_DIST, rolloff: ROLLOFF,
    });
    // the doll's wooden frame rocking back against its shelf
    this.audio.play('knock', {
      at, volume: 0.22 + 0.15 * k, rate: 0.62, jitter: 0.1, refDistance: 2.2,
    });
  }

  /** Glancing blow: same materials, most of the weight held back. */
  dollTap(at, impact) {
    if (this.ctx.state !== 'running') return;
    const k = Math.min(1, impact / 3);
    const input = this.#slot(at, 0.2);
    const t0 = this.ctx.currentTime + 0.002;
    this.#thump(this.ctx, input, t0, 110, 0.12 + 0.2 * k, 0.07);
    this.#whump(this.ctx, input, t0, 350, 0.1 + 0.2 * k, 0.04);
    this.audio.play('mittThudSoft', {
      at, volume: 0.3 + 0.25 * k, rate: 0.86, jitter: 0.08, refDistance: 2.4,
    });
  }

  /**
   * Ball landing on anything that isn't a doll. A dense ball lands DEAD:
   * low thump always, plus a muted material voice on top — a low wood
   * knock for shelves/counter/tray, a soft tick for canvas walls, nearly
   * nothing extra for the floor.
   */
  surfaceThud(at, speed, tag) {
    if (this.ctx.state !== 'running') return;
    const k = Math.min(1, speed / 5);
    const input = this.#slot(at, 0.2);
    const t0 = this.ctx.currentTime + 0.002;
    this.#thump(this.ctx, input, t0, 95, 0.1 + 0.35 * k, 0.07 + 0.03 * k);
    if (tag === 'wood') {
      this.audio.play('knock', {
        at, volume: Math.min(0.55, 0.08 + speed / 9), rate: 0.72, jitter: 0.12,
      });
    } else if (tag === 'canvas') {
      this.#whump(this.ctx, input, t0, 260, 0.15 + 0.2 * k, 0.05);
      this.audio.play('tick', {
        at, volume: Math.min(0.3, 0.06 + speed / 14), rate: 0.8, jitter: 0.15,
      });
    } else { // floor and everything else: mostly the thump itself
      this.#whump(this.ctx, input, t0, 200, 0.08 + 0.15 * k, 0.045);
    }
  }

  /* -------------------------------------------------------------- tests */

  /**
   * Tuning/test seam: render one synthesized layer into an arbitrary
   * context (OfflineAudioContext included) so its spectrum and envelope
   * can be measured numerically — headless checks assert the "thunk"
   * signature (energy concentrated well below 300Hz, sub-200ms decay).
   */
  synthInto(ctx, dest, t0, kind, { speed = 3 } = {}) {
    const k = Math.min(1, speed / 6);
    if (kind === 'thump') {
      this.#thump(ctx, dest, t0, 105 - 20 * k, 0.35 + 0.5 * k, 0.11 + 0.05 * k);
    } else {
      this.#whump(ctx, dest, t0, 320, 0.2 + 0.35 * k, 0.05);
    }
  }
}

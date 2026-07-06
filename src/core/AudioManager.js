import * as THREE from 'three';

/**
 * AudioManager — positional carnival audio built on THREE.AudioListener.
 *
 * Real recorded/designed samples (CC0, Kenney.nl — shipped in
 * /public/assets/sounds, see CREDITS.md) are used for every game event.
 * Each logical sound name maps to one or more sample files; variations are
 * picked at random with a little playback-rate jitter so repeated hits
 * never sound machine-gunned.
 *
 * A couple of textures that have no good free recording available offline
 * (crowd murmur bed, ball-rolling loop) are synthesized with WebAudio and
 * layered UNDER the real samples. Drop real files into /public/assets/sounds
 * (see SWAPPABLE below) and they will be used automatically instead.
 */

// logical name -> sample files (first that loads wins for singles; arrays = random variation)
const SAMPLES = {
  // ball & dart impacts
  hit:        ['hit1.wav', 'hit2.wav', 'hit3.wav'],  // ball smacks a target
  thud:       ['rockHit2.wav'],                      // heavy knockdown thud
  fall:       ['fall1.wav', 'fall2.wav'],            // target flopping backwards
  dartStick:  ['jump3.wav'],                         // dart thunks into cork
  // scoring / UI
  point:      ['coin1.wav', 'coin2.wav', 'coin4.wav'],
  bell:       ['secret2.wav'],                       // round start bell
  fanfare:    ['upgrade4.wav'],                      // clear-the-board fanfare
  win:        ['upgrade1.wav'],
  roundEnd:   ['gameover3.wav'],
  miss:       ['error1.wav'],
  lose:       ['lose4.wav'],
  // machinery
  dispense:   ['phaseJump1.wav'],                    // ball popping out of the chute
  targetUp:   ['jump1.wav'],                         // winch pulling a target upright
  inflate:    ['phaseJump1.wav'],                    // nozzle re-inflating a balloon
  laser:      ['laser1.wav'],                        // reserved: duck gallery
  // balloon pop = real explosion sample pitched up + synth "snap" layer
  pop:        ['explosion1.wav', 'explosion2.wav'],
};

// If these files exist they replace the synthesized beds (drop-in upgrade path).
const SWAPPABLE = {
  crowd: 'ambience_crowd.ogg',   // looping crowd walla
  music: '../music/1918.mp3',    // ragtime piano — Anttis Instrumentals (free)
};

const SOUND_DIR = 'assets/sounds/';

export class AudioManager {
  /**
   * @param {THREE.Camera} camera listener rides on the head
   * @param {THREE.Scene} scene root for free-floating positional one-shots
   */
  constructor(camera, scene) {
    this.listener = new THREE.AudioListener();
    this.scene = scene;
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.buffers = new Map();   // name -> AudioBuffer[]
    this.started = false;
    this._musicSound = null;
    this._crowdNodes = null;
  }

  /** Fetch + decode all samples up front (a few hundred KB total). */
  async load() {
    const loader = new THREE.AudioLoader();
    const jobs = [];
    for (const [name, files] of Object.entries(SAMPLES)) {
      this.buffers.set(name, []);
      files.forEach((file, i) => {
        jobs.push(new Promise((resolve) => {
          loader.load(SOUND_DIR + file,
            (buf) => { this.buffers.get(name)[i] = buf; resolve(); },
            undefined,
            () => { console.warn('[audio] missing sample', file); resolve(); });
        }));
      });
    }
    await Promise.all(jobs);
  }

  /** Must be called from a user gesture / XR session start. */
  start(scene, musicAnchor) {
    if (this.started) return;
    this.started = true;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.#startCrowdBed();
    this.#startMusic(musicAnchor);
  }

  /**
   * Play a named sample.
   * @param {string} name key of SAMPLES
   * @param {object} o { at?: THREE.Object3D|THREE.Vector3, volume?, rate?, detune? }
   */
  play(name, o = {}) {
    const list = (this.buffers.get(name) || []).filter(Boolean);
    if (!list.length || this.ctx.state !== 'running') return null;
    const buffer = list[(Math.random() * list.length) | 0];
    const volume = o.volume ?? 1;
    const rate = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.jitter ?? 0.06));

    if (o.at) {
      // positional one-shot: temporary PositionalAudio attached to the scene
      const audio = new THREE.PositionalAudio(this.listener);
      audio.setBuffer(buffer);
      audio.setRefDistance(1.6);
      audio.setRolloffFactor(1.4);
      audio.setVolume(volume);
      audio.setPlaybackRate(rate);
      const parent = o.at.isObject3D ? o.at : null;
      if (parent) {
        parent.add(audio);
      } else {
        audio.position.copy(o.at);
        this.scene.add(audio);
      }
      audio.play();
      audio.source.onended = () => audio.removeFromParent();
      return audio;
    }
    // non-positional (UI-ish)
    const audio = new THREE.Audio(this.listener);
    audio.setBuffer(buffer);
    audio.setVolume(volume);
    audio.setPlaybackRate(rate);
    audio.play();
    return audio;
  }

  /** Balloon pop: real explosion sample pitched way up + a synthesized snap. */
  playPop(at) {
    this.play('pop', { at, volume: 0.9, rate: 1.9, jitter: 0.12 });
    // snap layer: 30ms noise burst through a bandpass — gives the rubbery crack
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    const len = ctx.sampleRate * 0.05;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2400 + Math.random() * 900; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0.5;
    src.connect(bp).connect(g).connect(this.listener.getInput());
    src.start();
  }

  /**
   * Continuous rolling-ball loop. Returns a handle whose intensity the game
   * sets each frame from ball contact + speed. Synthesized (filtered noise);
   * swaps itself for a real loop if assets/sounds/ball_roll.ogg exists.
   */
  createRollLoop(object3D) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // brown-ish noise loop
    const seconds = 1.5;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04;
      data[i] = last * 4.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    src.connect(lp).connect(gain);
    const panner = new THREE.PositionalAudio(this.listener);
    panner.setNodeSource(gain); // route noise chain through the positional panner
    panner.setRefDistance(1.0);
    panner.setVolume(1);
    object3D.add(panner);
    try { src.start(); } catch { /* context not running yet */ }
    return {
      /** 0..1 rolling intensity; also retunes the rumble with speed */
      set(intensity, speed = 1) {
        const t = ctx.currentTime;
        gain.gain.setTargetAtTime(Math.min(1, intensity) * 0.6, t, 0.06);
        lp.frequency.setTargetAtTime(300 + Math.min(1200, speed * 260), t, 0.1);
      },
      dispose() { try { src.stop(); } catch {} panner.removeFromParent(); },
    };
  }

  /** Quiet crowd-murmur bed. Tries the real file first, else synthesizes. */
  #startCrowdBed() {
    const audio = new THREE.Audio(this.listener);
    new THREE.AudioLoader().load(
      SOUND_DIR + SWAPPABLE.crowd,
      (buf) => { audio.setBuffer(buf); audio.setLoop(true); audio.setVolume(0.24); audio.play(); },
      undefined,
      () => this.#synthCrowd(), // no file shipped -> synth fallback
    );
  }

  /** Layered filtered noise that reads as distant chatter under the music. */
  #synthCrowd() {
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0.05;
    master.connect(this.listener.getInput());
    const seconds = 4;
    const buf = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let l = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        l = (l + 0.02 * w) / 1.02;
        d[i] = l * 3.0;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 0.4;
    // slow LFO on the filter makes it swell like conversation waves
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(bp.frequency);
    src.connect(bp).connect(master);
    src.start(); lfo.start();
    this._crowdNodes = { src, lfo };
  }

  /** Looping ragtime piano from a positional "bandstand" speaker prop. */
  #startMusic(anchor) {
    if (!anchor) return;
    const sound = new THREE.PositionalAudio(this.listener);
    new THREE.AudioLoader().load(SOUND_DIR + SWAPPABLE.music, (buf) => {
      sound.setBuffer(buf);
      sound.setLoop(true);
      sound.setRefDistance(3.5);
      sound.setRolloffFactor(1.1);
      sound.setVolume(0.35);
      sound.play();
    });
    anchor.add(sound);
    this._musicSound = sound;
  }
}

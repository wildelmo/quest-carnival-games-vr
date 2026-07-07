import * as THREE from 'three';
import { DISPLAY_FONT, barberPoleTexture } from '../core/textures.js';
import { shiny, glowTexture } from '../core/environment.js';

/**
 * ExitBell — a clearly-marked brass service bell on a striped post beside
 * the tent's centre pole. Pull the hanging cord (or touch the bell) to
 * ring it and fully exit the experience: it calls `onExit`, which ends the
 * VR session / drops back to the splash screen and pauses all audio.
 *
 * Interaction mirrors PushButton: in XR, bring a controller to the cord or
 * bell; on desktop, look at it from close range and press E. A cooldown
 * plus a visible ring-swing animation confirm the pull.
 */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class ExitBell {
  /**
   * @param {object} deps { input, audio, world }
   * @param {object} opts { onExit }
   */
  constructor({ input, audio, world }, { onExit } = {}) {
    this.input = input;
    this.audio = audio;
    this.world = world;
    this.onExit = onExit;
    this._cooldown = 0;
    this._swing = 0;      // bell swing animation phase
    this._ringT = 0;

    this.group = new THREE.Group();
    this.#build();
    world.onUpdate((dt, t) => this.#update(dt, t));
  }

  #build() {
    // polished brass — the env map gives it real glints
    const brass = shiny({ color: 0xd4af37, metalness: 1, roughness: 0.28, envIntensity: 1.25 });
    // the bell dome is an open-bottomed shell — render both faces so its
    // underside reads solid when you look up into it (single-sided would
    // cull the inner faces and leave the top looking see-through)
    const brassBell = shiny({
      color: 0xd4af37, metalness: 1, roughness: 0.28, envIntensity: 1.25,
      side: THREE.DoubleSide,
    });

    // proper barber pole with diagonal candy stripes
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.05, 1.55, 12),
      new THREE.MeshLambertMaterial({ map: barberPoleTexture('#b01030', '#f6ead7') }),
    );
    post.position.y = 0.775;
    this.group.add(post);

    // cross-arm the bell hangs from
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.05), brass);
    arm.position.set(0.12, 1.55, 0);
    this.group.add(arm);

    // the bell itself (open-bottomed dome) swings under the arm. The spherical
    // cap is generated from the top pole down, so it is ALREADY a dome with a
    // rounded closed top and an open bottom rim — no flip needed. (The old
    // rotation.x = Math.PI turned it into an upward-opening bowl, which is why
    // the top looked missing / see-through.)
    this.bellPivot = new THREE.Group();
    this.bellPivot.position.set(0.28, 1.53, 0);
    const bell = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.1),
      brassBell,
    );
    bell.position.y = -0.11;
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.008, 6, 10), brass);
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2c }));
    clapper.position.y = -0.12;         // hangs just at the bell's open mouth
    this.bellPivot.add(bell, yoke, clapper);
    this.group.add(this.bellPivot);

    // the pull cord: a rope down to grab/pull height with a wooden knob
    this.cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6),
      new THREE.MeshLambertMaterial({ color: 0xe8e0cf }),
    );
    this.cord.position.set(0.28, 1.16, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0x8a2f1f }));
    knob.position.y = -0.26;
    this.cord.add(knob);
    this.group.add(this.cord);
    this._cordWorld = new THREE.Vector3();

    // big obvious EXIT sign on top
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#39ff6a'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 240, 112);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#39ff6a'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#7bffa0';
    ctx.font = `56px ${DISPLAY_FONT}`;
    ctx.fillText('EXIT', 128, 58);
    ctx.shadowBlur = 6;
    ctx.font = '22px Georgia, serif';
    ctx.fillText('ring to leave', 128, 104);
    ctx.shadowBlur = 0;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // double-sided sign so it reads from any approach
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.3),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }),
    );
    sign.position.set(0.12, 1.95, 0);
    this.group.add(sign);
    // a soft green glow halo so it's findable across the tent (a sprite is
    // free; a real PointLight here would tax every lit pixel in the scene)
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0x39ff6a, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    halo.scale.setScalar(0.9);
    halo.position.set(0.12, 1.95, 0);
    this.group.add(halo);
  }

  #update(dt, t) {
    this._cooldown = Math.max(0, this._cooldown - dt);

    // ring-swing + clapper animation decays after a pull
    if (this._ringT > 0) {
      this._ringT -= dt;
      const a = Math.sin(t * 34) * 0.35 * Math.max(0, this._ringT / 0.8);
      this.bellPivot.rotation.z = a;
      this.cord.position.y = 1.16 + Math.min(0, -Math.abs(a) * 0.04);
    } else {
      this.bellPivot.rotation.z *= 1 - Math.min(1, dt * 6);
    }

    if (this._cooldown > 0) return;

    // interaction target = the cord knob (world space)
    this.cord.getWorldPosition(this._cordWorld);
    this._cordWorld.y -= 0.26;
    this.bellPivot.getWorldPosition(_v2);

    if (this.input.isXR) {
      for (const hand of this.input.hands) {
        if (!hand.connected) continue;
        if (hand.gripPosition.distanceTo(this._cordWorld) < 0.13 ||
            hand.gripPosition.distanceTo(_v2) < 0.14) {
          this.#ring(hand);
          return;
        }
      }
    } else {
      // close range AND actually looking at the bell — an E meant for a
      // nearby booth button must never ring you out
      this.world.camera.getWorldPosition(_v1);
      if (_v1.distanceTo(this._cordWorld) < 2.4) {
        this.world.camera.getWorldDirection(_v2);
        _v1.subVectors(this._cordWorld, _v1).normalize();
        if (_v1.dot(_v2) > 0.9 && this.input.consumeInteract()) {
          this.#ring(null);
        }
      }
    }
  }

  #ring(hand) {
    this._cooldown = 1.5;
    this._ringT = 0.8;
    if (hand) hand.pulse(1, 90);
    this.audio.play('bell', { at: this.group, volume: 1, rate: 0.9 });
    // let the bell sound land, then exit
    setTimeout(() => this.onExit && this.onExit(), 650);
  }
}

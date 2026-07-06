import * as THREE from 'three';
import { DISPLAY_FONT, LED_FONT } from '../core/textures.js';
import { shiny } from '../core/environment.js';

/**
 * Scoreboard — glowing dot-matrix style panel shared by every booth.
 * Renders SCORE / TIME / a status line to a canvas texture; call
 * setScore/setTime/setStatus and it repaints lazily (max once per frame).
 */
export class Scoreboard {
  /**
   * @param {string} title booth name shown across the top
   */
  constructor(title) {
    this.title = title;
    this.score = 0;
    this.best = 0;
    this.time = 0;
    this.status = 'THROW TO START';
    this._dirty = true;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    // panel in a chunky brass marquee frame
    this.group = new THREE.Group();
    // half-metal so the gold keeps its colour even at reflection-poor
    // angles (full metal reads near-black from behind)
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.06, 0.56, 0.06),
      shiny({ color: 0xc9a02e, metalness: 0.55, roughness: 0.4, envIntensity: 1.1 }),
    );
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.46),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }),
    );
    screen.position.z = 0.035;
    this.group.add(frame, screen);
    this.#paint();
  }

  setScore(v) { if (v !== this.score) { this.score = v; this._dirty = true; } }
  setBest(v) { if (v !== this.best) { this.best = v; this._dirty = true; } }
  setTime(v) {
    const rounded = Math.max(0, Math.ceil(v));
    if (rounded !== this.time) { this.time = rounded; this._dirty = true; }
  }
  setStatus(s) { if (s !== this.status) { this.status = s; this._dirty = true; } }

  /** call once per frame from the game */
  update() { if (this._dirty) this.#paint(); }

  #paint() {
    this._dirty = false;
    const { ctx } = this;
    // deep glass with a slight top sheen
    const bg = ctx.createLinearGradient(0, 0, 0, 256);
    bg.addColorStop(0, '#101018');
    bg.addColorStop(0.12, '#0a0a10');
    bg.addColorStop(1, '#07070c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 256);
    // scanline flavour
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let y = 0; y < 256; y += 6) ctx.fillRect(0, y, 512, 2);

    ctx.textAlign = 'center';
    ctx.font = `34px ${DISPLAY_FONT}`;
    ctx.shadowColor = '#ffb300';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(this.title, 256, 44);
    ctx.shadowBlur = 0;
    // thin rule under the title
    ctx.fillStyle = 'rgba(255,210,63,0.35)';
    ctx.fillRect(56, 58, 400, 2);

    // LED digits with their own glow
    ctx.font = `88px ${LED_FONT}`;
    ctx.shadowColor = '#2ee6d0';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#4dffe8';
    ctx.textAlign = 'left';
    ctx.fillText(String(this.score).padStart(4, '0'), 52, 142);
    ctx.shadowColor = '#ff2f52';
    ctx.fillStyle = '#ff6079';
    ctx.textAlign = 'right';
    ctx.fillText(`${String(this.time).padStart(2, '0')}s`, 462, 142);
    ctx.shadowBlur = 0;

    ctx.font = `22px ${LED_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8d8da8';
    ctx.fillText('SCORE', 54, 170);
    ctx.textAlign = 'right';
    ctx.fillText('TIME', 460, 170);

    ctx.textAlign = 'center';
    ctx.font = `36px ${LED_FONT}`;
    ctx.shadowColor = '#ffe9c9';
    ctx.shadowBlur = 9;
    ctx.fillStyle = '#ffeed4';
    ctx.fillText(this.status, 256, 214);
    ctx.shadowBlur = 0;
    if (this.best > 0) {
      ctx.font = `22px ${LED_FONT}`;
      ctx.fillStyle = '#9d9db8';
      ctx.fillText(`BEST ${this.best}`, 256, 246);
    }
    this.texture.needsUpdate = true;
  }
}

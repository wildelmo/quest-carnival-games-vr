import * as THREE from 'three';

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
    this.status = 'PRESS  START';
    this._dirty = true;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // panel with a chunky marquee frame
    this.group = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.06, 0.56, 0.06),
      new THREE.MeshLambertMaterial({ color: 0xd4af37 }),
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
    ctx.fillStyle = '#0b0b12';
    ctx.fillRect(0, 0, 512, 256);
    // scanline flavour
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < 256; y += 6) ctx.fillRect(0, y, 512, 2);

    ctx.textAlign = 'center';
    ctx.font = 'bold 40px Georgia, serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(this.title, 256, 46);

    ctx.font = 'bold 64px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#2ee6d0';
    ctx.textAlign = 'left';
    ctx.fillText(String(this.score).padStart(4, '0'), 52, 140);
    ctx.fillStyle = '#ff5d73';
    ctx.textAlign = 'right';
    ctx.fillText(`${String(this.time).padStart(2, '0')}s`, 462, 140);

    ctx.font = '22px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8d8da8';
    ctx.fillText('SCORE', 52, 172);
    ctx.textAlign = 'right';
    ctx.fillText('TIME', 462, 172);

    ctx.textAlign = 'center';
    ctx.font = 'bold 30px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#ffe9c9';
    ctx.fillText(this.status, 256, 220);
    if (this.best > 0) {
      ctx.font = '20px ui-monospace, Menlo, monospace';
      ctx.fillStyle = '#8d8da8';
      ctx.fillText(`BEST ${this.best}`, 256, 246);
    }
    this.texture.needsUpdate = true;
  }
}

import * as THREE from 'three';
import { PushButton } from './PushButton.js';
import { settings } from '../core/settings.js';
import { DISPLAY_FONT, LED_FONT, woodTexture } from '../core/textures.js';
import { shiny } from '../core/environment.js';

/**
 * SettingsPanel — the "OPERATOR PANEL", a little wooden control board by
 * the centre pole. Production settings live in the world, not a floating
 * menu: three arcade dome buttons toggle the comfort ring, the snap-turn
 * angle and the bandstand music, and the painted board shows the current
 * values. Everything persists via core/settings.js.
 */

const ROWS = [
  { key: 'vignette', label: 'COMFORT RING', color: 0x2ee6d0,
    value: (v) => (v.vignette ? 'ON' : 'OFF'),
    press: () => settings.set('vignette', !settings.data.vignette) },
  { key: 'snapDeg', label: 'SNAP TURN', color: 0xffd23f,
    value: (v) => `${v.snapDeg}°`,
    press: () => settings.set('snapDeg', settings.data.snapDeg === 30 ? 45 : 30) },
  { key: 'music', label: 'MUSIC', color: 0xe02249,
    value: (v) => (v.music ? 'ON' : 'OFF'),
    press: () => settings.set('music', !settings.data.music) },
];

export class SettingsPanel {
  /** @param {object} deps { world, input, audio } */
  constructor(deps) {
    this.deps = deps;
    this.group = new THREE.Group();
    this.group.name = 'settingsPanel';

    // stout wooden post with a slanted reading board
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.06, 1.0, 10),
      new THREE.MeshLambertMaterial({ map: woodTexture('#5d3b20') }),
    );
    post.position.y = 0.5;
    this.group.add(post);

    this._canvas = document.createElement('canvas');
    this._canvas.width = 512;
    this._canvas.height = 384;
    this._tex = new THREE.CanvasTexture(this._canvas);
    this._tex.colorSpace = THREE.SRGBColorSpace;
    this.#paint();

    const board = new THREE.Group();
    board.position.set(0, 1.18, 0.02);
    board.rotation.x = -0.5;                 // tilted up toward the reader
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.46, 0.035),
      new THREE.MeshLambertMaterial({ map: woodTexture('#4a2e18') }),
    );
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.4),
      new THREE.MeshBasicMaterial({ map: this._tex }),
    );
    face.position.z = 0.019;
    board.add(backing, face);
    // little brass lamp rail across the top, catching the env map
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.62, 8),
      shiny({ color: 0xd4af37, metalness: 1, roughness: 0.35 }),
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 0.25, 0.02);
    board.add(rail);
    this.group.add(board);

    // shelf with the three dome buttons, lined up under their rows
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.045, 0.2),
      new THREE.MeshLambertMaterial({ map: woodTexture('#5d3b20') }),
    );
    shelf.position.set(0, 0.9, 0.16);
    this.group.add(shelf);

    ROWS.forEach((row, i) => {
      const btn = new PushButton(deps, {
        color: row.color,
        onPress: () => {
          row.press();
          if (row.key === 'music') deps.audio.setMusicEnabled(settings.data.music);
          this.#paint();
        },
      });
      btn.group.scale.setScalar(0.72);
      btn.group.position.set(-0.2 + i * 0.2, 0.925, 0.16);
      this.group.add(btn.group);
    });
  }

  #paint() {
    const ctx = this._canvas.getContext('2d');
    const W = 512, H = 384;
    ctx.fillStyle = '#221410';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(233,193,79,0.9)';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.strokeStyle = 'rgba(233,193,79,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(22, 22, W - 44, H - 44);

    ctx.fillStyle = '#ffd23f';
    ctx.font = `44px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OPERATOR PANEL', W / 2, 62);

    const colors = ['#2ee6d0', '#ffd23f', '#ff5d73'];
    ROWS.forEach((row, i) => {
      const y = 130 + i * 66;
      ctx.beginPath();                       // colour key dot = button colour
      ctx.arc(52, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = colors[i];
      ctx.fill();
      ctx.fillStyle = '#ffe9c9';
      ctx.font = `30px ${DISPLAY_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(row.label, 78, y);
      ctx.fillStyle = '#9dffb0';
      ctx.font = `44px ${LED_FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(row.value(settings.data), W - 56, y);
    });

    ctx.fillStyle = 'rgba(255,233,201,0.45)';
    ctx.font = `19px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('press a button • remembered next visit', W / 2, H - 44);
    this._tex.needsUpdate = true;
  }
}

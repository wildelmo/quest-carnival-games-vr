import * as THREE from 'three';

/**
 * All textures are generated on 2D canvas at load time — no image downloads,
 * small VRAM footprint, and easy to re-skin. Power-of-two sizes so mipmaps
 * work on Quest. Swap any of these for real photos/art later by replacing
 * the material's .map with a loaded texture.
 */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

/** Vertical big-top stripes (canopy walls, awnings). */
export function stripesTexture(colorA = '#c2183c', colorB = '#f6ead7', stripes = 8) {
  const [c, ctx] = makeCanvas(512, 512);
  const w = 512 / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? colorB : colorA;
    ctx.fillRect(i * w, 0, w, 512);
  }
  // subtle fabric shading so it doesn't look flat
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, 'rgba(0,0,0,0.16)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  return toTexture(c);
}

/**
 * Radial "wedge" stripes for the conical tent roof — mapped so that a
 * ConeGeometry's UVs (u around the rim) produce pie-slice panels.
 */
export function canopyTexture(colorA = '#c2183c', colorB = '#f6ead7', wedges = 16) {
  const [c, ctx] = makeCanvas(1024, 256);
  const w = 1024 / wedges;
  for (let i = 0; i < wedges; i++) {
    ctx.fillStyle = i % 2 ? colorB : colorA;
    ctx.fillRect(i * w, 0, w, 256);
  }
  // darker toward the eaves for cozy interior lighting feel
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(0,0,0,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 256);
  return toTexture(c);
}

/** Worn wooden floor planks. */
export function woodTexture(base = '#8a5a33') {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  const plankH = 64;
  for (let y = 0; y < 512; y += plankH) {
    // per-plank tint variation
    ctx.fillStyle = `rgba(${Math.random() > .5 ? 30 : 0},10,0,${0.08 + Math.random() * 0.14})`;
    ctx.fillRect(0, y, 512, plankH);
    // grain streaks
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = `rgba(40,20,5,${0.05 + Math.random() * 0.12})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      const gy = y + Math.random() * plankH;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(170, gy + Math.random() * 6 - 3, 340, gy + Math.random() * 6 - 3, 512, gy);
      ctx.stroke();
    }
    // seams
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, y, 512, 3);
    // board end-joints at random x
    ctx.fillRect(Math.random() * 512, y, 3, plankH);
  }
  return toTexture(c, 6, 6);
}

/**
 * Painted booth sign with bold lettering + light-bulb border dots.
 * `rainbow: true` draws each letter in a different candy colour along a
 * gentle arch — the classic boardwalk "DOWN THE CLOWN" marquee look.
 */
export function signTexture(text, {
  bg = '#1d2a63', fg = '#ffd23f', accent = '#ff5d73', sub = '', rainbow = false,
} = {}) {
  const [c, ctx] = makeCanvas(1024, 256);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 256);
  // border
  ctx.strokeStyle = accent;
  ctx.lineWidth = 14;
  ctx.strokeRect(14, 14, 996, 228);
  // bulbs
  ctx.fillStyle = '#fff3b0';
  for (let x = 40; x <= 984; x += 59) {
    for (const y of [36, 220]) {
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mainY = sub ? 102 : 128;
  if (rainbow) {
    // per-letter colours on a shallow arch, slight per-letter tilt
    const letterColors = ['#ff3b30', '#ff9500', '#ffd23f', '#7ac74f', '#3aa0ff', '#b14fc9'];
    const size = sub ? 104 : 122;
    ctx.font = `bold ${size}px Georgia, serif`;
    const widths = [...text].map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = 512 - total / 2;
    [...text].forEach((ch, i) => {
      const cx = x + widths[i] / 2;
      const t = (cx - 512) / (total / 2 || 1);      // -1..1 across the word
      const y = mainY + 26 * t * t - 10;             // arch: ends dip down
      ctx.save();
      ctx.translate(cx, y);
      ctx.rotate(t * 0.12);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(ch, 4, 6);
      ctx.fillStyle = ch === ' ' ? 'transparent' : letterColors[i % letterColors.length];
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      x += widths[i];
    });
  } else {
    ctx.font = `bold ${sub ? 108 : 128}px Georgia, serif`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(text, 517, mainY + 6);
    ctx.fillStyle = fg;
    ctx.fillText(text, 512, mainY);
  }
  if (sub) {
    ctx.font = 'italic 44px Georgia, serif';
    ctx.fillStyle = '#ffe9c9';
    ctx.fillText(sub, 512, 196);
  }
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const TARGET_FACES = ['clown', 'duck', 'monster'];

/** Cartoon face for a knockdown target plate. kind: clown | duck | monster */
export function targetFaceTexture(kind = 'clown', tint = '#ffffff') {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, 256, 256);
  ctx.save();
  ctx.translate(128, 128);
  if (kind === 'clown') {
    // face
    ctx.fillStyle = '#ffe3c4';
    ctx.beginPath(); ctx.arc(0, 8, 86, 0, Math.PI * 2); ctx.fill();
    // hair puffs
    ctx.fillStyle = '#e02249';
    for (const [x, y] of [[-78, -40], [-50, -72], [50, -72], [78, -40]]) {
      ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill();
    }
    // eyes
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath(); ctx.arc(-30, -8, 9, 0, Math.PI * 2); ctx.arc(30, -8, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3aa0ff'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(-30, -8, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(30, -8, 17, 0, Math.PI * 2); ctx.stroke();
    // nose
    ctx.fillStyle = '#ff2f2f';
    ctx.beginPath(); ctx.arc(0, 22, 16, 0, Math.PI * 2); ctx.fill();
    // grin
    ctx.strokeStyle = '#c2183c'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(0, 30, 46, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
  } else if (kind === 'duck') {
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(0, 4, 84, 0, Math.PI * 2); ctx.fill();
    // bill
    ctx.fillStyle = '#ff8c1a';
    ctx.beginPath(); ctx.ellipse(0, 40, 44, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c96400'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-40, 40); ctx.lineTo(40, 40); ctx.stroke();
    // eyes
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath(); ctx.arc(-26, -16, 10, 0, Math.PI * 2); ctx.arc(26, -16, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-23, -19, 3.5, 0, Math.PI * 2); ctx.arc(29, -19, 3.5, 0, Math.PI * 2); ctx.fill();
  } else {
    // one-eyed fuzzy monster
    ctx.fillStyle = '#7ac74f';
    ctx.beginPath(); ctx.arc(0, 8, 84, 0, Math.PI * 2); ctx.fill();
    // fuzz
    ctx.strokeStyle = '#5d9e3a'; ctx.lineWidth = 3;
    for (let a = 0; a < Math.PI * 2; a += 0.22) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 80, 8 + Math.sin(a) * 80);
      ctx.lineTo(Math.cos(a) * 95, 8 + Math.sin(a) * 95);
      ctx.stroke();
    }
    // big eye
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, -10, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath(); ctx.arc(0, -6, 14, 0, Math.PI * 2); ctx.fill();
    // jagged mouth
    ctx.fillStyle = '#3d1f4d';
    ctx.beginPath();
    ctx.moveTo(-44, 46);
    for (let i = 0; i <= 8; i++) ctx.lineTo(-44 + i * 11, 46 + (i % 2 ? 16 : 0));
    ctx.lineTo(44, 66); ctx.lineTo(-44, 66);
    ctx.fill();
  }
  ctx.restore();
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function randomTargetKind(i) {
  return TARGET_FACES[i % TARGET_FACES.length];
}

/** Cork dartboard backing. */
export function corkTexture() {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = '#b98d5e';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = `rgba(${90 + Math.random() * 80},${55 + Math.random() * 50},${25 + Math.random() * 30},0.5)`;
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  return toTexture(c, 3, 3);
}

export const CARNIVAL_PALETTE = [
  0xe02249, 0xffd23f, 0x3aa0ff, 0x7ac74f, 0xff8c1a, 0xb14fc9, 0x2ee6d0, 0xff5d73,
];

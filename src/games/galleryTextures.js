import * as THREE from 'three';
import { DISPLAY_FONT } from '../core/textures.js';

/**
 * galleryTextures — all the painted artwork for the SHOOTING GALLERY booth,
 * generated on canvas at load like everything else in the repo.
 *
 * The look copies the classic travelling-show gallery cabinet: a sunny
 * painted countryside backdrop (rolling hills, puffy clouds, little pines)
 * framed by red-striped curtain returns, rows of flat painted tin animal
 * silhouettes riding above scalloped "water" wave rails, and bullseyes
 * everywhere. Everything is deliberately hand-painted-looking: chunky
 * outlines, two-tone shading, film grain.
 */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  return tex;
}

function grain(ctx, w, h, amp = 7) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;         // keep transparent pixels clean
    const n = (Math.random() - 0.5) * 2 * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** chunky painted star (used on the backdrop and the spinner) */
function star(ctx, x, y, r, color, outline = 'rgba(60,30,0,0.55)') {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.restore();
}

/** concentric painted bullseye */
function bullseye(ctx, x, y, r, colors = ['#e02249', '#f6ead7', '#e02249', '#f6ead7']) {
  for (let i = 0; i < colors.length; i++) {
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.arc(x, y, r * (1 - i / colors.length), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = 'rgba(60,30,0,0.5)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/* ------------------------------------------------------------ backdrop ---- */

/**
 * The painted countryside scene behind the targets: sky, clouds, sun rays,
 * two bands of rolling hills with pine trees, striped curtain returns at
 * both edges and a golden arch of lettering — the whole cabinet in one
 * cheerful mural, 2048x512 for legible detail up close.
 */
export function galleryBackdropTexture() {
  const W = 2048, H = 512;
  const [c, ctx] = makeCanvas(W, H);

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#7ec4f2');
  sky.addColorStop(0.55, '#bfe6fb');
  sky.addColorStop(1, '#eaf8ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // sun with painted rays, top centre-left
  const sx = W * 0.28, sy = H * 0.18;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = 'rgba(255,220,110,0.45)';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(150, -14);
    ctx.lineTo(150, 14);
    ctx.fill();
  }
  ctx.restore();
  const sun = ctx.createRadialGradient(sx, sy, 5, sx, sy, 60);
  sun.addColorStop(0, '#fff6d8');
  sun.addColorStop(1, '#ffd23f');
  ctx.fillStyle = sun;
  ctx.beginPath(); ctx.arc(sx, sy, 52, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(200,120,0,0.5)';
  ctx.beginPath(); ctx.arc(sx, sy, 52, 0, Math.PI * 2); ctx.stroke();

  // puffy clouds
  const cloud = (x, y, s) => {
    ctx.fillStyle = '#ffffff';
    for (const [dx, dy, r] of [[0, 0, 34], [30, 6, 26], [-30, 8, 24], [8, -16, 24]]) {
      ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(150,190,220,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + 22 * s, 56 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  };
  cloud(W * 0.55, H * 0.16, 1.15);
  cloud(W * 0.78, H * 0.24, 0.85);
  cloud(W * 0.12, H * 0.3, 0.7);
  cloud(W * 0.42, H * 0.3, 0.55);

  // far hills
  ctx.fillStyle = '#8fce6a';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.62);
  for (let x = 0; x <= W; x += 8) {
    ctx.lineTo(x, H * 0.62 - Math.sin(x * 0.004 + 1.2) * 42 - Math.sin(x * 0.0013) * 26);
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H);
  ctx.fill();
  // near hills, deeper green
  ctx.fillStyle = '#5da23f';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.8);
  for (let x = 0; x <= W; x += 8) {
    ctx.lineTo(x, H * 0.8 - Math.sin(x * 0.006 + 4) * 34 - Math.sin(x * 0.0021 + 1) * 18);
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H);
  ctx.fill();

  // little pines along the hill lines
  const pine = (x, y, s, dark) => {
    ctx.fillStyle = dark ? '#2f6b2a' : '#3f8a33';
    for (let t = 0; t < 3; t++) {
      const w = (30 - t * 7) * s, hh = 26 * s, ty = y - t * 18 * s;
      ctx.beginPath();
      ctx.moveTo(x - w, ty);
      ctx.lineTo(x, ty - hh);
      ctx.lineTo(x + w, ty);
      ctx.fill();
    }
    ctx.fillStyle = '#5d3b20';
    ctx.fillRect(x - 4 * s, y - 2, 8 * s, 14 * s);
  };
  for (const [fx, fy, s] of [[0.08, 0.66, 0.8], [0.19, 0.63, 0.6], [0.63, 0.64, 0.75],
    [0.86, 0.62, 0.65], [0.94, 0.67, 0.8], [0.36, 0.65, 0.55]]) {
    pine(W * fx, H * fy, s, false);
  }
  for (const [fx, fy, s] of [[0.13, 0.86, 1.0], [0.5, 0.88, 0.9], [0.71, 0.85, 1.05], [0.91, 0.9, 0.85]]) {
    pine(W * fx, H * fy, s, true);
  }

  // painted gold stars sprinkled in the sky
  for (const [fx, fy, r] of [[0.05, 0.12, 22], [0.36, 0.1, 16], [0.66, 0.08, 20],
    [0.9, 0.12, 17], [0.22, 0.2, 13], [0.72, 0.3, 12]]) {
    star(ctx, W * fx, H * fy, r, '#ffd23f');
  }

  // drifting party balloons on strings
  const balloon = (x, y, s, color) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(60,30,0,0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(x, y, 20 * s, 26 * s, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(x - 7 * s, y - 9 * s, 6 * s, 9 * s, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,0,0.6)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 26 * s);
    ctx.quadraticCurveTo(x + 10 * s, y + 48 * s, x - 4 * s, y + 70 * s);
    ctx.stroke();
  };
  balloon(W * 0.47, H * 0.14, 1.0, '#e02249');
  balloon(W * 0.51, H * 0.22, 0.8, '#2f6fff');
  balloon(W * 0.84, H * 0.4, 0.9, '#ffd23f');
  balloon(W * 0.17, H * 0.44, 0.75, '#43a047');

  // painted butterflies fluttering over the hills
  const butterfly = (x, y, s, color) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.6);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(60,30,0,0.55)';
    ctx.lineWidth = 3;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * 11 * s, -6 * s, 12 * s, 9 * s, sx * 0.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(sx * 9 * s, 7 * s, 9 * s, 7 * s, sx * -0.4, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#3a2620';
    ctx.beginPath();
    ctx.ellipse(0, 0, 3 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  butterfly(W * 0.3, H * 0.5, 1.0, '#ff9800');
  butterfly(W * 0.57, H * 0.45, 0.85, '#e05a9e');
  butterfly(W * 0.76, H * 0.52, 0.9, '#3aa0ff');
  // a couple of painted bullseyes on the hills (they're just decoration,
  // but they make the whole wall read TARGET RANGE at a glance). Keep them
  // inboard of x ±1.9 booth-local — the prize cabinets cover the mural's
  // outer ~0.4m and a half-hidden bullseye reads as a glitch.
  bullseye(ctx, W * 0.155, H * 0.78, 40);
  bullseye(ctx, W * 0.845, H * 0.8, 40);

  // red-and-cream striped curtain returns at both edges
  for (const side of [0, 1]) {
    const x0 = side ? W - 120 : 0;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#f6ead7' : '#c2183c';
      ctx.fillRect(x0 + i * 30, 0, 30, H);
    }
    // curtain shading
    const sh = ctx.createLinearGradient(x0, 0, x0 + 120, 0);
    sh.addColorStop(side ? 1 : 0, 'rgba(0,0,0,0.35)');
    sh.addColorStop(side ? 0 : 1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(x0, 0, 120, H);
  }

  // golden arch of lettering across the top, like the real cabinet
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `86px ${DISPLAY_FONT}`;
  const word = '★ SHOOTING GALLERY ★';
  const cx = W / 2, cy = 420, R = 1450; // arch centre far below → gentle curve
  const widths = [...word].map(ch => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let along = -total / 2;
  for (let i = 0; i < word.length; i++) {
    const mid = along + widths[i] / 2;
    const a = mid / R;
    ctx.save();
    ctx.translate(cx + Math.sin(a) * R, cy - Math.cos(a) * R + (R - 340));
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(60,20,0,0.55)';
    ctx.fillText(word[i], 3, 5);
    ctx.fillStyle = word[i] === '★' ? '#ffd23f' : '#ffb300';
    ctx.fillText(word[i], 0, 0);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(120,40,0,0.8)';
    ctx.strokeText(word[i], 0, 0);
    ctx.restore();
    along += widths[i];
  }
  ctx.restore();

  grain(ctx, W, H, 6);
  return toTexture(c);
}

/* ---------------------------------------------------------- wave rails ---- */

/**
 * Scalloped painted "water" rail that hides each target track — the classic
 * gallery wave. Transparent above the crests (use alphaTest), repeats
 * horizontally.
 */
export function waveRailTexture(deep = '#1d5fa3', light = '#3aa0ff') {
  const W = 512, H = 128;
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const lobe = 64;
  // back row of scallops (darker, offset half a lobe)
  ctx.fillStyle = deep;
  for (let x = -lobe; x < W + lobe; x += lobe) {
    ctx.beginPath(); ctx.arc(x + lobe / 2, 62, 42, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillRect(0, 62, W, H - 62);
  // front row (lighter)
  ctx.fillStyle = light;
  for (let x = -lobe; x < W + lobe; x += lobe) {
    ctx.beginPath(); ctx.arc(x, 84, 44, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillRect(0, 84, W, H - 84);
  // white crest strokes on the front scallops
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 6;
  for (let x = -lobe; x < W + lobe; x += lobe) {
    ctx.beginPath(); ctx.arc(x, 84, 41, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  }
  // subtle bottom shading
  const g = ctx.createLinearGradient(0, 60, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,10,40,0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 60, W, H - 60);
  grain(ctx, W, H, 5);
  const tex = toTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/* ------------------------------------------------------------- targets ---- */

/**
 * Flat painted tin target silhouettes, transparent background (render with
 * alphaTest). Each carries a little bullseye — that's what says "shoot me".
 * kinds: 'duck' | 'rabbit' | 'bird' | 'star' | 'clown'.  gold: bonus paint.
 */
export function targetTexture(kind, { gold = false } = {}) {
  const c = drawTarget(kind, gold);
  grain(c.getContext('2d'), 256, 256, 6);
  return toTexture(c);
}

/**
 * The silhouette's alpha as a small hit mask (1 = painted tin, 0 = air),
 * so the hitscan can demand the OUTLINE be hit, not a bounding sphere.
 * Downsampled with a per-cell max so thin outlines survive. Cached.
 */
const _maskCache = new Map();
export function targetAlphaMask(kind, size = 64) {
  const key = kind + ':' + size;
  if (_maskCache.has(key)) return _maskCache.get(key);
  const img = drawTarget(kind, false).getContext('2d').getImageData(0, 0, 256, 256).data;
  const step = 256 / size;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0;
      for (let sy = 0; sy < step; sy += 2) {
        for (let sx = 0; sx < step; sx += 2) {
          a = Math.max(a, img[((y * step + sy) * 256 + x * step + sx) * 4 + 3]);
        }
      }
      data[y * size + x] = a > 140 ? 1 : 0;
    }
  }
  const mask = { data, size };
  _maskCache.set(key, mask);
  return mask;
}

function drawTarget(kind, gold) {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const OUT = 'rgba(50,25,5,0.9)';
  ctx.lineJoin = 'round';

  if (kind === 'duck') {
    const body = gold ? '#ffd23f' : '#ffca28';
    const wing = gold ? '#ffb300' : '#ff9800';
    // body: fat ellipse, tail kick at the back-left, facing +x
    ctx.fillStyle = body;
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(24, 150);                       // tail tip
    ctx.quadraticCurveTo(30, 108, 78, 118);    // back line up to the neck
    ctx.quadraticCurveTo(96, 60, 148, 58);     // neck up to the head
    ctx.arc(168, 78, 34, Math.PI * 1.25, Math.PI * 0.5); // head
    ctx.quadraticCurveTo(180, 148, 120, 176);  // chest down
    ctx.quadraticCurveTo(60, 196, 24, 150);    // belly to tail
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // bill
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.moveTo(196, 70);
    ctx.quadraticCurveTo(240, 74, 238, 88);
    ctx.quadraticCurveTo(214, 100, 192, 92);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 6; ctx.stroke();
    // eye
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath(); ctx.arc(172, 70, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(174.5, 67.5, 2.4, 0, Math.PI * 2); ctx.fill();
    // wing swirl
    ctx.strokeStyle = wing;
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.arc(92, 138, 30, Math.PI * 0.15, Math.PI * 1.2); ctx.stroke();
    // bullseye on the body
    bullseye(ctx, 92, 140, 26, gold
      ? ['#c2183c', '#fff6d8', '#c2183c']
      : ['#e02249', '#f6ead7', '#e02249']);
  } else if (kind === 'rabbit') {
    const fur = gold ? '#ffd23f' : '#cfd6e4';
    ctx.fillStyle = fur;
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 9;
    // sitting rabbit facing +x: haunch, chest, head, two tall ears
    ctx.beginPath();
    ctx.moveTo(36, 208);
    ctx.quadraticCurveTo(18, 140, 74, 122);     // big haunch
    ctx.quadraticCurveTo(96, 88, 138, 96);      // back to shoulders
    ctx.quadraticCurveTo(160, 66, 176, 68);     // up the neck
    // ears
    ctx.quadraticCurveTo(160, 26, 172, 8);
    ctx.quadraticCurveTo(188, 24, 188, 62);
    ctx.quadraticCurveTo(196, 22, 212, 12);
    ctx.quadraticCurveTo(222, 34, 208, 72);
    // face + chest
    ctx.quadraticCurveTo(232, 86, 224, 108);
    ctx.quadraticCurveTo(210, 128, 182, 130);
    ctx.quadraticCurveTo(196, 178, 160, 204);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // tail puff
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(38, 178, 17, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 6; ctx.stroke();
    // eye + nose
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath(); ctx.arc(196, 92, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff5d73';
    ctx.beginPath(); ctx.arc(224, 102, 5, 0, Math.PI * 2); ctx.fill();
    // bullseye on the haunch
    bullseye(ctx, 84, 160, 30);
  } else if (kind === 'bird') {
    const feathers = gold ? '#ffd23f' : '#3aa0ff';
    const wing = gold ? '#ffb300' : '#1d5fa3';
    ctx.fillStyle = feathers;
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 9;
    // plump little bird facing +x, tail flicked up behind
    ctx.beginPath();
    ctx.moveTo(20, 96);                          // tail tip (upper)
    ctx.quadraticCurveTo(64, 88, 92, 96);
    ctx.quadraticCurveTo(120, 62, 168, 70);      // head top
    ctx.quadraticCurveTo(210, 82, 206, 116);     // face front
    ctx.quadraticCurveTo(196, 168, 126, 172);    // belly
    ctx.quadraticCurveTo(72, 172, 62, 140);      // rump
    ctx.quadraticCurveTo(36, 132, 20, 128);      // tail (lower)
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // beak
    ctx.fillStyle = '#ff9800';
    ctx.beginPath();
    ctx.moveTo(204, 96); ctx.lineTo(238, 108); ctx.lineTo(202, 120);
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 6; ctx.stroke();
    // eye
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath(); ctx.arc(180, 94, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(182, 92, 2.2, 0, Math.PI * 2); ctx.fill();
    // folded wing
    ctx.fillStyle = wing;
    ctx.beginPath();
    ctx.moveTo(84, 110);
    ctx.quadraticCurveTo(150, 96, 152, 128);
    ctx.quadraticCurveTo(120, 152, 84, 138);
    ctx.closePath(); ctx.fill();
    // small bullseye on the wing
    bullseye(ctx, 112, 124, 20);
  } else if (kind === 'clown') {
    // the WILD CLOWN — the rare specialty target that sneaks onto the
    // conveyors. Big grinning face, party hat, gold ruff, red-nose bullseye.
    ctx.strokeStyle = OUT;
    // gold ruff collar peeking out under the chin
    ctx.fillStyle = '#ffd23f';
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(128 + i * 26, 218, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 6;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(128 + i * 26, 218, 20, 0, Math.PI * 2);
      ctx.stroke();
    }
    // wild red hair tufts
    ctx.fillStyle = '#e02249';
    for (const [hx, hy, hr] of [[52, 120, 30], [40, 152, 26], [204, 120, 30], [216, 152, 26]]) {
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 7; ctx.stroke();
    }
    // face
    ctx.fillStyle = '#fff2e2';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.ellipse(128, 146, 82, 76, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // pointed party hat with a pompom
    ctx.fillStyle = '#2f6fff';
    ctx.beginPath();
    ctx.moveTo(84, 84); ctx.lineTo(128, 6); ctx.lineTo(172, 84);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 8; ctx.stroke();
    star(ctx, 128, 56, 16, '#ffd23f', 'rgba(0,0,0,0)');
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(128, 10, 12, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 5; ctx.stroke();
    // starry eyes + painted brows
    ctx.fillStyle = '#1b1b1b';
    for (const ex of [96, 160]) {
      ctx.beginPath(); ctx.arc(ex, 130, 9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1d2a63';
    for (const ex of [96, 160]) {
      ctx.beginPath(); ctx.arc(ex, 136, 17, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    }
    // the enormous grin
    ctx.strokeStyle = '#c2183c';
    ctx.lineWidth = 11;
    ctx.beginPath(); ctx.arc(128, 152, 48, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke();
    // red nose IS the bullseye
    bullseye(ctx, 128, 150, 24, ['#e02249', '#ff8a9b', '#e02249']);
  } else {
    // spinner star: big gold star with a red bullseye heart
    star(ctx, 128, 128, 116, gold ? '#ffe9a0' : '#ffd23f', 'rgba(120,60,0,0.9)');
    star(ctx, 128, 128, 86, '#ffb300', 'rgba(0,0,0,0)');
    bullseye(ctx, 128, 128, 44);
  }

  return c;
}

/* ---------------------------------------------------------- prize wheel ---- */

/**
 * The face of the shootable carnival prize wheel: `values.length` wedges
 * with painted point values, a gold hub star and a riveted rim. Wedge i
 * occupies CANVAS angles [i, i+1) * step from the +x axis — with flipY the
 * wedge under a pointer at world angle π/2 on a disc rotated by `rot` is
 * floor(mod(rot - π/2, 2π) / step) (see ShootingGalleryGame #updateWheel).
 */
export function prizeWheelTexture(values) {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2, R = 244;
  const step = (Math.PI * 2) / values.length;
  const wedgeColor = (v) => v >= 200 ? '#ffd23f'
    : v >= 100 ? '#43a047'
      : v >= 75 ? '#2f6fff'
        : v >= 50 ? '#e02249' : '#f6ead7';

  for (let i = 0; i < values.length; i++) {
    ctx.fillStyle = wedgeColor(values[i]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, i * step, (i + 1) * step);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(60,30,0,0.6)';
    ctx.stroke();
  }
  // painted values, upright along each wedge's spoke
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 52px ${DISPLAY_FONT}`;
  for (let i = 0; i < values.length; i++) {
    const a = (i + 0.5) * step;
    const dark = wedgeColor(values[i]) === '#f6ead7';
    ctx.save();
    ctx.translate(cx + Math.cos(a) * 168, cy + Math.sin(a) * 168);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = 'rgba(60,30,0,0.5)';
    ctx.fillText(String(values[i]), 2, 3);
    ctx.fillStyle = dark ? '#c2183c' : '#fff6d8';
    ctx.fillText(String(values[i]), 0, 0);
    ctx.restore();
  }
  // gold rim with rivets
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#d4af37';
  ctx.beginPath(); ctx.arc(cx, cy, R - 6, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#8a6a14';
  for (let i = 0; i < values.length; i++) {
    const a = i * step;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6), 6, 0, Math.PI * 2);
    ctx.fill();
  }
  // hub: red boss with a gold star
  ctx.fillStyle = '#c2183c';
  ctx.beginPath(); ctx.arc(cx, cy, 62, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#d4af37';
  ctx.beginPath(); ctx.arc(cx, cy, 62, 0, Math.PI * 2); ctx.stroke();
  star(ctx, cx, cy, 40, '#ffd23f');

  grain(ctx, S, S, 5);
  return toTexture(c);
}

/* ------------------------------------------------------------- lollipop ---- */

/** Big spiral candy lollipop head, transparent corners (use alphaTest). */
export function lollipopTexture(color = '#e02249') {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  // candy disc
  ctx.fillStyle = '#fff6ec';
  ctx.beginPath(); ctx.arc(cx, cy, 118, 0, Math.PI * 2); ctx.fill();
  // the swirl: one fat archimedean spiral stroke
  ctx.strokeStyle = color;
  ctx.lineWidth = 30;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const TURNS = 3.2;
  for (let t = 0; t <= 1; t += 0.01) {
    const a = t * TURNS * Math.PI * 2;
    const r = 4 + t * 104;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // gloss + outline
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.ellipse(cx - 40, cy - 48, 30, 18, -0.7, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(60,30,0,0.6)';
  ctx.beginPath(); ctx.arc(cx, cy, 118, 0, Math.PI * 2); ctx.stroke();
  grain(ctx, S, S, 5);
  return toTexture(c);
}

/* ------------------------------------------------------------ pip target ---- */

/** Small gold-rimmed precision bullseye — the sharpshooter's payout pip. */
export function pipTexture() {
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  bullseye(ctx, 64, 64, 58, ['#d4af37', '#f6ead7', '#e02249', '#f6ead7', '#e02249']);
  // gold rim highlight
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffe9a0';
  ctx.beginPath(); ctx.arc(64, 64, 52, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
  // navy compass dots so the twirl after a hit actually reads
  ctx.fillStyle = '#1d2a63';
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

/* ------------------------------------------------------------ BANG panel ---- */

/** Painted comic starburst panel with chunky BANG! lettering. */
export function bangTexture() {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  // cream board with a red frame
  ctx.fillStyle = '#f6ead7';
  ctx.fillRect(0, 0, S, S);
  ctx.lineWidth = 26;
  ctx.strokeStyle = '#c2183c';
  ctx.strokeRect(13, 13, S - 26, S - 26);
  // double starburst
  const burst = (r0, r1, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 28; i++) {
      const r = i % 2 ? r0 : r1 * (0.85 + ((i * 7919) % 13) / 40);
      const a = (i / 28) * Math.PI * 2;
      ctx.lineTo(256 + Math.cos(a) * r, 256 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  };
  burst(120, 235, '#e02249');
  burst(95, 185, '#ffd23f');
  // BANG!
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 118px ${DISPLAY_FONT}`;
  ctx.save();
  ctx.translate(256, 260);
  ctx.rotate(-0.08);
  ctx.fillStyle = 'rgba(60,20,0,0.6)';
  ctx.fillText('BANG!', 5, 7);
  ctx.fillStyle = '#1d2a63';
  ctx.fillText('BANG!', 0, 0);
  ctx.restore();
  grain(ctx, S, S, 6);
  return toTexture(c);
}

/* --------------------------------------------------------- bullet dent ---- */

/** Small grey dent + dark heart — the mark a gallery BB leaves in the paint. */
export function bulletHoleTexture() {
  const S = 64;
  const [c, ctx] = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(20,16,14,0.95)');
  g.addColorStop(0.3, 'rgba(60,52,46,0.8)');
  g.addColorStop(0.6, 'rgba(120,110,100,0.45)');
  g.addColorStop(1, 'rgba(120,110,100,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
  // bright chipped-paint flecks around the rim
  ctx.fillStyle = 'rgba(230,220,205,0.7)';
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.random() * 8;
    ctx.beginPath();
    ctx.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 1.6 + Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

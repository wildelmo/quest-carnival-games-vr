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
  // a couple of painted bullseyes on the hills (they're just decoration,
  // but they make the whole wall read TARGET RANGE at a glance)
  bullseye(ctx, W * 0.1, H * 0.78, 40);
  bullseye(ctx, W * 0.88, H * 0.8, 40);

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
 * kinds: 'duck' | 'rabbit' | 'bird' | 'star'.  gold: bonus paint job.
 */
export function targetTexture(kind, { gold = false } = {}) {
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
  } else {
    // spinner star: big gold star with a red bullseye heart
    star(ctx, 128, 128, 116, gold ? '#ffe9a0' : '#ffd23f', 'rgba(120,60,0,0.9)');
    star(ctx, 128, 128, 86, '#ffb300', 'rgba(0,0,0,0)');
    bullseye(ctx, 128, 128, 44);
  }

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

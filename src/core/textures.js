import * as THREE from 'three';

/**
 * All textures are generated on 2D canvas at load time — no image downloads,
 * small VRAM footprint, and easy to re-skin. Power-of-two sizes so mipmaps
 * work on Quest.
 *
 * TYPOGRAPHY: signs are painted with 'Rye' (a proper circus/western display
 * face) and scoreboards with 'VT323' (dot-matrix LED), both loaded from
 * Google Fonts by loadFonts() before the scene is built. Offline the canvas
 * falls back to Georgia — everything still renders.
 *
 * SURFACE FEEL: every texture gets film grain, fabric weave or wood grain
 * baked in, plus painted shading (seams, bevels, gradients). Combined with
 * ACES tone mapping and the env map this is what pulls the scene away from
 * "flat vector cartoon".
 */

export const DISPLAY_FONT = "'Rye', Georgia, 'Times New Roman', serif";
export const LED_FONT = "'VT323', ui-monospace, Menlo, monospace";

/** Fetch the display fonts (linked in index.html) before canvas painting. */
export async function loadFonts(timeoutMs = 3000) {
  if (!document.fonts?.load) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('64px Rye'),
        document.fonts.load('64px VT323'),
      ]),
      new Promise((res) => setTimeout(res, timeoutMs)),
    ]);
  } catch { /* offline → serif fallback, no harm */ }
}

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
  tex.anisotropy = 8;
  return tex;
}

/** Per-pixel film grain — kills the "solid vector fill" look. */
function grain(ctx, w, h, amp = 9) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 2 * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** Faint woven-canvas threads (horizontal + vertical). */
function weave(ctx, w, h, alpha = 0.05) {
  ctx.save();
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = `rgba(0,0,0,${(y % 6 ? 0.5 : 1) * alpha})`;
    ctx.fillRect(0, y, w, 1);
  }
  for (let x = 0; x < w; x += 3) {
    ctx.fillStyle = `rgba(255,255,255,${(x % 6 ? 0.4 : 1) * alpha * 0.7})`;
    ctx.fillRect(x, 0, 1, h);
  }
  ctx.restore();
}

/** Vertical big-top stripes (canopy walls, awnings) with real fabric feel. */
export function stripesTexture(colorA = '#c2183c', colorB = '#f6ead7', stripes = 8) {
  const [c, ctx] = makeCanvas(512, 512);
  const w = 512 / stripes;
  for (let i = 0; i < stripes; i++) {
    // each stripe is a subtle gradient, not a flat fill
    const g = ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
    const col = i % 2 ? colorB : colorA;
    g.addColorStop(0, col);
    g.addColorStop(0.5, col);
    g.addColorStop(1, col);
    ctx.fillStyle = col;
    ctx.fillRect(i * w, 0, w, 512);
    // seam shadow + highlight along each stripe boundary (stitched panels)
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(i * w, 0, 3, 512);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(i * w + 3, 0, 2, 512);
    // gentle curvature shading across the stripe (billowing canvas)
    const bg = ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
    bg.addColorStop(0, 'rgba(0,0,0,0.10)');
    bg.addColorStop(0.45, 'rgba(255,255,255,0.06)');
    bg.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = bg;
    ctx.fillRect(i * w, 0, w, 512);
  }
  // subtle fabric shading top-to-bottom
  const gradV = ctx.createLinearGradient(0, 0, 0, 512);
  gradV.addColorStop(0, 'rgba(0,0,0,0.14)');
  gradV.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  gradV.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = gradV;
  ctx.fillRect(0, 0, 512, 512);
  weave(ctx, 512, 512, 0.045);
  grain(ctx, 512, 512, 6);
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
    // panel seams with rope-line highlight
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(i * w, 0, 2, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(i * w + 2, 0, 1, 256);
    // billow shading within each wedge
    const bg = ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
    bg.addColorStop(0, 'rgba(0,0,0,0.12)');
    bg.addColorStop(0.5, 'rgba(255,255,255,0.07)');
    bg.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = bg;
    ctx.fillRect(i * w, 0, w, 256);
  }
  // darker toward the eaves for cozy interior lighting feel
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,236,200,0.10)'); // warm kiss at the peak
  grad.addColorStop(0.45, 'rgba(0,0,0,0.02)');
  grad.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 256);
  weave(ctx, 1024, 256, 0.04);
  grain(ctx, 1024, 256, 6);
  return toTexture(c);
}

/* --------------------------------------------------------------- wood ---- */

/** Shared plank painter: draws one wood tile into (ctx), and mirrors a
 *  matching gloss-variation tile into (rctx) when given (for roughnessMap). */
function paintPlanks(ctx, rctx, size, plankH, base) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  if (rctx) { rctx.fillStyle = 'rgb(110,110,110)'; rctx.fillRect(0, 0, size, size); }

  for (let y = 0; y < size; y += plankH) {
    // per-plank tint: hue + value jitter so no two boards match
    const warm = Math.random();
    ctx.fillStyle = `rgba(${warm > 0.5 ? 46 : 8},${(warm * 18) | 0},0,${0.06 + Math.random() * 0.16})`;
    ctx.fillRect(0, y, size, plankH);
    if (Math.random() < 0.3) { // the odd sun-bleached board
      ctx.fillStyle = `rgba(255,236,200,${0.04 + Math.random() * 0.05})`;
      ctx.fillRect(0, y, size, plankH);
    }
    if (rctx) { // per-plank varnish variation
      const v = 95 + (Math.random() * 55) | 0;
      rctx.fillStyle = `rgb(${v},${v},${v})`;
      rctx.fillRect(0, y, size, plankH);
    }
    // grain streaks
    for (let i = 0; i < size / 18; i++) {
      ctx.strokeStyle = `rgba(40,20,5,${0.05 + Math.random() * 0.12})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      const gy = y + Math.random() * plankH;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(size * 0.33, gy + Math.random() * 6 - 3,
        size * 0.66, gy + Math.random() * 6 - 3, size, gy);
      ctx.stroke();
    }
    // occasional knot
    if (Math.random() < 0.55) {
      const kx = Math.random() * size, ky = y + plankH * (0.3 + Math.random() * 0.4);
      for (let r = 6; r > 0; r -= 2) {
        ctx.strokeStyle = `rgba(30,12,2,${0.10 + (6 - r) * 0.04})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(kx, ky, r * 1.6, r, 0.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // seams: shadow line + bevel highlight below
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, y, size, 3);
    ctx.fillStyle = 'rgba(255,230,190,0.10)';
    ctx.fillRect(0, y + 3, size, 1);
    if (rctx) { rctx.fillStyle = 'rgb(215,215,215)'; rctx.fillRect(0, y, size, 3); }
    // board end-joints at random x
    const jx = Math.random() * size;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(jx, y, 3, plankH);
    ctx.fillStyle = 'rgba(255,230,190,0.08)';
    ctx.fillRect(jx + 3, y, 1, plankH);
    // a couple of nail heads by the seam
    ctx.fillStyle = 'rgba(15,10,8,0.55)';
    for (const nx of [size * 0.22, size * 0.74]) {
      ctx.beginPath();
      ctx.arc(nx + Math.random() * 20, y + 8, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Worn wooden floor planks (colour map only — kept for compatibility). */
export function woodTexture(base = '#8a5a33') {
  const [c, ctx] = makeCanvas(512, 512);
  paintPlanks(ctx, null, 512, 64, base);
  grain(ctx, 512, 512, 7);
  return toTexture(c, 6, 6);
}

/**
 * Varnished floor set: colour + roughness maps painted from the same plank
 * layout, so the sheen breaks along boards and seams. Feed a
 * MeshStandardMaterial (map, roughnessMap) — the env map does the rest.
 */
export function woodFloorMaps(base = '#7d5029', repeat = 5) {
  const [c, ctx] = makeCanvas(1024, 1024);
  const [rc, rctx] = makeCanvas(1024, 1024);
  paintPlanks(ctx, rctx, 1024, 128, base);
  grain(ctx, 1024, 1024, 7);
  const map = toTexture(c, repeat, repeat);
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(repeat, repeat);
  roughnessMap.anisotropy = 8;
  return { map, roughnessMap };
}

/** Diagonal candy stripes — wraps a cylinder into a barber pole. */
export function barberPoleTexture(colorA = '#c2183c', colorB = '#f6ead7') {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = colorB;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = colorA;
  const bandW = 64;
  for (let x = -256; x < 512; x += bandW * 2) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + bandW, 0);
    ctx.lineTo(x + bandW + 256, 256);
    ctx.lineTo(x + 256, 256);
    ctx.fill();
  }
  // rounded shading like a turned post
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.12)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  grain(ctx, 256, 256, 5);
  return toTexture(c, 1, 3);
}

/* --------------------------------------------------------------- signs ---- */

/**
 * Painted booth sign with bold circus lettering.
 * `rainbow: true` draws each letter in a different candy colour along a
 * gentle arch — the classic boardwalk "DOWN THE CLOWN" marquee look.
 * `bulbs: false` skips the painted bulb dots (booths mount REAL 3D chase
 * bulbs around the panel instead).
 */
export function signTexture(text, {
  bg = '#1d2a63', fg = '#ffd23f', accent = '#ff5d73', sub = '',
  rainbow = false, bulbs = true,
} = {}) {
  const [c, ctx] = makeCanvas(1024, 256);
  // enamel panel: vertical sheen gradient over the base colour
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 256);
  bgGrad.addColorStop(0, shade(bg, 1.35));
  bgGrad.addColorStop(0.4, bg);
  bgGrad.addColorStop(1, shade(bg, 0.55));
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1024, 256);

  // double border: dark gold outer, bright gold inner, pinstripe accent
  ctx.strokeStyle = '#6b5010';
  ctx.lineWidth = 18;
  ctx.strokeRect(9, 9, 1006, 238);
  ctx.strokeStyle = '#e9c14f';
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 996, 228);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(26, 26, 972, 204);
  // corner rosettes
  for (const [rx, ry] of [[26, 26], [998, 26], [26, 230], [998, 230]]) {
    ctx.fillStyle = '#e9c14f';
    ctx.beginPath(); ctx.arc(rx, ry, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a6a1a';
    ctx.beginPath(); ctx.arc(rx, ry, 5, 0, Math.PI * 2); ctx.fill();
  }

  if (bulbs) {
    for (let x = 60; x <= 964; x += 56.5) {
      for (const y of [38, 218]) {
        const g = ctx.createRadialGradient(x, y, 1, x, y, 13);
        g.addColorStop(0, '#fffdf0');
        g.addColorStop(0.4, '#ffe9a0');
        g.addColorStop(1, 'rgba(255,180,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mainY = sub ? 100 : 126;
  if (rainbow) {
    // per-letter colours on a shallow arch, slight per-letter tilt
    const letterColors = ['#ff3b30', '#ff9500', '#ffd23f', '#7ac74f', '#3aa0ff', '#b14fc9'];
    let size = sub ? 96 : 112;
    ctx.font = `${size}px ${DISPLAY_FONT}`;
    while (ctx.measureText(text).width > 880 && size > 40) {
      size -= 6;
      ctx.font = `${size}px ${DISPLAY_FONT}`;
    }
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
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(ch, 5, 7);
      if (ch !== ' ') {
        ctx.fillStyle = letterColors[i % letterColors.length];
        ctx.fillText(ch, 0, 0);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.strokeText(ch, 0, 0);
      }
      ctx.restore();
      x += widths[i];
    });
  } else {
    let size = sub ? 100 : 118;
    ctx.font = `${size}px ${DISPLAY_FONT}`;
    while (ctx.measureText(text).width > 900 && size > 40) {
      size -= 6;
      ctx.font = `${size}px ${DISPLAY_FONT}`;
    }
    // drop shadow, then warm two-tone fill with a dark keyline
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(text, 518, mainY + 8);
    const tg = ctx.createLinearGradient(0, mainY - 60, 0, mainY + 60);
    tg.addColorStop(0, shade(fg, 1.25));
    tg.addColorStop(0.55, fg);
    tg.addColorStop(1, shade(fg, 0.7));
    ctx.fillStyle = tg;
    ctx.fillText(text, 512, mainY);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(40,20,0,0.65)';
    ctx.strokeText(text, 512, mainY);
  }
  if (sub) {
    let subSize = 40;
    ctx.font = `${subSize}px ${DISPLAY_FONT}`;
    while (ctx.measureText(sub).width > 880 && subSize > 18) {
      subSize -= 3;
      ctx.font = `${subSize}px ${DISPLAY_FONT}`;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(sub, 514, 198);
    ctx.fillStyle = '#ffe9c9';
    ctx.fillText(sub, 512, 196);
  }
  grain(ctx, 1024, 256, 5);
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Face-material array for a BoxGeometry sign: texture on the front, painted
 * edges everywhere else (one texture across all six faces smears squished
 * letters along the box edges).
 */
export function signPanelMaterials(tex, edgeColor = 0x3a2a10) {
  const edge = new THREE.MeshLambertMaterial({ color: edgeColor });
  const front = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  return [edge, edge, edge, edge, front, edge];
}

/** lighten (f>1) / darken (f<1) a hex colour string */
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * f);
  c.g = Math.min(1, c.g * f);
  c.b = Math.min(1, c.b * f);
  return `#${c.getHexString()}`;
}

/** Striped floor mat with a star border for the booth throw line. */
export function throwMatTexture(color = '#c2183c') {
  const [c, ctx] = makeCanvas(512, 256);
  ctx.fillStyle = shade(color, 0.45);
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = shade(color, 1.3);
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, 488, 232);
  ctx.strokeStyle = 'rgba(255,233,201,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeRect(26, 26, 460, 204);
  ctx.fillStyle = 'rgba(255,233,201,0.9)';
  ctx.font = `44px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STEP RIGHT UP', 256, 128);
  // corner stars
  ctx.font = '36px Georgia, serif';
  for (const [x, y] of [[64, 66], [448, 66], [64, 190], [448, 190]]) {
    ctx.fillText('★', x, y);
  }
  grain(ctx, 512, 256, 8);
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
  // a few old dart holes — the board has seen some summers
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = 'rgba(35,20,8,0.65)';
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  grain(ctx, 256, 256, 6);
  return toTexture(c, 3, 3);
}

/** Radial darkening overlay for the floor — fake bounce-light occlusion
 *  where the boards meet the tent wall. */
export function floorVignetteTexture() {
  const [c, ctx] = makeCanvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 30, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.62, 'rgba(0,0,0,0)');
  g.addColorStop(0.88, 'rgba(10,2,4,0.28)');
  g.addColorStop(1, 'rgba(10,2,4,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const CARNIVAL_PALETTE = [
  0xe02249, 0xffd23f, 0x3aa0ff, 0x7ac74f, 0xff8c1a, 0xb14fc9, 0x2ee6d0, 0xff5d73,
];

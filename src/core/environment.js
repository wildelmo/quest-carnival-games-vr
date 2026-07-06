import * as THREE from 'three';

/**
 * environment.js — image-based lighting + shared "shiny" material factory.
 *
 * A tiny procedural scene (warm canopy, deep-red wall band, dark floor and a
 * handful of very bright bulb spheres) is baked once through PMREMGenerator
 * into an environment map. Glossy MeshStandardMaterials sample it for
 * reflections, which is what makes glass bottles, brass, balloons and buttons
 * actually GLINT under the tent lights instead of reading as flat cartoon
 * shading. Costs one small bake at boot and ~0 per frame.
 *
 * The env map is applied EXPLICITLY per material (never via scene.environment)
 * so the big matte surfaces — canvas walls, plush toys — stay cheap Lambert
 * with no accidental sheen.
 */

let _envMap = null;

/** Bake (once) and return the shared carnival environment map. */
export function initEnvironment(renderer) {
  if (_envMap) return _envMap;
  const scene = new THREE.Scene();
  const keep = [];
  const ball = (color, x, y, z, r) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshBasicMaterial({ color }),
    );
    m.material.color.setRGB(...color); // allow > 1 for bright emitters
    m.position.set(x, y, z);
    scene.add(m);
    keep.push(m);
  };

  // warm cream canopy dome all around
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(8, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xb89a6e, side: THREE.BackSide }),
  );
  scene.add(dome); keep.push(dome);
  // deep red band at the horizon = the striped drum wall
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(7.6, 7.6, 3.4, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x571523, side: THREE.BackSide }),
  );
  band.position.y = -1.1;
  scene.add(band); keep.push(band);
  // dark wooden floor
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(7.6, 24),
    new THREE.MeshBasicMaterial({ color: 0x1c0d06 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.6;
  scene.add(floor); keep.push(floor);

  // the big warm key "lamp" overhead — this is the main specular hotspot
  ball([9, 7.2, 4.6], 0, 6.5, 0, 1.5);
  // ring of coloured carnival bulbs around the upper hemisphere so glossy
  // things pick up little multicoloured glints
  const bulbColors = [
    [10, 3.5, 4.5], [10, 8, 2.5], [3, 7, 9], [7, 9, 3.5],
    [10, 5, 2], [9, 3, 7], [3.5, 9, 8], [10, 9, 6],
  ];
  bulbColors.forEach((c, i) => {
    const a = (i / bulbColors.length) * Math.PI * 2;
    ball(c, Math.sin(a) * 5.2, 2.6 + (i % 3) * 0.7, Math.cos(a) * 5.2, 0.3);
  });
  // faint cool bounce from below-front so undersides aren't dead black
  ball([1.2, 0.9, 0.8], 0, -2.2, 3.5, 1.4);

  const pmrem = new THREE.PMREMGenerator(renderer);
  _envMap = pmrem.fromScene(scene, 0.18).texture;
  pmrem.dispose();
  for (const m of keep) { m.geometry.dispose(); m.material.dispose(); }
  return _envMap;
}

export function getEnvMap() { return _envMap; }

/**
 * Glossy PBR material wired to the shared env map.
 * shiny({ color, roughness, metalness, envIntensity, ...MeshStandardMaterial })
 */
export function shiny({ envIntensity = 1, ...opts } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.35,
    metalness: 0,
    ...opts,
  });
  if (_envMap) {
    mat.envMap = _envMap;
    mat.envMapIntensity = envIntensity;
  }
  return mat;
}

/* ------------------------------------------------------------ glows ---- */

let _glowTex = null;

/** Soft radial sprite used for bulb halos, dust motes and glow markers. */
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

/**
 * One-draw-call halo cloud: camera-facing glow points at fixed positions
 * with per-point colours. Used behind every marquee/string-light bulb —
 * this is what makes them read as EMITTING light rather than being
 * brightly painted spheres.
 *
 * Returns { points, setColor(i, color), commit() }.
 */
export function makeGlowPoints(positions, { size = 0.16, opacity = 0.5 } = {}) {
  const n = positions.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  positions.forEach((p, i) => {
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size,
    map: glowTexture(),
    transparent: true,
    opacity,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const colorAttr = geo.getAttribute('color');
  return {
    points,
    setColor(i, c) { colorAttr.setXYZ(i, c.r, c.g, c.b); },
    commit() { colorAttr.needsUpdate = true; },
  };
}

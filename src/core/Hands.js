import * as THREE from 'three';

/**
 * Hands — big white carnival-performer gloves for your hands.
 *
 * Procedural like everything else: a puffy palm, three cartoon fingers and
 * a thumb built from capsules, and a flared cuff with a coloured band that
 * keeps the old handedness coding (blue left, orange right). The fingers
 * curl smoothly with the analog grip/trigger, snap around whatever you're
 * holding, and the cuff band glows when an empty hand is near something
 * grabbable (Grabbables sets hand.hoverGrab and adds a haptic tick).
 *
 * In XR a glove rides each controller grip; on desktop the same glove is
 * drawn at the virtual hand so that mode stops feeling like a ghost.
 */

const GLOVE_WHITE = 0xf2ece0;
const BAND_COLORS = { left: 0x2f6fff, right: 0xff7a30 };
const _vOffset = new THREE.Vector3();

// finger segment sizes (metres)
const SEG1 = { r: 0.0165, len: 0.034 };
const SEG2 = { r: 0.0155, len: 0.026 };

function capsuleAlongMinusZ({ r, len }) {
  const geo = new THREE.CapsuleGeometry(r, len, 3, 8);
  geo.rotateX(-Math.PI / 2);              // +Y -> -Z
  geo.translate(0, 0, -(len / 2 + r));    // base cap at the joint origin
  return geo;
}

/**
 * Build one glove. Returns { group, setCurl(k), setHover(on, t), curl }.
 * The group is oriented for a controller grip space: fingers reach along
 * -Z (away from the wrist) and curl toward the palm.
 */
function buildGlove(handedness) {
  const white = new THREE.MeshLambertMaterial({ color: GLOVE_WHITE });
  const group = new THREE.Group();
  group.name = `glove-${handedness}`;
  // tilt the whole hand the way a relaxed hand actually sits on the grip
  const wrap = new THREE.Group();
  wrap.rotation.x = 0.36;
  wrap.scale.setScalar(0.88);
  group.add(wrap);

  // palm — a squashed puffball
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 9), white);
  palm.scale.set(1.05, 0.6, 1.28);
  palm.position.set(0, -0.004, -0.004);
  wrap.add(palm);

  // snug cuff + a slim piped band (the handedness tell, and the hover lamp)
  const cuff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.05, 0.048, 12, 1, true),
    new THREE.MeshLambertMaterial({ color: GLOVE_WHITE, side: THREE.DoubleSide }),
  );
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, -0.002, 0.052);
  wrap.add(cuff);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.0465, 0.0048, 8, 20),
    new THREE.MeshLambertMaterial({
      color: 0x14161f,
      emissive: BAND_COLORS[handedness] ?? BAND_COLORS.right,
      emissiveIntensity: 0.55,
    }),
  );
  band.position.set(0, -0.003, 0.068);
  wrap.add(band);
  // wrist filling the cuff so it doesn't read as a hollow tube from behind
  const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), white);
  wrist.scale.set(1, 0.85, 1.4);
  wrist.position.set(0, -0.004, 0.055);
  wrap.add(wrist);

  // three cartoon fingers
  const fingers = [];
  for (const fx of [-0.027, 0, 0.027]) {
    const root = new THREE.Group();
    root.position.set(fx, 0.004, -0.052);
    root.rotation.y = -fx * 3;             // slight natural splay
    const seg1 = new THREE.Mesh(capsuleAlongMinusZ(SEG1), white);
    root.add(seg1);
    const mid = new THREE.Group();
    mid.position.set(0, 0, -(SEG1.len + SEG1.r * 2) + 0.004);
    mid.add(new THREE.Mesh(capsuleAlongMinusZ(SEG2), white));
    root.add(mid);
    wrap.add(root);
    fingers.push({ root, mid });
  }

  // thumb — one stubby segment + tip, off the palm's side
  const side = handedness === 'left' ? -1 : 1;
  const thumbRoot = new THREE.Group();
  thumbRoot.position.set(side * 0.04, -0.006, -0.018);
  thumbRoot.rotation.y = side * 0.95;
  const thumb = new THREE.Mesh(capsuleAlongMinusZ({ r: 0.017, len: 0.024 }), white);
  thumbRoot.add(thumb);
  const thumbMid = new THREE.Group();
  thumbMid.position.set(0, 0, -0.05);
  thumbMid.add(new THREE.Mesh(capsuleAlongMinusZ({ r: 0.0155, len: 0.014 }), white));
  thumbRoot.add(thumbMid);
  wrap.add(thumbRoot);

  return {
    group,
    curl: 0.2,
    setCurl(k) {
      this.curl = k;
      for (const f of fingers) {
        f.root.rotation.x = -(0.16 + k * 1.22);
        f.mid.rotation.x = -(0.1 + k * 1.42);
      }
      thumbRoot.rotation.x = -(0.08 + k * 0.55);
      thumbRoot.rotation.y = side * (0.95 - k * 0.4);
      thumbMid.rotation.x = -(0.06 + k * 0.7);
    },
    setHover(on, t) {
      band.material.emissiveIntensity = on ? 0.6 + 0.35 * Math.sin(t * 9) : 0.3;
    },
  };
}

export class Hands {
  /**
   * @param {import('./World.js').World} world
   * @param {import('./Input.js').Input} input
   * @param {import('./Grabbables.js').Grabbables} grabbables
   */
  constructor(world, input, grabbables) {
    this.world = world;
    this.input = input;
    this.grabbables = grabbables;
    this._gloves = [null, null];
    this._desktop = null;
    world.onUpdate((dt, t) => this.#update(dt, t));
  }

  #ease(glove, target, dt) {
    glove.setCurl(THREE.MathUtils.lerp(glove.curl, target, Math.min(1, dt * 14)));
  }

  #update(dt, t) {
    if (this.input.isXR) {
      if (this._desktop) this._desktop.group.visible = false;
      for (const hand of this.input.hands) {
        let glove = this._gloves[hand.index];
        if (!hand.connected || !hand.handedness) {
          if (glove) glove.group.visible = false;
          continue;
        }
        if (!glove) {
          glove = this._gloves[hand.index] = buildGlove(hand.handedness);
          hand._grip.add(glove.group);
        }
        glove.group.visible = true;
        const holding = !!this.grabbables.held[hand.index];
        const target = holding ? 0.72
          : 0.15 + Math.max(hand.gripValue, hand.triggerValue) * 0.85;
        this.#ease(glove, target, dt);
        glove.setHover(hand.hoverGrab, t);
      }
    } else {
      // desktop: the same glove, riding the virtual hand — drawn a touch
      // smaller and lower so it sits in the corner of the view like a hand,
      // not in the middle of it
      if (!this._desktop) {
        this._desktop = buildGlove('right');
        this._desktop.group.scale.setScalar(0.8);
        this.world.scene.add(this._desktop.group);
      }
      const glove = this._desktop;
      const hand = this.input.desktopHand;
      glove.group.visible = this.input.pointerLocked;
      glove.group.quaternion.copy(hand.gripQuaternion);
      glove.group.position.copy(_vOffset.set(0.05, -0.05, 0)
        .applyQuaternion(hand.gripQuaternion).add(hand.gripPosition));
      const holding = !!this.grabbables.held[hand.index];
      this.#ease(glove, holding ? 0.72 : 0.22, dt);
      glove.setHover(hand.hoverGrab, t);
    }
  }
}

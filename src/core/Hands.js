import * as THREE from 'three';

/**
 * Hands — big white carnival-performer gloves for your hands.
 *
 * Procedural like everything else: a puffy palm, three cartoon fingers and
 * a thumb built from capsules, and a flared cuff with a coloured band that
 * keeps the old handedness coding (blue left, orange right). The fingers
 * curl smoothly with the analog grip/trigger, snap around whatever you're
 * holding — or into a dart-throw pinch (holdPose: 'pinch') or a
 * trigger-finger pistol grip (holdPose: 'pistol') when the held object
 * asks for it — and the cuff band glows when an empty hand is near
 * something grabbable (Grabbables sets hand.hoverGrab and adds a haptic
 * tick).
 *
 * In XR a glove rides each controller grip; on desktop the same glove is
 * drawn at the virtual hand so that mode stops feeling like a ghost.
 */

const GLOVE_WHITE = 0xf2ece0;
const BAND_COLORS = { left: 0x2f6fff, right: 0xff7a30 };
const _vOffset = new THREE.Vector3();

/**
 * Grip-space alignment.
 *
 * The glove is modelled in a plain "hand flat on a table" space: fingers
 * reach along -Z, the palm faces -Y, the wrist/cuff sits toward +Z, and the
 * thumb hangs off -X for the right hand / +X for the left (hold your right
 * hand out palm-down: the thumb is on the left).
 *
 * WebXR's grip space (which mirrors OpenXR's grip pose) is anatomical, not
 * screen-like: the origin sits at the fist centroid, +X is the palm normal
 * (the LEFT palm faces +X, the RIGHT palm faces -X), and -Z runs through
 * the fist from little finger to thumb — with your hand in a handshake
 * pose, -Z points straight up out of the top of your fist and the extended
 * fingers point along -Y. Attaching the model unrotated therefore draws the
 * fingers sticking straight UP with the palm facing forward — the classic
 * "peace sign glove" bug. These bases rotate model axes onto grip axes so
 * the glove lies over the real hand: fingers land on -Y (out past the
 * knuckles), the palm on the correct ∓X side, the thumb on -Z (up, by the
 * thumbstick), and the finger-curl hinge (model X) lands on grip Z so
 * curling fingers wrap around the controller handle like a real grip.
 *
 * On top of that, REST_PITCH tips the whole glove up: the grip pose is
 * anchored to the controller handle rather than the knuckle line, so a
 * glove mapped flat onto -Y reads with its fingertips drooping ~30° toward
 * the floor in a handshake pose. The correction swings the fingers from -Y
 * toward -Z (thumb-side "up") — a rotation about the palm-normal X axis,
 * which is the same axis for both hands in grip space, so one quaternion
 * mirrors correctly onto both.
 */
export const REST_PITCH_DEG = 30; // shared with Grabbables' hold anchors
const REST_PITCH = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(REST_PITCH_DEG));
export const GRIP_ALIGN = {
  right: REST_PITCH.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, 1),    // model +X (across the knuckles) → grip +Z
      new THREE.Vector3(1, 0, 0),    // model +Y (back of hand)        → grip +X
      new THREE.Vector3(0, 1, 0),    // model +Z (toward the wrist)    → grip +Y
    ))),
  left: REST_PITCH.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, -1),   // model +X (across the knuckles) → grip -Z
      new THREE.Vector3(-1, 0, 0),   // model +Y (back of hand)        → grip -X
      new THREE.Vector3(0, 1, 0),    // model +Z (toward the wrist)    → grip +Y
    ))),
};

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
 * The dart-throw pinch, blended in by setPose(curl, pinch): index and
 * middle lean together (the yaw targets) and curl their pads onto the
 * barrel from one side, the thumb arcs OUT around the other side in the
 * open "reverse C" a real hand makes — explicit joint angles, because its
 * curl track (splay easing toward the fingers as it folds) can only sweep
 * flat across the palm, which reads as no thumb at all — and the outer
 * finger trails relaxed underneath.
 *
 * Tuned VISUALLY in /hand-lab.html (dev-only page: real glove + real dart
 * + these exact transforms, orbit camera, sliders for every number here
 * and a live clearance readout). If the grip ever needs adjusting, do it
 * there and copy the numbers back — don't guess in the dark: the matching
 * dart anchor lives in BalloonDartGame's holdOffset.
 */
export const PINCH = {
  finger: { index: 0.55, middle: 0.60, outer: 0.28 },
  // lateral lean toward the thumb so index + middle bunch together on the
  // barrel (canonical right-hand radians; mirrors via -side, like the thumb)
  yaw: { index: 0.18, middle: 0.30, outer: 0 },
  // canonical thumb pose (right hand) — arced out around the barrel in the
  // open "reverse C", NOT swept flat across the palm
  thumb: { rootX: -0.28, yaw: 0.45, midX: -0.40 },
};

/**
 * The six-shooter grip (holdPose: 'pistol'): middle and outer fingers wrap
 * the handle, the thumb locks over the back, and the index finger rests on
 * the trigger — Hands nudges `finger.index` live from the hand's analog
 * trigger each frame, so the visible finger squeezes with the real one.
 */
export const PISTOL = {
  finger: { index: 0.18, middle: 0.92, outer: 0.98 },
  yaw: { index: 0, middle: 0, outer: 0 },
  thumb: { rootX: -0.62, yaw: 0.28, midX: -0.85 },
};

/**
 * Build one glove. Returns { group, setPose(curl, pinch), setHover(on, t),
 * curl, pinch }. The group is in model space — fingers along -Z, palm
 * facing -Y, wrist at +Z (see GRIP_ALIGN, which maps this onto XR grip
 * space).
 */
export function buildGlove(handedness) {
  const white = new THREE.MeshLambertMaterial({ color: GLOVE_WHITE });
  const group = new THREE.Group();
  group.name = `glove-${handedness}`;
  const wrap = new THREE.Group();
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
    const baseYaw = -fx * 3;               // slight natural splay
    root.rotation.y = baseYaw;
    const seg1 = new THREE.Mesh(capsuleAlongMinusZ(SEG1), white);
    root.add(seg1);
    const mid = new THREE.Group();
    mid.name = `fingerMid${fingers.length}`;
    mid.position.set(0, 0, -(SEG1.len + SEG1.r * 2) + 0.004);
    mid.add(new THREE.Mesh(capsuleAlongMinusZ(SEG2), white));
    root.add(mid);
    wrap.add(root);
    fingers.push({ root, mid, baseYaw });
  }

  // thumb — one stubby segment + tip, off the palm's side. In model space
  // (palm down, fingers away from you) the RIGHT hand's thumb is on the -X
  // side and the LEFT hand's on +X — getting this backwards is what makes
  // gloves read as swapped hands.
  const side = handedness === 'left' ? 1 : -1;
  const thumbRoot = new THREE.Group();
  thumbRoot.position.set(side * 0.04, -0.006, -0.018);
  thumbRoot.rotation.y = -side * 0.95;   // splay outward, away from the palm
  const thumb = new THREE.Mesh(capsuleAlongMinusZ({ r: 0.017, len: 0.024 }), white);
  thumbRoot.add(thumb);
  const thumbMid = new THREE.Group();
  thumbMid.name = 'thumbMid';
  thumbMid.position.set(0, 0, -0.05);
  thumbMid.add(new THREE.Mesh(capsuleAlongMinusZ({ r: 0.0155, len: 0.014 }), white));
  thumbRoot.add(thumbMid);
  wrap.add(thumbRoot);

  // which of the three cartoon fingers plays the index (nearest the thumb):
  // fingers[] runs -X to +X and the thumb sits on -X right / +X left
  const indexAt = handedness === 'left' ? 2 : 0;

  return {
    group,
    curl: 0.2,
    pinch: 0,
    setPose(k, pinch = 0, poseDef = PINCH) {
      this.curl = k;
      this.pinch = pinch;
      const lerp = THREE.MathUtils.lerp;
      for (let i = 0; i < 3; i++) {
        const role = i === indexAt ? 'index' : i === 1 ? 'middle' : 'outer';
        const fk = lerp(k, poseDef.finger[role], pinch);
        const f = fingers[i];
        f.root.rotation.x = -(0.16 + fk * 1.22);
        f.root.rotation.y = lerp(f.baseYaw, -side * poseDef.yaw[role], pinch);
        f.mid.rotation.x = -(0.1 + fk * 1.42);
      }
      // the thumb opposes: as the fingers close it sweeps in across the
      // palm (yaw eases toward the fingers) AND folds down over whatever
      // is held, so a full grab reads as a real grip, not four hooks —
      // and blends to the explicit pose while a dart or gun is held
      thumbRoot.rotation.x = lerp(-(0.08 + k * 1.0), poseDef.thumb.rootX, pinch);
      thumbRoot.rotation.y = -side * lerp(0.95 - k * 0.75, poseDef.thumb.yaw, pinch);
      thumbMid.rotation.x = lerp(-(0.06 + k * 1.05), poseDef.thumb.midX, pinch);
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

  #ease(glove, curl, pinch, dt, poseDef) {
    const k = Math.min(1, dt * 14);
    glove.setPose(
      THREE.MathUtils.lerp(glove.curl, curl, k),
      THREE.MathUtils.lerp(glove.pinch, pinch, k),
      poseDef,
    );
  }

  /** named-pose blend for a held object: which explicit pose and how much */
  #poseFor(held, hand) {
    if (held?.holdPose === 'pistol') {
      // the visible trigger finger follows the real analog trigger
      PISTOL.finger.index = 0.18 + (hand?.triggerValue ?? 0) * 0.45;
      return { def: PISTOL, amount: 1 };
    }
    if (held?.holdPose === 'pinch') return { def: PINCH, amount: 1 };
    return { def: PINCH, amount: 0 };
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
          // rotate the model onto the anatomical grip frame (see GRIP_ALIGN);
          // the desktop glove below skips this — its quaternion is copied
          // from the camera every frame, where model space already reads as
          // a natural held-out hand
          glove.group.quaternion.copy(GRIP_ALIGN[hand.handedness] ?? GRIP_ALIGN.right);
          hand._grip.add(glove.group);
        }
        glove.group.visible = true;
        // curl to the held object's own grip (a fat ball keeps the fist
        // wider open than a pinched dart) instead of one canned fist; a
        // holdPose of 'pinch' blends the fingers into the dart-throw ring
        const held = this.grabbables.held[hand.index];
        const target = held ? held.holdCurl
          : 0.15 + Math.max(hand.gripValue, hand.triggerValue) * 0.85;
        const pose = this.#poseFor(held, hand);
        this.#ease(glove, target, pose.amount, dt, pose.def);
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
      const held = this.grabbables.held[hand.index];
      const pose = this.#poseFor(held, hand);
      this.#ease(glove, held ? held.holdCurl : 0.22, pose.amount, dt, pose.def);
      glove.setHover(hand.hoverGrab, t);
    }
  }
}

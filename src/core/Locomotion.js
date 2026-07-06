import * as THREE from 'three';

/**
 * Locomotion — comfort-first movement inside the tent.
 *
 *  - Left stick: smooth walk (head-relative, capped speed)
 *  - Right stick left/right: 30° snap turns
 *  - Right stick forward: hold to aim a teleport arc, release to jump
 *  - Desktop: WASD relative to the camera
 *
 * Movement is clamped to the tent floor (circle) so you can't wander
 * through the canvas walls or into the booths.
 */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _head = new THREE.Vector3();

const WALK_SPEED = 2.2;       // m/s
const SNAP_ANGLE = Math.PI / 6;
const STICK_DEAD = 0.15;
const TENT_RADIUS = 5.6;      // walkable radius (tent is bigger; booths block edges)

export class Locomotion {
  /**
   * @param {import('./World.js').World} world
   * @param {import('./Input.js').Input} input
   */
  constructor(world, input) {
    this.world = world;
    this.input = input;
    /** extra no-go zones (booth interiors) as XZ rectangles {minX,maxX,minZ,maxZ} */
    this.blockers = [];
    this._snapReady = true;
    this._teleporting = false;

    this.#buildTeleportArc();
    world.onUpdate((dt) => this.#update(dt));
  }

  addBlocker(minX, maxX, minZ, maxZ) {
    this.blockers.push({ minX, maxX, minZ, maxZ });
  }

  #buildTeleportArc() {
    // dashed arc = 24 small glowing spheres, plus a landing ring
    const geo = new THREE.SphereGeometry(0.02, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x2ee6d0 });
    this.arcDots = new THREE.InstancedMesh(geo, mat, 24);
    this.arcDots.visible = false;
    this.arcDots.frustumCulled = false;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.26, 24),
      new THREE.MeshBasicMaterial({ color: 0x2ee6d0, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.world.scene.add(this.arcDots, this.ring);
  }

  #positionAllowed(x, z) {
    if (Math.hypot(x, z) > TENT_RADIUS) return false;
    for (const b of this.blockers) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return false;
    }
    return true;
  }

  #update(dt) {
    if (this.input.isXR) this.#updateXR(dt);
    else this.#updateDesktop(dt);
  }

  #moveRig(dx, dz) {
    const rig = this.world.rig;
    // clamp against tent + booth blockers using the HEAD position, since in
    // XR the player can be physically offset from the rig origin
    this.world.getHeadPosition(_head);
    const nx = _head.x + dx, nz = _head.z + dz;
    if (this.#positionAllowed(nx, _head.z)) rig.position.x += dx;
    if (this.#positionAllowed(_head.x, nz)) rig.position.z += dz;
  }

  #updateXR(dt) {
    const { hands } = this.input;
    // hands may map either way; use handedness when known
    let left = hands[0], right = hands[1];
    if (hands[0].handedness === 'right' || hands[1].handedness === 'left') {
      left = hands[1]; right = hands[0];
    }

    // ---- smooth walk (left stick), head-relative
    if (Math.abs(left.stick.x) > STICK_DEAD || Math.abs(left.stick.y) > STICK_DEAD) {
      const head = this.world.camera;
      _v1.set(left.stick.x, 0, left.stick.y);
      // rotate by camera yaw only
      _v2.set(0, 0, -1).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
      const yaw = Math.atan2(_v2.x, _v2.z) + Math.PI;
      _v1.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      this.#moveRig(_v1.x * WALK_SPEED * dt, _v1.z * WALK_SPEED * dt);
    }

    // ---- snap turn (right stick x)
    if (Math.abs(right.stick.x) > 0.6) {
      if (this._snapReady) {
        this._snapReady = false;
        this.#snapTurn(-Math.sign(right.stick.x) * SNAP_ANGLE);
      }
    } else if (Math.abs(right.stick.x) < 0.3) {
      this._snapReady = true;
    }

    // ---- teleport (right stick pushed forward)
    const aiming = right.stick.y < -0.55 && right.connected;
    if (aiming) {
      this._teleporting = true;
      this.#showArc(right);
    } else if (this._teleporting) {
      this._teleporting = false;
      this.arcDots.visible = this.ring.visible = false;
      if (this._arcTarget) {
        // move rig so the HEAD lands on the target
        this.world.getHeadPosition(_head);
        const rig = this.world.rig;
        rig.position.x += this._arcTarget.x - _head.x;
        rig.position.z += this._arcTarget.z - _head.z;
        this._arcTarget = null;
      }
    }
  }

  /** rotate the rig around the player's head, not the rig origin */
  #snapTurn(angle) {
    const rig = this.world.rig;
    this.world.getHeadPosition(_head);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    rig.position.sub(_head);
    rig.position.applyQuaternion(q);
    rig.position.add(_head);
    rig.quaternion.premultiply(q);
  }

  /** Ballistic arc from the right controller; marks valid landing spots. */
  #showArc(hand) {
    const origin = hand.gripPosition;
    _v1.set(0, 0, -1).applyQuaternion(hand.gripQuaternion).multiplyScalar(6);
    _v1.y += 2.2; // loft
    const g = -9.8;
    let target = null;
    const m = new THREE.Matrix4();
    for (let i = 0; i < 24; i++) {
      const t = i * 0.05;
      _v2.set(
        origin.x + _v1.x * t,
        origin.y + _v1.y * t + 0.5 * g * t * t,
        origin.z + _v1.z * t,
      );
      if (_v2.y <= 0.02 && !target) {
        target = { x: _v2.x, z: _v2.z };
        _v2.y = 0.02;
      }
      m.setPosition(_v2);
      this.arcDots.setMatrixAt(i, m);
    }
    this.arcDots.instanceMatrix.needsUpdate = true;
    this.arcDots.visible = true;

    const ok = target && this.#positionAllowed(target.x, target.z);
    this.ring.visible = !!target;
    if (target) {
      this.ring.position.set(target.x, 0.03, target.z);
      this.ring.material.color.set(ok ? 0x2ee6d0 : 0xe02249);
    }
    this._arcTarget = ok ? target : null;
  }

  #updateDesktop(dt) {
    const keys = this.input.keys;
    if (!this.input.pointerLocked) return;
    _v1.set(
      (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      0,
      (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0),
    );
    if (_v1.lengthSq() === 0) return;
    _v1.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.input.look.yaw);
    const speed = keys.has('ShiftLeft') ? WALK_SPEED * 1.8 : WALK_SPEED;
    this.#moveRig(_v1.x * speed * dt, _v1.z * speed * dt);
  }
}

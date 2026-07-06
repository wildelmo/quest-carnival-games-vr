import * as THREE from 'three';

/**
 * Lightweight custom physics tuned for a carnival arcade on Quest.
 *
 * Scope (deliberately small — no general-purpose engine needed):
 *  - Dynamic bodies are SPHERES only (softballs, skee-balls…). Darts fly
 *    ballistically but are handled by their game via swept raycasts.
 *  - Static colliders are oriented BOXES plus one infinite floor plane (y=0).
 *  - Sphere<->sphere collision so balls pile up in the tray.
 *  - Zones: axis-aligned regions that apply forces (gutter conveyors etc).
 *
 * Everything is fixed-timestep (see World) and allocation-free per frame.
 */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

export class SphereBody {
  /**
   * @param {THREE.Object3D} object visual to sync (position + rolling rotation)
   * @param {number} radius meters
   */
  constructor(object, radius, opts = {}) {
    this.object = object;
    this.radius = radius;
    this.position = new THREE.Vector3().copy(object.position);
    this.velocity = new THREE.Vector3();
    this.spinAxis = new THREE.Vector3(1, 0, 0); // visual rolling axis
    this.spinSpeed = 0;                          // rad/s
    this.restitution = opts.restitution ?? 0.55;
    this.friction = opts.friction ?? 0.25;       // tangential damping on bounce
    this.rollFriction = opts.rollFriction ?? 0.6; // decel (m/s^2) while rolling
    this.linearDamping = opts.linearDamping ?? 0.02;
    this.enabled = true;      // false while held in a hand
    this.asleep = false;
    this._stillTime = 0;
    this.grounded = false;
    /** fired as (impactSpeed, otherTag) on significant contacts */
    this.onImpact = null;
    this.tag = opts.tag || 'ball';
  }

  /** Teleport the body (e.g. respawn into the tray). */
  warp(pos) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.asleep = false;
    this._stillTime = 0;
    this.object.position.copy(pos);
  }

  wake() { this.asleep = false; this._stillTime = 0; }
}

/** Oriented static box collider. */
export class BoxCollider {
  /**
   * @param {THREE.Vector3} center world center
   * @param {THREE.Vector3} halfExtents half sizes along local axes
   * @param {THREE.Quaternion} [quaternion] orientation (default identity)
   */
  constructor(center, halfExtents, quaternion, opts = {}) {
    this.center = center.clone();
    this.half = halfExtents.clone();
    this.quaternion = quaternion ? quaternion.clone() : new THREE.Quaternion();
    this.invQuaternion = this.quaternion.clone().invert();
    this.restitution = opts.restitution ?? 0.4;
    this.enabled = true;
    this.tag = opts.tag || 'wall';
    /** optional (body, impactSpeed) callback, e.g. knockdown targets */
    this.onHit = opts.onHit || null;
  }

  setTransform(center, quaternion) {
    this.center.copy(center);
    if (quaternion) {
      this.quaternion.copy(quaternion);
      this.invQuaternion.copy(quaternion).invert();
    }
  }
}

/**
 * Oriented force region — used for gutter conveyors / ball-return grates.
 * `force` is a world-space acceleration applied while a body is inside.
 */
export class ForceZone {
  /**
   * @param {THREE.Vector3} center world centre
   * @param {THREE.Vector3} halfExtents half sizes along local axes
   * @param {THREE.Quaternion|null} quaternion orientation
   * @param {THREE.Vector3} force world m/s^2
   */
  constructor(center, halfExtents, quaternion, force, opts = {}) {
    this.center = center.clone();
    this.half = halfExtents.clone();
    this.invQuaternion = (quaternion ? quaternion.clone() : new THREE.Quaternion()).invert();
    this.force = force.clone();
    this.maxSpeed = opts.maxSpeed ?? 2.0; // don't accelerate past this along `force`
    this.enabled = true;
    this.onEnter = opts.onEnter || null;
    this._inside = new Set();
  }

  contains(p) {
    _vz.copy(p).sub(this.center).applyQuaternion(this.invQuaternion);
    return Math.abs(_vz.x) <= this.half.x && Math.abs(_vz.y) <= this.half.y && Math.abs(_vz.z) <= this.half.z;
  }
}
const _vz = new THREE.Vector3(); // dedicated temp: contains() is called mid-integration

export class Physics {
  constructor() {
    this.gravity = -9.81;
    this.bodies = [];
    this.colliders = [];
    this.zones = [];
    this.floorY = 0;
    this.floorRestitution = 0.45;
    /** balls falling below this are lost -> game decides what to do */
    this.killY = -3;
    this.onBodyLost = null;
    /** soft circular boundary (the tent wall) — bodies bounce back inside */
    this.boundsRadius = 0;
  }

  addBody(b) { this.bodies.push(b); return b; }
  addCollider(c) { this.colliders.push(c); return c; }
  addZone(z) { this.zones.push(z); return z; }
  removeBody(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); }

  /** Helper: build a BoxCollider straight from a mesh's world transform + size. */
  colliderFromMesh(mesh, size, opts) {
    mesh.updateWorldMatrix(true, false);
    const c = new BoxCollider(
      mesh.getWorldPosition(_v1),
      _v2.set(size.x / 2, size.y / 2, size.z / 2),
      mesh.getWorldQuaternion(_q1),
      opts,
    );
    return this.addCollider(c);
  }

  step(dt) {
    for (const body of this.bodies) {
      if (!body.enabled || body.asleep) continue;
      this.#integrate(body, dt);
    }
    // sphere <-> sphere (few dynamic bodies; O(n^2) is fine)
    for (let i = 0; i < this.bodies.length; i++) {
      const a = this.bodies[i];
      if (!a.enabled) continue;
      for (let j = i + 1; j < this.bodies.length; j++) {
        const b = this.bodies[j];
        if (!b.enabled) continue;
        this.#sphereSphere(a, b);
      }
    }
    // sync visuals
    for (const body of this.bodies) {
      if (!body.enabled) continue;
      body.object.position.copy(body.position);
      if (body.spinSpeed > 0.05) {
        // integrate a visual rolling rotation (not simulated — looks right)
        _q1.setFromAxisAngle(body.spinAxis, body.spinSpeed * dt);
        body.object.quaternion.premultiply(_q1);
      }
    }
  }

  #integrate(body, dt) {
    const v = body.velocity;
    v.y += this.gravity * dt;
    v.multiplyScalar(1 - body.linearDamping * dt);

    // force zones
    for (const zone of this.zones) {
      if (!zone.enabled) continue;
      const inside = zone.contains(body.position);
      if (inside) {
        if (!zone._inside.has(body)) {
          zone._inside.add(body);
          if (zone.onEnter) zone.onEnter(body);
        }
        _v1.copy(zone.force).multiplyScalar(dt);
        // only push up to maxSpeed along the force direction
        _v2.copy(zone.force).normalize();
        if (v.dot(_v2) < zone.maxSpeed) v.add(_v1);
      } else {
        zone._inside.delete(body);
      }
    }

    body.position.addScaledVector(v, dt);
    body.grounded = false;

    // floor plane
    if (body.position.y - body.radius < this.floorY) {
      body.position.y = this.floorY + body.radius;
      this.#bounce(body, _v1.set(0, 1, 0), this.floorRestitution, 'floor');
      body.grounded = true;
    }

    // static boxes
    for (const col of this.colliders) {
      if (!col.enabled) continue;
      this.#sphereBox(body, col);
    }

    // rolling behaviour when touching ground
    if (body.grounded) {
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0.001) {
        const dec = Math.min(body.rollFriction * dt, speed);
        v.x -= (v.x / speed) * dec;
        v.z -= (v.z / speed) * dec;
        // visual spin: axis = up x velocity, speed = |v| / r
        body.spinAxis.set(v.z, 0, -v.x).normalize();
        body.spinSpeed = speed / body.radius;
      } else {
        body.spinSpeed = 0;
      }
      // settle: kill tiny vertical jitter
      if (Math.abs(v.y) < 0.35) v.y = 0;
    } else {
      body.spinSpeed *= 1 - 0.5 * dt; // air: spin decays slowly
    }

    // sleeping
    if (body.velocity.lengthSq() < 0.0004 && body.grounded) {
      body._stillTime += dt;
      if (body._stillTime > 0.6) body.asleep = true;
    } else {
      body._stillTime = 0;
    }

    // tent-wall containment: reflect back toward the centre
    if (this.boundsRadius > 0) {
      const r = Math.hypot(body.position.x, body.position.z);
      if (r > this.boundsRadius) {
        _v1.set(-body.position.x / r, 0, -body.position.z / r); // inward normal
        body.position.x = _v1.x * -this.boundsRadius;
        body.position.z = _v1.z * -this.boundsRadius;
        this.#bounce(body, _v1, 0.3, 'canvas');
      }
    }

    if (body.position.y < this.killY && this.onBodyLost) this.onBodyLost(body);
  }

  /** Reflect velocity around contact normal with restitution + friction. */
  #bounce(body, normal, restitution, tag, collider = null) {
    const v = body.velocity;
    const vn = v.dot(normal);
    if (vn >= 0) return;
    const impact = -vn;
    // normal reflection
    v.addScaledVector(normal, -(1 + restitution) * vn);
    // tangential friction
    _v3.copy(normal).multiplyScalar(v.dot(normal));
    _v2.copy(v).sub(_v3); // tangential component
    v.addScaledVector(_v2, -body.friction * Math.min(1, impact));
    if (impact > 0.7 && body.onImpact) body.onImpact(impact, tag);
    if (collider && collider.onHit && impact > 0.4) collider.onHit(body, impact);
  }

  #sphereBox(body, col) {
    // to box local space
    _v1.copy(body.position).sub(col.center).applyQuaternion(col.invQuaternion);
    const h = col.half, r = body.radius;
    // quick reject
    if (Math.abs(_v1.x) > h.x + r || Math.abs(_v1.y) > h.y + r || Math.abs(_v1.z) > h.z + r) return;
    // closest point on box (local)
    _v2.set(
      Math.max(-h.x, Math.min(h.x, _v1.x)),
      Math.max(-h.y, Math.min(h.y, _v1.y)),
      Math.max(-h.z, Math.min(h.z, _v1.z)),
    );
    _v3.copy(_v1).sub(_v2);
    const d2 = _v3.lengthSq();
    if (d2 >= r * r) return;

    let normalLocal;
    if (d2 > 1e-10) {
      // sphere centre outside the box: push out along centre - closest point
      normalLocal = _v3.multiplyScalar(1 / Math.sqrt(d2));
    } else {
      // centre inside: push out along the axis of least penetration
      const dx = h.x - Math.abs(_v1.x), dy = h.y - Math.abs(_v1.y), dz = h.z - Math.abs(_v1.z);
      if (dx < dy && dx < dz) normalLocal = _v3.set(Math.sign(_v1.x) || 1, 0, 0);
      else if (dy < dz) normalLocal = _v3.set(0, Math.sign(_v1.y) || 1, 0);
      else normalLocal = _v3.set(0, 0, Math.sign(_v1.z) || 1);
    }
    const dist = d2 > 1e-10 ? Math.sqrt(d2) : 0;

    // world-space normal + positional correction
    const normal = normalLocal.applyQuaternion(col.quaternion); // reuses _v3
    body.position.addScaledVector(normal, r - dist);
    this.#bounce(body, normal, col.restitution, col.tag, col);
    if (normal.y > 0.5) body.grounded = true;
    body.wake();
  }

  #sphereSphere(a, b) {
    _v1.copy(b.position).sub(a.position);
    const rSum = a.radius + b.radius;
    const d2 = _v1.lengthSq();
    if (d2 >= rSum * rSum || d2 < 1e-10) return;
    const d = Math.sqrt(d2);
    const normal = _v1.multiplyScalar(1 / d);
    const overlap = rSum - d;
    // separate equally
    a.position.addScaledVector(normal, -overlap / 2);
    b.position.addScaledVector(normal, overlap / 2);
    // impulse along normal (equal masses)
    _v2.copy(a.velocity).sub(b.velocity);
    const vn = _v2.dot(normal);
    if (vn > 0) {
      const rest = Math.min(a.restitution, b.restitution) * 0.8;
      const impulse = (1 + rest) * vn / 2;
      a.velocity.addScaledVector(normal, -impulse);
      b.velocity.addScaledVector(normal, impulse);
      if (vn > 0.8) {
        if (a.onImpact) a.onImpact(vn, 'ball');
      }
    }
    a.wake(); b.wake();
  }
}

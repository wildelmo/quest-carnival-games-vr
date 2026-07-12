import * as THREE from 'three';
import { shiny } from '../core/environment.js';

/**
 * dartMesh — the carnival dart, shared by BalloonDartGame and the hand-lab
 * diagnostic page so what the lab shows IS the in-game dart.
 *
 * Proper dart anatomy, modelled pointing along -Z (three.js "forward"):
 * steel needle -> colored metal barrel (where you grip) -> thin dark
 * shaft -> kite-shaped flights crossed in an X at the tail. The needle tip
 * ends at z = -0.1 (NEEDLE_LEN in BalloonDartGame), the flights trail to
 * z = +0.092, and the barrel — the part the fingers pinch — is centred at
 * DART_GRIP_Z.
 */

/** dart-local z of the barrel centre, where the pinch grip holds it */
export const DART_GRIP_Z = -0.022;
/** barrel radius — what the fingertip pads actually squeeze */
export const DART_BARREL_R = 0.0065;

let _shared = null;
function shared() {
  if (_shared) return _shared;
  const needleGeo = new THREE.ConeGeometry(0.0035, 0.05, 8);
  needleGeo.rotateX(-Math.PI / 2);                    // apex points -Z
  const barrelGeo = new THREE.CylinderGeometry(DART_BARREL_R, DART_BARREL_R, 0.055, 10);
  barrelGeo.rotateX(Math.PI / 2);                     // axis along Z
  const shaftGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 0.055, 8);
  shaftGeo.rotateX(Math.PI / 2);
  // one kite-shaped flight blade in the YZ plane (contains the shaft axis);
  // a second copy rotated 90° around Z completes the classic X of fins
  const flightGeo = new THREE.BufferGeometry();
  flightGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.045,        // leading point on the shaft
    0, 0.024, 0.07,     // upper tip
    0, 0, 0.092,        // trailing point on the shaft
    0, -0.024, 0.07,    // lower tip
  ], 3));
  flightGeo.setIndex([0, 1, 2, 0, 2, 3]);
  flightGeo.computeVertexNormals();
  _shared = {
    needleGeo, barrelGeo, shaftGeo, flightGeo,
    steelMat: shiny({ color: 0xc7ccd8, metalness: 1, roughness: 0.22 }),
    shaftMat: shiny({ color: 0x2a2a35, metalness: 0.6, roughness: 0.35 }),
  };
  return _shared;
}

/** Build one dart. @param {number} color barrel + flight colour */
export function buildDartMesh(color) {
  const s = shared();
  const dart = new THREE.Group();
  const needle = new THREE.Mesh(s.needleGeo, s.steelMat);
  needle.position.z = -0.075;                         // tip ends at z=-0.1
  // anodised metal barrel — the part you grip
  const barrel = new THREE.Mesh(s.barrelGeo,
    shiny({ color, metalness: 0.8, roughness: 0.3 }));
  barrel.position.z = DART_GRIP_Z;
  const shaft = new THREE.Mesh(s.shaftGeo, s.shaftMat);
  shaft.position.z = 0.033;
  const f1 = new THREE.Mesh(s.flightGeo,
    shiny({ color, roughness: 0.2, side: THREE.DoubleSide }));
  const f2 = f1.clone();
  f2.rotation.z = Math.PI / 2;
  dart.add(needle, barrel, shaft, f1, f2);
  return dart;
}

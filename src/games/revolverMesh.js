import * as THREE from 'three';
import { shiny } from '../core/environment.js';

/**
 * revolverMesh — the shooting gallery's tethered toy six-shooter.
 *
 * Modelled barrel-along--Z (three.js "forward", same convention as the
 * dart) with the ORIGIN AT THE MIDDLE OF THE GRIP HANDLE — the point the
 * fist closes around — so Grabbables' holdOffset numbers move the whole
 * gun around the palm intuitively and the GunGripTuner reads in
 * fist-relative millimetres.
 *
 * Anatomy, back to front: raked wooden grip with a brass butt cap and
 * lanyard ring (the tether clips here), frame with a cocking hammer at the
 * back, the six-bore cylinder drum (a separate spinnable group — the
 * reload animation whirls it), then the barrel with an ejector lug under
 * it and a blade sight at the muzzle. Painted-steel body + per-gun accent
 * so the two counter guns read as a pair, not clones.
 *
 * THE SIGHT PLANE IS GAMEPLAY GEOMETRY. Players aim by lining up the rear
 * notch with the front blade, so both tops sit at exactly SIGHT_PLANE_Y
 * and the shot ray leaves from the `aim` anchor ON that line — point of
 * aim IS point of impact. Nothing may poke above the plane between the
 * notch and the blade: the first hammer stood a centimetre proud of the
 * strap, players sighted over IT, and every shot flew ~3° high (~18cm at
 * the backdrop). The hammer now lies cocked back below the plane.
 */

/** gun-local position of the muzzle (flash/smoke spawn here) */
export const GUN_MUZZLE = new THREE.Vector3(0, 0.064, -0.2);
/** gun-local height of the notch/blade sight line */
export const SIGHT_PLANE_Y = 0.0835;

let _shared = null;
function shared() {
  if (_shared) return _shared;
  _shared = {
    steel: shiny({ color: 0xaeb6c4, metalness: 1, roughness: 0.3, envIntensity: 1.05 }),
    darkSteel: shiny({ color: 0x565d6e, metalness: 1, roughness: 0.38 }),
    brass: shiny({ color: 0xc9a02e, metalness: 1, roughness: 0.32, envIntensity: 1.1 }),
    wood: shiny({ color: 0x6b4426, roughness: 0.45, envIntensity: 0.5 }),
    barrelGeo: new THREE.CylinderGeometry(0.0095, 0.0095, 0.12, 12).rotateX(Math.PI / 2),
    lugGeo: new THREE.CylinderGeometry(0.0045, 0.0045, 0.075, 8).rotateX(Math.PI / 2),
    drumGeo: new THREE.CylinderGeometry(0.023, 0.023, 0.044, 12).rotateX(Math.PI / 2),
    boreGeo: new THREE.CylinderGeometry(0.0052, 0.0052, 0.046, 8).rotateX(Math.PI / 2),
    frameGeo: new THREE.BoxGeometry(0.024, 0.032, 0.09),
    topStrapGeo: new THREE.BoxGeometry(0.016, 0.008, 0.082),
    gripGeo: new THREE.BoxGeometry(0.03, 0.096, 0.04),
    buttGeo: new THREE.BoxGeometry(0.034, 0.012, 0.044),
    hammerGeo: new THREE.BoxGeometry(0.008, 0.02, 0.012),
    hammerSpurGeo: new THREE.BoxGeometry(0.012, 0.006, 0.012),
    sightGeo: new THREE.BoxGeometry(0.004, 0.011, 0.014),
    rearSightGeo: new THREE.BoxGeometry(0.003, 0.007, 0.012),
    guardGeo: new THREE.TorusGeometry(0.017, 0.0032, 6, 14).rotateY(Math.PI / 2),
    triggerGeo: new THREE.BoxGeometry(0.006, 0.018, 0.007),
    ringGeo: new THREE.TorusGeometry(0.009, 0.0022, 6, 12).rotateX(Math.PI / 2),
    boreMat: new THREE.MeshLambertMaterial({ color: 0x14161f }),
  };
  return _shared;
}

/**
 * Build one revolver.
 * @param {number} accent grip-panel colour (each counter gun gets its own)
 * @returns {{ group, drum, hammer, muzzle }} drum spins on reload, hammer
 *          snaps on fire, muzzle is an empty anchor for flash/ray spawning
 */
export function buildRevolver(accent = 0xe02249) {
  const s = shared();
  const gun = new THREE.Group();

  // raked grip handle around the origin — brass butt, painted side panels
  const grip = new THREE.Mesh(s.gripGeo, s.wood);
  grip.rotation.x = -0.32;                    // top of the handle leans forward
  gun.add(grip);
  for (const px of [-1, 1]) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, 0.062, 0.028),
      shiny({ color: accent, roughness: 0.28, envIntensity: 0.9 }),
    );
    panel.position.set(px * 0.017, -0.006, 0.004);
    grip.add(panel);
  }
  const butt = new THREE.Mesh(s.buttGeo, s.brass);
  butt.position.y = -0.052;
  grip.add(butt);
  const ring = new THREE.Mesh(s.ringGeo, s.brass);
  ring.position.set(0, -0.062, 0.004);
  grip.add(ring);

  // frame + top strap running all the way back to carry the rear sight
  const frame = new THREE.Mesh(s.frameGeo, s.steel);
  frame.position.set(0, 0.052, -0.018);
  gun.add(frame);
  const strap = new THREE.Mesh(s.topStrapGeo, s.steel);
  strap.position.set(0, 0.072, -0.044);
  gun.add(strap);
  // rear sight: two little posts flanking a notch, tops exactly on the
  // sight plane so lining them up with the blade IS the shot line
  for (const px of [-0.0045, 0.0045]) {
    const post = new THREE.Mesh(s.rearSightGeo, s.darkSteel);
    post.position.set(px, SIGHT_PLANE_Y - 0.0035, -0.009);
    gun.add(post);
  }

  // six-shot cylinder drum — a GROUP so the bores spin with it on reload
  const drum = new THREE.Group();
  drum.position.set(0, 0.055, -0.058);
  const drumBody = new THREE.Mesh(s.drumGeo, s.darkSteel);
  drum.add(drumBody);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bore = new THREE.Mesh(s.boreGeo, s.boreMat);
    bore.position.set(Math.cos(a) * 0.0145, Math.sin(a) * 0.0145, 0);
    drum.add(bore);
  }
  gun.add(drum);

  // barrel + ejector lug + blade sight
  const barrel = new THREE.Mesh(s.barrelGeo, s.steel);
  barrel.position.set(0, 0.064, -0.14);
  gun.add(barrel);
  const lug = new THREE.Mesh(s.lugGeo, s.darkSteel);
  lug.position.set(0, 0.048, -0.13);
  gun.add(lug);
  const sight = new THREE.Mesh(s.sightGeo, s.brass);
  sight.position.set(0, SIGHT_PLANE_Y - 0.0055, -0.192); // top on the plane
  gun.add(sight);

  // hammer: lies cocked back BELOW the sight plane (see header — a proud
  // hammer becomes the de-facto rear sight and throws every shot high),
  // and snaps further back on every shot
  const hammer = new THREE.Group();
  hammer.position.set(0, 0.064, 0.03);
  const hammerBody = new THREE.Mesh(s.hammerGeo, s.darkSteel);
  hammerBody.position.set(0, 0.006, 0.002);
  hammerBody.rotation.x = -0.55;
  const spur = new THREE.Mesh(s.hammerSpurGeo, s.darkSteel);
  spur.position.set(0, 0.013, 0.009);
  spur.rotation.x = -0.35;
  hammer.add(hammerBody, spur);
  gun.add(hammer);

  // trigger guard + trigger
  const guard = new THREE.Mesh(s.guardGeo, s.brass);
  guard.position.set(0, 0.02, -0.024);
  gun.add(guard);
  const trigger = new THREE.Mesh(s.triggerGeo, s.darkSteel);
  trigger.position.set(0, 0.026, -0.024);
  trigger.rotation.x = 0.25;
  gun.add(trigger);

  // muzzle anchor — where the flash and smoke spawn
  const muzzle = new THREE.Object3D();
  muzzle.position.copy(GUN_MUZZLE);
  gun.add(muzzle);
  // aim anchor ON the sight line — shots originate here, straight out -Z,
  // so what the player lines up is exactly what the BB hits
  const aim = new THREE.Object3D();
  aim.position.set(0, SIGHT_PLANE_Y, -0.19);
  gun.add(aim);

  return { group: gun, drum, hammer, muzzle, aim };
}

import * as THREE from 'three';
import { World } from './core/World.js';
import { Input } from './core/Input.js';
import { Grabbables } from './core/Grabbables.js';
import { DartGripTuner } from './core/DartGripTuner.js';
import { GunGripTuner } from './core/GunGripTuner.js';
import { Locomotion } from './core/Locomotion.js';
import { AudioManager } from './core/AudioManager.js';
import { BlobShadows } from './core/Shadows.js';
import { Hands } from './core/Hands.js';
import { Comfort } from './core/Comfort.js';
import { MusicControl } from './core/MusicControl.js';
import { settings } from './core/settings.js';
import { initEnvironment } from './core/environment.js';
import { loadFonts } from './core/textures.js';
import { Tent, TENT_RADIUS, PAD_RADIUS } from './env/Tent.js';
import { Midway } from './env/Midway.js';
import { ComingSoonBooth } from './components/BoothBase.js';
import { ExitBell } from './components/ExitBell.js';
import { BallTossGame } from './games/BallTossGame.js';
import { BalloonDartGame } from './games/BalloonDartGame.js';
import { RingTossGame } from './games/RingTossGame.js';
import { ShootingGalleryGame } from './games/ShootingGalleryGame.js';

/**
 * Carnival Arcade VR — entry point.
 *
 * Boot order matters a little:
 *  1. The display fonts load FIRST — every sign/scoreboard is painted to
 *     canvas once at build time, so the type must be ready before the scene
 *  2. World (renderer/scene/loop) and Input register their update hooks
 *  3. The env map bakes, then environment + games build the scene/physics
 *  4. Audio preloads, then the overlay buttons enter VR / desktop mode
 *
 * ADDING A BOOTH: see src/games/registry.js — build a MiniGame subclass and
 * hand it a free pad below.
 */

// carnival lettering for the canvas-painted signage (falls back to serif
// offline — loadFonts resolves either way)
await loadFonts();

const world = new World(document.getElementById('app'));
const input = new Input(world);
const audio = new AudioManager(world.camera, world.scene);
const grabbables = new Grabbables(world, input, audio);
// in-headset grip tuning (hold the object + squeeze the empty hand's grip);
// registered BEFORE Locomotion so their stick claims land the same frame
const gripTuner = new DartGripTuner(world, input, grabbables);
const gunTuner = new GunGripTuner(world, input, grabbables);
const locomotion = new Locomotion(world, input);
const shadows = new BlobShadows(world);
// big white carnival gloves for your hands + the comfort vignette
const hands = new Hands(world, input, grabbables);
const comfort = new Comfort(world, input, locomotion);
audio.setMusicEnabled(settings.data.music);
// music on/off toggle (Quest: B/Y face button, desktop: M) — the last
// survivor of the removed operator panel, so players can turn music back on
const musicControl = new MusicControl(world, input, audio);

// bake the carnival-toned env map (one-off, ~ms) so every shiny material
// built after this picks up real reflections
initEnvironment(world.renderer);

world.physics.boundsRadius = TENT_RADIUS - 0.2;

const tent = new Tent(world);
// the night midway outside — visible through the doorway and wall windows
const midway = new Midway(world, audio);

/** everything a booth needs, in one bag */
const deps = { world, input, audio, grabbables, locomotion, shadows };

// ---- live games (pads 0..5 ring the tent) -------------------------------
// The shooting gallery is a DOUBLE-WIDE booth: it takes both of the old
// whack-a-mole and skee-ball slots (5 & 6 of 7), centred on their boundary.
const GALLERY_ANGLE = (5.5 / 7) * Math.PI * 2;
const galleryPad = {
  position: new THREE.Vector3(
    Math.sin(GALLERY_ANGLE) * PAD_RADIUS, 0, -Math.cos(GALLERY_ANGLE) * PAD_RADIUS),
  angle: -GALLERY_ANGLE,
};
const games = [
  new BallTossGame(deps, tent.getPad(0)),
  new BalloonDartGame(deps, tent.getPad(1)),
  new RingTossGame(deps, tent.getPad(2)),
  new ShootingGalleryGame(deps, galleryPad),
];

// ---- future booths: decorated placeholders keep the tent feeling full ----
new ComingSoonBooth(world, tent.getPad(3), 'MILK BOTTLES');

// ---- spawn: face the ball toss booth, offset so the pole isn't in view ----
world.rig.position.set(1.1, 0, 2.4);

// ---- overlay / session management ----------------------------------------
const overlay = document.getElementById('overlay');
const btnVR = document.getElementById('btn-vr');
const btnDesktop = document.getElementById('btn-desktop');
const loading = document.getElementById('loading');

/**
 * Fully leave the experience: end the VR session (or release the desktop
 * pointer lock), bring the splash screen back, and pause all audio. The
 * enter buttons resume from here.
 */
function exitExperience() {
  audio.suspend();
  const session = world.renderer.xr.getSession();
  if (session) {
    session.end().catch(() => {});          // 'end' handler reveals the overlay
  } else {
    if (document.pointerLockElement) document.exitPointerLock();
    overlay.classList.remove('hidden');
  }
}

// ---- exit bell at the centre pole ----------------------------------------
const exitBell = new ExitBell(deps, { onExit: exitExperience });
exitBell.group.position.set(-0.55, 0, 0.7);
exitBell.group.rotation.y = -0.5;           // angle the sign toward the spawn
world.scene.add(exitBell.group);

async function boot() {
  await audio.load();
  loading.textContent = '';
  btnDesktop.disabled = false;

  // WebXR support check
  if (navigator.xr) {
    try {
      const ok = await navigator.xr.isSessionSupported('immersive-vr');
      btnVR.disabled = !ok;
      if (!ok) btnVR.textContent = 'VR NOT AVAILABLE';
    } catch {
      btnVR.textContent = 'VR NOT AVAILABLE';
    }
  } else {
    btnVR.textContent = 'VR NOT AVAILABLE';
  }

  btnVR.addEventListener('click', async () => {
    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
      session.addEventListener('end', () => overlay.classList.remove('hidden'));
      await world.renderer.xr.setSession(session);
      audio.start(world.scene, tent.musicAnchor);
      overlay.classList.add('hidden');
    } catch (err) {
      console.error('Failed to start XR session', err);
      loading.textContent = 'could not start VR: ' + err.message;
    }
  });

  btnDesktop.addEventListener('click', () => {
    audio.start(world.scene, tent.musicAnchor);
    overlay.classList.add('hidden');
    input.requestPointerLock();
  });

  // clicking the canvas re-locks the pointer on desktop
  world.renderer.domElement.addEventListener('click', () => {
    if (!input.isXR && !input.pointerLocked && overlay.classList.contains('hidden')) {
      input.requestPointerLock();
    }
  });
}

boot();
world.start();

// dev convenience: expose for console poking
window.__carnival = {
  world, games, tent, midway, input, deps, exitBell, exitExperience,
  hands, comfort, musicControl, settings, gripTuner, gunTuner,
};

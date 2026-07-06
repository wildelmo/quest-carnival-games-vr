import * as THREE from 'three';
import { World } from './core/World.js';
import { Input } from './core/Input.js';
import { Grabbables } from './core/Grabbables.js';
import { Locomotion } from './core/Locomotion.js';
import { AudioManager } from './core/AudioManager.js';
import { Tent, TENT_RADIUS } from './env/Tent.js';
import { ComingSoonBooth } from './components/BoothBase.js';
import { BallTossGame } from './games/BallTossGame.js';
import { BalloonDartGame } from './games/BalloonDartGame.js';

/**
 * Carnival Arcade VR — entry point.
 *
 * Boot order matters a little:
 *  1. World (renderer/scene/loop) and Input register their update hooks first
 *  2. Environment + games build the scene and physics
 *  3. Audio preloads, then the overlay buttons enter VR / desktop mode
 *
 * ADDING A BOOTH: see src/games/registry.js — build a MiniGame subclass and
 * hand it a free pad below.
 */

const world = new World(document.getElementById('app'));
const input = new Input(world);
const audio = new AudioManager(world.camera, world.scene);
const grabbables = new Grabbables(world, input, audio);
const locomotion = new Locomotion(world, input);

world.physics.boundsRadius = TENT_RADIUS - 0.2;

const tent = new Tent(world);

/** everything a booth needs, in one bag */
const deps = { world, input, audio, grabbables, locomotion };

// ---- live games (pads 0..5 ring the tent) -------------------------------
const games = [
  new BallTossGame(deps, tent.getPad(0)),
  new BalloonDartGame(deps, tent.getPad(1)),
];

// ---- future booths: decorated placeholders keep the tent feeling full ----
const upcoming = ['RING TOSS', 'MILK BOTTLES', 'WHACK-A-MOLE', 'SKEE-BALL'];
upcoming.forEach((name, i) => new ComingSoonBooth(world, tent.getPad(2 + i), name));

// ---- spawn: face the ball toss booth, offset so the pole isn't in view ----
world.rig.position.set(1.1, 0, 2.4);

// ---- overlay / session management ----------------------------------------
const overlay = document.getElementById('overlay');
const btnVR = document.getElementById('btn-vr');
const btnDesktop = document.getElementById('btn-desktop');
const loading = document.getElementById('loading');

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
window.__carnival = { world, games, tent, input, deps };

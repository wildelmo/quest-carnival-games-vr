import { settings } from './settings.js';

/**
 * MusicControl — the one player-facing music on/off toggle that survived the
 * operator panel's removal, rebuilt as a plain button press instead of a
 * poke-able 3D kiosk (those were the unreliable part).
 *
 *   Quest   : the B / Y face button (either controller) toggles the music.
 *   Desktop : the M key.
 *
 * The choice persists in localStorage via settings, so it's remembered
 * between sessions — and, crucially, it gives players a way back ON after
 * the panel that used to hold this toggle was taken out.
 *
 * B / Y (gamepad button index 5) and M are otherwise unused, so nothing
 * else fights for them.
 */

const XR_TOGGLE_BUTTON = 5;   // B (right) / Y (left) on Quest Touch controllers

export class MusicControl {
  /**
   * @param {import('./World.js').World} world
   * @param {import('./Input.js').Input} input
   * @param {import('./AudioManager.js').AudioManager} audio
   */
  constructor(world, input, audio) {
    this.input = input;
    this.audio = audio;
    this._prevXR = [false, false];   // per-hand B/Y edge state
    this._prevKey = false;           // desktop M edge state
    world.onUpdate(() => this.#update());
  }

  #toggle(pulseHand) {
    const on = !settings.data.music;
    settings.set('music', on);
    this.audio.setMusicEnabled(on);
    // a little confirmation buzz on the hand that pressed it
    if (pulseHand) pulseHand.pulse(0.5, 45);
  }

  #update() {
    if (this.input.isXR) {
      for (const hand of this.input.hands) {
        const pressed = !!hand._inputSource?.gamepad?.buttons?.[XR_TOGGLE_BUTTON]?.pressed;
        if (pressed && !this._prevXR[hand.index]) this.#toggle(hand);
        this._prevXR[hand.index] = pressed;
      }
    } else {
      const pressed = this.input.keys.has('KeyM');
      if (pressed && !this._prevKey) this.#toggle(null);
      this._prevKey = pressed;
    }
  }
}

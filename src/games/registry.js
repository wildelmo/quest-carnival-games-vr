/**
 * Mini-game registry + MiniGame base class.
 *
 * GAME FLOW: every booth has one RESET button and no start button. RESET
 * restores the booth to a fresh round (dolls up, balloons inflated, balls
 * and darts back in their trays, score zeroed) and leaves the game 'ready'.
 * The round itself begins on the player's first real throw — games call
 * tryStart() from their throw handlers.
 *
 * ADDING A NEW BOOTH
 * ------------------
 * 1. Create src/games/MyGame.js extending MiniGame.
 * 2. Build your booth with BoothBase (gives you sign, counter, scoreboard,
 *    reset button, prize shelf) and add game contents to `this.booth.group`.
 * 3. Implement onRoundStart / onRoundEnd / onUpdate / onResetRound, call
 *    tryStart() on the first throw and finishReset() when your reset
 *    sequence has finished.
 * 4. Register it in main.js:  games.push(new MyGame(deps, tent.getPad(n)))
 * Free pads are marked with "COMING SOON" signs (see main.js).
 */

export class MiniGame {
  /**
   * @param {object} deps { world, input, audio, grabbables, locomotion }
   * @param {number} roundSeconds timer length
   */
  constructor(deps, roundSeconds = 45) {
    this.deps = deps;
    this.roundSeconds = roundSeconds;
    this.state = 'ready'; // ready | running | over | resetting
    this.readyStatus = 'THROW TO START';
    this.score = 0;
    this.best = 0;
    this.timeLeft = 0;
    deps.world.onUpdate((dt, t) => this.#tick(dt, t));
  }

  /** call from the game's throw handler — the first real throw starts the round */
  tryStart() {
    if (this.state !== 'ready') return;
    this.state = 'running';
    this.score = 0;
    this.timeLeft = this.roundSeconds;
    this.deps.audio.play('bell', { at: this.booth?.group, volume: 0.9 });
    this.onRoundStart();
  }

  /**
   * Wire this to the booth's RESET button. Works from any state (including
   * mid-round): zeroes the score, stops the clock and hands off to the
   * game's onResetRound() to restore its targets and projectiles. The game
   * calls finishReset() once its reset sequence is done.
   */
  requestReset() {
    if (this.state === 'resetting') return;
    this.state = 'resetting';
    this.score = 0;
    this.timeLeft = 0;
    this.onResetRound();
  }

  /** games call this when their reset sequence has finished */
  finishReset() {
    this.state = 'ready';
    if (this.booth) this.booth.scoreboard.setStatus(this.readyStatus);
  }

  addScore(points, at) {
    if (this.state !== 'running') return false;
    this.score += points;
    this.deps.audio.play('point', { at, volume: 0.65, rate: 1 + Math.min(0.5, this.score / 400) });
    return true;
  }

  endRound(reason = 'time') {
    if (this.state !== 'running') return;
    this.state = 'over';
    this.best = Math.max(this.best, this.score);
    this.deps.audio.play(reason === 'cleared' ? 'fanfare' : 'roundEnd',
      { at: this.booth?.group, volume: 0.9 });
    this.onRoundEnd(reason);
  }

  #tick(dt, t) {
    if (this.state === 'running') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.endRound('time');
      }
    }
    this.onUpdate(dt, t);
    // shared scoreboard + reset button bookkeeping
    if (this.booth) {
      const sb = this.booth.scoreboard;
      sb.setScore(this.score);
      sb.setBest(this.best);
      sb.setTime(this.state === 'running' ? this.timeLeft : 0);
      sb.update();
      this.booth.resetButton.enabled = this.state !== 'resetting';
    }
  }

  /* ---- override points ---- */
  onRoundStart() {}
  onRoundEnd(_reason) {}
  onResetRound() {}
  onUpdate(_dt, _t) {}
}

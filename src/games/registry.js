/**
 * Mini-game registry + MiniGame base class.
 *
 * ADDING A NEW BOOTH
 * ------------------
 * 1. Create src/games/MyGame.js extending MiniGame.
 * 2. Build your booth with BoothBase (gives you sign, counter, scoreboard,
 *    start button, prize shelf) and add game contents to `this.booth.group`.
 * 3. Implement onRoundStart / onRoundEnd / onUpdate / onResetRound.
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
    this.state = 'idle'; // idle | running | over | resetting
    this.score = 0;
    this.best = 0;
    this.timeLeft = 0;
    deps.world.onUpdate((dt, t) => this.#tick(dt, t));
  }

  /** wire this to the booth's start button */
  tryStart() {
    if (this.state === 'running' || this.state === 'resetting') return;
    this.state = 'running';
    this.score = 0;
    this.timeLeft = this.roundSeconds;
    this.deps.audio.play('bell', { at: this.booth?.group, volume: 0.9 });
    this.onRoundStart();
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
    // shared scoreboard bookkeeping
    if (this.booth) {
      const sb = this.booth.scoreboard;
      sb.setScore(this.score);
      sb.setBest(this.best);
      sb.setTime(this.state === 'running' ? this.timeLeft : 0);
      sb.update();
    }
  }

  /* ---- override points ---- */
  onRoundStart() {}
  onRoundEnd(_reason) {}
  onResetRound() {}
  onUpdate(_dt, _t) {}
}

// Game clock abstraction (design doc section 6).
//
// Game state must NOT read the browser wall clock directly. All simulated time
// flows through a GameClock so that a server can later become the authoritative
// source in multiplayer without touching the rest of the codebase.
//
// The clock tracks elapsed *game seconds* from 0 up to durationSeconds. Progress
// through the week is elapsed / durationSeconds, a value in [0, 1].

// Interface (documented for reference; JS has no interfaces):
//   now(): number          -> elapsed game seconds
//   isPaused(): boolean
//   setSpeed(multiplier): void
//   getSpeed(): number

// The most wall-clock time one tick may fold into the game. The loop runs on
// requestAnimationFrame, which stops in a hidden tab while wall time doesn't —
// without a cap, alt-tabbing for a minute meant a minute of events landing
// unseen in one catch-up frame (visions revealed AND expired, headlines dropped,
// positions repriced with nobody watching). Capping makes hiding the tab behave
// as a pause: the week only advances while someone can see it. The cap is far
// above any real frame (60fps is 0.017s; even heavy jank stays under 0.5s), so
// visible play never hits it.
const MAX_TICK_SECONDS = 0.5;

export class LocalGameClock {
  // nowFn lets tests inject a fake wall clock (defaults to performance.now()).
  constructor({ durationSeconds, speed = 1, nowFn } = {}) {
    this.durationSeconds = durationSeconds;
    this.speed = speed;
    this.paused = true;
    this._elapsed = 0; // accumulated game seconds
    this._nowFn = nowFn || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this._lastWall = this._nowFn();
  }

  // Fold real wall-clock time since the last tick into elapsed game time,
  // scaled by speed. Called by the game loop each frame. When paused, wall time
  // is consumed but not accumulated, so pausing freezes the clock exactly.
  // A gap longer than MAX_TICK_SECONDS is a discontinuity (a backgrounded tab),
  // not a slow frame — the excess is discarded, not replayed.
  tick() {
    const wall = this._nowFn();
    const dtSeconds = Math.min(MAX_TICK_SECONDS, (wall - this._lastWall) / 1000);
    this._lastWall = wall;
    if (!this.paused) {
      this._elapsed += dtSeconds * this.speed;
      if (this._elapsed > this.durationSeconds) this._elapsed = this.durationSeconds;
    }
    return this.now();
  }

  now() {
    return this._elapsed;
  }

  progress() {
    if (this.durationSeconds <= 0) return 1;
    return Math.max(0, Math.min(1, this._elapsed / this.durationSeconds));
  }

  isFinished() {
    return this._elapsed >= this.durationSeconds;
  }

  isPaused() {
    return this.paused;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this._lastWall = this._nowFn();
    this.paused = false;
  }

  setSpeed(multiplier) {
    this.speed = multiplier;
  }

  getSpeed() {
    return this.speed;
  }

  // Jump straight to the end of the week (player chooses "finish early").
  finish() {
    this._elapsed = this.durationSeconds;
    this.paused = true;
  }
}

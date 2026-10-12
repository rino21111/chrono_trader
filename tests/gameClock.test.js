import { describe, it, expect } from "./harness.js";
import { LocalGameClock } from "../src/domain/clock/gameClock.js";

// A controllable wall clock: tests advance it by hand and tick.
function makeClock(opts = {}) {
  let wall = 0;
  const clock = new LocalGameClock({ durationSeconds: 600, nowFn: () => wall, ...opts });
  return {
    clock,
    advance(seconds) {
      wall += seconds * 1000;
      clock.tick();
    },
  };
}

describe("LocalGameClock", () => {
  it("accumulates game time scaled by speed while running", () => {
    const { clock, advance } = makeClock({ speed: 2 });
    clock.resume();
    for (let i = 0; i < 10; i += 1) advance(0.1); // 1s wall at 2x
    expect(clock.now()).toBeCloseTo(2, 6);
    expect(clock.progress()).toBeCloseTo(2 / 600, 6);
  });

  it("freezes exactly while paused, and resumes cleanly", () => {
    const { clock, advance } = makeClock();
    clock.resume();
    advance(0.1);
    clock.pause();
    advance(30); // half a minute passes unwatched
    expect(clock.now()).toBeCloseTo(0.1, 6);
    clock.resume();
    advance(0.1);
    expect(clock.now()).toBeCloseTo(0.2, 6);
  });

  it("treats a long frame gap as a discontinuity, not fast time", () => {
    // The loop runs on requestAnimationFrame, which stops in a hidden tab.
    // Without the cap, one catch-up tick after 60s away folded a minute of
    // events into a single unwatched frame.
    const { clock, advance } = makeClock();
    clock.resume();
    advance(60); // tab hidden for a minute -> one giant tick
    expect(clock.now()).toBeLessThanOrEqual(0.5 + 1e-9); // capped, not 60
    advance(0.1); // and the next ordinary frame is unaffected
    expect(clock.now()).toBeCloseTo(0.6, 6);
  });

  it("still caps by wall time at higher speeds (game time scales after the cap)", () => {
    const { clock, advance } = makeClock({ speed: 4 });
    clock.resume();
    advance(60);
    expect(clock.now()).toBeLessThanOrEqual(0.5 * 4 + 1e-9);
  });

  it("finish() jumps to the end and stops", () => {
    const { clock, advance } = makeClock();
    clock.resume();
    advance(0.1);
    clock.finish();
    expect(clock.isFinished()).toBeTruthy();
    expect(clock.progress()).toBe(1);
    advance(5);
    expect(clock.progress()).toBe(1); // finished is finished
  });
});

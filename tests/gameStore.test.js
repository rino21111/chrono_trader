import { describe, it, expect } from "./harness.js";
import { GameStore } from "../src/state/gameStore.js";

// Store-level transport rules (issue #4). A run starts at the authored pace and
// the speed ring warps it from there; pause is offered in every run, and it is
// READ-ONLY — a frozen clock must mean a frozen book, or pausing mid-overshoot
// lets a player time the correction at leisure. These tests run the real start()
// path — a scenario fetched and loaded exactly as the app does it — but never
// tick the clock, so nothing here depends on requestAnimationFrame firing.

async function startedStore() {
  const store = new GameStore();
  await store.start("week-001");
  return store;
}

describe("GameStore transport rules", () => {
  it("offers pause and resume", async () => {
    const store = await startedStore();
    expect(store.state.status).toBe("playing");
    store.pause();
    expect(store.state.status).toBe("paused");
    store.resume();
    expect(store.state.status).toBe("playing");
    store.finishEarly();
  });

  it("starts every run at 1x and lets the speed ring warp it", async () => {
    const store = await startedStore();
    expect(store.state.speed).toBe(1);
    store.setSpeed(4);
    expect(store.state.speed).toBe(4);
    expect(store.clock.getSpeed()).toBe(4);
    store.finishEarly();
  });

  it("rejects orders while paused", async () => {
    const store = await startedStore();
    const cid = store.state.selectedCompanyId;
    store.pause();
    const fill = store.submitOrder({ companyId: cid, side: "buy", quantity: 1 });
    expect(fill.ok).toBe(false);
    expect(fill.reason).toBe("market-paused");
    expect(store.state.lastOrderError).toBe("market-paused");
    store.finishEarly();
  });

  it("fills orders while playing, and resuming reopens the book", async () => {
    const store = await startedStore();
    const cid = store.state.selectedCompanyId;
    expect(store.submitOrder({ companyId: cid, side: "buy", quantity: 1 }).ok).toBe(true);
    store.pause();
    store.resume();
    expect(store.submitOrder({ companyId: cid, side: "buy", quantity: 1 }).ok).toBe(true);
    store.finishEarly();
  });

  it("still finishes early out of a paused run", async () => {
    const store = await startedStore();
    store.pause();
    store.finishEarly();
    expect(store.state.status).toBe("finished");
    expect(store.state.score).toBeTruthy();
  });
});

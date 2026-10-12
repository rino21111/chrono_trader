// Game store (design doc sections 13, 14, 15).
//
// This is the seam between the pure domain layer and the UI. It owns the game
// state object and the domain services (clock, market engine, execution engine,
// portfolio), exposes intent methods the UI calls (start/buy/sell/pause/...),
// and notifies subscribers when anything changes. React components in a future
// port would subscribe here; the vanilla UI does the same.
//
// The store deliberately contains NO pricing or accounting math — it delegates
// to the domain. It only orchestrates (design doc section 13 "Architectural
// rule": components render and dispatch; logic lives in the domain).

import { LocalGameClock } from "../domain/clock/gameClock.js";
import { MarketEngine } from "../domain/market/marketEngine.js";
import { ExecutionEngine } from "../domain/market/executionEngine.js";
import { Portfolio } from "../domain/portfolio/portfolio.js";
import { scoreGame } from "../domain/scoring/scoreGame.js";
import { loadScenario, listScenarios } from "../domain/scenario/loadScenario.js";
import { resolveRun } from "../domain/scenario/resolveRun.js";
import { visionFeed } from "../domain/events/visions.js";
import { resolveAftermaths } from "../domain/market/aftermath.js";
import { MAX_LEVERAGE, ALLOW_SHORT } from "../domain/config.js";

// Where a run's seed comes from. Normally fresh, so no two runs of a scenario
// play the same tape; `?seed=1234` pins it, which is how you reproduce a week
// you want to look at again or hand someone the exact run you played.
//
// Deliberately NOT a field in the setup menu — a scenario there is its name and
// its premise, nothing else, and a seed box would be the first piece of
// machinery to leak into that screen.
export function pickRunSeed() {
  try {
    const q = new URLSearchParams(window.location.search).get("seed");
    if (q !== null && q !== "" && Number.isFinite(Number(q))) return Number(q) >>> 0;
  } catch {
    // No window (tests, SSR) — fall through to a random seed.
  }
  return (Math.random() * 0x100000000) >>> 0;
}

// EVERY RUN STARTS AT 1×. It's the pace the scenarios are authored and timed
// against — a vision's approach, the gap when its event lands, and the window to
// be early are all tuned to it. The pace used to be picked as a "difficulty" on
// the title screen (½× / 1× / 2× / 4×), a decision made before the player had
// seen a single vision; it's a live choice now, made from the header's speed key
// with the board in front of you, starting from the resting pace.
const START_SPEED = 1;

export class GameStore {
  constructor() {
    this.listeners = new Set();
    this.state = {
      status: "menu", // menu | loading | playing | paused | finished
      scenarioId: undefined,
      scenario: undefined,
      progress: 0,
      speed: START_SPEED, // the pace the week is running at; the header's speed key moves it
      selectedCompanyId: undefined,
      market: { progress: 0, prices: {} },
      visions: [], // player-safe vision feed (revealed events)
      portfolio: undefined, // PortfolioSnapshot
      lastOrderError: undefined,
      loadError: undefined, // why the last start() failed; the menu shows it
      score: undefined,
    };

    // Domain services (created on start).
    this.clock = null;
    this.market = null;
    this.execution = new ExecutionEngine({ spreadBps: 0, maxLeverage: MAX_LEVERAGE, allowShort: ALLOW_SHORT });
    this.portfolioModel = null;
    this._raf = null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  // Shallow-merge a patch into state and notify. Keeps re-renders simple.
  _set(patch) {
    this.state = { ...this.state, ...patch };
    this._emit();
  }

  async listScenarios() {
    return listScenarios();
  }

  // A run needs nothing but the scenario: it starts at START_SPEED with the
  // transport live, and everything else about how it plays is decided in-game.
  async start(scenarioId) {
    this._set({ status: "loading", scenarioId, loadError: undefined });
    let scenario;
    try {
      scenario = await loadScenario(scenarioId);
    } catch (err) {
      // Back to the menu with the reason on state (the menu un-dissolves and
      // shows it). Without this the rejection stranded the app on an empty
      // screen: the menu had faded for launch and status stayed "loading".
      this._set({ status: "menu", loadError: err && err.message ? err.message : String(err) });
      return;
    }

    // The RUN seed, distinct from the scenario's. The scenario seed is baked
    // into the content and identical on every replay; the run seed is fresh each
    // time. It decides two different things, in two passes.
    //
    // FIRST, resolveRun collapses the authored possibilities into one concrete
    // week: which sibling segment fills each slot, which secondary names the
    // ripples touch, and how hard each impact lands inside its band. That is the
    // DESTINATION — replaying a week now gives a different answer, not just a
    // different route to the same one.
    //
    // THEN resolveAftermaths draws each event's archetype, which is the PATH and
    // settles at exactly the close the first pass decided.
    //
    // Both are resolved once, here, onto the scenario's events: the market
    // engine, the scoring pass and the debrief all read the same resolved
    // objects, so no two of them can disagree about what the tape did.
    const runSeed = pickRunSeed();
    scenario.runSeed = runSeed;

    const run = resolveRun(scenario, runSeed);
    scenario.events = resolveAftermaths(run.events, runSeed);
    // Which week this turned out to be. Nothing in the UI depends on it — it is
    // for the debrief's assembly, the fuzz report, and anyone asking a finished
    // run what it drew.
    scenario.path = run.path;
    scenario.debrief = { ...scenario.debrief, summary: run.debriefSummary };

    this.clock = new LocalGameClock({ durationSeconds: scenario.durationSeconds, speed: START_SPEED });
    this.market = new MarketEngine(runSeed);
    const snap = this.market.initialize(scenario.companies, scenario.events);
    this.portfolioModel = new Portfolio(scenario.startingCash, { maxLeverage: MAX_LEVERAGE });

    this.state = {
      ...this.state,
      status: "playing",
      scenario,
      progress: 0,
      speed: START_SPEED,
      selectedCompanyId: scenario.companies[0]?.companyId,
      market: snap,
      visions: visionFeed(scenario.events, 0),
      portfolio: this.portfolioModel.snapshot(snap),
      lastOrderError: undefined,
      score: undefined,
    };
    this.clock.resume();
    this._emit();
    this._loop();
  }

  _loop() {
    const step = () => {
      if (this.state.status !== "playing") return;
      this.clock.tick();
      const progress = this.clock.progress();
      const snap = this.market.advanceTo(progress);
      const portfolio = this.portfolioModel.snapshot(snap);
      const visions = visionFeed(this.state.scenario.events, progress);
      this.state = { ...this.state, progress, market: snap, portfolio, visions };
      this._emit();
      if (this.clock.isFinished()) {
        this._finishInternal();
        return;
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  // Pause is offered in EVERY run — stepping away is always legitimate. It is
  // read-only, though: see submitOrder below.
  pause() {
    if (this.state.status !== "playing") return;
    this.clock.pause();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._set({ status: "paused" });
  }

  resume() {
    if (this.state.status !== "paused") return;
    this.clock.resume();
    this._set({ status: "playing" });
    this._loop();
  }

  setSpeed(multiplier) {
    if (this.clock) this.clock.setSpeed(multiplier);
    this._set({ speed: multiplier });
  }

  selectCompany(companyId) {
    this._set({ selectedCompanyId: companyId, lastOrderError: undefined });
  }

  // Submit a market order. Returns the FillResult so the UI can react, and
  // updates the portfolio snapshot on success.
  //
  // PAUSE IS READ-ONLY. Orders used to fill while paused, which let a player
  // freeze the tape mid-overshoot and time the correction at leisure — exactly
  // the post-headline timing skill the pricing model's gap/ringing design makes
  // hard (see pricingModel.js). Frozen clock, frozen book.
  submitOrder({ companyId, side, quantity }) {
    if (this.state.status === "paused") {
      this._set({ lastOrderError: "market-paused" });
      return { ok: false, reason: "market-paused" };
    }
    if (this.state.status !== "playing") return { ok: false, reason: "not-trading" };
    const snap = this.market.getSnapshot();
    const fill = this.execution.execute({ companyId, side, quantity }, snap, this.portfolioModel);
    if (!fill.ok) {
      this._set({ lastOrderError: fill.reason });
      return fill;
    }
    this.portfolioModel.applyFill(fill, this.clock.now());
    this._set({ portfolio: this.portfolioModel.snapshot(snap), lastOrderError: undefined });
    return fill;
  }

  finishEarly() {
    if (this.state.status !== "playing" && this.state.status !== "paused") return;
    this.clock.finish();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._finishInternal();
  }

  _finishInternal() {
    if (this._raf) cancelAnimationFrame(this._raf);
    const snap = this.market.advanceTo(1);
    const score = scoreGame({
      portfolio: this.portfolioModel,
      companies: this.state.scenario.companies,
      events: this.state.scenario.events,
      startingCash: this.state.scenario.startingCash,
    });
    this.state = {
      ...this.state,
      status: "finished",
      progress: 1,
      market: snap,
      visions: visionFeed(this.state.scenario.events, 1),
      portfolio: this.portfolioModel.snapshot(snap),
      score,
    };
    this._emit();
  }

  restart() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._set({ status: "menu", scenario: undefined, score: undefined, loadError: undefined });
  }
}

export const store = new GameStore();

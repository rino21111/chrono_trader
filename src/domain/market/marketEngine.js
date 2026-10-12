// Market engine (design doc sections 7 and 14) — event-driven.
//
// Owns the companies (opening prices + noise params) and the hidden event
// timeline, and turns a game time into a MarketSnapshot: the set of current
// prices the rest of the app can see. Prices are the superposition of every
// event that has landed on a company (see pricingModel). This is the ONLY place
// that knows the events' impacts during play; the UI never receives affected
// companies or event times until the debrief.
//
//   initialize(companies, events): MarketSnapshot
//   advanceTo(progress): MarketSnapshot
//   getSnapshot(): MarketSnapshot
//
// A MarketSnapshot is { progress, prices: { [companyId]: { price, openingPrice,
// changePct } } }.

import { makeNoiseFn, buildContributions, fairPriceFromEvents } from "./pricingModel.js";

export class MarketEngine {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.companies = new Map(); // companyId -> { openingPrice, volatility, ... }
    this.noiseFns = new Map(); // companyId -> fn(progress)
    this.contributions = new Map(); // companyId -> [{ event, impactPct }]
    this.events = [];
    this._snapshot = null;
    this._progress = 0;
  }

  initialize(companies, events = []) {
    this.companies.clear();
    this.noiseFns.clear();
    this.events = events;
    // Contributions first: each company's noise is turbulent around its own
    // events, so the noise functions need to know what lands on them.
    this.contributions = buildContributions(companies, events);
    for (const c of companies) {
      this.companies.set(c.companyId, c);
      this.noiseFns.set(c.companyId, makeNoiseFn(this.seed, c, this.contributions.get(c.companyId)));
    }
    return this.advanceTo(0);
  }

  advanceTo(progress) {
    const p = Math.max(0, Math.min(1, progress));
    this._progress = p;
    const prices = {};
    for (const [id, c] of this.companies) {
      const base = fairPriceFromEvents(p, c.openingPrice, this.contributions.get(id));
      const noise = this.noiseFns.get(id)(p);
      let price = base + noise;
      if (price < 0.01) price = 0.01; // prices never go non-positive
      prices[id] = {
        price,
        openingPrice: c.openingPrice,
        changePct: (price - c.openingPrice) / c.openingPrice,
      };
    }
    this._snapshot = { progress: p, prices };
    return this._snapshot;
  }

  getSnapshot() {
    return this._snapshot || this.advanceTo(this._progress);
  }

  // The noise-free price for one company at a progress. Used by scoring/debrief
  // so outcomes don't depend on the noise phase at the closing instant.
  fairPriceFor(companyId, progress) {
    const c = this.companies.get(companyId);
    if (!c) return null;
    return fairPriceFromEvents(progress, c.openingPrice, this.contributions.get(companyId));
  }
}

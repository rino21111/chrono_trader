import { describe, it, expect } from "./harness.js";
import { MarketEngine } from "../src/domain/market/marketEngine.js";
import { SEVERITY_AMP } from "../src/domain/market/pricingModel.js";

const companies = [
  { companyId: "helix", openingPrice: 118, volatility: 0.012 },
  { companyId: "orchard", openingPrice: 121, volatility: 0.011 },
];
const events = [
  {
    id: "ev-deal",
    eventTime: 0.3,
    severity: "critical",
    reactionProfile: "gradual",
    affectedCompanies: [{ companyId: "helix", direction: "positive", magnitude: 1 }],
  },
];

describe("MarketEngine (event-driven)", () => {
  it("opens at the opening price (before noise fades in)", () => {
    const eng = new MarketEngine(1337);
    const snap = eng.initialize(companies, events);
    expect(snap.prices.helix.price).toBeCloseTo(118, 4);
    expect(snap.prices.helix.changePct).toBeCloseTo(0, 4);
  });

  it("stays flat until an event lands, then moves toward its impact", () => {
    const eng = new MarketEngine(1337);
    eng.initialize(companies, events);
    expect(eng.fairPriceFor("helix", 0.2)).toBeCloseTo(118, 4); // event is at 0.3
    expect(eng.fairPriceFor("helix", 1)).toBeCloseTo(118 * (1 + SEVERITY_AMP.critical), 4);
  });

  it("leaves companies with no events flat (noise-free)", () => {
    const eng = new MarketEngine(1337);
    eng.initialize(companies, events);
    expect(eng.fairPriceFor("orchard", 0.5)).toBeCloseTo(121, 6);
    expect(eng.fairPriceFor("orchard", 1)).toBeCloseTo(121, 6);
  });

  it("produces an identical price path for the same seed (determinism)", () => {
    const a = new MarketEngine(1337);
    const b = new MarketEngine(1337);
    a.initialize(companies, events);
    b.initialize(companies, events);
    for (let p = 0; p <= 1; p += 0.05) {
      expect(a.advanceTo(p).prices.helix.price).toBeCloseTo(b.advanceTo(p).prices.helix.price, 9);
    }
  });

  it("produces a different path for a different seed", () => {
    const a = new MarketEngine(1337);
    const b = new MarketEngine(9999);
    a.initialize(companies, events);
    b.initialize(companies, events);
    const pa = a.advanceTo(0.5).prices.helix.price;
    const pb = b.advanceTo(0.5).prices.helix.price;
    expect(pa === pb).toBeFalsy();
  });

  it("never returns a non-positive price even under a large negative shock", () => {
    const eng = new MarketEngine(3);
    eng.initialize(
      [{ companyId: "z", openingPrice: 1, volatility: 0.5 }],
      [{ id: "crash", eventTime: 0.1, severity: "critical", reactionProfile: "immediate", affectedCompanies: [{ companyId: "z", direction: "negative", magnitude: 8 }] }]
    );
    for (let p = 0; p <= 1; p += 0.02) {
      expect(eng.advanceTo(p).prices.z.price).toBeGreaterThan(0);
    }
  });
});

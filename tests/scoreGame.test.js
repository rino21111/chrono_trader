import { describe, it, expect } from "./harness.js";
import { Portfolio } from "../src/domain/portfolio/portfolio.js";
import { ExecutionEngine } from "../src/domain/market/executionEngine.js";
import { scoreGame } from "../src/domain/scoring/scoreGame.js";
import { SEVERITY_AMP } from "../src/domain/market/pricingModel.js";

const companies = [
  { companyId: "helix", openingPrice: 100 },
  { companyId: "flat", openingPrice: 100 },
  { companyId: "loser", openingPrice: 100 },
];
// Impacts chosen so the closes land on +20% / 0% / -10%, both landing on the
// same tick.
const events = [
  { id: "up", eventTime: 0.1, severity: "critical", reactionProfile: "gradual", affectedCompanies: [{ companyId: "helix", direction: "positive", magnitude: 0.2 / SEVERITY_AMP.critical }] },
  { id: "dn", eventTime: 0.1, severity: "critical", reactionProfile: "gradual", affectedCompanies: [{ companyId: "loser", direction: "negative", magnitude: 0.1 / SEVERITY_AMP.critical }] },
];

const eng = new ExecutionEngine();
function tradeAtOpen(pf, companyId, side, price, qty) {
  const snap = { progress: 0, prices: { [companyId]: { price, openingPrice: price, changePct: 0 } } };
  pf.applyFill(eng.execute({ companyId, side, quantity: qty }, snap, pf), 0);
}
function buyAtOpen(pf, companyId, price, qty) {
  tradeAtOpen(pf, companyId, "buy", price, qty);
}

describe("scoreGame", () => {
  it("reports what each name offered: its own every-swing walk", () => {
    const pf = new Portfolio(12000);
    const s = scoreGame({ portfolio: pf, companies, events, startingCash: 12000 });
    const byId = new Map(s.companyPnl.map((p) => [p.companyId, p]));
    expect(byId.get("helix").offeredPct).toBeCloseTo(0.2, 6);
    expect(byId.get("flat").offeredPct).toBeCloseTo(0, 6);
    expect(byId.get("loser").offeredPct).toBeCloseTo(0.1, 6);
  });

  it("scores a two-sided book on its own return, with no week benchmark", () => {
    const pf = new Portfolio(12000);
    buyAtOpen(pf, "helix", 100, 40); // a third long the riser
    tradeAtOpen(pf, "loser", "sell", 100, 40); // a third short the faller
    const s = scoreGame({ portfolio: pf, companies, events, startingCash: 12000 });
    expect(s.playerReturn).toBeCloseTo(0.1, 6);
    expect(s.correctTheses).toBe(2);
    expect(s.incorrectTheses).toBe(0);
  });

  it("scores an unlevered all-in run at the mover's full move", () => {
    const pf = new Portfolio(12000);
    buyAtOpen(pf, "helix", 100, 120); // all cash into the best mover
    const s = scoreGame({ portfolio: pf, companies, events, startingCash: 12000 });
    expect(s.playerReturn).toBeCloseTo(0.2, 6);
  });

  it("reports per-company player P&L that reconciles with the totals", () => {
    const pf = new Portfolio(12000);
    buyAtOpen(pf, "helix", 100, 120);
    const s = scoreGame({ portfolio: pf, companies, events, startingCash: 12000 });
    const byId = new Map(s.companyPnl.map((p) => [p.companyId, p]));
    expect(byId.get("helix").playerPnl).toBeCloseTo(2400, 6); // 120 sh × $20
    const totalPlayer = s.companyPnl.reduce((t, p) => t + p.playerPnl, 0);
    expect(totalPlayer).toBeCloseTo(s.finalEquity - s.startingCash, 6);
    // The Offered column deliberately sums to nothing meaningful: every row
    // assumes the whole book sat in that one name, so the rows overlap and
    // their total (30%) describes a week nobody could have traded.
    const totalOffered = s.companyPnl.reduce((t, p) => t + p.offeredPct, 0);
    expect(totalOffered).toBeCloseTo(0.3, 6);
  });

  it("harvests opposing swings: a round-trip offers both legs, not the net move", () => {
    const roundTrip = [{ companyId: "swing", openingPrice: 100 }];
    const twoLegs = [
      { id: "pump", eventTime: 0.2, severity: "critical", reactionProfile: "gradual", affectedCompanies: [{ companyId: "swing", direction: "positive", magnitude: 0.2 / SEVERITY_AMP.critical }] },
      { id: "dump", eventTime: 0.6, severity: "critical", reactionProfile: "gradual", affectedCompanies: [{ companyId: "swing", direction: "negative", magnitude: 0.2 / SEVERITY_AMP.critical }] },
    ];
    const pf = new Portfolio(12000);
    buyAtOpen(pf, "swing", 100, 120); // buy-and-hold straight through the round trip
    const s = scoreGame({ portfolio: pf, companies: roundTrip, events: twoLegs, startingCash: 12000 });
    const swing = s.companyPnl[0];
    expect(swing.move).toBeCloseTo(0, 6); // settles back where it opened
    // Long the +20% leg, then short the give-back: 1.2 × (1 + 0.2/1.2) − 1.
    expect(swing.offeredPct).toBeCloseTo(0.4, 6);
    // Holding through both legs banks nothing of it.
    expect(s.playerReturn).toBeCloseTo(0, 6);
  });

  it("treats events landing on the same tick as a single step", () => {
    const one = [{ companyId: "wash", openingPrice: 100 }];
    const sameTick = [
      { id: "a", eventTime: 0.3, severity: "critical", reactionProfile: "gradual", affectedCompanies: [{ companyId: "wash", direction: "positive", magnitude: 0.1 / SEVERITY_AMP.critical }] },
      { id: "b", eventTime: 0.3, severity: "critical", reactionProfile: "gradual", affectedCompanies: [{ companyId: "wash", direction: "negative", magnitude: 0.1 / SEVERITY_AMP.critical }] },
    ];
    const pf = new Portfolio(12000);
    const s = scoreGame({ portfolio: pf, companies: one, events: sameTick, startingCash: 12000 });
    // The impacts cancel on the same tick — there was never a swing to ride.
    expect(s.companyPnl[0].offeredPct).toBeCloseTo(0, 6);
  });

  it("counts a held loser as an incorrect thesis", () => {
    const pf = new Portfolio(12000);
    buyAtOpen(pf, "loser", 100, 10);
    const s = scoreGame({ portfolio: pf, companies, events, startingCash: 12000 });
    expect(s.incorrectTheses).toBe(1);
    expect(s.correctTheses).toBe(0);
    expect(s.playerReturn).toBeLessThan(0);
  });

  it("counts a held short into a faller as a correct thesis and profits", () => {
    const pf = new Portfolio(12000);
    tradeAtOpen(pf, "loser", "sell", 100, 20); // short the -10% mover
    const s = scoreGame({ portfolio: pf, companies, events, startingCash: 12000 });
    expect(s.correctTheses).toBe(1);
    expect(s.incorrectTheses).toBe(0);
    expect(s.playerReturn).toBeGreaterThan(0);
  });

  it("all-cash portfolio scores zero return", () => {
    const pf = new Portfolio(12000);
    const s = scoreGame({ portfolio: pf, companies, events, startingCash: 12000 });
    expect(s.playerReturn).toBeCloseTo(0, 6);
  });
});

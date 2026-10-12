import { describe, it, expect } from "./harness.js";
import { ExecutionEngine } from "../src/domain/market/executionEngine.js";
import { Portfolio } from "../src/domain/portfolio/portfolio.js";

const snapshot = { progress: 0.5, prices: { helix: { price: 100, openingPrice: 90, changePct: 0.11 } } };

describe("ExecutionEngine", () => {
  it("fills a valid buy at the displayed price (no spread)", () => {
    const eng = new ExecutionEngine();
    const pf = new Portfolio(100000);
    const fill = eng.execute({ companyId: "helix", side: "buy", quantity: 10 }, snapshot, pf);
    expect(fill.ok).toBeTruthy();
    expect(fill.price).toBeCloseTo(100, 6);
    expect(fill.cashDelta).toBeCloseTo(-1000, 6);
  });

  it("allows a buy that commits the whole account", () => {
    const eng = new ExecutionEngine();
    const pf = new Portfolio(1000);
    // 10 sh × 100 = $1000: exactly the account, nothing borrowed.
    const fill = eng.execute({ companyId: "helix", side: "buy", quantity: 10 }, snapshot, pf);
    expect(fill.ok).toBeTruthy();
  });

  it("rejects a buy beyond the cash in the account (no margin)", () => {
    const eng = new ExecutionEngine();
    const pf = new Portfolio(1000);
    // 25 sh × 100 = $2500. Under the old 3x rule this filled; cash-only rejects it.
    const fill = eng.execute({ companyId: "helix", side: "buy", quantity: 25 }, snapshot, pf);
    expect(fill.ok).toBeFalsy();
    expect(fill.reason).toBe("insufficient-buying-power");
  });

  it("still honours a custom leverage cap when one is configured", () => {
    // The cap mechanism is what enforces cash-only at 1; check it generalises.
    const eng = new ExecutionEngine({ maxLeverage: 3 });
    const pf = new Portfolio(1000);
    expect(eng.execute({ companyId: "helix", side: "buy", quantity: 25 }, snapshot, pf).ok).toBeTruthy();
    expect(eng.execute({ companyId: "helix", side: "buy", quantity: 40 }, snapshot, pf).ok).toBeFalsy();
  });

  it("opens a short on a sell with no existing shares", () => {
    const eng = new ExecutionEngine();
    const pf = new Portfolio(100000);
    const fill = eng.execute({ companyId: "helix", side: "sell", quantity: 10 }, snapshot, pf);
    expect(fill.ok).toBeTruthy();
    expect(fill.opensShort).toBeTruthy();
    expect(fill.cashDelta).toBeCloseTo(1000, 6); // proceeds add to cash
  });

  it("refuses to open a short when shorting is disabled", () => {
    const eng = new ExecutionEngine({ allowShort: false });
    const pf = new Portfolio(100000);
    const fill = eng.execute({ companyId: "helix", side: "sell", quantity: 10 }, snapshot, pf);
    expect(fill.ok).toBeFalsy();
    expect(fill.reason).toBe("shorting-disabled");
  });

  it("rejects a short bigger than the account can collateralise", () => {
    const eng = new ExecutionEngine();
    const pf = new Portfolio(1000);
    const fill = eng.execute({ companyId: "helix", side: "sell", quantity: 40 }, snapshot, pf); // $4000 short
    expect(fill.ok).toBeFalsy();
    expect(fill.reason).toBe("insufficient-buying-power");
  });

  it("consumes buying power 1:1 on a short, same as a long", () => {
    const eng = new ExecutionEngine();
    const pf = new Portfolio(1000);
    const fill = eng.execute({ companyId: "helix", side: "sell", quantity: 10 }, snapshot, pf); // $1000
    expect(fill.ok).toBeTruthy();
    pf.applyFill(fill, 0.5);
    // Fully committed: proceeds sit in cash but the short already claims them.
    expect(pf.marginState(snapshot).buyingPower).toBeCloseTo(0, 6);
  });

  it("rejects non-positive or fractional-rounding-to-zero quantities", () => {
    const eng = new ExecutionEngine();
    const pf = new Portfolio(100000);
    expect(eng.execute({ companyId: "helix", side: "buy", quantity: 0 }, snapshot, pf).reason).toBe("invalid-quantity");
    expect(eng.execute({ companyId: "helix", side: "buy", quantity: -3 }, snapshot, pf).reason).toBe("invalid-quantity");
  });

  it("applies a spread against the trader when configured", () => {
    const eng = new ExecutionEngine({ spreadBps: 50 }); // 0.5%
    const pf = new Portfolio(100000);
    const buy = eng.execute({ companyId: "helix", side: "buy", quantity: 1 }, snapshot, pf);
    expect(buy.price).toBeCloseTo(100.5, 6);
  });
});

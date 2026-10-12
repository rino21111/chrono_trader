import { describe, it, expect } from "./harness.js";
import { Portfolio } from "../src/domain/portfolio/portfolio.js";
import { ExecutionEngine } from "../src/domain/market/executionEngine.js";

function snapAt(price) {
  return { progress: 0, prices: { helix: { price, openingPrice: 100, changePct: (price - 100) / 100 } } };
}

const eng = new ExecutionEngine();

// Applying a rejected fill silently corrupts the portfolio (NaN shares), which
// shows up later as a baffling assertion failure somewhere else. Fail here.
function fillOrThrow(pf, side, price, qty, engine) {
  const fill = (engine || eng).execute({ companyId: "helix", side, quantity: qty }, snapAt(price), pf);
  if (!fill.ok) throw new Error(`fixture ${side} ${qty}@${price} was rejected: ${fill.reason}`);
  pf.applyFill(fill, 0);
}

function buy(pf, price, qty, engine) {
  fillOrThrow(pf, "buy", price, qty, engine);
}
function sell(pf, price, qty, engine) {
  fillOrThrow(pf, "sell", price, qty, engine);
}

describe("Portfolio accounting", () => {
  it("deducts cash and records shares on buy", () => {
    const pf = new Portfolio(10000);
    buy(pf, 100, 10);
    expect(pf.cash).toBeCloseTo(9000, 6);
    expect(pf.sharesOf("helix")).toBe(10);
  });

  it("computes weighted-average cost across multiple buys", () => {
    const pf = new Portfolio(100000);
    buy(pf, 100, 10); // avg 100
    buy(pf, 120, 10); // avg (100*10 + 120*10)/20 = 110
    const pos = pf.positions.get("helix");
    expect(pos.avgCost).toBeCloseTo(110, 6);
    expect(pos.shares).toBe(20);
  });

  it("realizes P&L on sell against average cost", () => {
    const pf = new Portfolio(100000);
    buy(pf, 100, 10);
    sell(pf, 130, 5); // realize (130-100)*5 = 150
    const pos = pf.positions.get("helix");
    expect(pos.realizedPnl).toBeCloseTo(150, 6);
    expect(pos.shares).toBe(5);
    expect(pos.avgCost).toBeCloseTo(100, 6); // unchanged by a partial sell
  });

  it("marks unrealized P&L and equity to market", () => {
    const pf = new Portfolio(10000);
    buy(pf, 100, 10); // cash 9000, 10 sh
    const snap = pf.snapshot(snapAt(115));
    expect(snap.unrealizedPnl).toBeCloseTo(150, 6); // (115-100)*10
    expect(snap.positionsValue).toBeCloseTo(1150, 6);
    expect(snap.equity).toBeCloseTo(10150, 6);
    expect(snap.totalReturnPct).toBeCloseTo(0.015, 6);
  });

  it("conserves value: buy then sell at same price returns to start", () => {
    const pf = new Portfolio(10000);
    buy(pf, 100, 10);
    sell(pf, 100, 10);
    expect(pf.cash).toBeCloseTo(10000, 6);
    expect(pf.sharesOf("helix")).toBe(0);
    const snap = pf.snapshot(snapAt(100));
    expect(snap.equity).toBeCloseTo(10000, 6);
    expect(snap.realizedPnl).toBeCloseTo(0, 6);
  });

  it("resets average cost to zero when a position is fully closed", () => {
    const pf = new Portfolio(10000);
    buy(pf, 100, 10);
    sell(pf, 130, 10);
    const pos = pf.positions.get("helix");
    expect(pos.shares).toBe(0);
    expect(pos.avgCost).toBe(0);
    expect(pos.realizedPnl).toBeCloseTo(300, 6);
  });
});

describe("Portfolio shorting & margin", () => {
  it("opens a short: negative shares, proceeds added to cash", () => {
    const pf = new Portfolio(10000);
    sell(pf, 100, 10); // short 10 @ 100
    expect(pf.sharesOf("helix")).toBe(-10);
    expect(pf.cash).toBeCloseTo(11000, 6);
    const pos = pf.positions.get("helix");
    expect(pos.avgCost).toBeCloseTo(100, 6);
  });

  it("profits on a short when price falls", () => {
    const pf = new Portfolio(10000);
    sell(pf, 100, 10); // short 10 @ 100
    const snap = pf.snapshot(snapAt(90));
    expect(snap.unrealizedPnl).toBeCloseTo(100, 6); // (100-90)*10
    expect(snap.equity).toBeCloseTo(10100, 6);
    const pos = snap.positions[0];
    expect(pos.side).toBe("short");
    expect(pos.returnPct).toBeCloseTo(0.1, 6); // +10% on the short
  });

  it("realizes P&L when a short is covered", () => {
    const pf = new Portfolio(10000);
    sell(pf, 100, 10); // short 10 @ 100
    buy(pf, 90, 10); // cover at 90
    const pos = pf.positions.get("helix");
    expect(pos.shares).toBe(0);
    expect(pos.realizedPnl).toBeCloseTo(100, 6); // (100-90)*10
    expect(pf.cash).toBeCloseTo(10100, 6);
  });

  it("flips long to short in one oversized sell, realizing the long P&L", () => {
    const pf = new Portfolio(100000);
    buy(pf, 100, 10); // long 10 @ 100
    sell(pf, 130, 15); // sell 15: close 10 (+300), open short 5 @ 130
    const pos = pf.positions.get("helix");
    expect(pos.shares).toBe(-5);
    expect(pos.avgCost).toBeCloseTo(130, 6);
    expect(pos.realizedPnl).toBeCloseTo(300, 6);
  });

  it("reports buying power as equity minus gross exposure (cash-only default)", () => {
    const pf = new Portfolio(1000);
    buy(pf, 100, 6); // $600 of the $1000 deployed
    const snap = pf.snapshot(snapAt(100));
    expect(snap.grossExposure).toBeCloseTo(600, 6);
    expect(snap.equity).toBeCloseTo(1000, 6);
    expect(snap.buyingPower).toBeCloseTo(400, 6); // 1000*1 - 600
  });

  it("leaves nothing available once the account is fully deployed", () => {
    const pf = new Portfolio(1000);
    buy(pf, 100, 10); // the whole $1000
    const snap = pf.snapshot(snapAt(100));
    expect(snap.buyingPower).toBeCloseTo(0, 6);
    expect(snap.cash).toBeCloseTo(0, 6); // never negative: no margin loan
  });

  it("still applies a custom leverage cap when one is configured", () => {
    const levered = new ExecutionEngine({ maxLeverage: 3 });
    const pf = new Portfolio(1000, { maxLeverage: 3 });
    buy(pf, 100, 20, levered); // $2000 exposure
    const snap = pf.snapshot(snapAt(100));
    expect(snap.buyingPower).toBeCloseTo(1000, 6); // 1000*3 - 2000
    expect(snap.leverage).toBeCloseTo(2, 6);
  });
});

describe("Portfolio snapshot fill ledger", () => {
  it("exposes the fills on the snapshot so the UI never reaches into the model", () => {
    const pf = new Portfolio(10000);
    buy(pf, 100, 10);
    sell(pf, 110, 4);
    const snap = pf.snapshot(snapAt(110));
    expect(snap.fills.length).toBe(2);
    expect(snap.fills[0].companyId).toBe("helix");
    expect(snap.fills[0].side).toBe("buy");
    expect(snap.fills[1].side).toBe("sell");
    expect(snap.fills[1].price).toBeCloseTo(110, 6);
  });
});

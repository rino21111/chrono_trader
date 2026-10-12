// Portfolio + accounting (design doc sections 8 and 15).
//
// Tracks cash and per-company positions, applies fills, and computes the derived
// figures the UI shows: unrealized/realized P&L, average entry, position value
// and return, equity, and margin/buying-power. Pure domain logic — no UI, no
// clock.
//
// A position is { shares, avgCost, realizedPnl }. shares is SIGNED: positive is
// long, negative is a short. avgCost is the average entry price of the shares
// currently held in whichever direction the position is open (for a short, the
// average price they were sold short at). Short sale proceeds add to cash but are
// offset by the (negative) position value, so equity stays honest — which is why
// cash can read high while a short is open without meaning anything is spendable.

import { MAX_LEVERAGE } from "../config.js";

export class Portfolio {
  constructor(startingCash, { maxLeverage = MAX_LEVERAGE } = {}) {
    this.startingCash = startingCash;
    this.cash = startingCash;
    this.maxLeverage = maxLeverage;
    this.positions = new Map(); // companyId -> { shares, avgCost, realizedPnl }
    this.fills = []; // append-only ledger of executed fills
  }

  _pos(companyId) {
    let p = this.positions.get(companyId);
    if (!p) {
      p = { shares: 0, avgCost: 0, realizedPnl: 0 };
      this.positions.set(companyId, p);
    }
    return p;
  }

  sharesOf(companyId) {
    const p = this.positions.get(companyId);
    return p ? p.shares : 0;
  }

  // Apply a successful FillResult from the ExecutionEngine. Handles adding to a
  // position, reducing it, and flipping through zero (e.g. selling more than you
  // are long opens a short with the remainder). Returns the ledger record.
  applyFill(fill, gameTime) {
    const p = this._pos(fill.order.companyId);
    const price = fill.price;
    const delta = fill.side === "buy" ? fill.quantity : -fill.quantity; // signed
    const s = p.shares;

    if (s === 0 || (s > 0) === (delta > 0)) {
      // Opening or adding in the current direction: weighted-average cost.
      const mag = Math.abs(s) + Math.abs(delta);
      p.avgCost = (p.avgCost * Math.abs(s) + price * Math.abs(delta)) / mag;
      p.shares = s + delta;
    } else {
      // delta opposes the open position: realize P&L on the closed portion.
      const closing = Math.min(Math.abs(s), Math.abs(delta));
      // sign(s): +1 long (gain when price > avgCost), -1 short (gain when below).
      p.realizedPnl += Math.sign(s) * (price - p.avgCost) * closing;
      const newShares = s + delta;
      p.shares = newShares;
      if (newShares === 0) p.avgCost = 0;
      else if (Math.sign(newShares) !== Math.sign(s)) p.avgCost = price; // flipped
      // else a partial close — avgCost of the remaining shares is unchanged.
    }

    this.cash += fill.cashDelta; // buy: negative; sell: positive
    const record = {
      companyId: fill.order.companyId,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      gameTime,
      cashAfter: this.cash,
    };
    this.fills.push(record);
    return record;
  }

  // Lightweight equity + gross-exposure read used by the ExecutionEngine to
  // check margin before a trade. Gross exposure sums the ABSOLUTE market value
  // of every open position (longs and shorts both consume buying power).
  marginState(marketSnapshot) {
    let positionsValue = 0;
    let grossExposure = 0;
    for (const [companyId, p] of this.positions) {
      if (p.shares === 0) continue;
      const quote = marketSnapshot.prices[companyId];
      const price = quote ? quote.price : p.avgCost;
      positionsValue += price * p.shares;
      grossExposure += Math.abs(price * p.shares);
    }
    const equity = this.cash + positionsValue;
    const buyingPower = Math.max(0, equity * this.maxLeverage - grossExposure);
    return { equity, grossExposure, buyingPower };
  }

  // Snapshot of everything the UI needs to render the portfolio, given the
  // current market snapshot for pricing open positions.
  snapshot(marketSnapshot) {
    const positions = [];
    let positionsValue = 0; // signed net value (shorts subtract)
    let grossExposure = 0;
    let unrealized = 0;
    let realized = 0;

    for (const [companyId, p] of this.positions) {
      realized += p.realizedPnl;
      if (p.shares === 0) continue;
      const quote = marketSnapshot.prices[companyId];
      const price = quote ? quote.price : p.avgCost;
      const value = price * p.shares; // signed
      const cost = p.avgCost * Math.abs(p.shares);
      const posUnrealized = (price - p.avgCost) * p.shares; // signed-correct
      positionsValue += value;
      grossExposure += Math.abs(value);
      unrealized += posUnrealized;
      positions.push({
        companyId,
        shares: p.shares,
        side: p.shares < 0 ? "short" : "long",
        avgCost: p.avgCost,
        price,
        value,
        exposure: Math.abs(value),
        unrealizedPnl: posUnrealized,
        // Position return: gain relative to notional put at risk, so a short
        // that falls shows a positive return.
        returnPct: cost > 0 ? posUnrealized / cost : 0,
      });
    }

    const equity = this.cash + positionsValue;
    const buyingPower = Math.max(0, equity * this.maxLeverage - grossExposure);
    const leverage = equity > 0 ? grossExposure / equity : 0;
    return {
      cash: this.cash,
      positionsValue,
      equity,
      grossExposure,
      buyingPower,
      leverage,
      maxLeverage: this.maxLeverage,
      unrealizedPnl: unrealized,
      realizedPnl: realized,
      totalReturnPct: (equity - this.startingCash) / this.startingCash,
      positions,
      // The fill ledger, exposed so the UI (chart markers, the debrief's
      // traded-or-not flags) reads it off the snapshot like everything else
      // instead of reaching into this model.
      fills: this.fills,
    };
  }
}

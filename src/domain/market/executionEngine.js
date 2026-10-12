// Execution engine (design doc sections 7.5 and 14).
//
// Single-player orders execute immediately at the displayed price, optionally
// with a small fixed spread. Orders are validated against BUYING POWER (equity ×
// maxLeverage, which ships at 1 — cash only), so an order can never commit more
// than the account holds. A sell may still go past a flat/long position to open a
// SHORT, which consumes buying power 1:1 like a long. Keeping all of this behind
// one interface means a shared order book, slippage, borrow fees, or NPC traders
// can be added later without touching the UI or portfolio code.
//
//   execute(order, snapshot, portfolio): FillResult
//
// An Order is { companyId, side: "buy"|"sell", quantity }.
// A FillResult is { ok, order, side, price, quantity, cashDelta, reason? }.

import { MAX_LEVERAGE, ALLOW_SHORT } from "../config.js";

export class ExecutionEngine {
  // spreadBps: half-spread in basis points applied against the trader (buys pay
  // a little more, sells receive a little less). maxLeverage caps gross exposure
  // relative to equity. allowShort permits sells to open negative positions.
  constructor({ spreadBps = 0, maxLeverage = MAX_LEVERAGE, allowShort = ALLOW_SHORT } = {}) {
    this.spreadBps = spreadBps;
    this.maxLeverage = maxLeverage;
    this.allowShort = allowShort;
  }

  execute(order, snapshot, portfolio) {
    const quote = snapshot.prices[order.companyId];
    if (!quote) {
      return { ok: false, order, reason: "unknown-company" };
    }
    const qty = Math.floor(order.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, order, reason: "invalid-quantity" };
    }
    if (order.side !== "buy" && order.side !== "sell") {
      return { ok: false, order, reason: "invalid-side" };
    }

    const spread = quote.price * (this.spreadBps / 10000);
    const fillPrice =
      order.side === "buy" ? quote.price + spread : Math.max(0.01, quote.price - spread);

    const delta = order.side === "buy" ? qty : -qty;
    const cur = portfolio.sharesOf(order.companyId);
    const newShares = cur + delta;

    // Opening or extending a short requires shorting to be enabled.
    if (!this.allowShort && newShares < 0) {
      return { ok: false, order, reason: "shorting-disabled" };
    }

    // Funding check: an order that INCREASES gross exposure must fit inside
    // buying power (equity × maxLeverage). Reducing exposure — trimming a long
    // or covering a short — is always allowed. Exposure is marked at quote price.
    const oldExposure = Math.abs(cur * quote.price);
    const newExposure = Math.abs(newShares * quote.price);
    if (newExposure > oldExposure) {
      const { equity, grossExposure } = portfolio.marginState(snapshot);
      const projectedGross = grossExposure - oldExposure + newExposure;
      if (equity <= 0 || projectedGross > equity * this.maxLeverage + 1e-6) {
        return { ok: false, order, reason: "insufficient-buying-power" };
      }
    }

    const cashDelta = order.side === "buy" ? -fillPrice * qty : fillPrice * qty;
    return {
      ok: true,
      order,
      side: order.side,
      price: fillPrice,
      quantity: qty,
      cashDelta,
      opensShort: cur >= 0 && newShares < 0,
      closesPosition: newShares === 0,
    };
  }
}

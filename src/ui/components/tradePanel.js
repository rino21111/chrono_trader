// TradePanel (design doc section 11.2): pick quantity, buy/sell the selected
// company at the displayed price. All validation lives in the domain
// (ExecutionEngine); this panel only dispatches orders and shows the result.

import { el } from "../dom.js";
import { price, money, signClass, pct, pctArrow } from "../../utils/format.js";
import { mountPriceChart } from "./priceChart.js";

const REASON_TEXT = {
  "insufficient-buying-power": "Not enough left to cover that — free up cash first.",
  "shorting-disabled": "Shorting is turned off in this scenario.",
  "invalid-quantity": "Enter a whole number of shares.",
  "unknown-company": "Select a company first.",
  "market-paused": "The clock is stopped — resume to trade.",
};

export function mountTradePanel(store) {
  const nameEl = el("h2", {});
  const sectorEl = el("div", { class: "trade-sector" });
  // The company's full cast description — same text as its market row. Repeated
  // here so the fact sheet is in view while you size the order.
  const descEl = el("div", { class: "trade-desc" });
  const priceEl = el("span", { class: "trade-price" });
  const changeEl = el("span", { class: "trade-change" });

  const chart = mountPriceChart(store);

  // Sizing is either a FRACTION of what you can currently afford, or an ABSOLUTE
  // share count you typed. Fixed counts (10/50/100) were close to useless here:
  // prices span $34 to $210, so "100 shares" means wildly different risk depending
  // on the name, and nobody thinks in shares anyway — they think "half my book."
  const FRACTIONS = [
    { label: "⅛", value: 0.125 },
    { label: "¼", value: 0.25 },
    { label: "½", value: 0.5 },
    { label: "Max", value: 1 },
  ];

  // null = absolute mode (whatever is typed in the box wins). Default to a
  // quarter: a sane opening bet that also shows the control is live.
  let activeFraction = 0.25;

  const qtyInput = el("input", { class: "qty-input", type: "number", min: "1", step: "1", value: "0" });

  const presets = FRACTIONS.map((f) => {
    const btn = el(
      "button",
      {
        class: "btn qty-preset",
        onClick: () => {
          activeFraction = f.value;
          syncSizing();
        },
      },
      f.label
    );
    return { ...f, btn };
  });

  // Typing a number takes manual control and drops the fraction lock.
  qtyInput.addEventListener("input", () => {
    activeFraction = null;
    syncSizing();
  });

  const estimateEl = el("div", { class: "trade-estimate" });
  const errorEl = el("div", { class: "trade-error" });

  const buyBtn = el("button", { class: "btn btn-buy", onClick: () => order("buy") }, "Buy");
  const flattenBtn = el("button", { class: "btn btn-flat", onClick: () => flatten(), title: "Close this position" }, "Flatten");
  const sellBtn = el("button", { class: "btn btn-sell", onClick: () => order("sell") }, "Sell / Short");

  const heldEl = el("div", { class: "trade-held" });
  const powerEl = el("div", { class: "trade-power" });

  const node = el("section", { class: "panel trade-panel" }, [
    el("div", { class: "trade-headline" }, [nameEl, sectorEl, descEl]),
    el("div", { class: "trade-quote" }, [priceEl, changeEl]),
    chart.node,
    heldEl,
    el("div", { class: "trade-controls" }, [
      el("label", { class: "trade-qty-row" }, [el("span", {}, "Shares"), qtyInput]),
      el("div", { class: "quick-row" }, presets.map((p) => p.btn)),
      estimateEl,
      el("div", { class: "trade-buttons" }, [buyBtn, flattenBtn, sellBtn]),
      powerEl,
      errorEl,
    ]),
  ]);

  function selectedCompany(state) {
    return state.scenario.companies.find((c) => c.companyId === state.selectedCompanyId);
  }

  function currentPrice() {
    const q = store.state.market.prices[store.state.selectedCompanyId];
    return q ? q.price : 0;
  }

  // Shares that a fraction of what's still deployable buys at the current price.
  function sharesFor(fraction) {
    const p = currentPrice();
    if (p <= 0) return 0;
    return Math.floor(((store.state.portfolio.buyingPower || 0) * fraction) / p);
  }

  // The quantity an order would actually use, resolved at the moment it's asked
  // for. This is what closes the race: with a fraction selected we never trade a
  // stale share count that was affordable a few ticks ago and isn't any more.
  function currentQty() {
    if (activeFraction !== null) return sharesFor(activeFraction);
    return Math.floor(Number(qtyInput.value) || 0);
  }

  // Refresh the highlighted preset, the (live) share box and the cost estimate.
  // Called on every store tick, so a fraction-sized order tracks the price and
  // buying power as they move. The resulting share count shows in the box and the
  // estimate line, so the presets themselves stay bare.
  function syncSizing() {
    for (const p of presets) {
      p.btn.classList.toggle("is-active", activeFraction === p.value);
    }

    const qty = currentQty();
    if (activeFraction !== null) {
      const next = String(qty);
      if (qtyInput.value !== next) qtyInput.value = next; // don't fight the caret
    }

    if (qty <= 0) {
      estimateEl.textContent = activeFraction !== null ? "Nothing left to deploy." : "";
      return;
    }
    const cost = qty * currentPrice();
    estimateEl.textContent = `${qty} sh × ${price(currentPrice())} ≈ ${money(cost)}`;
  }

  function order(side) {
    store.submitOrder({ companyId: store.state.selectedCompanyId, side, quantity: currentQty() });
  }

  // Close the open position in one click: sell what you're long, buy back what
  // you're short. Reducing exposure always clears the margin check.
  function flatten() {
    const id = store.state.selectedCompanyId;
    const held = store.state.portfolio.positions.find((p) => p.companyId === id);
    if (!held || held.shares === 0) return;
    const side = held.shares > 0 ? "sell" : "buy";
    store.submitOrder({ companyId: id, side, quantity: Math.abs(held.shares) });
  }

  function update(state) {
    const c = selectedCompany(state);
    if (!c) return;
    nameEl.textContent = c.name;
    sectorEl.textContent = c.sector;
    descEl.textContent = c.description;
    const q = state.market.prices[c.companyId];
    if (q) {
      priceEl.textContent = "$" + price(q.price);
      changeEl.textContent = pctArrow(q.changePct);
      changeEl.className = "trade-change " + signClass(q.changePct);
    }

    const held = state.portfolio.positions.find((p) => p.companyId === c.companyId);
    if (held) {
      const isShort = held.shares < 0;
      heldEl.className = "trade-held has " + (isShort ? "short" : "long");
      const label = isShort ? "Short" : "Long";
      heldEl.textContent =
        `${label} ${Math.abs(held.shares)} sh · avg ${price(held.avgCost)} · ${money(held.unrealizedPnl)} (${pct(held.returnPct)})`;
    } else {
      heldEl.className = "trade-held";
      heldEl.textContent = "No position";
    }

    // Pause is read-only (the store rejects orders too — this just makes the
    // keys honest about it): frozen clock, frozen book.
    const tradingOpen = state.status === "playing";
    buyBtn.disabled = !tradingOpen;
    sellBtn.disabled = !tradingOpen; // sells can now open a short, no holding required
    flattenBtn.disabled = !tradingOpen || !held; // only meaningful with a position to close

    powerEl.textContent = `${money(state.portfolio.buyingPower || 0)} available to trade`;

    errorEl.textContent = state.lastOrderError ? (REASON_TEXT[state.lastOrderError] || state.lastOrderError) : "";
    syncSizing();
    chart.update(state);
  }

  return { node, update };
}

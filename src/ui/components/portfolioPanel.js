// PortfolioPanel (design doc section 8 "Portfolio display", section 11.1 dock):
// a slim account summary — equity, what's left to deploy, and P&L. Open positions
// live inline in the Market table now, so the dock stays scannable.
//
// Cash is deliberately NOT shown. Now that there's no margin it equals Available
// for any long-only book, and the one time it differs it lies: short proceeds
// land in cash but are already spoken for as collateral, so a fully-shorted
// account reads $199,999 cash against $1 actually deployable. Equity answers
// "what is this worth" and Available answers "what can I still do" — cash only
// muddies both.

// WHEN A NAME YOU HOLD GAPS, THE DOCK FEELS IT. The market row lights up (see
// the heat note in marketTable.js), but the number that actually matters to the
// player is down here — so the same impulse-with-afterglow drives the two
// figures a gap actually moves: unrealized P&L and total return. Same rule as
// upstairs: it is light, not chrome, and it is computed from the account the
// player can already see, not from the event timeline.

import { el } from "../dom.js";
import { money, pct, signClass } from "../../utils/format.js";

// Swing in unrealized P&L, as a fraction of equity PER SECOND. Same shape as the
// market row's heat: a gate below which the account is merely breathing (a book
// drifting with the quiet tape moves by ~0.0001/s), and a full-heat rate a gap
// in a name you actually hold clears easily — 25% of equity in a name that gaps
// 15% inside a third of a second is ~0.12/s.
const SWING_GATE = 0.004;
const SWING_RATE_FULL = 0.05;
const HEAT_TAU = 0.9; // seconds for the afterglow to fall to ~37%
const HEAT_FLOOR = 0.03;
const MAX_FRAME = 0.25; // longer than this and the tab was asleep, not the market fast

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const step = (n, s) => Math.round(n / s) * s;

export function mountPortfolioPanel(store) {
  const stat = (label) => {
    const val = el("span", { class: "stat-val" });
    const box = el("div", { class: "stat" }, [el("span", { class: "stat-label" }, label), val]);
    return { box, val };
  };

  const equity = stat("Equity");
  const power = stat("Available");
  const unreal = stat("Unrealized P&L");
  const real = stat("Realized P&L");
  const ret = stat("Total Return");

  const node = el("footer", { class: "panel portfolio-panel" }, [
    el("div", { class: "pf-stats" }, [equity.box, power.box, unreal.box, real.box, ret.box]),
  ]);

  // The two figures a gap in a held name actually moves. Equity, available and
  // realized are deliberately left calm: realized doesn't move on a gap at all,
  // and lighting up every number at once would say nothing.
  const heated = [unreal.box, ret.box];
  let lastFrame = performance.now();
  let lastUnrealized = null;
  let heat = 0;
  let heatDir = 0;
  let wroteHeat = -1;

  function update(state) {
    const p = state.portfolio;
    if (!p) return;
    equity.val.textContent = money(p.equity);
    power.val.textContent = money(p.buyingPower);
    setSigned(unreal.val, p.unrealizedPnl, money);
    setSigned(real.val, p.realizedPnl, money);
    setSigned(ret.val, p.totalReturnPct, (n) => pct(n));
    applyHeat(p);
  }

  // Impulse wins on the way up, the decay carries it down — the same shape as a
  // market row's heat, so the dock and the row that caused it cool together.
  function applyHeat(p) {
    const now = performance.now();
    const raw = (now - lastFrame) / 1000;
    lastFrame = now;
    // Same discontinuity guard as the market rows: a frame this long means the
    // tab was asleep, not that the account moved that fast. The game clock caps
    // its own catch-up too (gameClock.js); this stays as the second line of
    // defense. Heat only decays across it.
    const jumped = raw > MAX_FRAME;
    const dt = Math.min(MAX_FRAME, Math.max(1 / 240, raw));

    const delta = lastUnrealized === null || jumped ? 0 : p.unrealizedPnl - lastUnrealized;
    lastUnrealized = p.unrealizedPnl;

    const rate = Math.abs(delta) / Math.max(1, Math.abs(p.equity)) / dt;
    const impulse = clamp01((rate - SWING_GATE) / (SWING_RATE_FULL - SWING_GATE));
    const cooling = heat * Math.exp(-dt / HEAT_TAU);
    heat = Math.max(impulse, cooling);
    if (impulse >= cooling && delta !== 0) heatDir = delta > 0 ? 1 : -1;

    const hot = heat >= HEAT_FLOOR;
    const value = hot ? step(heat, 0.05) : 0;
    if (value === wroteHeat) return;
    wroteHeat = value;
    for (const box of heated) {
      box.style.setProperty("--pf-heat", String(value));
      box.classList.toggle("surging", hot);
      box.classList.toggle("heat-up", hot && heatDir > 0);
      box.classList.toggle("heat-down", hot && heatDir < 0);
    }
  }

  return { node, update };
}

function setSigned(node, n, fmt) {
  node.textContent = fmt(n);
  node.classList.remove("pos", "neg", "flat");
  node.classList.add(signClass(n));
}

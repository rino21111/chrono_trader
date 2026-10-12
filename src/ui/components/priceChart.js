// PriceChart (design doc section 11.2 "View price chart", section 17 debrief).
//
// A lightweight custom SVG sparkline (the doc suggests exactly this over a chart
// library). It samples the price path as the week progresses and overlays the
// player's buy/sell markers for the selected company. Kept deterministic-free:
// it only visualizes whatever prices the market engine already produced.

import { price as fmtPrice } from "../../utils/format.js";

const NS = "http://www.w3.org/2000/svg";
const W = 320;
const H = 96;
const PAD = 6;
const SAMPLE_STEP = 0.002; // ~500 points across the week

// The chart shows a WINDOW of the week rather than all of it.
//
// A whole-week view scaled to the whole week's range is exactly the 40px
// sparkline problem: once a big event has landed, its gap owns the vertical
// scale and the correction ringing inside it — the thing you are supposed to be
// trading — is a couple of pixels of wobble. Windowing does both jobs at once:
// the live dislocation fills the width, and the vertical scale follows the
// window, so an aftermath is drawn at the size of an aftermath.
//
// 0.3 of the week is a little wider than the longest settleSpan (chop tops out
// at 0.34, but its interesting half is the front), so a wave in progress is
// almost always fully on screen with room either side to see where it came from.
const WINDOW = 0.3;

function svg(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

export function mountPriceChart(store) {
  // history: companyId -> [{ progress, price }]
  const history = new Map();
  let lastSampled = -1;

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "price-chart", preserveAspectRatio: "none" });
  const node = wrap(root);

  // Returns true when it actually recorded a sample (or reset), so update()
  // knows the drawn path is stale.
  function sample(state) {
    if (state.progress < lastSampled) {
      history.clear();
      lastSampled = -1;
    }
    if (state.progress - lastSampled < SAMPLE_STEP && lastSampled >= 0 && state.progress < 1) return false;
    lastSampled = state.progress;
    for (const [id, q] of Object.entries(state.market.prices)) {
      if (!history.has(id)) history.set(id, []);
      history.get(id).push({ progress: state.progress, price: q.price });
    }
    return true;
  }

  function draw(state) {
    while (root.firstChild) root.removeChild(root.firstChild);
    const id = state.selectedCompanyId;
    const series = history.get(id) || [];
    const company = state.scenario.companies.find((c) => c.companyId === id);
    if (!company || series.length < 2) return;

    const open = company.openingPrice;
    const winStart = Math.max(0, state.progress - WINDOW);
    const winEnd = winStart + WINDOW;
    const visible = series.filter((pt) => pt.progress >= winStart);
    if (visible.length < 2) return;

    // Scale to what's ON SCREEN, not to the whole week. This is the line that
    // makes a correction legible: inside the window the ring is most of the
    // range, so it gets most of the height.
    let min = Infinity;
    let max = -Infinity;
    for (const pt of visible) {
      if (pt.price < min) min = pt.price;
      if (pt.price > max) max = pt.price;
    }
    // Add a little headroom so the line isn't glued to the edges.
    const span = Math.max(max - min, open * 0.005);
    min -= span * 0.15;
    max += span * 0.15;

    const x = (p) => PAD + ((p - winStart) / WINDOW) * (W - 2 * PAD);
    const y = (v) => H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD);

    // Opening reference, drawn only when it's actually in view. Off-window it
    // would either distort the scale or sit pinned to an edge implying the tape
    // is closer to the open than it is; the trade panel's change % carries that
    // job instead.
    //
    // Note what is deliberately NOT here: a fair-value line. The engine knows
    // exactly where each wave settles (marketEngine.fairPriceFor), and drawing
    // it would hand the player the answer — the whole point of the second wave
    // is that you have to read where it's going.
    if (open >= min && open <= max) {
      root.appendChild(svg("line", { x1: PAD, y1: y(open), x2: W - PAD, y2: y(open), class: "chart-ref" }));
    }

    // Price path.
    const d = visible.map((pt, i) => `${i === 0 ? "M" : "L"} ${x(pt.progress).toFixed(1)} ${y(pt.price).toFixed(1)}`).join(" ");
    const last = visible[visible.length - 1];
    const cls = last.price >= open ? "chart-line pos" : "chart-line neg";
    root.appendChild(svg("path", { d, class: cls }));

    // Trade markers for this company, read off the portfolio snapshot.
    const fills = state.portfolio ? state.portfolio.fills : [];
    for (const f of fills) {
      if (f.companyId !== id) continue;
      const prog = f.gameTime / state.scenario.durationSeconds;
      if (prog < winStart || prog > winEnd) continue;
      const m = svg("circle", { cx: x(prog).toFixed(1), cy: y(f.price).toFixed(1), r: 3.2, class: "chart-marker " + (f.side === "buy" ? "buy" : "sell") });
      root.appendChild(m);
    }

    // Last price dot.
    root.appendChild(svg("circle", { cx: x(last.progress).toFixed(1), cy: y(last.price).toFixed(1), r: 2.4, class: "chart-dot " + (last.price >= open ? "pos" : "neg") }));
  }

  // Redraw only when something drawn actually changed: a fresh sample, a
  // different company, or a new fill (markers). Rebuilding the ~250-point SVG
  // path on every 60fps store tick was pure churn between samples.
  let lastDrawKey = "";
  function update(state) {
    const sampled = sample(state);
    const fills = state.portfolio && state.portfolio.fills ? state.portfolio.fills.length : 0;
    const key = `${state.selectedCompanyId}:${fills}`;
    if (!sampled && key === lastDrawKey) return;
    lastDrawKey = key;
    draw(state);
  }

  return { node, update };
}

function wrap(root) {
  const div = document.createElement("div");
  div.className = "price-chart-wrap";
  div.appendChild(root);
  return div;
}

// Exported for the debrief, which draws a static full-week chart per company.
export { fmtPrice };

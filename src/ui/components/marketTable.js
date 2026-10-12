// MarketTable (design doc section 11.1 right column): live prices per company,
// with your open position folded inline. Rows are built once; only the price /
// change cells, the position line, and the tick flash update each frame, so the
// table doesn't churn and selection stays stable.
//
// Each row carries the company's one-line description from the scenario cast.
// That line is the player's entire fact sheet — the fair-play rule says every
// deduction a vision asks for must be grounded there — so it is always visible,
// not tucked behind a click.
//
// HEAT: WHEN A NAME GOES, THE ROW GOES WITH IT. An event lands as a near-instant
// gap (see pricingModel), and on a quiet list of 13 tickers that used to be a
// couple of digits quietly rewriting themselves — the most violent thing in the
// game was also the easiest to miss. Every row now carries two continuous
// numbers, both written as custom properties and resolved entirely in CSS:
//
//   --mkt-heat  how violently it is moving RIGHT NOW (0 calm → 1 gapping)
//   --mkt-move  how far it has moved on the week (0 → 1 at a huge standing move)
//
// Heat is a rate with an afterglow: it spikes the instant the tape lurches and
// falls away over about a second, so the row FLASHES AND FADES while you look at
// it. That flash is the whole effect — the row is never displaced, sliced or
// stuttered. A one-shot glitch (slices hard-cutting, the way a vision breaks up
// when it comes to pass) was tried here and removed: on the board a glitch reads
// as the veil tearing, but on a table of live figures it just reads as the UI
// malfunctioning at the exact moment you need to trust the numbers.
//
// Move is a standing state — it is what makes the day's big winners and losers
// findable at a glance without reading every number.
//
// DERIVED FROM THE PRICE STREAM, NEVER FROM THE EVENT TIMELINE. The UI is not
// told which companies an event touches (that's the fair-play rule — see
// loadScenario), and this must not become the back door. Everything below is
// computed from prices the player can already see on screen.

import { el } from "../dom.js";
import { price, pctArrow, pct, money, signClass } from "../../utils/format.js";

// Both thresholds are |Δprice|/price per SECOND, and both are MEASURED off this
// game's own tape rather than guessed. Sampling every company over quiet
// stretches and over event gaps (at 1× and at 4×, which quadruples every rate):
//
//   quiet  p50 0.0004 → 0.0018   p99 0.0024 → 0.0094   worst seen 0.0143
//   gap    p99 0.154  → 0.371    peak 0.63  → 2.46
//
// Two orders of magnitude apart, so the gate sits above anything the calm tape
// has ever produced — heat NEVER lights for ordinary breathing, at any speed —
// and full heat lands inside the gap's own burst.
const HEAT_GATE = 0.03;
const SURGE_RATE_FULL = 0.35;
// Seconds for the afterglow to fall to ~37%. Long enough to notice a gap you
// weren't looking at, short enough that the list is calm again by the time you
// have read the headline that caused it.
const HEAT_TAU = 0.9;
const HEAT_FLOOR = 0.03; // below this the row is simply calm
// Longer than this between frames and the tape didn't move fast — the tab was
// asleep. See the discontinuity guard in update().
const MAX_FRAME = 0.25;

// The standing move ramp: |changePct| from 2% (worth noticing) to 12% (as loud
// as the row gets). Beyond that it saturates rather than shouting louder.
const MOVE_FLOOR = 0.02;
const MOVE_FULL = 0.12;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
// Custom properties are written in steps so a 60fps update doesn't churn the
// style system with values no eye can tell apart.
const step = (n, s) => Math.round(n / s) * s;

export function mountMarketTable(store) {
  const rows = new Map(); // companyId -> refs
  const body = el("div", { class: "mkt-body" });
  let lastFrame = performance.now();

  for (const c of store.state.scenario.companies) {
    const priceEl = el("span", { class: "mkt-price" }, price(c.openingPrice));
    const changeEl = el("span", { class: "mkt-change flat" }, "▪ 0.00%");
    const posBadge = el("span", { class: "pos-badge" });
    const posDetail = el("span", { class: "pos-detail" });
    const posEl = el("span", { class: "mkt-pos" }, [posBadge, posDetail]);
    // The heat layer. A separate element rather than the row's own background so
    // it composes over whatever state the row is in — selected, held, hovered —
    // instead of fighting those for the same box-shadow. Decorative and
    // click-through.
    const veil = el("span", { class: "mkt-veil", "aria-hidden": "true" });
    const row = el(
      "button",
      { class: "mkt-row", dataset: { id: c.companyId }, onClick: () => store.selectCompany(c.companyId) },
      [
        veil,
        el("span", { class: "mkt-top" }, [
          el("span", { class: "mkt-name" }, [el("span", { class: "mkt-ticker" }, c.name), el("span", { class: "mkt-sector" }, c.sector)]),
          el("span", { class: "mkt-nums" }, [priceEl, changeEl]),
        ]),
        el("span", { class: "mkt-desc" }, c.description),
        posEl,
      ]
    );
    rows.set(c.companyId, {
      row,
      priceEl,
      changeEl,
      posEl,
      posBadge,
      posDetail,
      lastPrice: c.openingPrice,
      heat: 0,
      heatDir: 0, // the direction of the impulse that lit it, held through the decay
      wroteHeat: -1,
      wroteMove: -1,
    });
    body.appendChild(row);
  }

  const node = el("aside", { class: "panel market-table" }, [
    el("div", { class: "panel-head" }, [el("h2", {}, "Market"), el("span", { class: "panel-hint" }, "click to trade")]),
    body,
  ]);

  function update(state) {
    const posById = new Map((state.portfolio?.positions || []).map((p) => [p.companyId, p]));
    // Real elapsed time between paints — heat is a RATE, so it must not depend
    // on how often the store happens to emit.
    const now = performance.now();
    const raw = (now - lastFrame) / 1000;
    lastFrame = now;
    // A frame this long is a DISCONTINUITY, not a fast market: the tab was in
    // the background. The game clock caps its own catch-up now (see
    // MAX_TICK_SECONDS in gameClock.js), so prices barely move across the gap —
    // this guard remains as the second line of defense so a discontinuity can
    // never read as heat, whatever the clock does.
    const jumped = raw > MAX_FRAME;
    const dt = Math.min(MAX_FRAME, Math.max(1 / 240, raw));

    for (const [id, ref] of rows) {
      const q = state.market.prices[id];
      if (!q) continue;
      ref.priceEl.textContent = price(q.price);
      ref.changeEl.textContent = pctArrow(q.changePct);
      ref.changeEl.className = "mkt-change " + signClass(q.changePct);

      const delta = q.price - ref.lastPrice;
      // Brief tick flash on price change direction.
      if (delta > 1e-6) flash(ref.priceEl, "up");
      else if (delta < -1e-6) flash(ref.priceEl, "down");
      applyHeat(ref, jumped ? 0 : delta, q, dt);
      ref.lastPrice = q.price;
      ref.row.classList.toggle("selected", id === state.selectedCompanyId);

      // Inline position line — only present when you hold this name.
      const pos = posById.get(id);
      if (pos) {
        ref.row.classList.add("held");
        ref.posEl.classList.add("shown");
        ref.posBadge.textContent = pos.side === "short" ? "SHORT" : "LONG";
        ref.posBadge.className = "pos-badge " + pos.side;
        ref.posDetail.textContent = `${Math.abs(pos.shares)} sh · ${money(pos.unrealizedPnl)} (${pct(pos.returnPct)})`;
        ref.posDetail.className = "pos-detail " + signClass(pos.unrealizedPnl);
      } else {
        ref.row.classList.remove("held");
        ref.posEl.classList.remove("shown");
      }
    }
  }

  // Heat: an impulse with an afterglow. The instantaneous rate wins whenever it
  // is climbing (so a gap lights the row on the very frame it starts), and the
  // decayed value carries it the rest of the way down — one line each, and no
  // state machine to get out of step with the tape.
  function applyHeat(ref, delta, q, dt) {
    const rate = Math.abs(delta) / Math.max(1e-9, ref.lastPrice) / dt;
    const impulse = clamp01((rate - HEAT_GATE) / (SURGE_RATE_FULL - HEAT_GATE));
    const cooling = ref.heat * Math.exp(-dt / HEAT_TAU);
    ref.heat = Math.max(impulse, cooling);
    // Direction is claimed by the impulse that lit it and held through the
    // decay: a gap down that rings back up still reads as the crash it was.
    if (impulse >= cooling && delta !== 0) ref.heatDir = delta > 0 ? 1 : -1;

    const hot = ref.heat >= HEAT_FLOOR;
    const heat = hot ? step(ref.heat, 0.05) : 0;
    if (heat !== ref.wroteHeat) {
      ref.wroteHeat = heat;
      ref.row.style.setProperty("--mkt-heat", String(heat));
      ref.row.classList.toggle("surging", hot);
      ref.row.classList.toggle("heat-up", hot && ref.heatDir > 0);
      ref.row.classList.toggle("heat-down", hot && ref.heatDir < 0);
    }

    // The standing move: how far this name has travelled on the week. Unlike
    // heat this doesn't decay — it's what makes the day's big movers findable
    // in a list where every row is the same size.
    const move = step(clamp01((Math.abs(q.changePct) - MOVE_FLOOR) / (MOVE_FULL - MOVE_FLOOR)), 0.1);
    if (move !== ref.wroteMove) {
      ref.wroteMove = move;
      ref.row.style.setProperty("--mkt-move", String(move));
    }
  }

  return { node, update };
}

function flash(node, dir) {
  node.classList.remove("tick-up", "tick-down");
  // force reflow so the animation restarts
  void node.offsetWidth;
  node.classList.add(dir === "up" ? "tick-up" : "tick-down");
}

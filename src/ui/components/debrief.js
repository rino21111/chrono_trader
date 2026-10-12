// Debrief (design doc section 17): revealed only at Friday close. Teaches the
// world's logic — the causal chain behind every major move — and shows, name by
// name, what the week offered against what the player took out of it.

import { el, clear } from "../dom.js";
import { money, money0, pct, signClass } from "../../utils/format.js";
import { buildContributions, fairPriceFromEvents, eventShape, eventImpactPct } from "../../domain/market/pricingModel.js";
import { FAMILY } from "../../domain/market/aftermath.js";
import { makeCalendar } from "../../domain/clock/calendar.js";

const SEV_LABEL = { minor: "Minor", major: "Major", critical: "Critical" };
const DIR_ARROW = { positive: "▲", negative: "▼", neutral: "▪" };
const DIR_CLASS = { positive: "pos", negative: "neg", neutral: "flat" };

// What the tape did after each headline. The player can't be told which pattern
// is running while it runs — that's the whole game — so the debrief is where the
// vocabulary gets taught. Name the shape they just lived through, and next week
// they have something to recognize.
const KIND_LABEL = {
  // Over-reaction: the gap priced in more than the news was worth.
  fade: "overshot, then faded back through fair value",
  deadCat: "retraced until it looked finished, then went again",
  continuation: "never gave it back — it kept running past the print",
  grind: "gapped and sat there; nothing to trade after",
  chop: "chopped for a while before it settled",
  // Under-reaction: the gap fell short and price had to travel the rest.
  drift: "under-priced the news, then ground the rest of the way there",
  stairs: "took the news in steps, pausing long enough at each to look done",
  lateSurge: "sat still long enough to look like a dead name, then moved",
};

// Note wording, keyed by side (b/s) and whether the tape was rich or cheap
// (R/C) at the fill. `bC` and `sR` are the two good trades in either family.
const OVER_NOTES = {
  bC: (n) => `You bought ${n} into the panic — under fair value, and it came back.`,
  sR: (n) => `You sold ${n} into the overshoot rather than holding to settle.`,
  bR: (n) => `You bought the print on ${n}. The correction took it back.`,
  sC: (n) => `You sold ${n} below fair value, into the correction.`,
};
const UNDER_NOTES = {
  bC: (n) => `You bought ${n} while the tape still had the news under-priced.`,
  sR: (n) => `You sold ${n} before the tape had finished marking the news down.`,
  bR: (n) => `You bought ${n} with bad news still working its way into the tape.`,
  sC: (n) => `You sold ${n} with good news still working its way into the tape.`,
};

// A fill counts as taking (or eating) the dislocation only if the tape was this
// far from fair value when it printed. Below that it's just a trade.
//
// The two sides of a wave are NOT symmetric, which is what sets this number.
// Overshoots run 45-85% of the move past fair, but the ring back only carries
// price 15-20% of the move through the other side before it damps. A threshold
// tuned to the overshoot (25% felt right) silently never fires on an
// undershoot — so the "you bought the panic low" note, the whole point of
// teaching the second wave, could not happen. 12% is a real dislocation on
// either side.
const DISLOCATION_MIN = 0.12;

// How the player's fills lined up with an event's second wave. Returns short
// notes in the order the fills happened.
//
// The measure is where price sat RELATIVE TO FAIR when they filled, not whether
// they made money: impactPct * (shape - 1) is positive when the tape is above
// fair and negative when it's below, whichever way the news cut. Buying below
// fair and selling above it are the two good trades the wave offers; doing
// either backwards is chasing.
function waveNotes(ev, fills, nameById, durationSeconds) {
  const notes = [];
  const a = ev.aftermath;
  if (!a) return notes;
  const until = (ev.eventTime ?? 0) + (a.fake ? a.fake.span : 0) + a.settleSpan;

  for (const f of fills) {
    const affected = (ev.affectedCompanies || []).find((x) => x.companyId === f.companyId);
    if (!affected) continue;
    const p = f.gameTime / durationSeconds;
    if (p < (ev.eventTime ?? 0) || p > until) continue;

    const impact = eventImpactPct(ev, affected);
    if (!impact) continue;
    const dislocation = impact * (eventShape(p, ev) - 1);
    if (Math.abs(dislocation) < Math.abs(impact) * DISLOCATION_MIN) continue;

    const name = nameById.get(f.companyId) || f.companyId;
    const rich = dislocation > 0; // tape above fair value
    const bought = f.side === "buy";
    // Which side was right is the same arithmetic in both families — buy below
    // fair, sell above it. The STORY is not: an over-reaction is someone else's
    // panic to trade against, an under-reaction is news the tape hasn't finished
    // absorbing. Same fill, different lesson, so the note has to know which.
    const lines = FAMILY[a.kind] === "under" ? UNDER_NOTES : OVER_NOTES;
    notes.push(lines[(bought ? "b" : "s") + (rich ? "R" : "C")](name));
  }
  // A busy week can put a dozen fills inside one wave; the card is a teaching
  // beat, not a blotter. Two is enough to make the point.
  return notes.slice(0, 2);
}

export function mountDebrief(store) {
  const node = el("div", { class: "screen debrief-screen" });

  function render(state) {
    clear(node);
    const s = state.score;
    const scenario = state.scenario;
    const cal = makeCalendar(scenario.timeline);
    const nameById = new Map(scenario.companies.map((c) => [c.companyId, c.name]));

    // --- header + score tiles ---
    const tiles = el("div", { class: "debrief-tiles" }, [
      tile("Your Return", pct(s.playerReturn), signClass(s.playerReturn)),
      tile("Final Equity", money(s.finalEquity)),
      tile("Theses", `${s.correctTheses} right · ${s.incorrectTheses} wrong`),
    ]);

    // --- per-company outcome table ---
    const contrib = buildContributions(scenario.companies, scenario.events);
    const pnlById = new Map(s.companyPnl.map((p) => [p.companyId, p]));
    const rows = scenario.companies
      .map((c) => {
        const end = fairPriceFromEvents(1, c.openingPrice, contrib.get(c.companyId));
        const move = (end - c.openingPrice) / c.openingPrice;
        const traded = state.portfolio.fills.some((f) => f.companyId === c.companyId);
        const pnl = pnlById.get(c.companyId);
        return { c, end, move, traded, pnl };
      })
      .sort((a, b) => b.move - a.move);

    const outcomeBody = el("tbody", {});
    for (const r of rows) {
      outcomeBody.appendChild(
        el("tr", { class: r.traded ? "traded" : "" }, [
          el("td", {}, nameById.get(r.c.companyId)),
          el("td", { class: signClass(r.move) }, pct(r.move)),
          el("td", { class: r.traded ? signClass(r.pnl.playerPnl) : "" }, r.traded ? money0(r.pnl.playerPnl) : "—"),
          el("td", {}, pctAbs(r.pnl.offeredPct)),
        ])
      );
    }
    // Total row: player P&L sums to finalEquity - startingCash. The Offered
    // column is deliberately left blank rather than totalled — each row is that
    // symbol's own every-swing walk with the whole book in it, so the rows
    // overlap and their sum describes a week nobody could have traded.
    const totalPlayer = s.finalEquity - s.startingCash;
    const outcomeTable = el("table", { class: "outcome-table" }, [
      el("thead", {}, el("tr", {}, [th("Company"), th("Move"), th("Your P&L"), th("Offered")])),
      outcomeBody,
      el("tfoot", {}, el("tr", {}, [
        el("td", {}, "Total"),
        el("td", {}, ""),
        el("td", { class: signClass(totalPlayer) }, `${money0(totalPlayer)} (${pct(s.playerReturn)})`),
        el("td", {}, ""),
      ])),
    ]);

    // --- why it moved: one card per vision, in the order it hit the tape ---
    const insights = el("div", { class: "insights" });
    const shownEvents = (scenario.events || [])
      .filter((e) => e.visibleInDebrief !== false && (e.affectedCompanies || []).length)
      .sort((a, b) => a.eventTime - b.eventTime);
    for (const ev of shownEvents) {
      const impacts = el("ul", { class: "insight-impacts" });
      for (const a of ev.affectedCompanies) {
        impacts.appendChild(
          el("li", { class: "insight-impact" }, [
            el("span", { class: "impact-co " + (DIR_CLASS[a.direction] || "flat") }, `${DIR_ARROW[a.direction] || "▪"} ${nameById.get(a.companyId) || a.companyId}`),
            el("span", { class: "impact-why" }, a.explanation || ""),
          ])
        );
      }
      // What the tape did afterwards, and whether the player was on the right
      // side of it. Both only exist once an aftermath has been drawn for the
      // run, so older saved states just render without them.
      const shape = ev.aftermath ? KIND_LABEL[ev.aftermath.kind] : null;
      const tape = shape
        ? (ev.aftermath.fake ? `Printed the wrong way first, then ${shape}.` : `It ${shape}.`)
        : null;
      const notes = waveNotes(ev, state.portfolio ? state.portfolio.fills : [], nameById, scenario.durationSeconds);

      insights.appendChild(
        el("div", { class: "insight" }, [
          // The pair, in order: what you were given, then what it turned out to be.
          el("div", { class: "insight-head" }, [
            el("span", { class: "insight-sev sev-" + ev.severity }, SEV_LABEL[ev.severity] || ev.severity),
            el("span", { class: "insight-vision" }, ev.visionText),
          ]),
          ev.headlineText && ev.headlineText !== ev.visionText
            ? el("p", { class: "insight-headline" }, ev.headlineText)
            : null,
          impacts,
          tape ? el("p", { class: "insight-tape" }, tape) : null,
          ...notes.map((n) => el("p", { class: "insight-note" }, n)),
        ])
      );
    }

    node.appendChild(
      el("div", { class: "debrief-card" }, [
        el("div", { class: "debrief-kicker" }, `${cal.closeLabel()} · Market Closed`),
        el("h1", { class: "debrief-title" }, cal.reviewTitle()),
        el("p", { class: "debrief-summary" }, scenario.debrief.summary),
        tiles,
        el("div", { class: "debrief-cols" }, [
          el("div", { class: "debrief-col" }, [el("h2", {}, "What Actually Moved"), outcomeTable]),
          el("div", { class: "debrief-col" }, [el("h2", {}, "Why It Moved"), insights]),
        ]),
        el("div", { class: "debrief-actions" }, [
          // Straight back into the same scenario, on the same terms as any run:
          // from the top, at the resting pace.
          el(
            "button",
            {
              class: "btn btn-primary",
              onClick: () => store.start(scenario.id),
            },
            "Play this week again"
          ),
          el("button", { class: "btn btn-ghost", onClick: () => store.restart() }, "Back to menu"),
        ]),
        // Playing again deals fresh aftermaths — same story, different tape.
        // The seed is here for the case where you want the SAME one back.
        scenario.runSeed != null
          ? el("p", { class: "debrief-seed" }, `Run seed ${scenario.runSeed} · replay this exact tape with ?seed=${scenario.runSeed}`)
          : null,
      ])
    );
  }

  function update(state) {
    if (state.status === "finished" && state.score) render(state);
  }

  return { node, update };
}

function tile(label, value, cls = "", sub = "") {
  return el("div", { class: "debrief-tile" }, [
    el("div", { class: "tile-label" }, label),
    el("div", { class: "tile-value " + cls }, value),
    sub ? el("div", { class: "tile-sub" }, sub) : null,
  ]);
}

function th(t) { return el("th", {}, t); }

// Unsigned percentage — the "% on offer" figures have no direction.
function pctAbs(n, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return (Math.abs(n) * 100).toFixed(digits) + "%";
}

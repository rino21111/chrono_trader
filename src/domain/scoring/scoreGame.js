// Scoring (design doc section 8 "Scoring" and section 17).
//
// We compute:
//   - portfolio return vs starting capital (primary)
//   - per-company player P&L alongside what that name OFFERED: the right side
//     of every settled swing in THAT symbol, compounded. It answers "what was
//     on the table here vs what did I take" one thesis at a time. These figures
//     do not sum to anything meaningful — each assumes the whole book sat in
//     that one name all week, and the week has one book's worth of capital
//   - correct vs incorrect theses, derived from realized+open positions and the
//     scenario's actual end-of-week direction
//
// There is deliberately NO week-level "perfect %" benchmark. One lived here
// twice and broke both times. As the cross-company sum it was unattainable
// arithmetic (capital can't be in two names at once at MAX_LEVERAGE = 1). As
// the best feasible single-book path it at least described a real route, but it
// assumed perfect foreknowledge of the hidden event timeline — and as the
// post-event correction becomes tradeable it stops being an upper bound at all,
// so a good run could "capture" more than 100% of perfect. Folding the path
// into the bar is not the fix either: the plan is for aftermath shape to be
// drawn from a run seed, so a benchmark that counted it would differ between
// two runs of the same scenario and destroy replay comparison. The per-company
// figure survives precisely because it claims nothing about a ceiling.
//
// All company end prices use the noise-free fair price at progress = 1 (every
// event has landed by then) so the score doesn't depend on where the noise phase
// happens to land at the close.

import { buildContributions, fairPriceFromEvents } from "../market/pricingModel.js";

// What one company OFFERED over the week, as a fraction of the capital riding
// it: on the right side of every settled swing, flipping long/short as each
// piece of news lands and compounding the legs.
//
// We count the sequence of settled fair levels between events and nothing else
// — every eventShape() settles at exactly its impact, so this walk depends only
// on the authored timeline, never on the path taken between levels. That is
// what keeps it stable across replays as the gap and the correction around each
// landing become seeded per run (see pricingModel.js); a figure that counted
// them would move from run to run. So we walk events in time order, take the
// settled level after each one, and compound the absolute step returns. Events
// landing on the same tick move the price together and count as one step. A
// name that rises on one event and round-trips on a later one therefore offers
// BOTH legs, not the net open-to-close move.
function swingPctForCompany(contributions = []) {
  const byTime = [...contributions].sort((a, b) => (a.event.eventTime ?? 0) - (b.event.eventTime ?? 0));
  let offset = 0; // cumulative settled impact, as a fraction of the open
  let prev = 1; // settled price multiplier before the current step
  let offered = 1;
  let i = 0;
  while (i < byTime.length) {
    const t = byTime[i].event.eventTime ?? 0;
    while (i < byTime.length && (byTime[i].event.eventTime ?? 0) === t) {
      offset += byTime[i].impactPct;
      i += 1;
    }
    // Floor mirrors the market engine's guard against non-positive prices.
    const level = Math.max(0.01, 1 + offset);
    offered *= 1 + Math.abs(level - prev) / prev;
    prev = level;
  }
  return offered - 1;
}

export function scoreGame({ portfolio, companies, events = [], startingCash }) {
  const contributions = buildContributions(companies, events);
  const endPriceById = new Map();
  for (const c of companies) {
    endPriceById.set(c.companyId, fairPriceFromEvents(1, c.openingPrice, contributions.get(c.companyId)));
  }

  // Final marked-to-market equity using fair closing prices.
  let positionsValue = 0;
  for (const [companyId, p] of portfolio.positions) {
    if (p.shares === 0) continue;
    positionsValue += (endPriceById.get(companyId) ?? p.avgCost) * p.shares;
  }
  const finalEquity = portfolio.cash + positionsValue;
  const playerReturn = (finalEquity - startingCash) / startingCash;

  // Per company: what the name offered against what the player took.
  const companyPnl = [];
  for (const c of companies) {
    const end = endPriceById.get(c.companyId);
    const move = (end - c.openingPrice) / c.openingPrice;
    const offeredPct = swingPctForCompany(contributions.get(c.companyId));
    const p = portfolio.positions.get(c.companyId);
    const playerPnl = p ? p.realizedPnl + (end - p.avgCost) * p.shares : 0;
    companyPnl.push({ companyId: c.companyId, move, playerPnl, offeredPct });
  }

  // Thesis accounting: for every company the player ended up net long, was the
  // company an actual winner (fair close above open)? A held winner is a correct
  // thesis; a held loser is incorrect.
  let correctTheses = 0;
  let incorrectTheses = 0;
  const thesisDetail = [];
  for (const [companyId, p] of portfolio.positions) {
    const everTraded = portfolio.fills.some((f) => f.companyId === companyId);
    if (!everTraded) continue;
    const c = companies.find((x) => x.companyId === companyId);
    if (!c) continue;
    const moved = (endPriceById.get(companyId) - c.openingPrice) / c.openingPrice;
    // "Held into the close" is the clearest signal of a thesis. Positions that
    // were opened and fully closed are judged by realized P&L instead.
    let correct;
    if (p.shares > 0) correct = moved > 0.002; // held long into a riser
    else if (p.shares < 0) correct = moved < -0.002; // held short into a faller
    else correct = p.realizedPnl > 0; // opened and closed: judge by realized P&L
    if (correct) correctTheses += 1;
    else incorrectTheses += 1;
    thesisDetail.push({ companyId, moved, heldShares: p.shares, realizedPnl: p.realizedPnl, correct });
  }

  return {
    startingCash,
    finalEquity,
    playerReturn,
    companyPnl,
    correctTheses,
    incorrectTheses,
    thesisDetail,
  };
}

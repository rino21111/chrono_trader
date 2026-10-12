// Pricing model — event-driven (rework "event visions", supersedes the single
// target-per-company model).
//
// A company's price is the SUPERPOSITION of the events that land on it:
//
//   price_c(t) = openingPrice_c · (1 + Σ_e impactPct(e, c) · eventShape(t, e))
//                + noise_c(t)
//
// - Each event has an eventTime (when it hits the tape) and, per affected
//   company, a signed impact derived from the event's severity and the
//   company's magnitude/direction.
// - eventShape() is 0 before the event's time, then GAPS to its new level almost
//   instantly (see IMPULSE_SPAN) and rings out around it — localized at the event
//   rather than spanning the whole week. The instant gap is deliberate: the tape
//   reprices before the player can read the headline that lands on the same tick,
//   so being positioned beforehand off the hazy vision is the only edge.
//
// Everything here is a pure function of (progress, params). No Math.random, no
// clock reads — determinism lives at this layer (design doc section 16).

import { mulberry32, derivedSeed } from "../rng.js";
import { ARCHETYPES, DEFAULT_AFTERMATH } from "./aftermath.js";

// Normalized logistic convergence: rises from 0 at x=0 to 1 at x=1, with an
// S-curve controlled by midpoint and steepness, re-normalized so the endpoints
// are exact.
export function convergence(progress, midpoint = 0.45, steepness = 8) {
  const x = Math.max(0, Math.min(1, progress));
  const raw = 1 / (1 + Math.exp(-steepness * (x - midpoint)));
  const start = 1 / (1 + Math.exp(steepness * midpoint));
  const end = 1 / (1 + Math.exp(-steepness * (1 - midpoint)));
  return (raw - start) / (end - start);
}

// How big a move an event of each severity produces, as a fraction of price,
// before it's scaled by a company's per-event magnitude (0..1). A critical event
// with magnitude 1 moves a name ~30%; several events can stack on one company.
//
// These bands are deliberately ~2x what a real tape would do. A realistic week is
// a boring week: if catching a vision early only earns you 3%, there's no thrill
// in catching it. Oversized swings make being right feel like being right.
export const SEVERITY_AMP = { minor: 0.05, major: 0.14, critical: 0.3 };

const DIRECTION_SIGN = { positive: 1, negative: -1, neutral: 0 };

// The gap is near-instantaneous: an event reprices the tape inside this fraction
// of the week — about a third of a second at 1x (a 600s week), and proportionally
// less at 2x/4x — so the move is complete before a player can read the headline
// and click. Kept as a short ramp rather than a literal one-frame step so it
// reads as a fast gap on the chart instead of a glitch. A per-event `reactionSpan`
// can still override it (e.g. to author one genuinely slow-burning story).
const IMPULSE_SPAN = 0.0005;

// The shape of a single event's reaction AFTER the gap now lives in
// aftermath.js, drawn per RUN from a library of archetypes rather than fixed by
// the event's authored profile. See that file for why.
//
// What stays here is the part that must not change: the gap itself is universal
// (see IMPULSE_SPAN) and is the main thing standing between the player and a
// free lunch. The headline lands on the same tick, so by the time you have read
// it the price has already moved. Being positioned beforehand, off the hazy
// vision, is the only reliable edge.
//
// What follows is the SECOND wave — visible, tradeable, and deliberately not
// predictable. It runs in one of two directions: the gap may have priced in
// MORE than the news was worth, in which case price comes back to fair, or
// LESS, in which case price still has to travel. Judging which is a real skill;
// knowing in advance is not on the menu, and no fixed rule covers both.

// Past this fraction of its settleSpan an aftermath is eased to exactly zero.
//
// Without a hard taper the correction is an exponential that merely gets small,
// and an event landing late in the week is still ringing at the close: a
// `volatile` event at eventTime 0.90 under the old tuning returned ~1.23 at
// progress 1, delivering 23% more move than the author asked for. Scoring reads
// the fair price at progress 1, so that residue silently became part of the
// week's outcome. The taper makes settleSpan mean what it says — the correction
// is FULLY done after it — which is what lets eventShape(1) be exactly 1.
// Kept late deliberately: the taper is a guarantee, not a shaping tool. Easing
// from halfway through the span flattened the ring's far side enough to shrink
// the undershoot — the entry a player who missed the vision is supposed to get
// — so it starts at 0.7 and the archetype keeps its own character for most of
// its life.
const TAPER_START = 0.7;

function taper(u) {
  if (u <= TAPER_START) return 1;
  if (u >= 1) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * (u - TAPER_START)) / (1 - TAPER_START)));
}

// Signed impact of an event on one affected company, as a fraction of price.
export function eventImpactPct(event, affected) {
  const amp = SEVERITY_AMP[event.severity] ?? SEVERITY_AMP.major;
  const sign = DIRECTION_SIGN[affected.direction] ?? 0;
  return sign * (affected.magnitude ?? 0) * amp;
}

// The fraction of an event's impact reflected in the price at a given progress.
// Zero until eventTime, then:
//
//   0. HEAD FAKE (rare, see aftermath.js) — the tape first prints the WRONG way
//      for a few seconds, as if the desk misread the headline, before ripping
//      through to the true level. The only pattern that rewards trading just
//      after a print, and only if you already had conviction from the vision.
//   1. GAP — a near-instant jump to (1 + gap), where `gap` is SIGNED (see
//      aftermath.js). Positive lands past fair value, negative lands short of
//      it. Either way it completes faster than a player can react, so the
//      headline landing on the same tick confers no tradeable advantage.
//   2. AFTERMATH — one of eight archetypes drawn from the run seed, easing to
//      exactly 1 by the end of settleSpan. This is the second wave: which
//      direction it has to travel is the read, and taking it is the trade.
//
// Settles at exactly 1: the price change is permanent, only the path is chaotic.
// End-of-week fair prices are therefore unchanged by the wave — over-reaction
// and under-reaction land on precisely the same close.
export function eventShape(progress, event) {
  const p = Math.max(0, Math.min(1, progress));
  const start = event.eventTime ?? 0;
  if (p <= start) return 0;

  const a = event.aftermath || DEFAULT_AFTERMATH;
  const span = event.reactionSpan ?? IMPULSE_SPAN;
  const peak = 1 + a.gap;
  const elapsed = p - start;

  // Phase 0: the lie. Gap the wrong way at impulse speed, then hold it long
  // enough to be actionable — this is the one window where reading the tape
  // against the print pays.
  let from = 0;
  let gapAt = 0;
  if (a.fake) {
    if (elapsed < span) return -a.fake.depth * convergence(elapsed / span);
    if (elapsed < a.fake.span) return -a.fake.depth;
    from = -a.fake.depth;
    gapAt = a.fake.span;
  }

  // Phase 1: the gap, jumping to the gap level in a near-instant burst — from
  // zero normally, or from the fake level when the tape has to cover the
  // wrong-way print as well as the move.
  const g = elapsed - gapAt;
  if (g < span) {
    return from + (peak - from) * convergence(g / span);
  }

  // Phase 2: run the drawn archetype. At u=0 it is exactly `peak` (continuous
  // with the gap); by u=1 the taper has eased it to exactly fair value, where
  // it stays for the rest of the week. Whether that easing is a descent or a
  // climb is entirely the sign of `gap`.
  const u = (g - span) / a.settleSpan;
  if (u >= 1) return 1;
  const arch = ARCHETYPES[a.kind] || ARCHETYPES.fade;
  return 1 + a.gap * taper(u) * arch(u, a.params);
}

// Precompute, per company, the list of event impacts that touch it:
// companyId -> [{ event, impactPct }]. Shared by the market engine and scoring
// so both derive identical fair prices from the same events.
export function buildContributions(companies, events) {
  const map = new Map();
  for (const c of companies) map.set(c.companyId, []);
  for (const ev of events || []) {
    for (const aff of ev.affectedCompanies || []) {
      const list = map.get(aff.companyId);
      if (list) list.push({ event: ev, impactPct: eventImpactPct(ev, aff) });
    }
  }
  return map;
}

// Noise-free price for a company at a progress, from its event contributions.
export function fairPriceFromEvents(progress, openingPrice, contributions = []) {
  let multiplier = 1;
  for (const c of contributions) {
    multiplier += c.impactPct * eventShape(progress, c.event);
  }
  return openingPrice * multiplier;
}

// How agitated a company's tape is at a given progress, from the events landing
// on it: a Gaussian burst around each event time, weighted by how big that event's
// impact is. Zero for a company nothing is happening to.
//
// Quiet names stay quiet; a name in the middle of a critical event thrashes.
//
// Turbulence used to carry the whole burden of making the correction untimeable:
// at GAIN 14 the chop was loud enough to hide not just the exact turn but the
// WAVE ITSELF, which is what left the post-headline phase unplayable. Now that
// the aftermath shape is drawn from the run seed, the uncertainty lives in
// WHICH pattern you got — so the noise no longer has to obscure anything, and
// the gain comes down until the dislocation is legible through it. The chop
// still lands where it matters, right around the print, and the exact turn is
// still unpickable; it just no longer erases the arc it sits on.
const TURBULENCE_WIDTH = 0.05; // fraction of the week the agitation spans
const TURBULENCE_GAIN = 5; // how much a big event multiplies baseline noise

export function eventTurbulence(progress, contributions = []) {
  let t = 0;
  for (const c of contributions) {
    const d = progress - (c.event.eventTime ?? 0);
    if (d < 0) continue; // the tape is calm until the news actually breaks
    t += Math.abs(c.impactPct) * Math.exp(-Math.pow(d / TURBULENCE_WIDTH, 2));
  }
  return t;
}

// Build a deterministic noise function for one company. Noise is a small sum of
// seeded sinusoids (smooth "value noise"), scaled by volatility and the opening
// price, and faded in slightly so prices don't jitter at the very open. Because
// the phases/frequencies come from a seeded PRNG, the path is identical on every
// run for a given (seed, companyId).
//
// Passing the company's event contributions turns on turbulence: around each of
// its events the amplitude swells and a faster, choppier harmonic fades in on top
// of the baseline drift.
export function makeNoiseFn(seed, company, contributions = []) {
  const rand = mulberry32(derivedSeed(seed, company.companyId));
  const harmonics = 3;
  const terms = [];
  for (let i = 0; i < harmonics; i += 1) {
    terms.push({
      freq: 3 + Math.floor(rand() * 9) + i * 4, // cycles across the week
      phase: rand() * Math.PI * 2,
      weight: 1 / (i + 1),
    });
  }
  const norm = terms.reduce((s, t) => s + t.weight, 0);
  // Chop: high-frequency terms that only appear while the tape is agitated.
  const chop = [
    { freq: 60 + Math.floor(rand() * 40), phase: rand() * Math.PI * 2 },
    { freq: 110 + Math.floor(rand() * 60), phase: rand() * Math.PI * 2 },
  ];
  const volatility = company.volatility ?? 0;

  return function noiseAt(progress) {
    let v = 0;
    for (const t of terms) {
      v += t.weight * Math.sin(t.freq * Math.PI * 2 * progress + t.phase);
    }
    v /= norm; // now in [-1, 1]

    const turb = eventTurbulence(progress, contributions);
    if (turb > 0) {
      let c = 0;
      for (const t of chop) c += 0.5 * Math.sin(t.freq * Math.PI * 2 * progress + t.phase);
      v = v + c * Math.min(1, turb * TURBULENCE_GAIN * 0.25);
    }

    // Fade noise in over the first ~8% of the week so the open is clean, and
    // settle it to zero over the last ~2% so the close the player watches IS
    // the fair close the score marks at (scoring uses noise-free prices; the
    // final equity on screen and the debrief tile must agree).
    const fade = Math.min(1, progress / 0.08);
    const settle = Math.min(1, Math.max(0, (1 - progress) / 0.02));
    return v * volatility * company.openingPrice * fade * settle * (1 + TURBULENCE_GAIN * turb);
  };
}

// Aftermath archetypes — what the tape does AFTER an event's gap.
//
// The gap itself is universal and untradeable (see IMPULSE_SPAN in
// pricingModel.js). What follows it used to be one shape — a damped cosine
// whose parameters were a fixed function of the event's authored
// reactionProfile. That made the second wave learnable in about three runs:
// gap up, fade, buy the dip, done. A pattern you can name before it happens is
// not a trade, it is a lookup table.
//
// So the aftermath is drawn from a library instead, and drawn from the RUN
// seed rather than the scenario — the same event lands differently on a replay.
//
// TWO FAMILIES, and this is the load-bearing idea:
//
//   OVER-REACTION   the gap prices in MORE than the news is worth. Price ends
//                   up back down at fair. The play is to fade it.
//   UNDER-REACTION  the gap prices in only PART of the news. Price has to
//                   travel the rest of the way. The play is to trade WITH it.
//
// A library that only over-reacts still leaves one mechanical rule standing —
// "fade the print" — which is the free lunch this whole design exists to kill.
// With both families, the expected value of any fixed post-headline rule is
// about zero, and the edge moves to judging WHAT THE NEWS WAS WORTH.
//
// The families are indistinguishable at the gap BY CONSTRUCTION, because fair
// value is hidden: a gap to +7% is either an over-reaction to a +5% move or an
// under-reaction to a +14% one, and the tape looks identical either way. The
// player's only clue is the vision's hazy sense of magnitude — which is what
// ties the second wave back to the vision board instead of leaving it a
// standalone minigame.
//
// Within a family the same principle applies: archetypes SHARE OPENINGS and
// diverge late. fade and deadCat run the same first act; grind and lateSurge
// both gap and go quiet. The skill is "which of these is it, and how early dare
// I commit?" — not "which is it".
//
// Everything here is a pure function of (u, params). The only randomness is in
// resolveAftermaths(), which runs once per run against a seeded PRNG.

import { mulberry32, derivedSeed } from "../rng.js";

// Each archetype is a normalized curve over u — time since the gap, as a
// fraction of the event's settleSpan. Every one satisfies:
//
//   arch(0) === 1        continuity: the aftermath begins AT the gap level
//   arch(u) -> smallish  by u = 1, where the taper takes it the rest of the way
//
// The caller scales by the event's `gap` (signed) and adds 1, so a return of 1
// means "price is at the gap level" and 0 means "price is at fair value". What
// 1 LOOKS like depends on the family: above fair when gap is positive, short of
// fair when it is negative. Same curve, opposite trade.
export const ARCHETYPES = {
  // ---- over-reaction: the gap went too far, price comes back down ----

  // The one everybody expects: ring back through fair value, undershoot once,
  // settle. The zero crossing lands at u = 1/(4r), so ~a third of the way in.
  fade(u, p) {
    return Math.cos(2 * Math.PI * p.ring * u) * Math.exp(-p.decay * u);
  },

  // Retraces almost to fair value fast — looks exactly like fade finishing
  // early — then puts in a SECOND leg out before settling. Never crosses fair,
  // which is what separates it from fade once you can see enough of it.
  deadCat(u, p) {
    const first = Math.exp(-p.decay * u);
    // The second leg does not start until `bounceAt`, and that gap matters: if
    // the bump ramps in while the first retrace is still running it just fills
    // the dip in and the whole thing reads as a lazy fade. The trough has to be
    // a real moment where the tape looks finished.
    if (u <= p.bounceAt) return first;
    const w = (u - p.bounceAt) / (1 - p.bounceAt);
    return first + p.bounce * Math.sin(Math.PI * w) * Math.exp(-p.bounceDecay * w);
  },

  // No give-back: the tape keeps drifting the way it gapped, past the print,
  // before the long return. Runs over anyone who sold the overshoot early.
  //
  // Its twin in the other family is `drift`, and that pair is the sharpest
  // thing in the library: both read as "gap, then keeps going the same way".
  // This one is a premium the whole time and hands it all back; drift is a
  // discount that gets paid. You cannot tell them apart without a view on what
  // the news was worth.
  continuation(u, p) {
    return (1 + p.drift * Math.sin(Math.PI * Math.min(1, u / p.driftAt))) * Math.exp(-p.decay * u);
  },

  // Gaps slightly rich and then just sits, bleeding quietly back to fair.
  //
  // Load-bearing: if every landing paid out a wave, "wait for a headline, then
  // trade the wave" would be the new free lunch and we would have moved the
  // triviality rather than removed it. Some events must offer nothing, and you
  // must not be able to tell which until you have waited — see `lateSurge`,
  // which opens identically and is loading.
  grind(u, p) {
    return Math.exp(-p.decay * u);
  },

  // Same physics as fade at a much lower Q: several crossings, slow damp. The
  // exact turn is unpickable by construction — there are several and the last
  // one is small.
  chop(u, p) {
    return Math.cos(2 * Math.PI * p.ring * u) * Math.exp(-p.decay * u);
  },

  // ---- under-reaction: the gap fell short, price travels the rest ----

  // Gaps part of the way and grinds the remainder. Post-earnings-drift: buying
  // the print is simply correct here, and this is the shape that stops "always
  // fade the print" from being a rule. Monotone — no dip, no second chance, you
  // either took it or you watched it.
  drift(u, p) {
    return Math.pow(1 - Math.min(1, u), p.ease);
  },

  // Takes the news in discrete legs with a plateau between each, every leg the
  // same direction. Each plateau is long enough to read as the end of the move,
  // so the trade is holding through a pause that looks like a top.
  stairs(u, p) {
    const s = Math.min(1, u);
    const n = Math.max(2, Math.round(p.steps));
    const i = Math.floor(s * n);
    if (i >= n) return 0;
    const f = s * n - i;
    return 1 - (i + smootherstep((f - p.hold) / (1 - p.hold))) / n;
  },

  // Gaps small and sits — indistinguishable from `grind`, a name where nothing
  // is going to happen — and then moves late. Punishes "nothing here, I'll go
  // watch something else", which is exactly the decision a busy vision board is
  // pressuring you to make.
  lateSurge(u, p) {
    return 1 - smootherstep((u - p.wait) / (1 - p.wait));
  },
};

// Which family each archetype belongs to. `gap` is signed, so this is really a
// statement about the sign of its range — kept explicit because the selector
// picks a family FIRST and a shape second.
export const FAMILY = {
  fade: "over",
  deadCat: "over",
  continuation: "over",
  grind: "over",
  chop: "over",
  drift: "under",
  stairs: "under",
  lateSurge: "under",
};

function smootherstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// Per-archetype sampling ranges.
//
// `gap` is where the gap lands relative to fair, as a signed fraction of the
// move: +0.65 lands 65% ABOVE fair (over-reaction), -0.5 lands 50% SHORT of it
// (under-reaction). It was called `overshoot` while only one family existed.
//
// `settleSpan` is a fraction of the WEEK, which is the number that decides
// whether a human can trade this: a 600s week at 1x makes 0.20 ≈ 120 seconds,
// and half that at 2x. The pre-library tuning ran 0.07–0.16 (≈40–95s at 1x)
// which is a spasm, not an arc.
export const RANGES = {
  fade: { gap: [0.45, 0.85], settleSpan: [0.14, 0.22], decay: [1.2, 2.2], ring: [0.55, 0.8] },
  deadCat: { gap: [0.5, 0.9], settleSpan: [0.18, 0.28], decay: [5, 8], bounce: [0.45, 0.7], bounceAt: [0.3, 0.42], bounceDecay: [0.5, 1.2] },
  continuation: { gap: [0.25, 0.5], settleSpan: [0.2, 0.3], decay: [0.5, 0.9], drift: [0.8, 1.4], driftAt: [1.2, 1.8] },
  grind: { gap: [0.1, 0.3], settleSpan: [0.1, 0.18], decay: [1.5, 2.5] },
  chop: { gap: [0.5, 0.9], settleSpan: [0.22, 0.34], decay: [0.8, 1.4], ring: [2.2, 3.4] },
  // Under-reaction gaps are sized to MATCH the over-reaction family in
  // magnitude, not just in frequency. An even family split still leaves blind
  // fading profitable if the moves it fades are bigger than the moves it misses
  // — these ranges were widened from (-0.6..-0.4, -0.7..-0.45, -0.55..-0.3)
  // once measurement showed over gaps averaging 0.563 against under 0.499.
  drift: { gap: [-0.65, -0.45], settleSpan: [0.18, 0.28], ease: [1.2, 2] },
  stairs: { gap: [-0.75, -0.5], settleSpan: [0.2, 0.3], steps: [2, 3], hold: [0.45, 0.6] },
  lateSurge: { gap: [-0.6, -0.35], settleSpan: [0.22, 0.32], wait: [0.5, 0.68] },
};

// Params that must be whole numbers rather than uniform samples.
const INTEGER_PARAMS = new Set(["steps"]);

// --- family selection ---------------------------------------------------
//
// How likely an event is to OVER-react, before the severity tilt. The authored
// profile is the strongest signal we have about the desk's mood — `overreaction`
// means what it says — but it is a lean, never a lock.
// Calibrated so that TYPICAL AUTHORED CONTENT comes out near even, which is not
// the same as making the table look even. Scenarios skew dramatic — the shipped
// weeks run roughly 6 critical / 6 major / 1 minor — so anchoring the severity
// tilt's zero at `major` gave the average real event a positive push: measured
// end to end, p(over) was 0.59 and the mean signed gap +0.13, meaning "fade the
// print" still paid ~13% of every event's impact for nothing. These numbers are
// the corrected ones; the check that matters is mean signed gap ≈ 0 on real
// content, not the prettiness of the constants.
const BASE_OVER = {
  overreaction: 0.69,
  volatile: 0.55,
  immediate: 0.49,
  gradual: 0.35,
  delayed: 0.29,
};

// Loud, salient news over-reacts; technical news gets absorbed slowly. This is
// how real tape behaves, and it hands the player a learnable-but-unreliable
// heuristic: read the vision's TONE, not just its direction.
//
// A minor-heavy week will genuinely lean under-reaction, which is fine and worth
// having — the calibration target is the content that actually gets written.
const SEVERITY_TILT = { critical: 0.08, major: 0, minor: -0.1 };

// Neither end is ever certain. Without this clamp a `critical` + `overreaction`
// event would be a near-guaranteed fade, and the tell becomes mechanically
// tradeable — which is the free lunch coming back in through the side door.
const P_OVER_MIN = 0.15;
const P_OVER_MAX = 0.85;

// Kind weights, given the family. Author intent survives as flavor within
// whichever family the coin landed on.
const KIND_WEIGHTS = {
  over: {
    immediate: { fade: 4, chop: 2, continuation: 2, deadCat: 2, grind: 1 },
    gradual: { fade: 3, grind: 3, continuation: 2, deadCat: 1, chop: 1 },
    delayed: { fade: 3, deadCat: 3, grind: 2, continuation: 1, chop: 1 },
    overreaction: { fade: 4, deadCat: 3, chop: 2, continuation: 1, grind: 0.5 },
    volatile: { chop: 4, continuation: 3, fade: 2, deadCat: 2, grind: 0.5 },
  },
  under: {
    immediate: { drift: 3, stairs: 2, lateSurge: 1 },
    gradual: { drift: 4, lateSurge: 2, stairs: 1 },
    delayed: { lateSurge: 4, stairs: 2, drift: 2 },
    overreaction: { drift: 2, stairs: 2, lateSurge: 1 },
    volatile: { stairs: 3, drift: 2, lateSurge: 2 },
  },
};

// The head fake is a MODIFIER, not a ninth archetype: the gap first prints the
// WRONG WAY for a beat before repricing to the true level, and then any
// aftermath from EITHER family can follow. Keeping it orthogonal multiplies the
// space (a head fake into a drift is its own animal) without another curve.
//
// It is the one pattern that pays you for trading just after a print, so it is
// deliberately rare — it only helps if you already had conviction from the
// vision and are willing to buy while the tape says you are wrong.
const FAKE_CHANCE = { immediate: 0.1, gradual: 0.05, delayed: 0.08, overreaction: 0.12, volatile: 0.15 };
const FAKE_DEPTH = [0.25, 0.55]; // fraction of the move, printed the wrong way
const FAKE_SPAN = [0.01, 0.022]; // fraction of the week the lie holds (≈6–13s at 1x)

// Kinds drawn in the last RECENCY_WINDOW events get their weight cut. Without
// this, independent per-event draws hand you three fades in a row often enough
// to feel like the old fixed shape — variety WITHIN a week is most of what
// makes a week feel unroutine, more than the archetype count is.
//
// Graded by distance, not flat: the immediately previous draw is cut hardest.
// A flat penalty was enough when there were five shapes to spread across, but
// the under-reaction family has only three and its weights are top-heavy, so
// back-to-back repeats clustered — four `drift`s in a row on a `gradual` week.
//
// Note this damps the SHAPE, never the FAMILY: see drawAftermath.
const RECENCY_WINDOW = 2;
const RECENCY_PENALTIES = [0.2, 0.45]; // index 0 = the draw immediately before

// Room reserved for the gap itself when deciding how long an aftermath may run,
// so the correction still finishes inside the week. Comfortably larger than
// IMPULSE_SPAN in pricingModel.js; it only has to be an upper bound, and being
// generous costs a late event a few tenths of a second of ring.
const GAP_ROOM = 0.001;

// The shortest aftermath worth having. Below this the wave is over in a few
// frames and reads as part of the gap rather than as a second wave, so an event
// with less than this much week left simply doesn't get one.
const MIN_SPAN = 0.01;

function sample(rand, range) {
  return range[0] + rand() * (range[1] - range[0]);
}

function weightedPick(rand, weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let roll = rand() * total;
  for (const k in weights) {
    roll -= weights[k];
    if (roll <= 0) return k;
  }
  return Object.keys(weights)[0];
}

// The probability this event over-reacts. Exported so tests and any future
// tuning tool can read the curve without re-deriving it.
export function pOverreact(profile, severity) {
  const base = BASE_OVER[profile] ?? BASE_OVER.gradual;
  const tilt = SEVERITY_TILT[severity] ?? 0;
  return Math.max(P_OVER_MIN, Math.min(P_OVER_MAX, base + tilt));
}

// Draw one event's aftermath. `settleCap` is how much of the week is left after
// the event lands — the span is clamped to it so the taper always reaches zero
// by progress 1 and the event delivers EXACTLY its authored impact at the close.
export function drawAftermath(rand, profile, severity, recent = [], settleCap = 1) {
  // 1. Family, as an independent coin flip.
  //
  // Deliberately NOT balanced across the run: no quota, no bag, no correction
  // for what came before. A ten-vision week can come out 7/3, 5/5 or 9/1, and
  // that variance is content — any run-level balancing would let a player count
  // cards and know what the last few events must be.
  const family = rand() < pOverreact(profile, severity) ? "over" : "under";

  // 2. Shape within the family. The recency penalty applies here and only here:
  // damping the family too would quietly reintroduce the balancing that step 1
  // exists to avoid.
  const table = KIND_WEIGHTS[family];
  const base = table[profile] || table.gradual;
  const weights = {};
  for (const k in base) {
    const back = recent.length - 1 - recent.lastIndexOf(k); // 0 = the last draw
    weights[k] = recent.includes(k) ? base[k] * (RECENCY_PENALTIES[back] ?? 1) : base[k];
  }
  const kind = weightedPick(rand, weights);
  const r = RANGES[kind];

  // 3. Params.
  const params = {};
  for (const key in r) {
    if (key === "gap" || key === "settleSpan") continue;
    const v = sample(rand, r[key]);
    params[key] = INTEGER_PARAMS.has(key) ? Math.round(v) : v;
  }

  // 4. Head fake. Rolled BEFORE the span, because a fake eats into the week the
  // aftermath has left to resolve in. Sampled unconditionally (not inside the
  // `if`) so whether a fake lands doesn't shift the stream for every event
  // after it — the draw sequence stays stable as the odds are tuned.
  const fakeRoll = rand();
  const fakeDepth = sample(rand, FAKE_DEPTH);
  const fakeSpan = sample(rand, FAKE_SPAN);
  const fake = fakeRoll < (FAKE_CHANCE[profile] ?? 0.08) && fakeSpan + GAP_ROOM < settleCap
    ? { depth: fakeDepth, span: fakeSpan }
    : null;

  // 5. Span, clamped to the week that's left.
  //
  // An event that lands at the bell has no week to correct in. Rather than
  // leave a fraction of an aftermath unresolved at the close — which would put
  // a residue into the fair price that scoring reads as real — it simply gaps
  // to fair value and holds. Nothing to trade, but nothing owed either.
  //
  // The floor is a real minimum span, not an epsilon: anything under MIN_SPAN
  // is a few frames of ring that reads as part of the gap anyway. (It also
  // dodges a float trap — `1 - 0.999` is a hair ABOVE 0.001, so a `> 0` test
  // here happily produced a settleSpan of 8.7e-19.)
  const room = settleCap - (fake ? fake.span : 0) - GAP_ROOM;
  if (room < MIN_SPAN) return { kind: "grind", gap: 0, settleSpan: MIN_SPAN, params: { decay: 3 } };

  const aftermath = {
    kind,
    gap: sample(rand, r.gap),
    settleSpan: Math.min(sample(rand, r.settleSpan), room),
    params,
  };
  if (fake) aftermath.fake = fake;

  return aftermath;
}

// Resolve every event's aftermath for one run, in place on fresh copies.
//
// Events are walked in a stable (eventTime, id) order against a single seeded
// stream, which is what lets the recency penalty see what came before. Adding
// or removing an event in the content therefore reshuffles the draws for the
// rest of that week — fine, since content edits aren't expected to preserve a
// given run's identity, and the run seed is what reproduces a week.
//
// The stream is NAMESPACED off the run seed rather than being the run seed
// itself. Noise has always been namespaced (derivedSeed(runSeed, companyId));
// aftermath was not, so any other knob drawing from the raw stream — or, worse,
// drawing BEFORE this runs — silently reshuffled every archetype in the week.
// The resolver upstream (resolveRun) draws three streams of its own, and this
// is what keeps them from colliding with the eight archetypes down here.
export function resolveAftermaths(events = [], runSeed = 0) {
  const rand = mulberry32(derivedSeed(runSeed, "aftermath"));
  const order = [...events].sort(
    (a, b) => (a.eventTime ?? 0) - (b.eventTime ?? 0) || (a.id < b.id ? -1 : 1)
  );
  const byId = new Map();
  const recent = [];
  for (const ev of order) {
    const t = ev.eventTime ?? 0;
    const aftermath = drawAftermath(
      rand,
      ev.reactionProfile || "gradual",
      ev.severity || "major",
      recent,
      1 - t
    );
    byId.set(ev.id, aftermath);
    recent.push(aftermath.kind);
    if (recent.length > RECENCY_WINDOW) recent.shift();
  }
  // Preserve the caller's array order; only the draw order is normalized.
  return events.map((ev) => ({ ...ev, aftermath: byId.get(ev.id) }));
}

// Fallback for events that never went through the resolver — scenario
// validation, tests constructing events by hand, and any content path that
// builds an event without a run. A plain mid-band fade: it must never be the
// interesting case, only a safe one.
export const DEFAULT_AFTERMATH = {
  kind: "fade",
  gap: 0.6,
  settleSpan: 0.18,
  params: { decay: 1.7, ring: 0.68 },
};

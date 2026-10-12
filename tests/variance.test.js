// The variance suite (docs/VARIANCE_IMPLEMENTATION.md §4).
//
// Two halves, because the knobs are of two kinds:
//
//   STRUCTURE is discrete and small — two slots is four possible weeks — so it
//   is checked EXHAUSTIVELY. Every path a scenario can produce is run through
//   the full existing balance suite. That proves the concurrency envelope, the
//   finale window, the FIFO ceiling and the move bounds hold on every week that
//   can actually happen, which is a firmer guarantee than fuzzing gives.
//
//   INCIDENCE AND MAGNITUDE are continuous, so they get SAMPLED — several
//   hundred draws, asserting on the worst one rather than the mean. A rule that
//   holds on average is a rule that breaks on the run somebody is playing.
//
// The last check in here is the one the whole project exists for: that the
// draws are not near-identical. Everything else in this file guards against
// variance breaking the week; that one guards against there being none.

import { describe, it, expect } from "./harness.js";
import { validateScenario } from "../src/domain/scenario/schema.js";
import {
  resolveRun,
  resolvePath,
  enumeratePaths,
  assembleDebrief,
  segmentsForPath,
} from "../src/domain/scenario/resolveRun.js";
import { eventImpactPct } from "../src/domain/market/pricingModel.js";
import { resolveAftermaths, drawAftermath } from "../src/domain/market/aftermath.js";
import { mulberry32, derivedSeed } from "../src/domain/rng.js";

const SCENARIO_IDS = ["week-001", "fire-nation", "mormons-go-nuclear", "mr-frog-president"];

// How many draws the continuous knobs get. Big enough that a 40%-incidence
// ripple missing every time is not a plausible accident, small enough that the
// suite still runs in a blink.
const DRAWS = 500;

function contentUrl(path) {
  return new URL(`../content/${path}`, import.meta.url).href;
}

async function fetchHalves(id) {
  const [pub, priv] = await Promise.all([
    fetch(contentUrl(`scenarios/${id}/${id}.public.json`)).then((r) => r.json()),
    fetch(contentUrl(`scenarios/${id}/${id}.private.json`)).then((r) => r.json()),
  ]);
  return [pub, priv];
}

// End-of-week move per company, as a fraction of the open.
//
// Every aftermath archetype settles at exactly its authored impact by the close
// (that is the invariant the whole library rests on), so the settled level is
// just the superposition of the impacts — no need to run the shapes.
function endMoves(pub, events) {
  const moves = new Map(pub.companies.map((c) => [c.companyId, 0]));
  for (const ev of events) {
    for (const a of ev.affectedCompanies || []) {
      if (!moves.has(a.companyId)) continue;
      moves.set(a.companyId, moves.get(a.companyId) + eventImpactPct(ev, a));
    }
  }
  return moves;
}

// A decoy is a company NOTHING landed on, which is not the same thing as a
// company whose net move is zero. The validator's balance pass measures the
// close and cannot tell them apart; the draw can. A designed wash — helped and
// hurt by equal and opposite impacts — stops netting to exactly zero the moment
// each side draws its own multiplier, so counting closes here would report the
// week's fair trap as a decoy that the draw then "ate". Count the impacts.
function decoyCount(pub, events) {
  const touched = new Set();
  for (const ev of events) {
    for (const a of ev.affectedCompanies || []) touched.add(a.companyId);
  }
  return pub.companies.filter((c) => !touched.has(c.companyId)).length;
}

function countMoves(moves) {
  let meaningful = 0;
  let biggest = 0;
  for (const m of moves.values()) {
    const abs = Math.abs(m);
    if (abs >= 0.03) meaningful += 1;
    if (abs > biggest) biggest = abs;
  }
  return { meaningful, biggest };
}

// ---------------------------------------------------------------------------
// Phase 0: the seed hierarchy
// ---------------------------------------------------------------------------

describe("seed discipline", () => {
  const events = [
    { id: "a", eventTime: 0.2, severity: "major", reactionProfile: "gradual", affectedCompanies: [] },
    { id: "b", eventTime: 0.6, severity: "critical", reactionProfile: "immediate", affectedCompanies: [] },
  ];

  it("draws aftermaths from a namespaced stream, not the raw run seed", () => {
    // Noise has always been namespaced and aftermath was not, which meant any
    // new knob drawing from the raw stream — or running before it — silently
    // reshuffled every archetype in the week. Pinning the namespace here is what
    // makes that regression loud instead of invisible.
    const seed = 4242;
    const rand = mulberry32(derivedSeed(seed, "aftermath"));
    const expected = drawAftermath(rand, "gradual", "major", [], 1 - 0.2);
    const [first] = resolveAftermaths(events, seed);
    expect(first.aftermath.kind).toBe(expected.kind);
    expect(first.aftermath.gap).toBeCloseTo(expected.gap, 10);
  });

  it("reproduces a run exactly from its seed", async () => {
    const [, priv] = await fetchHalves("week-001");
    const a = resolveRun(priv, 90210);
    const b = resolveRun(priv, 90210);
    expect(a.path.segments.join()).toBe(b.path.segments.join());
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.debriefSummary).toBe(b.debriefSummary);
  });

  it("moves one knob without moving the others", async () => {
    const [, priv] = await fetchHalves("week-001");
    // Same run seed, band widened. The segments drawn must not budge: the
    // "segments" stream is derived independently of "magnitude", so tuning the
    // band cannot silently re-cut the week.
    const wide = { ...priv, variance: { magnitudeBand: [0.9, 1.0] } };
    for (const seed of [1, 7, 12345, 0xbeef]) {
      expect(resolveRun(wide, seed).path.segments.join()).toBe(resolveRun(priv, seed).path.segments.join());
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 2: content with none of the new fields resolves exactly as it did
// ---------------------------------------------------------------------------

describe("resolveRun on plain content", () => {
  it("is the identity on a scenario with no slots, no incidence and no band", async () => {
    const [, priv] = await fetchHalves("fire-nation");
    const plain = { ...priv, variance: undefined };
    for (const seed of [0, 1, 999999]) {
      const run = resolveRun(plain, seed);
      expect(JSON.stringify(run.events)).toBe(JSON.stringify(plain.marketEvents));
      expect(run.path.segments.length).toBe(0);
      expect(run.path.dominant).toBe(null);
      expect(run.debriefSummary).toBe(priv.debrief.summary);
    }
  });

  it("keeps the vision text out of the draw entirely", async () => {
    // The player's contract: a beat's visionText may never depend on the run.
    const [, priv] = await fetchHalves("week-001");
    const authored = new Map(priv.marketEvents.map((ev) => [ev.id, ev.visionText]));
    for (let i = 0; i < 50; i += 1) {
      for (const ev of resolveRun(priv, i * 7919).events) {
        expect(ev.visionText).toBe(authored.get(ev.id));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3: exhaustive path enumeration
// ---------------------------------------------------------------------------

for (const id of SCENARIO_IDS) {
  describe(`${id} — every possible week`, () => {
    it("validates on every path, not just on the merged content", async () => {
      const [pub, priv] = await fetchHalves(id);
      const paths = enumeratePaths(priv);
      expect(paths.length).toBeGreaterThanOrEqual(1);
      for (const path of paths) {
        const { events } = resolvePath(priv, path);
        // The vocabulary comes off with the conditions: this private half is one
        // concrete week now, so it goes through the validator exactly the way a
        // segment-free scenario does.
        const result = validateScenario(pub, { ...priv, slots: undefined, threads: undefined, marketEvents: events });
        if (!result.ok) throw new Error(`path [${path.join(" + ")}] fails: ${result.errors.join("; ")}`);
      }
    });

    it("gives every path the same event count and the same finale", async () => {
      // Siblings fill the same window, so swapping them can never leave a hole.
      // Equal counts and an unmoved finale are the cheap observable of that.
      const [, priv] = await fetchHalves(id);
      const counts = new Set();
      const finales = new Set();
      for (const path of enumeratePaths(priv)) {
        const { events } = resolvePath(priv, path);
        counts.add(events.length);
        finales.add(Math.max(...events.map((ev) => ev.eventTime)));
      }
      expect(counts.size).toBe(1);
      expect(finales.size).toBe(1);
    });

    it("ships content the validator is happy with as authored", async () => {
      const [pub, priv] = await fetchHalves(id);
      const result = validateScenario(pub, priv);
      if (!result.ok) throw new Error("validation errors: " + result.errors.join("; "));
      expect(result.ok).toBeTruthy();
    });
  });
}

describe("week-001 segments", () => {
  it("carves two slots the resolver can actually reach both ways", async () => {
    const [, priv] = await fetchHalves("week-001");
    expect(enumeratePaths(priv).length).toBe(4);
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) seen.add(resolveRun(priv, i * 104729).path.segments.join(" + "));
    // Every authored week must be reachable, or a segment is dead prose.
    expect(seen.size).toBe(4);
  });

  it("lets both threads come out on top across the paths", async () => {
    const [, priv] = await fetchHalves("week-001");
    const dominants = new Set(enumeratePaths(priv).map((p) => resolvePath(priv, p).dominant));
    for (const t of priv.threads) expect(dominants.has(t)).toBeTruthy();
  });

  it("fires a thread-conditional impact only in the week that earned it", async () => {
    // The finale is one event whose CONSEQUENCES depend on the week you had —
    // Model A, implemented by reusing the incidence machinery rather than by
    // building a finale-variant system. So the same fab going dark pays the
    // interconnect maker in a silicon week and the air freighter in a logistics
    // one, and never both.
    const [, priv] = await fetchHalves("week-001");
    const finale = priv.marketEvents.find((ev) => ev.id === "ev-foundry-strike");
    const conditional = finale.affectedCompanies.filter((a) => a.thread);
    expect(conditional.length).toBeGreaterThan(1);

    for (const path of enumeratePaths(priv)) {
      const { events, dominant } = resolvePath(priv, path);
      const landed = new Set(events.find((ev) => ev.id === "ev-foundry-strike").affectedCompanies.map((a) => a.companyId));
      for (const a of conditional) {
        expect(landed.has(a.companyId)).toBe(a.thread === dominant);
      }
      // And the condition itself is spent — a resolved week is unconditional.
      for (const ev of events) {
        for (const a of ev.affectedCompanies) expect(a.thread).toBe(undefined);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §4c: sampled checks for the continuous knobs
// ---------------------------------------------------------------------------

for (const id of SCENARIO_IDS) {
  describe(`${id} — ${DRAWS} draws`, () => {
    async function sample() {
      const [pub, priv] = await fetchHalves(id);
      // The floor the draw must never go under: the worst any AUTHORED week
      // does. Incidence only ever removes impacts, so the decoy count can only
      // rise from here — what this catches is a draw eating one instead.
      let authoredDecoys = Infinity;
      for (const path of enumeratePaths(priv)) {
        authoredDecoys = Math.min(authoredDecoys, decoyCount(pub, resolvePath(priv, path).events));
      }

      const worst = { meaningful: Infinity, decoys: Infinity, biggest: 0 };
      const spread = new Map(pub.companies.map((c) => [c.companyId, { lo: Infinity, hi: -Infinity }]));
      for (let i = 0; i < DRAWS; i += 1) {
        const events = resolveRun(priv, i * 2654435761).events;
        const moves = endMoves(pub, events);
        const counts = countMoves(moves);
        worst.meaningful = Math.min(worst.meaningful, counts.meaningful);
        worst.decoys = Math.min(worst.decoys, decoyCount(pub, events));
        worst.biggest = Math.max(worst.biggest, counts.biggest);
        for (const [cid, m] of moves) {
          const s = spread.get(cid);
          s.lo = Math.min(s.lo, m);
          s.hi = Math.max(s.hi, m);
        }
      }
      return { worst, spread, authoredDecoys };
    }

    it("keeps at least three meaningful movers on every draw", async () => {
      const { worst } = await sample();
      expect(worst.meaningful).toBeGreaterThanOrEqual(3);
    });

    it("never eats a decoy", async () => {
      // Incidence can only ever REMOVE an impact, so the decoy count can only
      // rise off the authored week. The failure this catches is the opposite
      // direction: a draw that quietly puts a name back on the board and leaves
      // the hedger's plausible-but-unaffected candidate with nowhere to be wrong.
      const { worst, authoredDecoys } = await sample();
      expect(worst.decoys).toBeGreaterThanOrEqual(authoredDecoys);
    });

    it("stays inside the 35% move bound on every draw", async () => {
      const { worst } = await sample();
      expect(worst.biggest).toBeLessThanOrEqual(0.35);
    });

    // THE VARIANCE FLOOR. Everything above this asserts the draw does no harm;
    // this one asserts it does something. A scenario that passes every other
    // check by drawing the same week every time has failed the only test that
    // the whole segment model exists to satisfy.
    it("draws weeks that are actually different", async () => {
      const { spread } = await sample();
      const spreads = [...spread.values()].map((s) => s.hi - s.lo).sort((a, b) => b - a);
      expect(spreads.filter((s) => s >= 0.03).length).toBeGreaterThanOrEqual(3);
    });
  });
}

describe("the knobs themselves", () => {
  it("never drops a direct impact, however the ripples fall", async () => {
    // The one hard rule under incidence: if the company a vision points AT could
    // be left untouched by the draw, the vision was a lie.
    const [, priv] = await fetchHalves("week-001");
    const directs = new Map();
    for (const ev of priv.marketEvents) {
      const ids = (ev.affectedCompanies || []).filter((a) => a.causalRole === "direct").map((a) => a.companyId);
      if (ids.length) directs.set(ev.id, ids);
    }
    expect(directs.size).toBeGreaterThan(0);
    for (let i = 0; i < 200; i += 1) {
      for (const ev of resolveRun(priv, i * 15485863).events) {
        for (const cid of directs.get(ev.id) || []) {
          expect(ev.affectedCompanies.some((a) => a.companyId === cid)).toBeTruthy();
        }
      }
    }
  });

  it("fires a contingent ripple about as often as its incidence says", async () => {
    const [, priv] = await fetchHalves("week-001");
    // helix-compute on the opening capex beat: a spine event, so it is in every
    // run, with an authored incidence of 0.6.
    const target = priv.marketEvents.find((ev) => ev.id === "ev-atlas-capex");
    const authored = target.affectedCompanies.find((a) => a.companyId === "helix-compute");
    expect(authored.incidence).toBe(0.6);
    let hits = 0;
    for (let i = 0; i < DRAWS; i += 1) {
      const ev = resolveRun(priv, i * 40503).events.find((e) => e.id === "ev-atlas-capex");
      if (ev.affectedCompanies.some((a) => a.companyId === "helix-compute")) hits += 1;
    }
    expect(Math.abs(hits / DRAWS - 0.6)).toBeLessThan(0.08);
  });

  it("scales magnitude inside the band and never past the authored ceiling", async () => {
    const [, priv] = await fetchHalves("week-001");
    const [lo, hi] = priv.variance.magnitudeBand;
    const authored = new Map();
    for (const ev of priv.marketEvents) {
      for (const a of ev.affectedCompanies || []) authored.set(`${ev.id}:${a.companyId}`, a.magnitude);
    }
    let sawLow = false;
    let sawHigh = false;
    for (let i = 0; i < 200; i += 1) {
      for (const ev of resolveRun(priv, i * 32452843).events) {
        for (const a of ev.affectedCompanies) {
          const base = authored.get(`${ev.id}:${a.companyId}`);
          const scale = base ? a.magnitude / base : 1;
          expect(scale).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(scale).toBeLessThanOrEqual(hi + 1e-9);
          if (scale < lo + 0.1) sawLow = true;
          if (scale > hi - 0.1) sawHigh = true;
        }
      }
    }
    // A band nothing ever reaches the ends of is a band that isn't doing
    // anything — the dud and the amplified run both have to actually happen.
    expect(sawLow).toBeTruthy();
    expect(sawHigh).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Debrief assembly
// ---------------------------------------------------------------------------

describe("debrief assembly", () => {
  it("reads opening, the week that happened, then closing", async () => {
    const [, priv] = await fetchHalves("week-001");
    for (const path of enumeratePaths(priv)) {
      const segments = segmentsForPath(priv, path);
      const text = assembleDebrief(priv, segments);
      expect(text.startsWith(priv.debrief.opening)).toBeTruthy();
      expect(text.endsWith(priv.debrief.closing)).toBeTruthy();
      // Only the segments that fired, and in landing order.
      const positions = segments.map((s) => text.indexOf(s.debriefPara));
      for (const p of positions) expect(p).toBeGreaterThan(-1);
      const sorted = [...positions].sort((a, b) => a - b);
      expect(positions.join()).toBe(sorted.join());
      for (const slot of priv.slots) {
        for (const seg of slot.segments) {
          if (!segments.includes(seg)) expect(text.includes(seg.debriefPara)).toBeFalsy();
        }
      }
    }
  });

  it("still honours a legacy single summary", async () => {
    const [, priv] = await fetchHalves("mormons-go-nuclear");
    expect(resolveRun(priv, 123).debriefSummary).toBe(priv.debrief.summary);
  });
});

import { describe, it, expect } from "./harness.js";
import {
  convergence,
  eventShape,
  eventImpactPct,
  buildContributions,
  fairPriceFromEvents,
  makeNoiseFn,
  eventTurbulence,
  SEVERITY_AMP,
} from "../src/domain/market/pricingModel.js";
import { ARCHETYPES, FAMILY, RANGES, drawAftermath, resolveAftermaths, pOverreact } from "../src/domain/market/aftermath.js";
import { mulberry32 } from "../src/domain/rng.js";

// A mid-band draw of one archetype: every sampled parameter at the centre of
// its range. Lets a test name the shape it wants to assert on without going
// hunting through seeds for one.
function withKind(kind) {
  const r = RANGES[kind];
  const mid = (x) => (x[0] + x[1]) / 2;
  const params = {};
  for (const key in r) {
    if (key === "gap" || key === "settleSpan") continue;
    params[key] = key === "steps" ? Math.round(mid(r[key])) : mid(r[key]);
  }
  return { kind, gap: mid(r.gap), settleSpan: mid(r.settleSpan), params };
}

const OVER_KINDS = Object.keys(FAMILY).filter((k) => FAMILY[k] === "over");
const UNDER_KINDS = Object.keys(FAMILY).filter((k) => FAMILY[k] === "under");
const PROFILES = ["immediate", "gradual", "delayed", "overreaction", "volatile"];
const SEVERITIES = ["minor", "major", "critical"];

describe("convergence", () => {
  it("is 0 at start and 1 at end", () => {
    expect(convergence(0)).toBeCloseTo(0, 6);
    expect(convergence(1)).toBeCloseTo(1, 6);
  });

  it("is monotonically increasing", () => {
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = convergence(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("clamps out-of-range progress", () => {
    expect(convergence(-1)).toBeCloseTo(0, 6);
    expect(convergence(2)).toBeCloseTo(1, 6);
  });
});

describe("eventShape (localized reaction)", () => {
  const immediate = { eventTime: 0.3, reactionProfile: "immediate" };

  it("is zero before and at the event time", () => {
    expect(eventShape(0.2, immediate)).toBe(0);
    expect(eventShape(0.3, immediate)).toBe(0);
  });

  it("gaps straight through fair value almost instantly", () => {
    // The gap completes inside IMPULSE_SPAN (~0.0005 of the week), so a hair after
    // the event the price has already blown past fair value toward the overshoot
    // peak (~1.55). You cannot read the headline and beat the move: under the old
    // slow impulse eventShape(0.301) was ~0.05 (barely started); now it is ~1.5.
    expect(eventShape(0.301, immediate)).toBeGreaterThan(1.4);
  });

  it("corrects back through fair value before settling", () => {
    // Somewhere in the ring-out the cosine flips and price undershoots the truth.
    let sawUndershoot = false;
    for (let p = 0.312; p < 0.45; p += 0.002) {
      if (eventShape(p, immediate) < 0.995) sawUndershoot = true;
    }
    expect(sawUndershoot).toBeTruthy();
  });

  it("settles to exactly 1 once the ringing damps out", () => {
    expect(eventShape(0.9, immediate)).toBeCloseTo(1, 3); // permanent, path-independent
  });

  it("completes the gap instantly whatever aftermath was drawn", () => {
    // The impulse is universal: one tick after the event, every archetype has
    // already finished repricing to its gap level. They differ only in what
    // happens AFTER, never in how fast they get there — which is the invariant
    // that keeps reaction-trading the headline dead.
    //
    // Asserted against the gap level rather than against fair value, because
    // under-reaction gaps land SHORT of fair: "already moved" is the claim, not
    // "already above".
    for (const kind of Object.keys(ARCHETYPES)) {
      const aftermath = withKind(kind);
      const ev = { eventTime: 0.3, aftermath };
      expect(Math.abs(eventShape(0.301, ev) - (1 + aftermath.gap))).toBeLessThan(0.05);
    }
  });

  it("puts the two families on opposite sides of fair value", () => {
    // The whole point of the second family. Over-reaction spends its life above
    // fair and has to come down; under-reaction spends it below and has to
    // climb. If these ever overlapped, "fade the print" would be a rule again.
    for (const kind of OVER_KINDS) {
      const a = withKind(kind);
      expect(a.gap).toBeGreaterThan(0);
      expect(eventShape(0.2 + 0.001, { eventTime: 0.2, aftermath: a })).toBeGreaterThan(1);
    }
    for (const kind of UNDER_KINDS) {
      const a = withKind(kind);
      expect(a.gap).toBeLessThan(0);
      const ev = { eventTime: 0.2, aftermath: a };
      expect(eventShape(0.201, ev)).toBeLessThan(1);
      // ...and it never overshoots on the way up: an under-reaction arrives at
      // fair, it does not sail past it and become an over-reaction late.
      for (let u = 0; u <= 1; u += 0.005) {
        expect(eventShape(0.2 + 0.0005 + u * a.settleSpan, ev)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("settles to exactly 1 for every archetype, at every sampled draw", () => {
    // The one invariant scoring depends on: whatever the tape did on the way,
    // the event delivers exactly its authored impact. Over-reaction and
    // under-reaction land on precisely the same close. Walk many seeded draws
    // rather than the defaults, so the tails of every param range are covered.
    for (let seed = 1; seed < 60; seed += 1) {
      const rand = mulberry32(seed);
      for (const profile of PROFILES) {
        const eventTime = 0.05 + (seed % 19) * 0.05; // spread across the week, incl. 0.90
        const severity = SEVERITIES[seed % SEVERITIES.length];
        const aftermath = drawAftermath(rand, profile, severity, [], 1 - eventTime);
        const ev = { eventTime, aftermath };
        expect(eventShape(1, ev)).toBe(1); // exactly — the fair close is authored, not emergent
        // ...and it is settled well before the close, not just at it. The
        // margin covers the gap itself, which sits between the fake and the
        // aftermath's clock starting.
        const done = eventTime + (aftermath.fake ? aftermath.fake.span : 0) + aftermath.settleSpan + 0.002;
        if (done < 1) expect(eventShape(done, ev)).toBe(1);
      }
    }
  });

  it("a late event leaves no residue in the fair close", () => {
    // Regression: the old exponential-only ring-out was still ringing at the
    // close for an event landing at 0.90 — eventShape(1) came out ~1.23, so the
    // week silently delivered 23% more move than the author asked for. The
    // taper plus the settleSpan clamp make the span mean what it says.
    const rand = mulberry32(7);
    for (let i = 0; i < 40; i += 1) {
      const aftermath = drawAftermath(rand, "volatile", "critical", [], 1 - 0.9);
      expect(eventShape(1, { eventTime: 0.9, aftermath })).toBe(1);
    }
  });

  it("gives grind nothing to trade and chop plenty", () => {
    // The two ends of the library. Grind bleeds quietly back to fair without
    // ever crossing it; chop crosses repeatedly. If these two ever converge,
    // the library has collapsed back into one shape.
    const crossings = (kind) => {
      const ev = { eventTime: 0.2, aftermath: withKind(kind) };
      // Track the last SIGNIFICANT sign rather than the previous sample. A
      // naive prev/next comparison misses crossings: the sample nearest the
      // zero lands inside the dead band, so by the next step "previously
      // positive" is already false and the crossing vanishes. The band also
      // keeps the settle-to-exactly-fair at the end of the span from reading as
      // a crossing, which is what makes grind score zero.
      const eps = 1e-6;
      let n = 0;
      let sign = 0;
      for (let p = 0.21; p < 0.8; p += 0.0005) {
        const v = eventShape(p, ev) - 1;
        if (v > eps) sign = 1;
        else if (v < -eps) {
          if (sign === 1) n += 1;
          sign = -1;
        }
      }
      return n;
    };
    expect(crossings("grind")).toBe(0);
    expect(crossings("chop")).toBeGreaterThanOrEqual(3);
    expect(crossings("fade")).toBe(1); // through fair exactly once, then settle
  });

  it("gives the dead cat a second leg back out after it looks finished", () => {
    // Its identity: retrace almost to fair (looks like a fade wrapping up),
    // then dislocate again. Never crosses fair, which is what tells it apart
    // from a fade once you can see enough of it — but not at the start, which
    // is the point.
    const ev = { eventTime: 0.2, aftermath: withKind("deadCat") };
    const at = (u) => eventShape(0.2 + 0.0005 + u * ev.aftermath.settleSpan, ev) - 1;
    // Find the trough by scanning rather than by guessing where it sits, then
    // the high after it — the assertion is about the SHAPE, not about where a
    // particular parameter draw happens to put the turn.
    let trough = Infinity;
    let troughU = 0;
    for (let u = 0.05; u < 0.8; u += 0.005) {
      if (at(u) < trough) { trough = at(u); troughU = u; }
    }
    let second = -Infinity;
    for (let u = troughU; u < 1; u += 0.005) second = Math.max(second, at(u));

    expect(trough).toBeLessThan(ev.aftermath.gap * 0.25); // looked done
    expect(second).toBeGreaterThan(trough * 2.5); // ...then went again
    for (let u = 0; u < 1; u += 0.005) expect(at(u)).toBeGreaterThan(-1e-9); // never through fair
  });

  it("carries continuation PAST the print before the long return", () => {
    // The trap for the reflexive fader: the tape keeps going the way it gapped.
    const ev = { eventTime: 0.2, aftermath: withKind("continuation") };
    const peak = (e) => {
      let m = 0;
      for (let p = 0.2; p < 0.8; p += 0.0005) m = Math.max(m, eventShape(p, e));
      return m;
    };
    expect(peak(ev)).toBeGreaterThan(1 + ev.aftermath.gap * 1.2);
  });

  it("grinds drift monotonically up to fair without ever offering a dip", () => {
    // Its identity: one direction, no second chance. A dip would make it a
    // fade-alike; the trade is that you either took the print or you watched it.
    const ev = { eventTime: 0.2, aftermath: withKind("drift") };
    const at = (u) => eventShape(0.2 + 0.0005 + u * ev.aftermath.settleSpan, ev);
    let prev = at(0);
    for (let u = 0.005; u <= 1; u += 0.005) {
      const v = at(u);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9); // never backs up
      prev = v;
    }
    expect(at(0)).toBeLessThan(0.75); // gapped well short of the move
    expect(at(1)).toBeCloseTo(1, 6); // and arrives exactly
  });

  it("gives stairs flat plateaus between its legs", () => {
    // Each pause has to be long enough to read as the end of the move. Measure
    // it: over the span there should be stretches where the tape is essentially
    // still, and stretches where it moves fast.
    const ev = { eventTime: 0.2, aftermath: withKind("stairs") };
    const at = (u) => eventShape(0.2 + 0.0005 + u * ev.aftermath.settleSpan, ev);
    let flat = 0;
    let moving = 0;
    for (let u = 0; u < 1; u += 0.005) {
      const d = Math.abs(at(u + 0.005) - at(u));
      if (d < 1e-4) flat += 1;
      else if (d > 2e-3) moving += 1;
    }
    expect(flat).toBeGreaterThan(30); // real plateaus, not an eased ramp
    expect(moving).toBeGreaterThan(20); // and real risers between them
  });

  it("keeps lateSurge indistinguishable from a dead name, then moves it", () => {
    // Shares its opening with `grind` on purpose: both gap and go quiet. The
    // whole trade is how long you leave capital parked on something doing
    // nothing.
    const ev = { eventTime: 0.2, aftermath: withKind("lateSurge") };
    const at = (u) => eventShape(0.2 + 0.0005 + u * ev.aftermath.settleSpan, ev);
    const early = Math.abs(at(0.35) - at(0));
    const late = Math.abs(at(1) - at(0.7));
    expect(early).toBeLessThan(0.02); // still looks like nothing is happening
    expect(late).toBeGreaterThan(early * 5); // ...and then it goes
  });

  it("prints a head fake the WRONG way before ripping through", () => {
    const aftermath = { ...withKind("fade"), fake: { depth: 0.4, span: 0.02 } };
    const ev = { eventTime: 0.3, aftermath };
    expect(eventShape(0.3005, ev)).toBeLessThan(0); // gapped against the news
    expect(eventShape(0.31, ev)).toBeCloseTo(-0.4, 6); // and holds the lie
    expect(eventShape(0.325, ev)).toBeGreaterThan(1); // then rips through fair
    expect(eventShape(1, ev)).toBe(1); // and still settles where it should
  });
});

describe("resolveAftermaths (the seeded draw)", () => {
  const week = [];
  for (let i = 0; i < 10; i += 1) {
    week.push({ id: `e${i}`, eventTime: 0.05 + i * 0.08, reactionProfile: "gradual" });
  }

  it("is identical for a seed and different across seeds", () => {
    const a = resolveAftermaths(week, 4417);
    const b = resolveAftermaths(week, 4417);
    const c = resolveAftermaths(week, 9001);
    expect(a.map((e) => e.aftermath.kind).join()).toBe(b.map((e) => e.aftermath.kind).join());
    expect(a[0].aftermath.gap).toBeCloseTo(b[0].aftermath.gap, 12);
    // The whole point: a replay is not the same tape.
    expect(a.map((e) => e.aftermath.kind).join() === c.map((e) => e.aftermath.kind).join()).toBeFalsy();
  });

  it("attaches an aftermath to every event without reordering them", () => {
    const out = resolveAftermaths(week, 12);
    expect(out.length).toBe(week.length);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i].id).toBe(week[i].id);
      expect(!!out[i].aftermath).toBeTruthy();
    }
  });

  it("keeps a week varied rather than dealing the same shape repeatedly", () => {
    // The recency penalty exists so a run doesn't hand you three fades in a row
    // and feel like the old fixed shape. Averaged over many seeds, the longest
    // run of one kind in a 10-event week should stay short.
    let worst = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const kinds = resolveAftermaths(week, seed).map((e) => e.aftermath.kind);
      let run = 1;
      for (let i = 1; i < kinds.length; i += 1) {
        run = kinds[i] === kinds[i - 1] ? run + 1 : 1;
        worst = Math.max(worst, run);
      }
    }
    expect(worst).toBeLessThanOrEqual(3);
  });

  it("leans on the authored profile without obeying it", () => {
    // A volatile week should chop far more often than a gradual one — but a
    // gradual week must still be able to produce one, or the profile has become
    // a lock again and the player can read the shape off the vision's tone.
    const count = (profile, kind) => {
      let n = 0;
      for (let seed = 1; seed <= 60; seed += 1) {
        const evs = week.map((e) => ({ ...e, reactionProfile: profile }));
        n += resolveAftermaths(evs, seed).filter((e) => e.aftermath.kind === kind).length;
      }
      return n;
    };
    const volatileChop = count("volatile", "chop");
    const gradualChop = count("gradual", "chop");
    expect(volatileChop).toBeGreaterThan(gradualChop * 2);
    expect(gradualChop).toBeGreaterThan(0);
  });

  it("gives an event landing at the bell nothing to ring with", () => {
    const late = resolveAftermaths([{ id: "bell", eventTime: 0.999, reactionProfile: "volatile" }], 5);
    expect(late[0].aftermath.gap).toBe(0);
    expect(eventShape(1, late[0])).toBe(1);
  });

  // --- family selection ---------------------------------------------------

  const familyMix = (evs, seeds = 80) => {
    let over = 0;
    let total = 0;
    for (let seed = 1; seed <= seeds; seed += 1) {
      for (const e of resolveAftermaths(evs, seed)) {
        if (FAMILY[e.aftermath.kind] === "over") over += 1;
        total += 1;
      }
    }
    return over / total;
  };

  it("draws both families at roughly even odds overall", () => {
    // If the library only over-reacted, "fade the print" would still be a
    // mechanical rule that pays — the exact free lunch the archetypes exist to
    // remove. Across profiles and severities the split should sit near even.
    const mixed = [];
    let i = 0;
    for (const reactionProfile of PROFILES) {
      for (const severity of SEVERITIES) {
        mixed.push({ id: `m${i}`, eventTime: 0.03 + i * 0.06, reactionProfile, severity });
        i += 1;
      }
    }
    const p = familyMix(mixed, 60);
    expect(p).toBeGreaterThan(0.4);
    expect(p).toBeLessThan(0.6);
  });

  it("tilts toward over-reaction on loud news and under-reaction on technical news", () => {
    // The learnable heuristic: read the vision's TONE, not just its direction.
    const at = (reactionProfile, severity) =>
      familyMix(week.map((e) => ({ ...e, reactionProfile, severity })));
    expect(at("overreaction", "critical")).toBeGreaterThan(at("overreaction", "minor"));
    expect(at("gradual", "critical")).toBeGreaterThan(at("gradual", "minor"));
    expect(at("overreaction", "major")).toBeGreaterThan(at("delayed", "major"));
  });

  it("never lets the tilt become a certainty", () => {
    // A lean, not a lock. The loudest possible event must still under-react
    // sometimes, or the tell is mechanically tradeable and we have moved the
    // free lunch rather than removed it.
    expect(pOverreact("overreaction", "critical")).toBeLessThanOrEqual(0.85);
    expect(pOverreact("delayed", "minor")).toBeGreaterThanOrEqual(0.15);
    const loud = familyMix(week.map((e) => ({ ...e, reactionProfile: "overreaction", severity: "critical" })));
    expect(loud).toBeLessThan(0.9); // still under-reacts a meaningful slice of the time
    expect(loud).toBeGreaterThan(0.6); // ...but the lean is real
  });

  it("leaves no edge in blindly fading (or blindly chasing) the print", () => {
    // THE invariant this second family exists for, and the one most easily lost
    // to a well-meaning retune of BASE_OVER.
    //
    // "Take the opposite side of the print and hold to settle" earns exactly the
    // signed gap, in units of the event's impact: positive gap means the tape is
    // rich and fading it pays; negative means it is cheap and fading it loses.
    // So the mean signed gap across the draw distribution IS the edge of the
    // naive rule, and it has to sit near zero.
    //
    // Measured on a realistic severity mix, because that is what decides it:
    // authored weeks skew critical/major, and an earlier tuning that looked
    // balanced on paper produced a mean gap of +0.13 on real content — a free
    // 13% of every event's impact for anyone who just always faded.
    const realistic = [];
    const sevMix = ["critical", "major", "critical", "major", "critical", "major", "minor", "major", "critical", "major"];
    for (let i = 0; i < 10; i += 1) {
      realistic.push({
        id: `r${i}`,
        eventTime: 0.05 + i * 0.08,
        severity: sevMix[i],
        reactionProfile: PROFILES[i % PROFILES.length],
      });
    }
    let sum = 0;
    let n = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      for (const e of resolveAftermaths(realistic, seed)) {
        sum += e.aftermath.gap;
        n += 1;
      }
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.08);
  });

  it("sizes the two families' gaps alike, not just their odds", () => {
    // An even family split still hands the fader an edge if the moves they fade
    // are bigger than the ones they miss. Mean magnitudes have to match too.
    const mag = (kinds) => {
      let s = 0;
      for (const k of kinds) s += Math.abs((RANGES[k].gap[0] + RANGES[k].gap[1]) / 2);
      return s / kinds.length;
    };
    const over = mag(OVER_KINDS.filter((k) => k !== "grind")); // grind is the deliberate no-op
    const under = mag(UNDER_KINDS);
    expect(Math.abs(over - under)).toBeLessThan(0.12);
  });

  it("flips the family per event, without balancing the run", () => {
    // Deliberately NOT a quota. A ten-vision week is allowed to come out 9/1,
    // and that variance is content: any run-level balancing would let a player
    // count cards and infer what the last few events have to be. So across
    // seeds we should see LOPSIDED weeks, not every week landing near 5/5.
    const counts = [];
    for (let seed = 1; seed <= 200; seed += 1) {
      counts.push(resolveAftermaths(week, seed).filter((e) => FAMILY[e.aftermath.kind] === "over").length);
    }
    const lopsided = counts.filter((c) => c <= 2 || c >= 8).length;
    expect(lopsided).toBeGreaterThan(0); // a balanced bag could never produce these
    expect(Math.min(...counts)).toBeLessThan(3);
    expect(Math.max(...counts)).toBeGreaterThan(7);
  });
});

describe("eventImpactPct", () => {
  it("scales by severity and magnitude, signed by direction", () => {
    const major = { severity: "major" };
    expect(eventImpactPct(major, { direction: "positive", magnitude: 1 })).toBeCloseTo(SEVERITY_AMP.major, 6);
    expect(eventImpactPct({ severity: "critical" }, { direction: "negative", magnitude: 0.5 })).toBeCloseTo(-0.5 * SEVERITY_AMP.critical, 6);
    expect(eventImpactPct(major, { direction: "neutral", magnitude: 1 })).toBe(0);
  });
});

describe("fairPriceFromEvents (superposition)", () => {
  const companies = [{ companyId: "a", openingPrice: 100 }];

  it("stays flat before the event, moves after it lands", () => {
    const events = [
      { id: "up", eventTime: 0.3, severity: "major", reactionProfile: "immediate", affectedCompanies: [{ companyId: "a", direction: "positive", magnitude: 1 }] },
    ];
    const contrib = buildContributions(companies, events).get("a");
    expect(fairPriceFromEvents(0.1, 100, contrib)).toBeCloseTo(100, 6);
    expect(fairPriceFromEvents(1, 100, contrib)).toBeCloseTo(100 * (1 + SEVERITY_AMP.major), 6);
  });

  it("sums multiple events on the same company", () => {
    const events = [
      { id: "up", eventTime: 0.2, severity: "major", reactionProfile: "immediate", affectedCompanies: [{ companyId: "a", direction: "positive", magnitude: 1 }] },
      { id: "dn", eventTime: 0.2, severity: "minor", reactionProfile: "immediate", affectedCompanies: [{ companyId: "a", direction: "negative", magnitude: 1 }] },
    ];
    const contrib = buildContributions(companies, events).get("a");
    expect(fairPriceFromEvents(1, 100, contrib)).toBeCloseTo(100 * (1 + SEVERITY_AMP.major - SEVERITY_AMP.minor), 6);
  });

  it("leaves companies with no events flat", () => {
    const contrib = buildContributions(companies, []).get("a");
    expect(fairPriceFromEvents(0.5, 100, contrib)).toBeCloseTo(100, 6);
  });
});

describe("event turbulence", () => {
  const companies = [{ companyId: "a", openingPrice: 100, volatility: 0.01 }];
  const events = [
    { id: "shock", eventTime: 0.4, severity: "critical", reactionProfile: "immediate", affectedCompanies: [{ companyId: "a", direction: "negative", magnitude: 1 }] },
  ];
  const contrib = buildContributions(companies, events).get("a");

  it("is calm before the news and agitated right after it", () => {
    expect(eventTurbulence(0.3, contrib)).toBe(0);
    expect(eventTurbulence(0.41, contrib)).toBeGreaterThan(0);
  });

  it("decays back to calm well after the event", () => {
    expect(eventTurbulence(0.41, contrib)).toBeGreaterThan(eventTurbulence(0.6, contrib));
  });

  it("leaves a company with no events perfectly calm", () => {
    expect(eventTurbulence(0.5, [])).toBe(0);
  });

  it("makes the tape swing much wider around an event than in quiet stretches", () => {
    const n = makeNoiseFn(1337, companies[0], contrib);
    const range = (from, to) => {
      let lo = Infinity, hi = -Infinity;
      for (let p = from; p < to; p += 0.001) { const v = n(p); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      return hi - lo;
    };
    expect(range(0.4, 0.45)).toBeGreaterThan(range(0.2, 0.25) * 3);
  });
});

describe("noise", () => {
  it("is deterministic for a seed+company and zero at the open", () => {
    const c = { companyId: "helix", openingPrice: 100, volatility: 0.02 };
    const n1 = makeNoiseFn(1337, c);
    const n2 = makeNoiseFn(1337, c);
    expect(n1(0)).toBeCloseTo(0, 6); // faded to zero at open
    for (let p = 0; p <= 1; p += 0.1) expect(n1(p)).toBeCloseTo(n2(p), 9);
  });

  it("stays within the volatility band", () => {
    const c = { companyId: "x", openingPrice: 100, volatility: 0.02 };
    const n = makeNoiseFn(1337, c);
    for (let p = 0; p <= 1; p += 0.01) {
      expect(Math.abs(n(p))).toBeLessThanOrEqual(0.02 * 100 + 1e-9);
    }
  });

  it("settles to zero at the close so the final tape equals fair value", () => {
    const c = { companyId: "x", openingPrice: 100, volatility: 0.02 };
    const n = makeNoiseFn(1337, c);
    expect(n(1)).toBeCloseTo(0, 9); // the score marks at fair prices; the tape must land on them
    // ...but the tape is still breathing on the run-in to the close.
    let liveBefore = 0;
    for (let p = 0.9; p <= 0.975; p += 0.005) liveBefore = Math.max(liveBefore, Math.abs(n(p)));
    expect(liveBefore).toBeGreaterThan(0.05);
  });
});

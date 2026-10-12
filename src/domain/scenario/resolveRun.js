// Run resolution — where a week's authored POSSIBILITIES collapse into the one
// concrete week this run plays.
//
// A scenario used to be a fixed answer key: which company an event moves, which
// way and how much, and when it lands. Three facts, memorized independently, and
// once all three are known the week is solved before it starts. The market layer
// randomizes hard underneath (eight aftermath archetypes, head fakes, noise) but
// every one of those settles at the authored close — today's design varies the
// PATH and fixes the DESTINATION.
//
// This file varies the destination, under one law (docs/VARIANCE_ARCHITECTURE.md
// §1):
//
//   Variance may change the answer. It may never change whether the answer was
//   reachable — nor whether correct reasoning was rewarded.
//
// Which is why three things here are deliberately narrow:
//
//   SEGMENTS      A slot holds two or more sibling segments filling the SAME
//                 time window, and exactly one fires. Swapping siblings can
//                 never leave a hole, so there is no dead air and no re-spacing
//                 pass — which is what makes segments cheaper than the
//                 prerequisite-gating design they replaced.
//   INCIDENCE     Which SECONDARY names get touched. A `direct` impact always
//                 fires (the validator makes that an error, not a warning): if
//                 the direct hit could vanish, the vision was a lie. The ripples
//                 are the variable part, which is what the README already says
//                 the game is — reading the ripple.
//   MAGNITUDE     Amplified or dud, as a MULTIPLIER on the authored magnitude.
//                 The authored value stays the ceiling and keeps its meaning, so
//                 existing balance intuitions survive. The floor is load-bearing:
//                 a correct read must always pay something, or "dud" becomes a
//                 punishment for good reasoning.
//
// A `visionText` never depends on the draw. That is the player's contract, and
// nothing in here touches it.
//
// Pure: (scenario, runSeed) -> exactly the flat shape MarketEngine, visionFeed,
// scoreGame and the debrief already consume. Everything downstream of the one
// call site in gameStore.js receives what it receives today.

import { mulberry32, derivedSeed } from "../rng.js";

// An impact with no `incidence` always fires. Most impacts are this.
const DEFAULT_INCIDENCE = 1;

// Content reaches this file from two directions: a LoadedScenario (the game,
// where the timeline is `events`) and a raw private half (the validator, the
// path report, tests — where it is `marketEvents`). Same fields either way.
function eventsOf(scenario) {
  return scenario.events || scenario.marketEvents || [];
}

function cmpId(a, b) {
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

// Slots in a stable order, which is also the order paths are reported in.
// Sorted by id rather than array order for the same reason events are: a draw
// order that depends on where something sits in a JSON array reshuffles every
// other draw the moment content is reordered. Name slots so they sort the way
// they run (`slot-1`, `slot-2`) and the two orders agree.
export function orderedSlots(scenario) {
  return [...(scenario.slots || [])].sort((a, b) => cmpId(a.id, b.id));
}

function weightedPick(rand, items) {
  if (!items || !items.length) return null;
  let total = 0;
  for (const it of items) total += it.weight ?? 1;
  if (!(total > 0)) return items[0];
  let roll = rand() * total;
  for (const it of items) {
    roll -= it.weight ?? 1;
    if (roll <= 0) return it;
  }
  return items[items.length - 1];
}

// One roll per authored impact, keyed by event id and AUTHORED position.
//
// Two disciplines are baked in here, and both exist so that tuning one knob
// never silently moves another:
//
//   1. One named stream per step. `derivedSeed(runSeed, "incidence")` and
//      `derivedSeed(runSeed, "magnitude")` are independent of each other and of
//      "segments" and "aftermath", so adding a band to one impact cannot change
//      which archetype an unrelated event draws.
//   2. Every impact is rolled, whether or not the roll is used, and impacts are
//      walked in a stable sorted order rather than array order. An impact that
//      is dropped (or has no band) still consumes its draw, so the segment that
//      fired, the incidences that missed, and the array's ordering are all
//      invisible to every other impact's number.
function drawPerImpact(events, runSeed, streamName) {
  const rand = mulberry32(derivedSeed(runSeed, streamName));
  const rolls = new Map();
  for (const ev of [...events].sort((a, b) => cmpId(a.id, b.id))) {
    const affected = ev.affectedCompanies || [];
    const order = affected
      .map((_, i) => i)
      .sort((x, y) => cmpId(affected[x].companyId, affected[y].companyId) || x - y);
    const out = new Array(affected.length);
    for (const i of order) out[i] = rand();
    rolls.set(ev.id, out);
  }
  return rolls;
}

// Every structurally distinct week this content can produce: one segment per
// slot, in slot order. Slots are few, so this is small — 2 slots is 4 paths, 3
// is 8 — which is what lets the validator PROVE the concurrency envelope holds
// on every possible week instead of sampling and hoping (see schema.js).
export function enumeratePaths(scenario) {
  let paths = [[]];
  for (const slot of orderedSlots(scenario)) {
    const segments = slot.segments || [];
    if (!segments.length) continue;
    const next = [];
    for (const path of paths) {
      for (const seg of segments) next.push([...path, seg.id]);
    }
    paths = next;
  }
  return paths;
}

// The flat event list one path produces: the spine (every event with no
// `segment`) plus the events belonging to the segments that were chosen.
export function eventsForPath(scenario, path) {
  const chosen = path instanceof Set ? path : new Set(path || []);
  return eventsOf(scenario).filter((ev) => !ev.segment || chosen.has(ev.segment));
}

// A resolved week carries no unevaluated conditions. `segment` said which weeks
// this beat appears in and `thread` said which weeks this impact counts in —
// both questions are answered by the time an event is in the list, so the keys
// come off and what remains is an ordinary flat timeline. That is what lets a
// single resolved path go through the validator exactly as a segment-free
// scenario does, and what keeps every consumer downstream unable to tell that
// segments exist.
function strippedEvent(ev, affectedCompanies) {
  const out = { ...ev, affectedCompanies };
  delete out.segment;
  return out;
}

function strippedImpact(aff) {
  if (aff.thread == null) return aff;
  const out = { ...aff };
  delete out.thread;
  return out;
}

// One path's STRUCTURAL resolution: the events it fires, with impacts that are
// conditioned on a thread pruned to the thread this path made dominant.
//
// This is the shape the validator proves the concurrency envelope against, and
// it is deliberately free of the continuous knobs — incidence and magnitude are
// sampled, so they get sampled checks (see tests/variance.test.js) rather than
// exhaustive ones.
export function resolvePath(scenario, path) {
  const threads = threadTally(scenario, path);
  const dominant = dominantThread(scenario, threads);
  const events = eventsForPath(scenario, path).map((ev) =>
    strippedEvent(
      ev,
      (ev.affectedCompanies || []).filter((a) => !a.thread || a.thread === dominant).map(strippedImpact)
    )
  );
  return { events, threads, dominant };
}

// Which segments a path actually selected, as objects rather than ids.
export function segmentsForPath(scenario, path) {
  const chosen = path instanceof Set ? path : new Set(path || []);
  const out = [];
  for (const slot of orderedSlots(scenario)) {
    for (const seg of slot.segments || []) {
      if (chosen.has(seg.id)) out.push(seg);
    }
  }
  return out;
}

// How many segments advanced each declared thread. Threads a scenario declares
// but no chosen segment advances stay at 0 rather than dropping out, so callers
// can report the full vocabulary.
export function threadTally(scenario, path) {
  const tally = {};
  for (const t of scenario.threads || []) tally[t] = 0;
  for (const seg of segmentsForPath(scenario, path)) {
    if (!seg.thread) continue;
    tally[seg.thread] = (tally[seg.thread] ?? 0) + 1;
  }
  return tally;
}

// The thread the week was mostly about. Ties break by DECLARATION order in
// `threads`, so the tie-break is authored rather than incidental — with an even
// number of slots ties are the common case, and which thread wins them is a
// balance decision the author should be making on purpose.
export function dominantThread(scenario, tally) {
  const declared = scenario.threads || [];
  let best = null;
  let bestCount = 0;
  for (const t of declared) {
    const n = tally[t] ?? 0;
    if (n > bestCount) {
      best = t;
      bestCount = n;
    }
  }
  return bestCount > 0 ? best : null;
}

// The paragraph order the debrief reads in: segments in LANDING order, so the
// assembled summary walks the week forward however the slots were declared.
function landingOrder(scenario, segments) {
  const firstLanding = new Map();
  for (const ev of eventsOf(scenario)) {
    if (!ev.segment) continue;
    const t = ev.eventTime ?? 0;
    const prev = firstLanding.get(ev.segment);
    if (prev == null || t < prev) firstLanding.set(ev.segment, t);
  }
  return [...segments].sort(
    (a, b) => (firstLanding.get(a.id) ?? 1) - (firstLanding.get(b.id) ?? 1) || cmpId(a.id, b.id)
  );
}

// The debrief for the week that actually happened: a fixed opening, the chosen
// segments' paragraphs in landing order, and a fixed closing — joined into ONE
// string, so debrief.js keeps rendering a single value and needs no change.
//
// The authoring constraint this implies is not an engine one: each
// `debriefPara` must read standalone, because it cannot know which sibling
// preceded it. Content with no slots (or older content with a single authored
// `summary`) falls through to that summary untouched.
export function assembleDebrief(scenario, segments) {
  const debrief = scenario.debrief || {};
  const parts = [];
  if (debrief.opening) parts.push(debrief.opening.trim());
  for (const seg of landingOrder(scenario, segments)) {
    if (seg.debriefPara) parts.push(seg.debriefPara.trim());
  }
  if (debrief.closing) parts.push(debrief.closing.trim());
  const assembled = parts.join(" ");
  return assembled || debrief.summary || "";
}

// Resolve one run's concrete event list from authored content.
//
// A scenario carrying none of the new fields resolves EXACTLY as it does today:
// no slots means one path (all spine), no incidence means every impact fires,
// no band means the authored magnitude stands. That is what made every phase of
// this land incrementally.
export function resolveRun(scenario, runSeed = 0) {
  const events = eventsOf(scenario);

  // 1. One segment per slot, weighted.
  const segRand = mulberry32(derivedSeed(runSeed, "segments"));
  const chosen = [];
  for (const slot of orderedSlots(scenario)) {
    const seg = weightedPick(segRand, slot.segments);
    if (seg) chosen.push(seg);
  }
  const path = chosen.map((s) => s.id);

  // 2. Filter the timeline down to spine + chosen segments.
  const fired = eventsForPath(scenario, path);

  // 3. Tally the threads the week took, and which one it was mostly about.
  const tally = threadTally(scenario, path);
  const dominant = dominantThread(scenario, tally);

  // 4. Resolve each surviving event's impacts.
  const incidenceRolls = drawPerImpact(events, runSeed, "incidence");
  const magnitudeRolls = drawPerImpact(events, runSeed, "magnitude");
  const scenarioBand = (scenario.variance || {}).magnitudeBand;

  const resolved = fired.map((ev) => {
    const incRolls = incidenceRolls.get(ev.id) || [];
    const magRolls = magnitudeRolls.get(ev.id) || [];
    const affectedCompanies = [];
    (ev.affectedCompanies || []).forEach((aff, i) => {
      // Thread-conditional: the finale's consequences depend on the week you
      // had. One event, several possible readings of it — which is cheaper than
      // a finale-variant system and reuses the machinery already here.
      if (aff.thread && aff.thread !== dominant) return;
      // mulberry32 returns [0, 1), so an incidence of 1 always fires.
      if (!((incRolls[i] ?? 0) < (aff.incidence ?? DEFAULT_INCIDENCE))) return;
      const band = aff.magnitudeBand || scenarioBand;
      if (!band) {
        affectedCompanies.push(strippedImpact(aff));
        return;
      }
      const scale = band[0] + (magRolls[i] ?? 0) * (band[1] - band[0]);
      affectedCompanies.push(strippedImpact({ ...aff, magnitude: (aff.magnitude ?? 0) * scale }));
    });
    // An event whose every impact was dropped still FIRES. The vision was shown
    // and the headline is owed; a week where a glimpsed story simply never
    // happens is the feed being unreliable, which is the one thing the fair-play
    // rule forbids.
    return strippedEvent(ev, affectedCompanies);
  });

  return {
    events: resolved,
    path: { segments: path, threads: tally, dominant },
    debriefSummary: assembleDebrief(scenario, chosen),
  };
}

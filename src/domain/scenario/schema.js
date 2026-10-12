// Scenario validation (design doc sections 10.3 and 10.8) — event model.
//
// The doc suggests Zod, but this project runs without a build step or npm, so we
// use a tiny hand-rolled validator with the same spirit: it returns a list of
// human-readable errors rather than throwing. It runs unchanged in the browser
// (at load time) and in Node (the scripts/validate-scenario.mjs CLI).
//
// A scenario is split into PUBLIC and PRIVATE halves:
//   public  = the CAST (company identity + description + opening price), metadata
//   private = per-company noise params, the market EVENT TIMELINE, debrief
// The validator checks the merged shape plus the balance rules from section 10.8,
// and — crucially — that nothing hidden leaked into the public half.
//
// Since schema 3.0 the cast is fully scenario-local: every company's name,
// sector and description live in the public file. The description is the
// player's entire fact sheet for that company — the fair-play rule
// (docs/SCENARIO_AUTHORING.md) says every deduction a vision asks for must be
// grounded there, so the validator treats a missing or threadbare description
// as a real defect, not a cosmetic one.

import { buildContributions, fairPriceFromEvents } from "../market/pricingModel.js";
import { resolveAftermaths } from "../market/aftermath.js";
import { enumeratePaths, resolvePath, orderedSlots } from "./resolveRun.js";

// The structure space is small enough to check exhaustively, so the balance
// suite below runs on EVERY week the content can produce rather than on the
// merged superset of all of them. Re-exported because it is the authoring
// instrument's entry point too (tests/variance.html).
export { enumeratePaths, resolvePath } from "./resolveRun.js";

const REACTION_PROFILES = ["immediate", "gradual", "delayed", "overreaction", "volatile"];
const SEVERITIES = ["minor", "major", "critical"];
const DIRECTIONS = ["positive", "negative", "neutral"];
const CAUSAL_ROLES = ["direct", "supplier", "customer", "competitor", "sector", "macro", "expectations"];

// Move bounds from section 10.8 ("avoid moves above 35% unless scenario-specific").
// Applied as a soft warning, not a hard error.
const MAJOR_MOVE = 0.35;

// Description bounds: one scannable line that still carries 2-3 concrete,
// deduction-bearing facts. Too long stops being scannable; too short can't
// ground anything.
const DESC_MAX = 160;
const DESC_MIN = 30;

// Feed-text caps (docs/SCENARIO_AUTHORING.md §3a). Visions and headlines are
// read against a moving tape, so length is playability, not style — but the
// documented caps are approximate, so overruns warn rather than fail.
const VISION_MAX = 110;
const HEADLINE_MAX = 120;

// The week must play into its final day (docs §5): a finale before this point
// leaves the run-in to the close with nothing to infer or trade against.
const FINALE_MIN = 0.85;

// How much the reveal order may agree with the landing order before the week is
// just a queue (Kendall tau; 1.0 = strict first-in-first-out). See the FIFO
// check below for why this is the balance rule that matters most.
//
// The ceiling stays 0.6 even though PENDING_MAX (below) fell to 3, which leaves
// it much less headroom than it had: every discordant pair needs two visions
// open at the same time, so capping the board at 3 caps how far the landing
// order can depart from the reveal order. With these event times ~0.5 is about
// the floor, so a shipped scenario now sits just under the line rather than
// comfortably below it. Loosening the ceiling would defeat the check; the way
// to buy room is fewer, longer-lived theses, not a laxer rule.
const FIFO_TAU_MAX = 0.6;

// How many visions may be pending at once. Three is a board a player can
// actually hold in their head: read all three, rank them, and know what they
// are cutting when a fourth arrives. Five was legible on screen but not in the
// head — the extra cards were read as texture, so the week played as three
// theses plus noise. Contested capital needs the stack, not the crowd.
const PENDING_MAX = 3;

// The magnitude band multiplies the authored magnitude, so its FLOOR is what
// decides whether a correct read still pays on a bad draw. Too low and "dud"
// becomes the same punishment for good reasoning that contradictory outcomes
// were — the failure that killed an entire earlier design
// (docs/VARIANCE_ARCHITECTURE.md §8). This is the number most likely to need
// play-tuning, so it warns rather than fails.
const MAGNITUDE_FLOOR_MIN = 0.4;

// Sibling segments fill the same slot, so a player must not be able to tell
// which one they got by the SHAPE of the week — only by its content. A branch
// with twice the beats, or one that spreads them over half again as much of the
// week, is a tell before it is a story.
const SIBLING_BEAT_SLACK = 1;
const SIBLING_SPAN_SLACK = 0.05;

function checkBand(band, where, errors, warnings) {
  if (band == null) return;
  if (!Array.isArray(band) || band.length !== 2 || !band.every((n) => Number.isFinite(n))) {
    errors.push(`${where} magnitudeBand must be [lo, hi]`);
    return;
  }
  const [lo, hi] = band;
  if (!(lo > 0 && lo <= hi && hi <= 1)) {
    errors.push(`${where} magnitudeBand [${lo}, ${hi}] must satisfy 0 < lo <= hi <= 1 (it multiplies the authored magnitude, which stays the ceiling)`);
    return;
  }
  if (lo < MAGNITUDE_FLOOR_MIN) {
    warnings.push(`${where} magnitudeBand floor is ${lo} (below ${MAGNITUDE_FLOOR_MIN}) — a correct read must always pay something`);
  }
}

export function validateScenario(pub, priv) {
  const errors = [];
  const warnings = [];

  // --- public: the run parameters ---
  // These were unchecked for a long time, and every miss failed silently at a
  // distance: a missing seed ran the market at seed 0, a missing duration made
  // the clock's progress NaN. The whole point of the validator is that content
  // mistakes fail HERE, with a name, not downstream.
  if (!(typeof pub.title === "string" && pub.title.trim())) errors.push("public title missing");
  if (!(typeof pub.description === "string" && pub.description.trim())) errors.push("public description missing");
  if (!Number.isFinite(pub.seed)) errors.push("public seed must be a finite number (a missing seed silently runs at 0)");
  if (!(Number.isFinite(pub.durationSeconds) && pub.durationSeconds > 0)) {
    errors.push("public durationSeconds must be > 0 (the clock's progress divides by it)");
  }
  if (!(Number.isFinite(pub.startingCash) && pub.startingCash > 0)) errors.push("public startingCash must be > 0");

  // --- public: the cast ---
  const pubCompanies = pub.companies || [];
  const pubIds = new Set();
  const seenNames = new Map(); // lowercased name -> companyId
  const seenDescs = new Map(); // exact description -> companyId
  for (const c of pubCompanies) {
    if (!c.companyId) errors.push("public company missing companyId");
    if (pubIds.has(c.companyId)) errors.push(`duplicate company ${c.companyId}`);
    pubIds.add(c.companyId);
    if (!(c.openingPrice > 0)) errors.push(`company ${c.companyId} openingPrice must be positive`);

    if (!c.name || typeof c.name !== "string") errors.push(`company ${c.companyId} missing name`);
    if (!c.sector || typeof c.sector !== "string") errors.push(`company ${c.companyId} missing sector`);
    if (!c.description || typeof c.description !== "string") {
      errors.push(`company ${c.companyId} missing description (the player's only fact sheet)`);
    } else {
      if (c.description.length > DESC_MAX) {
        errors.push(`company ${c.companyId} description is ${c.description.length} chars (max ${DESC_MAX} — one scannable line)`);
      }
      if (c.description.length < DESC_MIN) {
        warnings.push(`company ${c.companyId} description is only ${c.description.length} chars — too thin to deduce from`);
      }
      const descKey = c.description.trim();
      if (seenDescs.has(descKey)) {
        warnings.push(`companies ${seenDescs.get(descKey)} and ${c.companyId} share a description — the cast must be tellable apart`);
      }
      seenDescs.set(descKey, c.companyId);
    }
    if (c.name) {
      const nameKey = c.name.trim().toLowerCase();
      if (seenNames.has(nameKey)) errors.push(`companies ${seenNames.get(nameKey)} and ${c.companyId} share the name "${c.name}"`);
      seenNames.set(nameKey, c.companyId);
    }
  }

  // --- public: the timeline (optional; display-only, but still authored) ---
  const TIMELINE_KINDS = ["trading-week", "days", "weeks", "months"];
  const tl = pub.timeline;
  if (tl != null) {
    if (typeof tl !== "object" || Array.isArray(tl)) {
      errors.push("timeline must be an object ({ kind, count?, segments? })");
    } else {
      if (!TIMELINE_KINDS.includes(tl.kind)) {
        errors.push(`timeline kind "${tl.kind}" is not one of ${TIMELINE_KINDS.join(" / ")}`);
      }
      const segs = tl.segments;
      if (segs != null && (!Array.isArray(segs) || !segs.length || segs.some((s) => typeof s !== "string" || !s.trim()))) {
        errors.push("timeline segments must be a non-empty array of labels");
      }
      if (tl.kind !== "trading-week" && TIMELINE_KINDS.includes(tl.kind)) {
        if (segs == null && !(Number.isInteger(tl.count) && tl.count >= 1)) {
          errors.push(`timeline kind "${tl.kind}" needs an integer count >= 1 (or explicit segments)`);
        }
        if (Array.isArray(segs) && segs.length && tl.count != null && tl.count !== segs.length) {
          errors.push(`timeline count (${tl.count}) disagrees with its ${segs.length} segments`);
        }
      }
      const segCount = Array.isArray(segs) && segs.length ? segs.length : tl.kind === "trading-week" ? 5 : tl.count;
      if (Number.isInteger(segCount) && segCount > 12) {
        warnings.push(`timeline has ${segCount} segments — the header axis gets cramped past 12`);
      }
    }
  }

  // --- public must not leak hidden gameplay data ---
  if ("marketEvents" in pub) errors.push("public file must not contain marketEvents");
  if ("debrief" in pub) errors.push("public file must not contain debrief");
  for (const c of pubCompanies) {
    for (const hidden of ["severity", "eventTime", "affectedCompanies", "volatility"]) {
      if (hidden in c) errors.push(`public company ${c.companyId} leaks hidden field ${hidden}`);
    }
  }

  // --- private: per-company noise params ---
  const privCompanies = priv.companies || [];
  const privIds = new Set();
  for (const c of privCompanies) {
    privIds.add(c.companyId);
    if (!pubIds.has(c.companyId)) errors.push(`private company ${c.companyId} has no public entry`);
    if (c.volatility != null && !(c.volatility >= 0)) errors.push(`company ${c.companyId} volatility must be >= 0`);
  }
  for (const id of pubIds) {
    if (!privIds.has(id)) errors.push(`public company ${id} has no private entry`);
  }

  // --- private: the variance vocabulary (threads, slots, segments) ---
  //
  // All optional. A file with none of them resolves exactly as it always did:
  // one path, all spine, authored magnitudes. That is what let this land
  // incrementally, and it is why every check below is guarded.
  checkBand((priv.variance || {}).magnitudeBand, "scenario variance", errors, warnings);

  const declaredThreads = priv.threads || [];
  const threadSet = new Set();
  if (priv.threads != null) {
    if (!Array.isArray(priv.threads)) errors.push("threads must be an array of names");
    else {
      for (const t of priv.threads) {
        if (typeof t !== "string" || !t.trim()) errors.push("thread names must be non-empty strings");
        else if (threadSet.has(t)) errors.push(`duplicate thread ${t}`);
        else threadSet.add(t);
      }
    }
  }

  const slots = orderedSlots(priv);
  const slotBySegment = new Map();
  const segmentById = new Map();
  const advancedThreads = new Set();
  const slotIds = new Set();
  for (const slot of slots) {
    if (!slot.id) errors.push("slot missing id");
    if (slotIds.has(slot.id)) errors.push(`duplicate slot id ${slot.id}`);
    slotIds.add(slot.id);
    const w = slot.window;
    if (!(Array.isArray(w) && w.length === 2 && w[0] >= 0 && w[0] <= w[1] && w[1] <= 1)) {
      errors.push(`slot ${slot.id} window must be [lo, hi] inside [0, 1]`);
    }
    const segs = slot.segments || [];
    // One segment is not a slot, it is a spine beat with extra machinery: the
    // whole point is that swapping siblings can never leave a hole.
    if (segs.length < 2) warnings.push(`slot ${slot.id} has ${segs.length} segment(s) — a slot with no sibling is just spine`);
    for (const seg of segs) {
      if (!seg.id) errors.push(`slot ${slot.id} has a segment with no id`);
      if (segmentById.has(seg.id)) errors.push(`duplicate segment id ${seg.id}`);
      segmentById.set(seg.id, seg);
      slotBySegment.set(seg.id, slot);
      if (seg.weight != null && !(seg.weight > 0)) errors.push(`segment ${seg.id} weight must be > 0`);
      if (seg.thread == null) {
        warnings.push(`segment ${seg.id} advances no thread — the finale has nothing to read`);
      } else if (!threadSet.has(seg.thread)) {
        errors.push(`segment ${seg.id} advances thread "${seg.thread}", which is not in threads`);
      } else {
        advancedThreads.add(seg.thread);
      }
    }
  }
  for (const t of threadSet) {
    if (!advancedThreads.has(t)) warnings.push(`thread "${t}" is declared but no segment advances it`);
  }

  // Which threads can actually come out on top. A finale impact conditioned on a
  // thread that never dominates is dead prose in every possible week.
  const reachableDominants = new Set();
  const paths = enumeratePaths(priv);
  for (const path of paths) {
    const d = resolvePath(priv, path).dominant;
    if (d) reachableDominants.add(d);
  }

  // --- private: the event timeline ---
  const events = priv.marketEvents || [];
  const eventIds = new Set();
  for (const ev of events) {
    if (!ev.id) errors.push("market event missing id");
    if (eventIds.has(ev.id)) errors.push(`duplicate event id ${ev.id}`);
    eventIds.add(ev.id);

    if (!(ev.eventTime >= 0 && ev.eventTime <= 1)) errors.push(`event ${ev.id} eventTime must be in [0,1]`);
    if (!(ev.leadTime >= 0)) errors.push(`event ${ev.id} leadTime must be >= 0`);
    if (ev.leadTime === 0) {
      warnings.push(`event ${ev.id} has zero leadTime — it lands the instant it reveals, skipping the board entirely`);
    }
    if (ev.eventTime - ev.leadTime < 0) errors.push(`event ${ev.id} reveals before the week starts (leadTime > eventTime)`);
    if (!SEVERITIES.includes(ev.severity)) errors.push(`event ${ev.id} has invalid severity ${ev.severity}`);
    if (ev.reactionProfile && !REACTION_PROFILES.includes(ev.reactionProfile)) {
      errors.push(`event ${ev.id} has invalid reactionProfile ${ev.reactionProfile}`);
    }
    if (ev.reactionSpan != null) {
      if (!(ev.reactionSpan > 0)) errors.push(`event ${ev.id} reactionSpan must be > 0`);
      else if (ev.reactionSpan > 0.2) {
        warnings.push(`event ${ev.id} reactionSpan is ${ev.reactionSpan} — more than a fifth of the week is a drift, not a gap`);
      }
    }
    if (!ev.visionText || typeof ev.visionText !== "string") {
      errors.push(`event ${ev.id} missing visionText`);
    } else if (ev.visionText.length > VISION_MAX) {
      warnings.push(`event ${ev.id} visionText is ${ev.visionText.length} chars (target <=${VISION_MAX} — too long to read against the tape)`);
    }
    if (!ev.headlineText || typeof ev.headlineText !== "string") {
      errors.push(`event ${ev.id} missing headlineText (shown once the event lands)`);
    } else if (ev.headlineText.length > HEADLINE_MAX) {
      warnings.push(`event ${ev.id} headlineText is ${ev.headlineText.length} chars (target <=${HEADLINE_MAX} — a wire flash, not a wire story)`);
    }

    // Segment membership. Events stay FLAT — this one optional field is the
    // whole of it, which is why loadScenario, MarketEngine, visionFeed and
    // scoreGame never learned that segments exist.
    if (ev.segment != null) {
      if (!segmentById.has(ev.segment)) {
        errors.push(`event ${ev.id} belongs to unknown segment ${ev.segment}`);
      } else {
        const slot = slotBySegment.get(ev.segment);
        const w = slot.window;
        if (Array.isArray(w) && w.length === 2 && !(ev.eventTime >= w[0] && ev.eventTime <= w[1])) {
          errors.push(`event ${ev.id} lands at ${ev.eventTime}, outside slot ${slot.id}'s window [${w[0]}, ${w[1]}] — siblings must fill the same window or swapping them leaves a hole`);
        }
      }
    }

    const affected = ev.affectedCompanies || [];
    if (!affected.length) warnings.push(`event ${ev.id} affects no companies`);
    for (const a of affected) {
      if (!pubIds.has(a.companyId)) errors.push(`event ${ev.id} references unknown company ${a.companyId}`);
      if (!DIRECTIONS.includes(a.direction)) errors.push(`event ${ev.id} affects ${a.companyId} with invalid direction ${a.direction}`);
      if (!(a.magnitude >= 0)) errors.push(`event ${ev.id} affects ${a.companyId} with invalid magnitude`);
      if (a.causalRole && !CAUSAL_ROLES.includes(a.causalRole)) errors.push(`event ${ev.id} has invalid causalRole ${a.causalRole}`);

      // The direct hit always fires. This is the rule that keeps the deal with
      // the player honest while the ripples become the variable part: if the
      // company a vision points AT could be left untouched by the draw, the
      // vision was a lie and the deduction it asked for was a trap.
      if (a.incidence != null) {
        if (!(a.incidence > 0 && a.incidence <= 1)) {
          errors.push(`event ${ev.id} affects ${a.companyId} with incidence ${a.incidence} — must be in (0, 1]`);
        }
        if (a.causalRole === "direct" && a.incidence < 1) {
          errors.push(`event ${ev.id} affects ${a.companyId} directly with incidence ${a.incidence} — a direct impact must always fire`);
        }
      }
      checkBand(a.magnitudeBand, `event ${ev.id} impact ${a.companyId}`, errors, warnings);
      if (a.thread != null) {
        if (!threadSet.has(a.thread)) {
          errors.push(`event ${ev.id} conditions ${a.companyId} on thread "${a.thread}", which is not in threads`);
        } else if (!reachableDominants.has(a.thread)) {
          warnings.push(`event ${ev.id} conditions ${a.companyId} on thread "${a.thread}", which no path can make dominant — the impact is unreachable`);
        }
      }
    }
  }

  // --- private: sibling symmetry ---
  //
  // Siblings are supposed to be two versions of the same week, not a good week
  // and a thin one. Both of these are warnings because "equal" is a judgment the
  // author makes by reading them; what the validator can catch is the shapes
  // being obviously unequal.
  const beatsBySegment = new Map();
  for (const ev of events) {
    if (!ev.segment) continue;
    if (!beatsBySegment.has(ev.segment)) beatsBySegment.set(ev.segment, []);
    beatsBySegment.get(ev.segment).push(ev.eventTime ?? 0);
  }
  for (const slot of slots) {
    const stats = (slot.segments || []).map((seg) => {
      const times = beatsBySegment.get(seg.id) || [];
      return { id: seg.id, beats: times.length, span: times.length ? Math.max(...times) - Math.min(...times) : 0 };
    });
    for (let i = 0; i < stats.length; i += 1) {
      for (let j = i + 1; j < stats.length; j += 1) {
        if (Math.abs(stats[i].beats - stats[j].beats) > SIBLING_BEAT_SLACK) {
          warnings.push(`slot ${slot.id}: ${stats[i].id} has ${stats[i].beats} beats and ${stats[j].id} has ${stats[j].beats} — siblings that differ in length are tellable apart before they are read`);
        }
        if (Math.abs(stats[i].span - stats[j].span) > SIBLING_SPAN_SLACK) {
          warnings.push(`slot ${slot.id}: ${stats[i].id} spans ${stats[i].span.toFixed(2)} of the week and ${stats[j].id} spans ${stats[j].span.toFixed(2)} — siblings should fill the window the same way`);
        }
      }
    }
  }

  // --- private: debrief ---
  //
  // Either a single authored summary (the shape before segments) or an
  // opening/closing pair the resolver assembles the chosen segments' paragraphs
  // between. Both are honoured; content that has both keeps the summary as the
  // fallback for a run where nothing was selected.
  const debrief = priv.debrief;
  const assembles = !!(debrief && (debrief.opening || debrief.closing));
  if (!debrief || (!assembles && !(typeof debrief.summary === "string" && debrief.summary))) {
    errors.push("debrief.summary missing (or an opening/closing pair to assemble one from)");
  }
  if (assembles) {
    for (const [id, seg] of segmentById) {
      if (!seg.debriefPara) warnings.push(`segment ${id} has no debriefPara — the weeks it fires in lose their middle`);
    }
  }
  if (pubIds.size < 10) warnings.push(`only ${pubIds.size} companies (acceptance criteria wants >=10)`);

  // --- balance, per possible week ---
  //
  // Slots are few, so instead of checking the merged superset of every segment
  // — a week nobody plays, whose concurrency profile is the sum of mutually
  // exclusive branches — the whole balance suite runs on EACH path the content
  // can produce. Two slots is four weeks; three is eight. This is stronger than
  // fuzzing: it proves the concurrency envelope, the finale window, the FIFO
  // ceiling and the move bounds hold on every week that can actually happen.
  //
  // With no slots there is exactly one path and the label is empty, so a
  // segment-free scenario gets byte-identical messages to the ones it always got.
  for (const path of paths) {
    const label = path.length ? `path [${path.join(" + ")}]: ` : "";
    checkWeek(resolvePath(priv, path).events, label);
  }

  return { ok: errors.length === 0, errors, warnings };

  // ---------------------------------------------------------------------------

  function checkWeek(events, label) {
    // --- balance: derive the actual end-of-week moves from the event superposition ---
    const calcCompanies = pubCompanies.map((c) => ({ companyId: c.companyId, openingPrice: c.openingPrice }));
    // Resolve aftermaths before pricing the close. The settled level is the same
    // whatever archetype gets drawn — that's the invariant the whole library is
    // built on — but an UNRESOLVED event falls back to a generic shape that may
    // still be ringing at progress 1, which would put a phantom few percent into
    // the balance figures the warnings below are derived from. Any fixed seed
    // gives the same answer here; 1 is as good as any.
    //
    // Magnitudes here are the AUTHORED ones — the ceiling. The band multiplies
    // downward from it, so a path that balances at full magnitude is the best
    // case; that the floor still pays is the sampled half of the check
    // (tests/variance.test.js §4c), not this one.
    const contrib = buildContributions(calcCompanies, resolveAftermaths(events, 1));
    let meaningfulMoves = 0;
    let untouched = 0;
    let directClues = 0;
    for (const ev of events) {
      for (const a of ev.affectedCompanies || []) {
        if (a.causalRole === "direct") directClues += 1;
      }
    }
    for (const c of pubCompanies) {
      const end = fairPriceFromEvents(1, c.openingPrice, contrib.get(c.companyId));
      const move = Math.abs(end - c.openingPrice) / c.openingPrice;
      if (move >= 0.03) meaningfulMoves += 1;
      if (move < 1e-9) untouched += 1;
      if (move > MAJOR_MOVE) warnings.push(`${label}company ${c.companyId} moves ${(move * 100).toFixed(0)}% (>35%)`);
    }

    // --- balance rules (section 10.8) ---
    if (meaningfulMoves < 3) errors.push(`${label}at least three companies must have meaningful (>=3%) moves`);
    if (events.length < 6) warnings.push(`${label}only ${events.length} events (a lively week wants >=6)`);
    if (events.length) {
      const lastEventTime = Math.max(...events.map((ev) => ev.eventTime || 0));
      if (lastEventTime < FINALE_MIN) {
        warnings.push(`${label}last event lands at ${Math.round(lastEventTime * 100)}% of the week — the close is a waiting game (land the finale near 0.85-0.9)`);
      }
    }
    if (untouched < 2) warnings.push(`${label}fewer than 2 untouched 'decoy' companies — the market may feel too legible`);
    if (directClues === 0) warnings.push(`${label}no directly-affected company in any event`);

    // --- balance: the concurrency profile (contested capital) ---
    // Trading decisions appear when the book is contested: several visions
    // pending at once against one cash-only book, so a new reveal has to be
    // funded by cutting a position the player still believes in. A timeline
    // where visions arrive single-file is a stock-picking quiz, not a trading
    // week — and it regresses silently, so the profile is checked here.
    if (!events.length) return;
    const bounds = [];
    // Snapped to the authoring grid before sorting. A reveal timed to the beat
    // of a landing — the common shape now that the board holds three, since the
    // freed slot is exactly what the next vision is funded from — comes out of
    // `eventTime - leadTime` as 0.3799999999999999 against a landing at 0.38,
    // and the raw comparison reports a 4-deep board a fraction of a float wide.
    // That overlap does not exist in play; snapping measures what was authored.
    const snap = (t) => Math.round(t * 1e6) / 1e6;
    for (const ev of events) {
      bounds.push([snap((ev.eventTime || 0) - (ev.leadTime || 0)), 1], [snap(ev.eventTime || 0), -1]);
    }
    bounds.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // a landing frees its band before a same-tick reveal
    let pending = 0;
    let peak = 0;
    for (const [, d] of bounds) {
      pending += d;
      if (pending > peak) peak = pending;
    }
    if (peak < PENDING_MAX) {
      warnings.push(`${label}pending visions never stack ${PENDING_MAX} deep (peak ${peak}) — capital is never contested; overlap leads until ${PENDING_MAX} theses compete mid-week`);
    }
    // The cap is about the player, not the pixels: the board places up to 6
    // cards cleanly, but a fourth open thesis stops being a position and starts
    // being scenery — the player tracks three and treats the rest as texture.
    // So PENDING_MAX is the ceiling AND the target: author the week to touch 3
    // and never exceed it.
    if (peak > PENDING_MAX) {
      warnings.push(`${label}${peak} visions can be pending at once — more than ${PENDING_MAX} open theses is more than a player can hold, so the extras read as texture; shorten some leads`);
    }

    // Uniform leads make reveals and landings interleave in lockstep — the book
    // never actually stacks even when the spacing looks busy. Some visions
    // should be short fuses, others held as long open theses.
    const leads = events.map((ev) => ev.leadTime).filter((l) => l > 0);
    if (leads.length >= 2) {
      const minLead = Math.min(...leads);
      const maxLead = Math.max(...leads);
      if (maxLead < minLead * 2) {
        warnings.push(`${label}all leads sit in a narrow band (${minLead}-${maxLead}) — vary them (short fuses next to half-week theses) so the board stacks instead of interleaving`);
      }
    }

    // THE FIFO CHECK — the one that actually decides whether the week trades.
    // Counting concurrent visions is not enough: if they also RESOLVE in the
    // order they appeared, the optimal play stays "back the newest read, wait
    // for it to land, recycle the cash", and a full board is decoration
    // over a single-file queue. Contention needs the queue jumped — a thesis
    // you opened early still unresolved when a later-revealed vision lands
    // first, so funding it means selling something you still believe in.
    //
    // Measured as Kendall tau between reveal order and landing order: 1.0 is
    // pure first-in-first-out, 0 is uncorrelated. Anything above FIFO_TAU_MAX
    // is a queue wearing a board.
    if (events.length >= 4) {
      const byReveal = [...events].sort(
        (a, b) => (a.eventTime - a.leadTime) - (b.eventTime - b.leadTime) || (a.id < b.id ? -1 : 1)
      );
      let concordant = 0;
      let discordant = 0;
      for (let i = 0; i < byReveal.length; i += 1) {
        for (let j = i + 1; j < byReveal.length; j += 1) {
          if (byReveal[j].eventTime > byReveal[i].eventTime) concordant += 1;
          else if (byReveal[j].eventTime < byReveal[i].eventTime) discordant += 1;
        }
      }
      const pairs = concordant + discordant;
      const tau = pairs ? (concordant - discordant) / pairs : 1;
      if (tau > FIFO_TAU_MAX) {
        warnings.push(
          `${label}visions resolve in the order they were revealed (order correlation ${tau.toFixed(2)}, want <=${FIFO_TAU_MAX}) — the week plays first-in-first-out, so capital is never contested; give some late-landing events long leads so earlier-revealed theses are still open when later ones land`
        );
      }
    }
  }
}

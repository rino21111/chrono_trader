# Variance: Implementation Plan

The build plan for the segment model. Design rationale lives in
`VARIANCE_ARCHITECTURE.md`; this document is what you work from.

**Shape of the work:** four phases. Phase 1 delivers real variance against
*existing content with no new prose*. Phase 2 is pure plumbing with zero
behavioural change. Phase 3 is the content probe. Phase 4 is a gate, not a
build step.

> **The gate (end of phase 3).** *Can I tell which week I'm in by the halfway
> point — and does knowing change what I do?* Everything past phase 4 is
> unplanned on purpose: it depends on an answer we do not have.

---

## 1. Schema deltas

Three additions, all optional. **A file with none of them resolves exactly as
it does today**, which is what makes every phase below safe to land
incrementally.

### 1a. Ripple incidence — *which* secondary names get touched

```jsonc
"affectedCompanies": [
  { "companyId": "saltair-minerals", "direction": "negative", "magnitude": 0.6,
    "causalRole": "direct" },                    // incidence implicitly 1.0

  { "companyId": "promised-valley-ranches", "direction": "positive", "magnitude": 0.2,
    "causalRole": "macro", "incidence": 0.6 },   // fires on 60% of runs

  { "companyId": "intermountain-light-coal", "direction": "positive", "magnitude": 0.2,
    "causalRole": "competitor", "incidence": 0.35 }
]
```

- `incidence` — probability in `(0, 1]`, default `1.0`.
- **Hard rule:** `causalRole: "direct"` must have `incidence` of 1. A validator
  **error**, not a warning. If the direct hit can vanish, the vision was a lie.
- An impact that does not fire is **removed from the array** before
  `buildContributions` sees it. Nothing downstream needs to know.

### 1b. Magnitude bands — amplified or dud

```jsonc
// private file, scenario level
"variance": { "magnitudeBand": [0.5, 1.0] },

// per impact, optional override
{ "companyId": "helix-compute", "magnitude": 0.75, "magnitudeBand": [0.85, 1.0] }
```

The band is a **multiplier on the authored magnitude**, not an absolute range.
The authored value stays the ceiling and keeps its meaning, so existing balance
intuitions survive.

**The floor is load-bearing:** a correct read must always pay something.
Default `0.5`; validator warns below `0.4`. This is the single number most
likely to need play-tuning — see §7.

### 1c. Slots and segments

```jsonc
"threads": ["water", "sovereignty", "scandal"],   // declared vocabulary; order breaks ties

"slots": [
  {
    "id": "slot-1",
    "window": [0.18, 0.34],          // both siblings land inside this band
    "segments": [
      { "id": "water-fight",  "thread": "water",   "weight": 3 },
      { "id": "shield-blend", "thread": "scandal", "weight": 2 }
    ]
  },
  { "id": "slot-2", "window": [0.46, 0.64], "segments": [ /* ... */ ] }
],

"marketEvents": [
  { "id": "ev-covenant",  /* no `segment` key -> SPINE, always fires */ },
  { "id": "ev-lake-bill", "segment": "water-fight", "eventTime": 0.22, /* ... */ },
  { "id": "ev-lease",     "segment": "water-fight", "eventTime": 0.31, /* ... */ }
]
```

Events stay **flat**. Membership is one optional field, so `loadScenario`,
`MarketEngine`, `visionFeed` and `scoreGame` are untouched.

### 1d. Thread-conditional impacts — the finale, cheaply

```jsonc
{ "companyId": "years-supply", "direction": "positive", "magnitude": 0.4,
  "causalRole": "sector", "thread": "sovereignty" }
```

Fires only when `sovereignty` is the **dominant** thread. This is Model A from
the architecture doc — one finale event whose *consequences* depend on the week
you had — implemented by reusing the incidence machinery rather than adding a
finale-variant system.

### 1e. Debrief assembly

```jsonc
"debrief": {
  "opening": "It opened as a regional utilities story...",     // spine, always
  "closing": "The faithful were prepared for all of it.",      // spine, always
  "summary": "<legacy single string>"                          // still honoured if present
}
```

Each segment gains `debriefPara`. The resolved summary is
`opening + selected segments' paragraphs in landing order + closing`, joined
into one string — so `debrief.js:201` keeps rendering a single value and needs
no change.

**Authoring constraint, not an engine one:** each `debriefPara` must read
standalone. It may not assume which segment preceded it.

---

## 2. The resolver

New file: **`src/domain/scenario/resolveRun.js`**

```js
/**
 * Resolve one run's concrete event list from authored content.
 * Pure: (scenario, runSeed) -> the same shape MarketEngine already consumes.
 */
export function resolveRun(scenario, runSeed) { /* ... */ }

// returns
{
  events,               // flat, filtered, sampled
  path: {
    segments: ["water-fight", "the-leak"],          // chosen per slot, slot order
    threads:  { water: 1, sovereignty: 1, scandal: 0 },
    dominant: "sovereignty"
  },
  debriefSummary        // assembled string
}
```

**Algorithm:**

1. **Choose a segment per slot** — weighted pick, stream `"segments"`.
2. **Filter events** — keep spine (no `segment`) plus events whose `segment` was
   chosen.
3. **Tally threads** — count chosen segments per thread; `dominant` is the max,
   ties broken by declaration order in `threads`.
4. **Resolve impacts** per event: drop any impact whose `thread` is set and is
   not dominant; roll `incidence` (stream `"incidence"`); sample
   `magnitudeBand` (stream `"magnitude"`).
5. **Assemble the debrief** from the chosen path.

**Seed discipline.** One `derivedSeed(runSeed, "<name>")` stream per step —
`"segments"`, `"incidence"`, `"magnitude"` — so tuning one knob never shifts
another. Within a stream, **iterate events in a stable sorted order (by `id`,
not array order)**, so adding an event to the content does not reshuffle the
draws for every other event.

---

## 3. Wiring

One call site. `src/state/gameStore.js` around line 118:

```js
const runSeed = pickRunSeed();
scenario.runSeed = runSeed;

const run = resolveRun(scenario, runSeed);              // NEW
scenario.events = resolveAftermaths(run.events, runSeed);
scenario.path = run.path;                               // debrief + fuzz reporting
scenario.debrief = { ...scenario.debrief, summary: run.debriefSummary };
```

Everything downstream — `MarketEngine.initialize`, `visionFeed`, `scoreGame`,
every UI component — receives exactly what it receives today.

---

## 4. Validation

### 4a. New rules in `schema.js`

| Rule | Severity |
|---|---|
| `causalRole: "direct"` with `incidence` < 1 | **error** |
| `incidence` outside `(0, 1]` | error |
| `magnitudeBand` not `[lo, hi]` with `0 < lo <= hi <= 1` | error |
| `magnitudeBand` floor below 0.4 | warning |
| `segment` references an unknown segment id | error |
| `thread` references a value not in `threads` | error |
| An event's `eventTime` outside its slot's `window` | error |
| Sibling segments differ by more than one beat | warning |
| Sibling segments' landing spans differ by > 0.05 | warning |
| A thread no segment advances | warning |
| A `thread`-conditional impact whose thread can never dominate | warning |

### 4b. Path enumeration — exhaustive, not sampled

Slots are few, so the structure space is small: 2 slots = 4 paths, 3 slots = 8.
**Enumerate every path and run the full existing balance suite on each.**

```js
// tests/variance.test.js
for (const path of enumeratePaths(priv)) {
  const events = eventsForPath(priv, path);
  const result = validateScenario(pub, { ...priv, marketEvents: events });
  assert(result.ok, `path ${path} fails: ${result.errors}`);
}
```

This is stronger than fuzzing: it *proves* every possible week satisfies the
concurrency envelope, the finale window, the FIFO ceiling and the move bounds.

### 4c. Sampled checks for the continuous knobs

Magnitude and incidence are continuous, so they get sampled — N ≈ 500 draws,
reporting the worst:

- at least three companies still move ≥ 3% **on every draw**
- untouched-decoy count stays ≥ 2
- no company exceeds the 35% move warning
- **variance floor**: draws are not near-identical (the failure this whole
  project exists to prevent)

### 4d. Where it runs

There is no Node runtime here, so both live in the browser:

- `tests/variance.test.js` — registered in `tests/tests.html`, pass/fail.
- `tests/variance.html` — a report page: path table, per-path balance figures,
  magnitude/incidence distributions, worst draw. This is the authoring
  instrument.

---

## 5. Content conversion

**Convert `week-001` first.** It is the most *modular* scenario — several
genuinely independent threads (power costs, battery metals, ad privacy, port
strike) and explicit off-plot events, which is exactly what segments want. Its
prose is also the least load-bearing, so a bad cut costs little.

**Convert `mormons-go-nuclear` last.** It is the prose reference but the worst
first candidate: Beehive round-trips through nearly every event, so its beats
are deeply interlocked and resist being cut into independent segments. Fighting
that at the same time as debugging the mechanism would confound both.

Work for the probe (`week-001`):

- add `"variance": { "magnitudeBand": [0.5, 1.0] }`
- add `incidence` to ~8 ripple impacts
- carve **2 slots × 2 segments × 2 beats** — 4 new beats of prose, 4 reused
- add `debriefPara` per segment; split `summary` into `opening` / `closing`

---

## 6. Phases

| # | What | Content cost | Exit criteria | |
|---|---|---|---|---|
| **0** | Namespace the aftermath stream: `derivedSeed(runSeed, "aftermath")` | none | pinned `?seed=` still reproduces a run; existing tests green | **done** |
| **1** | `incidence` + `magnitudeBand` + the sampled fuzz harness | one line per scenario, ~8 numbers | all 4 scenarios show run-to-run variance with **no new prose**; balance holds over 500 draws | **done** |
| **2** | Slot/segment schema + `resolveRun` + path enumeration | none | all existing content resolves all-spine; **byte-identical behaviour** to phase 1 | **done** |
| **3** | Convert `week-001`; debrief assembly | 4 new beats | all 4 paths validate exhaustively; debrief reads as narrative | **done** |
| **4** | **Play the probe fifteen times** | none | answer the gate question | open |

Phase 1 cost slightly more than "no new prose" predicted — see §7's first row.
`week-001` carries `threads: [silicon, logistics]` over two slots
(`silicon-crunch`/`dock-backlog`, `freight-squeeze`/`fab-scramble`), 12 events on
every one of its 4 paths, and the finale gained a thread-conditional impact per
thread.

Phase 1 is the one to notice: it ships meaningful variance against content that
already exists. If phases 2–4 never happen, phase 1 was still worth landing.

Phase 2 is deliberately a no-op behaviourally. That is the point — the plumbing
lands under test before any content depends on it.

---

## 7. Risks

| Risk | How it surfaces | Mitigation |
|---|---|---|
| **The band falsifies debrief prose** — *found in phase 1, not predicted here.* A quoted percentage ("minus a quarter") stops being true, and "won the week" is only true ~70% of the time once every impact draws its own multiplier. Worse, a **designed wash** — a trap built from equal and opposite impacts — nets ±4% instead of zero. The debrief renders beside a table of the actual closes, so each of these is a screen contradicting itself | reading the debrief against `tests/variance.html` | shipped fix: pin both legs of a wash with `magnitudeBand: [1, 1]`, and edit prose to claim the legs rather than the net. Rule now in `SCENARIO_AUTHORING.md` §6a |
| **Magnitude floor too low** — a correct read pays nothing and feels like a punishment | play, not tests | start at `0.5`, tune first; validator warns below `0.4` |
| A low draw trips *"at least three companies move ≥3%"* | sampled fuzz | §4c asserts on **every** draw, not the mean |
| Incidence drops a name to zero, changing the decoy count | sampled fuzz | assert decoys ≥ 2 across draws |
| Sibling segments feel unequal — one branch is obviously the good week | play | validator warns on beat-count and span mismatch; balance figures per path in the report |
| Debrief reads as stitched fragments | reading it | `debriefPara` must stand alone; fall back to a shorter summary rather than a worse one |
| Segments break the concurrency envelope | path enumeration | §4b runs the full existing suite per path |
| Seed churn invalidates pinned runs | phase 0 test | namespace first, before anything else lands |

---

## 8. File inventory

```
NEW
  src/domain/scenario/resolveRun.js      the resolver (~120 lines)
  tests/variance.test.js                 path enumeration + sampled checks
  tests/variance.html                    authoring report page

MODIFY
  src/domain/scenario/schema.js          new validation rules; enumeratePaths()
  src/domain/scenario/loadScenario.js    pass through slots/segments/threads/variance
  src/state/gameStore.js                 one call site (~line 118)
  tests/tests.html                       register the new suite
  content/scenarios/week-001/*.private.json
  docs/SCENARIO_AUTHORING.md             new section: segments, bands, incidence
  prompts/scenario-generator.md          emit the new shape

UNCHANGED — and this is the design working
  src/domain/market/*                    marketEngine, pricingModel, executionEngine
  src/domain/events/visions.js
  src/domain/scoring/scoreGame.js
  src/ui/**                              every component
```

`aftermath.js` changes by one line in phase 0 and not again.

---

## 9. Explicitly not in this plan

Deferred until the gate answers, and listed so they do not creep in:

- **Contradictory outcomes** — cut on principle, not schedule. Contradiction has
  no hedge; see `VARIANCE_ARCHITECTURE.md`.
- **`roleBinding`** and the role vocabulary — only a cross-universe campaign
  needs it.
- **Cast pools / `foilPresence`** — the next cheap win *after* the gate.
- **Timing jitter and the placer** — segments give structural variance without
  touching authored timing.
- **Finale variants (Model B)** — thread-conditional impacts (§1d) come first.
- **Chapters, carried capital, endless.**
- **Nested segments.** Depth stays at one. A segment is a straight run of beats.

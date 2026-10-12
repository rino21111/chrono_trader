# Variance Architecture

Why a scenario should play differently every time, what is forbidden from
changing, and how far the same machinery reaches toward multi-chapter play.

> **Status.** L0–L2 and L4 ship (phases 0–3 of the build plan): magnitude bands
> and ripple incidence on all four scenarios, slots and segments on `week-001`.
> L3 casting and L5 run state are still design. The build plan lives in
> **`VARIANCE_IMPLEMENTATION.md`** — this document is the *why*. §8 records
> designs that were considered and cut, so they do not get re-proposed.

---

## 0. The problem

A scenario today is a fixed answer key. Three facts are memorized
independently, and once all three are known the week is solved before it starts:

| Fact | Where it lives |
|---|---|
| **Which company** an event moves | `affectedCompanies[].companyId` |
| **Which way, how much** | `direction` × `magnitude` × `severity` |
| **When** it lands | `eventTime`, `leadTime` |

The market layer already randomizes hard — eight aftermath archetypes across
two families, a head-fake modifier, per-company noise, all fresh per run. But
every one settles at the authored close (`pricingModel.js`, `eventShape` →
exactly `1`). Today's design varies **the path** and fixes **the destination**.

---

## 1. The governing law

> **Variance may change the answer. It may never change whether the answer was
> reachable — nor whether correct reasoning was rewarded.**

The second clause is newer than the first and it is the one that killed an
entire earlier design (§8). It is the fair-play rule (`SCENARIO_AUTHORING.md`
§0) extended to a stochastic world.

Two corollaries carry most of the weight:

- **A beat's `visionText` may never depend on the draw.** It is the player's
  contract.
- **The cast sheet never lies and never varies mid-run.** A description is a
  standing fact.

### The deal with the player

Not "unpredictable." **Learnable in structure, unknowable in instance.**

A returning player should be able to think: *I've seen the lake bill this
early before — I'm in the water week, so the ranch will matter and the
broadcaster never will.* That is **recognizing which week you are in from
partial information, then trading the implication.** It reads the *shape* of
the week rather than each vision in isolation, it sharpens with every replay,
and a first-timer structurally cannot do it.

That sentence is the whole thesis, it is unfalsifiable on paper, and the build
plan is organized around testing it before anything else gets built.

---

## 2. The layer cake

| # | Layer | What it decides | Cadence | Status |
|---|---|---|---|---|
| **L5** | Run state | what carries between chapters | per chapter | deferred |
| **L4** | Composition | **which segments fire** — where the drama lives | per run | **shipped** (`week-001`) |
| **L3** | Casting | who is on the board | per run | later |
| **L2** | Beat detail | *how much, how wide* — never *which way* | per run, per beat | **shipped** |
| **L1** | Aftermath | the second wave's shape and direction | per run, per event | **shipped** |
| **L0** | Noise | tape texture, per company | per run | **shipped** |

**The rule of the cake: L0 and L1 cannot change the close; L2 and above define
it.** That boundary is why `scoreGame`, the debrief and the visible tape agree,
and it must survive every layer added above.

Note where the drama sits. An earlier draft put it in L2 — a single beat
resolving two contradictory ways. It now sits in **L4**, and L2 is restricted to
non-contradictory variation. §8 explains why that inversion matters.

### 2.1 What ships today (L0–L1)

All drawn from the **run seed**, fresh per run (`gameStore.js:118`), none of it
moving the close.

| Knob | Domain | Source |
|---|---|---|
| Noise harmonics — 3 sinusoid freq/phase pairs | freq 3–20 | `makeNoiseFn` |
| Chop harmonics — 2 high-freq pairs | freq 60–170 | `makeNoiseFn` |
| Turbulence | *derived* — a burst around each of a company's own events | `eventTurbulence` |
| Aftermath **family** | over / under, independent coin per event | `pOverreact` |
| Aftermath **kind** | 8 archetypes, recency-damped | `drawAftermath` |
| Aftermath **params** | `gap`, `settleSpan`, per-shape params | `RANGES` |
| Head fake | 5–15% per event | `FAKE_CHANCE` |

Two decisions in `aftermath.js` are policy that every layer above inherits:

- **No quotas.** The family coin is independent per event, explicitly so a
  player cannot count cards.
- **Damp the shape, never the family.** Damping direction *is* a quota.

### 2.2 The seed hierarchy, and one hazard

- **`scenarioSeed`** (`pub.seed`) — baked into content. Despite the name it
  drives nothing in the market; its only consumer is the vision board's
  card-placement order (`visionFeed.js:276`). A layout constant.
- **`runSeed`** — fresh per run, or pinned via `?seed=`.

**Hazard (closed in phase 0).** `resolveAftermaths` used to consume
`mulberry32(runSeed)` as a single raw stream while noise used
`derivedSeed(runSeed, companyId)` — so any new knob drawing from the raw stream,
or running *before* aftermath resolution, silently reshuffled every archetype
draw. It now draws `derivedSeed(runSeed, "aftermath")`, and the resolver above it
draws `"segments"`, `"incidence"` and `"magnitude"`. One namespace per step, and
a test pins each one.

---

## 3. The invariance ledger

| Invariant | Why |
|---|---|
| **A beat's `visionText`** | The player's contract. |
| **The sign of a direct impact** | If it can flip, the deduction was a trap. |
| **The gap is instant and universal** (`IMPULSE_SPAN`) | The only thing between the player and "wait for the headline, then trade." |
| **Every aftermath settles to exactly fair** | Lets scoring, the debrief and the tape agree. L0/L1 are path-only, permanently. |
| **Stated cast facts** | A description is evidence. |
| **The concurrency envelope** (2–3 pending, τ ≲ 0.6, finale 0.85–0.92, lead spread ≥ 2.5×, no dead air) | What makes the week *trade* rather than quiz. |
| **Starting cash, no margin** | Difficulty must never come from a different book. |
| **Determinism given (content, runSeed)** | Replay, tests, shared seeds, future multiplayer. |
| **No runtime LLM** | Variance selects among authored strings; it never assembles them. |

---

## 4. The segment model

A week is **a fixed spine with two or three swappable segments**.

```
SPINE          premise beats          always fires
  |- SLOT 1    segment A  or  B       2-3 beats, same time window
SPINE          connective beat        always fires
  |- SLOT 2    segment C  or  D
SPINE          connective beat
  |- SLOT 3    segment E  or  F
SPINE          finale                 consequences depend on the thread taken
```

Three rules keep it from sprawling:

1. **Siblings fill the same time window.** Swapping them can never leave a hole,
   so there is no dead air and no re-spacing pass. This is what makes segments
   strictly better than the prerequisite-gating design they replaced.
2. **Segments are independent across slots.** A must compose with D and F
   without either knowing about the other — the constraint that keeps authoring
   tractable rather than combinatorial.
3. **Only the finale reads the whole path.** One bounded place for the "it was
   all connected" payoff.

**Depth stays at one.** A segment is a straight run of beats, never a tree of
its own. Nesting doubles the authoring per level for a difference the player
cannot perceive — they experience one path either way.

### Threads, and why the finale is not simply fixed

Each segment advances a **thread** (2–4 per scenario). The run tallies them, and
the dominant thread decides which finale *consequences* apply.

The failure this avoids: if the finale were a pure function of the path, then
identifying your branch would hand you the largest move of the week for free —
putting the biggest payout on the most predictable event, and converting
branch-recognition from a skill that *informs* your positioning into a lookup
that completes it.

So: **the path narrows; a draw picks within.** You learn the *category* of
ending you earned, which is the reward for reading the week; you do not learn
which one, which keeps the last act live.

### What varies inside a beat

Degree and distribution, **never sign**:

| Knob | Varies |
|---|---|
| **Ripple incidence** | which *secondary* names get touched — the direct hit always fires |
| **Magnitude** | amplified or dud, as a multiplier on the authored value |
| **Breadth** | narrow and deep vs sector-wide and shallow |
| **Lead time** | short fuse vs long thesis — funding pressure, not the answer |
| **Second wave** | already shipped (L1) |

Incidence has a principled rule already latent in the schema: **`causalRole:
"direct"` always fires; `supplier` / `customer` / `competitor` / `sector` /
`macro` may be contingent.** The direct read stays honest and the *ripples*
become the variable part — which is what the README already says the game is:
"Reading the ripple is the game."

One guardrail: **the magnitude floor must keep a correct read profitable.**
Otherwise "dud" becomes the same punishment for good reasoning that
contradiction was.

### What it adds up to

| | |
|---|---|
| beats authored | ~19 (spine 6–7, plus 3 slots × 2 segments × 2 beats) |
| beats firing per run | 12–13 — the length scenarios already ship |
| structural weeks | 8, small enough to validate **exhaustively** |
| ratio | ~1.4× the prose for 8× the structure |

---

## 5. Resolution

A **pure function of (content, runSeed) → LoadedScenario**, run once at start,
producing exactly the flat shape the engine consumes today.

```
authored content --runSeed--> [ choose segments | filter events | tally threads
                                | roll incidence | sample magnitude ]
                          --> resolveAftermaths()  (ships today)
                          --> makeNoiseFn()        (ships today)
                          --> MarketEngine · visionFeed · scoreGame · debrief
                                          ^ UNCHANGED
```

That last line is why this is tractable at all. Field-by-field schema, the
resolver's signature, seed namespacing and the validation strategy are in
`VARIANCE_IMPLEMENTATION.md`.

---

## 6. Validation becomes structural

Slots are few, so the structure space is small — 3 slots is 8 paths. That means
**every possible week can be enumerated and run through the existing validator**,
proving the concurrency envelope holds rather than sampling and hoping. Only the
continuous knobs (magnitude, incidence) need sampling on top.

This is a firmer guarantee than fuzzing alone, and it is a direct benefit of
segments over the flag-graph design they replaced.

---

## 7. Extrapolation: chapters

**Rung 1 — same-universe endless.** One scenario, unbounded chapters. Needs a
segment pool larger than one chapter consumes, a cast pool larger than one
board, and threads carrying forward so chapter *n* can gate on *n−1*. No shared
role vocabulary. This is the reachable rung.

What carries is where the roguelite actually lives, not the draw:

- **Capital.** Chapter *n+1* starts with what *n* left. A bad read compounds —
  harsher and better than most upgrade trees, and it needs no new systems.
- **The cast, partially.** Survivors at closing prices. A company you learned in
  chapter 1 is an edge in chapter 4.
- **Threads.** They weight the segment pool later, so a run that went
  sovereignty-heavy keeps drawing sovereignty segments and **develops an arc
  nobody authored.**
- **Player knowledge.** Unmechanized, and the point.

**Rung 2 — cross-universe campaign.** Chapters from *different* scenarios.
Needs a ~30-role shared vocabulary, every company tagged, tokenized prose
throughout. This is the only thing `roleBinding` is for, and it is deferred
indefinitely. Do not build toward it.

**What endless can never have.** The composed reveal. `mormons-go-nuclear`
works because a company sits on the board as a decoy for eleven events and turns
out to be the answer to the whole week. No draw produces that. Chronicle mode
keeps those — a curated scenario is a run with variance dialled to zero.

---

## 8. What was cut, and why

| Cut | Why |
|---|---|
| **Contradictory outcomes** — one beat resolving two opposite ways | **Contradiction has no hedge.** You cannot be long and short one name, so a player who reasoned perfectly is wrong half the time with no counterplay but to bet less. The game's real decision — spread or commit — only exists when the uncertainty is about *who*, never *whether*. It also broke a shipped rule: §3a says there are no false visions and difficulty comes from inference, never from the feed being unreliable. |
| **`roleBinding`** — impacts address a role, bound per run | Its job is breaking *which company* — but that is not the dangerous memorization once outcomes vary. Costs a role vocabulary, `{{TOKEN}}` substitution and a handle-exclusivity solver, and kills name-specific prose. Only rung 2 needs it. |
| **"Two decisions you must make now"** | Speculative generality. `leadClass` is derivable from `leadTime` against bands the authoring guide already defines. Role indirection is a codemod later. **There is nothing you must decide now.** |
| **The placer, early** | Its value is timing variance — the least important third of the answer key — and it *regenerates* a hand-tuned concurrency profile. Segments give structural variance without touching authored timing at all. |
| **`requires` / prerequisite gating** | Suppressing a beat leaves a hole and dead air is forbidden. Segments solve the same problem better: siblings fill the same window, so nothing is ever suppressed. |
| **A committed eight-stage build order** | Every stage after the first depends on a thesis never tested in play. Replaced by a probe and a gate. |
| **Nested segments** | Doubles authoring per level for a difference the player cannot perceive. |

---

## 9. The competing strategy

Stated plainly, because it is the honest counterargument:

**Writing a fifth scenario is cheaper per unit of play than building any of
this.** Four scenarios at two or three plays each is roughly ten plays; one new
scenario adds three for a single authoring session. Variance is multiplicative
and content is linear — but at four scenarios, we are not at scale.

Two things keep the probe worth doing:

1. More content **delays** memorization rather than fixing it. The problem is
   that winning is recall; a fifth scenario is a fifth thing to recall.
2. The roguelite aspiration needs the engine regardless, and the probe is the
   cheapest test of whether that aspiration rests on something real.

**If the gate comes back *no*, writing scenarios is the correct thing to do
instead**, and this document should be closed rather than continued.

---

## 10. Open questions

- **Is the magnitude floor right?** The number most likely to need play-tuning.
  Too low and a correct read pays nothing, which is the same failure
  contradiction had.
- **Do sibling segments feel equal?** If one branch is obviously the good week,
  the draw is a verdict rather than a variation.
- **Does the assembled debrief read as narrative or as stitched fragments?**
  Untested prose engineering.
- **Can the author answer the gate at all**, knowing every segment? Probably
  only the mechanical half. A cheap proxy: play with the debrief hidden and
  write down which branch you think you're in at the one-third mark — if that
  is a live question you can be wrong about, the mechanism works.

---

## See also

- `VARIANCE_IMPLEMENTATION.md` — the build plan.
- `SCENARIO_AUTHORING.md` — §0 fair play, §5 concurrency, §6 aftermath.
- `src/domain/market/aftermath.js` — the reasoning L1 established.
- `src/domain/scenario/schema.js:256-335` — the concurrency metrics every path
  must satisfy.

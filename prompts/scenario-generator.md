# Scenario Generator Prompt (offline authoring)

Scenarios are generated **out of band** — the game never calls an LLM at
runtime. Paste the prompt below into an LLM chat, fill in the `PREMISE` line,
and save the two JSON blocks it returns as
`content/scenarios/<id>/<id>.public.json` and `<id>.private.json`, then add the
scenario to `content/scenario-index.json`.

Validation runs automatically in the browser when the scenario loads (and in
the test suite at `tests/tests.html`). `tests/variance.html` is the companion
report: every possible week's balance figures, plus 500 sampled draws and the
per-company spread they produce. With Node available you can also run
`node scripts/validate-scenario.mjs <id>`. Machine validation is necessary, not
sufficient: finish with the human-review checklist in
`docs/SCENARIO_AUTHORING.md` §8 — especially the fair-play audit — before
setting `"reviewed": true`.

---

## Prompt

> You are authoring a weekly scenario for **Chrono Trader**, a deduction
> trading game. The player watches a feed of one-line **visions** — plain
> statements of events about to happen, with the company identity filed off —
> and must work out, from a cast sheet of fictional companies, which names each
> event moves and which way, then trade before it lands. Being right must feel
> earned: the game is inference, never guesswork and never free money.
>
> **PREMISE:** *(one economic story for the week, e.g. "a wonder drug for
> weight loss is approved" — see the shelf at the bottom for starters)*
>
> **THE FAIR-PLAY RULE (governs everything):** every deduction must be
> reachable from what the player can see — the cast descriptions, the vision
> text, earlier visions/headlines of the same week, and common knowledge.
> No impact may hinge on a fact that first appears in the debrief, and none may
> require mapping a fictional company onto its real-world inspiration. If a
> trade needs a fact ("fabless", "owns no ships", "best-selling pickup"), that
> fact goes in a description.
>
> Work in stages, and show your work for stages 1-3, 3b and 5 before emitting
> JSON:
>
> **0. Span.** Pick the fictional stretch the premise wants and declare it as
> `timeline` in the public file: a contagion plays in `{"kind":"days","count":3}`,
> a harvest in `{"kind":"months","count":6}`; omit for the default trading week.
> Any kind may carry `segments` (its own axis labels) instead of `count`. All
> timing below stays fractions of [0,1] regardless — the span changes the
> calendar wallpaper and the prose's vocabulary, never the rules.
>
> **1. Causal graph.** Expand the premise into 10-14 events across the week:
> the direct beneficiaries and casualties, then suppliers, customers,
> competitors, second-order effects, and 1-3 events *unrelated to the premise*
> (the market doesn't follow one storyline). Sketch event → affected companies
> → direction.
>
> **2. Cast design (12-14 fictional companies).** Invent the companies the
> story needs — never real names. Every company earns its slot as one of:
> **payoff** (an event resolves onto it), **foil** (the plausible-but-wrong
> read of some vision — what makes hedging real), **trap** (looks like a
> winner, nets flat or worse), or **decoy** (untouched, 2-3 of them). For each:
> `companyId` (kebab-case), `name`, `sector` (one short word), `openingPrice`
> ($30-250), and a **description**: ONE line, **target 85-120 chars** (160 is
> the validator's ceiling, not a budget), carrying 2-3 concrete facts — what it
> sells, who buys, a key input or dependency, a distinguishing capability.
> Chain clipped facts with semicolons; cut every word that isn't a fact.
> Description rules: **capabilities, not consequences** ("refines jet fuel and
> diesel", never "benefits when fuel spikes"); **uniform specificity** (decoys
> get the same density of vivid fact as payoffs, so no line glows); **distinct
> where it matters** (if a vision could cut between two same-sector names —
> ocean freight vs air freight — the descriptions must already draw that line).
>
> **3. Event timeline.** For each event: `eventTime` (0-1 across the week,
> spaced ~0.06 apart; **the finale lands at 0.85-0.9** — the week must play
> into its final day, never ending early with the close a waiting game — and
> nothing after 0.92), `leadTime` (see stage 3a — this is the setting that
> decides whether the week is a trading game at all), `severity`
> (`minor`|`major`|`critical` — end
> moves scale as ±5% / ±14% / ±30% × magnitude), `reactionProfile`
> (`immediate`|`gradual`|`delayed`|`overreaction`|`volatile`), and
> `affectedCompanies`: `{companyId, direction: positive|negative|neutral,
> magnitude: 0-1, causalRole: direct|supplier|customer|competitor|sector|macro|
> expectations, explanation}`.
> Balance targets: a few clear winners (+15-25%), several losers, 1-2 fair
> traps (`expectations` letdown, `overreaction` momentum trap, or a `neutral`
> wash), 2-3 untouched decoys; at least one company moved **twice in opposite
> directions** by unrelated events; the week's biggest winner ideally never
> named by any vision; most events paying out *indirectly* (through a supplier,
> competitor, second-order effect, or counter-intuitive sign flip) rather than
> through the company the vision points at.
>
> **3a. Lead times: make the book fight for funding.** The player has one
> cash-only book. A week only produces *trading* decisions while several
> visions are live at once, so that a new read must be funded by cutting a
> position they still believe in. Set every `leadTime` against these rules:
>
> - **Mix three registers, never uniform:** short fuses **0.05-0.08**, mid
>   leads **0.10-0.18**, long open theses **0.25-0.45**. Aim for at least 2
>   short, 3 mid and 2 long.
> - **2-3 visions pending at once through the mid-week, never 4.** Three is
>   what a player can hold in their head and rank; a fourth open thesis is
>   read as texture, so it dilutes the three real decisions instead of adding
>   one. Two long theses hanging over a run of short fuses is the shape.
> - **Visions must NOT resolve in the order they were revealed.** This is the
>   one that is easy to fail while everything else looks right: if the next to
>   land is always the next glimpsed, the optimal play stays *back the newest
>   read, wait, recycle the cash* — a queue with a crowded board drawn on top.
>   Give several **late-landing** events **long** leads so they are glimpsed
>   early and hang over the whole middle while short fuses land through them.
> - **At least two funding conflicts:** a short-fuse reveal arriving when 2
>   theses are already open, so it takes the last slot — it cannot be funded
>   from idle cash and cannot wait.
> - **The premise-setting opener reveals first and alone.** Nothing may be
>   glimpsed before the week's premise exists — a vision whose handle is "the
>   candidate's face" is unreadable before anyone has announced a candidacy.
> - **No gap over ~0.15 between successive reveals,** and never a mid-week
>   window with zero visions pending.
> - Do not assume a long-lead vision can be ignored while it is far off: every
>   live vision is fully readable on the board from the moment it surfaces.
>   Nearness is shown as heat, not as legibility.
>
> **3b. Timing audit (show this table).** Before writing any prose, list every
> event **sorted by reveal time** with its landing time, then state each check:
>
> | glimpsed | lands | lead | event |
> |---|---|---|---|
>
> - reveal order vs landing order — do the two orders genuinely disagree?
>   Name at least two events that are glimpsed early and still open while
>   three or more later-revealed visions land ahead of them. The correlation
>   must come in **≤0.6**, and with only three slots there is little slack:
>   the shipped weeks sit around 0.55, so a timeline that reads "roughly in
>   order" will fail.
> - peak concurrent pending (must be exactly 3 — never 4); share of the week
>   at 2+ pending (want ≥65%) and at 3 pending (want ≥40%)
> - the funding conflicts, by name
> - lead spread min…max (want ≥2.5×); largest gap between reveals (want ≤0.15)
>
> If any check fails, change the `leadTime`s and redo the table. Do not
> proceed to the prose until it passes — this is not a formality, it is the
> difference between a trading week and a reading-comprehension quiz.
>
> **4. Texts.** For each event write the pair:
> `visionText` — one plain sentence, **under ~110 characters**, stating the
> coming event with identity withheld: never a company name, never a direction,
> never an implication, no riddle-prose, no scene-setting clauses; it must
> contain the **handle** (role, trade, input, geography) that lands on some
> description. Spread across the specificity ladder: 0
> free-trade visions, at most 1 that names-by-unique-role with arguable
> direction, 3-5 that fit exactly one company, 4-6 that narrow to 2-3
> candidates (the heart of the game), 2-3 sector/macro-wide where *sizing* is
> the skill.
> `headlineText` — the wire-copy report shown once it lands, **under ~120
> characters** (a flash, not a story); concrete figures welcome; specific
> names allowed (the market has already repriced); clipped fragments welcome.
> **Voice throughout: deadpan wire.** However absurd the premise, report it
> with a straight face — comedy lives in the facts and in at most one dry
> kicker per headline ("Choirs: four."), never in excited prose or a vision
> that winks. Visions stay plain full sentences.
> Also write `debrief.summary` (the week's narrative, 100-200 words, one
> clause per outcome) and each impact's `explanation` (**1-2 sentences**: the
> causal chain, citing the cast-sheet fact that made it deducible).
>
> **4a. Variance (see `docs/SCENARIO_AUTHORING.md` §6a).** The same week is
> replayed, so the *close* varies, not just the path. Emit at minimum:
>
> - `"variance": { "magnitudeBand": [0.5, 1.0] }` at the top of the private
>   file. It multiplies every authored magnitude, so the number you wrote is the
>   ceiling and half of it is the floor. Pin an impact with
>   `"magnitudeBand": [1, 1]` wherever exact cancellation is the point — a trap
>   built from equal and opposite impacts is not a wash once each leg draws its
>   own multiplier.
> - `"incidence"` on **6-10 secondary ripples**: a probability in `(0, 1]` (0.4-0.75
>   is the useful range) for `supplier` / `customer` / `competitor` / `sector` /
>   `macro` impacts, so which names a story touches varies run to run. **A
>   `direct` impact may never carry one** — it always fires, or the vision lied.
>
> Because of the band, the debrief prose has two new rules: **never quote a
> percentage** ("up seventeen percent" stops being true) and **never crown a
> winner** ("won the week" is a claim the draw can falsify next to a table that
> shows otherwise). Describe what a name *did* — climbed, gave it all back,
> round-tripped — never where it finished in the ranking.
>
> **5. Fair-play audit (do not skip).** For every affected company of every
> event, name the exact description fact or earlier vision/headline a careful
> player would use to reach it. Any impact you can't ground: add the missing
> fact to a description or delete the impact. Then read the cast alone and
> check the reverse: if the descriptions alone telegraph the week's events,
> redistribute specificity until they don't.
>
> **6. Emit two JSON blocks** exactly matching `docs/SCENARIO_AUTHORING.md`:
>
> `<id>.public.json`: `{schemaVersion: "3.0", id, title, description` (menu
> hook), `seed` (any integer), `startingCash: 100000, durationSeconds: 600,
> timeline` (from stage 0; omit for the trading week), `companies: [{companyId,
> name, sector, description, openingPrice}], metadata:
> {generatedAt, author, reviewed: false, tags}}`
>
> `<id>.private.json`: `{schemaVersion: "3.0", id, variance: {magnitudeBand},
> companies: [{companyId, volatility}]` (0.009-0.021, every public company
> present), `marketEvents: [{id, eventTime, leadTime, severity,
> reactionProfile, visionText, headlineText, affectedCompanies: [{companyId,
> direction, magnitude, causalRole, incidence?, explanation}]}],
> debrief: {summary}}`
>
> Slots and segments (`threads`, `slots`, per-event `segment`, `debrief.opening`
> / `closing`) are a **second pass**, not part of a first draft — write the week
> straight, play it, then carve two slots out of it following §6a.
>
> The public file must contain **no** event data, no volatilities, no hints of
> direction — it is exactly what the player sees.

---

## Premise shelf

Starters that produce good weeks — each has an obvious surface and a
non-obvious payout underneath:

- **The approval.** A blockbuster appetite-suppressant drug clears regulators.
  Snack makers, gyms, airlines (lighter passengers, really), insurers, and the
  drugmaker's contract manufacturer all reprice at different speeds.
- **The contagion.** A mid-size lender fails over the weekend. Who actually
  holds its paper, who processes its payroll, who picks up its customers.
- **The blockade.** A strait closes to shipping. Ocean carriers, air freight,
  oil, an importer with concentrated exposure, and the insurer who wrote the
  hulls.
- **The cascade.** Two satellites collide; the debris field grounds a
  constellation. Launch providers, the rival constellation, orbital insurers,
  rural telecoms.
- **The harvest.** Drought plus an export ban reprices grain. Food processors,
  fertilizer, a brewer, the railroad that hauls it.
- **The verdict.** A right-to-repair law with teeth. Device makers, parts
  distributors, repair chains, the extended-warranty racket.
- **The strike.** The first walkout at a company everyone thought was
  automation-proof — and the staffing, robotics, and rival names around it.
- **The cable.** An undersea data cable is severed. Cloud regions fail over,
  satellite bandwidth spikes, a call-center economy goes quiet.
- **The switch.** A grid operator mandates emergency demand response. Battery
  storage, aluminum smelters, crypto miners, backup-generator makers.
- **The quiet week.** No crisis at all: five earnings reports, guidance cuts
  and raises. Every vision is level-5; the whole game is sizing. (Expert.)

Rotate structures too, not just topics: week-001 is "infrastructure boom eats
itself", fire-nation is "the obvious trade round-trips; the toll-takers get
paid". Other shapes:
a slow-motion failure everyone sees coming (the skill is timing, not
identification), a rumor week where early visions set up later reversals, a
two-track week where two unrelated stories compete for the same capital.

Whatever the shape, the *timing* discipline in stage 3a is not one of the
variables — every week needs the contested book. Vary what the visions are
about, not whether the player can afford them all.

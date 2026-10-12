# Scenario Authoring Guide

A scenario is a week of the near future: a timeline of **events** and the hidden
market truth behind them. The player sees each event as a one-line **vision**
some time before it lands, and trades on what they infer. A scenario lives in two
JSON files under `content/scenarios/<id>/` and is registered in
`content/scenario-index.json`.

Each scenario ships its own **cast**: the companies, their names, and — most
importantly — their one-line descriptions all live in the scenario's public
file. There is no shared roster. This is what lets a week field exactly the
companies its story needs (a movie studio for an awards-season week, a grain
trader for a drought week) instead of bending every premise around the same
fixed list.

The game loads scenarios as **data** — you never touch code to add one.

---

## 0. The fair-play rule

The single law everything else here serves:

> **Every deduction the week asks for must be reachable from what the player
> can see: the cast descriptions, the vision text, earlier visions and
> headlines of the same week, and common knowledge. Nothing may hinge on a
> fact that surfaces for the first time in the debrief.**

This is the classic detective-fiction contract: the reader must have seen every
clue before the reveal. Hard is fine — *unknowable* is not. If an event docks a
company because "some of its parts are fabricated there," the cast sheet must
have said so ("fabless — its chips are built by outside contract fabs"). If a
vision distinguishes an air shipper from an ocean shipper, the descriptions
must draw that line ("owns cargo jets and van fleets, and not a single ship").

The corollary: **never rely on the real-world analog.** Players will notice
that Orchard rhymes with a real fruit company — that's flavor, and it may
reward intuition, but no deduction may *require* the mapping. The fictional
universe has to be self-sufficient: if the trade needs the company to have a
famous hands-free driving system, its description says so.

The audit that enforces this is §8's first checklist item.

---

## 1. Files

```
content/
  scenario-index.json                # lists scenarios shown on the menu
  scenarios/
    week-001/
      week-001.public.json           # what the player sees: cast + prices + metadata
      week-001.private.json          # the hidden truth (event timeline + debrief)
```

To add `week-003`: create the folder, write the two JSON files, add an entry to
`scenario-index.json`, then validate (below).

---

## 2. Public schema (`*.public.json`)

Everything here is visible to the player. **It must not contain any hidden
gameplay data** — no event timeline, severities, impacts, or vision text.

```jsonc
{
  "schemaVersion": "3.0",
  "id": "week-001",
  "title": "The Buildout",
  "description": "One-line hook shown on the menu.",
  "seed": 1337,                 // integer; drives all deterministic randomness
  "startingCash": 100000,
  "durationSeconds": 600,       // real seconds for the whole run (~8-12 min)
  "timeline": { "kind": "trading-week" },  // optional — the fictional span (§2b)
  "companies": [
    {
      "companyId": "helix-compute",     // stable kebab-case id, unique in the file
      "name": "Helix Compute",
      "sector": "Semiconductors",       // short tag shown next to the name
      "description": "Designs the AI accelerator chips every data center is fighting over; fabless, so the parts are built for it by outside contract fabs.",
      "openingPrice": 118.0
    }
    // ...12-15 companies (12-14 fits the market list unscrolled)
  ],
  "metadata": {
    "generatedAt": "2026-07-19",
    "author": "you",
    "reviewed": true,
    "tags": ["ai-infrastructure"]
  }
}
```

### 2a. The cast

The cast is not a backdrop — it is the puzzle board. The player reads these
descriptions in the market list all week and solves every vision against them.
Design the cast and the events **together**: events tell you which facts the
descriptions must carry; descriptions tell you which hedges and traps are
available.

**Every company earns its slot with a role:**

| Role | What it's for |
|---|---|
| **Payoff** | An event resolves onto it. Most of the cast. |
| **Foil** | The plausible-but-wrong read of some vision. A level-4 vision needs its foil on the board, with a description that genuinely fits — foils are why hedging is a real decision. |
| **Trap** | Looks like a winner, nets flat or worse (`expectations` / `overreaction` / `neutral` wash). |
| **Decoy** | Untouched all week. Keep 2-3, with descriptions juicy enough that they still get read. |

If a company is none of these, cut it. A tight cast of 12-14 beats a padded 18.

**Rules for descriptions:**

- **One line, 30-160 characters** (the validator enforces both), carrying **2-3
  concrete facts**: what it sells, who buys it, a key input or dependency, a
  distinguishing capability. Facts are the units of deduction — "logistics
  company" grounds nothing; "owns cargo jets and van fleets, and not a single
  ship" decides a port-strike trade.
- **Write to ~85-120 characters — 160 is a ceiling, not a budget.** The
  description is re-read in a moving market list all week; past two rendered
  lines it stops being scanned. Chain clipped facts with semicolons ("Mines
  coal far from the capital; fuels Fire Navy steamships. Machines, not
  benders.") rather than threading them through relative clauses. Cut every
  word that isn't a fact.
- **Capabilities, not consequences.** "Refines jet fuel and diesel" is a fact
  the player can reason FROM. "Benefits when fuel prices spike" is the game
  playing itself. Never state what a fact implies.
- **Uniform specificity.** If only the companies with events get vivid
  descriptions, the cast telegraphs the week. Every description — decoys
  included — gets the same density of concrete detail, so no line glows.
- **Distinct where it matters.** When two companies share a sector, their
  descriptions must draw the line a vision might cut along: boat freight vs air
  freight, tracking-based ads vs intent-based ads, combustion trucks vs EVs.
  If the difference decides a trade, it is never a concealed detail.
- **Read the cast alone before writing visions.** If you can already guess
  three of the week's events from the descriptions, redistribute specificity.

**Continuity is convention, not schema.** Recurring names (Orchard, Hearth
Coffee, Atlas Cloud...) make the universe feel persistent and let running
rivalries develop — reuse them freely by copying their entry from a previous
week and re-tuning the description's emphasis toward this week's facts. Add
facts, drop facts, but never contradict an established one (if the UA-9 was
"awaiting sign-off" in week-001, week-002 may certify it — it may not have
"flown for years"). Check earlier scenarios before renaming or reinventing.

### 2b. The timeline

A scenario may declare the fictional span it covers. Omit the block and it is
the classic trading week — every existing scenario runs unchanged.

```jsonc
"timeline": { "kind": "trading-week" }   // default: Mon-Fri, 9:30-4:00
"timeline": { "kind": "days",   "count": 3 }   // Day 1..N, intraday clock
"timeline": { "kind": "weeks",  "count": 8 }   // W1..WN, weekday texture
"timeline": { "kind": "months", "count": 6 }   // Jan..N, synthetic dates
```

Any kind may carry `segments` instead of `count` — its own axis labels, used
verbatim (`"segments": ["Sozin", "Azulon", "Ozai"]` gives a themed three-month
year). The validator warns past 12 segments; the header axis gets cramped.

**The timeline is wallpaper, not physics.** `eventTime`, `leadTime`, reaction
spans, urgency, scoring and every rule in this guide stay fractions of [0,1]
whatever the span says — a finale at 0.88 lands late Friday in a week and
mid-December in a year. `durationSeconds` is likewise independent: a six-month
saga can still be a ten-minute run. Pick the span the premise wants — a
contagion plays in days, a harvest in a season — and let the prose (visions,
headlines, debrief) speak that span's language, because nothing else will.

## 3. Private schema (`*.private.json`)

The hidden truth. Server-only in a future multiplayer build.

```jsonc
{
  "schemaVersion": "3.0",
  "id": "week-001",
  "companies": [
    { "companyId": "helix-compute", "volatility": 0.012 }  // noise amplitude, fraction of price
    // every public company needs a private entry (volatility optional, default 0)
  ],
  "marketEvents": [
    {
      "id": "ev-helix-deal",
      "eventTime": 0.24,            // 0-1: when the event HITS the market (hidden)
      "leadTime": 0.12,            // 0-1: the vision appears at eventTime - leadTime
      "severity": "critical",     // minor | major | critical  (shown as a tag)
      "reactionProfile": "gradual", // how the price moves once it lands (see below)
      "reactionSpan": 0.18,        // optional: override the profile's default window
      // Shown from reveal until the event lands. A plain sentence that names the
      // company's ROLE but never the company, and never states direction or
      // implication. See section 3a.
      "visionText": "The maker of the most sought-after AI accelerators will lock a major cloud buyer into a priority deal.",
      // Replaces the vision the moment it lands. May be fully specific — the
      // market has already repriced, so it gives nothing away.
      "headlineText": "Helix Compute signs a multi-year priority-allocation deal with a major cloud operator.",
      "visibleInDebrief": true,    // optional, default true
      "affectedCompanies": [
        {
          "companyId": "helix-compute",
          "direction": "positive",   // positive | negative | neutral
          "magnitude": 0.75,         // 0-1: scales the severity band (see §4)
          "causalRole": "direct",    // direct|supplier|customer|competitor|sector|macro|expectations
          "explanation": "Shown in the debrief — the causal chain."
        }
      ]
    }
  ],
  "debrief": {
    "summary": "The week's narrative, revealed at the close."
  }
}
```

### What the player sees vs. infers

The vision feed shows **only** `severity`, `visionText`, and a fuzzy urgency
label. `eventTime`, `leadTime`, `magnitude`, and — crucially — `affectedCompanies`
stay hidden until the debrief. That inference is the game.

---

## 3a. Writing the vision / headline pair

Every event carries **two** texts, and the feed swaps one for the other:

| Field | Shown | Register |
|---|---|---|
| `visionText` | from reveal until the event lands | A hazy premonition. Images, fragments, things half-seen. |
| `headlineText` | the moment it lands, replacing the vision | Sober news copy reporting what actually happened. |

The headline may be fully specific — it may name the company — because by the time
it appears the market has already repriced and the information is worthless for
trading. Its job is the *"so that's what that meant"* payoff, and to teach the
player how to read the next hazy vision.

### The vision: a plain sentence that withholds the name

A vision is a clear statement of a coming event with the identity filed off. It is
**not** a poem. Write it in plain language, then replace the company name with the
thing that identifies it — its role, its trade, what it makes, who it sells to.

The single inference the player owes you is *"which company is that?"* — plus the
ripples. Don't stack extra riddles on top of that.

```
NEVER         "Foundry One's fab will be hit and production stops."
              -> names the company and states the outcome; free money

NEVER         "A chip company will have a fire and sell less."
              -> the cartoon version: an event plus its implication, spelled out

TOO CRYPTIC   "Glass on the floor of a room that was supposed to be clean.
               An alarm no one silences, and a sky lit up over a coastline."
              -> readable as poetry, not as information; the player is
                 decoding imagery instead of reasoning about a market

GOOD vision   "The advanced fab the whole industry queues for will be hit
               in an overnight strike and go dark."
GOOD headline "Foundry One's primary fab struck in an overnight military
               attack; production halted indefinitely."
```

The good version says plainly what happens. The work left to the player is real
but bounded: *which* fab has the industry been queuing for (an earlier vision said
someone was booked solid), and who gains when it goes dark.

### Rules for visions

- **Never name a company.** Not once — this is the only hard identity rule.
- **Always point at it.** If an event hits a specific company, the vision must
  contain the handle that identifies it: "the contract fabricator most advanced
  chips run through", "the world's coffee houses", "one foot in retail and one in
  cloud". A vision floating free of any company is unsolvable, not hard.
- **The handle must land on the cast sheet.** A handle only works if the matching
  fact is IN a company's description (or was established by an earlier vision or
  headline this week). Write the vision, then check the description it points at;
  if the fact is missing, add it to the description — never leave it implicit.
  This is the fair-play rule (§0) applied sentence by sentence.
- **Never state the implication.** No "demand will soar", "costs will rise",
  "shares will fall". Describe the *event*; the consequence is the player's job.
- **Never state direction.** Good news and bad news should read the same way.
- **Stay plain.** One sentence, ordinary words, ordinary syntax. If it reads like
  a riddle, a horoscope, or a poem, rewrite it. Difficulty should come from the
  economics, never from parsing the prose.
- **Keep it under ~110 characters.** The card is read against a moving tape,
  often stacked three deep in the feed. One handle, one event — no scene-setting
  clauses, no second flourish. If a phrase is neither the handle nor the event,
  cut it. A vision that takes two reads costs the player the trade it points at.

The target feeling is **"I think I know, but I'm not certain."** Not "obviously
Helix," and not "could be any of twelve companies," and above all not "what am I
even reading."

### Rules for headlines

- Report, don't editorialise. A wire-service sentence, past tense or present.
- Concrete figures are good — they make the reveal land ("destroys an estimated
  38% of the arabica crop").
- Still no investment implication. "Green-coffee futures limit up" is a fact;
  "bad news for coffee chains" is doing the player's work for them.
- It should make the vision obvious **in hindsight**. If a player reads the pair
  and can't see how the vision pointed there, the vision was too vague.
- **A wire flash, not a wire story — stay under ~120 characters.** Name, fact,
  figure, done. The full mechanics belong in the debrief explanations, which are
  read at leisure; the headline lands mid-game, on a tape that is already moving.

### Voice: the tape is deadpan

However absurd the universe, the wire reports it with a straight face. Comedy
lives in the facts themselves and in **at most one dry kicker per headline** —
"Choirs: four.", "Reviews: mixed.", "sea prunes declared contraband" — never in
excited prose, exclamation marks, or editorial winking. Clipped wire fragments
("Boardings, seizures, forced turnarounds") belong in headlines only; visions
stay plain full sentences even when the event is ridiculous, because the player
is parsing them under a clock.

### Explanations and the debrief are captions, not essays

Each impact's `explanation` is **1-2 sentences**: the causal link, the
cast-sheet fact that grounded it, at most one flourish. The `debrief.summary`
is a single tight paragraph — every major outcome earns one clause, not one
paragraph. These are read at leisure, but leisure is not an invitation.

### The specificity ladder

Every vision sits on this ladder. Aim for a spread, weighted to the middle.

| Level | What the player can tell | Budget per scenario |
|---|---|---|
| 1 | Names the company *and* implies direction | **0** — this is a free trade, never ship one |
| 2 | Names the company; direction is genuinely arguable | at most 1, as an anchor |
| 3 | Unnamed, but the role fits exactly one company | 3-5 |
| 4 | Unnamed, narrows to **2-3 plausible candidates** | 4-6 — the heart of the game |
| 5 | Sector- or macro-wide; identity is easy, *sizing* is the skill | 2-3 |

Level 4 is the one to write most of. It's what makes hedging a real decision:
split across both candidates for a smaller, safer gain, or commit to one read and
take the whole move. Both should be defensible.

### Vagueness has a floor

Vague does **not** mean unfalsifiable. A player who thinks carefully must be able
to reach a defensible shortlist from the text alone. Every vision needs at least
one concrete, checkable hook — an industry, an input, a geography, a business
model, a role in a supply chain. Strip that out and you've built a coin flip.

```
too legible   "Hearth Coffee will face higher bean costs."
              -> the trade is already made
GOOD          "A hard frost will take the highland harvest that the
               world's coffee houses depend on."
              -> plain sentence; the handle is "coffee houses"
              -> left to the player: which listed company is one, and
                 whether a crop failure helps or hurts a buyer of it
too vague     "Something bad will happen to a crop somewhere."
              -> no handle; unresolvable
```

### Deliberate misdirection is fair; lying is not

A vision may invite a wrong-but-reasonable first read, as long as the correct read
is available in the same text. Every vision still describes a real future event —
there are no false visions. The difficulty comes from *inference*, never from the
feed being unreliable.

### Give hedges somewhere to go wrong

If a level-4 vision points at two candidates and only one is affected, the hedger
gives up some upside — that is the cost that makes committing worthwhile. So the
plausible-but-unaffected candidate should be a real company on the board, not a
strawman. This is what the untouched decoys are *for*.

---

## 4. How an event moves the market

Each affected company's price is nudged by:

```
impact% = sign(direction) × magnitude × SEVERITY_AMP[severity]
```

| Severity | Band (`magnitude = 1`) |
|---|---|
| `minor` | ±5% |
| `major` | ±14% |
| `critical` | ±30% |

So `critical` + `magnitude 0.8` ≈ **+24%**; `major` + `magnitude 0.5` ≈ **+7%**.
`neutral` direction contributes nothing — use it for a "wash" trap where a vision
sounds relevant but nets flat.

These bands are roughly double what a real tape would do, and that is deliberate.
A realistic week is a boring week: if reading a vision correctly earns 3%, being
right doesn't feel like anything. Author for the swing.

**Impacts stack.** A company hit by several events sums them, so a name can be
pushed up by two clues and dragged down by a late shock (see Foundry One in
week-001: it spikes on "sold out," then craters on a fab strike — a ~29-point
round trip). Final closes are emergent — there is no `targetPrice`.

Aim for a spread of outcomes: a few clear winners (~+15-25%), several losers, one
or two **fair traps** (an `expectations`/`overreaction` name that looks better
than it is, or a `neutral` wash), and a couple of untouched decoys.

### Make the player work for it

The failure mode of this game is a scenario where every vision names its own
company and direction. Then the strategy is just "read the name, go all in," and
there is nothing to be good at. Most events should pay out through one of these
instead:

| Kind | What it looks like |
|---|---|
| **Indirect** | The vision names company A; the trade is company B. "Foundry One is booked solid" → the buy is *Meridian*, the second source. |
| **Sector-wide** | One event hits many names at different sizes. The skill is *sizing*: the ad-privacy ruling hits Agora at 0.7 and Searchlight at 0.3, because one depends on third-party tracking and one has first-party intent data. |
| **Second-order** | The consequence is a step removed. A port strike is bad for a hardware importer *and good for a freight operator*, because closed sea lanes reroute cargo at premium rates. |
| **Counter-intuitive** | The obvious sign is wrong. An export quota on battery metals *helps* the legacy automaker, whose combustion mix is insulated while its EV rival's costs blow out. |
| **Arbitrary** | Unconnected to the week's main plot. A frost ruins the coffee harvest. It rewards players who trade every vision, not just the ones that fit the story. |
| **Self-undermining** | A company's own good news creates its later headwind. Atlas announces record data-center capex, then gets squeezed by the power costs and grid delays that buildout causes — and finishes *down* on the week. |

A useful gut check: the biggest winner of the week should ideally be a company
that **no vision ever names**. In week-001 that's Meridian Chips, which simply
stands next to a maxed-out competitor and then a destroyed one.

Indirect is not unknowable — every one of these kinds still passes the
fair-play rule (§0). The port strike pays the freight operator because its
description says it owns cargo jets and no ships; the metals quota helps the
legacy automaker because its description says its profit is combustion trucks.
Each link in the chain is a fact the player was given; the *chain* is what they
build themselves. If a link needs a fact the cast sheet doesn't have, add the
fact or cut the impact.

---

## 5. Timing & urgency

- `eventTime` — where in the run (0 = the open, 1 = the close; Mon 9:30 → Fri
  4:00 on the default week) the event hits and the price starts moving. All
  timing in this section is a fraction of the scenario's span (§2b), so these
  rules hold for a three-day crisis and a six-month saga alike.
- `leadTime` — how far ahead of that the vision appears. Must be `> 0` (you have
  to see it *before* it happens) and `≤ eventTime` (it can't reveal before the
  week starts).
- **Urgency is automatic, and it is absolute.** A pending vision reads "soon"
  inside the final **0.075** of the run before its landing and "imminent" inside
  **0.045** — however long its lead was. The board's heat ramp works the same
  way (it rises across the final **0.3**, and only ignites into glow and tremor
  in the last **0.06**), so of two pending visions the hotter one always lands
  first, whatever their leads were.
- **Every live vision stays readable.** Heat is urgency, never legibility: a
  vision glimpsed half a week out is cool but fully legible, because a vision
  the player cannot read is not a thesis they can hold. Do not author around a
  "quiet" period where a long-lead vision is meant to be ignorable — there
  isn't one.

### Contested capital: the concurrency profile

The week's real game is allocation, and it only exists while the book is
**contested**: several visions pending at once against one cash-only book, so a
new reveal forces the player to cut a position they still believe in to fund
it. Visions arriving single-file — decode one, position, wait for it to land,
repeat — is a stock-picking quiz wearing a trading UI. Author the timeline so:

- **Two or three visions are pending simultaneously through the mid-week**,
  never four. Sweep progress 0→1 counting revealed-but-unlanded visions: it
  should sit at 2+ for most of the run and touch 3 repeatedly (week-001, the
  reference, is 2+ for **65%** of the run and 3-deep for **54%**). The
  validator warns if the count never reaches 3 — and, at the other end, if it
  ever exceeds 3.

  **Three is a cap on the player, not on the pixels.** The board places six
  cards without a collision, and an earlier pass authored 4–5 concurrent on
  that basis. It played worse: a player tracks three open theses and ranks
  them, and everything past the third is read as texture — so the week became
  three real decisions plus decoration, with the decoration stealing the
  attention that the real ones needed. Fewer, better-contested visions beat a
  fuller board.
- **Visions must not resolve in the order they were revealed.** This is the
  rule that decides whether the week trades at all, and it is easy to satisfy
  the concurrency target while failing it. If the next thing to land is always
  the next thing glimpsed, the optimal play stays *back the newest read, wait
  for it, recycle the cash* — a queue with a crowded board drawn on top. The
  queue has to be **jumped**: a thesis you opened early is still unresolved when
  a later-revealed vision lands first, so funding that one means selling
  something you still believe in. The validator measures this as the
  correlation between reveal order and landing order and warns above **0.6**;
  the shipped scenarios sit near **0.55**. Achieve it by giving several
  late-landing events long leads, so they are glimpsed early and hang over the
  whole middle of the week while short fuses land through them.

  Expect to spend most of your slack here. A discordant pair needs two visions
  open *at the same time*, so capping the board at three also caps how far the
  landing order can depart from the reveal order — around **0.5** is the floor
  for a twelve-event week, not a comfortable target. The shape that gets there
  is **two long theses hanging over a run of short fuses**: with two of the
  three slots held by half-week positions, every fuse that lands does so ahead
  of both of them.
- **Leads are *varied*, not uniform.** Mix three registers: short fuses
  (**0.05–0.08**) that demand action now, mid leads (**0.10–0.18**), and long
  theses (**0.25–0.45**) that stay open on the board while faster stories
  resolve through them. Uniform leads make reveals and landings interleave in
  lockstep and the book never actually stacks — the validator warns when all
  leads sit within a 2× band. (The old fear that a long lead "drains tension"
  was an artifact of one-at-a-time authoring: a long lead on a *contested* book
  isn't slack, it's a position that must keep justifying the capital it ties up.)
- **Nothing is glimpsed before the premise is established.** The opening event
  should reveal first and get a beat to itself. A vision whose handle is "the
  candidate's face" is unreadable if it surfaces before anyone has announced a
  candidacy — fair play (§0) applies to reveal order too.
- **Author deliberate funding conflicts, at least twice a week:** a
  high-conviction *short-fuse* reveal that arrives while the player is fully
  deployed on earlier reads. With a three-slot board this is the normal case
  rather than a special one — in week-001 every reveal after the first two
  arrives with exactly two theses already open, so it always takes the last
  slot. The cleanest is the Helix deal: glimpsed at 0.15 with only 0.05 of
  runway, against power-costs and battery-metals, both of which run past 0.50.
  You cannot fund it from idle cash and you cannot wait — something you still
  believe in has to go. What gets cut is the interesting mistake.
- **Keep the drip going.** Distinct from dead air: a long stretch with no *new*
  vision is a lull even while older theses are still open, because nothing is
  competing for the money that a landing just freed. Keep gaps between
  successive reveals under ~0.15 (week-001's largest is 0.08 — with three slots
  the drip is mostly self-enforcing, since a landing that frees a slot and
  leaves it empty is exactly the lull).
- **No dead air.** Any window where zero visions are pending for more than a
  few percent of the mid-week is a lull. Leave ~8-10% of tail after the last
  event fully prices in, so late trades can play out before the bell.

#### The reference profile (week-001)

Sorted by **reveal**, showing how far the landing order departs from it. The
long-dated theses are glimpsed early and hang over everything; the short fuses
land through them.

| glimpsed | lands | lead | event |
|---|---|---|---|
| 0.02 | 0.08 | 0.06 | atlas-capex — the premise, alone on the board |
| 0.08 | **0.50** | 0.42 | power-costs — open across the whole first half |
| 0.13 | **0.58** | 0.45 | battery-metals — the second standing thesis |
| 0.15 | 0.20 | 0.05 | helix-deal — *funding conflict, takes the last slot* |
| 0.20 | 0.27 | 0.07 | ad-privacy-ruling |
| 0.27 | 0.33 | 0.06 | networking-backorder |
| 0.33 | 0.38 | 0.05 | foundry-soldout |
| 0.38 | 0.44 | 0.06 | port-strike |
| 0.45 | **0.90** | 0.45 | foundry-strike — takes over as the long hold |
| 0.50 | **0.78** | 0.28 | fuel-spike |
| 0.58 | 0.64 | 0.06 | transformer-shortage — *funding conflict* |
| 0.64 | 0.70 | 0.06 | supplier-diversify — *funding conflict* |

Read the two columns as lists and they disagree everywhere: power-costs is
glimpsed second and lands seventh, with five later-revealed visions resolving
before it, and battery-metals is glimpsed third and lands eighth. That
disagreement is the week.

The shape is deliberate and worth copying: **two long theses occupy two of the
three slots at any moment**, so the third slot turns over every ~0.06 as one
fuse lands and the next is glimpsed. Every reveal from 0.15 on lands in a board
that already has two positions on it.

#### Verifying a timeline

The validator covers the mechanical half; these are the numbers to check
yourself before shipping:

| check | target | week-001 |
|---|---|---|
| reveal-vs-landing correlation | ≤ 0.6, aim ~0.5 | 0.55 |
| peak concurrent visions | exactly 3, never 4 | 3 |
| week held at 2+ pending | ≥ 65% | 65% |
| week held at 3 pending | ≥ 40% | 54% |
| funding conflicts | ≥ 2 | every reveal after 0.13 |
| lead spread (min…max) | ≥ 2.5× | 0.05…0.45 (9×) |
| largest gap between reveals | ≤ 0.15 | 0.08 |
| dead air (zero pending, mid-week) | none | none |

None of this changes the fair-play rule or the instant gap: contention comes
from timing pressure, never from visions the cast sheet can't support, and
being early off the vision stays the only pre-event edge — the density just
makes *which* early positions you hold the hard part.

**Play the week to the close: land the finale at 0.85-0.92.** A last event at
0.75 strands the player in a fifth of a week with nothing left to infer — Friday
becomes a waiting game, and waiting is the one thing this game must never ask.
Late enough that the final day still carries news, early enough that the ring-out
settles before the bell. The validator warns when the last event lands before
0.85.

---

## 6. Reaction profiles

**Every** event gaps instantly and then has a second wave — but the wave can run
in either direction. A landed event is never a smooth ramp to the truth. Either
the tape gaps *past* what the news is worth and has to come back:

```
        gap lands ABOVE fair
          ╱╲
         ╱  ╲      ╱‾╲___________  fair value (1.0)
────────╯    ╲__ ╱
   ↑          ↑        ↑
 event    correction  settled
```

...or it gaps *short* of it and still has ground to cover:

```
                      ______________  fair value (1.0)
                 ____╱
         ╱‾‾‾‾‾╱
────────╯
   ↑          ↑             ↑
 event   still pricing   settled
```

Both land on exactly the same close. Which one you get is drawn per run, and a
player cannot tell them apart at the gap — fair value is hidden, so a gap to
+7% is either an over-reaction to a +5% move or an under-reaction to a +14% one.

The gap itself is the game's main defence against "wait for the news, then trade
it." It is **near-instant and the same for every event** — the tape reprices in
about a third of a second at 1× (less at 2×/4×), which is faster than you can read
the headline that lands on the same tick and click. What you *can* do is judge
whether the price it gapped to is rich or cheap against what the vision implied
the news was worth — and that judgement is the only post-headline edge there is.
Being positioned *before* the headline is still the best trade in the game.

What follows the gap is the **aftermath**, and you do not author it. It is drawn
per *run* from a library of eight archetypes (`src/domain/market/aftermath.js`),
so the same event lands differently every time the week is replayed.

The library has **two families**, and the split is the whole point:

**Over-reaction** — the gap prices in *more* than the news is worth, and price
comes back down to fair. The play is to fade it.

| Archetype | What the tape does |
|---|---|
| `fade` | Overshoots, rings back **through** fair value once, settles. |
| `deadCat` | Retraces until it looks finished, then a second leg out. Never crosses fair. |
| `continuation` | No give-back — keeps running past the print before the long return. |
| `grind` | Gaps slightly rich and sits. Nothing to trade. |
| `chop` | Several crossings, slow damping. The turn is unpickable. |

**Under-reaction** — the gap prices in only *part* of the news, and price still
has to travel. The play is to trade *with* it.

| Archetype | What the tape does |
|---|---|
| `drift` | Gaps 40–60% of the way, then grinds monotonically to fair. No dip, no second chance. |
| `stairs` | Takes the news in two or three legs, pausing at each long enough to look finished. |
| `lateSurge` | Gaps small and sits like a dead name, then moves late. |

A rare **head fake** modifier can precede any of the eight: the tape first prints
the *wrong way* for a few seconds before repricing to the true level.

If the library only over-reacted, "fade the print" would be a mechanical rule
that pays — the free lunch the archetypes exist to remove. With both families no
fixed rule works, and the edge moves to judging *what the news was worth*.

### What decides which one you get

Two things you author, neither of which is a lock:

- **`severity` tilts the family.** `critical` leans over-reaction, `minor` leans
  under-reaction, `major` is neutral. Loud news over-reacts; technical news gets
  absorbed slowly. This gives the player a heuristic worth learning and never
  worth trusting completely.
- **`reactionProfile` weights the shape** within whichever family came up.
  `volatile` leans chop and continuation; `gradual` leans grind, fade and drift;
  `delayed` leans dead cat and lateSurge.

The family flip is an **independent coin per event** — there is no quota. A
ten-event week can come out 7/3 over, or 9/1, or even. That variance is
deliberate; balancing it across the run would let a player count cards.

Three consequences worth holding onto while authoring:

- **You cannot promise a specific post-event path in your debrief copy.** Write
  about the event and its causes, not about "the dip that followed" — on half
  the runs there was no dip.
- **You cannot assume which way the tape leans first.** An event can gap past
  its true impact or fall well short of it. Both are normal.
- **The end-of-week price is unaffected.** Every archetype in both families
  settles to exactly 1.0 within its span, so the fair close, the scoring, and
  your authored impacts are identical on every run. Only the path changes.

`reactionSpan` can still stretch a single event's *gap* if you deliberately want
one slow-burning story where a late entry works — but by default every event
gaps in the same instant window.

### Turbulence

A company's noise amplitude also swells around its own events (and only its own).
Quiet names stay quiet; a name in the middle of a critical event thrashes, with a
fast chop layered on the baseline drift. It is tuned to leave the dislocation
*visible* — the uncertainty is meant to come from not knowing which archetype you
got, not from noise thick enough to hide the wave. Nothing to author — it derives
from the events you've already written and each company's `volatility`.

---

## 6a. Variance: what changes between runs

Everything in §6 varies the *path* and lands on the authored close. This section
varies the **close itself** — the same week, played twice, can pay differently.
All of it is optional: a scenario that declares none of these fields resolves
exactly as it always did.

The law it all serves (`docs/VARIANCE_ARCHITECTURE.md` §1):

> **Variance may change the answer. It may never change whether the answer was
> reachable — nor whether correct reasoning was rewarded.**

Two consequences you author against: a beat's `visionText` never depends on the
draw, and a `direct` impact always fires. What varies is *how much* and *which
ripples*.

### Magnitude bands — amplified or dud

```jsonc
"variance": { "magnitudeBand": [0.5, 1.0] },        // scenario level

{ "companyId": "helix-compute", "magnitude": 0.75,
  "magnitudeBand": [0.85, 1.0] }                    // per-impact override
```

The band is a **multiplier on the authored magnitude**, never an absolute range.
The authored value stays the ceiling and keeps the meaning §4 gives it, so all
the balance intuitions above survive: `[0.5, 1.0]` means "somewhere between half
and all of what I wrote."

**The floor is load-bearing.** A correct read must always pay something —
otherwise "dud" becomes the same punishment for good reasoning that a
contradictory outcome would be. Start at `0.5`; the validator warns below `0.4`.

`[1, 1]` **pins** an impact at its authored value, and there is one case where
you must: **a designed wash**. A trap built from equal and opposite impacts nets
zero only while both sides scale together — give each leg its own draw and the
"flat on the season" joke pays ±4%. Pin both legs (`caldera-coalworks`,
`cabbage-corp`, `yu-dao-blasting-jelly`, `pockets-pals` are the shipped
examples), or build the wash from `direction: "neutral"` instead, which
contributes nothing whatever the draw.

### Incidence — which ripples land

```jsonc
{ "companyId": "titan-energy", "direction": "positive", "magnitude": 0.45,
  "causalRole": "macro", "incidence": 0.75 }        // fires on 75% of runs
```

A probability in `(0, 1]`, default `1`. An impact that does not fire is removed
before pricing — the event still lands, still prints its headline, just without
that name on it.

**`causalRole: "direct"` must have incidence 1.** The validator makes this an
error, not a warning. If the company a vision points *at* could be left untouched
by a draw, the vision was a lie and the deduction it asked for was a trap. The
direct read stays honest and **the ripples become the variable part**, which is
what the game says it is about.

Contingent ripples are also how a decoy count breathes: a name touched only by
contingent ripples is a real company some weeks and scenery in others.

### Slots and segments — which week you got

A week is **a fixed spine with two or three swappable segments**. Each slot holds
sibling segments; exactly one fires per run.

```jsonc
"threads": ["silicon", "logistics"],   // declared vocabulary; order breaks ties

"slots": [
  {
    "id": "slot-1",
    "window": [0.32, 0.39],            // every sibling's beats land inside this
    "segments": [
      { "id": "silicon-crunch", "thread": "silicon",   "weight": 3,
        "debriefPara": "The bottleneck that week was the silicon itself. …" },
      { "id": "dock-backlog",   "thread": "logistics", "weight": 2,
        "debriefPara": "The bottleneck that week was the dock. …" }
    ]
  }
],

"marketEvents": [
  { "id": "ev-atlas-capex" },                              // no `segment` -> SPINE
  { "id": "ev-foundry-soldout", "segment": "silicon-crunch", "eventTime": 0.38 }
]
```

Events stay **flat**. Membership is one optional field, and slot ids should sort
in the order they run (`slot-1`, `slot-2`) because that is the order paths are
drawn and reported in.

Three rules keep it from sprawling:

1. **Siblings fill the same window.** The simplest way to guarantee it — and the
   one week-001 uses — is to give each sibling beat the *same* `eventTime` and
   `leadTime` as the beat it stands in for. Then every path has an identical
   concurrency profile and §5's whole table is satisfied once rather than four
   times. The validator warns when siblings differ by more than one beat, or when
   their landing spans differ by more than 0.05.
2. **Segments compose across slots.** Segment A must read correctly beside C
   *and* D, because it will. No segment may reference another.
3. **Depth stays at one.** A segment is a straight run of beats, never a tree.

Keep the **event count per path constant**: pulling *n* existing beats into one
sibling means the other sibling is *n* new beats. Two slots × two segments × two
beats is the shipped shape — 8 beats authored, 4 fire, 4 possible weeks.

### Thread-conditional impacts — the finale reads the week

Each segment advances a **thread**. The run tallies them and the winner is the
**dominant** thread (ties break by declaration order in `threads`, so with an
even number of slots the tie-break is a balance decision you are making on
purpose). An impact may name a thread, and then it fires only in the weeks that
earned it:

```jsonc
{ "companyId": "parcelworks", "direction": "positive", "magnitude": 0.35,
  "causalRole": "customer", "thread": "logistics" }
```

This is what keeps the finale live. If the last and largest event were a pure
function of the path, then working out your branch would hand you the week's
biggest move for free — branch-recognition would stop *informing* your
positioning and start completing it. Instead the path narrows the ending and a
draw picks within it. Give the finale one conditional impact per thread so every
week gets an ending, and check the validator does not warn that a thread can
never dominate.

### The debrief, assembled

```jsonc
"debrief": {
  "opening": "The week's engine was a wave of AI data-center spending…",  // always
  "closing": "The last vision of the week put the advanced fab in the dark…"
}
```

The resolved summary is `opening` + the chosen segments' `debriefPara`s **in
landing order** + `closing`, joined into one string. A single legacy `summary` is
still honoured, and is what a scenario without slots keeps using.

**Each `debriefPara` must read standalone**, because it cannot know which sibling
preceded it.

### What the band does to debrief prose

This is the part that catches people, and it applies to *every* scenario the
moment it declares a band — including ones with no segments at all. The debrief
renders next to a table of the week's actual closes, so any sentence the draw can
falsify is a screen contradicting itself.

- **Never quote a percentage.** "up seventeen percent", "minus a quarter" — the
  numbers move. Describe the shape instead.
- **Never crown a winner.** "Year's Supply won the week" is true 71% of the time
  once every impact draws its own multiplier. Say what it *did* ("climbed all
  week"), not where it finished in the table.
- **Watch the sign on round-trippers.** A name pushed both ways by unrelated
  events can finish either side of flat. Claim the legs, never the net.
- Path claims are always safe: "helped and then hurt", "gave it all back",
  "round-tripped its own fear" hold on every draw.

`tests/variance.html` prints each company's lowest and highest close across 500
draws. If a name's band straddles zero, no debrief sentence may state its
direction.

### Checking it

`tests/variance.html` is the instrument. It enumerates **every** path and runs
the full balance suite on each — so a branch that breaks the concurrency
envelope, the finale window or the move bounds shows up as a red cell rather than
in play — then samples 500 draws and reports the *worst* one, plus the per-company
spread that answers "is this week actually different twice in a row?".

The same checks run as pass/fail in `tests/variance.test.js`.

---

## 7. Validate

In the browser, just load the scenario — validation runs at load time and logs
warnings to the console; hard errors throw. With Node:

```bash
node scripts/validate-scenario.mjs week-001
```

The validator checks:

- every company carries a full public identity — `name`, `sector`, `description`
  (30-160 chars) — plus a private entry; names are unique
- every event references a company that exists and has a valid `severity`,
  `direction`, `visionText`, `headlineText`, and timing
  (`0 ≤ eventTime ≤ 1`, `leadTime ≥ 0`, `eventTime − leadTime ≥ 0`)
- prices are positive; at least **three** companies have meaningful (≥3%) moves
- **no hidden fields leak into the public file**

- the variance fields (§6a): `incidence` inside `(0, 1]` and never below 1 on a
  `direct` impact; `magnitudeBand` a `[lo, hi]` inside `(0, 1]`; every `segment`
  and `thread` reference resolving; every segmented event landing inside its
  slot's window

**Balance runs once per possible week, not once per file.** Slots are few, so the
validator enumerates every path the content can produce and runs the whole
balance and concurrency suite on each — messages from a multi-path scenario are
prefixed `path [a + b]:`. A scenario with no slots has exactly one path and reads
exactly as it always did.

Warnings flag soft issues: fewer than 6 events, fewer than 2 untouched decoys,
duplicate descriptions, descriptions too thin to deduce from, any single move
above 35%, a magnitude floor below 0.4, siblings of unequal length or span, a
thread no segment advances or that no path can make dominant, a segment with no
`debriefPara`, and the concurrency profile (§5): pending visions that never stack
3 deep, more than 3 pending at once, leads that all sit within a 2× band, or a
week whose visions resolve in the order they were revealed.

The fair-play rule itself (§0) is **not machine-checkable** — whether a
description truly grounds a deduction is a judgment call. That audit is manual,
and it is the first item on the checklist below.

---

## 8. Human-review checklist

Before shipping a scenario, sanity-check the *fun*, not just the schema:

- **The fair-play audit (§0).** For every `affectedCompanies` entry in every
  event, say out loud which cast description (or earlier vision/headline of the
  same week) a careful player would use to get there. If the answer is "the
  debrief explains it" or "everyone knows the real company it's based on," you
  have a rug pull: add the missing fact to a description or cut the impact.
- **Read the cast alone, before the events.** Can you guess the week from the
  descriptions? Then specificity is lopsided — decoys and foils need the same
  density of concrete fact as the payoffs (§2a).
- **Are two same-sector companies distinguishable in one read?** Wherever a
  vision could cut between them, the descriptions must already draw that line.
- **Does any vision name a company, state a direction, or spell out an
  implication?** Any of the three makes the trade free. This is the single most
  common way a scenario ends up trivial.
- Read each vision/headline pair back to back. Does the headline make the vision
  feel obvious *in hindsight*? If not, the vision had no usable handle.
- Read the visions alone, as prose. Do any read as a riddle or a poem? Difficulty
  must come from the economics, not from decoding the sentence.
- **The scan test.** Read every description, vision and headline at tape speed —
  one glance each. Anything that takes a second read, or pads toward its
  character cap, gets cut, not polished. Compare against a shipped scenario
  (`mormons-go-nuclear` is the register reference) before trusting your ear.
- Score every vision on the specificity ladder (§3a). Is the spread weighted to
  levels 3-4, with nothing at level 1?
- For each vision, write down your shortlist before checking `affectedCompanies`.
  If you can't produce one, it's too vague. If your shortlist has exactly one
  obvious name every time, it's too legible.
- Are there several visions where a **hedge across 2-3 candidates** is a genuinely
  reasonable play?
- Is the dominant interpretation economically coherent?
- **How many events pay out through the company they name?** If it's most of them,
  the scenario is a reading-comprehension test, not a game. Mix in the kinds in §4.
- Is at least one big winner never named in any vision?
- Is at least one event completely unrelated to the week's main plot?
- Does any single company get moved **twice in opposite directions** by unrelated
  events? Those round trips are the most interesting positions to hold.
- Are there one or two **fair** traps (an `expectations`/`overreaction` name, or a
  `neutral` wash that looks like a winner)?
- **Walk the book, not just the timeline.** Play the week in your head with
  $100k: is there a stretch where you're fully deployed with 3+ theses open and
  a new reveal forces you to sell something you still believe in? That moment —
  the funding conflict — should happen at least twice (§5). If every vision can
  be funded from idle cash, the density is decorative.
- **List the visions in reveal order, then in landing order.** If the two lists
  look alike, you have written a queue, not a week (§5) — several late events
  need much longer leads.
- Any dead air — especially at the close? The last event lands at 0.85-0.92; a
  week that ends early leaves the final day a waiting game.
- Does the debrief's summary + per-event explanations account for every major
  outcome, and explain *why* the non-obvious ones moved?
- **Can the draw make the debrief wrong?** (§6a) Read every sentence against
  `tests/variance.html`: a quoted percentage, a "won the week", or a direction
  claimed on a name whose spread straddles zero is a screen contradicting its own
  table. Path claims are safe; net claims mostly are not.
- **If the week has slots:** read each `debriefPara` cold, out of order. Does it
  stand without the sibling it replaced? Then read the four assembled summaries
  end to end — do they read as narrative, or as stitched fragments?
- **Is either branch obviously the good week?** Compare the per-path payout table
  in the report. A draw that is a verdict rather than a variation is the failure
  mode segments have.

# Chrono Trader

A single-player, browser-based **trading game about seeing the future**. A stream
of one-line **event visions** scrolls in — glimpses of things about to happen (a
chip supply deal, a port strike, a frost in the coffee highlands, a fab knocked
offline). You see each one *before the market does*. Work out which fictional
companies it moves and which way, and trade before the price catches up.

A vision states plainly what is coming — it just won't say *who*, or which way it
cuts:

> *The advanced fab that the whole industry has been queuing for will be hit in an
> overnight military strike and go dark.*

Which fab is that? An earlier vision said someone's leading-edge lines were booked
solid for a year. Is this a short — or a buy, for whoever picks up the stranded
orders? Trade it before it happens. When it does, the vision is replaced by what
actually ran:

> Foundry One's primary fabrication complex struck in overnight military attack;
> production halted indefinitely.

Some visions point at two or three plausible names and you decide whether to hedge
or commit. A privacy ruling hits two ad companies at very different sizes and
quietly helps a device maker that sells no ads at all. That fab attack is, of all
things, a cybersecurity trade. Reading the ripple is the game.

And you cannot simply wait and react. When an event lands the tape *gaps* — hard,
in seconds, straight past fair value — then corrects back, often overshooting the
other way before it settles. Buying the print means buying the top. Being early is
the only reliable edge, and selling into someone else's overshoot is the second
one.

> See the week's events before the market does. Trade the gap.

One hand-authored weekly scenario loaded from JSON, no runtime LLM calls,
deterministic replay.

---

## Running it

The app is plain ES modules — **no build step, no npm**. It just needs to be
served over HTTP (ES modules and `fetch` don't work from `file://`).

```bash
cd chrono_trader
python3 -m http.server 4173
# open http://localhost:4173
```

Any static file server works (`npx serve`, nginx, Vercel, Netlify, GitHub
Pages, …). There is no backend.

### Tests

Open **http://localhost:4173/tests/tests.html** in a browser. It runs the unit
and integration suite (60+ tests covering the RNG, event pricing model, market
engine, execution, portfolio accounting, scoring, vision reveal/urgency, calendar,
and the shipped scenario) and prints a pass/fail report. Everything runs
client-side.

If you have Node available you can also validate scenarios from the CLI:

```bash
node scripts/validate-scenario.mjs            # validate every scenario
node scripts/validate-scenario.mjs week-001   # validate one
```

---

## How to play

1. Pick a **scenario** on the title screen — that's the whole setup, and choosing
   one starts the run. You begin with **$100,000**, in every scenario.
2. The simulated week runs Monday 9:30 AM → Friday 4:00 PM in ~10 real minutes at
   **1×**, the pace the scenarios are authored at. You can pause any time, and the
   speed key in the header cycles 1× → 2× → 4× if you want the week to come at you
   faster.
3. **Watch the vision board** (left). Visions surface at scattered points on the
   dark board — each an event you've foreseen, stated plainly, but never naming a
   company and never saying which way it cuts. That's yours to infer, ripples and
   all; sometimes the honest answer is two candidates and a hedge. Nothing is
   labelled: a vision simply grows brighter and more present as its moment
   approaches. **When the event lands, the vision breaks apart and is gone — and
   the concrete headline breaks on the BREAKING NEWS ticker beneath the board on
   the same beat** — so you find out whether you read it right while the week is
   still running. The debrief keeps the full record of every vision/headline pair.
   Visions keep coming while the last is still pricing in, so you're always
   reading the next one under pressure.
4. The **Market** list (right) is the cast sheet: every company carries a
   one-line description — what it sells, who buys it, what it depends on. Those
   lines are the evidence the visions point at; every deduction the game asks
   for is grounded in them. Click a company to trade it. **Buy** what you
   expect to rise, **short** (Sell with no position) what you expect to fall, and
   size it with the **⅛ / ¼ / ½ / Max** presets — fractions of what you can still
   deploy, which stay live as prices move. There's no margin: you trade what you
   have, so conviction is expressed by concentration, not borrowing. Trade *before*
   the vision materializes — once the event lands, the price has already moved.
5. At Friday close (or "Finish week") you get a **debrief**: your return, how
   your theses landed, what each name *offered* against what you took out of it,
   and — for every vision — exactly which companies it moved and why.

You never see an event's exact timing, its size, or which companies it hits until
it happens. Reading the visions is the game.

Moves are deliberately larger than a real market's — a big call can swing a name
20-30% in a week, and intraweek excursions go further still (Foundry One travels
from +16% to −34% before closing at −16%). Realism is not the goal; being right is
supposed to feel like being right.

---

## Architecture

Domain logic is fully separated from the UI (design doc §13). React components
would slot in later without rewriting any game logic; the same seams are ready
for a server-authoritative multiplayer version.

```
index.html                     # entry; loads src/app/main.js as a module
src/
  app/main.js                  # bootstrap: wire store -> DOM
  domain/                      # pure game logic — no DOM, no framework
    rng.js                     # seeded PRNG (mulberry32) — determinism
    config.js                  # trading rules (buying-power cap, shorting)
    clock/gameClock.js         # LocalGameClock (pausable, speed-scaled)
    clock/calendar.js          # progress -> "Tuesday 11:42 AM" (display only)
    market/pricingModel.js     # event superposition, spike/correct impulses, turbulence
    market/marketEngine.js     # progress -> MarketSnapshot (owns the event timeline)
    market/executionEngine.js  # order -> fill (funding/shorting, optional spread)
    portfolio/portfolio.js     # cash, signed positions, buying power, P&L accounting
    events/visions.js          # reveal gating + fuzzy urgency (player-safe feed)
    scenario/schema.js         # validation (schema + balance rules)
    scenario/loadScenario.js   # fetch + merge public/private halves
    scoring/scoreGame.js       # return, per-name % offered, theses
  state/gameStore.js           # orchestration + subscribe/dispatch (the seam)
  ui/                          # render + dispatch only; no game math
    app.js, components/*.js    # visionFeed, marketTable, tradePanel, debrief, …
  styles/tokens.css, app.css   # every color/space is a CSS variable
content/
  scenario-index.json
  scenarios/week-001/          # a fully-authored week: cast + event timeline (see below)
scripts/validate-scenario.mjs  # Node CLI validator (reuses schema.js)
tests/                         # browser test runner + suites
```

**Rule:** components render and dispatch commands; they never contain pricing or
portfolio math. All of that lives in `domain/`.

### Determinism

A fixed scenario + seed always produces the same price path. The market engine
never calls `Math.random()` — event impacts fire at authored times and the only
randomness (per-company noise) comes from a seeded generator keyed by `(seed,
companyId)`. This is what makes replay, testing, and future multiplayer sync
possible.

---

## Scenarios: data, not code

Each scenario ships its own **cast**: 12-15 fictional companies whose names and
one-line descriptions live in the scenario itself, so every week can field the
companies its story needs. The descriptions are the puzzle board — the
**fair-play rule** says every deduction a vision asks for must be grounded in
them (or in an earlier vision of the same week), never in facts the debrief
reveals after the fact. If the trade turns on one shipper owning planes and the
other owning ships, the cast sheet says so.

Each scenario is split into a **public** and a **private** half:

| File | Contains | Who sees it |
|---|---|---|
| `week-XXX.public.json` | the cast (names, sectors, descriptions), opening prices, visible metadata | the player / client |
| `week-XXX.private.json` | per-company noise, the market **event timeline** (timing, lead, severity, impacts, vision text), debrief | server-only in future multiplayer |

The single-player app loads both, but keeps them conceptually separate so a later
multiplayer client can load only the public half while a server retains the
private half — and drips each vision to the client only when its reveal time
arrives. **No hidden fields ever appear in the public file** — the schema
validator and a test both enforce this.

See **[docs/SCENARIO_AUTHORING.md](docs/SCENARIO_AUTHORING.md)** for how to write a
new scenario and a full field-by-field schema reference.

A scenario used to be a fixed answer key, which made a second play about recall
rather than reading. It no longer is: the run seed now decides **how hard each
impact lands** (a multiplier on the authored magnitude, floor 0.5), **which
secondary names a story touches** (the direct hit always fires; the ripples are
contingent), and — in `week-001` — **which of two sibling segments fills each of
its two slots**, giving four structurally different weeks whose finale pays out
according to the thread the week took. Two documents cover it:

- **[docs/VARIANCE_ARCHITECTURE.md](docs/VARIANCE_ARCHITECTURE.md)** — the *why*.
  A week as a fixed spine with two or three swappable segments; every source of
  variance and invariance in the game; what was considered and cut, and the
  honest counterargument (writing a fifth scenario is cheaper).
- **[docs/VARIANCE_IMPLEMENTATION.md](docs/VARIANCE_IMPLEMENTATION.md)** — the
  *how*. Schema deltas, the resolver, and the validation strategy: every
  possible week is enumerated and run through the full balance suite, then the
  continuous knobs are sampled over 500 draws.

`tests/variance.html` is the authoring instrument — per-path balance figures,
the worst draw, and the run-to-run spread of every company's close.

---

## Deployment

It's static files. Point any static host at the repo root:

- **GitHub Pages / Netlify / Vercel / Cloudflare Pages:** serve the repo root;
  no build command. Content paths resolve relative to the module files, so it
  works under a project sub-path too.

---

## What's intentionally *not* here (yet)

Multiplayer, runtime LLM calls, accounts, cloud saves, options, borrow fees,
false/unreliable visions, player price impact, real market data. **Margin was
built and then deliberately removed** — it added a risk dial without adding a
decision, and mostly turned a good read into a blowout and a bad one into a
wipeout; the cap mechanism remains and simply ships at 1× (cash-only). Shorting is
in, fully collateralised. Both live in `src/domain/config.js`. The interfaces
(`MarketEngine`, `ExecutionEngine`,
`GameClock`, the vision-reveal seam, and the scenario public/private split) are
shaped so the rest can be added without rewrites.

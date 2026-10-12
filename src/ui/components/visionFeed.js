// VisionFeed — a scatter board of precognitive glimpses, not a feed.
//
// Visions SURFACE at scattered points on the dark board, the way fragments of a
// dream do — not stacked in a column, which read as a notification feed no
// matter how bare the text was. Each one fades up in place as its moment
// approaches, and when it comes to pass it BREAKS APART and is gone on the spot
// — a glitch, then nothing. It does not linger: the concrete headline breaks
// in the BREAKING NEWS ticker below on the same beat (see breakingNews.js), and
// the debrief holds the full record at week's end. The board only ever shows the
// LIVE future — its population is the tension meter, and the brightest point on
// it is always the next thing to hit.
//
// The feed deliberately says WHAT will happen, never which companies move or
// which direction — that's for the player to infer from the market. NOTHING ON A
// VISION IS LABELLED (no severity chip, no urgency pill, no timestamp — all
// tried, all removed; each made a premonition read as a monitoring dashboard).
//
// PLACEMENT IS SEEDED, NOT RANDOM. Position comes from
// mulberry32(derivedSeed(scenario.seed, vision.id)), so a replay scatters the
// same visions to the same spots — determinism is the game's covenant (see
// rng.js). Up to six horizontal bands — as many as the board can actually hold
// at its current size — keep concurrent visions (at most 3 at a time in the
// authored scenarios; contested capital is the game) from ever overlapping, and
// a vision NEVER moves once placed — a premonition that relocates reads as a
// glitchy widget, not a glimpse.
//
// NEARNESS IS RENDERED, NOT LABELLED, AND IT IS CONTINUOUS: `proximity` from
// the domain is written to the `--vf-p` custom property and resolved entirely
// in CSS (contrast, glow, tremor). It used to be three discrete bands, which
// was wrong — stepping between fixed looks reads as a status changing, not as
// something drawing near.

import { el, clear } from "../dom.js";
import { mulberry32, derivedSeed } from "../../domain/rng.js";

// The Y range is split into bands; concurrent visions take different bands so
// they can't collide. Scenarios author at most 3 pending at once (the schema
// warns past that) and a just-landed card still holds its band for the ~0.8s
// leave glitch, so 6 bands is more headroom than the content needs — kept
// because the placement is neighbour-aware: with three cards on a six-band
// grid, `pickBand` can leave an empty band between any two of them, and the
// scatter reads as scattered rather than as a three-row list.
//
// How many of those 6 actually fit is a question about the BOARD, not a
// constant: the column is 300-500px wide depending on the window, and the same
// vision wraps to two lines on a wide board and four on a narrow one. So the
// count is measured (see bandGrid) — six where they fit, fewer on a short
// board. MIN_BANDS is the floor: below it the board is smaller than any
// supported layout serves (the tightest real one is ~300x488, which fits six),
// and cards there share bands rather than being packed off the edge.
const MAX_BANDS = 6;
const MIN_BANDS = 3;

// How long the leave choreography runs before the node is removed: the 0.5s
// break-glitch and the instant cut at the end of it (see .vf-card.leaving in
// app.css), plus slack. Removal also runs on animationend; whichever fires
// first wins and the other is a no-op.
const LEAVE_MS = 800;

export function mountVisionFeed(store) {
  const body = el("div", { class: "vf-body" });
  // Span-neutral on purpose: the run may be a week, three days, or a season.
  const empty = el("div", { class: "vf-empty" }, "Your visions of what lies ahead will appear here.");
  body.appendChild(empty);

  // Visions are the game, and the board renders them as scattered low-contrast
  // fragments — without this live region a screen-reader user would only ever
  // hear the headlines after the fact (breakingNews' own live region). Each
  // vision is announced exactly once, at reveal.
  const live = el("span", { class: "sr-only", "aria-live": "polite" });

  // No header. The column is unlabelled on purpose — the visions surfacing from
  // the dark are self-evident, and a title bar reinstates the "board" framing
  // this design keeps removing. The static field they surface from is
  // board-wide (`.board-static`, mounted behind the whole grid in app.js) and
  // shows straight through this panel's open, transparent background.
  const node = el("section", { class: "panel vision-feed" }, [
    body,
    live,
  ]);

  const cards = new Map(); // id -> { node, band, lastProximity, leaving, removed }
  const bandUse = new Array(MAX_BANDS).fill(0); // live cards per band

  // Reduced motion: visions appear and vanish without the blur-in, the break
  // glitch, or the dissolve — and the empty hint appears/leaves instantly.
  // Kept as the MediaQueryList (read .matches at each use) so an OS-level
  // toggle mid-session takes effect without a reload.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The empty hint fades IN on mount (pure CSS on .vf-empty) and, once the
  // first vision surfaces, recedes into the dark instead of vanishing on the
  // spot. Same removal discipline as the cards: animationend plus a timer
  // fallback, both funnelled through a class-guarded `done` so a stale timer
  // from before a game reset can never reap the freshly re-shown hint.
  function dismissEmpty() {
    if (!empty.parentNode || empty.classList.contains("leaving")) return;
    if (reduceMotion.matches) {
      empty.remove();
      return;
    }
    empty.classList.add("leaving");
    const done = () => {
      if (!empty.classList.contains("leaving")) return; // reset reclaimed it
      empty.classList.remove("leaving");
      empty.remove();
    };
    empty.addEventListener("animationend", function onEnd(e) {
      if (e.target !== empty || e.animationName !== "vf-empty-out") return;
      empty.removeEventListener("animationend", onEnd);
      done();
    });
    setTimeout(done, 1400); // > the 0.9s fade-out, with slack
  }

  // The band grid, measured for THIS board.
  //
  // Every card must share one grid or the bands stop meaning anything: two
  // cards in different bands of differently-scaled grids can land on the same
  // pixels. So the pitch comes from a PROBE — an offscreen card carrying a
  // worst-case vision (the ~110-character cap from the authoring guide) — and
  // not from the card being placed. A real card is never taller than the
  // probe, so a band always holds one with room to spare.
  //
  // Measured rather than assumed, because the column is 300-500px wide
  // depending on the window and the same vision wraps to two lines on a wide
  // board and four on a narrow one. Cached per board size and recomputed when
  // the window changes it.
  //
  // A resize mid-week re-grids only the visions revealed AFTER it: the ones
  // already on the board keep the spot they were given, because a premonition
  // that jumps when you drag a window edge reads as a widget. They stay inside
  // the board (their top is a percentage) but their spacing is the old grid's,
  // so a resize can crowd a board that was clean — the cost of never moving,
  // and it clears itself as they land.
  const PROBE_TEXT =
    "The contract fabricator most advanced chips run through will report every line booked out for a year.";
  let grid = null; // { boardW, boardH, bands, unit, free }

  function bandGrid() {
    const boardW = body.clientWidth;
    const boardH = body.clientHeight;
    if (!boardH || !boardW) return { bands: MAX_BANDS, unit: 0, free: 0, boardH: 0, boardW: 0 };
    if (grid && grid.boardW === boardW && grid.boardH === boardH) return grid;

    const probe = el("article", { class: "vf-card" }, [el("p", { class: "vf-text" }, PROBE_TEXT)]);
    probe.style.visibility = "hidden";
    body.appendChild(probe);
    const unit = probe.getBoundingClientRect().height;
    probe.remove();

    // Bands are laid over the space a card does NOT occupy, so band 0 sits
    // flush at the top and the last band ends flush at the bottom. Taking the
    // count from `unit` this way makes the pitch (free / (bands - 1)) at least
    // one card tall — the non-overlap guarantee, by construction.
    const bands = unit
      ? Math.max(MIN_BANDS, Math.min(MAX_BANDS, Math.floor(boardH / unit)))
      : MAX_BANDS;
    grid = { boardW, boardH, bands, unit, free: Math.max(0, boardH - unit) };
    return grid;
  }

  // Pick the band this vision will occupy: walk the bands in a per-vision
  // seeded order and take the first free one whose NEIGHBOURS are also free —
  // an isolated card reads as its own glimpse rather than as a stack. Only a
  // genuinely full board falls back to any free band, and only a board deeper
  // than the schema allows shares one (least-occupied). Deterministic across
  // replays: the seeded order is fixed per vision id, and occupancy at each
  // reveal is itself a pure consequence of the (deterministic) timeline.
  function pickBand(rand, bands) {
    const order = [...Array(bands).keys()];
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let firstFree = -1;
    let best = order[0];
    for (const b of order) {
      if (bandUse[b] === 0) {
        if (firstFree === -1) firstFree = b;
        const clearAbove = b === 0 || bandUse[b - 1] === 0;
        const clearBelow = b === bands - 1 || bandUse[b + 1] === 0;
        if (clearAbove && clearBelow) return b;
      }
      if (bandUse[b] < bandUse[best]) best = b;
    }
    return firstFree !== -1 ? firstFree : best;
  }

  // Placement happens in two beats because a card's height is only knowable
  // once it is in the document: `createCard` builds it with its horizontal spot
  // (which needs no measurement), the caller appends it, and `placeCard`
  // measures and sets the vertical one. Both run in the same frame, before
  // paint — the card is never SEEN to move, which is the rule that matters.
  function createCard(v, seed) {
    const rand = mulberry32(derivedSeed(seed, v.id));
    const textEl = el("p", { class: "vf-text" }, v.visionText || v.text);
    const cardNode = el("article", { class: "vf-card" }, [textEl]);
    // The horizontal spot, set ONCE: a fraction of the free width, so a window
    // resize scales the constellation without re-rolling it.
    cardNode.style.setProperty("--vf-x", rand().toFixed(3));
    cardNode.style.setProperty("--vf-p", String(v.proximity ?? 0));
    // Surface out of the dark: a one-shot CSS blur-in. Pure CSS (no inline
    // styles, no transitionend bookkeeping), so a throttled background tab can
    // delay it but never strand it half-done.
    if (!reduceMotion.matches) cardNode.classList.add("arriving");
    return { node: cardNode, rand, band: -1, lastProximity: v.proximity, leaving: false, removed: false };
  }

  function placeCard(card) {
    const { bands, unit, free, boardH } = bandGrid();
    const band = pickBand(card.rand, bands);
    bandUse[band] += 1;
    card.band = band;

    if (!boardH) {
      card.node.style.setProperty("--vf-top", `${card.rand() * 60 + 10}%`);
      return;
    }

    const slotTop = bands > 1 ? (free * band) / (bands - 1) : free / 2;
    // Jitter rides on this card's own slack — the room its real height leaves
    // inside a probe-sized band — so it breaks the grid's regularity without
    // ever eating into the neighbouring band. A card that renders at the full
    // probe height simply doesn't wander.
    const cardHeight = card.node.getBoundingClientRect().height;
    const slack = Math.max(0, unit - cardHeight);
    const top = slotTop + (card.rand() - 0.5) * slack;
    const clamped = Math.max(0, Math.min(boardH - cardHeight, top));
    card.node.style.setProperty("--vf-top", `${(clamped / boardH) * 100}%`);
  }

  function removeCard(id, card) {
    if (card.removed) return;
    card.removed = true;
    if (card.band >= 0) bandUse[card.band] -= 1;
    card.node.remove();
    cards.delete(id);
  }

  // Came to pass: break apart, and go. The glitch IS the discharge, so the node
  // is dropped the instant it ends — there is no fade-out to wait through (see
  // `.vf-card.leaving` in app.css). The ticker flashes its headline on this same
  // tick — the same-beat choreography IS the "so that's what that meant" pairing.
  function beginLeave(id, card) {
    card.leaving = true;
    card.node.style.setProperty("--vf-p", "1"); // full presence for the break
    if (reduceMotion.matches) {
      removeCard(id, card);
      return;
    }
    card.node.classList.remove("arriving");
    card.node.classList.add("leaving");
    card.node.addEventListener("animationend", (e) => {
      if (e.animationName === "vf-break") removeCard(id, card);
    });
    setTimeout(() => removeCard(id, card), LEAVE_MS); // fallback; removal is idempotent
  }

  function update(state) {
    const visions = state.visions || [];
    if (visions.length) dismissEmpty();

    for (const v of visions) {
      let card = cards.get(v.id);

      if (v.landed) {
        // Never shown, or already gone: the past belongs to the ticker (and the
        // debrief). A vision first seen already-landed — e.g. a catch-up frame
        // that jumps past reveal AND landing — gets no card at all.
        if (card && !card.leaving) beginLeave(v.id, card);
        continue;
      }

      if (!card) {
        card = createCard(v, state.scenario?.seed ?? 0);
        cards.set(v.id, card);
        body.appendChild(card.node);
        placeCard(card); // needs the node in the document to measure its height
        live.textContent = `Vision: ${v.visionText || v.text}`;
      }

      // Presence is continuous: one custom property drives contrast, glow and
      // charge together in CSS. Written only when the value actually moves, so
      // the 1.6s transitions aren't restarted every frame.
      if (v.proximity !== card.lastProximity) {
        card.node.style.setProperty("--vf-p", String(v.proximity ?? 0));
        card.lastProximity = v.proximity;
      }
    }

    // Reset between games (e.g. replaying): if the store cleared visions, drop
    // everything and restore the empty hint. Stripping `leaving` both re-arms
    // the CSS fade-in (re-insertion restarts it) and disarms any stale
    // dismissal callbacks, whose `done` bails once the class is gone.
    if (!visions.length && cards.size) {
      cards.clear();
      bandUse.fill(0);
      clear(body);
      live.textContent = "";
      empty.classList.remove("leaving");
      body.appendChild(empty);
    }
  }

  return { node, update };
}

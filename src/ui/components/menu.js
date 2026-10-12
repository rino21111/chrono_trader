// Title screen: the console before a channel is tuned. (Design doc primary loop
// step 1.)
//
// NOTHING HERE IS A PANEL. The wordmark and every choice are bare text floating
// on the same live static field the game board sits on (`.board-static`) — no
// cards, no fills, no borders. The scenario list used to be a stack of framed
// cards, which made the title screen read as a settings dialog bolted onto the
// game; the console should look like it is holding a handful of faint signals
// until you pick one. Options rest DIM and drift slowly, and brighten as you
// reach for them — the same "presence, not chrome" grammar the vision board uses
// (see the design note above `.vf-card` in app.css). If you need to convey
// something new here, express it as presence or voice; do not add a box.
//
// THE VOICE IS MONO CAPS. This screen is a console, and mono is the public record
// (the covenant is written out at the top of breakingNews.js). Two exceptions: the
// wordmark, which is a moulded badge rather than a printed line, and the scenario
// descriptions, which are prose and stay in the UI face.
//
// BRACKETS CLOSE AROUND WHAT YOU REACH FOR. The option under the cursor or the
// focus ring gets `[ … ]` and the lit ink; everything else rests dim and unmarked,
// on every beat — the front door's one line included. That sharpens the old
// brighten-on-hover without changing its grammar: still presence, never chrome, and
// nothing is decorated before the player has reached for it. Hover and keyboard
// focus get the identical treatment, because the lit state IS the focus indicator
// (an outline would draw the box this screen refuses to have).
//
// The mock's `>` caret ahead of the left bracket is deliberately NOT here: at
// nearly three times the width of `]` it pulled every label off centre and needed a
// compensating gutter on each option, which then had to be paid back everywhere
// else on the screen. Brackets alone are symmetric and everything centres for free.
//
// WHAT THE MOCK HAD AND THIS SCREEN DOES NOT. Two pieces of the title-screen mock
// (issue #16) were built, looked at, and cut for being noise:
//
//   - A split-focus candlestick TAPE across the whole field — sharp left of a `NOW`
//     rule, blurred right of it, crawling slowly, with `+24H` / `+72H` gridlines.
//     It stated the premise as an image, and it was also the busiest thing on the
//     quietest screen in the game, behind every word the player has to read. If it
//     is ever tried again: it belongs BEHIND `.board-static` as another faint field,
//     it must be seeded (determinism is the covenant even in decoration) and it must
//     hold still under `prefers-reduced-motion`.
//   - The bottom STATUS STRIP (`MARKET DATE`, `FORECAST SIGNAL`, `LAST SESSION`).
//     Two of the three had no honest backing anyway: scenarios carry a fictional
//     `timeline`, never a real timestamp (see calendar.js), and the forecast meter
//     meant nothing at all. If a strip ever comes back, EVERY group in it has to be
//     true — the game asks the player to ground every deduction they make, and the
//     console does not get to be the one screen that lies.
//
// A hairline rule broken by a small hourglass went the same way, and so did the
// `TRADE ON INCOMPLETE FUTURES` tagline: on a screen this empty, every piece of
// dressing under the badge cost more than it gave.
//
// What survived is the part that was signal and not decoration: the wordmark, and
// the console's voice in the menu.
//
// `CONTINUE` and `SETTINGS` are absent too, for the same reason in a different
// key: there is no save system and no settings beat, so both would be dead menu
// lines. When a run can be resumed, CONTINUE slots into the front door.
//
// THE SETUP IS A SEQUENCE, NOT A FORM. One question per beat:
//   1. BEGIN SIMULATION   the front door — one line under the wordmark
//   2. SCENARIO           which one to run
//   3. LAUNCH             the choices dissolve, the board tunes in
//
// THERE IS ONE QUESTION TO ANSWER: which scenario. The setup used to also pick a
// pace (a ½× / 1× / 2× / 4× "difficulty" beat) and hold a Settings beat that
// switched the in-game time controls off — two decisions asked before the player
// had seen a single vision, and answerable only by guessing. Every run now
// starts at 1×, the pace the game is authored at, with the transport live; the
// speed key in the header is where the pace is a choice, made with the board in
// front of you. If a term of the run ever genuinely needs settling up front,
// that is the moment to add a beat back — not before.
//
// The wordmark belongs to the front door alone — it's inside rootStep, so it
// dissolves and returns with that beat like any other step content. Every beat
// centers its own content in the same fixed stage (see .menu-stage), which is
// what keeps the composition from shifting between screens.
//
// The static field is the ONE thing that does not fade at launch: it belongs to
// the console, not to the menu, and it carries straight through into the game
// screen, which mounts the identical field. The channel changes; the signal the
// set is sitting on never stops.

import { el, clear } from "../dom.js";

// Kept in step with the animations in app.css: `.menu-step.is-leaving` runs
// menu-out, and `.menu-screen.is-launching .menu-frame` runs menu-launch. Both
// are one-shot fades, so a late timer is harmless — but a short one would cut
// the fade off mid-way.
const STEP_LEAVE_MS = 460;
const LAUNCH_MS = 900;

export function mountMenu(store) {
  // Reduced motion: steps swap instantly and the launch skips straight to the
  // game. Blur-ins and dissolves are exactly the motion this guards against.
  // Kept as the MediaQueryList (read .matches at each use) so an OS-level
  // toggle mid-session takes effect without a reload.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let launching = false;

  const stage = el("div", { class: "menu-stage" });
  // Where a failed launch reports why (see update()). Bare text like everything
  // else here; empty and invisible until a load actually fails.
  const errEl = el("p", { class: "menu-error", role: "alert" });
  const frame = el("div", { class: "menu-frame" }, [stage, errEl]);
  const node = el("div", { class: "screen menu-screen" }, [
    el("div", { class: "board-static", "aria-hidden": "true" }),
    frame,
  ]);

  // The scenario index arrives async. Whichever container is on screen when it
  // lands gets filled; a Back after that reuses the cached list.
  let scenarios = null;
  let pendingList = null;

  store.listScenarios().then((list) => {
    scenarios = list;
    if (pendingList) {
      fillScenarios(pendingList);
      pendingList = null;
    }
  }).catch(() => {
    // Same dead-end class as a failed launch: without this the list said
    // "Tuning in…" forever. Leave `scenarios` null so a refresh retries.
    if (pendingList) {
      clear(pendingList);
      pendingList.appendChild(el("p", { class: "menu-waiting" }, "The scenario index failed to load — refresh to retry."));
      pendingList = null;
    }
  });

  // Swap the visible step. Both steps occupy the same grid cell (see
  // `.menu-step` in app.css) so the outgoing one dissolves in place under the
  // incoming one rather than shoving the layout around.
  let stepNode = null;
  function showStep(build) {
    const next = build();
    const hadStep = Boolean(stepNode);
    if (stepNode) {
      const old = stepNode;
      if (reduceMotion.matches) old.remove();
      else {
        old.classList.add("is-leaving");
        setTimeout(() => old.remove(), STEP_LEAVE_MS);
      }
    }
    // is-entering only on a SWAP: its animation now starts on a delay (so the
    // incoming text doesn't fade up over the outgoing text — see .menu-step in
    // app.css), and the very first step has nothing to wait out — holding the
    // wordmark's tune-in glitch behind that delay would just blunt it.
    stepNode = next;
    if (!reduceMotion.matches && hadStep) next.classList.add("is-entering");
    stage.appendChild(next);
    // Move focus to the new step's first option so the keyboard path doesn't
    // land back at the top of the document on every beat.
    const first = next.querySelector(".menu-option");
    if (first && document.activeElement !== document.body) first.focus();
  }

  function option(props, children, index) {
    const btn = el("button", { class: "menu-option", ...props }, children);
    // Drives the drift's phase offset so the options don't float in lockstep.
    btn.style.setProperty("--mo-i", String(index));
    // THE BRACKETS AND THE KEYBOARD MUST NOT DISAGREE. A step swap can drop a new
    // option under a stationary cursor — the browser re-evaluates hover and fires
    // mouseenter without the pointer moving — which brackets the hovered line while
    // focus sits on the step's first line, so Enter fires something other than what
    // the screen is pointing at. Reaching with the mouse takes focus with it.
    //
    // Only once focus exists: on a fresh title screen nothing is focused (the first
    // paint deliberately doesn't steal it), and there is nothing to disagree with
    // until the player uses the keyboard.
    btn.addEventListener("mouseenter", () => {
      if (document.activeElement !== btn && document.activeElement !== document.body) {
        btn.focus({ preventScroll: true });
      }
    });
    return btn;
  }

  // A scenario is its name and its premise, nothing else. The stake used to be
  // read out here and so did the index's `difficulty` tier — both went: the
  // stake is $100,000 in every scenario, so stating it per option was noise
  // dressed as information, and the tier was a claim about hardness the game
  // never honoured. If a scenario ever varies its stake, that's the moment to
  // put a readout back — not before.
  function fillScenarios(list) {
    clear(list);
    scenarios.forEach((s, i) => {
      list.appendChild(
        option(
          { onClick: () => chooseScenario(s) },
          [
            el("span", { class: "mo-name" }, s.title),
            el("span", { class: "mo-desc" }, s.description),
          ],
          i
        )
      );
    });
  }

  // ---- beat 1: the front door ----
  // THE WORDMARK AND THE WAY IN, NOTHING ELSE. A tagline and a hairline rule broken
  // by a small hourglass were both tried under the badge and both came out: the
  // front door is stronger as two lines of ink on an empty field than as a stack of
  // dressing. The title is PART OF THIS STEP,
  // not a fixture over the whole flow: it dissolves with the front door and
  // tunes back in with it, so every later beat gets the screen to itself and
  // centers on its own content. Rebuilding the h1 on each return replays its
  // break-glitch — each arrival at the front door is the console catching the
  // signal again.
  function rootStep() {
    return el("div", { class: "menu-step" }, [
      el("h1", { class: "menu-title" }, "Chrono Trader"),
      el("div", { class: "menu-options" }, [
        option({ onClick: () => showStep(scenarioStep) }, [el("span", { class: "mo-name" }, "Begin simulation")], 0),
      ]),
    ]);
  }

  // ---- beat 2: the scenario ----
  function scenarioStep() {
    const list = el("div", { class: "menu-options" });
    if (scenarios) fillScenarios(list);
    else {
      pendingList = list;
      list.appendChild(el("p", { class: "menu-waiting" }, "Tuning in…"));
    }

    return el("div", { class: "menu-step" }, [
      el("p", { class: "menu-eyebrow" }, "Scenario selection"),
      list,
      backTo(rootStep),
    ]);
  }

  function backTo(step) {
    return el("button", { class: "menu-back", onClick: () => showStep(step) }, "← Back");
  }

  // ---- beat 3: hand off to the board ----
  // Picking a scenario IS the launch — there is no third question to answer, so
  // the list dissolves straight into the run. The static field underneath holds
  // steady the whole way through, so the title screen doesn't cut to the board,
  // it clears off it.
  function chooseScenario(s) {
    if (launching) return; // a second click during the fade must not start twice
    launching = true;
    errEl.textContent = "";
    const go = () => store.start(s.id);
    if (reduceMotion.matches) {
      go();
      return;
    }
    node.classList.add("is-launching");
    setTimeout(go, LAUNCH_MS);
  }

  showStep(rootStep);

  // A failed launch lands back here: the store flips to status "menu" with
  // loadError set. Un-dissolve the frame (the launch fade held it invisible)
  // and say what went wrong; the player is left on the beat they launched
  // from, free to pick again.
  function update(state) {
    if (state.loadError && launching) {
      launching = false;
      node.classList.remove("is-launching");
      errEl.textContent = `Couldn't start — ${state.loadError}`;
    }
  }
  return { node, update };
}

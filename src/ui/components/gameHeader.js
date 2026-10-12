// GameHeader (design doc section 11.1 top bar): identity, the week-progress
// clock, and the transport controls (pause / speed / finish). Equity is NOT here
// — it lives once, in the portfolio bar along the bottom.

import { el, clear } from "../dom.js";
import { makeCalendar, isMarketClosed } from "../../domain/clock/calendar.js";

// The nameplate on the console. Same wordmark the title screen wears.
const GAME_TITLE = "Chrono Trader";

// The speed control is ONE button that cycles 1× → 2× → 4× → 1×. Its label is
// always the speed you are AT; clicking advances to the next in the ring. Every
// run begins at 1× (see START_SPEED in gameStore.js), so the ring only ever
// warps time FORWARD from the authored pace — there used to be a ½× stop, which
// let a player stretch the week out and read every vision at leisure, the exact
// pressure the game is made of.
const SPEEDS = [1, 2, 4];

function nextSpeed(current) {
  const i = SPEEDS.indexOf(current);
  if (i === -1) return 1; // unknown -> the resting pace
  return SPEEDS[(i + 1) % SPEEDS.length];
}

function speedLabel(speed) {
  return `${speed}×`;
}

export function mountGameHeader(store) {
  // The clock is a scrubber running the scenario's span — the trading week by
  // default, or whatever timeline the scenario declares. The filled portion is
  // the span elapsed, the playhead is "now", the chip riding above it reads the
  // exact time, and the segment under it lights up. One custom property,
  // `--tl-p` (0%..100%), drives fill/playhead/chip together; it's rewritten
  // every frame in update().
  const fill = el("span", { class: "tl-fill" });
  const head = el("span", { class: "tl-head" });
  const nowChip = el("span", { class: "tl-now" });
  const track = el("div", { class: "tl-track" }, [fill, head, nowChip]);
  const daysRow = el("div", { class: "tl-days" });
  const timeEl = el(
    "div",
    { class: "hdr-timeline", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" },
    [track, daysRow]
  );
  const statusDot = el("span", { class: "status-dot" });

  const pauseBtn = el("button", { class: "btn", onClick: () => togglePause(store) }, "Pause");

  const speedBtn = el(
    "button",
    { class: "btn btn-speed", onClick: () => store.setSpeed(nextSpeed(store.state.speed)) },
    "1×"
  );

  // Finishing early ends the run, so it asks twice — but in the console's own
  // voice, not window.confirm()'s (the one stock-browser dialog the UI had).
  // First press ARMS the key; a second press within the window fires; left
  // alone it stands down on its own.
  const FINISH_ARM_MS = 3000;
  let finishTimer = null;
  const finishBtn = el(
    "button",
    {
      class: "btn btn-ghost",
      onClick: () => {
        if (finishTimer) {
          disarmFinish();
          store.finishEarly();
          return;
        }
        finishBtn.textContent = `End ${cal.finishNoun()} now?`;
        finishBtn.classList.add("armed");
        finishTimer = setTimeout(disarmFinish, FINISH_ARM_MS);
      },
    },
    "Finish week"
  );
  function disarmFinish() {
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = null;
    finishBtn.classList.remove("armed");
    finishBtn.textContent = `Finish ${cal.finishNoun()}`;
  }

  // The calendar is the scenario's, so the axis under the track is built (and
  // rebuilt on replay-with-another-scenario) from whatever timeline it
  // declares. Memoized on the timeline reference — stable within one run.
  let cal = makeCalendar();
  let calFor;
  let segEls = [];
  function ensureCalendar(scenario) {
    const timeline = scenario && scenario.timeline;
    if (segEls.length && calFor === timeline) return;
    cal = makeCalendar(timeline);
    calFor = timeline;
    segEls = cal.segments.map((s) => el("span", { class: "tl-day" }, s));
    clear(daysRow);
    segEls.forEach((s) => daysRow.appendChild(s));
    const noun = cal.finishNoun();
    disarmFinish(); // also (re)sets the label to `Finish ${noun}` off the new calendar
    timeEl.setAttribute("aria-label", `${noun[0].toUpperCase()}${noun.slice(1)} progress`);
  }

  // Two groups, space-between: identity on the left; the week clock sits with
  // the transport controls on the far right — it's a time readout, so it belongs
  // beside pause/speed rather than off on its own. Equity used to live up here
  // too, but it just repeated the portfolio bar along the bottom, so it's gone —
  // one equity readout, not two.
  //
  // IDENTITY IS THE WORDMARK, THEN THE SCENARIO. The left of the bar used to
  // read "Week 2 · The Craze" — the console labelled by its content's ordinal,
  // which named nothing the player recognises and called a scenario a week. It's
  // the machine's own nameplate now, with the scenario running on it beside it:
  // the title screen's wordmark carried through, so the console is the same
  // object either side of the launch.
  const titleEl = el("span", { class: "hdr-title" }, GAME_TITLE);
  const scenarioEl = el("span", { class: "hdr-scenario" }, "");
  const node = el("header", { class: "game-header" }, [
    el("div", { class: "hdr-left" }, [
      el("div", { class: "hdr-ident" }, [titleEl, scenarioEl]),
      statusDot,
    ]),
    el("div", { class: "hdr-right" }, [timeEl, pauseBtn, speedBtn, finishBtn]),
  ]);

  function update(state) {
    const label = scenarioLabel(state.scenario);
    if (scenarioEl.textContent !== label) scenarioEl.textContent = label;

    ensureCalendar(state.scenario);
    const progress = Math.max(0, Math.min(1, state.progress));
    const parts = cal.parts(state.progress);
    const closed = isMarketClosed(state.progress);
    const pct = progress * 100;
    timeEl.style.setProperty("--tl-p", pct + "%");
    timeEl.setAttribute("aria-valuenow", String(Math.round(pct)));
    timeEl.classList.toggle("is-closed", closed);
    nowChip.textContent = closed ? "Closed" : parts.time;
    segEls.forEach((d, i) => d.classList.toggle("is-now", i === parts.index));

    const paused = state.status === "paused";
    statusDot.className = "status-dot " + (paused ? "paused" : "live");
    statusDot.title = paused ? "Paused" : "Live";

    pauseBtn.textContent = paused ? "Resume" : "Pause";

    // Memoized on dataset.speed so the per-frame update doesn't churn the DOM.
    if (speedBtn.dataset.speed !== String(state.speed)) {
      speedBtn.dataset.speed = String(state.speed);
      speedBtn.textContent = speedLabel(state.speed);
      // Lit while time runs warped, so plain 1× reads as the resting state.
      speedBtn.classList.toggle("active", state.speed !== 1);
      const next = nextSpeed(state.speed);
      speedBtn.title = `Game speed ${speedLabel(state.speed)} — click for ${speedLabel(next)}`;
      speedBtn.setAttribute("aria-label", `Game speed ${speedLabel(state.speed)}, click for ${speedLabel(next)}`);
    }
  }

  return { node, update };
}

// What runs beside the wordmark: the scenario's own name, with the separator
// baked in so an unnamed scenario leaves the nameplate standing alone rather
// than trailing a stray middot. The id's week-N ordinal is deliberately NOT
// used — it numbered the content rather than naming it, and scenarios are not
// weeks.
function scenarioLabel(scenario) {
  const title = scenario && scenario.title;
  return title ? `· ${title}` : "";
}

function togglePause(store) {
  if (store.state.status === "playing") store.pause();
  else if (store.state.status === "paused") store.resume();
}

// BreakingNews — the realized events, on a ticker running in the dark.
//
// A vision is a PREMONITION. When its moment arrives the ACTUAL event breaks
// here, under the vision board. This is where "what actually happened" lives —
// the board above keeps only the hazy premonitions, and each one dissolves off
// it as its headline breaks below.
//
// IT SCROLLS, AND IT IS NOT A PANEL. The scroll is the point: a headline
// travelling right to left under a lit BREAKING mark is what makes this read as
// news coming in off the wire rather than a status line. What went is the
// CHROME around it — the bordered bar, the navy fill, the solid red flag slab.
// The mark and the moving headline float on the board's static with no surface
// of their own, the same open dark the visions surface from directly above.
//
// The one signal color on the screen lives here, and only as INK: the BREAKING
// mark and its dot in --hot, with a glow. Red as a solid fill is what made the
// old bar shout.
//
// THE VOICE IS MONO. A headline is the public record — the tape, the readouts,
// the thing every player would see. Serif italic belongs to the private
// foreknowledge on the board above. Keeping the two faces apart is what carries
// the contrast, so don't unify them.
//
// THE WIRE IS CONTINUOUS, AND IT NEVER CUTS. Headlines are separate runs on one
// lane, all travelling at the same pixel speed, so they can follow each other
// without ever colliding. A development entering does NOT restart the wire and
// does NOT wait for the headline ahead of it to finish crossing — it enters the
// moment the run ahead has cleared enough room at the right edge, exactly as a
// real ticker queues copy. With nothing new waiting, the latest development is
// simply run again behind itself, so the wire always carries the most recent
// news and never goes empty.
//
// Two earlier versions of this were wrong in opposite directions and are worth
// naming so they don't come back: the original CUT to a fresh headline the
// instant it landed, restarting mid-sentence; the next one made a queued
// headline wait out the whole pass ahead of it. Neither is a ticker.

import { el } from "../dom.js";

// Scroll rate in px/sec, constant however long the headline is: each run's
// duration is computed from the distance it actually travels. Because every run
// moves at this same rate, the gap between two consecutive runs is fixed the
// moment the second one starts — they can never catch up with each other.
const SPEED = 76;

// Dark between consecutive runs, in px. This is the "free space" test: a waiting
// development enters as soon as this much room has opened at the right edge.
const GAP = 110;

// BREAKING means NOW. If developments land faster than the wire can carry them
// (a 4x week, several events close together) the oldest waiting ones are dropped
// rather than making the player watch a backlog drain — the full record is in
// the debrief.
const MAX_QUEUE = 4;

export function mountBreakingNews(store) {
  const flag = el("span", { class: "bn-flag" }, [
    el("span", { class: "bn-dot", "aria-hidden": "true" }),
    "Breaking",
  ]);
  // aria-hidden: the wire repeats the latest development indefinitely, which a
  // screen reader would announce indefinitely with it. The polite live region
  // below carries each development exactly once, the moment it lands.
  const lane = el("div", { class: "bn-lane", "aria-hidden": "true" });
  const live = el("span", { class: "sr-only", "aria-live": "polite" });
  // `is-idle` until the week's first development lands: the mark and the lane
  // are both hidden, so the space is simply dark. There is deliberately no
  // placeholder line — nothing has happened yet, and saying so in words is
  // clutter the empty wire already communicates. The height is still reserved
  // (see `.breaking-news` in app.css) so the board above doesn't jump when the
  // first headline arrives.
  const node = el(
    "section",
    { class: "breaking-news is-idle", "aria-label": "Breaking news" },
    [flag, lane, live]
  );

  // Reduced motion: no crawl. The latest development simply stands there,
  // wrapped — a line of text travelling across the screen is exactly the motion
  // this guards against. Kept as the MediaQueryList (read .matches at each
  // use) so an OS-level toggle mid-session takes effect without a reload.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const seen = new Set();
  const queue = [];
  let current = null; // the headline being repeated while nothing new waits
  let launchTimer = null;
  let flashTimer = null;

  // Put a run on the wire: it enters at the right edge and travels until its
  // tail clears the left, then takes itself off the lane. Distance and duration
  // are measured per run, so the pixel speed is the same for a short headline
  // and a long one, and a window resize is picked up by the next run.
  function launch(text, isNew) {
    current = text;
    const run = el("span", { class: "bn-run" }, text);
    lane.appendChild(run);

    const travel = lane.clientWidth;
    const width = run.getBoundingClientRect().width;
    run.style.setProperty("--bn-from", `${travel}px`);
    run.style.setProperty("--bn-to", `${-width}px`);
    run.style.animation = `bn-scroll ${(travel + width) / SPEED}s linear 1 forwards`;
    run.addEventListener("animationend", () => run.remove());

    if (isNew) flash();
    // Earliest this run could have opened GAP behind it. `admit` re-checks
    // against the real position, so this is a first look, not a promise.
    schedule(((width + GAP) / SPEED) * 1000);
  }

  function schedule(ms) {
    clearTimeout(launchTimer);
    launchTimer = setTimeout(admit, Math.max(80, ms));
  }

  // Is there room at the right edge yet? MEASURED, never assumed: a background
  // tab suspends the animations but not the timers, so a schedule computed up
  // front would spawn runs on top of each other the moment the tab came back.
  // Reading the trailing run's actual position makes the wire self-correcting —
  // if nothing has moved, nothing is admitted.
  function admit() {
    const last = lane.lastElementChild;
    if (last) {
      const free = lane.getBoundingClientRect().right - last.getBoundingClientRect().right;
      if (free < GAP) {
        schedule(((GAP - free) / SPEED) * 1000);
        return;
      }
    }
    if (queue.length) launch(queue.shift(), true);
    else if (current) launch(current, false); // repeat the latest until something new lands
  }

  // A fresh development lands. It joins the wire behind whatever is on it.
  function push(text) {
    live.textContent = text; // announced at once, wherever the wire has got to
    node.classList.remove("is-idle");

    if (reduceMotion.matches) {
      current = text;
      lane.replaceChildren(el("span", { class: "bn-run" }, text));
      return;
    }

    if (!current) {
      launch(text, true); // empty wire: straight out
      return;
    }

    queue.push(text);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    // Don't sit on a pending timer that was set for a repeat — check for room
    // now, so a development waits only for space and never for a slot.
    schedule(0);
  }

  // The one moment a signal color flares on this screen: a development takes the
  // wire. The mark is otherwise perfectly still — the crawl is the only motion.
  function flash() {
    node.classList.add("bn-flash");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => node.classList.remove("bn-flash"), 1100);
  }

  function reset() {
    clearTimeout(launchTimer);
    clearTimeout(flashTimer);
    launchTimer = null;
    flashTimer = null;
    queue.length = 0;
    seen.clear();
    current = null;
    lane.replaceChildren();
    node.classList.remove("bn-flash");
    node.classList.add("is-idle");
    live.textContent = "";
  }

  function update(state) {
    const visions = state.visions || [];

    // Reset between games (the store clears visions on replay).
    if (!visions.length) {
      if (current || seen.size) reset();
      return;
    }

    // Take in any newly-landed headlines, in the order the events actually
    // happened. state.visions is sorted by REVEAL time, which is not landing
    // order when leads differ — and several events can land in one frame — so
    // sort the fresh batch by landedAt before it goes on the wire.
    const fresh = visions.filter((v) => v.landed && !seen.has(v.id));
    fresh.sort((a, b) => a.landedAt - b.landedAt);
    for (const v of fresh) {
      seen.add(v.id);
      push(v.text); // v.text is the headline once landed
    }
  }

  return { node, update };
}

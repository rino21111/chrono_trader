// Vision feed (rework "event visions"): turns the hidden event timeline into the
// player-facing stream, gated by the clock.
//
// A vision is REVEALED to the player at (eventTime − leadTime) — some time before
// the event actually hits the market — and marked LANDED once the event's time
// arrives. While pending, its urgency climbs as its moment approaches, giving the
// player a fuzzy sense of how near it is without ever showing a countdown.
//
// The card's TEXT changes when it lands: the hazy premonition (`visionText`) is
// replaced by the concrete news of what actually occurred (`headlineText`). The
// headline may be specific — even name the company — because by the time it shows
// the market has already repriced, so it confers no advantage. Its job is the
// "so THAT's what that meant" payoff, and to teach the player how to read the
// next hazy vision.
//
// Crucially, the returned items carry ONLY player-safe fields: severity, the
// vision text, urgency, and when it appeared. The event's exact time, lead,
// magnitude, and (above all) which companies it moves stay hidden until the
// debrief — inferring those is the game.
//
// Pure: a function of (events, progress) only. No clock, no DOM.

// Urgency and proximity are functions of ABSOLUTE time remaining, not of the
// fraction of the vision's own lead. This is what keeps a mixed board honest:
// scenarios now author leads that differ by 5× (a short fuse at 0.05 next to a
// half-week thesis at 0.3), and a fraction-of-lead ramp would light the long
// vision up at half strength while it still had days to run. Measured against
// the clock instead, a long-lead vision spends most of its life genuinely
// dormant, and the brightest point on the board is always the next thing to
// hit — whatever the leads were.
//
// A pending vision is "soon" inside the final SOON_WITHIN of the run and
// "imminent" inside IMMINENT_WITHIN, regardless of how long it has been on the
// board. A short-fuse vision (lead ≤ ~0.05) therefore surfaces already hot —
// which is the truth: it IS about to happen, and it is the authored funding
// crunch that forces the player to cut something they still believe in.
const IMMINENT_WITHIN = 0.045;
const SOON_WITHIN = 0.075;

export function visionUrgency(event, progress) {
  const remaining = event.eventTime - progress; // week-fraction until it lands
  if (remaining <= IMMINENT_WITHIN) return "imminent";
  if (remaining <= SOON_WITHIN) return "soon";
  return "later";
}

// How close a vision is to happening: 0 while its landing is still more than
// PRESENCE_WINDOW away, curving up to 1 as it lands.
//
// PROXIMITY IS URGENCY, NOT LEGIBILITY — and the distinction is the whole
// point. An earlier tuning let this number drive how READABLE a vision was,
// which quietly defeated the contested-capital design: only the nearest card
// was legible and the ones behind it were a faint smudge, so the player still
// held exactly one thesis at a time and the week played first-in-first-out
// with extra decoration. A vision you cannot read is not a position you can
// hold. The board now floors contrast so every live glimpse is readable from
// the moment it surfaces (see `--vf-contrast` in app.css), and this ramp
// drives only the heat: glow, stroke weight, tremor.
//
// The curve (GAMMA > 1) keeps a distant thesis quiet without flattening it to
// nothing — two visions a third of a week out still rank against each other,
// so the board stays ordered: of two pending visions the hotter one always
// lands first, whatever their leads were. That ordering is what lets a player
// hold the board's three open reads and still know which one is about to cost
// them.
//
// QUANTIZED to 5% deliberately. A continuous value would hand a client the
// landing time in one read: remaining = PRESENCE_WINDOW × (1 − proximity).
// Rounding costs nothing visually (the UI transitions over ~1.4s, so the steps
// blend into a smooth ramp) and coarsens that read to a half-percent-of-week
// band.
//
// BE HONEST ABOUT WHAT IT DOES NOT DO: a client that *watches* the stream can
// observe when the quantized value steps (0.30 → 0.35) and solve the landing
// time almost exactly at the first crossing. No client-side transform fixes
// that — in single-player the client holds the private file anyway, and any
// deterministic jitter would be derived from the (public) seed and inverted
// the same way. Real concealment is architectural: the future
// server-authoritative mode must compute proximity server-side and jitter its
// step boundaries with a server-secret salt. Until then, the quantization is a
// courtesy to honest clients, not a defense against hostile ones.
// Wide enough that a long-lead thesis is ranked for most of its life rather
// than pinned at zero, with the exponent holding the heat back until the
// landing is genuinely close: at a third of a week out a vision reads ~0.1, at
// 0.05 out ~0.7. The final surge (`--vf-charge`, which ignites past 0.62)
// therefore covers roughly the last 0.06 of the week — the same stretch
// `visionUrgency` calls "soon".
const PRESENCE_WINDOW = 0.3;
const PRESENCE_GAMMA = 2;
const PROXIMITY_STEP = 0.05;

export function visionProximity(event, progress) {
  const remaining = event.eventTime - progress;
  const approach = Math.max(0, Math.min(1, (PRESENCE_WINDOW - remaining) / PRESENCE_WINDOW));
  const curved = Math.pow(approach, PRESENCE_GAMMA);
  return Math.round(curved / PROXIMITY_STEP) * PROXIMITY_STEP;
}

// The revealed feed at a given progress, newest first. Landed visions stay in the
// feed (as a record that they came to pass) with urgency "landed".
export function visionFeed(events = [], progress) {
  const items = [];
  for (const ev of events) {
    const revealAt = ev.eventTime - ev.leadTime;
    if (progress < revealAt) continue; // not yet foreseen
    const landed = progress >= ev.eventTime;
    items.push({
      id: ev.id,
      severity: ev.severity || "major",
      // Primary line: the premonition while pending, the report once it happened.
      text: (landed ? ev.headlineText : ev.visionText) || ev.visionText || "",
      // The original premonition, kept alongside so a landed card can still show
      // what you were actually given. Safe to expose: the player has been reading
      // it since the reveal. `headlineText` is never exposed as its own field —
      // it reaches the player only via `text`, and only once the event has landed.
      visionText: ev.visionText || "",
      urgency: landed ? "landed" : visionUrgency(ev, progress),
      // 0 = just glimpsed and barely present, 1 = upon us. Drives how visible
      // and how noisy the vision renders.
      proximity: landed ? 1 : visionProximity(ev, progress),
      landed,
      revealedAt: revealAt, // in-game progress when it appeared (safe: not the landing time)
      // The moment it came to pass — present ONLY once landed (before that it
      // is the exact secret the feed exists to keep). The ticker needs it: the
      // feed is sorted by reveal time, and reveal order is not landing order
      // when leads differ, so several events landing in one frame (a catch-up
      // tick) would otherwise hit the wire out of sequence.
      ...(landed ? { landedAt: ev.eventTime } : {}),
    });
  }
  // Newest revelation on top; stable tiebreak by id so the order is deterministic.
  items.sort((a, b) => b.revealedAt - a.revealedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return items;
}

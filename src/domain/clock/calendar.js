// Maps abstract scenario progress [0,1] onto a simulated calendar for display
// only (design doc section 6). The market never depends on this — it is purely
// how we render "Tuesday 11:42 AM", whatever span the scenario declares.
//
// A scenario's public file may carry a `timeline` block naming the fictional
// span the run covers; absent one, it is the classic trading week. All engine
// timing (eventTime, leadTime, urgency, scoring) stays in [0,1] regardless —
// the timeline changes the wallpaper, never the physics.
//
//   { "kind": "trading-week" }                    // default: Mon-Fri, 9:30-4:00
//   { "kind": "days",   "count": 3 }              // Day 1..N, intraday clock
//   { "kind": "weeks",  "count": 8 }              // W1..WN, weekday texture
//   { "kind": "months", "count": 6 }              // Jan..N, synthetic dates
//
// Any kind may instead carry `segments`: its own axis labels ("Sozin",
// "Azulon", ...) — themed calendars are content, not code.

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MINUTES_PER_DAY = 390; // 9:30 -> 16:00
const OPEN_MINUTE = 9 * 60 + 30;

export const TIMELINE_KINDS = ["trading-week", "days", "weeks", "months"];

// The intraday clock string for a fraction [0,1] of one trading day.
function clockTime(fractionOfDay) {
  const intoDay = Math.min(1, Math.max(0, fractionOfDay)) * MINUTES_PER_DAY;
  const minuteOfDay = OPEN_MINUTE + intoDay;
  let hour = Math.floor(minuteOfDay / 60);
  const minute = Math.floor(minuteOfDay % 60);
  const ampm = hour >= 12 ? "PM" : "AM";
  let displayHour = hour % 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${ampm}`;
}

// Builds one calendar for one scenario's timeline (undefined -> trading week).
// Returns { segments, parts, label, closeLabel, reviewTitle, finishNoun }:
//   segments      strip labels for the header axis, in order
//   parts(p)      { index, segment, time } — which segment is lit + the chip text
//   label(p)      the one-line "where are we" string ("Friday 11:42 AM")
//   closeLabel()  label(1), the debrief's kicker ("Friday 4:00 PM")
export function makeCalendar(timeline) {
  const t = timeline || {};
  const kind = t.kind || "trading-week";
  const custom = Array.isArray(t.segments) && t.segments.length ? t.segments.map(String) : null;

  // Each segment: { short } for the strip, { long } for prose, and for months
  // { dayCount } for the synthetic date. Generated names differ per kind;
  // custom names are used verbatim for both forms.
  let segs;
  if (kind === "days") {
    const n = custom ? custom.length : Math.max(1, t.count | 0);
    segs = Array.from({ length: n }, (_, i) => {
      const name = custom ? custom[i] : `Day ${i + 1}`;
      return { short: name, long: name };
    });
  } else if (kind === "weeks") {
    const n = custom ? custom.length : Math.max(1, t.count | 0);
    segs = Array.from({ length: n }, (_, i) => ({
      short: custom ? custom[i] : `W${i + 1}`,
      long: custom ? custom[i] : `Week ${i + 1}`,
    }));
  } else if (kind === "months") {
    const n = custom ? custom.length : Math.max(1, t.count | 0);
    segs = Array.from({ length: n }, (_, i) => ({
      short: custom ? custom[i] : MONTHS_SHORT[i % 12],
      long: custom ? custom[i] : MONTHS_SHORT[i % 12],
      // Real month lengths for the generated year; a themed month is a flat 30.
      dayCount: custom ? 30 : MONTH_DAYS[i % 12],
    }));
  } else {
    segs = DAYS.map((long, i) => ({ short: DAYS_SHORT[i], long }));
  }

  // Progress -> segment index + fraction within it. At p=1 the last segment is
  // fully elapsed (frac 1), matching the old Friday-at-the-close behavior.
  function locate(progress) {
    const p = Math.max(0, Math.min(1, progress));
    const raw = p * segs.length;
    const index = Math.min(Math.floor(raw), segs.length - 1);
    const frac = Math.min(1, raw - index);
    return { index, frac };
  }

  function timeOf(index, frac) {
    const seg = segs[index];
    if (kind === "weeks") return DAYS_SHORT[Math.min(Math.floor(frac * DAYS.length), DAYS.length - 1)];
    if (kind === "months") return `${seg.long} ${1 + Math.min(Math.floor(frac * seg.dayCount), seg.dayCount - 1)}`;
    return clockTime(frac); // trading-week and days keep the intraday clock
  }

  function parts(progress) {
    const { index, frac } = locate(progress);
    return { index, segment: segs[index].short, time: timeOf(index, frac) };
  }

  function label(progress) {
    const { index, frac } = locate(progress);
    const time = timeOf(index, frac);
    if (kind === "months") return time; // the date IS the label
    if (kind === "weeks") return `${segs[index].long} · ${time}`;
    return `${segs[index].long} ${time}`;
  }

  const NOUNS = { "trading-week": "Week", days: "Day", weeks: "Week", months: "Month" };
  const noun = NOUNS[kind];
  const plural = kind !== "trading-week" && segs.length > 1;

  return {
    segments: segs.map((s) => s.short),
    parts,
    label,
    closeLabel: () => label(1),
    // "The Week in Review" and its longer cousins — the debrief masthead.
    reviewTitle: () => `The ${noun}${plural ? "s" : ""} in Review`,
    // What the finish button closes: a week, a day, a month — or, plural, the run.
    finishNoun: () => (plural ? "run" : noun.toLowerCase()),
  };
}

export function isMarketClosed(progress) {
  return progress >= 1;
}

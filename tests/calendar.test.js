import { describe, it, expect } from "./harness.js";
import { makeCalendar, isMarketClosed } from "../src/domain/clock/calendar.js";

// No timeline declared -> the classic trading week, exactly as before.
const week = makeCalendar();

describe("calendar: trading week (default)", () => {
  it("starts Monday at the open", () => {
    expect(week.label(0)).toBe("Monday 9:30 AM");
  });

  it("ends at Friday close", () => {
    expect(week.label(1)).toBe("Friday 4:00 PM");
    expect(week.closeLabel()).toBe("Friday 4:00 PM");
  });

  it("is Wednesday around mid-week", () => {
    expect(week.label(0.5).startsWith("Wednesday")).toBeTruthy();
  });

  it("names five short weekdays in order", () => {
    expect(week.segments).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });

  it("splits into a segment index and a time that agree with the label", () => {
    const parts = week.parts(0);
    expect(parts.index).toBe(0);
    expect(parts.segment).toBe("Mon");
    expect(parts.time).toBe("9:30 AM");
  });

  it("puts progress 1 on Friday at the close", () => {
    const parts = week.parts(1);
    expect(parts.index).toBe(4);
    expect(parts.segment).toBe("Fri");
    expect(parts.time).toBe("4:00 PM");
  });

  it("clamps out-of-range progress into a valid segment", () => {
    expect(week.parts(-1).index).toBe(0);
    expect(week.parts(5).index).toBe(4);
  });

  it("advances the segment index monotonically across the week", () => {
    let last = -1;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const idx = week.parts(p).index;
      expect(idx).toBeGreaterThanOrEqual(last);
      expect(idx).toBeLessThanOrEqual(4);
      last = idx;
    }
  });

  it("titles the debrief for a week and finishes a week", () => {
    expect(week.reviewTitle()).toBe("The Week in Review");
    expect(week.finishNoun()).toBe("week");
  });
});

describe("calendar: days", () => {
  const cal = makeCalendar({ kind: "days", count: 3 });

  it("runs Day 1..N with the intraday clock", () => {
    expect(cal.segments).toEqual(["Day 1", "Day 2", "Day 3"]);
    expect(cal.label(0)).toBe("Day 1 9:30 AM");
    expect(cal.closeLabel()).toBe("Day 3 4:00 PM");
  });

  it("lights the middle day at mid-run", () => {
    expect(cal.parts(0.5).index).toBe(1);
  });

  it("finishes a run when plural, a day when singular", () => {
    expect(cal.finishNoun()).toBe("run");
    expect(cal.reviewTitle()).toBe("The Days in Review");
    const one = makeCalendar({ kind: "days", count: 1 });
    expect(one.finishNoun()).toBe("day");
    expect(one.reviewTitle()).toBe("The Day in Review");
  });
});

describe("calendar: weeks", () => {
  const cal = makeCalendar({ kind: "weeks", count: 8 });

  it("runs W1..WN with weekday texture instead of a clock", () => {
    expect(cal.segments.length).toBe(8);
    expect(cal.segments[0]).toBe("W1");
    expect(cal.label(0)).toBe("Week 1 · Mon");
    expect(cal.closeLabel()).toBe("Week 8 · Fri");
  });

  it("advances the weekday within one segment", () => {
    // Week 1 spans [0, 0.125); late in it should read Thu/Fri, still index 0.
    const late = cal.parts(0.12);
    expect(late.index).toBe(0);
    expect(["Thu", "Fri"].includes(late.time)).toBeTruthy();
  });
});

describe("calendar: months", () => {
  const cal = makeCalendar({ kind: "months", count: 6 });

  it("runs Jan..N with synthetic dates instead of a clock", () => {
    expect(cal.segments).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun"]);
    expect(cal.label(0)).toBe("Jan 1");
    expect(cal.closeLabel()).toBe("Jun 30");
  });

  it("respects real month lengths for generated months", () => {
    // The last instant of February (month 2 of 6) must not read Feb 30.
    const feb = makeCalendar({ kind: "months", count: 2 });
    expect(feb.closeLabel()).toBe("Feb 28");
  });

  it("titles the debrief for months", () => {
    expect(cal.reviewTitle()).toBe("The Months in Review");
    expect(cal.finishNoun()).toBe("run");
  });
});

describe("calendar: custom segments", () => {
  it("uses themed axis names verbatim, with flat 30-day months", () => {
    const cal = makeCalendar({ kind: "months", segments: ["Sozin", "Azulon", "Ozai"] });
    expect(cal.segments).toEqual(["Sozin", "Azulon", "Ozai"]);
    expect(cal.label(0)).toBe("Sozin 1");
    expect(cal.closeLabel()).toBe("Ozai 30");
  });

  it("derives the count from the segments when both could apply", () => {
    const cal = makeCalendar({ kind: "days", segments: ["Eve", "Zero Hour"] });
    expect(cal.segments.length).toBe(2);
    expect(cal.closeLabel()).toBe("Zero Hour 4:00 PM");
  });
});

describe("isMarketClosed", () => {
  it("closes exactly at the end of the span", () => {
    expect(isMarketClosed(0.999)).toBeFalsy();
    expect(isMarketClosed(1)).toBeTruthy();
  });
});

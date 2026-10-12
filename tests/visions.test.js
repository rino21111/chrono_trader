import { describe, it, expect } from "./harness.js";
import { visionFeed, visionUrgency, visionProximity } from "../src/domain/events/visions.js";

const events = [
  {
    id: "ev-a",
    eventTime: 0.4,
    leadTime: 0.2, // revealed at 0.2
    severity: "critical",
    visionText: "Glass on the floor of a room that was supposed to be clean.",
    headlineText: "Foundry One's primary fab struck overnight; production halted.",
    affectedCompanies: [{ companyId: "foundry-one", direction: "negative", magnitude: 0.9 }],
  },
  {
    id: "ev-b",
    eventTime: 0.8,
    leadTime: 0.1, // revealed at 0.7
    severity: "minor",
    visionText: "Something warm and seasonal on a chalkboard menu.",
    headlineText: "Hearth Coffee adds a seasonal drink.",
    affectedCompanies: [{ companyId: "hearth-coffee", direction: "positive", magnitude: 0.2 }],
  },
];

describe("visionFeed reveal gating", () => {
  it("hides a vision before its reveal time", () => {
    expect(visionFeed(events, 0.1).map((v) => v.id)).toEqual([]);
  });

  it("reveals a vision once progress reaches eventTime − leadTime", () => {
    const ids = visionFeed(events, 0.25).map((v) => v.id);
    expect(ids.includes("ev-a")).toBeTruthy();
    expect(ids.includes("ev-b")).toBeFalsy(); // ev-b reveals at 0.7
  });

  it("marks a vision landed once its event time passes", () => {
    const a = visionFeed(events, 0.5).find((v) => v.id === "ev-a");
    expect(a.landed).toBeTruthy();
    expect(a.urgency).toBe("landed");
  });

  it("shows the hazy vision while pending and the headline once it lands", () => {
    const pending = visionFeed(events, 0.3).find((v) => v.id === "ev-a");
    expect(pending.text.includes("Glass on the floor")).toBeTruthy();
    expect(pending.text.includes("Foundry One")).toBeFalsy(); // no leak before it happens

    const landed = visionFeed(events, 0.5).find((v) => v.id === "ev-a");
    expect(landed.text.includes("Foundry One")).toBeTruthy();
  });

  it("falls back to the vision text when an event has no headline", () => {
    const noHeadline = [{ id: "x", eventTime: 0.2, leadTime: 0.1, severity: "minor", visionText: "Only a vision." }];
    expect(visionFeed(noHeadline, 0.5)[0].text).toBe("Only a vision.");
  });

  it("keeps the original premonition readable after the headline replaces it", () => {
    const landed = visionFeed(events, 0.5).find((v) => v.id === "ev-a");
    expect(landed.text.includes("Foundry One")).toBeTruthy(); // headline is primary
    expect(landed.visionText.includes("Glass on the floor")).toBeTruthy(); // vision still there
  });

  it("never exposes the headline before the event lands", () => {
    for (const v of visionFeed(events, 0.3)) {
      if (v.landed) continue;
      expect(v.text.includes("Foundry One")).toBeFalsy();
      expect(JSON.stringify(v).includes("production halted")).toBeFalsy();
    }
  });

  it("orders newest revelation first", () => {
    // At 0.75 both are revealed; ev-b (revealed 0.7) is newer than ev-a (revealed 0.2).
    expect(visionFeed(events, 0.75).map((v) => v.id)).toEqual(["ev-b", "ev-a"]);
  });
});

describe("visionUrgency escalation (absolute time remaining)", () => {
  const ev = { eventTime: 0.4, leadTime: 0.2 }; // revealed at 0.2

  it("stays 'later' until the final stretch, then 'soon', then 'imminent'", () => {
    expect(visionUrgency(ev, 0.22)).toBe("later"); // 0.18 of the week out
    expect(visionUrgency(ev, 0.31)).toBe("later"); // 0.09 out — still dormant
    expect(visionUrgency(ev, 0.33)).toBe("soon"); // 0.07 out
    expect(visionUrgency(ev, 0.36)).toBe("imminent"); // 0.04 out
  });

  it("does not depend on the lead: a long thesis is dormant for most of its life", () => {
    const short = { eventTime: 0.4, leadTime: 0.05 };
    const long = { eventTime: 0.4, leadTime: 0.3 };
    // Same distance from landing → same urgency, whatever the lead was.
    expect(visionUrgency(short, 0.35)).toBe(visionUrgency(long, 0.35));
    // The long-lead vision reads "later" through the bulk of its window.
    expect(visionUrgency(long, 0.2)).toBe("later");
  });

  it("surfaces a short fuse already hot", () => {
    // Revealed 0.05 from landing: inside the "soon" threshold from the start.
    expect(visionUrgency({ eventTime: 0.4, leadTime: 0.05 }, 0.35)).toBe("soon");
  });
});

describe("visionProximity (how present a vision renders)", () => {
  const ev = { eventTime: 0.4, leadTime: 0.2 }; // revealed at 0.2

  it("is 0 only beyond the presence window, and 1 when the event lands", () => {
    expect(visionProximity(ev, 0.05)).toBeCloseTo(0); // 0.35 out — past the window
    expect(visionProximity(ev, 0.4)).toBeCloseTo(1);
  });

  it("ranks a distant thesis instead of flattening it to nothing", () => {
    // The board holds up to three open reads; two far-off visions must still be
    // tellable apart, or the player cannot see which thesis bites first.
    const far = visionProximity(ev, 0.2); // 0.20 out
    const nearer = visionProximity(ev, 0.3); // 0.10 out
    expect(far > 0).toBeTruthy();
    expect(nearer > far).toBeTruthy();
  });

  it("holds the heat back until the landing is genuinely close", () => {
    // --vf-charge (app.css) ignites past 0.62: the surge belongs to the last
    // stretch, not to the whole approach.
    expect(visionProximity(ev, 0.3) < 0.62).toBeTruthy(); // 0.10 out — still cool
    expect(visionProximity(ev, 0.35) > 0.62).toBeTruthy(); // 0.05 out — surging
  });

  it("rises monotonically across the approach", () => {
    let prev = -1;
    for (let p = 0.2; p <= 0.4001; p += 0.01) {
      const q = visionProximity(ev, p);
      expect(q >= prev).toBeTruthy();
      prev = q;
    }
  });

  it("orders a mixed board: the hotter of two pending visions lands first", () => {
    // Leads differing 6× — proximity must still rank by landing time, since
    // that ordering is the only thing telling a three-deep board which thesis
    // is about to resolve.
    const soonest = { eventTime: 0.45, leadTime: 0.05 };
    const later = { eventTime: 0.5, leadTime: 0.3 };
    expect(visionProximity(soonest, 0.42) > visionProximity(later, 0.42)).toBeTruthy();
  });

  it("clamps outside the window", () => {
    expect(visionProximity(ev, 0.05)).toBeCloseTo(0);
    expect(visionProximity(ev, 0.9)).toBeCloseTo(1);
  });

  it("is quantized to 0.05 steps (blunts a single-read solve of the landing time)", () => {
    // Any value must sit on a 0.05 step. A continuous value would hand a client
    // the landing time in one read. Watching step crossings can still bracket
    // the timing — see the PROXIMITY_STEP note in visions.js for why that is
    // accepted in single-player.
    for (let p = 0.2; p <= 0.4; p += 0.007) {
      const q = visionProximity(ev, p);
      expect(Math.abs(q / 0.05 - Math.round(q / 0.05))).toBeCloseTo(0);
    }
  });

  it("survives a zero lead time", () => {
    expect(Number.isFinite(visionProximity({ eventTime: 0.5, leadTime: 0 }, 0.5))).toBeTruthy();
  });
});

describe("visionFeed leaks no hidden fields", () => {
  it("exposes only player-safe fields", () => {
    for (const v of visionFeed(events, 0.9)) {
      expect("affectedCompanies" in v).toBeFalsy();
      expect("eventTime" in v).toBeFalsy();
      expect("leadTime" in v).toBeFalsy();
      // headlineText is never its own field — it reaches the player only through
      // `text`, and only once the event has landed.
      expect("headlineText" in v).toBeFalsy();
      expect("magnitude" in v).toBeFalsy();
    }
  });

  it("withholds landedAt until the event has landed, then reports the landing time", () => {
    // Pending: the landing time is the exact secret the feed keeps.
    const pending = visionFeed(events, 0.3).find((v) => v.id === "ev-a");
    expect("landedAt" in pending).toBeFalsy();
    // Landed: safe to expose, and the ticker needs it to order same-frame
    // landings chronologically (the feed itself is sorted by reveal time).
    const landed = visionFeed(events, 0.9).find((v) => v.id === "ev-a");
    expect(landed.landedAt).toBeCloseTo(0.4);
  });
});

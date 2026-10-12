// Validates EVERY shipped scenario against the schema AND the acceptance
// criteria in design doc section 20. Runs in the browser (it fetches the JSON),
// so it doubles as an integration check that the content loads and is coherent.
//
// Since schema 3.0 a scenario is self-contained: its cast (names, sectors,
// descriptions) lives in the public file. The description is the player's only
// fact sheet per company — the fair-play substrate — so these tests treat a
// missing one as a content bug, not a cosmetic gap.

import { describe, it, expect } from "./harness.js";
import { validateScenario } from "../src/domain/scenario/schema.js";
import { loadScenario, listScenarios } from "../src/domain/scenario/loadScenario.js";
import { MarketEngine } from "../src/domain/market/marketEngine.js";

// Resolve content relative to this test module (tests/ -> ../content/) so the
// fetches work no matter where tests.html sits.
function contentUrl(path) {
  return new URL(`../content/${path}`, import.meta.url).href;
}

async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function fetchHalves(id) {
  return Promise.all([
    fetchJson(contentUrl(`scenarios/${id}/${id}.public.json`)),
    fetchJson(contentUrl(`scenarios/${id}/${id}.private.json`)),
  ]);
}

// The scenarios under test: everything registered on the menu.
const SCENARIO_IDS = ["week-001", "fire-nation", "mormons-go-nuclear", "mr-frog-president"];

describe("scenario index", () => {
  it("lists every scenario under test (keep SCENARIO_IDS in sync)", async () => {
    const listed = (await listScenarios()).map((s) => s.id);
    for (const id of SCENARIO_IDS) {
      expect(listed.includes(id)).toBeTruthy();
    }
    expect(listed.length).toBe(SCENARIO_IDS.length);
  });
});

for (const id of SCENARIO_IDS) {
  describe(`${id} scenario`, () => {
    it("passes schema + balance validation with no errors", async () => {
      const [pub, priv] = await fetchHalves(id);
      const result = validateScenario(pub, priv);
      if (!result.ok) throw new Error("validation errors: " + result.errors.join("; "));
      expect(result.ok).toBeTruthy();
    });

    it("carries a self-contained cast: name, sector and description per company", async () => {
      const [pub] = await fetchHalves(id);
      for (const c of pub.companies) {
        expect(typeof c.name === "string" && c.name.length > 0).toBeTruthy();
        expect(typeof c.sector === "string" && c.sector.length > 0).toBeTruthy();
        expect(typeof c.description === "string").toBeTruthy();
        // One scannable line that can still ground a deduction.
        expect(c.description.length >= 30).toBeTruthy();
        expect(c.description.length <= 160).toBeTruthy();
      }
    });

    it("meets the acceptance criteria (>=10 companies, >=6 events, >=3 meaningful moves)", async () => {
      const scenario = await loadScenario(id);
      expect(scenario.companies.length).toBeGreaterThanOrEqual(10);
      expect(scenario.events.length).toBeGreaterThanOrEqual(6);

      const eng = new MarketEngine(scenario.seed);
      eng.initialize(scenario.companies, scenario.events);
      let meaningful = 0;
      for (const c of scenario.companies) {
        const move = Math.abs(eng.fairPriceFor(c.companyId, 1) - c.openingPrice) / c.openingPrice;
        if (move >= 0.03) meaningful += 1;
      }
      expect(meaningful).toBeGreaterThanOrEqual(3);
    });

    it("reveals every vision before its event lands (positive lead time)", async () => {
      const [, priv] = await fetchHalves(id);
      for (const ev of priv.marketEvents) {
        expect(ev.leadTime > 0).toBeTruthy();
        expect(ev.eventTime - ev.leadTime >= 0).toBeTruthy();
      }
    });

    it("keeps feed text readable against the tape (vision <=110 chars, headline <=120)", async () => {
      const [, priv] = await fetchHalves(id);
      for (const ev of priv.marketEvents) {
        expect(ev.visionText.length <= 110).toBeTruthy();
        expect(ev.headlineText.length <= 120).toBeTruthy();
      }
    });

    it("plays the week to the close (last event lands at >=0.85)", async () => {
      const [, priv] = await fetchHalves(id);
      const last = Math.max(...priv.marketEvents.map((ev) => ev.eventTime));
      expect(last >= 0.85).toBeTruthy();
    });

    it("keeps hidden data out of the public file", async () => {
      const [pub] = await fetchHalves(id);
      expect("marketEvents" in pub).toBeFalsy();
      expect("debrief" in pub).toBeFalsy();
      expect("newspaper" in pub).toBeFalsy();
      for (const c of pub.companies) {
        expect("volatility" in c).toBeFalsy();
        expect("severity" in c).toBeFalsy();
        expect("eventTime" in c).toBeFalsy();
        expect("affectedCompanies" in c).toBeFalsy();
      }
    });
  });
}

describe("validator feed-text warnings", () => {
  it("warns on over-cap visionText/headlineText but stays ok (soft, not an error)", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const long = JSON.parse(JSON.stringify(priv));
    long.marketEvents[0].visionText = "v".repeat(111);
    long.marketEvents[0].headlineText = "h".repeat(121);
    const result = validateScenario(pub, long);
    expect(result.ok).toBeTruthy();
    expect(result.warnings.some((w) => w.includes("visionText is 111 chars"))).toBeTruthy();
    expect(result.warnings.some((w) => w.includes("headlineText is 121 chars"))).toBeTruthy();
  });

  it("stays quiet at exactly the caps", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const capped = JSON.parse(JSON.stringify(priv));
    capped.marketEvents[0].visionText = "v".repeat(110);
    capped.marketEvents[0].headlineText = "h".repeat(120);
    const result = validateScenario(pub, capped);
    expect(result.warnings.some((w) => w.includes("visionText"))).toBeFalsy();
    expect(result.warnings.some((w) => w.includes("headlineText"))).toBeFalsy();
  });
});

describe("validator pacing warnings", () => {
  it("warns when the last event lands early and the close goes quiet", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const early = JSON.parse(JSON.stringify(priv));
    early.marketEvents = early.marketEvents.filter((ev) => ev.eventTime <= 0.5);
    const result = validateScenario(pub, early);
    expect(result.warnings.some((w) => w.includes("waiting game"))).toBeTruthy();
  });

  it("stays quiet when the finale reaches the final day", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const result = validateScenario(pub, priv);
    expect(result.warnings.some((w) => w.includes("waiting game"))).toBeFalsy();
  });
});

describe("validator run parameters", () => {
  async function withPub(patch) {
    const [pub, priv] = await fetchHalves("fire-nation");
    return validateScenario({ ...pub, ...patch }, priv);
  }

  it("rejects a missing seed, duration, stake, title or description", async () => {
    expect((await withPub({ seed: undefined })).ok).toBeFalsy();
    expect((await withPub({ durationSeconds: 0 })).ok).toBeFalsy();
    expect((await withPub({ startingCash: 0 })).ok).toBeFalsy();
    expect((await withPub({ title: "" })).ok).toBeFalsy();
    expect((await withPub({ description: "  " })).ok).toBeFalsy();
  });

  it("accepts the shipped values", async () => {
    expect((await withPub({})).ok).toBeTruthy();
  });
});

describe("validator event timing", () => {
  it("warns on a zero leadTime — the vision skips the board entirely", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const patched = JSON.parse(JSON.stringify(priv));
    patched.marketEvents[0].leadTime = 0;
    patched.marketEvents[0].eventTime = Math.max(patched.marketEvents[0].eventTime, 0.01);
    const r = validateScenario(pub, patched);
    expect(r.ok).toBeTruthy();
    expect(r.warnings.some((w) => w.includes("zero leadTime"))).toBeTruthy();
  });

  it("rejects a non-positive reactionSpan and warns on a slow-burn one", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const bad = JSON.parse(JSON.stringify(priv));
    bad.marketEvents[0].reactionSpan = 0;
    expect(validateScenario(pub, bad).ok).toBeFalsy();

    const slow = JSON.parse(JSON.stringify(priv));
    slow.marketEvents[0].reactionSpan = 0.3;
    const r = validateScenario(pub, slow);
    expect(r.ok).toBeTruthy();
    expect(r.warnings.some((w) => w.includes("reactionSpan is 0.3"))).toBeTruthy();
  });

  it("warns when more visions are pending at once than a player can hold", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const crowded = JSON.parse(JSON.stringify(priv));
    crowded.marketEvents.forEach((ev, i) => {
      if (i < 6) {
        ev.eventTime = 0.9;
        ev.leadTime = 0.8; // six visions pending together from 0.1 to 0.9
      }
    });
    const r = validateScenario(pub, crowded);
    expect(r.warnings.some((w) => w.includes("pending at once"))).toBeTruthy();
  });

  it("warns at four pending, not just at a wall of them", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const four = JSON.parse(JSON.stringify(priv));
    // Exactly one vision more than the board's three: four reveal together at
    // 0.3, and the rest are short fuses spaced too far apart to stack.
    four.marketEvents.forEach((ev, i) => {
      ev.eventTime = i < 4 ? 0.4 + i * 0.1 : 0.72 + (i - 4) * 0.03;
      ev.leadTime = i < 4 ? ev.eventTime - 0.3 : 0.01;
    });
    const r = validateScenario(pub, four);
    expect(r.warnings.some((w) => w.includes("4 visions can be pending at once"))).toBeTruthy();
  });

  it("warns when pending visions never stack 3 deep — capital is never contested", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const singleFile = JSON.parse(JSON.stringify(priv));
    // March the events out one at a time: each lands before the next reveals.
    singleFile.marketEvents.forEach((ev, i) => {
      ev.eventTime = 0.05 + i * 0.07;
      ev.leadTime = 0.03;
    });
    const r = validateScenario(pub, singleFile);
    expect(r.warnings.some((w) => w.includes("never stack 3 deep"))).toBeTruthy();
  });

  it("warns when every lead sits in a narrow band", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const uniform = JSON.parse(JSON.stringify(priv));
    uniform.marketEvents.forEach((ev) => {
      ev.leadTime = Math.min(0.05, ev.eventTime); // lockstep reveals
    });
    const r = validateScenario(pub, uniform);
    expect(r.warnings.some((w) => w.includes("narrow band"))).toBeTruthy();
  });

  it("warns when visions resolve in the order they were revealed (FIFO)", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const fifo = JSON.parse(JSON.stringify(priv));
    // Same lead for everyone: reveal order is exactly landing order.
    fifo.marketEvents.forEach((ev) => {
      ev.leadTime = Math.min(0.05, ev.eventTime);
    });
    const r = validateScenario(pub, fifo);
    expect(r.warnings.some((w) => w.includes("order they were revealed"))).toBeTruthy();
  });

  it("accepts a timeline where late events are revealed early enough to jump the queue", async () => {
    const [pub, priv] = await fetchHalves("fire-nation");
    const jumbled = JSON.parse(JSON.stringify(priv));
    // Reverse the correlation: the later it lands, the earlier it is glimpsed.
    const times = jumbled.marketEvents.map((ev) => ev.eventTime);
    const earliest = Math.min(...times);
    jumbled.marketEvents.forEach((ev) => {
      ev.leadTime = Math.max(0.04, ev.eventTime - earliest * 0.5);
    });
    const r = validateScenario(pub, jumbled);
    expect(r.warnings.some((w) => w.includes("order they were revealed"))).toBeFalsy();
  });

  it("stays quiet about concurrency and ordering for the shipped timelines", async () => {
    for (const sid of ["week-001", "fire-nation", "mormons-go-nuclear", "mr-frog-president"]) {
      const [pub, priv] = await fetchHalves(sid);
      const r = validateScenario(pub, priv);
      for (const phrase of ["pending at once", "never stack", "narrow band", "order they were revealed"]) {
        expect(r.warnings.some((w) => w.includes(phrase))).toBeFalsy();
      }
    }
  });
});

describe("validator timeline block", () => {
  async function withTimeline(timeline) {
    const [pub, priv] = await fetchHalves("fire-nation");
    const patched = JSON.parse(JSON.stringify(pub));
    patched.timeline = timeline;
    return validateScenario(patched, priv);
  }

  it("accepts a well-formed span and the bare default", async () => {
    expect((await withTimeline({ kind: "months", count: 6 })).ok).toBeTruthy();
    expect((await withTimeline(undefined)).ok).toBeTruthy();
    expect((await withTimeline({ kind: "trading-week" })).ok).toBeTruthy();
  });

  it("rejects an unknown kind and a missing count", async () => {
    expect((await withTimeline({ kind: "fortnights", count: 2 })).ok).toBeFalsy();
    expect((await withTimeline({ kind: "months" })).ok).toBeFalsy();
  });

  it("rejects a count that disagrees with its segments", async () => {
    const r = await withTimeline({ kind: "days", count: 3, segments: ["Eve", "Zero Hour"] });
    expect(r.ok).toBeFalsy();
  });

  it("warns past 12 segments — the header axis gets cramped", async () => {
    const r = await withTimeline({ kind: "weeks", count: 16 });
    expect(r.ok).toBeTruthy();
    expect(r.warnings.some((w) => w.includes("cramped"))).toBeTruthy();
  });
});

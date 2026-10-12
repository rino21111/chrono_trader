// Scenario loading (design doc sections 10.2, 10.4, 14 "ScenarioRepository").
//
// Loads the public + private JSON halves for a scenario, validates the result,
// and returns a LoadedScenario the game can run. In multiplayer the client
// would fetch only the public half and the server would keep the private half;
// here the single-player app loads both, but the split is preserved so that
// migration is a change of transport, not of shape.
//
// Since schema 3.0 a scenario is fully self-contained: its cast (company
// names, sectors, descriptions) lives in the public file, so each week can
// field the companies its story needs instead of drawing from a shared roster.

import { validateScenario } from "./schema.js";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return res.json();
}

// Content lives at <repo>/content. Resolve it relative to THIS module's URL
// (src/domain/scenario/loadScenario.js -> ../../../content/) so fetches work
// regardless of which page triggered them or whether the app is hosted under a
// sub-path (e.g. GitHub Pages project pages).
const CONTENT_BASE = new URL("../../../content/", import.meta.url);
function contentUrl(path) {
  return new URL(path, CONTENT_BASE).href;
}

export async function listScenarios() {
  const index = await fetchJson(contentUrl("scenario-index.json"));
  return index.scenarios || [];
}

export async function loadScenario(id) {
  const [pub, priv] = await Promise.all([
    fetchJson(contentUrl(`scenarios/${id}/${id}.public.json`)),
    fetchJson(contentUrl(`scenarios/${id}/${id}.private.json`)),
  ]);

  const result = validateScenario(pub, priv);
  if (result.warnings.length) {
    // Warnings are non-fatal balance notes; surface them but keep loading.
    console.warn(`[scenario ${id}] validation warnings:`, result.warnings);
  }
  if (!result.ok) {
    throw new Error(`scenario ${id} is invalid: ` + result.errors.join("; "));
  }

  // Merge the private noise param onto the public cast so the UI and market
  // engine have one source of truth. Identity and opening price come from the
  // public half; volatility (a hidden pricing input) from the private half.
  const privById = new Map((priv.companies || []).map((c) => [c.companyId, c]));
  const companies = pub.companies.map((c) => {
    const p = privById.get(c.companyId) || {};
    return {
      companyId: c.companyId,
      name: c.name,
      sector: c.sector || "",
      description: c.description || "",
      openingPrice: c.openingPrice,
      volatility: p.volatility ?? 0,
    };
  });

  // The hidden event timeline that drives the market and the vision feed. Fields
  // that older content lacks (timing, severity, vision text) fall back to sane
  // defaults until the content is migrated.
  const events = (priv.marketEvents || []).map((ev) => ({
    id: ev.id,
    // Which segment this beat belongs to, if any. Undefined means SPINE: it
    // fires in every run. resolveRun() is the only thing that reads it, and it
    // has done its filtering before the engine ever sees this list.
    segment: ev.segment,
    eventTime: ev.eventTime ?? 0,
    leadTime: ev.leadTime ?? 0,
    severity: ev.severity || "major",
    reactionProfile: ev.reactionProfile || "gradual",
    reactionSpan: ev.reactionSpan,
    visionText: ev.visionText || "",
    // What the feed shows once the event lands, replacing the vision. Falls back
    // to the vision text so older content still renders.
    headlineText: ev.headlineText || ev.visionText || "",
    affectedCompanies: ev.affectedCompanies || [],
    visibleInDebrief: ev.visibleInDebrief !== false,
  }));

  return {
    id,
    title: pub.title,
    description: pub.description,
    seed: pub.seed,
    startingCash: pub.startingCash,
    durationSeconds: pub.durationSeconds,
    // The fictional span the run covers (display only; undefined = trading
    // week). makeCalendar() owns the defaulting, so this passes through as-is.
    timeline: pub.timeline,
    companies,
    events,
    // The authored possibilities, passed through untouched for resolveRun() to
    // collapse at the start of a run: the thread vocabulary, the slots and their
    // sibling segments, and the scenario-level magnitude band. Content with none
    // of them resolves to exactly this event list.
    threads: priv.threads,
    slots: priv.slots,
    variance: priv.variance,
    debrief: priv.debrief,
    metadata: pub.metadata || {},
  };
}

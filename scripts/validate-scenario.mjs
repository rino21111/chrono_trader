// Scenario validation CLI (design doc sections 10.5, 10.8).
//
//   node scripts/validate-scenario.mjs week-001
//   node scripts/validate-scenario.mjs            # validate every scenario in the index
//
// Reuses the SAME validator the browser runs at load time (src/domain/scenario/
// schema.js), so there is one source of truth for the rules. Exits non-zero on
// any error, making it usable as a pre-commit or CI check.
//
// NOTE: requires Node (this repo otherwise runs with no build step). The same
// checks also run automatically in the browser when a scenario loads.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateScenario } from "../src/domain/scenario/schema.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "content");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function validateOne(id) {
  const dir = join(CONTENT, "scenarios", id);
  const pub = await readJson(join(dir, `${id}.public.json`));
  const priv = await readJson(join(dir, `${id}.private.json`));
  const result = validateScenario(pub, priv);

  const tag = result.ok ? "✓ OK" : "✗ FAIL";
  console.log(`\n[${id}] ${tag}`);
  for (const w of result.warnings) console.log(`  warn: ${w}`);
  for (const e of result.errors) console.log(`  ERROR: ${e}`);
  return result.ok;
}

async function main() {
  const arg = process.argv[2];

  let ids;
  if (arg) {
    ids = [arg];
  } else {
    const index = await readJson(join(CONTENT, "scenario-index.json"));
    ids = index.scenarios.map((s) => s.id);
  }

  let allOk = true;
  for (const id of ids) {
    const ok = await validateOne(id);
    allOk = allOk && ok;
  }

  console.log("");
  if (!allOk) {
    console.error("Validation failed.");
    process.exit(1);
  }
  console.log("All scenarios valid.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

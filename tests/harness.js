// Tiny zero-dependency test harness (the doc suggests Vitest, but this project
// runs without npm). Works in the browser via tests/tests.html and, because it
// only uses standard ES modules, would also run under Node.

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function it(name, fn) {
  (current ? current.tests : (suites[suites.length - 1] || {}).tests || []).push({ name, fn });
}

export function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`expected ${fmt(actual)} to be ${fmt(expected)}`);
    },
    toEqual(expected) {
      if (!deepEqual(actual, expected)) throw new Error(`expected ${fmt(actual)} to equal ${fmt(expected)}`);
    },
    toBeCloseTo(expected, digits = 6) {
      const tol = Math.pow(10, -digits) / 2;
      if (Math.abs(actual - expected) > tol) throw new Error(`expected ${fmt(actual)} to be close to ${fmt(expected)}`);
    },
    toBeGreaterThan(n) {
      if (!(actual > n)) throw new Error(`expected ${fmt(actual)} > ${fmt(n)}`);
    },
    toBeGreaterThanOrEqual(n) {
      if (!(actual >= n)) throw new Error(`expected ${fmt(actual)} >= ${fmt(n)}`);
    },
    toBeLessThan(n) {
      if (!(actual < n)) throw new Error(`expected ${fmt(actual)} < ${fmt(n)}`);
    },
    toBeLessThanOrEqual(n) {
      if (!(actual <= n)) throw new Error(`expected ${fmt(actual)} <= ${fmt(n)}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`expected ${fmt(actual)} to be truthy`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`expected ${fmt(actual)} to be falsy`);
    },
    toContain(item) {
      if (!Array.isArray(actual) || !actual.includes(item)) throw new Error(`expected ${fmt(actual)} to contain ${fmt(item)}`);
    },
  };
}

export async function run(report) {
  let passed = 0;
  let failed = 0;
  const results = [];
  for (const suite of suites) {
    for (const t of suite.tests) {
      try {
        await t.fn();
        passed += 1;
        results.push({ suite: suite.name, name: t.name, ok: true });
      } catch (err) {
        failed += 1;
        results.push({ suite: suite.name, name: t.name, ok: false, error: err.message });
      }
    }
  }
  const summary = { passed, failed, total: passed + failed, results };
  if (report) report(summary);
  return summary;
}

function fmt(v) {
  if (typeof v === "number") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

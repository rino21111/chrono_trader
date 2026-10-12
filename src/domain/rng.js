// Deterministic pseudo-random number generation.
//
// The market engine must never call Math.random() directly (see design doc
// section 16). Every stochastic element — noise, timing variance, overreaction
// amplitude — is derived from a seeded generator so a given scenario + seed
// always produces the same price path. This is what makes replay, testing, and
// future multiplayer synchronization possible.

// mulberry32: a small, fast, well-distributed 32-bit PRNG. Given the same seed
// it yields the same sequence in every browser and in Node.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash an arbitrary string into a 32-bit integer seed (FNV-1a variant). Lets us
// derive a stable per-company stream from the scenario seed + companyId without
// coordinating counters.
export function hashStringToSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Combine a numeric base seed with a string key into a new seed. Used to give
// each company its own deterministic noise stream: derivedSeed(seed, companyId).
export function derivedSeed(baseSeed, key) {
  return (hashStringToSeed(String(baseSeed) + ":" + key) >>> 0);
}

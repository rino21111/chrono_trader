import { describe, it, expect } from "./harness.js";
import { mulberry32, derivedSeed, hashStringToSeed } from "../src/domain/rng.js";

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(1337);
    const b = mulberry32(1337);
    for (let i = 0; i < 100; i += 1) expect(a()).toBe(b());
  });

  it("produces different streams for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let anyDifferent = false;
    for (let i = 0; i < 10; i += 1) if (a() !== b()) anyDifferent = true;
    expect(anyDifferent).toBeTruthy();
  });

  it("returns values in [0, 1)", () => {
    const r = mulberry32(42);
    for (let i = 0; i < 1000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("derivedSeed is stable and key-sensitive", () => {
    expect(derivedSeed(1337, "helix-compute")).toBe(derivedSeed(1337, "helix-compute"));
    expect(derivedSeed(1337, "helix-compute") === derivedSeed(1337, "orchard")).toBeFalsy();
    expect(hashStringToSeed("abc")).toBe(hashStringToSeed("abc"));
  });
});

import { describe, it, expect } from "vitest";
import { findMatches, toleranceFor, DEFAULT_PAIRING } from "../src/domain/pairing";

describe("pairing", () => {
  it("tolerância cresce com o tempo de espera", () => {
    const t0 = toleranceFor(0);
    const t60 = toleranceFor(60);
    expect(t60).toBeGreaterThan(t0);
    expect(t0).toBe(DEFAULT_PAIRING.baseTolerance);
  });

  it("forma par quando a diferença cabe na tolerância dos dois", () => {
    const now = 100_000;
    const entries = [
      { playerId: "a", rating: 1500, enqueuedAt: now - 1000 },
      { playerId: "b", rating: 1540, enqueuedAt: now - 1000 },
    ];
    const { pairs, remaining } = findMatches(entries, now);
    expect(pairs).toHaveLength(1);
    expect(remaining).toHaveLength(0);
  });

  it("NÃO forma par quando a diferença estoura a tolerância (recém-chegados)", () => {
    const now = 100_000;
    const entries = [
      { playerId: "a", rating: 1000, enqueuedAt: now },
      { playerId: "b", rating: 2000, enqueuedAt: now },
    ];
    const { pairs } = findMatches(entries, now);
    expect(pairs).toHaveLength(0);
  });

  it("host = quem esperou mais", () => {
    const now = 100_000;
    const entries = [
      { playerId: "a", rating: 1500, enqueuedAt: now - 5000 },
      { playerId: "b", rating: 1510, enqueuedAt: now - 9000 },
    ];
    const { pairs } = findMatches(entries, now);
    expect(pairs[0].host.playerId).toBe("b");
  });
});

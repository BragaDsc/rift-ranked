import { describe, it, expect } from "vitest";
import { penaltyFor } from "../src/domain/conduct";

describe("conduct — escada de punição", () => {
  it("1 strike = só aviso (sem ban)", () => {
    expect(penaltyFor(1).banMs).toBe(0);
  });

  it("escala com os strikes ativos", () => {
    expect(penaltyFor(2).banMs).toBeGreaterThan(0);
    expect(penaltyFor(3).banMs).toBeGreaterThan(penaltyFor(2).banMs);
    expect(penaltyFor(4).banMs).toBeGreaterThan(penaltyFor(3).banMs);
  });

  it("5+ strikes = maior punição (7 dias)", () => {
    expect(penaltyFor(5).banMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(penaltyFor(9).banMs).toBe(penaltyFor(5).banMs);
  });
});

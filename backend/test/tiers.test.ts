import { describe, it, expect } from "vitest";
import { rankFor, PLACEMENT_GAMES } from "../src/domain/tiers";

describe("tiers", () => {
  it("poucas partidas → não classificado (colocação)", () => {
    const r = rankFor(1800, PLACEMENT_GAMES - 1);
    expect(r.status).toBe("unranked");
    if (r.status === "unranked") expect(r.gamesNeeded).toBe(1);
  });

  it("1400 → Ouro (com divisão e LP)", () => {
    const r = rankFor(1400, 10);
    expect(r.status).toBe("ranked");
    if (r.status === "ranked") {
      expect(r.tier).toBe("Ouro");
      expect(r.apex).toBe(false);
      expect(r.division).not.toBeNull();
      expect(r.lp).toBeGreaterThanOrEqual(0);
    }
  });

  it("rating baixíssimo cai em Bronze, não quebra", () => {
    const r = rankFor(600, 10);
    expect(r.status).toBe("ranked");
    if (r.status === "ranked") expect(r.tier).toBe("Bronze");
  });

  it("tier alto é apex (sem divisão)", () => {
    const r = rankFor(2600, 20);
    expect(r.status).toBe("ranked");
    if (r.status === "ranked") {
      expect(r.apex).toBe(true);
      expect(r.division).toBeNull();
    }
  });
});

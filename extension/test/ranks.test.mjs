import { describe, it, expect } from "vitest";
import { fullRank, shade, emblem, RK_TIERS } from "../src/content/ranks.ts";

describe("ranks — fullRank", () => {
  it("no piso do 1º tier cai em Bronze IV", () => {
    const r = fullRank(1000, "pt");
    expect(r.name).toBe("Bronze");
    expect(r.division).toBe("IV");
    expect(r.apex).toBe(false);
  });

  it("divisões sobem dentro do tier (Ouro)", () => {
    // Ouro = [1400,1600); banda de 50 pts por divisão
    expect(fullRank(1400, "pt").division).toBe("IV");
    expect(fullRank(1590, "pt").division).toBe("I");
    expect(fullRank(1450, "pt").name).toBe("Ouro");
  });

  it("apex (Mestre+) não tem divisão e usa LP acumulado", () => {
    const r = fullRank(2250, "pt"); // >= 2200 = Mestre (índice 6)
    expect(r.apex).toBe(true);
    expect(r.division).toBe(null);
    expect(r.lp).toBeGreaterThan(0);
  });

  it("respeita o idioma", () => {
    expect(fullRank(1450, "en").name).toBe("Gold");
    expect(fullRank(1450, "zh").name).toBe("黄金");
    expect(fullRank(1450, "xx").name).toBe("Gold"); // fallback en
  });

  it("LP fica entre 0 e 100", () => {
    for (const mmr of [1000, 1234, 1599, 1801, 2199]) {
      const r = fullRank(mmr, "en");
      if (!r.apex) { expect(r.lp).toBeGreaterThanOrEqual(0); expect(r.lp).toBeLessThanOrEqual(100); }
    }
  });
});

describe("ranks — shade/emblem", () => {
  it("shade clareia e escurece", () => {
    expect(shade("#808080", 1)).toBe("#ffffff");
    expect(shade("#808080", -1)).toBe("#000000");
  });
  it("emblem gera um SVG", () => {
    const svg = emblem(RK_TIERS[2][1], "II", false, 36);
    expect(svg).toContain("<svg");
    expect(svg).toContain("II");
  });
});

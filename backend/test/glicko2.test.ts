import { describe, it, expect } from "vitest";
import { defaultState, rateSingle, decay, rate } from "../src/rating/glicko2";

describe("glicko2", () => {
  it("estado inicial: 1500 / 350 / 0.06", () => {
    expect(defaultState()).toEqual({ rating: 1500, rd: 350, vol: 0.06 });
  });

  it("vencer sobe o rating e reduz a incerteza (RD)", () => {
    const d = defaultState();
    const after = rateSingle(d, d, 1);
    expect(after.rating).toBeGreaterThan(1500);
    expect(after.rd).toBeLessThan(350);
  });

  it("perder desce o rating", () => {
    const d = defaultState();
    const after = rateSingle(d, d, 0);
    expect(after.rating).toBeLessThan(1500);
  });

  it("decay (sem jogos) aumenta a RD e mantém o rating", () => {
    const start = { rating: 1600, rd: 80, vol: 0.06 };
    const after = decay(start);
    expect(after.rating).toBe(1600);
    expect(after.rd).toBeGreaterThan(80);
  });

  it("período sem jogos == decay", () => {
    const start = { rating: 1500, rd: 200, vol: 0.06 };
    expect(rate(start, [])).toEqual(decay(start));
  });

  it("ganhar de um oponente muito mais forte sobe mais do que de um mais fraco", () => {
    const me = defaultState();
    const strong = { rating: 2000, rd: 60, vol: 0.06 };
    const weak = { rating: 1000, rd: 60, vol: 0.06 };
    const vsStrong = rateSingle(me, strong, 1).rating;
    const vsWeak = rateSingle(me, weak, 1).rating;
    expect(vsStrong).toBeGreaterThan(vsWeak);
  });
});

import { describe, it, expect } from "vitest";
import { initScoreWatch, applyReport, seriesLeader } from "../src/domain/scoreWatch";

describe("scoreWatch — placar semi-autoritativo (corroboração dos 2 clientes)", () => {
  it("credita o jogo só quando OS DOIS clientes corroboram o 8", () => {
    const w = initScoreWatch();
    applyReport(w, "host", 8, 5);        // só o host reportou
    expect(seriesLeader(w, "bo1")).toBe(null);
    applyReport(w, "joiner", 8, 5);      // joiner corrobora
    expect(w.gameWins.host).toBe(1);
    expect(seriesLeader(w, "bo1")).toBe("host");
  });

  it("um cliente sozinho NÃO decide (anti-trapaça)", () => {
    const w = initScoreWatch();
    applyReport(w, "host", 8, 0);
    applyReport(w, "host", 8, 0); // insiste sozinho
    expect(w.gameWins.host).toBe(0);
    expect(seriesLeader(w, "bo1")).toBe(null);
  });

  it("clientes contraditórios não creditam ninguém", () => {
    const w = initScoreWatch();
    applyReport(w, "host", 8, 3);   // host diz que host venceu
    applyReport(w, "joiner", 3, 8); // joiner diz que joiner venceu
    expect(seriesLeader(w, "bo1")).toBe(null);
  });

  it("Md3: corrobora 2 jogos (com reset entre eles) → líder da série", () => {
    const w = initScoreWatch();
    // jogo 1 — host vence (corroborado)
    applyReport(w, "host", 8, 4); applyReport(w, "joiner", 8, 4);
    // reset (novo jogo, os dois < 8)
    applyReport(w, "host", 0, 0); applyReport(w, "joiner", 0, 0);
    expect(seriesLeader(w, "bo3")).toBe(null); // 1–0 ainda não decide bo3
    // jogo 2 — host vence (corroborado)
    applyReport(w, "host", 8, 2); applyReport(w, "joiner", 8, 2);
    expect(w.gameWins.host).toBe(2);
    expect(seriesLeader(w, "bo3")).toBe("host");
  });

  it("não conta o mesmo jogo duas vezes sem reset", () => {
    const w = initScoreWatch();
    applyReport(w, "host", 8, 1); applyReport(w, "joiner", 8, 1);
    applyReport(w, "host", 8, 1); applyReport(w, "joiner", 8, 1); // repete sem cair de 8
    expect(w.gameWins.host).toBe(1);
  });
});

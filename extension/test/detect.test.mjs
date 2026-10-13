import { describe, it, expect } from "vitest";
import D from "../src/detect.js"; // detect.js é CJS (module.exports) → import default traz a api

describe("detect — jogo único (Md1)", () => {
  it("conta vitória ao chegar a 8 depois de ver o jogo em andamento", () => {
    const st = D.initDetect();
    D.applyScores(st, { a: 0, b: 0 });
    D.applyScores(st, { a: 7, b: 5 });
    const r = D.applyScores(st, { a: 8, b: 5 });
    expect(r.countedGame).toBe(true);
    expect(D.seriesWinner(st, "bo1")).toBe("a");
  });

  it("NÃO conta um '8' obsoleto visto logo no 1º frame (estado herdado entre partidas)", () => {
    const st = D.initDetect();
    const r = D.applyScores(st, { a: 8, b: 3 }); // nunca vimos placar < 8 nesta partida
    expect(r.countedGame).toBe(false);
    expect(D.seriesWinner(st, "bo1")).toBe(null);
  });

  it("não conta o mesmo jogo duas vezes (frame repetido)", () => {
    const st = D.initDetect();
    D.applyScores(st, { a: 1, b: 0 });
    D.applyScores(st, { a: 8, b: 0 });
    D.applyScores(st, { a: 8, b: 0 });
    expect(st.gameWins.a).toBe(1);
  });
});

describe("detect — série (Md3)", () => {
  it("2–0 encerra a série", () => {
    const st = D.initDetect();
    D.applyScores(st, { a: 0, b: 0 }); D.applyScores(st, { a: 8, b: 4 }); // a 1-0
    D.applyScores(st, { a: 0, b: 0 }); D.applyScores(st, { a: 8, b: 2 }); // a 2-0
    expect(D.seriesWinner(st, "bo3")).toBe("a");
    expect(st.gameWins.a).toBe(2);
  });

  it("1–1 não encerra; 2–1 encerra", () => {
    const st = D.initDetect();
    D.applyScores(st, { a: 1, b: 0 }); D.applyScores(st, { a: 8, b: 3 }); // a 1-0
    D.applyScores(st, { a: 0, b: 1 }); D.applyScores(st, { a: 3, b: 8 }); // b 1-1
    expect(D.seriesWinner(st, "bo3")).toBe(null);
    D.applyScores(st, { a: 1, b: 0 }); D.applyScores(st, { a: 8, b: 6 }); // a 2-1
    expect(D.seriesWinner(st, "bo3")).toBe("a");
  });

  it("em Md1 uma única vitória já encerra (não espera a 2ª)", () => {
    const st = D.initDetect();
    D.applyScores(st, { a: 2, b: 2 }); D.applyScores(st, { a: 8, b: 2 });
    expect(D.seriesWinner(st, "bo1")).toBe("a");
  });

  it("seriesNeed: bo1=1, bo3=2", () => {
    expect(D.seriesNeed("bo1")).toBe(1);
    expect(D.seriesNeed("bo3")).toBe(2);
  });
});

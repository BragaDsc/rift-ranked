import { describe, it, expect } from "vitest";
import { createMatch, transition, isTerminal, IllegalTransitionError } from "../src/domain/match";

function fresh() {
  return createMatch({ id: "m1", format: "bo3", hostId: "h", joinerId: "j", now: 0 });
}

describe("match (máquina de estados)", () => {
  it("ciclo feliz: MATCHED → ROOM_READY → IN_GAME → RESOLVED → RATED", () => {
    let m = fresh();
    expect(m.state).toBe("MATCHED");
    m = transition(m, { type: "ROOM_CODE", roomCode: "ABCD" });
    expect(m.state).toBe("ROOM_READY");
    expect(m.roomCode).toBe("ABCD");
    m = transition(m, { type: "GAME_STARTED", at: 1 });
    expect(m.state).toBe("IN_GAME");
    m = transition(m, { type: "RESOLVE", winnerId: "h", reason: "score", at: 2 });
    expect(m.state).toBe("RESOLVED");
    expect(m.winnerId).toBe("h");
    m = transition(m, { type: "MARK_RATED" });
    expect(m.state).toBe("RATED");
    expect(isTerminal(m)).toBe(true);
  });

  it("transição ilegal lança (GAME_STARTED fora de ROOM_READY)", () => {
    const m = fresh();
    expect(() => transition(m, { type: "GAME_STARTED", at: 1 })).toThrow(IllegalTransitionError);
  });

  it("CANCEL é permitido antes do resultado", () => {
    const m = transition(fresh(), { type: "CANCEL", at: 5 });
    expect(m.state).toBe("CANCELLED");
    expect(isTerminal(m)).toBe(true);
  });

  it("GAME_SCORE atualiza o placar da série", () => {
    let m = transition(fresh(), { type: "ROOM_CODE", roomCode: "AAAA" });
    m = transition(m, { type: "GAME_STARTED", at: 1 });
    m = transition(m, { type: "GAME_SCORE", host: 1, joiner: 0 });
    expect(m.gamesWon).toEqual({ host: 1, joiner: 0 });
  });
});

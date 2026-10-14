import { describe, it, expect } from "vitest";
import { InMemoryRepository } from "../src/server/repository";
import { applyRatedResult, PROVISIONAL_CAP } from "../src/server/ratingService";
import { rateSingle, defaultState } from "../src/rating/glicko2";

describe("ratingService — teto de variação de MMR por partida", () => {
  it("dois jogadores novos (RD alto): a variação é limitada ao teto provisório", async () => {
    // sanity: sem teto, o swing de 1 jogo entre novatos passaria do teto
    const raw = rateSingle(defaultState(), defaultState(), 1);
    expect(raw.rating - 1500).toBeGreaterThan(PROVISIONAL_CAP);

    const repo = new InMemoryRepository();
    const h = await repo.getOrCreatePlayer({ clerkUserId: "H", displayName: "H" });
    const j = await repo.getOrCreatePlayer({ clerkUserId: "J", displayName: "J" });
    const applied = await applyRatedResult(repo as any, { matchId: "M", format: "bo1", hostId: h.id, joinerId: j.id, winnerId: h.id, reason: "score" });

    expect(applied!.host.after - applied!.host.before).toBe(PROVISIONAL_CAP);   // +100
    expect(applied!.joiner.before - applied!.joiner.after).toBe(PROVISIONAL_CAP); // -100
    // RD continua caindo (o Glicko segue evoluindo a incerteza)
    const after = await repo.getRating(h.id, "bo1");
    expect(after.rd).toBeLessThan(350);
    expect(after.rating).toBe(1600);
  });

  it("partida anulada (winnerId null) não muda o MMR", async () => {
    const repo = new InMemoryRepository();
    const h = await repo.getOrCreatePlayer({ clerkUserId: "H", displayName: "H" });
    const j = await repo.getOrCreatePlayer({ clerkUserId: "J", displayName: "J" });
    const applied = await applyRatedResult(repo as any, { matchId: "M", format: "bo1", hostId: h.id, joinerId: j.id, winnerId: null, reason: "double_no_show" });
    expect(applied).toBe(null);
    expect((await repo.getRating(h.id, "bo1")).rating).toBe(1500);
  });
});

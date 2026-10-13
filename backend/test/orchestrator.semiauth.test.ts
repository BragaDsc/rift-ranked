import { describe, it, expect } from "vitest";
import { Orchestrator, DEFAULT_CONFIG } from "../src/server/orchestrator";
import { InMemoryRepository } from "../src/server/repository";
import { createMatch } from "../src/domain/match";

// Monta uma partida já IN_GAME entre dois jogadores reais do repo em memória.
async function setup(format: "bo1" | "bo3" = "bo1") {
  const repo = new InMemoryRepository();
  const sent: { pid: string; msg: any }[] = [];
  const orch = new Orchestrator(repo as any, (pid: string, msg: any) => sent.push({ pid, msg }), DEFAULT_CONFIG);
  const h = await repo.getOrCreatePlayer({ clerkUserId: "H", displayName: "Host" });
  const j = await repo.getOrCreatePlayer({ clerkUserId: "J", displayName: "Joiner" });
  // ambos conectados (presença), como numa partida real
  orch.onConnected(h.id, "Host");
  orch.onConnected(j.id, "Joiner");
  const m = createMatch({ id: "M", format, hostId: h.id, joinerId: j.id, now: 0 });
  (orch as any).matches.set("M", m);
  (orch as any).playerMatch.set(h.id, "M");
  (orch as any).playerMatch.set(j.id, "M");
  (orch as any).apply(m, { type: "ROOM_CODE", roomCode: "AAAA" });
  (orch as any).apply((orch as any).matches.get("M"), { type: "GAME_STARTED", at: 0 });
  return { repo, orch, sent, h: h.id, j: j.id };
}

const resolvedFor = (sent: any[], pid: string) =>
  sent.find((s) => s.pid === pid && s.msg.type === "match_resolved")?.msg;

describe("orchestrator — placar semi-autoritativo (#7)", () => {
  it("na DIVERGÊNCIA, o vencedor corroborado pelos dois placares decide (não os likes)", async () => {
    const { orch, sent, h, j } = await setup("bo1");
    // os DOIS clientes corroboram: host 8 x 5 joiner  → host venceu o jogo
    orch.onGameScore(h, "M", 8, 5);
    orch.onGameScore(j, "M", 8, 5);
    // divergência na confirmação: cada um reivindica a si mesmo
    await orch.onConfirmResult(h, "M", "me", null); // host diz: host venceu
    await orch.onConfirmResult(j, "M", "me", null); // joiner diz: joiner venceu

    const rh = resolvedFor(sent, h);
    const rj = resolvedFor(sent, j);
    expect(rh).toBeTruthy();
    expect(rh.youWon).toBe(true);   // host venceu, conforme o placar corroborado
    expect(rj.youWon).toBe(false);
    expect((orch as any).matches.get("M").state).toBe("RATED");
  });

  it("um cliente sozinho forjando placar NÃO vira verdade (sem corroboração → cai na confirmação)", async () => {
    const { orch, sent, h, j } = await setup("bo1");
    orch.onGameScore(h, "M", 8, 0); // só o host afirma 8 (joiner não corrobora)
    // divergência na confirmação, SEM placar corroborado
    await orch.onConfirmResult(h, "M", "me", null);
    await orch.onConfirmResult(j, "M", "me", null);
    // 1ª divergência sem corroboração → re-pergunta (não finaliza ainda)
    expect(resolvedFor(sent, h)).toBeFalsy();
    expect(sent.some((s) => s.msg.type === "confirm_again")).toBe(true);
  });

  it("quando os dois CONCORDAM, finaliza com o vencedor combinado", async () => {
    const { orch, sent, h, j } = await setup("bo1");
    orch.onGameScore(h, "M", 2, 8);
    orch.onGameScore(j, "M", 2, 8); // joiner venceu (corroborado)
    await orch.onConfirmResult(h, "M", "opp", null); // host diz: joiner venceu
    await orch.onConfirmResult(j, "M", "me", null);  // joiner diz: joiner venceu → acordo
    expect(resolvedFor(sent, j).youWon).toBe(true);
    expect(resolvedFor(sent, h).youWon).toBe(false);
  });

  it("oponente desconectou (desistiu/saiu): a confirmação de quem ficou resolve na hora", async () => {
    const { orch, sent, h, j } = await setup("bo1");
    orch.onGameScore(h, "M", 8, 2);
    orch.onGameScore(j, "M", 8, 2); // host venceu (corroborado)
    orch.onDisconnected(j);          // oponente saiu da partida
    await orch.onConfirmResult(h, "M", "me", null); // host confirma; não há quem confirmar do outro lado
    expect(resolvedFor(sent, h).youWon).toBe(true);
    expect((orch as any).matches.get("M").state).toBe("RATED");
  });
});

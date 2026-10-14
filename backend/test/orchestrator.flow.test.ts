import { describe, it, expect } from "vitest";
import { Orchestrator, DEFAULT_CONFIG } from "../src/server/orchestrator";
import { InMemoryRepository } from "../src/server/repository";

// Teste de integração: exercita o caminho feliz de ponta a ponta sem sockets,
// usando o repositório em memória e capturando as mensagens enviadas.
async function fresh() {
  const repo = new InMemoryRepository();
  const sent: { pid: string; msg: any }[] = [];
  const orch = new Orchestrator(repo as any, (pid: string, msg: any) => sent.push({ pid, msg }), DEFAULT_CONFIG);
  const h = await repo.getOrCreatePlayer({ clerkUserId: "H", displayName: "Host" });
  const j = await repo.getOrCreatePlayer({ clerkUserId: "J", displayName: "Joiner" });
  orch.onConnected(h.id, "Host");
  orch.onConnected(j.id, "Joiner");
  return { repo, orch, sent, h: h.id, j: j.id };
}

describe("orchestrator — fluxo de integração", () => {
  it("fila → pareia → sala → jogo → confirma → resolve, e limpa a memória", async () => {
    const { orch, sent, h, j } = await fresh();
    await orch.onEnqueue(h, "bo1");
    await orch.onEnqueue(j, "bo1");
    await orch.tick(); // pareia

    const mf = sent.find((s) => s.msg.type === "match_found");
    expect(mf).toBeTruthy();
    const matchId = mf!.msg.matchId;
    const m = (orch as any).matches.get(matchId);
    const hostId = m.hostId, joinerId = m.joinerId;

    orch.onRoomCode(hostId, matchId, "AAAA");
    orch.onGameStarted(hostId, matchId);
    orch.onGameStarted(joinerId, matchId);
    orch.onGameScore(hostId, matchId, 8, 3);
    orch.onGameScore(joinerId, matchId, 8, 3); // host venceu (corroborado)
    await orch.onConfirmResult(hostId, matchId, "me", "like");
    await orch.onConfirmResult(joinerId, matchId, "opp", "like"); // concordam: host venceu

    const rh = sent.find((s) => s.pid === hostId && s.msg.type === "match_resolved");
    expect(rh?.msg.youWon).toBe(true);
    expect(sent.find((s) => s.pid === joinerId && s.msg.type === "match_resolved")?.msg.youWon).toBe(false);
    // partida resolvida é removida da memória (evita vazamento)
    expect((orch as any).matches.has(matchId)).toBe(false);
    expect((orch as any).playerMatch.has(hostId)).toBe(false);
  });

  it("enqueue com formato inválido não quebra e avisa o jogador", async () => {
    const { orch, sent, h } = await fresh();
    await orch.onEnqueue(h, "xxx" as any);
    expect(sent.some((s) => s.pid === h && s.msg.type === "error")).toBe(true);
    expect((orch as any).playerMatch.has(h)).toBe(false);
  });

  it("stats() reporta online, partidas ativas e tamanho das filas", async () => {
    const { orch, h } = await fresh();
    await orch.onEnqueue(h, "bo1");
    const s = orch.stats();
    expect(s.queued.bo1).toBe(1);
    expect(s.queued.bo3).toBe(0);
    expect(typeof s.activeMatches).toBe("number");
  });
});

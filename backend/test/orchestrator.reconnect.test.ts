import { describe, it, expect } from "vitest";
import { Orchestrator, DEFAULT_CONFIG } from "../src/server/orchestrator";
import { InMemoryRepository } from "../src/server/repository";

/**
 * Regressão do bug de RECONEXÃO (o oponente sai e volta no meio da partida).
 *
 * Sintoma original: quando um jogador caía, a partida entrava em ABANDON_GRACE e,
 * mesmo o jogador voltando dentro da janela de 1 min, o backend "não entendia que
 * ele voltou" e encerrava por W.O. Correção: onConnected despacha RECONNECT quando
 * a partida está em ABANDON_GRACE e cancela o prazo de grace.
 *
 * Relógio injetável (clock.t) para exercitar a janela de grace de forma determinística.
 */
async function matchInGame() {
  const clock = { t: 1_000_000 };
  const repo = new InMemoryRepository();
  const sent: { pid: string; msg: any }[] = [];
  const orch = new Orchestrator(
    repo as any,
    (pid: string, msg: any) => sent.push({ pid, msg }),
    DEFAULT_CONFIG,
    () => clock.t,
  );
  const h = await repo.getOrCreatePlayer({ clerkUserId: "H", displayName: "Host" });
  const j = await repo.getOrCreatePlayer({ clerkUserId: "J", displayName: "Joiner" });
  orch.onConnected(h.id, "Host");
  orch.onConnected(j.id, "Joiner");
  await orch.onEnqueue(h.id, "bo1");
  await orch.onEnqueue(j.id, "bo1");
  await orch.tick(); // pareia

  const mf = sent.find((s) => s.msg.type === "match_found")!;
  const matchId = mf.msg.matchId as string;
  const m0 = (orch as any).matches.get(matchId);
  const hostId = m0.hostId as string;
  const joinerId = m0.joinerId as string;
  orch.onRoomCode(hostId, matchId, "AAAA");
  orch.onGameStarted(hostId, matchId);
  orch.onGameStarted(joinerId, matchId);
  expect((orch as any).matches.get(matchId).state).toBe("IN_GAME");
  return { orch, sent, clock, matchId, hostId, joinerId };
}

const st = (orch: any, id: string) => orch.matches.get(id)?.state;

describe("orchestrator — reconexão dentro da janela de grace", () => {
  it("oponente cai e VOLTA dentro de 1 min: partida volta a IN_GAME, sem W.O.", async () => {
    const { orch, sent, clock, matchId, joinerId } = await matchInGame();

    // cai
    orch.onDisconnected(joinerId);
    expect(st(orch, matchId)).toBe("ABANDON_GRACE");
    expect((orch as any).deadlines.has(matchId)).toBe(true);

    // passa 30s (ainda dentro da janela de 60s) e roda o relógio do servidor
    clock.t += 30_000;
    await orch.tick();
    expect(st(orch, matchId)).toBe("ABANDON_GRACE"); // não resolveu ainda

    // VOLTA
    orch.onConnected(joinerId, "Joiner");
    expect(st(orch, matchId)).toBe("IN_GAME");                       // voltou pro jogo
    expect((orch as any).deadlines.has(matchId)).toBe(false);        // prazo de grace cancelado
    const dc = (orch as any).matches.get(matchId).disconnectedAt;
    expect(Object.keys(dc).length).toBe(0);                          // ninguém marcado como caído

    // e não houve W.O.
    expect(sent.some((s) => s.msg.type === "match_resolved")).toBe(false);

    // segue jogável: um tick depois NÃO encerra a partida
    clock.t += 5_000;
    await orch.tick();
    expect(st(orch, matchId)).toBe("IN_GAME");
  });

  it("oponente cai e NÃO volta: após a janela, resolve por W.O. para quem ficou", async () => {
    const { orch, sent, clock, matchId, hostId, joinerId } = await matchInGame();

    orch.onDisconnected(joinerId);
    expect(st(orch, matchId)).toBe("ABANDON_GRACE");

    // passa a janela inteira (> 60s) sem voltar
    clock.t += DEFAULT_CONFIG.reconnectGraceMs + 1_000;
    await orch.tick();

    const wo = sent.find((s) => s.msg.type === "match_resolved");
    expect(wo?.msg.reason).toBe("walkover");
    // quem ficou (host) vence; quem caiu (joiner) perde
    expect(sent.find((s) => s.pid === hostId && s.msg.type === "match_resolved")?.msg.youWon).toBe(true);
    expect(sent.find((s) => s.pid === joinerId && s.msg.type === "match_resolved")?.msg.youWon).toBe(false);
    // partida encerrada é removida da memória (sem vazamento)
    expect((orch as any).matches.has(matchId)).toBe(false);
  });

  it("os DOIS caem e nenhum volta: double no-show, partida anulada (sem mudança de MMR)", async () => {
    const { orch, sent, clock, matchId, hostId, joinerId } = await matchInGame();

    orch.onDisconnected(hostId);
    orch.onDisconnected(joinerId);
    clock.t += DEFAULT_CONFIG.reconnectGraceMs + 1_000;
    await orch.tick();

    const res = sent.find((s) => s.msg.type === "match_resolved");
    expect(res?.msg.reason).toBe("double_no_show");
    expect(res?.msg.youWon).toBe(null);
    expect((orch as any).matches.has(matchId)).toBe(false);
  });
});

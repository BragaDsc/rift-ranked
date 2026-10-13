import { describe, it, expect } from "vitest";
import { reconcile } from "../src/domain/reconcile";

const base = { hostConnected: true, joinerConnected: true, graceExpired: false };

describe("reconcile", () => {
  it("os dois concordam no vencedor → resolvido", () => {
    const r = reconcile({ ...base, reportHost: { outcome: "win" }, reportJoiner: { outcome: "loss" } });
    expect(r).toEqual({ status: "resolved", winner: "host", reason: "score" });
  });

  it("admissão de derrota resolve a favor do oponente (unilateral)", () => {
    const r = reconcile({ ...base, reportJoiner: { outcome: "conceded" } });
    expect(r).toEqual({ status: "resolved", winner: "host", reason: "concession" });
  });

  it("ambos dizem 'ganhei' → disputa", () => {
    const r = reconcile({ ...base, reportHost: { outcome: "win" }, reportJoiner: { outcome: "win" } });
    expect(r.status).toBe("dispute");
  });

  it("reivindicação unilateral com oponente presente → pendente", () => {
    const r = reconcile({ ...base, reportHost: { outcome: "win" } });
    expect(r.status).toBe("pending");
  });

  it("oponente ausente e grace expirado → W.O. para quem ficou", () => {
    const r = reconcile({ ...base, joinerConnected: false, graceExpired: true });
    expect(r).toEqual({ status: "resolved", winner: "host", reason: "walkover" });
  });

  it("os dois ausentes com grace expirado → anulada", () => {
    const r = reconcile({ ...base, hostConnected: false, joinerConnected: false, graceExpired: true });
    expect(r.status).toBe("double_no_show");
  });
});

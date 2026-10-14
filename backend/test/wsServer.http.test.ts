import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { once } from "node:events";
import { startServer } from "../src/server/wsServer";
import { InMemoryRepository } from "../src/server/repository";

// Testes de integração da camada HTTP: sobe o servidor de verdade (porta efêmera,
// repositório em memória) e exercita as rotas — inclusive validação e admin.
let server: ReturnType<typeof startServer>;
let base: string;

beforeAll(async () => {
  process.env.ADMIN_TOKEN = "test-token";
  server = startServer({ repo: new InMemoryRepository() as any, port: 0 });
  if (!server.httpServer.listening) await once(server.httpServer, "listening");
  const addr = server.httpServer.address() as any;
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => { await server.stop(); });

describe("wsServer — HTTP", () => {
  it("GET /api/health → ok", async () => {
    const r = await fetch(`${base}/ranked/api/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  it("GET /api/stats expõe os campos de observabilidade", async () => {
    const s = await (await fetch(`${base}/ranked/api/stats`)).json();
    expect(s).toHaveProperty("online");
    expect(s).toHaveProperty("activeMatches");
    expect(s.queued).toEqual({ bo1: 0, bo3: 0 });
    for (const k of ["authOk", "authFail", "authFailsLastHour"]) expect(s).toHaveProperty(k);
  });

  it("GET /api/online → { count }", async () => {
    const s = await (await fetch(`${base}/ranked/api/online`)).json();
    expect(typeof s.count).toBe("number");
  });

  it("GET /api/player sem id → 400; id inexistente → 404", async () => {
    expect((await fetch(`${base}/ranked/api/player`)).status).toBe(400);
    expect((await fetch(`${base}/ranked/api/player?id=nao-existe`)).status).toBe(404);
  });

  it("admin sem token → 403; com token → acessa", async () => {
    expect((await fetch(`${base}/ranked/api/admin/metrics`)).status).toBe(403);
    const r = await fetch(`${base}/ranked/api/admin/metrics`, { headers: { "x-admin-token": "test-token" } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.snapshots)).toBe(true);
    expect(body.live).toHaveProperty("online");
  });

  it("admin aceita token via Authorization: Bearer", async () => {
    const r = await fetch(`${base}/ranked/api/admin/metrics`, { headers: { authorization: "Bearer test-token" } });
    expect(r.status).toBe(200);
  });

  it("reset-season exige confirm=RESET e falha sem suporte no repo", async () => {
    const h = { "x-admin-token": "test-token" };
    expect((await fetch(`${base}/ranked/api/admin/reset-season`, { method: "POST", headers: h })).status).toBe(400);
    // InMemory não implementa resetSeason → 501 com confirm correto
    expect((await fetch(`${base}/ranked/api/admin/reset-season?confirm=RESET`, { method: "POST", headers: h })).status).toBe(501);
  });

  it("rota desconhecida → 404", async () => {
    expect((await fetch(`${base}/ranked/api/nope`)).status).toBe(404);
  });
});

import { describe, it, expect } from "vitest";
import { decodeJwt, identityFromClaims } from "../src/inpage/identity.ts";

// Helper: monta um JWT base64url com o payload dado (assinatura falsa — só o
// payload importa pro decode no cliente).
function jwt(payload) {
  const b64url = (o) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "RS256" })}.${b64url(payload)}.ZmFrZQ`;
}

describe("decodeJwt", () => {
  it("decodifica o payload de um JWT base64url", () => {
    const p = decodeJwt(jwt({ sub: "user_123", nickname: "Ramon" }));
    expect(p.sub).toBe("user_123");
    expect(p.nickname).toBe("Ramon");
  });
  it("decodifica acentos corretamente (UTF-8, não atob cru)", () => {
    const p = decodeJwt(jwt({ sub: "u", nickname: "Fabrício", name: "João Conceição" }));
    expect(p.nickname).toBe("Fabrício");
    expect(p.name).toBe("João Conceição");
    expect(identityFromClaims(p)).toEqual({ id: "u", username: "Fabrício" });
  });
  it("tolera lixo sem quebrar (retorna null)", () => {
    expect(decodeJwt("")).toBe(null);
    expect(decodeJwt(null)).toBe(null);
    expect(decodeJwt("não-é-jwt")).toBe(null);
    expect(decodeJwt("a.b")).not.toBe(undefined); // não lança
  });
});

describe("identityFromClaims — regressão do bug de auth (identidade via cookie)", () => {
  it("id = sub; usa nickname quando presente", () => {
    expect(identityFromClaims({ sub: "u1", nickname: "Rift", name: "Ramon Braga" }))
      .toEqual({ id: "u1", username: "Rift" });
  });
  it("precedência nickname → username → name → given_name → 'Jogador'", () => {
    expect(identityFromClaims({ sub: "u", username: "user_x", name: "N" }).username).toBe("user_x");
    expect(identityFromClaims({ sub: "u", name: "Fulano" }).username).toBe("Fulano");
    expect(identityFromClaims({ sub: "u", given_name: "Primeiro" }).username).toBe("Primeiro");
    expect(identityFromClaims({ sub: "u" }).username).toBe("Jogador");
  });
  it("sem sub → null (sessão inválida, não loga ninguém)", () => {
    expect(identityFromClaims({ name: "Sem Sub" })).toBe(null);
    expect(identityFromClaims(null)).toBe(null);
    expect(identityFromClaims({ sub: "" })).toBe(null);
  });
  it("fim-a-fim: do JWT do cookie até a identidade", () => {
    const token = jwt({ sub: "user_abc", nickname: "RamonBR", iss: "https://clerk.riftatlas.com", aud: "convex" });
    expect(identityFromClaims(decodeJwt(token))).toEqual({ id: "user_abc", username: "RamonBR" });
  });
});

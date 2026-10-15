/**
 * Identidade do jogador a partir do JWT do Clerk (cookie __session) — lógica PURA
 * e testável (sem document/cookie/atob embutidos, tudo recebido por parâmetro).
 *
 * Contexto: o RiftAtlas removeu window.Clerk; a identidade passou a vir do JWT no
 * cookie __session. Esta é a parte que já quebrou em produção, então fica coberta
 * por teste de regressão (ver extension/test/identity.test.mjs).
 */

export interface Identity { id: string; username: string; }

/** Decodifica o payload (claims) de um JWT base64url. Retorna null se inválido. */
export function decodeJwt(token: string | null | undefined): any {
  try {
    if (!token) return null;
    const b = token.split(".")[1];
    if (!b) return null;
    // base64url → base64 e decodifica
    const json = atob(b.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Extrai {id, username} dos claims do JWT do Clerk.
 *  - id  = claim `sub`
 *  - nome, por ordem de preferência: nickname → username → name → given_name → "Jogador"
 * Retorna null quando não há `sub` (sessão inválida/ausente).
 */
export function identityFromClaims(p: any): Identity | null {
  if (!p || typeof p.sub !== "string" || !p.sub) return null;
  const username =
    (typeof p.nickname === "string" && p.nickname) ||
    (typeof p.username === "string" && p.username) ||
    (typeof p.name === "string" && p.name) ||
    (typeof p.given_name === "string" && p.given_name) ||
    "Jogador";
  return { id: p.sub, username };
}

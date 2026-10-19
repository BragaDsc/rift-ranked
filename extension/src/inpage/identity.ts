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
    // base64url → base64 → bytes → UTF-8. atob() sozinho devolve uma string byte-a-byte
    // (Latin-1), o que CORROMPE acentos (ex.: "Fabrício" virava "FabrÃ­cio"). Decodificar
    // os bytes como UTF-8 preserva o nome correto.
    const bin = atob(b.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
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
  // o token do template Convex do RiftAtlas guarda o nome dentro de `metadata`
  const m = (p && typeof p.metadata === "object" && p.metadata) || {};
  const username =
    (typeof p.nickname === "string" && p.nickname) ||
    (typeof p.username === "string" && p.username) ||
    (typeof p.name === "string" && p.name) ||
    (typeof p.given_name === "string" && p.given_name) ||
    (typeof m.username === "string" && m.username) ||
    (typeof m.name === "string" && m.name) ||
    (typeof m.displayName === "string" && m.displayName) ||
    (typeof m.firstName === "string" && m.firstName) ||
    "Jogador";
  return { id: p.sub, username };
}

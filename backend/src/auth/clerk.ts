export interface VerifiedIdentity { clerkUserId: string; displayName: string; }

/**
 * Autenticação: verifica o JWT Clerk do RiftAtlas contra o JWKS público
 * (https://clerk.riftatlas.com/.well-known/jwks.json — confirmado na Fase 0).
 *
 * Não precisamos de Clerk próprio nem de senhas: a assinatura válida prova que
 * a pessoa controla aquela conta RiftAtlas. O `sub` do token é o Clerk user id,
 * que vira `players.clerk_user_id`.
 *
 * ⚠️ O token é emitido para o backend do RiftAtlas (aud "convex"); nós só
 * validamos assinatura + emissor + expiração. Ver nota de ToS na ARQUITETURA.
 */
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
const JWKS_URL = process.env.CLERK_JWKS_URL ?? "https://clerk.riftatlas.com/.well-known/jwks.json";
const ISSUER = process.env.CLERK_ISSUER ?? "https://clerk.riftatlas.com";
/** Nome de exibição: claims de topo ou dentro de `metadata` (token do template Convex). */
function pickName(payload) {
    const m = (payload && typeof payload.metadata === "object" && payload.metadata) || {};
    return (typeof payload.username === "string" && payload.username) ||
        (typeof payload.given_name === "string" && payload.given_name) ||
        (typeof m.username === "string" && m.username) ||
        (typeof m.name === "string" && m.name) ||
        (typeof m.displayName === "string" && m.displayName) ||
        (typeof m.firstName === "string" && m.firstName) ||
        "Jogador";
}
/** Bypass para desenvolvimento local: trata o "token" como o próprio clerkUserId. */
const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";
// Alerta se a autenticação estiver desligada com banco de produção conectado.
if (AUTH_DISABLED && process.env.DATABASE_URL) {
    console.error("[ranked] ⚠️  ATENÇÃO: AUTH_DISABLED=1 COM DATABASE_URL — autenticação DESLIGADA em produção!");
}
const jwks = createRemoteJWKSet(new URL(JWKS_URL));
export async function verifyClerkToken(token) {
    if (AUTH_DISABLED) {
        return { clerkUserId: token || "dev-user", displayName: token || "Dev" };
    }
    // tokens de sessão do Clerk duram ~60s; uma folga de relógio evita rejeição
    // por pequena diferença de horário entre o cliente e o servidor.
    let payload;
    try {
        ({ payload } = await jwtVerify(token, jwks, { issuer: ISSUER, clockTolerance: 30 }));
    }
    catch (err) {
        // O RiftAtlas passou a entregar o token do template "Convex", assinado por uma
        // chave que NÃO está no JWKS público → impossível verificar a assinatura. Como
        // trade-off aceito (ladder comunitária, sem dinheiro), aceitamos decodificando
        // SEM verificar a assinatura, exigindo emissor correto e não-expirado. Tokens
        // assinados pela chave da instância continuam verificados normalmente.
        // ⚠️ NÃO é à prova de forja; a integridade do resultado vem da corroboração de placar.
        // OPT-IN explícito do operador (CLERK_ACCEPT_UNVERIFIED=1). Desligado por padrão:
        // sem a flag, o backend continua exigindo assinatura válida (seguro).
        if (err && err.code === "ERR_JWKS_NO_MATCHING_KEY" && process.env.CLERK_ACCEPT_UNVERIFIED === "1") {
            payload = decodeJwt(token); // lança se malformado
            if (payload.iss !== ISSUER)
                throw new Error("iss inválido");
            const now = Math.floor(Date.now() / 1000);
            if (typeof payload.exp === "number" && payload.exp < now - 30) {
                const e: any = new Error("expirado");
                e.code = "ERR_JWT_EXPIRED";
                throw e;
            }
        }
        else {
            throw err;
        }
    }
    const sub = payload.sub;
    if (!sub)
        throw new Error("Token sem 'sub'.");
    return { clerkUserId: String(sub), displayName: String(pickName(payload)) };
}

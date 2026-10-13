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
import { createRemoteJWKSet, jwtVerify } from "jose";
const JWKS_URL = process.env.CLERK_JWKS_URL ?? "https://clerk.riftatlas.com/.well-known/jwks.json";
const ISSUER = process.env.CLERK_ISSUER ?? "https://clerk.riftatlas.com";
/** Bypass para desenvolvimento local: trata o "token" como o próprio clerkUserId. */
const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";
const jwks = createRemoteJWKSet(new URL(JWKS_URL));
export async function verifyClerkToken(token) {
    if (AUTH_DISABLED) {
        return { clerkUserId: token || "dev-user", displayName: token || "Dev" };
    }
    const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER });
    const sub = payload.sub;
    if (!sub)
        throw new Error("Token sem 'sub'.");
    const name = (typeof payload.username === "string" && payload.username) ||
        (typeof payload.given_name === "string" && payload.given_name) ||
        "Jogador";
    return { clerkUserId: sub, displayName: String(name) };
}

import type { Format, PlayerId, ResultReason } from "../domain/types.js";
import type { Repository } from "./repository.js";
export interface AppliedRating { playerId: PlayerId; before: number; after: number; }
export interface ApplyResult { host: AppliedRating; joiner: AppliedRating; }

/**
 * Aplica Glicko-2 ao resultado de uma partida resolvida e persiste tudo.
 * Usa o modo "por partida" (feedback imediato); o batch diário (fonte de
 * verdade) recalcula depois a partir do rating_history.
 */
import { rateSingle } from "../rating/glicko2.js";
import { PROVISIONAL_RD } from "./repository.js";
/**
 * Teto de variação de MMR por partida (como o LP do LoL). Em um pool pequeno o
 * Glicko-2 por-jogo pode mover o MMR demais, ainda mais com jogadores provisórios
 * (RD alto) ou contra oponentes distantes. Limitamos a variação para a progressão
 * ser suave; o RD/volatility continuam evoluindo pelo Glicko (o jogador estabiliza
 * e passa a variar menos naturalmente).
 */
export const PROVISIONAL_CAP = 100; // durante a colocação (RD > PROVISIONAL_RD)
export const ESTABLISHED_CAP = 40;  // jogador já estabelecido
export function capRating(beforeRating, after, preRd) {
    const lim = preRd > PROVISIONAL_RD ? PROVISIONAL_CAP : ESTABLISHED_CAP;
    const d = after.rating - beforeRating;
    if (Math.abs(d) <= lim) return after;
    return { ...after, rating: beforeRating + Math.sign(d) * lim };
}
/**
 * `winnerId === null` significa partida anulada (no-show): nada muda no MMR.
 */
export async function applyRatedResult(repo, args) {
    const { format, hostId, joinerId, winnerId } = args;
    const hostR = await repo.getRating(hostId, format);
    const joinerR = await repo.getRating(joinerId, format);
    if (winnerId === null) {
        // anulada: sem mudança
        return null;
    }
    const hostBefore = { rating: hostR.rating, rd: hostR.rd, vol: hostR.vol };
    const joinerBefore = {
        rating: joinerR.rating,
        rd: joinerR.rd,
        vol: joinerR.vol,
    };
    const hostScore = winnerId === hostId ? 1 : 0;
    const joinerScore = winnerId === joinerId ? 1 : 0;
    // Importante: cada jogador é avaliado contra o estado do oponente ANTES da partida.
    const hostAfter = capRating(hostBefore.rating, rateSingle(hostBefore, joinerBefore, hostScore), hostBefore.rd);
    const joinerAfter = capRating(joinerBefore.rating, rateSingle(joinerBefore, hostBefore, joinerScore), joinerBefore.rd);
    const isWalkover = args.reason === "walkover";
    const hostWon = winnerId === hostId;
    await repo.saveRating({
        ...hostR,
        ...hostAfter,
        gamesPlayed: hostR.gamesPlayed + 1,
        wins: hostR.wins + (hostWon ? 1 : 0),
        losses: hostR.losses + (hostWon ? 0 : 1),
        walkoversFor: hostR.walkoversFor + (isWalkover && hostWon ? 1 : 0),
        walkoversAgainst: hostR.walkoversAgainst + (isWalkover && !hostWon ? 1 : 0),
        lastRatedAt: Date.now(),
    });
    await repo.saveRating({
        ...joinerR,
        ...joinerAfter,
        gamesPlayed: joinerR.gamesPlayed + 1,
        wins: joinerR.wins + (hostWon ? 0 : 1),
        losses: joinerR.losses + (hostWon ? 1 : 0),
        walkoversFor: joinerR.walkoversFor + (isWalkover && !hostWon ? 1 : 0),
        walkoversAgainst: joinerR.walkoversAgainst + (isWalkover && hostWon ? 1 : 0),
        lastRatedAt: Date.now(),
    });
    await repo.appendRatingHistory({
        playerId: hostId,
        matchId: args.matchId,
        format,
        before: hostBefore,
        after: hostAfter,
    });
    await repo.appendRatingHistory({
        playerId: joinerId,
        matchId: args.matchId,
        format,
        before: joinerBefore,
        after: joinerAfter,
    });
    return {
        host: { playerId: hostId, before: hostBefore.rating, after: hostAfter.rating },
        joiner: {
            playerId: joinerId,
            before: joinerBefore.rating,
            after: joinerAfter.rating,
        },
    };
}

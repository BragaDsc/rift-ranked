import type { PlayerId } from "./types.js";
export interface WaitingEntry { playerId: PlayerId; rating: number; enqueuedAt: number; }
export interface PairingConfig { baseTolerance: number; tolerancePerStep: number; stepSeconds: number; pairAnyAfterSeconds?: number; }
export interface Pair { host: WaitingEntry; joiner: WaitingEntry; ratingDiff: number; }
export interface PairingResult { pairs: Pair[]; remaining: WaitingEntry[]; }

/**
 * Pareamento por MMR dentro de uma fila (um formato).
 *
 * Regra: cada jogador tem uma tolerância de rating que CRESCE com o tempo de
 * espera. Um par só é formado quando a diferença de rating é aceitável para os
 * DOIS (consentimento mútuo). Como a tolerância cresce sem teto — e há um prazo
 * (`pairAnyAfterSeconds`) após o qual se pareia com qualquer um — dois jogadores
 * quaisquer acabam pareando rápido, o que importa num pool pequeno. A variação de
 * MMR por partida é limitada em outra camada, então um gap maior não desequilibra.
 *
 * Funções puras: nada de I/O, tudo recebe `nowMs` por parâmetro (testável).
 */
export const DEFAULT_PAIRING = {
    baseTolerance: 150,      // aceita gap até 150 de cara (≈ 1 divisão)
    tolerancePerStep: 100,   // alarga rápido com a espera
    stepSeconds: 10,
    pairAnyAfterSeconds: 40, // após 40s na fila, pareia com qualquer oponente
};
/** Tolerância de rating de um jogador dado quanto tempo ele já esperou. */
export function toleranceFor(waitSeconds, cfg = DEFAULT_PAIRING) {
    const steps = Math.max(0, Math.floor(waitSeconds / cfg.stepSeconds));
    return cfg.baseTolerance + cfg.tolerancePerStep * steps;
}
/** Dois jogadores se aceitam se a diferença cabe na tolerância de AMBOS. */
function mutuallyAcceptable(a, b, nowMs, cfg) {
    const waitA = (nowMs - a.enqueuedAt) / 1000;
    const waitB = (nowMs - b.enqueuedAt) / 1000;
    // espera longa de qualquer um dos dois → pareia com quem estiver disponível
    const any = cfg.pairAnyAfterSeconds ?? Infinity;
    if (Math.max(waitA, waitB) >= any) return true;
    const diff = Math.abs(a.rating - b.rating);
    return diff <= Math.min(toleranceFor(waitA, cfg), toleranceFor(waitB, cfg));
}
/**
 * Forma o máximo de pares possível nesta rodada, de forma gulosa e justa:
 * prioriza quem espera há mais tempo e, para cada um, escolhe o oponente
 * elegível de rating MAIS PRÓXIMO.
 *
 * `entries` deve conter apenas a fila de UM formato.
 */
export function findMatches(entries, nowMs, cfg = DEFAULT_PAIRING) {
    // Mais antigos primeiro (prioridade a quem espera mais).
    const ordered = [...entries].sort((x, y) => x.enqueuedAt - y.enqueuedAt);
    const used = new Set();
    const pairs = [];
    for (let i = 0; i < ordered.length; i++) {
        if (used.has(i))
            continue;
        const a = ordered[i];
        // Melhor oponente elegível (menor diferença de rating).
        let bestJ = -1;
        let bestDiff = Infinity;
        for (let j = i + 1; j < ordered.length; j++) {
            if (used.has(j))
                continue;
            const b = ordered[j];
            if (!mutuallyAcceptable(a, b, nowMs, cfg))
                continue;
            const diff = Math.abs(a.rating - b.rating);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestJ = j;
            }
        }
        if (bestJ !== -1) {
            const b = ordered[bestJ];
            used.add(i);
            used.add(bestJ);
            // host = quem entrou primeiro na fila (esperou mais).
            const [host, joiner] = a.enqueuedAt <= b.enqueuedAt ? [a, b] : [b, a];
            pairs.push({ host, joiner, ratingDiff: bestDiff });
        }
    }
    const remaining = ordered.filter((_, idx) => !used.has(idx));
    return { pairs, remaining };
}

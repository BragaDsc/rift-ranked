import type { PlayerId } from "./types.js";
export interface WaitingEntry { playerId: PlayerId; rating: number; enqueuedAt: number; }
export interface PairingConfig { baseTolerance: number; tolerancePerStep: number; stepSeconds: number; }
export interface Pair { host: WaitingEntry; joiner: WaitingEntry; ratingDiff: number; }
export interface PairingResult { pairs: Pair[]; remaining: WaitingEntry[]; }

/**
 * Pareamento por MMR dentro de uma fila (um formato).
 *
 * Regra: cada jogador tem uma tolerância de rating que CRESCE com o tempo de
 * espera. Um par só é formado quando a diferença de rating é aceitável para os
 * DOIS (consentimento mútuo) — evita jogar alguém recém-chegado num confronto
 * muito desigual. Como a tolerância cresce sem teto, dois jogadores quaisquer
 * acabam pareando se esperarem o bastante.
 *
 * Funções puras: nada de I/O, tudo recebe `nowMs` por parâmetro (testável).
 */
export const DEFAULT_PAIRING = {
    baseTolerance: 100,
    tolerancePerStep: 50,
    stepSeconds: 15,
};
/** Tolerância de rating de um jogador dado quanto tempo ele já esperou. */
export function toleranceFor(waitSeconds, cfg = DEFAULT_PAIRING) {
    const steps = Math.max(0, Math.floor(waitSeconds / cfg.stepSeconds));
    return cfg.baseTolerance + cfg.tolerancePerStep * steps;
}
/** Dois jogadores se aceitam se a diferença cabe na tolerância de AMBOS. */
function mutuallyAcceptable(a, b, nowMs, cfg) {
    const diff = Math.abs(a.rating - b.rating);
    const tolA = toleranceFor((nowMs - a.enqueuedAt) / 1000, cfg);
    const tolB = toleranceFor((nowMs - b.enqueuedAt) / 1000, cfg);
    return diff <= Math.min(tolA, tolB);
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

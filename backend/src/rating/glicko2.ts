export interface Glicko2State { rating: number; rd: number; vol: number; }
export interface MatchResult { opponent: Glicko2State; score: number; }

/**
 * Glicko-2 — implementação do sistema de rating de Mark E. Glickman.
 * Referência: "Example of the Glicko-2 system" (Glickman, 2013).
 *
 * API em escala "humana" (rating ~1500, RD ~350). A conversão para a escala
 * interna (μ, φ) acontece dentro de cada função; o estado persistido fica sempre
 * na escala humana (ver tabela `player_ratings`).
 *
 * Uso no projeto: um estado por formato (Md1/Md3) por jogador. O mesmo motor
 * serve aos dois — muda só qual estado entra.
 */
/** Constante de escala entre a escala humana (1500/350) e a interna (μ/φ). */
export const SCALE = 173.7178;
/** Rating default de um jogador novo (escala humana). */
export const DEFAULT_RATING = 1500;
/** RD default de um jogador novo (incerteza alta). */
export const DEFAULT_RD = 350;
/** Volatility default (σ). */
export const DEFAULT_VOL = 0.06;
/**
 * τ (tau) — constrange a variação da volatility entre períodos.
 * Faixa usual 0.3–1.2; menor = ladder mais estável. Decisão do projeto: 0.5.
 */
export const DEFAULT_TAU = 0.5;
/** Teto de RD: um jogador totalmente incerto não passa disto. */
export const MAX_RD = 350;
/** Tolerância de convergência do solver da volatility. */
const CONVERGENCE_EPSILON = 1e-6;
/** Estado inicial de um jogador novo. */
export function defaultState() {
    return { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL };
}
// ----- conversões de escala -----
function toMu(rating) {
    return (rating - DEFAULT_RATING) / SCALE;
}
function toPhi(rd) {
    return rd / SCALE;
}
function fromMu(mu) {
    return SCALE * mu + DEFAULT_RATING;
}
function fromPhi(phi) {
    return SCALE * phi;
}
/** g(φ): fator de atenuação pela incerteza do oponente. */
function g(phi) {
    return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}
/** E(μ, μ_j, φ_j): expectativa de vitória contra o oponente j. */
function expectedScore(mu, muJ, phiJ) {
    return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}
/**
 * Resolve a nova volatility σ' pelo algoritmo de Illinois (regula falsi),
 * como descrito no passo 5 do paper.
 */
function newVolatility(phi, v, delta, sigma, tau) {
    const a = Math.log(sigma * sigma);
    const phi2 = phi * phi;
    const delta2 = delta * delta;
    const f = (x) => {
        const ex = Math.exp(x);
        const num = ex * (delta2 - phi2 - v - ex);
        const den = 2 * (phi2 + v + ex) * (phi2 + v + ex);
        return num / den - (x - a) / (tau * tau);
    };
    // Limites iniciais A e B.
    let A = a;
    let B;
    if (delta2 > phi2 + v) {
        B = Math.log(delta2 - phi2 - v);
    }
    else {
        let k = 1;
        while (f(a - k * tau) < 0) {
            k += 1;
        }
        B = a - k * tau;
    }
    let fA = f(A);
    let fB = f(B);
    // Iteração de Illinois.
    while (Math.abs(B - A) > CONVERGENCE_EPSILON) {
        const C = A + ((A - B) * fA) / (fB - fA);
        const fC = f(C);
        if (fC * fB <= 0) {
            A = B;
            fA = fB;
        }
        else {
            fA = fA / 2;
        }
        B = C;
        fB = fC;
    }
    return Math.exp(A / 2);
}
/**
 * Atualiza o rating de um jogador após um PERÍODO de rating contendo `results`
 * (0, 1 ou vários jogos). Esta é a forma canônica do Glicko-2.
 *
 * - Sem jogos: só aumenta a incerteza (RD) — ver {@link decay}.
 * - Com jogos: aplica o algoritmo completo (v, Δ, σ', φ', μ').
 *
 * `tau` default = {@link DEFAULT_TAU}.
 */
export function rate(player, results, tau = DEFAULT_TAU) {
    if (results.length === 0) {
        return decay(player);
    }
    const mu = toMu(player.rating);
    const phi = toPhi(player.rd);
    const sigma = player.vol;
    // Passo 3 e 4: variância estimada v e somatório para Δ.
    let invV = 0;
    let sum = 0;
    for (const { opponent, score } of results) {
        const muJ = toMu(opponent.rating);
        const phiJ = toPhi(opponent.rd);
        const gJ = g(phiJ);
        const e = expectedScore(mu, muJ, phiJ);
        invV += gJ * gJ * e * (1 - e);
        sum += gJ * (score - e);
    }
    const v = 1 / invV;
    const delta = v * sum;
    // Passo 5: nova volatility.
    const newVol = newVolatility(phi, v, delta, sigma, tau);
    // Passo 6: pré-atualização de φ (φ*).
    const phiStar = Math.sqrt(phi * phi + newVol * newVol);
    // Passo 7: novos φ' e μ'.
    const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const newMu = mu + newPhi * newPhi * sum;
    const rd = Math.min(fromPhi(newPhi), MAX_RD);
    return {
        rating: fromMu(newMu),
        rd,
        vol: newVol,
    };
}
/**
 * Período de rating SEM jogos: a incerteza (RD) cresce, rating e volatility
 * ficam iguais. Usar quando o jogador ficou inativo num período.
 * φ' = sqrt(φ² + σ²), limitado por {@link MAX_RD}.
 */
export function decay(player) {
    const phi = toPhi(player.rd);
    const phiStar = Math.sqrt(phi * phi + player.vol * player.vol);
    return {
        rating: player.rating,
        rd: Math.min(fromPhi(phiStar), MAX_RD),
        vol: player.vol,
    };
}
/**
 * Conveniência para o modo "por partida" (período de 1 jogo), usado para
 * feedback imediato na UI. Internamente é só `rate` com um único resultado.
 * A fonte de verdade continua sendo o batch periódico com `rate`.
 */
export function rateSingle(player, opponent, score, tau = DEFAULT_TAU) {
    return rate(player, [{ opponent, score }], tau);
}

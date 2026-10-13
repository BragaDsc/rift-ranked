export interface TierDef { name: string; floor: number; color: string; apex?: boolean; }
export type Rank =
  | { status: "unranked"; gamesNeeded: number }
  | { status: "ranked"; tier: string; color: string; apex: boolean; division: string | null; lp: number; tierIndex: number };

/**
 * Mapeia o MMR (Glicko-2, escala ~1500) para tiers estilo League of Legends.
 * Bronze → … → Desafiante, com divisões IV→I e "LP" nas não-apex.
 *
 * Baseado em limiares de rating (tunável). Jogadores em colocação
 * (poucas partidas) ficam "unranked". Função pura.
 */
/** Tiers do mais baixo ao mais alto. Ajuste os `floor` para calibrar a ladder. */
export const TIERS = [
    { name: "Bronze", floor: 1000, color: "#a97142" },
    { name: "Prata", floor: 1200, color: "#9fb4c7" },
    { name: "Ouro", floor: 1400, color: "#f0b429" },
    { name: "Platina", floor: 1600, color: "#27c3b6" },
    { name: "Esmeralda", floor: 1800, color: "#2ecc71" },
    { name: "Diamante", floor: 2000, color: "#4aa3ff" },
    { name: "Mestre", floor: 2200, color: "#9b59ff", apex: true },
    { name: "Grão-Mestre", floor: 2350, color: "#e8524a", apex: true },
    { name: "Desafiante", floor: 2500, color: "#f4e04d", apex: true },
];
const DIVISIONS_PER_TIER = 4; // IV, III, II, I (só nas não-apex)
const ROMAN = ["IV", "III", "II", "I"]; // idx 0 = IV (mais baixo)
/** Partidas de colocação antes de receber um tier. */
export const PLACEMENT_GAMES = 5;
/** Converte rating + nº de partidas em um rank estilo LoL. */
export function rankFor(rating, gamesPlayed) {
    if (gamesPlayed < PLACEMENT_GAMES) {
        return { status: "unranked", gamesNeeded: PLACEMENT_GAMES - gamesPlayed };
    }
    // tier = maior cujo floor <= rating (mínimo Bronze)
    let idx = 0;
    for (let i = 0; i < TIERS.length; i++) {
        if (rating >= TIERS[i].floor)
            idx = i;
    }
    const tier = TIERS[idx];
    if (tier.apex) {
        return {
            status: "ranked",
            tier: tier.name,
            color: tier.color,
            apex: true,
            division: null,
            lp: Math.max(0, Math.round(rating - tier.floor)),
            tierIndex: idx,
        };
    }
    const nextFloor = TIERS[idx + 1].floor;
    const band = (nextFloor - tier.floor) / DIVISIONS_PER_TIER;
    const into = Math.max(0, rating - tier.floor);
    let divIdx = Math.floor(into / band);
    if (divIdx > DIVISIONS_PER_TIER - 1)
        divIdx = DIVISIONS_PER_TIER - 1;
    const lp = Math.round(((into - divIdx * band) / band) * 100);
    return {
        status: "ranked",
        tier: tier.name,
        color: tier.color,
        apex: false,
        division: ROMAN[divIdx],
        lp: Math.min(100, Math.max(0, lp)),
        tierIndex: idx,
    };
}
/** Rótulo curto: "Ouro II · 37 LP" ou "Desafiante · 240 LP" ou "Não classificado". */
export function rankLabel(r) {
    if (r.status === "unranked")
        return "Não classificado";
    const base = r.division ? `${r.tier} ${r.division}` : r.tier;
    return `${base} · ${r.lp} LP`;
}

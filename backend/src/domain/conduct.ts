export interface Penalty { banMs: number; label: string; }

/**
 * Anti-abuso: escada de punição por strikes (conduta). Puro + testável.
 *
 * Alvo: jogador PRESENTE que trava o jogo (não passa o turno) ou não aceita a
 * derrota (força disputa). A punição é cooldown/ban de fila, escalonada pelos
 * strikes ativos (janela de 30 dias). Tudo tunável aqui.
 */
export const STRIKE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Punição para um jogador com N strikes ativos. */
export function penaltyFor(activeStrikes) {
    if (activeStrikes <= 1)
        return { banMs: 0, label: "aviso" };
    if (activeStrikes === 2)
        return { banMs: 15 * MIN, label: "cooldown 15 min" };
    if (activeStrikes === 3)
        return { banMs: HOUR, label: "cooldown 1 h" };
    if (activeStrikes === 4)
        return { banMs: DAY, label: "ban 24 h" };
    return { banMs: 7 * DAY, label: "ban 7 dias" };
}

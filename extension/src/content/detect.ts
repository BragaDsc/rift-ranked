/**
 * Detecção de resultado (lógica PURA e testável) — a parte que mais deu bug.
 *
 * Regras do RiftAtlas: um JOGO é vencido por quem chega a 8 pontos de conquista.
 * Md1 = 1 jogo decide; Md3 = melhor de 3 (primeiro a 2 vitórias de jogo).
 *
 * `applyScores` é um reducer: recebe o estado de detecção da partida + o placar
 * de um frame e devolve se um jogo foi vencido. A trava `gameCounted` garante
 * UMA contagem por jogo; `sawProgress` exige ter visto o jogo em andamento
 * (placar < 8) antes de contar — evita que um "8" obsoleto herdado em memória
 * seja contado como vitória falsa logo no 1º frame da partida seguinte.
 */
export const WIN_SCORE = 8;

export type Scores = Record<string, number | undefined>;

export interface DetectState {
  gameWins: Record<string, number>;
  gameCounted: boolean;
  sawProgress: boolean;
}

export function initDetect(): DetectState {
  return { gameWins: {}, gameCounted: false, sawProgress: false };
}

function numericValues(scores: Scores): number[] {
  return Object.values(scores || {}).filter((v): v is number => typeof v === "number");
}

/** Quem (se alguém) chegou ao placar de vitória de um jogo neste frame. */
export function gameWinnerOf(scores: Scores, winScore: number = WIN_SCORE): string | null {
  for (const [pid, sc] of Object.entries(scores || {})) {
    if (typeof sc === "number" && sc >= winScore) return pid;
  }
  return null;
}

/**
 * Aplica um frame de placar ao estado. Retorna { gameWinnerId, countedGame }.
 * `countedGame` = true quando ESTE frame fechou um jogo. Muta `st`.
 */
export function applyScores(
  st: DetectState,
  scores: Scores,
  winScore: number = WIN_SCORE,
): { gameWinnerId: string | null; countedGame: boolean } {
  const vals = numericValues(scores);
  if (vals.length && Math.max(...vals) < winScore) st.sawProgress = true;

  const gameWinnerId = gameWinnerOf(scores, winScore);
  let countedGame = false;
  if (gameWinnerId && st.sawProgress) {
    if (!st.gameCounted) {
      st.gameCounted = true;
      st.gameWins[gameWinnerId] = (st.gameWins[gameWinnerId] || 0) + 1;
      countedGame = true;
    }
  } else if (st.gameCounted && !gameWinnerId) {
    st.gameCounted = false; // placar caiu de 8 → próximo jogo (Md3)
  }
  return { gameWinnerId, countedGame };
}

/** Nº de vitórias de jogo para vencer a série. */
export function seriesNeed(format: string): number {
  return format === "bo3" ? 2 : 1;
}

/** Vencedor da SÉRIE (match), se já houver; senão null. */
export function seriesWinner(st: DetectState, format: string): string | null {
  const need = seriesNeed(format);
  for (const [pid, w] of Object.entries(st.gameWins)) {
    if (w >= need) return pid;
  }
  return null;
}

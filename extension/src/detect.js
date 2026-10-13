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
 *
 * Carregado como content script (expõe `self.RankedDetect`) e importável em testes
 * (module.exports) — ver padrão UMD abaixo.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.RankedDetect = api;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";
  const WIN_SCORE = 8;

  /** Estado de detecção por partida. */
  function initDetect() {
    return { gameWins: {}, gameCounted: false, sawProgress: false };
  }

  function numericValues(scores) {
    return Object.values(scores || {}).filter((v) => typeof v === "number");
  }

  /** Quem (se alguém) chegou ao placar de vitória de um jogo neste frame. */
  function gameWinnerOf(scores, winScore) {
    for (const [pid, sc] of Object.entries(scores || {})) {
      if (typeof sc === "number" && sc >= winScore) return pid;
    }
    return null;
  }

  /**
   * Aplica um frame de placar ao estado. Retorna:
   *   { gameWinnerId, countedGame } — countedGame=true quando ESTE frame fechou um jogo.
   * Muta `st` (gameWins/gameCounted/sawProgress).
   */
  function applyScores(st, scores, winScore) {
    winScore = winScore || WIN_SCORE;
    const vals = numericValues(scores);
    if (vals.length && Math.max.apply(null, vals) < winScore) st.sawProgress = true;

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
    return { gameWinnerId: gameWinnerId, countedGame: countedGame };
  }

  /** Nº de vitórias de jogo para vencer a série. */
  function seriesNeed(format) {
    return format === "bo3" ? 2 : 1;
  }

  /** Vencedor da SÉRIE (match), se já houver; senão null. */
  function seriesWinner(st, format) {
    const need = seriesNeed(format);
    for (const [pid, w] of Object.entries(st.gameWins)) {
      if (w >= need) return pid;
    }
    return null;
  }

  return { WIN_SCORE, initDetect, applyScores, gameWinnerOf, seriesNeed, seriesWinner };
});

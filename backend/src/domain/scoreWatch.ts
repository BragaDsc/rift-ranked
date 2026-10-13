/**
 * Placar semi-autoritativo (anti-trapaça leve). PURO e testável.
 *
 * Os DOIS clientes transmitem `game_score` (pontos de conquista host/joiner do
 * jogo atual). Aqui cruzamos os dois fluxos: um jogo só é creditado quando AMBOS
 * os clientes corroboram que o mesmo lado chegou ao placar de vitória (8) e o
 * outro ficou abaixo. Assim um cliente adulterado sozinho não consegue "provar"
 * uma vitória — precisa do testemunho do oponente.
 *
 * É a fonte de verdade preferida para desempatar a confirmação de vencedor e o
 * timeout; quando não há corroboração (ex.: um lado caiu antes de reportar 8),
 * degrada para o fluxo de confirmação/likes.
 */
import type { Format, Side } from "./types.js";

export const WIN_SCORE = 8;

/** Visão de um cliente sobre o placar do jogo atual (pontos de conquista). */
export interface SideView {
  h: number;
  j: number;
}
export interface ScoreWatch {
  /** Última visão reportada pelo cliente host e pelo cliente joiner. */
  host: SideView;
  joiner: SideView;
  /** Vitórias de jogo CORROBORADAS (pelos dois clientes) na série. */
  gameWins: { host: number; joiner: number };
  /** Jogo atual já creditado? (destrava quando os dois voltam a < 8). */
  counted: boolean;
}

export function initScoreWatch(): ScoreWatch {
  return { host: { h: 0, j: 0 }, joiner: { h: 0, j: 0 }, gameWins: { host: 0, joiner: 0 }, counted: false };
}

const below = (v: SideView, win: number) => v.h < win && v.j < win;

/** Lado que AMBOS os clientes corroboram ter vencido o jogo atual, ou null. */
function corroboratedWinner(w: ScoreWatch, win: number): Side | null {
  const hostWon = w.host.h >= win && w.joiner.h >= win && w.host.j < win && w.joiner.j < win;
  const joinerWon = w.host.j >= win && w.joiner.j >= win && w.host.h < win && w.joiner.h < win;
  if (hostWon && !joinerWon) return "host";
  if (joinerWon && !hostWon) return "joiner";
  return null; // sem corroboração (ou contraditório)
}

/** Registra a visão de placar de um dos clientes e credita jogos corroborados. */
export function applyReport(w: ScoreWatch, from: Side, h: number, j: number, win: number = WIN_SCORE): void {
  w[from] = { h, j };
  if (below(w.host, win) && below(w.joiner, win)) {
    w.counted = false; // jogo em andamento / novo jogo → libera a próxima contagem
    return;
  }
  if (w.counted) return;
  const side = corroboratedWinner(w, win);
  if (side) {
    w.counted = true;
    w.gameWins[side] += 1;
  }
}

/** Lado líder da série pelos jogos corroborados (Md1=1, Md3=2), ou null. */
export function seriesLeader(w: ScoreWatch, format: Format): Side | null {
  const need = format === "bo3" ? 2 : 1;
  if (w.gameWins.host >= need) return "host";
  if (w.gameWins.joiner >= need) return "joiner";
  return null;
}

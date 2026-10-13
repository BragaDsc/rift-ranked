/**
 * Contrato de mensagens WebSocket entre a extensão e o backend ranked.
 * Compartilhado (mesmo arquivo serve de referência para o código da extensão).
 */
import type { Format, Side } from "./domain/types.js";
import type { Outcome } from "./domain/reconcile.js";

export type ClientMessage =
  | { type: "auth"; token: string; riftatlasPlrId?: string; displayName?: string }
  | { type: "enqueue"; format: Format }
  | { type: "dequeue"; format: Format }
  | { type: "heartbeat"; matchId?: string }
  | { type: "room_code"; matchId: string; roomCode: string }
  | { type: "game_started"; matchId: string }
  | { type: "game_score"; matchId: string; host: number; joiner: number }
  | { type: "report"; matchId: string; outcome: Outcome }
  | { type: "report_grief"; matchId: string }
  | { type: "contest_grief"; matchId: string }
  /** Confirmação manual do vencedor ao fim da partida (+ avaliação do oponente). */
  | { type: "confirm_result"; matchId: string; winner: "me" | "opp"; rate?: "like" | "dislike" | null }
  /** Reporta o Legend/champion/deck capturados (me = este jogador; opp = o outro). */
  | { type: "deck_report"; matchId: string; me: DeckInfo; opp: DeckInfo | null };

export interface DeckInfo {
  legendCode: string | null;
  legendName: string | null;
  championCode: string | null;
  championName: string | null;
  deck?: any;
}

export interface RatingView {
  format: Format;
  rating: number;
  rd: number;
  provisional: boolean;
}

export type ServerMessage =
  | { type: "auth_ok"; playerId: string; ratings: RatingView[] }
  | { type: "auth_error"; message: string }
  | { type: "queued"; format: Format }
  | { type: "dequeued"; format: Format }
  | { type: "match_found"; matchId: string; format: Format; side: Side; opponent: { displayName: string; rating: number } }
  | { type: "create_room"; matchId: string; format: Format }
  | { type: "join_room"; matchId: string; roomCode: string }
  | { type: "match_resolved"; matchId: string; youWon: boolean | null; reason: string; ratingBefore: number; ratingAfter: number }
  | { type: "match_disputed"; matchId: string }
  | { type: "match_cancelled"; matchId: string; reason: string }
  | { type: "grief_warning"; matchId: string; secondsLeft: number }
  | { type: "grief_cleared"; matchId: string }
  | { type: "queue_blocked"; message: string; until: number }
  /** Confirmação: aguardando o oponente; pediu confirmação de novo (divergência). */
  | { type: "confirm_waiting"; matchId: string }
  | { type: "confirm_again"; matchId: string; round: number }
  /** Peça a este cliente para abrir a janela de confirmação (reload/sem detecção). */
  | { type: "confirm_prompt"; matchId: string }
  /** Retomada após reload: você ainda está nesta partida — restaure o contexto. */
  | { type: "match_active"; matchId: string; format: Format; side: Side; opponent: { displayName: string; rating: number }; state: string }
  /** Jogadores online agora (conexões autenticadas). Transmitido a todos quando muda. */
  | { type: "online_count"; count: number }
  | { type: "error"; message: string };

import type { Format, PlayerId, ResultReason, Side } from "./types.js";
export type MatchState = "MATCHED" | "ROOM_READY" | "IN_GAME" | "RESULT_REPORTED" | "ABANDON_GRACE" | "DISPUTED" | "RESOLVED" | "RATED" | "CANCELLED";
export interface Match {
  id: string; format: Format; hostId: PlayerId; joinerId: PlayerId; state: MatchState;
  roomCode?: string; createdAt: number; startedAt?: number; endedAt?: number;
  gamesWon: { host: number; joiner: number };
  winnerId?: PlayerId | null; reason?: ResultReason;
  disconnectedAt: Partial<Record<Side, number>>;
}
export type MatchEvent =
  | { type: "ROOM_CODE"; roomCode: string }
  | { type: "GAME_STARTED"; at: number }
  | { type: "GAME_SCORE"; host: number; joiner: number }
  | { type: "DISCONNECT"; side: Side; at: number }
  | { type: "RECONNECT"; side: Side }
  | { type: "GRACE_EXPIRED" }
  | { type: "RESOLVE"; winnerId: PlayerId | null; reason: ResultReason; at: number }
  | { type: "DISPUTE" }
  | { type: "MARK_RATED" }
  | { type: "CANCEL"; at: number };

/**
 * Máquina de estados da partida (ARQUITETURA §6), como reducer puro.
 *
 * MATCHED → ROOM_READY → IN_GAME → (RESULT_REPORTED | ABANDON_GRACE | DISPUTED)
 *                                 → RESOLVED → RATED
 * Qualquer estado pré-jogo pode ir a CANCELLED (timeout/desistência).
 *
 * O reducer só valida transições de ciclo de vida. A DECISÃO do resultado
 * (quem ganhou / W.O. / disputa) vem da reconciliação (reconcile.ts); o
 * orquestrador chama reconcile e então despacha RESOLVE/DISPUTE/GRACE aqui.
 */
export class IllegalTransitionError extends Error {
    constructor(state, event) {
        super(`Transição ilegal: evento ${event} no estado ${state}`);
        this.name = "IllegalTransitionError";
    }
}
const TERMINAL = new Set(["RATED", "CANCELLED"]);
export function isTerminal(m) {
    return TERMINAL.has(m.state);
}
/** Alvo da série: nº de games para vencer. */
export function gamesToWin(format) {
    return format === "bo3" ? 2 : 1;
}
export function createMatch(args) {
    return {
        id: args.id,
        format: args.format,
        hostId: args.hostId,
        joinerId: args.joinerId,
        state: "MATCHED",
        createdAt: args.now,
        gamesWon: { host: 0, joiner: 0 },
        disconnectedAt: {},
    };
}
/** Aplica um evento. Retorna um NOVO match; lança em transição ilegal. */
export function transition(m, ev) {
    // CANCEL é permitido em qualquer estado pré-resultado.
    if (ev.type === "CANCEL") {
        if (m.state === "RATED" || m.state === "RESOLVED" || m.state === "CANCELLED") {
            throw new IllegalTransitionError(m.state, ev.type);
        }
        return { ...m, state: "CANCELLED", endedAt: ev.at };
    }
    switch (m.state) {
        case "MATCHED":
            if (ev.type === "ROOM_CODE") {
                return { ...m, state: "ROOM_READY", roomCode: ev.roomCode };
            }
            break;
        case "ROOM_READY":
            if (ev.type === "GAME_STARTED") {
                return { ...m, state: "IN_GAME", startedAt: ev.at };
            }
            break;
        case "IN_GAME":
            if (ev.type === "GAME_SCORE") {
                return { ...m, gamesWon: { host: ev.host, joiner: ev.joiner } };
            }
            if (ev.type === "DISCONNECT") {
                return {
                    ...m,
                    state: "ABANDON_GRACE",
                    disconnectedAt: { ...m.disconnectedAt, [ev.side]: ev.at },
                };
            }
            if (ev.type === "RESOLVE") {
                return resolve(m, ev);
            }
            if (ev.type === "DISPUTE") {
                return { ...m, state: "DISPUTED" };
            }
            break;
        case "ABANDON_GRACE":
            if (ev.type === "RECONNECT") {
                const dc = { ...m.disconnectedAt };
                delete dc[ev.side];
                return { ...m, state: "IN_GAME", disconnectedAt: dc };
            }
            if (ev.type === "GRACE_EXPIRED" || ev.type === "RESOLVE") {
                // GRACE_EXPIRED precisa de um RESOLVE explícito do orquestrador com o
                // vencedor por W.O.; aceitamos RESOLVE direto aqui.
                if (ev.type === "RESOLVE")
                    return resolve(m, ev);
                // Sem winner no GRACE_EXPIRED: fica aguardando o RESOLVE. Mantém estado.
                return m;
            }
            if (ev.type === "DISCONNECT") {
                // o outro lado também caiu
                return {
                    ...m,
                    disconnectedAt: { ...m.disconnectedAt, [ev.side]: ev.at },
                };
            }
            break;
        case "RESULT_REPORTED":
            if (ev.type === "RESOLVE")
                return resolve(m, ev);
            if (ev.type === "DISPUTE")
                return { ...m, state: "DISPUTED" };
            break;
        case "DISPUTED":
            if (ev.type === "RESOLVE")
                return resolve(m, ev);
            break;
        case "RESOLVED":
            if (ev.type === "MARK_RATED") {
                return { ...m, state: "RATED" };
            }
            break;
    }
    throw new IllegalTransitionError(m.state, ev.type);
}
function resolve(m, ev) {
    return {
        ...m,
        state: "RESOLVED",
        winnerId: ev.winnerId,
        reason: ev.reason,
        endedAt: ev.at,
    };
}

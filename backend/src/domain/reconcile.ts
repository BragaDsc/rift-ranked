import type { ResultReason, Side } from "./types.js";
export type Outcome = "win" | "loss" | "conceded" | "opponent_abandoned" | "in_progress";
export interface SideReport { outcome: Outcome; }
export interface ReconcileInput {
  reportHost?: SideReport; reportJoiner?: SideReport;
  hostConnected: boolean; joinerConnected: boolean; graceExpired: boolean;
}
export type Resolution =
  | { status: "resolved"; winner: Side; reason: ResultReason }
  | { status: "double_no_show" }
  | { status: "dispute" }
  | { status: "pending" };

/**
 * Reconciliação do resultado de uma partida (ARQUITETURA §8).
 *
 * Como a sala privada do RiftAtlas NÃO dá W.O. automático, nós decidimos o
 * resultado combinando: os dois relatos independentes das extensões + o estado
 * de presença (conectado?) + se o grace de reconexão expirou.
 *
 * Princípio anti-trapaça: um relato UNILATERAL de vitória, sem confirmação do
 * oponente e sem abandono observado, NÃO resolve (fica pendente). Já um jogador
 * que admite ter perdido/saído resolve a favor do oponente (admissão é segura).
 *
 * Função pura.
 */
const other = (s) => (s === "host" ? "joiner" : "host");
/** Normaliza o relato de um lado para "quem ele diz que ganhou" + o motivo. */
function claimedWinner(side, r) {
    switch (r.outcome) {
        case "win":
            return { winner: side, reason: "score" };
        case "loss":
            return { winner: other(side), reason: "score" };
        case "conceded":
            return { winner: other(side), reason: "concession" };
        case "opponent_abandoned":
            return { winner: side, reason: "walkover" };
        case "in_progress":
            return { winner: null, reason: null };
    }
}
export function reconcile(input) {
    const { reportHost, reportJoiner, hostConnected, joinerConnected, graceExpired } = input;
    const h = reportHost ? claimedWinner("host", reportHost) : null;
    const j = reportJoiner ? claimedWinner("joiner", reportJoiner) : null;
    // ---- 1) Admissão voluntária de derrota/saída resolve na hora (unilateral OK)
    // "conceded" e "loss" admitem a própria derrota — seguro aceitar sem o outro.
    const hostAdmitsLoss = reportHost && (reportHost.outcome === "conceded" || reportHost.outcome === "loss");
    const joinerAdmitsLoss = reportJoiner &&
        (reportJoiner.outcome === "conceded" || reportJoiner.outcome === "loss");
    // Se os dois admitem perder, é inconsistente → disputa.
    if (hostAdmitsLoss && joinerAdmitsLoss)
        return { status: "dispute" };
    if (hostAdmitsLoss) {
        const reason = reportHost.outcome === "conceded" ? "concession" : "score";
        return { status: "resolved", winner: "joiner", reason };
    }
    if (joinerAdmitsLoss) {
        const reason = reportJoiner.outcome === "conceded" ? "concession" : "score";
        return { status: "resolved", winner: "host", reason };
    }
    // ---- 2) Os dois reportaram (sem admissão de derrota acima): checar acordo
    if (h && j && h.winner && j.winner) {
        if (h.winner === j.winner) {
            // concordam no vencedor. reason: walkover tem prioridade semântica.
            const reason = h.reason === "walkover" || j.reason === "walkover" ? "walkover" : "score";
            return { status: "resolved", winner: h.winner, reason };
        }
        // ambos dizem "eu ganhei" → disputa
        return { status: "dispute" };
    }
    // ---- 3) Um lado alega vitória / abandono do oponente (unilateral)
    // Só resolve se o oponente estiver DE FATO ausente e o grace tiver expirado.
    const soleClaim = h?.winner ? { side: "host", c: h } : j?.winner ? { side: "joiner", c: j } : null;
    if (soleClaim) {
        const oppSide = other(soleClaim.side);
        const oppConnected = oppSide === "host" ? hostConnected : joinerConnected;
        if (!oppConnected && graceExpired) {
            return { status: "resolved", winner: soleClaim.side, reason: "walkover" };
        }
        // oponente ainda presente (ou grace não expirou) e sem confirmação → pendente
        return { status: "pending" };
    }
    // ---- 4) Sem relato conclusivo: decide pela presença quando o grace expirou.
    // A presença é a prova: quem ficou vence por W.O. mesmo sem reportar.
    if (graceExpired) {
        if (!hostConnected && !joinerConnected)
            return { status: "double_no_show" };
        if (hostConnected && !joinerConnected)
            return { status: "resolved", winner: "host", reason: "walkover" };
        if (!hostConnected && joinerConnected)
            return { status: "resolved", winner: "joiner", reason: "walkover" };
    }
    return { status: "pending" };
}

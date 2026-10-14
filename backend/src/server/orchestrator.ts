import { type PairingConfig } from "../domain/pairing.js";
import { type Match, type MatchState } from "../domain/match.js";
import { type Outcome } from "../domain/reconcile.js";
import type { Format, PlayerId } from "../domain/types.js";
import type { ServerMessage } from "../protocol.js";
import { type Repository } from "./repository.js";
export interface OrchestratorConfig {
  pairing: PairingConfig; matchedTimeoutMs: number; roomReadyTimeoutMs: number;
  reconnectGraceMs: number; griefWindowMs: number; confirmTimeoutMs?: number; confirmMaxRounds?: number;
}
type Send = (playerId: PlayerId, msg: ServerMessage) => void;
export type { MatchState };

/**
 * Orquestrador — o cérebro do ranked. Agnóstico de transporte: recebe `send`
 * (entregar uma mensagem a um jogador) e `now()` (relógio) injetados, para ser
 * testável sem sockets nem timers reais.
 *
 * Responsabilidades: presença, filas por formato, pareamento, condução da
 * máquina de estados da partida, grace/timeouts e aplicação do Glicko-2.
 */
import { randomUUID } from "node:crypto";
import { DEFAULT_PAIRING, findMatches, } from "../domain/pairing.js";
import { createMatch, transition, } from "../domain/match.js";
import { reconcile } from "../domain/reconcile.js";
import { initScoreWatch, applyReport, seriesLeader } from "../domain/scoreWatch.js";
import { PROVISIONAL_RD } from "./repository.js";
import { applyRatedResult } from "./ratingService.js";
export const DEFAULT_CONFIG = {
    pairing: DEFAULT_PAIRING,
    matchedTimeoutMs: 90_000,
    roomReadyTimeoutMs: 90_000,
    reconnectGraceMs: 60_000, // 1 min para o jogador que caiu voltar antes do W.O. automático
    griefWindowMs: 120_000,
    // janela de confirmação do vencedor (ambos confirmam antes de finalizar):
    confirmTimeoutMs: 30_000, // oponente tem 30s p/ responder; sem resposta, vale quem confirmou
    confirmMaxRounds: 2, // rodadas de divergência antes de desempatar por reputação (likes)
};
export class Orchestrator {
    repo;
    send;
    cfg;
    now;
    presence = new Map();
    queues = new Map();
    matches = new Map();
    playerMatch = new Map();
    reports = new Map();
    /** Placar semi-autoritativo por partida (corroboração dos dois clientes). */
    scoreWatch = new Map();
    /** Confirmação manual do vencedor por partida: { host?, joiner?, round } (ids absolutos). */
    confirmations = new Map();
    /** Prazo p/ o oponente confirmar o vencedor. */
    confirmDeadlines = new Map();
    /** Prazo da fase atual de cada partida. */
    deadlines = new Map();
    /** Reivindicações de vitória por inatividade/grief pendentes. */
    griefClaims = new Map();
    constructor(repo, send, cfg = DEFAULT_CONFIG, now = () => Date.now()) {
        this.repo = repo;
        this.send = send;
        this.cfg = cfg;
        this.now = now;
        for (const f of ["bo1", "bo3"])
            this.queues.set(f, new Map());
    }
    // ----------------------------- conexão -----------------------------
    onConnected(playerId, displayName) {
        const p = this.presence.get(playerId);
        if (p) {
            p.connected = true;
            p.lastHeartbeat = this.now();
            p.displayName = displayName;
        }
        else {
            this.presence.set(playerId, {
                connected: true,
                lastHeartbeat: this.now(),
                displayName,
            });
        }
        // Reconexão: se a partida caiu em ABANDON_GRACE porque este jogador
        // desconectou, o retorno dele traz a partida de volta a IN_GAME e
        // cancela o prazo de grace (walkover). Sem isso o backend "não entende
        // que o jogador voltou" e podia encerrar a partida por abandono.
        const matchId = this.playerMatch.get(playerId);
        if (matchId) {
            const m = this.matches.get(matchId);
            if (m && m.state === "ABANDON_GRACE") {
                const side = this.sideOf(m, playerId);
                // só reconecta o lado que estava desconectado
                if (m.disconnectedAt && m.disconnectedAt[side] != null) {
                    this.apply(m, { type: "RECONNECT", side });
                    // re-lê o estado atualizado (apply substitui o objeto no mapa)
                    const nm = this.matches.get(matchId);
                    const stillGone = nm && nm.disconnectedAt &&
                        Object.keys(nm.disconnectedAt).length > 0;
                    if (!stillGone)
                        this.deadlines.delete(matchId);
                }
            }
        }
    }
    onHeartbeat(playerId) {
        const p = this.presence.get(playerId);
        if (p)
            p.lastHeartbeat = this.now();
    }
    onDisconnected(playerId) {
        const p = this.presence.get(playerId);
        if (p)
            p.connected = false;
        // sai de todas as filas
        for (const q of this.queues.values())
            q.delete(playerId);
        const matchId = this.playerMatch.get(playerId);
        if (!matchId)
            return;
        const m = this.matches.get(matchId);
        if (!m)
            return;
        const side = this.sideOf(m, playerId);
        if (m.state === "IN_GAME") {
            this.apply(m, { type: "DISCONNECT", side, at: this.now() });
            // prazo de grace
            this.deadlines.set(m.id, this.now() + this.cfg.reconnectGraceMs);
        }
        else if (m.state === "ABANDON_GRACE") {
            this.apply(m, { type: "DISCONNECT", side, at: this.now() });
        }
    }
    // ----------------------------- fila -----------------------------
    async onEnqueue(playerId, format) {
        const q = this.queues.get(format);
        if (!q) {
            this.send(playerId, { type: "error", message: "Formato inválido." });
            return;
        }
        if (this.playerMatch.has(playerId)) {
            this.send(playerId, { type: "error", message: "Você já está em uma partida." });
            return;
        }
        // conduta: bloqueia quem está de cooldown/ban
        const conduct = await this.repo.getConduct(playerId);
        if (conduct.bannedUntil && conduct.bannedUntil > this.now()) {
            this.send(playerId, {
                type: "queue_blocked",
                message: "Fila bloqueada por conduta (strikes). Aguarde o fim do período.",
                until: conduct.bannedUntil,
            });
            return;
        }
        const rating = await this.repo.getRating(playerId, format);
        q.set(playerId, { playerId, rating: rating.rating, enqueuedAt: this.now() });
        this.send(playerId, { type: "queued", format });
    }
    onDequeue(playerId, format) {
        this.queues.get(format)?.delete(playerId);
        this.send(playerId, { type: "dequeued", format });
    }
    // ----------------------- condução da partida -----------------------
    onRoomCode(playerId, matchId, roomCode) {
        const m = this.matches.get(matchId);
        if (!m || m.state !== "MATCHED" || m.hostId !== playerId)
            return;
        this.apply(m, { type: "ROOM_CODE", roomCode });
        this.deadlines.set(m.id, this.now() + this.cfg.roomReadyTimeoutMs);
        this.send(m.joinerId, { type: "join_room", matchId: m.id, roomCode });
    }
    onGameStarted(playerId, matchId) {
        const m = this.matches.get(matchId);
        if (!m || m.state !== "ROOM_READY")
            return;
        if (m.hostId !== playerId && m.joinerId !== playerId)
            return;
        this.apply(m, { type: "GAME_STARTED", at: this.now() });
        this.deadlines.delete(m.id); // sem prazo durante o jogo (só grace em queda)
    }
    onGameScore(playerId, matchId, host, joiner) {
        let m = this.matches.get(matchId);
        if (!m || !this.isParticipant(m, playerId))
            return;
        this.ensureStarted(m, playerId);
        m = this.matches.get(matchId) ?? m;
        // alimenta o placar semi-autoritativo (visão deste cliente); credita jogos
        // só quando o OUTRO cliente corrobora o mesmo 8.
        const w = this.scoreWatch.get(matchId) ?? initScoreWatch();
        applyReport(w, this.sideOf(m, playerId), host, joiner);
        this.scoreWatch.set(matchId, w);
        if (m.state !== "IN_GAME")
            return;
        // persiste o placar da SÉRIE corroborado (vitórias de jogo), não os pontos crus
        this.apply(m, { type: "GAME_SCORE", host: w.gameWins.host, joiner: w.gameWins.joiner });
    }
    /** Vencedor da série corroborado pelos DOIS placares (ou null). */
    authSeriesWinnerId(matchId, m) {
        const w = this.scoreWatch.get(matchId);
        if (!w)
            return null;
        const side = seriesLeader(w, m.format);
        return side ? (side === "host" ? m.hostId : m.joinerId) : null;
    }
    async onReport(playerId, matchId, outcome) {
        const m = this.matches.get(matchId);
        if (!m || !this.isParticipant(m, playerId))
            return;
        this.ensureStarted(m, playerId);
        const side = this.sideOf(m, playerId);
        const rep = this.reports.get(matchId) ?? {};
        rep[side] = { outcome };
        this.reports.set(matchId, rep);
        await this.attemptResolve(this.matches.get(m.id) ?? m);
    }
    /**
     * Confirmação MANUAL do vencedor ao fim da partida. Cada jogador diz quem
     * venceu (`winner` = "me" | "opp") e, opcionalmente, avalia o oponente
     * (`rate` = "like" | "dislike" | null). A partida só finaliza quando AMBOS
     * confirmam o MESMO vencedor. Se divergirem, re-pede a confirmação; persistindo
     * a divergência, desempata pela reputação (quem tem mais likes "ganha" a palavra).
     */
    async onConfirmResult(playerId, matchId, winner, rate) {
        const m = this.matches.get(matchId);
        if (!m || !this.isParticipant(m, playerId))
            return;
        this.ensureStarted(m, playerId);
        const side = this.sideOf(m, playerId);
        const oppId = side === "host" ? m.joinerId : m.hostId;
        // avaliação do oponente (reputação persistente)
        if ((rate === "like" || rate === "dislike") && this.repo.setLike) {
            try {
                await this.repo.setLike(playerId, oppId, rate === "like" ? 1 : -1, matchId);
            }
            catch { /* reputação nunca trava o fluxo */ }
        }
        // id absoluto do vencedor reivindicado por este jogador
        const claimedId = winner === "opp" ? oppId : playerId;
        const c = this.confirmations.get(matchId) ?? { round: 1 };
        c[side] = claimedId;
        this.confirmations.set(matchId, c);
        // primeira confirmação da rodada → dá prazo pro oponente confirmar
        if (!this.confirmDeadlines.has(matchId))
            this.confirmDeadlines.set(matchId, this.now() + this.cfg.confirmTimeoutMs);
        // ainda falta o outro lado
        if (c.host == null || c.joiner == null) {
            // se o oponente não está conectado (desistiu/saiu/caiu), não há quem confirmar:
            // resolve já com o placar corroborado, senão com o que este jogador confirmou.
            if (!this.isConnected(oppId)) {
                this.confirmDeadlines.delete(matchId);
                this.confirmations.delete(matchId);
                const authId = this.authSeriesWinnerId(matchId, m);
                await this.finalizeConfirmed(m, authId ?? claimedId, "concession");
                return;
            }
            this.send(playerId, { type: "confirm_waiting", matchId });
            // garante que o oponente veja a janela de confirmação (mesmo que tenha
            // recarregado a página ou que o cliente dele não tenha detectado o fim).
            this.send(oppId, { type: "confirm_prompt", matchId });
            return;
        }
        // ambos confirmaram
        this.confirmDeadlines.delete(matchId);
        const authId = this.authSeriesWinnerId(matchId, m); // vencedor corroborado pelos 2 placares
        if (c.host === c.joiner) {
            // acordo → finaliza com o vencedor combinado
            this.confirmations.delete(matchId);
            if (authId && authId !== c.host) // consenso humano contradiz o placar corroborado (raro) → registra
                console.warn(`[orchestrator] match ${matchId}: confirmação (${c.host}) difere do placar corroborado (${authId})`);
            await this.finalizeConfirmed(m, c.host, "score");
            return;
        }
        // DIVERGÊNCIA. Preferência 1: o placar corroborado pelos DOIS clientes é a
        // verdade mais confiável (um cliente adulterado sozinho não corrobora).
        if (authId) {
            this.confirmations.delete(matchId);
            await this.finalizeConfirmed(m, authId, "score");
            return;
        }
        // Sem corroboração: re-pede a confirmação enquanto não estourar o limite de rodadas
        if (c.round < (this.cfg.confirmMaxRounds ?? 2)) {
            const nextRound = c.round + 1;
            this.confirmations.set(matchId, { round: nextRound });
            for (const pid of [m.hostId, m.joinerId])
                this.send(pid, { type: "confirm_again", matchId, round: nextRound });
            return;
        }
        // impasse persistente → desempate por reputação (mais likes = palavra correta)
        this.confirmations.delete(matchId);
        const stats = this.repo.getLikeStats
            ? await Promise.all([
                this.repo.getLikeStats(m.hostId).catch(() => ({ net: 0 })),
                this.repo.getLikeStats(m.joinerId).catch(() => ({ net: 0 })),
            ])
            : [{ net: 0 }, { net: 0 }];
        const [lh, lj] = stats;
        if (lh.net > lj.net) {
            await this.finalizeConfirmed(m, c.host, "disputed"); // host tem mais likes → vale o que ele disse
        }
        else if (lj.net > lh.net) {
            await this.finalizeConfirmed(m, c.joiner, "disputed"); // joiner tem mais likes
        }
        else {
            // empate de reputação: sem critério justo automático → disputa p/ revisão
            if (m.state === "IN_GAME")
                this.apply(m, { type: "DISPUTE" });
            await this.save(this.matches.get(m.id));
            for (const pid of [m.hostId, m.joinerId])
                this.send(pid, { type: "match_disputed", matchId: m.id });
            this.cleanup(m.id);
        }
    }
    /** Finaliza uma partida com um vencedor já decidido (confirmação/desempate). */
    async finalizeConfirmed(m, winnerId, reason) {
        const cur = this.matches.get(m.id) ?? m;
        if (!["IN_GAME", "ABANDON_GRACE", "RESULT_REPORTED", "DISPUTED"].includes(cur.state))
            return;
        this.apply(cur, { type: "RESOLVE", winnerId, reason, at: this.now() });
        const applied = await this.applyRating(m.id);
        this.apply(this.matches.get(m.id), { type: "MARK_RATED" });
        await this.save(this.matches.get(m.id));
        for (const pid of [m.hostId, m.joinerId]) {
            const delta = applied ? (pid === m.hostId ? applied.host : applied.joiner) : null;
            this.send(pid, {
                type: "match_resolved",
                matchId: m.id,
                youWon: winnerId === null ? null : winnerId === pid,
                reason,
                ratingBefore: delta?.before ?? 0,
                ratingAfter: delta?.after ?? 0,
            });
        }
        this.cleanup(m.id);
    }
    /**
     * Retomada após reload/reconexão: se o jogador ainda está numa partida viva,
     * reenvia o contexto (match_active) para a extensão restaurar o estado, e —
     * se há uma confirmação de vencedor pendente — reabre a janela (confirm_prompt)
     * ou mostra a espera (confirm_waiting), para a partida não travar no reload.
     */
    async sendResume(playerId) {
        const matchId = this.playerMatch.get(playerId);
        if (!matchId)
            return;
        const m = this.matches.get(matchId);
        if (!m)
            return;
        const side = this.sideOf(m, playerId);
        const oppId = side === "host" ? m.joinerId : m.hostId;
        let oppRating = 0;
        try {
            const r = await this.repo.getRating(oppId, m.format);
            oppRating = Math.round(r.rating);
        }
        catch { /* rating indisponível não impede a retomada */ }
        this.send(playerId, {
            type: "match_active",
            matchId: m.id,
            format: m.format,
            side,
            opponent: { displayName: this.nameOf(oppId), rating: oppRating },
            state: m.state,
        });
        const c = this.confirmations.get(matchId);
        if (c) {
            if (c[side] != null)
                this.send(playerId, { type: "confirm_waiting", matchId });
            else
                this.send(playerId, { type: "confirm_prompt", matchId });
        }
    }
    /**
     * Reporta o Legend/champion/deck. `me` é deste jogador (autoritativo); `opp` é o
     * que ele enxergou do oponente (Legends são públicos) — só preenche se faltar.
     */
    async onDeckReport(playerId, msg) {
        const m = this.matches.get(msg.matchId);
        if (!m || !this.isParticipant(m, playerId) || !this.repo.saveMatchDeck)
            return;
        const oppId = playerId === m.hostId ? m.joinerId : m.hostId;
        try {
            if (msg.me && msg.me.legendCode)
                await this.repo.saveMatchDeck(m.id, m.format, playerId, msg.me, true);
            if (msg.opp && msg.opp.legendCode)
                await this.repo.saveMatchDeck(m.id, m.format, oppId, msg.opp, false);
        }
        catch (e) {
            console.error("[orchestrator] saveMatchDeck falhou:", e);
        }
    }
    /** Jogador presente reivindica vitória (oponente travando / não passa o turno). */
    onReportGrief(playerId, matchId) {
        let m = this.matches.get(matchId);
        if (!m || !this.isParticipant(m, playerId))
            return;
        this.ensureStarted(m, playerId); // ROOM_READY→IN_GAME se o jogo já rolou
        m = this.matches.get(matchId) ?? m;
        if (m.state !== "IN_GAME")
            return;
        if (this.griefClaims.has(matchId))
            return; // já há uma reivindicação
        const by = this.sideOf(m, playerId);
        this.griefClaims.set(matchId, { by, deadline: this.now() + this.cfg.griefWindowMs });
        const opponent = by === "host" ? m.joinerId : m.hostId;
        this.send(opponent, {
            type: "grief_warning",
            matchId,
            secondsLeft: Math.round(this.cfg.griefWindowMs / 1000),
        });
    }
    /** O acusado contesta a reivindicação → vira disputa (segura o MMR, vai p/ revisão). */
    async onContestGrief(playerId, matchId) {
        const claim = this.griefClaims.get(matchId);
        const m = this.matches.get(matchId);
        if (!claim || !m)
            return;
        if (this.sideOf(m, playerId) === claim.by)
            return; // só o acusado contesta
        this.griefClaims.delete(matchId);
        if (m.state === "IN_GAME")
            this.apply(m, { type: "DISPUTE" });
        await this.save(this.matches.get(m.id));
        for (const pid of [m.hostId, m.joinerId]) {
            this.send(pid, { type: "grief_cleared", matchId });
            this.send(pid, { type: "match_disputed", matchId });
        }
        this.cleanup(m.id);
    }
    /** Métricas leves pra observabilidade (endpoint /api/stats). */
    stats() {
        const queued = {};
        for (const [f, q] of this.queues)
            queued[f] = q.size;
        return { activeMatches: this.matches.size, queued };
    }
    // ----------------------------- tick -----------------------------
    /** Chamado periodicamente (ex.: a cada 1s) pela camada de transporte. */
    async tick(now = this.now()) {
        // 1) pareamento por formato
        for (const [format, q] of this.queues) {
            const entries = [...q.values()];
            if (entries.length < 2)
                continue;
            const { pairs } = findMatches(entries, now, this.cfg.pairing);
            for (const pair of pairs) {
                q.delete(pair.host.playerId);
                q.delete(pair.joiner.playerId);
                await this.createAndAnnounce(format, pair.host, pair.joiner);
            }
        }
        // 2) prazos e grace
        for (const m of [...this.matches.values()]) {
            const deadline = this.deadlines.get(m.id);
            if (deadline === undefined || now < deadline)
                continue;
            if (m.state === "MATCHED" || m.state === "ROOM_READY") {
                this.cancel(m, "Tempo esgotado para montar a sala.");
            }
            else if (m.state === "ABANDON_GRACE") {
                this.apply(m, { type: "GRACE_EXPIRED" });
                await this.attemptResolve(m, /*graceExpired*/ true);
            }
        }
        // 3) reivindicações de grief expiradas sem contestação → vitória + strike
        for (const [mid, claim] of [...this.griefClaims]) {
            if (now < claim.deadline)
                continue;
            this.griefClaims.delete(mid);
            const m = this.matches.get(mid);
            if (!m || m.state !== "IN_GAME")
                continue;
            const winnerId = claim.by === "host" ? m.hostId : m.joinerId;
            const loserId = claim.by === "host" ? m.joinerId : m.hostId;
            await this.resolveWithStrike(m, winnerId, loserId);
        }
        // 4) confirmação de vencedor sem resposta do oponente → vale quem confirmou
        for (const [mid, deadline] of [...this.confirmDeadlines]) {
            if (now < deadline)
                continue;
            this.confirmDeadlines.delete(mid);
            const m = this.matches.get(mid);
            const c = this.confirmations.get(mid);
            if (!m || !c) {
                this.confirmations.delete(mid);
                continue;
            }
            // preferência: o placar corroborado pelos dois clientes; senão, vale quem confirmou
            const present = c.host != null ? c.host : c.joiner; // o lado que confirmou
            this.confirmations.delete(mid);
            const winnerId = this.authSeriesWinnerId(mid, m) ?? present;
            if (winnerId != null)
                await this.finalizeConfirmed(m, winnerId, "score");
        }
        // 5) poda presença obsoleta: desconectados há muito, fora de fila/partida.
        // Sem isso o mapa de presença cresceria para sempre (cada jogador único).
        const PRESENCE_TTL = 30 * 60_000;
        for (const [pid, p] of this.presence) {
            if (p.connected || now - (p.lastHeartbeat ?? 0) < PRESENCE_TTL || this.playerMatch.has(pid))
                continue;
            let inQueue = false;
            for (const q of this.queues.values())
                if (q.has(pid)) { inQueue = true; break; }
            if (!inQueue)
                this.presence.delete(pid);
        }
    }
    /** Resolve a partida por W.O. e aplica um strike de grief ao faltante. */
    async resolveWithStrike(m, winnerId, loserId) {
        this.apply(m, { type: "RESOLVE", winnerId, reason: "walkover", at: this.now() });
        const applied = await this.applyRating(m.id);
        this.apply(this.matches.get(m.id), { type: "MARK_RATED" });
        await this.save(this.matches.get(m.id));
        await this.repo.addStrike(loserId, "grief", m.id, "não jogou/contestou após reivindicação");
        for (const pid of [m.hostId, m.joinerId]) {
            const delta = applied ? (pid === m.hostId ? applied.host : applied.joiner) : null;
            this.send(pid, {
                type: "match_resolved",
                matchId: m.id,
                youWon: winnerId === pid,
                reason: "walkover",
                ratingBefore: delta?.before ?? 0,
                ratingAfter: delta?.after ?? 0,
            });
        }
        this.cleanup(m.id);
    }
    // ----------------------------- interno -----------------------------
    async createAndAnnounce(format, host, joiner) {
        const id = randomUUID();
        const m = createMatch({
            id,
            format,
            hostId: host.playerId,
            joinerId: joiner.playerId,
            now: this.now(),
        });
        this.matches.set(id, m);
        this.playerMatch.set(host.playerId, id);
        this.playerMatch.set(joiner.playerId, id);
        this.deadlines.set(id, this.now() + this.cfg.matchedTimeoutMs);
        await this.save(m);
        const hostName = this.nameOf(host.playerId);
        const joinerName = this.nameOf(joiner.playerId);
        this.send(host.playerId, {
            type: "match_found",
            matchId: id,
            format,
            side: "host",
            opponent: { displayName: joinerName, rating: joiner.rating },
        });
        this.send(joiner.playerId, {
            type: "match_found",
            matchId: id,
            format,
            side: "joiner",
            opponent: { displayName: hostName, rating: host.rating },
        });
        // ordem ao host: criar a sala
        this.send(host.playerId, { type: "create_room", matchId: id, format });
    }
    async attemptResolve(m, graceExpired = false) {
        if (!["IN_GAME", "ABANDON_GRACE", "RESULT_REPORTED", "DISPUTED"].includes(m.state))
            return;
        const rep = this.reports.get(m.id) ?? {};
        const result = reconcile({
            reportHost: rep.host,
            reportJoiner: rep.joiner,
            hostConnected: this.isConnected(m.hostId),
            joinerConnected: this.isConnected(m.joinerId),
            graceExpired: graceExpired || this.graceExpired(m),
        });
        if (result.status === "pending")
            return;
        if (result.status === "dispute") {
            if (m.state !== "DISPUTED")
                this.apply(m, { type: "DISPUTE" });
            await this.save(this.matches.get(m.id));
            this.send(m.hostId, { type: "match_disputed", matchId: m.id });
            this.send(m.joinerId, { type: "match_disputed", matchId: m.id });
            this.cleanup(m.id);
            return;
        }
        let winnerId = null;
        let reason = "score";
        if (result.status === "double_no_show") {
            winnerId = null;
            reason = "double_no_show";
        }
        else {
            winnerId = result.winner === "host" ? m.hostId : m.joinerId;
            reason = result.reason;
        }
        this.apply(m, { type: "RESOLVE", winnerId, reason: reason, at: this.now() });
        const applied = await this.applyRating(m.id);
        this.apply(this.matches.get(m.id), { type: "MARK_RATED" });
        await this.save(this.matches.get(m.id));
        // notifica cada jogador com sua variação de MMR
        for (const pid of [m.hostId, m.joinerId]) {
            const delta = applied
                ? pid === m.hostId
                    ? applied.host
                    : applied.joiner
                : null;
            this.send(pid, {
                type: "match_resolved",
                matchId: m.id,
                youWon: winnerId === null ? null : winnerId === pid,
                reason: reason,
                ratingBefore: delta?.before ?? 0,
                ratingAfter: delta?.after ?? 0,
            });
        }
        this.cleanup(m.id);
    }
    async applyRating(matchId) {
        const m = this.matches.get(matchId);
        return applyRatedResult(this.repo, {
            matchId: m.id,
            format: m.format,
            hostId: m.hostId,
            joinerId: m.joinerId,
            winnerId: m.winnerId ?? null,
            reason: m.reason ?? "score",
        });
    }
    cancel(m, reason) {
        this.apply(m, { type: "CANCEL", at: this.now() });
        this.send(m.hostId, { type: "match_cancelled", matchId: m.id, reason });
        this.send(m.joinerId, { type: "match_cancelled", matchId: m.id, reason });
        this.cleanup(m.id);
    }
    /** Aplica um evento à partida e persiste o novo estado em memória. */
    apply(m, ev) {
        try {
            const next = transition(this.matches.get(m.id) ?? m, ev);
            this.matches.set(next.id, next);
        }
        catch {
            // transição ilegal por corrida: ignora silenciosamente
        }
    }
    /** Persiste a partida sem deixar um erro de persistência travar o fluxo. */
    async save(m) {
        try {
            await this.repo.saveMatch(m);
        }
        catch (e) {
            console.error("[orchestrator] saveMatch falhou:", e);
        }
    }
    cleanup(matchId) {
        const m = this.matches.get(matchId);
        if (m) {
            this.playerMatch.delete(m.hostId);
            this.playerMatch.delete(m.joinerId);
        }
        this.reports.delete(matchId);
        this.deadlines.delete(matchId);
        this.griefClaims.delete(matchId);
        this.confirmations.delete(matchId);
        this.confirmDeadlines.delete(matchId);
        this.scoreWatch.delete(matchId);
        // a partida já foi persistida; remover da memória evita o mapa crescer para
        // sempre (e o tick percorre matches a cada ciclo).
        this.matches.delete(matchId);
    }
    graceExpired(m) {
        const grace = this.cfg.reconnectGraceMs;
        const now = this.now();
        for (const side of ["host", "joiner"]) {
            const dc = m.disconnectedAt[side];
            if (dc !== undefined && now - dc >= grace)
                return true;
        }
        return false;
    }
    sideOf(m, playerId) {
        return m.hostId === playerId ? "host" : "joiner";
    }
    isParticipant(m, playerId) {
        return m.hostId === playerId || m.joinerId === playerId;
    }
    /**
     * Promove ROOM_READY→IN_GAME quando um participante age como se o jogo já
     * tivesse começado (reporta resultado, placar ou reivindica vitória). Torna a
     * resolução robusta mesmo que o `game_started` automático não tenha sido
     * detectado pela extensão (nomes de campo/binário no frame do RiftAtlas).
     */
    ensureStarted(m, playerId) {
        if (m.state === "ROOM_READY" && this.isParticipant(m, playerId)) {
            this.apply(m, { type: "GAME_STARTED", at: this.now() });
            this.deadlines.delete(m.id);
        }
    }
    isConnected(playerId) {
        return this.presence.get(playerId)?.connected ?? false;
    }
    nameOf(playerId) {
        return this.presence.get(playerId)?.displayName ?? "Jogador";
    }
    // --------------------------- introspecção (testes/health) ---------------------------
    _match(id) {
        return this.matches.get(id);
    }
    _queueSize(format) {
        return this.queues.get(format)?.size ?? 0;
    }
    matchOf(playerId) {
        return this.playerMatch.get(playerId);
    }
}
export { PROVISIONAL_RD };

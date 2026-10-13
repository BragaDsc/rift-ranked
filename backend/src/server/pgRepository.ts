import type { Format, PlayerId } from "../domain/types.js";
import type { Match } from "../domain/match.js";
import type { PlayerRecord, RatingRecord, Repository, RatingHistoryRow, LeaderboardRow, HistoryPoint, ConductRecord, StrikeKind } from "./repository.js";

/**
 * Implementação PostgreSQL da interface Repository (produção).
 * Mesmo contrato do InMemoryRepository — o resto do código não muda.
 */
import pg from "pg";
import { defaultState } from "../rating/glicko2.js";
import { penaltyFor } from "../domain/conduct.js";
const { Pool } = pg;
export class PgRepository {
    pool;
    constructor(connectionString) {
        this.pool = new Pool({ connectionString, max: 10 });
    }
    async close() {
        await this.pool.end();
    }
    async getOrCreatePlayer(args) {
        const { rows } = await this.pool.query(`INSERT INTO players (clerk_user_id, display_name, riftatlas_plr_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (clerk_user_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             riftatlas_plr_id = COALESCE(EXCLUDED.riftatlas_plr_id, players.riftatlas_plr_id)
       RETURNING id, clerk_user_id, display_name, riftatlas_plr_id`, [args.clerkUserId, args.displayName, args.riftatlasPlrId ?? null]);
        const r = rows[0];
        return {
            id: r.id,
            clerkUserId: r.clerk_user_id,
            displayName: r.display_name,
            riftatlasPlrId: r.riftatlas_plr_id ?? undefined,
        };
    }
    async getRating(playerId, format) {
        const { rows } = await this.pool.query(`SELECT rating, rd, vol, games_played, wins, losses,
              walkovers_for, walkovers_against,
              EXTRACT(EPOCH FROM last_rated_at) * 1000 AS last_rated_ms
         FROM player_ratings WHERE player_id = $1 AND format = $2`, [playerId, format]);
        if (rows.length === 0) {
            const d = defaultState();
            return {
                playerId,
                format,
                ...d,
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                walkoversFor: 0,
                walkoversAgainst: 0,
            };
        }
        const r = rows[0];
        return {
            playerId,
            format,
            rating: Number(r.rating),
            rd: Number(r.rd),
            vol: Number(r.vol),
            gamesPlayed: r.games_played,
            wins: r.wins,
            losses: r.losses,
            walkoversFor: r.walkovers_for,
            walkoversAgainst: r.walkovers_against,
            lastRatedAt: r.last_rated_ms ? Number(r.last_rated_ms) : undefined,
        };
    }
    async saveRating(r) {
        await this.pool.query(`INSERT INTO player_ratings
         (player_id, format, rating, rd, vol, games_played, wins, losses,
          walkovers_for, walkovers_against, last_rated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, to_timestamp($11/1000.0))
       ON CONFLICT (player_id, format) DO UPDATE SET
         rating = EXCLUDED.rating, rd = EXCLUDED.rd, vol = EXCLUDED.vol,
         games_played = EXCLUDED.games_played, wins = EXCLUDED.wins,
         losses = EXCLUDED.losses, walkovers_for = EXCLUDED.walkovers_for,
         walkovers_against = EXCLUDED.walkovers_against,
         last_rated_at = EXCLUDED.last_rated_at`, [
            r.playerId,
            r.format,
            r.rating,
            r.rd,
            r.vol,
            r.gamesPlayed,
            r.wins,
            r.losses,
            r.walkoversFor,
            r.walkoversAgainst,
            r.lastRatedAt ?? Date.now(),
        ]);
    }
    async saveMatch(m) {
        await this.pool.query(`INSERT INTO matches
         (id, format, player_a, player_b, room_code, state, created_at,
          started_at, ended_at, games_won_a, games_won_b, winner_id, result_reason)
       VALUES ($1,$2,$3,$4,$5,$6, to_timestamp($7/1000.0),
               to_timestamp($8/1000.0), to_timestamp($9/1000.0),$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         room_code = EXCLUDED.room_code, state = EXCLUDED.state,
         started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
         games_won_a = EXCLUDED.games_won_a, games_won_b = EXCLUDED.games_won_b,
         winner_id = EXCLUDED.winner_id, result_reason = EXCLUDED.result_reason`, [
            m.id,
            m.format,
            m.hostId,
            m.joinerId,
            m.roomCode ?? null,
            m.state,
            m.createdAt,
            m.startedAt ?? null,
            m.endedAt ?? null,
            m.gamesWon.host,
            m.gamesWon.joiner,
            m.winnerId ?? null,
            m.reason ?? null,
        ]);
    }
    async appendRatingHistory(h) {
        await this.pool.query(`INSERT INTO rating_history
         (player_id, match_id, format, rating_before, rd_before, vol_before,
          rating_after, rd_after, vol_after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
            h.playerId,
            h.matchId,
            h.format,
            h.before.rating,
            h.before.rd,
            h.before.vol,
            h.after.rating,
            h.after.rd,
            h.after.vol,
        ]);
    }
    async leaderboard(format, limit) {
        const { rows } = await this.pool.query(`SELECT pr.player_id, pr.rating, pr.rd, pr.vol, pr.games_played, pr.wins,
              pr.losses, pr.walkovers_for, pr.walkovers_against, p.display_name
         FROM player_ratings pr
         JOIN players p ON p.id = pr.player_id
        WHERE pr.format = $1
        ORDER BY pr.rating DESC LIMIT $2`, [format, limit]);
        return rows.map((r) => ({
            playerId: r.player_id,
            format,
            rating: Number(r.rating),
            rd: Number(r.rd),
            vol: Number(r.vol),
            gamesPlayed: r.games_played,
            wins: r.wins,
            losses: r.losses,
            walkoversFor: r.walkovers_for,
            walkoversAgainst: r.walkovers_against,
            displayName: r.display_name,
        }));
    }
    async getPlayer(id) {
        let rows;
        try {
            ({ rows } = await this.pool.query(`SELECT id, clerk_user_id, display_name, riftatlas_plr_id
           FROM players WHERE id = $1`, [id]));
        }
        catch {
            // id malformado (ex.: não é UUID) → trata como não encontrado
            return null;
        }
        if (rows.length === 0)
            return null;
        const r = rows[0];
        return {
            id: r.id,
            clerkUserId: r.clerk_user_id,
            displayName: r.display_name,
            riftatlasPlrId: r.riftatlas_plr_id ?? undefined,
        };
    }
    async ratingHistory(playerId, format, limit) {
        const { rows } = await this.pool.query(`SELECT EXTRACT(EPOCH FROM created_at) * 1000 AS at, rating_after
         FROM rating_history
        WHERE player_id = $1 AND format = $2
        ORDER BY created_at ASC
        LIMIT $3`, [playerId, format, limit]);
        return rows.map((r) => ({ at: Number(r.at), rating: Number(r.rating_after) }));
    }
    async rankPosition(playerId, format) {
        try {
            const { rows } = await this.pool.query(`WITH me AS (
           SELECT rating FROM player_ratings
            WHERE player_id = $1 AND format = $2 AND games_played > 0)
         SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM me) THEN NULL
           ELSE (SELECT count(*) + 1 FROM player_ratings pr, me
                  WHERE pr.format = $2 AND pr.games_played > 0 AND pr.rating > me.rating)
           END AS pos`, [playerId, format]);
            const pos = rows[0]?.pos;
            return pos == null ? null : Number(pos);
        }
        catch {
            return null;
        }
    }
    async getConduct(playerId) {
        const [cr, ar] = await Promise.all([
            this.pool.query(`SELECT strikes, disputes, griefs,
                EXTRACT(EPOCH FROM banned_until) * 1000 AS banned
           FROM player_conduct WHERE player_id = $1`, [playerId]),
            this.pool.query(`SELECT count(*) AS n FROM conduct_events
          WHERE player_id = $1 AND created_at >= now() - interval '30 days'`, [playerId]),
        ]);
        const c = cr.rows[0];
        return {
            playerId,
            strikes: c ? c.strikes : 0,
            activeStrikes: Number(ar.rows[0].n),
            bannedUntil: c?.banned ? Number(c.banned) : undefined,
            disputes: c ? c.disputes : 0,
            griefs: c ? c.griefs : 0,
        };
    }
    async addStrike(playerId, kind, matchId, note) {
        await this.pool.query(`INSERT INTO conduct_events (player_id, match_id, kind, note) VALUES ($1,$2,$3,$4)`, [playerId, matchId ?? null, kind, note ?? null]);
        const { rows: ar } = await this.pool.query(`SELECT count(*) AS n FROM conduct_events
        WHERE player_id = $1 AND created_at >= now() - interval '30 days'`, [playerId]);
        const active = Number(ar[0].n);
        const pen = penaltyFor(active);
        const banExpr = pen.banMs > 0 ? `now() + interval '${pen.banMs} milliseconds'` : "NULL";
        const { rows } = await this.pool.query(`INSERT INTO player_conduct
         (player_id, strikes, active_strikes, last_strike_at, disputes, griefs, banned_until, updated_at)
       VALUES ($1, 1, $2, now(), $3, $4, ${banExpr}, now())
       ON CONFLICT (player_id) DO UPDATE SET
         strikes = player_conduct.strikes + 1,
         active_strikes = $2,
         last_strike_at = now(),
         disputes = player_conduct.disputes + $3,
         griefs = player_conduct.griefs + $4,
         banned_until = ${banExpr},
         updated_at = now()
       RETURNING strikes, disputes, griefs, EXTRACT(EPOCH FROM banned_until) * 1000 AS banned`, [playerId, active, kind === "dispute" ? 1 : 0, kind === "grief" ? 1 : 0]);
        const c = rows[0];
        return {
            playerId,
            strikes: c.strikes,
            activeStrikes: active,
            bannedUntil: c.banned ? Number(c.banned) : undefined,
            disputes: c.disputes,
            griefs: c.griefs,
        };
    }
    /** Registra/atualiza a avaliação (like=+1, dislike=-1) de `fromId` sobre `toId`.
     *  Uma opinião por par (a mais recente vale) — evita inflar reputação repetindo. */
    async setLike(fromId, toId, value, matchId) {
        if (!fromId || !toId || fromId === toId)
            return;
        const v = value > 0 ? 1 : value < 0 ? -1 : 0;
        if (v === 0) {
            await this.pool.query(`DELETE FROM player_likes WHERE from_id = $1 AND to_id = $2`, [fromId, toId]);
            return;
        }
        await this.pool.query(`INSERT INTO player_likes (from_id, to_id, value, match_id, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (from_id, to_id) DO UPDATE SET
         value = EXCLUDED.value, match_id = EXCLUDED.match_id, updated_at = now()`, [fromId, toId, v, matchId ?? null]);
    }
    /** Reputação recebida por `toId`: likes, dislikes e saldo (net = likes - dislikes). */
    async getLikeStats(playerId) {
        try {
            const { rows } = await this.pool.query(`SELECT
           COALESCE(SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END),0) AS likes,
           COALESCE(SUM(CASE WHEN value < 0 THEN 1 ELSE 0 END),0) AS dislikes,
           COALESCE(SUM(value),0) AS net
         FROM player_likes WHERE to_id = $1`, [playerId]);
            const r = rows[0];
            return { likes: Number(r.likes), dislikes: Number(r.dislikes), net: Number(r.net) };
        }
        catch {
            return { likes: 0, dislikes: 0, net: 0 };
        }
    }
    /** Salva o Legend/champion/deck de um jogador numa partida. selfReported=true
     *  (reporte do próprio) é autoritativo; o reporte do oponente só preenche se faltar. */
    async saveMatchDeck(matchId, format, playerId, info, selfReported) {
        const deck = info.deck ? JSON.stringify(info.deck) : null;
        if (selfReported) {
            await this.pool.query(`INSERT INTO match_decks
           (match_id, format, player_id, legend_code, legend_name, champion_code, champion_name, deck, self_reported)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,true)
         ON CONFLICT (match_id, player_id) DO UPDATE SET
           format=EXCLUDED.format, legend_code=EXCLUDED.legend_code, legend_name=EXCLUDED.legend_name,
           champion_code=EXCLUDED.champion_code, champion_name=EXCLUDED.champion_name,
           deck=COALESCE(EXCLUDED.deck, match_decks.deck), self_reported=true`, [matchId, format, playerId, info.legendCode ?? null, info.legendName ?? null, info.championCode ?? null, info.championName ?? null, deck]);
        }
        else {
            // reporte do oponente: só insere se ainda não há linha (não sobrescreve o self-report)
            await this.pool.query(`INSERT INTO match_decks
           (match_id, format, player_id, legend_code, legend_name, champion_code, champion_name, self_reported)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false)
         ON CONFLICT (match_id, player_id) DO NOTHING`, [matchId, format, playerId, info.legendCode ?? null, info.legendName ?? null, info.championCode ?? null, info.championName ?? null]);
        }
    }
    /** Estatística por campeão (Legend) num formato: jogos, vitórias, winrate. */
    async championStats(format, limit) {
        const { rows } = await this.pool.query(`SELECT md.legend_code, max(md.legend_name) AS legend_name,
              max(md.champion_code) AS champion_code,
              count(*)::int AS games,
              count(*) FILTER (WHERE m.winner_id = md.player_id)::int AS wins
         FROM match_decks md
         JOIN matches m ON m.id = md.match_id
        WHERE md.format = $1 AND md.legend_code IS NOT NULL
          AND m.state = 'RATED' AND m.winner_id IS NOT NULL
          AND m.result_reason <> 'double_no_show'
        GROUP BY md.legend_code
        ORDER BY games DESC, wins DESC
        LIMIT $2`, [format, limit]);
        return rows.map((r) => ({
            legendCode: r.legend_code,
            legendName: r.legend_name,
            championCode: r.champion_code,
            games: r.games,
            wins: r.wins,
            losses: r.games - r.wins,
            winrate: r.games ? Math.round((r.wins / r.games) * 100) : 0,
        }));
    }
    /** Campeões (Legends) que um jogador usou num formato, com V/D. */
    async playerChampions(playerId, format) {
        const { rows } = await this.pool.query(`SELECT md.legend_code, max(md.legend_name) AS legend_name,
              max(md.champion_code) AS champion_code,
              count(*)::int AS games,
              count(*) FILTER (WHERE m.winner_id = md.player_id)::int AS wins
         FROM match_decks md
         JOIN matches m ON m.id = md.match_id
        WHERE md.player_id = $1 AND md.format = $2 AND md.legend_code IS NOT NULL
          AND m.state = 'RATED' AND m.winner_id IS NOT NULL
          AND m.result_reason <> 'double_no_show'
        GROUP BY md.legend_code
        ORDER BY games DESC`, [playerId, format]);
        return rows.map((r) => ({
            legendCode: r.legend_code,
            legendName: r.legend_name,
            championCode: r.champion_code,
            games: r.games,
            wins: r.wins,
            losses: r.games - r.wins,
            winrate: r.games ? Math.round((r.wins / r.games) * 100) : 0,
        }));
    }
    rowToMatch(r) {
        return {
            id: r.id,
            format: r.format,
            hostId: r.player_a,
            joinerId: r.player_b,
            state: r.state,
            roomCode: r.room_code ?? undefined,
            createdAt: Number(r.created_ms),
            startedAt: r.started_ms ? Number(r.started_ms) : undefined,
            endedAt: r.ended_ms ? Number(r.ended_ms) : undefined,
            gamesWon: { host: r.games_won_a, joiner: r.games_won_b },
            winnerId: r.winner_id ?? null,
            reason: r.result_reason ?? undefined,
            disconnectedAt: {},
        };
    }
    MATCH_COLS = `id, format, player_a, player_b, room_code, state,
    EXTRACT(EPOCH FROM created_at)*1000 AS created_ms,
    EXTRACT(EPOCH FROM started_at)*1000 AS started_ms,
    EXTRACT(EPOCH FROM ended_at)*1000 AS ended_ms,
    games_won_a, games_won_b, winner_id, result_reason`;
    async getMatchById(id) {
        try {
            const { rows } = await this.pool.query(`SELECT ${this.MATCH_COLS} FROM matches WHERE id = $1`, [id]);
            return rows[0] ? this.rowToMatch(rows[0]) : null;
        }
        catch {
            return null;
        }
    }
    async listMatchesByState(state, limit) {
        const { rows } = await this.pool.query(`SELECT ${this.MATCH_COLS} FROM matches WHERE state = $1 ORDER BY created_at DESC LIMIT $2`, [state, limit]);
        return rows.map((r) => this.rowToMatch(r));
    }
}

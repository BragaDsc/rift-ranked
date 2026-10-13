/**
 * Batch diário — recalcula os ratings Glicko-2 a partir do histórico de partidas
 * (fonte de verdade), usando PERÍODOS de rating diários.
 *
 * O caminho por-partida (rateSingle) dá feedback imediato; este batch reconcilia:
 * reprocessa todas as partidas RATED agrupadas por dia, aplicando o Glicko-2
 * canônico (todos os jogos de um período usam os ratings do INÍCIO do período,
 * jogadores inativos sofrem decay), e sobrescreve `player_ratings` + reconstrói
 * `rating_history` por formato.
 *
 * Execução: node dist/batch/recompute.js   (usa DATABASE_URL)
 */
import pg from "pg";
import { rate, decay, defaultState, } from "../rating/glicko2.js";
const DAY = 86_400_000;
async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("[batch] DATABASE_URL ausente");
        process.exit(1);
    }
    const pool = new pg.Pool({ connectionString: url });
    try {
        const { rows } = await pool.query(`SELECT format, player_a, player_b, winner_id,
              EXTRACT(EPOCH FROM ended_at) * 1000 AS ended, result_reason
         FROM matches
        WHERE state = 'RATED' AND winner_id IS NOT NULL
          AND result_reason <> 'double_no_show'
        ORDER BY ended_at ASC`);
        const matches = rows.map((r) => ({
            format: r.format,
            a: r.player_a,
            b: r.player_b,
            winner: r.winner_id,
            endedAt: Number(r.ended),
            reason: r.result_reason,
        }));
        let total = 0;
        for (const format of ["bo1", "bo3"]) {
            const n = await recomputeFormat(pool, format, matches.filter((m) => m.format === format));
            total += n;
        }
        console.log(`[batch] ${new Date().toISOString()} recompute concluído — ${total} partidas processadas`);
    }
    finally {
        await pool.end();
    }
}
async function recomputeFormat(pool, format, matches) {
    const states = new Map();
    const counters = new Map();
    const seen = new Set();
    const history = [];
    const ctr = (id) => {
        let c = counters.get(id);
        if (!c) {
            c = { wins: 0, losses: 0, wfor: 0, wagainst: 0, games: 0 };
            counters.set(id, c);
        }
        return c;
    };
    // agrupa por dia (período de rating)
    const byPeriod = new Map();
    for (const m of matches) {
        const k = Math.floor(m.endedAt / DAY);
        (byPeriod.get(k) ?? byPeriod.set(k, []).get(k)).push(m);
    }
    const periods = [...byPeriod.keys()].sort((a, b) => a - b);
    for (const key of periods) {
        const periodMatches = byPeriod.get(key);
        const periodEnd = Math.max(...periodMatches.map((m) => m.endedAt));
        const start = new Map(states); // snapshot: ratings do INÍCIO do período
        const results = new Map();
        const played = new Set();
        const stateAtStart = (id) => start.get(id) ?? defaultState();
        const addResult = (id, opp, score) => {
            if (!results.has(id))
                results.set(id, []);
            results.get(id).push({ opponent: opp, score });
            played.add(id);
            seen.add(id);
        };
        for (const m of periodMatches) {
            const aStart = stateAtStart(m.a);
            const bStart = stateAtStart(m.b);
            addResult(m.a, bStart, m.winner === m.a ? 1 : 0);
            addResult(m.b, aStart, m.winner === m.b ? 1 : 0);
            const aWon = m.winner === m.a;
            const isWO = m.reason === "walkover";
            const ca = ctr(m.a), cb = ctr(m.b);
            ca.games++;
            cb.games++;
            if (aWon) {
                ca.wins++;
                cb.losses++;
                if (isWO) {
                    ca.wfor++;
                    cb.wagainst++;
                }
            }
            else {
                cb.wins++;
                ca.losses++;
                if (isWO) {
                    cb.wfor++;
                    ca.wagainst++;
                }
            }
        }
        // jogadores que jogaram: aplica rate(); inativos (já vistos): decay
        for (const id of seen) {
            const before = stateAtStart(id);
            let after;
            if (played.has(id)) {
                after = rate(before, results.get(id));
                history.push({ playerId: id, at: periodEnd, before, after });
            }
            else {
                after = decay(before);
            }
            states.set(id, after);
        }
    }
    // escreve resultados (transação): player_ratings + rating_history
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const [id, s] of states) {
            const c = ctr(id);
            await client.query(`INSERT INTO player_ratings
           (player_id, format, rating, rd, vol, games_played, wins, losses,
            walkovers_for, walkovers_against, last_rated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (player_id, format) DO UPDATE SET
           rating=EXCLUDED.rating, rd=EXCLUDED.rd, vol=EXCLUDED.vol,
           games_played=EXCLUDED.games_played, wins=EXCLUDED.wins, losses=EXCLUDED.losses,
           walkovers_for=EXCLUDED.walkovers_for, walkovers_against=EXCLUDED.walkovers_against,
           last_rated_at=now()`, [id, format, s.rating, s.rd, s.vol, c.games, c.wins, c.losses, c.wfor, c.wagainst]);
        }
        // reconstrói o histórico do formato (canônico, por período)
        await client.query(`DELETE FROM rating_history WHERE format=$1`, [format]);
        for (const h of history) {
            await client.query(`INSERT INTO rating_history
           (player_id, match_id, format, rating_before, rd_before, vol_before,
            rating_after, rd_after, vol_after, created_at)
         VALUES ($1, NULL, $2, $3,$4,$5, $6,$7,$8, to_timestamp($9/1000.0))`, [h.playerId, format, h.before.rating, h.before.rd, h.before.vol,
                h.after.rating, h.after.rd, h.after.vol, h.at]);
        }
        await client.query("COMMIT");
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
    return matches.length;
}
main().catch((e) => {
    console.error("[batch] erro:", e);
    process.exit(1);
});

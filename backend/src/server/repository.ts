import type { Format, PlayerId } from "../domain/types.js";
import type { Match } from "../domain/match.js";
import { type Glicko2State } from "../rating/glicko2.js";
export interface PlayerRecord { id: PlayerId; clerkUserId: string; riftatlasPlrId?: string; displayName: string; }
export interface RatingRecord extends Glicko2State {
  playerId: PlayerId; format: Format; gamesPlayed: number; wins: number; losses: number;
  walkoversFor: number; walkoversAgainst: number; lastRatedAt?: number;
}
export type StrikeKind = "grief" | "dispute" | "manual";
export interface ConductRecord {
  playerId: PlayerId; strikes: number; activeStrikes: number; bannedUntil?: number; disputes: number; griefs: number;
}
export interface LeaderboardRow extends RatingRecord { displayName: string; }
export interface HistoryPoint { at: number; rating: number; }
export interface RatingHistoryRow { playerId: PlayerId; matchId: string; format: Format; before: Glicko2State; after: Glicko2State; }
export interface Repository {
  getOrCreatePlayer(args: { clerkUserId: string; displayName: string; riftatlasPlrId?: string }): Promise<PlayerRecord>;
  getRating(playerId: PlayerId, format: Format): Promise<RatingRecord>;
  saveRating(r: RatingRecord): Promise<void>;
  saveMatch(m: Match): Promise<void>;
  appendRatingHistory(h: RatingHistoryRow): Promise<void>;
  leaderboard(format: Format, limit: number): Promise<LeaderboardRow[]>;
  getPlayer(id: PlayerId): Promise<PlayerRecord | null>;
  ratingHistory(playerId: PlayerId, format: Format, limit: number): Promise<HistoryPoint[]>;
  rankPosition(playerId: PlayerId, format: Format): Promise<number | null>;
  getConduct(playerId: PlayerId): Promise<ConductRecord>;
  addStrike(playerId: PlayerId, kind: StrikeKind, matchId?: string, note?: string): Promise<ConductRecord>;
  getMatchById(id: string): Promise<Match | null>;
  listMatchesByState(state: string, limit: number): Promise<Match[]>;
  /** Avaliação do oponente (like=+1, dislike=-1); uma opinião por par. */
  setLike?(fromId: PlayerId, toId: PlayerId, value: number, matchId?: string): Promise<void>;
  /** Reputação recebida: likes, dislikes e saldo. */
  getLikeStats?(playerId: PlayerId): Promise<{ likes: number; dislikes: number; net: number }>;
  /** Salva o Legend/champion/deck de um jogador numa partida. */
  saveMatchDeck?(matchId: string, format: Format, playerId: PlayerId, info: { legendCode: string | null; legendName: string | null; championCode: string | null; championName: string | null; deck?: any }, selfReported: boolean): Promise<void>;
  /** Estatística por campeão (Legend) num formato. */
  championStats?(format: Format, limit: number): Promise<ChampionStat[]>;
  /** Campeões usados por um jogador num formato. */
  playerChampions?(playerId: PlayerId, format: Format): Promise<ChampionStat[]>;
  /** Confrontos do jogador contra cada oponente (com Legend vs Legend). */
  playerHeadToHead?(playerId: PlayerId, format: Format): Promise<any[]>;
  /** Matchup global Legend vs Legend (direcionado). */
  legendMatchups?(format: Format): Promise<any[]>;
}

export interface ChampionStat {
  legendCode: string;
  legendName: string;
  championCode: string | null;
  games: number;
  wins: number;
  losses: number;
  winrate: number;
}

/**
 * Persistência. Interface + implementação em memória (dev/testes).
 * A implementação PostgreSQL (pg) entra na hora do deploy, cumprindo a mesma
 * interface — o resto do código não muda.
 */
import { defaultState, } from "../rating/glicko2.js";
import { penaltyFor, STRIKE_WINDOW_MS } from "../domain/conduct.js";
/** RD abaixo do qual o jogador deixa de ser "provisório". */
export const PROVISIONAL_RD = 100;
function newRating(playerId, format) {
    return {
        playerId,
        format,
        ...defaultState(),
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        walkoversFor: 0,
        walkoversAgainst: 0,
    };
}
export class InMemoryRepository {
    players = new Map(); // por clerkUserId
    byId = new Map();
    ratings = new Map(); // `${playerId}:${format}`
    matches = new Map();
    history = [];
    conduct = new Map();
    conductEvents = [];
    seq = 0;
    async getOrCreatePlayer(args) {
        let p = this.players.get(args.clerkUserId);
        if (!p) {
            p = {
                id: `plr-${++this.seq}`,
                clerkUserId: args.clerkUserId,
                displayName: args.displayName,
                riftatlasPlrId: args.riftatlasPlrId,
            };
            this.players.set(args.clerkUserId, p);
            this.byId.set(p.id, p);
        }
        else {
            // atualiza dados mutáveis
            if (args.displayName)
                p.displayName = args.displayName;
            if (args.riftatlasPlrId)
                p.riftatlasPlrId = args.riftatlasPlrId;
        }
        return p;
    }
    async getRating(playerId, format) {
        const key = `${playerId}:${format}`;
        let r = this.ratings.get(key);
        if (!r) {
            r = newRating(playerId, format);
            this.ratings.set(key, r);
        }
        return { ...r };
    }
    async saveRating(r) {
        this.ratings.set(`${r.playerId}:${r.format}`, { ...r });
    }
    async saveMatch(m) {
        this.matches.set(m.id, { ...m });
    }
    async appendRatingHistory(h) {
        this.history.push({ ...h, at: Date.now() });
    }
    async getPlayer(id) {
        return this.byId.get(id) ?? null;
    }
    async ratingHistory(playerId, format, limit) {
        return this.history
            .filter((h) => h.playerId === playerId && h.format === format)
            .sort((a, b) => a.at - b.at)
            .slice(-limit)
            .map((h) => ({ at: h.at, rating: h.after.rating }));
    }
    async rankPosition(playerId, format) {
        const list = [...this.ratings.values()]
            .filter((r) => r.format === format && r.gamesPlayed > 0)
            .sort((a, b) => b.rating - a.rating);
        const idx = list.findIndex((r) => r.playerId === playerId);
        return idx === -1 ? null : idx + 1;
    }
    activeStrikes(playerId) {
        const since = Date.now() - STRIKE_WINDOW_MS;
        return this.conductEvents.filter((e) => e.playerId === playerId && e.at >= since).length;
    }
    async getConduct(playerId) {
        const c = this.conduct.get(playerId) ?? { strikes: 0, disputes: 0, griefs: 0 };
        return {
            playerId,
            strikes: c.strikes,
            activeStrikes: this.activeStrikes(playerId),
            bannedUntil: c.bannedUntil,
            disputes: c.disputes,
            griefs: c.griefs,
        };
    }
    async addStrike(playerId, kind) {
        this.conductEvents.push({ playerId, kind, at: Date.now() });
        const c = this.conduct.get(playerId) ?? { strikes: 0, disputes: 0, griefs: 0 };
        c.strikes += 1;
        if (kind === "grief")
            c.griefs += 1;
        if (kind === "dispute")
            c.disputes += 1;
        const active = this.activeStrikes(playerId);
        const pen = penaltyFor(active);
        if (pen.banMs > 0)
            c.bannedUntil = Date.now() + pen.banMs;
        this.conduct.set(playerId, c);
        return {
            playerId,
            strikes: c.strikes,
            activeStrikes: active,
            bannedUntil: c.bannedUntil,
            disputes: c.disputes,
            griefs: c.griefs,
        };
    }
    async leaderboard(format, limit) {
        return [...this.ratings.values()]
            .filter((r) => r.format === format)
            .sort((a, b) => b.rating - a.rating)
            .slice(0, limit)
            .map((r) => ({
            ...r,
            displayName: this.byId.get(r.playerId)?.displayName ?? "Jogador",
        }));
    }
    async getMatchById(id) {
        return this.matches.get(id) ?? null;
    }
    async listMatchesByState(state, limit) {
        return [...this.matches.values()]
            .filter((m) => m.state === state)
            .slice(0, limit)
            .map((m) => ({ ...m }));
    }
    // helpers de teste
    _getMatch(id) {
        return this.matches.get(id);
    }
    _historyCount() {
        return this.history.length;
    }
}

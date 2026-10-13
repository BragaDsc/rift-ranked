import type { OrchestratorConfig } from "./orchestrator.js";
import type { Repository } from "./repository.js";
export interface RankedServer {
  httpServer: import("node:http").Server;
  orch: import("./orchestrator.js").Orchestrator;
  stop(): Promise<void>;
}

/**
 * Transporte: servidor HTTP (health + leaderboard) e WebSocket (extensão).
 * Caddy faz o proxy de `app.megacards.com.br/ranked/*` para cá.
 *   WS:   /ranked/ws
 *   HTTP: /ranked/api/health, /ranked/api/leaderboard?format=bo1|bo3
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import { Orchestrator, DEFAULT_CONFIG } from "./orchestrator.js";
import { PROVISIONAL_RD } from "./repository.js";
import { rankFor } from "../domain/tiers.js";
import { applyRatedResult } from "./ratingService.js";
import { verifyClerkToken } from "../auth/clerk.js";
function readJson(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => { try {
            resolve(JSON.parse(data || "{}"));
        }
        catch {
            resolve({});
        } });
    });
}
const WS_PATH = "/ranked/ws";
const TICK_MS = 1000;
/** Páginas estáticas (carregadas uma vez). */
function loadPage(name, fallback) {
    try {
        return readFileSync(new URL(`../../public/${name}`, import.meta.url), "utf8");
    }
    catch {
        return fallback;
    }
}
const LEADERBOARD_HTML = loadPage("leaderboard.html", "<!doctype html><meta charset=utf-8><title>Ranked</title><p>Leaderboard indisponível.</p>");
const PROFILE_HTML = loadPage("player.html", "<!doctype html><meta charset=utf-8><title>Perfil</title><p>Perfil indisponível.</p>");
const CHAMPIONS_HTML = loadPage("champions.html", "<!doctype html><meta charset=utf-8><title>Campeões</title><p>Indisponível.</p>");
const EXT_VERSION_JSON = loadPage("ext/version.json", '{"version":"0.0.0"}');
let EXT_ZIP = null;
try {
    EXT_ZIP = readFileSync(new URL("../../public/ext/riftatlas-ranked.zip", import.meta.url));
}
catch {
    /* zip não embarcado */
}
export function startServer(opts) {
    const { repo, port } = opts;
    const connsByPlayer = new Map();
    const send = (playerId, msg) => {
        const c = connsByPlayer.get(playerId);
        if (c && c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(JSON.stringify(msg));
        }
    };
    const orch = new Orchestrator(repo, send, opts.config ?? DEFAULT_CONFIG);
    // -------------------- HTTP (health + leaderboard) --------------------
    const httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost`);
        res.setHeader("Content-Type", "application/json");
        try {
            // página do leaderboard
            if (req.method === "GET" && (url.pathname === "/ranked" || url.pathname === "/ranked/")) {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(LEADERBOARD_HTML);
                return;
            }
            // página de perfil do jogador
            if (req.method === "GET" &&
                (url.pathname === "/ranked/jogador" || url.pathname === "/ranked/player")) {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(PROFILE_HTML);
                return;
            }
            // página de campeões (estatísticas por Legend)
            if (req.method === "GET" &&
                (url.pathname === "/ranked/campeoes" || url.pathname === "/ranked/champions")) {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(CHAMPIONS_HTML);
                return;
            }
            if (req.method === "GET" && url.pathname === "/ranked/api/champions") {
                const format = (url.searchParams.get("format") ?? "bo1");
                const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);
                const champions = (await repo.championStats?.(format, limit)) ?? [];
                const totalGames = champions.reduce((n, c) => n + c.games, 0);
                res.end(JSON.stringify({ format, totalGames, champions }));
                return;
            }
            if (req.method === "GET" && url.pathname === "/ranked/api/player") {
                const id = url.searchParams.get("id");
                const format = (url.searchParams.get("format") ?? "bo1");
                if (!id) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: "id obrigatório" }));
                    return;
                }
                const player = await repo.getPlayer(id);
                if (!player) {
                    res.statusCode = 404;
                    res.end(JSON.stringify({ error: "jogador não encontrado" }));
                    return;
                }
                const summary = async (f) => {
                    const r = await repo.getRating(id, f);
                    const total = r.wins + r.losses;
                    return {
                        rating: Math.round(r.rating),
                        rd: Math.round(r.rd),
                        games: r.gamesPlayed,
                        wins: r.wins,
                        losses: r.losses,
                        winrate: total ? Math.round((r.wins / total) * 100) : 0,
                        provisional: r.rd > PROVISIONAL_RD,
                        position: await repo.rankPosition(id, f),
                        rank: rankFor(r.rating, r.gamesPlayed),
                    };
                };
                const reputation = (await repo.getLikeStats?.(id)) ?? { likes: 0, dislikes: 0, net: 0 };
                const champions = (await repo.playerChampions?.(id, format)) ?? [];
                res.end(JSON.stringify({
                    player: { id: player.id, displayName: player.displayName },
                    format,
                    bo1: await summary("bo1"),
                    bo3: await summary("bo3"),
                    reputation,
                    champions,
                    history: await repo.ratingHistory(id, format, 200),
                }));
                return;
            }
            if (req.method === "GET" && url.pathname === "/ranked/api/health") {
                res.end(JSON.stringify({ ok: true }));
                return;
            }
            // versão da extensão (notificador de atualização)
            if (req.method === "GET" && url.pathname === "/ranked/api/ext-version") {
                res.setHeader("Cache-Control", "no-store, must-revalidate");
                res.end(EXT_VERSION_JSON);
                return;
            }
            // download do pacote da extensão
            if (req.method === "GET" && url.pathname === "/ranked/ext/riftatlas-ranked.zip") {
                if (!EXT_ZIP) {
                    res.statusCode = 404;
                    res.end(JSON.stringify({ error: "not found" }));
                    return;
                }
                res.setHeader("Content-Type", "application/zip");
                res.setHeader("Cache-Control", "no-store, must-revalidate");
                res.setHeader("Content-Disposition", "attachment; filename=riftatlas-ranked-extension.zip");
                res.end(EXT_ZIP);
                return;
            }
            if (req.method === "GET" && url.pathname === "/ranked/api/leaderboard") {
                const format = (url.searchParams.get("format") ?? "bo1");
                const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
                const rows = await repo.leaderboard(format, limit);
                res.end(JSON.stringify({
                    format,
                    players: rows.map((r, i) => {
                        const total = r.wins + r.losses;
                        return {
                            position: i + 1,
                            playerId: r.playerId,
                            displayName: r.displayName,
                            rating: Math.round(r.rating),
                            rd: Math.round(r.rd),
                            games: r.gamesPlayed,
                            wins: r.wins,
                            losses: r.losses,
                            winrate: total ? Math.round((r.wins / total) * 100) : 0,
                            provisional: r.rd > PROVISIONAL_RD,
                            rank: rankFor(r.rating, r.gamesPlayed),
                        };
                    }),
                }));
                return;
            }
            // --- admin de disputas (protegido por token) ---
            if (url.pathname.startsWith("/ranked/api/admin/")) {
                const token = url.searchParams.get("token");
                if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
                    res.statusCode = 403;
                    res.end(JSON.stringify({ error: "forbidden" }));
                    return;
                }
                if (req.method === "GET" && url.pathname === "/ranked/api/admin/disputes") {
                    const list = await repo.listMatchesByState("DISPUTED", 100);
                    const items = await Promise.all(list.map(async (m) => {
                        const [a, b] = await Promise.all([
                            repo.getPlayer(m.hostId),
                            repo.getPlayer(m.joinerId),
                        ]);
                        return {
                            matchId: m.id,
                            format: m.format,
                            createdAt: m.createdAt,
                            host: { id: m.hostId, name: a?.displayName },
                            joiner: { id: m.joinerId, name: b?.displayName },
                        };
                    }));
                    res.end(JSON.stringify({ disputes: items }));
                    return;
                }
                if (req.method === "POST" && url.pathname === "/ranked/api/admin/resolve") {
                    const body = await readJson(req);
                    const m = await repo.getMatchById(String(body.matchId ?? ""));
                    if (!m || m.state !== "DISPUTED") {
                        res.statusCode = 400;
                        res.end(JSON.stringify({ error: "partida não está em disputa" }));
                        return;
                    }
                    const winnerId = String(body.winnerId ?? "");
                    if (winnerId !== m.hostId && winnerId !== m.joinerId) {
                        res.statusCode = 400;
                        res.end(JSON.stringify({ error: "winnerId inválido" }));
                        return;
                    }
                    const loserId = winnerId === m.hostId ? m.joinerId : m.hostId;
                    await applyRatedResult(repo, {
                        matchId: m.id,
                        format: m.format,
                        hostId: m.hostId,
                        joinerId: m.joinerId,
                        winnerId,
                        reason: "disputed",
                    });
                    await repo.addStrike(loserId, "dispute", m.id, "disputa resolvida contra o jogador");
                    await repo.saveMatch({
                        ...m,
                        state: "RATED",
                        winnerId,
                        reason: "disputed",
                        endedAt: Date.now(),
                    });
                    res.end(JSON.stringify({ ok: true, winnerId, strikedPlayer: loserId }));
                    return;
                }
                res.statusCode = 404;
                res.end(JSON.stringify({ error: "not found" }));
                return;
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "not found" }));
        }
        catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
        }
    });
    // -------------------- WebSocket --------------------
    const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
    wss.on("connection", (ws) => {
        const conn: { ws: WebSocket; playerId?: string } = { ws };
        ws.on("message", async (data) => {
            let msg: any;
            try {
                msg = JSON.parse(data.toString());
            }
            catch {
                return send0(ws, { type: "error", message: "JSON inválido." });
            }
            // Antes de autenticar, só 'auth' é aceito.
            if (!conn.playerId) {
                if (msg.type !== "auth") {
                    return send0(ws, { type: "auth_error", message: "Autentique primeiro." });
                }
                try {
                    const id = await verifyClerkToken(msg.token);
                    const player = await repo.getOrCreatePlayer({
                        clerkUserId: id.clerkUserId,
                        displayName: msg.displayName || id.displayName,
                        riftatlasPlrId: msg.riftatlasPlrId,
                    });
                    conn.playerId = player.id;
                    connsByPlayer.set(player.id, conn);
                    orch.onConnected(player.id, player.displayName);
                    send0(ws, {
                        type: "auth_ok",
                        playerId: player.id,
                        ratings: await ratingsView(repo, player.id),
                    });
                    // retomada: se já estava numa partida (reload/reconexão), reenvia o contexto
                    orch.sendResume(player.id).catch(() => { });
                }
                catch (err) {
                    send0(ws, { type: "auth_error", message: "Token inválido." });
                    ws.close();
                }
                return;
            }
            await route(orch, conn.playerId, msg);
        });
        ws.on("close", () => {
            if (conn.playerId) {
                orch.onDisconnected(conn.playerId);
                // só remove o mapeamento se ainda aponta para esta conexão
                if (connsByPlayer.get(conn.playerId)?.ws === ws) {
                    connsByPlayer.delete(conn.playerId);
                }
            }
        });
    });
    const ticker = setInterval(() => {
        orch.tick().catch((e) => console.error("tick error", e));
    }, TICK_MS);
    httpServer.listen(port, () => {
        console.log(`[ranked] HTTP+WS ouvindo em :${port} (ws ${WS_PATH})`);
    });
    return {
        httpServer,
        orch,
        async stop() {
            clearInterval(ticker);
            wss.close();
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        },
    };
}
function send0(ws, msg) {
    if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(msg));
}
async function ratingsView(repo, playerId) {
    const out = [];
    for (const format of ["bo1", "bo3"]) {
        const r = await repo.getRating(playerId, format);
        out.push({
            format,
            rating: Math.round(r.rating),
            rd: Math.round(r.rd),
            provisional: r.rd > PROVISIONAL_RD,
        });
    }
    return out;
}
async function route(orch, playerId, msg) {
    switch (msg.type) {
        case "enqueue":
            return orch.onEnqueue(playerId, msg.format);
        case "dequeue":
            return orch.onDequeue(playerId, msg.format);
        case "heartbeat":
            return orch.onHeartbeat(playerId);
        case "room_code":
            return orch.onRoomCode(playerId, msg.matchId, msg.roomCode);
        case "game_started":
            return orch.onGameStarted(playerId, msg.matchId);
        case "game_score":
            return orch.onGameScore(playerId, msg.matchId, msg.host, msg.joiner);
        case "report":
            return orch.onReport(playerId, msg.matchId, msg.outcome);
        case "confirm_result":
            return orch.onConfirmResult(playerId, msg.matchId, msg.winner, msg.rate);
        case "deck_report":
            return orch.onDeckReport(playerId, msg);
        case "report_grief":
            return orch.onReportGrief(playerId, msg.matchId);
        case "contest_grief":
            return orch.onContestGrief(playerId, msg.matchId);
        case "auth":
            return; // já autenticado
    }
}

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
const PRIVACY_HTML = loadPage("privacidade.html", "<!doctype html><meta charset=utf-8><title>Privacidade</title><p>Indisponível.</p>");
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
    // Jogadores online = conexões autenticadas distintas. Transmite a contagem a
    // todos sempre que alguém entra/sai, para a extensão exibir em tempo real.
    const onlineCount = () => connsByPlayer.size;
    const broadcastOnline = () => {
        const payload = JSON.stringify({ type: "online_count", count: onlineCount() });
        for (const c of connsByPlayer.values()) {
            if (c.ws.readyState === WebSocket.OPEN)
                c.ws.send(payload);
        }
    };
    // Observabilidade: contadores de auth. Um pico de authFail = o RiftAtlas
    // provavelmente mudou (Clerk/selectors) — sinal de quebra visível em /api/stats.
    const metrics = { authOk: 0, authFail: 0, authFailTimes: [] as number[], authOkTimes: [] as number[] };
    const lastHour = (arr: number[]) => { const cut = Date.now() - 3600000; return arr.filter((t) => t >= cut); };
    const authFailsLastHour = () => (metrics.authFailTimes = lastHour(metrics.authFailTimes)).length;
    const okLastHour = () => (metrics.authOkTimes = lastHour(metrics.authOkTimes)).length;
    // Alerta ATIVO de quebra: se a auth falha em massa (RiftAtlas mudou o Clerk/
    // selectors), avisa num webhook (ALERT_WEBHOOK, ex.: Discord). No-op se não setado.
    let alertActive = false;
    async function notify(text: string) {
        const url = process.env.ALERT_WEBHOOK;
        if (!url) return;
        try {
            await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text }) });
        }
        catch (e) { console.error("[alert] falha ao notificar:", e); }
    }
    function checkAuthHealth() {
        const fails = authFailsLastHour(), oks = okLastHour();
        const broken = fails >= 5 && fails > oks; // muitas falhas e mais falhas que sucessos
        if (broken && !alertActive) {
            alertActive = true;
            notify(`🔴 Rift Ranked: possível quebra do RiftAtlas — ${fails} falhas de auth na última hora (só ${oks} sucessos). Verifique Clerk/__session.`);
        }
        else if (!broken && alertActive && oks > 0) {
            alertActive = false;
            notify(`🟢 Rift Ranked: auth normalizou (${oks} sucessos na última hora).`);
        }
    }
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
                (url.pathname === "/ranked/campeoes" || url.pathname === "/ranked/champions" || url.pathname === "/ranked/legends")) {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(CHAMPIONS_HTML);
                return;
            }
            // política de privacidade (exigida pela Chrome Web Store)
            if (req.method === "GET" &&
                (url.pathname === "/ranked/privacidade" || url.pathname === "/ranked/privacy")) {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(PRIVACY_HTML);
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
            if (req.method === "GET" && url.pathname === "/ranked/api/matchups") {
                const format = (url.searchParams.get("format") ?? "bo1");
                const matchups = (await repo.legendMatchups?.(format)) ?? [];
                res.end(JSON.stringify({ format, matchups }));
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
                const headToHead = (await repo.playerHeadToHead?.(id, format)) ?? [];
                res.end(JSON.stringify({
                    player: { id: player.id, displayName: player.displayName },
                    format,
                    bo1: await summary("bo1"),
                    bo3: await summary("bo3"),
                    reputation,
                    champions,
                    headToHead,
                    history: await repo.ratingHistory(id, format, 200),
                    matchHistory: (await repo.playerHistory?.(id, 20)) ?? [],
                }));
                return;
            }
            if (req.method === "GET" && url.pathname === "/ranked/api/health") {
                res.end(JSON.stringify({ ok: true }));
                return;
            }
            // jogadores online agora (conexões autenticadas)
            if (req.method === "GET" && url.pathname === "/ranked/api/online") {
                res.setHeader("Cache-Control", "no-store, must-revalidate");
                res.end(JSON.stringify({ count: onlineCount() }));
                return;
            }
            // métricas gerais (observabilidade): online, partidas ativas, filas, auth
            if (req.method === "GET" && url.pathname === "/ranked/api/stats") {
                res.setHeader("Cache-Control", "no-store, must-revalidate");
                res.end(JSON.stringify({
                    online: onlineCount(), ...orch.stats(),
                    authOk: metrics.authOk, authFail: metrics.authFail, authFailsLastHour: authFailsLastHour(),
                }));
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
            // --- admin (protegido por token) ---
            if (url.pathname.startsWith("/ranked/api/admin/")) {
                // preferir header (não vaza em logs/histórico); query mantida p/ compat
                const auth = String(req.headers["authorization"] || "");
                const token = (req.headers["x-admin-token"] as string)
                    || (auth.startsWith("Bearer ") ? auth.slice(7) : "")
                    || url.searchParams.get("token");
                if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
                    res.statusCode = 403;
                    res.end(JSON.stringify({ error: "forbidden" }));
                    return;
                }
                // métricas recentes (série temporal)
                if (req.method === "GET" && url.pathname === "/ranked/api/admin/metrics") {
                    const hours = Number(url.searchParams.get("hours") ?? 24);
                    const snapshots = (await repo.recentMetrics?.(hours)) ?? [];
                    res.end(JSON.stringify({ hours, snapshots, live: { online: onlineCount(), ...orch.stats(), authOk: metrics.authOk, authFail: metrics.authFail, authFailsLastHour: authFailsLastHour() } }));
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
                // reset de temporada (destrutivo): exige token + confirm=RESET
                if (req.method === "POST" && url.pathname === "/ranked/api/admin/reset-season") {
                    if (url.searchParams.get("confirm") !== "RESET") {
                        res.statusCode = 400;
                        res.end(JSON.stringify({ error: "passe ?confirm=RESET para confirmar" }));
                        return;
                    }
                    if (!repo.resetSeason) {
                        res.statusCode = 501;
                        res.end(JSON.stringify({ error: "não suportado neste repositório" }));
                        return;
                    }
                    await repo.resetSeason();
                    console.warn("[ranked] temporada RESETADA via admin");
                    res.end(JSON.stringify({ ok: true }));
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
        const conn: { ws: WebSocket; playerId?: string; winStart?: number; winCount?: number } = { ws };
        ws.on("message", async (data) => {
            // cap de tamanho: nenhuma mensagem legítima passa disso (deck_report é o maior)
            const raw = data.toString();
            if (raw.length > 32768)
                return send0(ws, { type: "error", message: "Mensagem grande demais." });
            // rate-limit simples por conexão: no máx. ~40 msgs/seg (descarta o excedente)
            const now = Date.now();
            if (!conn.winStart || now - conn.winStart >= 1000) { conn.winStart = now; conn.winCount = 0; }
            if ((conn.winCount = (conn.winCount ?? 0) + 1) > 40)
                return;
            let msg: any;
            try {
                msg = JSON.parse(raw);
            }
            catch {
                return send0(ws, { type: "error", message: "JSON inválido." });
            }
            if (!msg || typeof msg.type !== "string")
                return send0(ws, { type: "error", message: "Mensagem inválida." });
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
                    broadcastOnline(); // atualiza a contagem de online para todos
                    metrics.authOk++; metrics.authOkTimes.push(Date.now());
                }
                catch (err) {
                    metrics.authFail++; metrics.authFailTimes.push(Date.now());
                    console.error("[auth] token rejeitado:", err?.code || err?.name || err?.message || err);
                    send0(ws, { type: "auth_error", message: "Token inválido." });
                    ws.close();
                }
                return;
            }
            try {
                await route(orch, conn.playerId, msg);
            }
            catch (err) {
                console.error("[ranked] erro ao processar mensagem:", msg?.type, err);
                send0(ws, { type: "error", message: "Erro ao processar a mensagem." });
            }
        });
        ws.on("close", () => {
            if (conn.playerId) {
                orch.onDisconnected(conn.playerId);
                // só remove o mapeamento se ainda aponta para esta conexão
                if (connsByPlayer.get(conn.playerId)?.ws === ws) {
                    connsByPlayer.delete(conn.playerId);
                }
                broadcastOnline(); // atualiza a contagem de online para todos
            }
        });
    });
    const ticker = setInterval(() => {
        orch.tick().catch((e) => console.error("tick error", e));
    }, TICK_MS);
    // snapshot de métricas + verificação de saúde da auth a cada 5 min
    const metricsTimer = setInterval(() => {
        repo.saveMetricsSnapshot?.({ online: onlineCount(), ...orch.stats() }).catch(() => { });
        checkAuthHealth();
    }, 5 * 60_000);
    httpServer.listen(port, () => {
        console.log(`[ranked] HTTP+WS ouvindo em :${port} (ws ${WS_PATH})`);
    });
    return {
        httpServer,
        orch,
        async stop() {
            clearInterval(ticker);
            clearInterval(metricsTimer);
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
const isFmt = (f: any): boolean => f === "bo1" || f === "bo3";
const isId = (s: any): boolean => typeof s === "string" && s.length > 0 && s.length <= 128;
const isNum = (n: any): boolean => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 999;
async function route(orch, playerId, msg) {
    switch (msg.type) {
        case "enqueue":
            if (!isFmt(msg.format)) return;
            return orch.onEnqueue(playerId, msg.format);
        case "dequeue":
            if (!isFmt(msg.format)) return;
            return orch.onDequeue(playerId, msg.format);
        case "heartbeat":
            return orch.onHeartbeat(playerId);
        case "room_code":
            if (!isId(msg.matchId) || !isId(msg.roomCode)) return;
            return orch.onRoomCode(playerId, msg.matchId, msg.roomCode);
        case "game_started":
            if (!isId(msg.matchId)) return;
            return orch.onGameStarted(playerId, msg.matchId);
        case "game_score":
            if (!isId(msg.matchId) || !isNum(msg.host) || !isNum(msg.joiner)) return;
            return orch.onGameScore(playerId, msg.matchId, msg.host, msg.joiner);
        case "report":
            if (!isId(msg.matchId)) return;
            return orch.onReport(playerId, msg.matchId, msg.outcome);
        case "confirm_result":
            if (!isId(msg.matchId) || (msg.winner !== "me" && msg.winner !== "opp")) return;
            if (msg.rate != null && msg.rate !== "like" && msg.rate !== "dislike") return;
            return orch.onConfirmResult(playerId, msg.matchId, msg.winner, msg.rate);
        case "deck_report":
            if (!isId(msg.matchId)) return;
            return orch.onDeckReport(playerId, msg);
        case "report_grief":
            if (!isId(msg.matchId)) return;
            return orch.onReportGrief(playerId, msg.matchId);
        case "contest_grief":
            if (!isId(msg.matchId)) return;
            return orch.onContestGrief(playerId, msg.matchId);
        case "auth":
            return; // já autenticado
    }
}

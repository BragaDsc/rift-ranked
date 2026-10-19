import { decodeJwt, identityFromClaims } from "./inpage/identity";
/**
 * Script do mundo MAIN (run_at document_start).
 *
 * Só este mundo enxerga `window.Clerk` e o `WebSocket` que a página usa. Ele:
 *  1) Intercepta o WebSocket para capturar o `plr_id` + `roomCode` (da URL) e as
 *     mensagens de estado da partida (match party do RiftAtlas).
 *  2) Lê a identidade Clerk (id, username) e fornece o token sob demanda.
 *  3) Conversa com o content script (mundo isolado) via window.postMessage.
 *
 * Protocolo da ponte: mensagens { __ranked:true, dir:"fromPage"|"toPage", ... }.
 */
(() => {
  const TAG = "__ranked";
  // Nonce da sessão: todo recado nosso (dir:"fromPage") é carimbado com ele, e só
  // aceitamos pedidos (dir:"toPage") que devolvam o mesmo carimbo. Junto com a
  // checagem de ev.source, barra scripts de terceiros/iframes que tentem forjar
  // mensagens na ponte (placar falso, roubo de token, identidade forjada).
  const NONCE = (() => {
    try { const a = new Uint32Array(4); crypto.getRandomValues(a); return Array.from(a, (x) => x.toString(36)).join(""); }
    catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  })();
  const post = (payload) =>
    window.postMessage({ [TAG]: true, dir: "fromPage", n: NONCE, ...payload }, "*");

  // Captura de investigação (atrás da flag ranked_debug): guarda os últimos frames
  // "cheios" do WS da partida p/ descobrir onde ficam deck/Legend. Off por padrão.
  const DEBUG = (() => { try { return localStorage.getItem("ranked_debug") === "1"; } catch { return false; } })();
  // Mantém só o que ajuda a achar o Legend: o snapshot inicial (estado completo) e
  // qualquer frame que mencione legend/deck/champion/card. Mantém a captura pequena.
  const CAP_KEEP = /"type":"authoritative_snapshot"|legend|deck|champion|"card/i;
  const capBuf: { t: number; m: string }[] = [];
  function capture(data: any) {
    if (!DEBUG || typeof data !== "string" || !CAP_KEEP.test(data)) return;
    capBuf.push({ t: Date.now(), m: data.slice(0, 60000) });
    if (capBuf.length > 40) capBuf.splice(0, capBuf.length - 40);
  }

  // ------------------- Captura do token do Clerk/Convex (carona) -------------------
  // O RiftAtlas renova o token de sessão (iss=clerk, aud=convex) por conta própria,
  // mas mudou VÁRIAS vezes ONDE ele fica (window.Clerk, cookie __session, agora nem
  // isso). Em vez de depender do local, "pegamos carona": procuramos um JWT do Clerk
  // em QUALQUER resposta de rede e em QUALQUER mensagem de WebSocket, validando pelo
  // iss/aud. Assim seguimos sempre a conta logada, resistente às mudanças deles.
  let capJwt: string | null = null, capAt = 0, capSid: string | null = null;
  const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
  function isRiftToken(p: any) {
    return p && typeof p.sub === "string" &&
      ((typeof p.iss === "string" && p.iss.includes("clerk")) || p.aud === "convex" || (Array.isArray(p.aud) && p.aud.includes("convex")));
  }
  function scanForToken(text: any) {
    try {
      if (typeof text !== "string" || text.indexOf("eyJ") < 0) return;
      const found = text.match(JWT_RE); if (!found) return;
      for (const t of found) {
        const p = decodeJwt(t);
        if (isRiftToken(p) && typeof p.exp === "number" && p.exp * 1000 > Date.now() && t !== capJwt) {
          capJwt = t; capAt = Date.now(); if (typeof p.sid === "string") capSid = p.sid;
          if (DEBUG) { try { console.log("[ranked] token capturado — sub:", p.sub, "iss:", p.iss, "aud:", p.aud); } catch { } }
        }
      }
    } catch { /* ignora */ }
  }
  const SKIP_ASSET = /\.(js|css|png|jpe?g|webp|gif|svg|woff2?|ico|mp3|wav|mp4)(\?|$)/i;
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args: any[]) {
      const ret = origFetch.apply(this, args as any);
      try {
        const url = String(typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "");
        const sidM = url.match(/\/sessions\/([^/?]+)\/tokens/); if (sidM) capSid = sidM[1];
        // só varre respostas não-asset e quando ainda não temos um token fresco (barato)
        if (!SKIP_ASSET.test(url) && (!capJwt || Date.now() - capAt > 45_000)) {
          ret.then((r: Response) => { try { const ct = r.headers.get("content-type") || ""; if (/json|text|javascript|plain/i.test(ct)) r.clone().text().then(scanForToken).catch(() => { }); } catch { } }).catch(() => { });
        }
      } catch { /* ignora */ }
      return ret;
    };
  }
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR && OrigXHR.prototype) {
    const open = OrigXHR.prototype.open, send = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function (m: string, u: string, ...rest: any[]) { try { (this as any).__rkUrl = String(u); } catch { } return (open as any).call(this, m, u, ...rest); };
    OrigXHR.prototype.send = function (...a: any[]) {
      try {
        const url = String((this as any).__rkUrl || "");
        if (!SKIP_ASSET.test(url)) this.addEventListener("load", () => { try { scanForToken(this.responseText); } catch { } });
      } catch { /* ignora */ }
      return (send as any).apply(this, a);
    };
  }

  // ---------------------- 1) Intercepta o WebSocket ----------------------
  const OrigWS = window.WebSocket;
  function PatchedWS(url, protocols) {
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    try {
      // captura de token: o JWT de auth (aud=convex) trafega no WS realtime (Convex),
      // tanto na mensagem de Authenticate que o cliente ENVIA quanto em respostas.
      // Varremos entrada e saída de TODO socket — o token aparece em algum deles.
      const origSend = ws.send;
      ws.send = function (data: any) { try { if (typeof data === "string") scanForToken(data); } catch { } return origSend.apply(this, arguments as any); };
      ws.addEventListener("message", (ev) => { try { if (typeof ev.data === "string") scanForToken(ev.data); } catch { } });
      const u = String(url);
      if (u.includes("/parties/match/")) {
        resetAcc(); // sala/partida nova → começa do zero (não herda placar antigo)
        const parsed = new URL(u);
        post({
          kind: "match_ws",
          plrId: parsed.searchParams.get("playerId"),
          roomCode: parsed.searchParams.get("roomCode"),
        });
        ws.addEventListener("message", (ev) => handleFrame(ev.data));
        if (DEBUG) ws.addEventListener("message", (ev) => capture(ev.data));
      }
    } catch {
      /* ignora */
    }
    return ws;
  }
  PatchedWS.prototype = OrigWS.prototype;
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) PatchedWS[k] = OrigWS[k];
  window.WebSocket = PatchedWS as any;

  // Tipos de frame do RiftAtlas que carregam estado (mapeado na captura real).
  const RELEVANT_TYPES = new Set([
    "room_shell_sync",
    "authoritative_snapshot",
    "authoritative_patch_commit",
  ]);
  // Estado acumulado da partida (o protocolo manda deltas, não o estado inteiro).
  const acc: any = { phase: null, scores: {}, winnerPlayerId: null, viewerPlayerId: null, disconnected: [], outcome: null };
  let lastSig = "";
  // Cada partida é uma sala nova = uma WS nova. Zera o estado herdado do jogo
  // anterior (placar/fase/vencedor) — senão um "8" obsoleto que sobrou em memória
  // dispararia uma vitória falsa logo no 1º frame da próxima partida. O snapshot
  // autoritativo que chega na conexão repopula o placar real.
  let decksSent = false; // já reportamos os decks desta partida?
  function resetAcc() {
    acc.phase = null;
    acc.scores = {};
    acc.winnerPlayerId = null;
    acc.viewerPlayerId = null;
    acc.disconnected = [];
    acc.outcome = null;
    lastSig = "";
    decksSent = false;
  }

  // Extrai Legend/champion de cada jogador (públicos — ficam em jogo desde o início)
  // e, do próprio jogador, o deck completo (deck.sections). Posta uma vez por partida.
  function maybeSendDecks(snapshot: any) {
    if (decksSent || !snapshot || !Array.isArray(snapshot.players)) return;
    const players = snapshot.players.map((p: any) => {
      const b = p.board || {};
      const leg = (b.legend || [])[0] || {};
      const champ = (b.champion || [])[0] || {};
      return {
        id: p.id,
        name: p.name || null,
        legendCode: leg.cardCode || null,
        legendName: leg.name || null,
        championCode: champ.cardCode || null,
        championName: champ.name || null,
        // deck completo só existe para o próprio jogador (oponente é oculto)
        deck: p.deck && p.deck.sections ? p.deck.sections : null,
      };
    });
    // só vale quando os Legends já estão em jogo
    if (!players.some((p: any) => p.legendCode)) return;
    decksSent = true;
    post({ kind: "decks", players, viewerPlayerId: acc.viewerPlayerId });
  }

  function handleFrame(data) {
    if (typeof data !== "string") return; // binário não é usado pelo RiftAtlas
    // filtro barato por tipo antes do JSON.parse (frames podem ser grandes)
    if (!/"type":"(room_shell_sync|authoritative_snapshot|authoritative_patch_commit)"/.test(data))
      return;
    let obj;
    try {
      obj = JSON.parse(data);
    } catch {
      return; // frame truncado/binário: ignora
    }
    if (!RELEVANT_TYPES.has(obj.type)) return;
    applyToAcc(obj);
    // só encaminha quando algo relevante mudou
    const sig = acc.phase + "|" + JSON.stringify(acc.scores) + "|" + (acc.winnerPlayerId || "") + "|" + acc.disconnected.join(",") + "|" + (acc.outcome ? acc.outcome.winnerId + ":" + acc.outcome.reason : "");
    if (sig === lastSig) return;
    lastSig = sig;
    post({
      kind: "game_frame",
      state: {
        phase: acc.phase,
        scores: { ...acc.scores },
        winnerPlayerId: acc.winnerPlayerId,
        viewerPlayerId: acc.viewerPlayerId,
        disconnected: [...acc.disconnected],
        outcome: acc.outcome,
      },
    });
  }

  /** Procura um campo de vencedor (nome exato ainda não confirmado) num objeto raso. */
  function scanWinner(o) {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (/^(winner|wonby|victor|matchwinner|winningplayer)/i.test(k)) {
        if (typeof v === "string" && v.startsWith("plr_")) acc.winnerPlayerId = v;
        else if (Array.isArray(v) && typeof v[0] === "string" && v[0].startsWith("plr_"))
          acc.winnerPlayerId = v[0];
      }
    }
  }

  // Fases de setup (começo de um jogo). Sair de in_game para uma delas = novo jogo
  // (no Md3 o RiftAtlas recomeça na mesma sala e zera o placar) -> limpamos o acc.
  const SETUP_PHASES = new Set([
    "lobby", "battlefield_pick", "initiative_roll", "first_player_choice", "sideboarding", "mulligan",
  ]);
  function setPhase(p) {
    if (typeof p !== "string") return;
    if (acc.phase === "in_game" && SETUP_PHASES.has(p)) acc.scores = {}; // novo jogo
    acc.phase = p;
  }

  /** Aplica um frame ao estado acumulado (deltas do RiftAtlas). */
  function applyToAcc(obj) {
    if (obj.type === "room_shell_sync" && obj.sessionDoc) {
      const d = obj.sessionDoc;
      setPhase(d.phase);
      if (d.viewer && d.viewer.playerId) acc.viewerPlayerId = d.viewer.playerId;
      if (d.disconnectedAtByPlayerId) acc.disconnected = Object.keys(d.disconnectedAtByPlayerId);
      // alguém saiu da partida (leftAt) → vencedor é quem ficou (selfPlayer)
      if (!acc.outcome && Array.isArray(d.publicPlayers) && d.selfPlayer) {
        const left = d.publicPlayers.find((p) => p && p.leftAt);
        if (left && !(d.selfPlayer.leftAt)) acc.outcome = { winnerId: d.selfPlayer.id, reason: "abandon" };
      }
      scanWinner(d);
    } else if (obj.type === "authoritative_snapshot" && obj.snapshot) {
      const s = obj.snapshot;
      setPhase(s.phase);
      if (Array.isArray(s.players))
        for (const p of s.players) {
          // placar de conquista fica em board.score (snapshot) — patches atualizam depois
          const sc = typeof p?.score === "number" ? p.score : (typeof p?.board?.score === "number" ? p.board.score : null);
          if (p && p.id && sc !== null) acc.scores[p.id] = sc;
        }
      if (s.disconnectedAtByPlayerId) acc.disconnected = Object.keys(s.disconnectedAtByPlayerId);
      // resultado autoritativo do RiftAtlas: gameOutcome (vitória/concessão) OU alguém saiu
      if (s.gameOutcome && Array.isArray(s.gameOutcome.winnerPlayerIds) && s.gameOutcome.winnerPlayerIds.length) {
        acc.outcome = { winnerId: s.gameOutcome.winnerPlayerIds[0], reason: s.gameOutcome.reason || "unknown" };
      } else if (!acc.outcome && Array.isArray(s.players)) {
        const left = s.players.find((p) => p && p.leftAt);
        const other = left && s.players.find((p) => p && p.id && p.id !== left.id);
        if (left && other) acc.outcome = { winnerId: other.id, reason: "abandon" };
      }
      maybeSendDecks(s); // captura Legend/champion/deck (1x por partida)
      scanWinner(s);
    } else if (obj.type === "authoritative_patch_commit" && obj.patch) {
      for (const op of obj.patch.operations || []) {
        if (op.op === "set_room_fields" && op.fields) {
          setPhase(op.fields.phase);
          scanWinner(op.fields);
        } else if (
          op.op === "set_board_fields" &&
          op.playerId &&
          op.fields &&
          typeof op.fields.score === "number"
        ) {
          acc.scores[op.playerId] = op.fields.score;
        }
      }
    }
  }

  // ---------------------- 2) Identidade (Clerk) ----------------------
  // O RiftAtlas migrou o Clerk e NÃO expõe mais window.Clerk. A sessão agora fica
  // no cookie __session — um JWT do Clerk com sub = user id e name/nickname. Lemos
  // dele (identidade + token), com window.Clerk como fallback caso volte a existir.
  // O Clerk usa __session (puro) E/OU __session_<hash> (sufixado) — e passou a renovar
  // SÓ o sufixado (o puro pode estar vencido ou ausente). Pegamos qualquer __session* e
  // escolhemos o de exp mais recente, para sempre achar a sessão atual do usuário.
  function sessionToken() {
    try {
      const found = [];
      for (const part of document.cookie.split(";")) {
        const eq = part.indexOf("="); if (eq < 0) continue;
        const name = part.slice(0, eq).trim();
        if (name === "__session" || /^__session_[A-Za-z0-9]+$/.test(name)) found.push(decodeURIComponent(part.slice(eq + 1)));
      }
      if (!found.length) return null;
      if (found.length === 1) return found[0];
      let best = found[0], bestExp = -Infinity;
      for (const t of found) { const p = decodeJwt(t); const e = p && typeof p.exp === "number" ? p.exp : -Infinity; if (e > bestExp) { bestExp = e; best = t; } }
      return best;
    } catch { return null; }
  }
  // Estado de login do Clerk: cookie __client_uat (0 = deslogado; timestamp > 0 = logado).
  // É o sinal correto de sessão — o __session continua presente/mintável mesmo após logout.
  function clerkSignedIn() {
    try {
      let uat = -1, seen = false;
      for (const part of document.cookie.split(";")) {
        const eq = part.indexOf("="); if (eq < 0) continue;
        const name = part.slice(0, eq).trim();
        if (name === "__client_uat" || /^__client_uat_[A-Za-z0-9]+$/.test(name)) { seen = true; const v = parseInt(part.slice(eq + 1).trim(), 10); if (!isNaN(v)) uat = Math.max(uat, v); }
      }
      return seen ? uat > 0 : true; // sem o cookie uat (instância sem ele) → não bloqueia
    } catch { return true; }
  }
  // decodeJwt / identityFromClaims: lógica pura em ./inpage/identity (testada).
  // Gera um token FRESCO pela Frontend API do Clerk (como o antigo getToken()).
  // O cookie __session expira em ~60s e o RiftAtlas não o renova sozinho; mas o
  // cookie de cliente (long-lived) autentica este POST, que devolve um JWT novo.
  const notExpired = (t: string | null) => { const q = decodeJwt(t || ""); return q && typeof q.exp === "number" && q.exp * 1000 > Date.now() + 5000; };
  async function mintToken(): Promise<string | null> {
    // 1) token capturado recente do próprio RiftAtlas — segue a conta ativa, sem cookie
    if (capJwt && Date.now() - capAt < 50_000 && notExpired(capJwt)) return capJwt;
    // 2) minta um JWT fresco pela FAPI, usando o sid capturado (ou o do cookie, se houver)
    const raw = sessionToken();
    const p = decodeJwt(raw || "");
    const sid = capSid || (p && p.sid);
    const base = (p && typeof p.iss === "string" && p.iss) || "https://clerk.riftatlas.com";
    if (sid) {
      for (let i = 0; i < 2; i++) {
        try {
          const r = await fetch(
            base + "/v1/client/sessions/" + encodeURIComponent(sid) + "/tokens?_clerk_js_version=5.22.0",
            { method: "POST", credentials: "include", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "" },
          );
          if (r.ok) { const d = await r.json(); if (d && d.jwt) { capJwt = d.jwt; capAt = Date.now(); return d.jwt; } }
        } catch { /* tenta de novo / cai pro fallback */ }
      }
    }
    // 3) fallback: window.Clerk (se voltar a existir)
    try { const t = await window.Clerk?.session?.getToken?.(); if (t) return t; } catch { /* sem window.Clerk */ }
    // 4) cookie cru, só se não expirou; senão o capturado não-expirado; senão null
    if (raw && notExpired(raw)) return raw;
    if (capJwt && notExpired(capJwt)) return capJwt;
    return null;
  }
  function readIdentity() {
    // 1) token capturado e RECENTE (≤2min) → reflete a conta realmente logada agora.
    //    Se o RiftAtlas parar de renovar (logout), ele "envelhece" e caímos pro passo 3.
    if (capJwt && Date.now() - capAt < 120_000) { const id = identityFromClaims(decodeJwt(capJwt)); if (id) return id; }
    // 2) window.Clerk (compat com a versão antiga do RiftAtlas)
    const c = window.Clerk;
    if (c && c.loaded && c.user) return { id: c.user.id, username: c.user.username || c.user.firstName || "Jogador" };
    // 3) cookie __session (fallback) — gated por __client_uat p/ perceber logout
    if (!clerkSignedIn()) return null;
    return identityFromClaims(decodeJwt(sessionToken() || ""));
  }

  // Poll contínuo: re-anuncia quando a identidade MUDA (login, troca de conta ou logout).
  // Antes anunciava uma vez e parava — por isso o logout não era percebido (ficava logado).
  let lastIdentitySig = "\u0000";
  setInterval(() => {
    const user = readIdentity();
    const sig = user ? user.id + "|" + user.username : "null";
    if (sig !== lastIdentitySig) { lastIdentitySig = sig; post({ kind: "identity", user: user || null }); }
  }, 1000);

  // ---------------------- 3) Pedidos vindos do content ----------------------
  window.addEventListener("message", async (ev) => {
    if (ev.source && ev.source !== window) return; // ignora iframes/outras janelas
    const d = ev.data;
    if (!d || d[TAG] !== true || d.dir !== "toPage") return;
    if (d.n !== NONCE) return; // carimbo da sessão ausente/errado → descarta
    if (d.kind === "getToken") {
      const token = await mintToken(); // token fresco via Clerk FAPI (cookie expira em ~60s)
      post({ kind: "token", reqId: d.reqId, token: token || null });
    } else if (d.kind === "getCapture") {
      post({ kind: "capture", reqId: d.reqId, frames: capBuf });
    }
  });
})();

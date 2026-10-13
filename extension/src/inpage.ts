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

  // ---------------------- 1) Intercepta o WebSocket ----------------------
  const OrigWS = window.WebSocket;
  function PatchedWS(url, protocols) {
    const ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
    try {
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
  const acc: any = { phase: null, scores: {}, winnerPlayerId: null, viewerPlayerId: null, disconnected: [] };
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
    const sig = acc.phase + "|" + JSON.stringify(acc.scores) + "|" + (acc.winnerPlayerId || "") + "|" + acc.disconnected.join(",");
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

  // ---------------------- 2) Identidade Clerk ----------------------
  function readClerk() {
    const c = window.Clerk;
    if (!c || !c.loaded) return null;
    if (!c.user) return { loaded: true, user: null };
    return {
      loaded: true,
      user: {
        id: c.user.id,
        username: c.user.username || c.user.firstName || "Jogador",
      },
    };
  }

  let announced = false;
  const identityPoll = setInterval(() => {
    const info = readClerk();
    if (info && info.user && !announced) {
      announced = true;
      post({ kind: "identity", user: info.user });
      clearInterval(identityPoll);
    }
  }, 500);

  // ---------------------- 3) Pedidos vindos do content ----------------------
  window.addEventListener("message", async (ev) => {
    if (ev.source && ev.source !== window) return; // ignora iframes/outras janelas
    const d = ev.data;
    if (!d || d[TAG] !== true || d.dir !== "toPage") return;
    if (d.n !== NONCE) return; // carimbo da sessão ausente/errado → descarta
    if (d.kind === "getToken") {
      try {
        const token = await window.Clerk?.session?.getToken();
        post({ kind: "token", reqId: d.reqId, token: token || null });
      } catch {
        post({ kind: "token", reqId: d.reqId, token: null });
      }
    } else if (d.kind === "getCapture") {
      post({ kind: "capture", reqId: d.reqId, frames: capBuf });
    }
  });
})();

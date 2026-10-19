import { S } from "./selectors";
import * as D from "./detect";
import * as R from "./ranks";
/**
 * Content script (mundo ISOLADO). O "piloto":
 *  - recebe identidade/estado do inpage (ponte postMessage);
 *  - conecta no NOSSO backend ranked (WebSocket) e segue o protocolo;
 *  - dirige a UI do RiftAtlas (Host Room / Room Setup / Join) com os seletores;
 *  - mostra um overlay (PT / EN / 中文) com o RANK COMPLETO por formato
 *    (tier + divisão + LP + posição + V/D + winrate) e as filas.
 *
 * Depende de self.RankedSelectors (selectors.js, mesmo mundo isolado).
 */
"use strict";
  const TAG = "__ranked";
  const LADDER_URL = "https://app.megacards.com.br/ranked";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DEBUG = (() => { try { return localStorage.getItem("ranked_debug") === "1"; } catch { return false; } })();

  // ----------------------------- config -----------------------------
  const PROD_WS = "wss://app.megacards.com.br/ranked/ws";
  function backendWs() {
    try { return localStorage.getItem("ranked_backend_ws") || PROD_WS; } catch { return PROD_WS; }
  }
  function httpBase() {
    return backendWs().replace(/^ws/, "http").replace(/\/ws$/, "");
  }

  function extVersion() {
    try { const api = globalThis.browser || globalThis.chrome; return api?.runtime?.getManifest?.().version || "?"; } catch { return "?"; }
  }

  // ----------------------------- som -----------------------------
  // Sons curtos (Web Audio, sem arquivo). O contexto é "destravado" num gesto do
  // usuário (clique em Jogar) pra respeitar o autoplay dos navegadores.
  let audioCtx = null;
  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {}
  }
  // Preferências de som (por jogador), persistidas.
  function loadSounds() {
    try { const s = JSON.parse(localStorage.getItem("ranked_sounds") || "null"); if (s) return { match: s.match !== false, win: s.win !== false, loss: s.loss !== false }; } catch {}
    return { match: true, win: true, loss: true };
  }
  const soundPrefs = loadSounds();
  function soundOn(k) { return soundPrefs[k] !== false; }
  function setSound(k, v) { soundPrefs[k] = v; try { localStorage.setItem("ranked_sounds", JSON.stringify(soundPrefs)); } catch {} }

  function playTones(notes, opts: any = {}) {
    try {
      ensureAudio();
      if (!audioCtx) return;
      const type = opts.type || "triangle", peak = opts.gain || 0.28;
      const now = audioCtx.currentTime;
      for (const [freq, t, dur] of notes) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = type; o.frequency.value = freq;
        o.connect(g); g.connect(audioCtx.destination);
        const s = now + t, d = dur || 0.2;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(peak, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + d);
        o.start(s); o.stop(s + d + 0.02);
      }
    } catch {}
  }
  // fila: arpejo ascendente · vitória: fanfarra maior · derrota: desce (grave)
  function playMatchSound() { if (soundOn("match")) playTones([[660, 0, .2], [880, .11, .2], [1320, .22, .22]]); }
  function playWinSound() { if (soundOn("win")) playTones([[523, 0, .16], [659, .12, .16], [784, .24, .16], [1047, .36, .45]], { type: "triangle", gain: .3 }); }
  function playLossSound() { if (soundOn("loss")) playTones([[440, 0, .22], [349, .2, .22], [262, .4, .55]], { type: "sine", gain: .32 }); }
  function playSample(k) { ensureAudio(); if (k === "match") playMatchSound(); else if (k === "win") playWinSound(); else if (k === "loss") playLossSound(); }

  // ----------------------------- i18n -----------------------------
  const STRINGS = {
    pt: {
      brandTop: "RIFT", brandBottom: "Ranked",
      md1: "Md1", md3: "Md3", playMd1: "Jogar Md1", playMd3: "Jogar Md3",
      leave: "Sair da fila", ladder: "Ver ladder completo →", minimize: "Minimizar",
      placement: "Colocação", tierDash: "—", w: "V", l: "D", noMatches: "sem partidas",
      claimWin: "Reivindicar vitória", contest: "Contestar",
      griefAccused: "Oponente reivindicou inatividade — jogue ou conteste.",
      banned: (d) => "Fila bloqueada por conduta até " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + ".",
      update: (v) => "Atualização v" + v + " disponível", download: "Baixar",
      connecting: "Conectando…", stillConnecting: "Ainda conectando…",
      online: (n) => n + (n === 1 ? " jogador online" : " jogadores online"),
      inQueue: (n) => n + (n === 1 ? " na fila" : " na fila"),
      notInLobby: "Vá para a tela inicial (onde aparece “Host Room”) para entrar na fila.",
      ready: "Pronto.", inGame: "Partida em andamento…", series: (a, b) => "Série " + a + "–" + b, noToken: "Faça login no RiftAtlas e recarregue (F5).",
      notLogged: "Não conectado. Faça login no RiftAtlas e recarregue (F5).",
      sounds: "Sons", sndMatch: "Encontrar partida", sndWin: "Vitória", sndLoss: "Derrota",
      reportProblem: "Relatar problema", reportPlaceholder: "Descreva o que aconteceu…", reportSend: "Enviar relato", reportThanks: "Obrigado! Relato enviado.", reportFail: "Falha ao enviar. Tente de novo.",
      matchOver: "Fim da partida", whoWon: "Quem venceu?", youWonOpt: "Você", confirmBtn: "Confirmar",
      rateOpp: "Avalie o oponente", like: "Curtir", dislike: "Não curtir",
      waitingOpp: "Aguardando o oponente confirmar…",
      disagreeNote: "Vocês discordaram sobre o vencedor. Confirmem novamente.",
      selectorWarn: "A interface do RiftAtlas pode ter mudado — talvez seja preciso atualizar a extensão.",
      concede: "Desistir", concedeConfirm: "Desistir mesmo?", yes: "Sim", no: "Não",
      oppLeft: "Oponente saiu/desconectou da partida",
      oppWait: (name, n) => (name || "Oponente") + " caiu — " + n + "s para voltar…",
      authFail: (m) => "Falha na autenticação: " + m,
      queued: (f) => `Na fila (${f})…`, dequeued: "Fora da fila.",
      foundHost: (n, r) => `Partida encontrada vs ${n} (${r}) — você hospeda`,
      foundGuest: (n, r) => `Partida encontrada vs ${n} (${r}) — aguarde o código`,
      creating: "Criando a sala…",
      roomCreated: (c) => `Sala ${c} criada. Aguardando oponente…`,
      errCreate: (m) => "Erro ao criar a sala: " + m,
      joining: (c) => `Entrando na sala ${c}…`,
      joined: "Entrou na sala. Carregue seu deck e inicie.",
      errJoin: (m) => "Erro ao entrar na sala: " + m,
      resolved: (v, d, r) => `${v}${d} — ${r}`,
      win: "Vitória", loss: "Derrota", voided: "Anulada",
      disputed: "Resultado em revisão (disputa).",
      cancelled: (m) => "Partida cancelada: " + m,
      error: (m) => "Erro: " + m,
      reasons: { score: "pontuação", concession: "desistência", walkover: "W.O.", double_no_show: "anulada", disputed: "disputa" },
    },
    en: {
      brandTop: "RIFT", brandBottom: "Ranked",
      md1: "Bo1", md3: "Bo3", playMd1: "Play Bo1", playMd3: "Play Bo3",
      leave: "Leave queue", ladder: "View full ladder →", minimize: "Minimize",
      placement: "Placement", tierDash: "—", w: "W", l: "L", noMatches: "no games",
      claimWin: "Claim win", contest: "Contest",
      griefAccused: "Opponent claimed you're inactive — play or contest.",
      banned: (d) => "Queue blocked for conduct until " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) + ".",
      update: (v) => "Update v" + v + " available", download: "Download",
      connecting: "Connecting…", stillConnecting: "Still connecting…",
      online: (n) => n + (n === 1 ? " player online" : " players online"),
      inQueue: (n) => n + " in queue",
      notInLobby: "Go to the home screen (where “Host Room” is) to join the queue.",
      ready: "Ready.", inGame: "Match in progress…", series: (a, b) => "Series " + a + "–" + b, noToken: "Log in to RiftAtlas and reload (F5).",
      notLogged: "Not connected. Log in to RiftAtlas and reload (F5).",
      sounds: "Sounds", sndMatch: "Match found", sndWin: "Victory", sndLoss: "Defeat",
      reportProblem: "Report a problem", reportPlaceholder: "Describe what happened…", reportSend: "Send report", reportThanks: "Thanks! Report sent.", reportFail: "Failed to send. Try again.",
      matchOver: "Match over", whoWon: "Who won?", youWonOpt: "You", confirmBtn: "Confirm",
      rateOpp: "Rate your opponent", like: "Like", dislike: "Dislike",
      waitingOpp: "Waiting for your opponent to confirm…",
      disagreeNote: "You disagreed on the winner. Please confirm again.",
      selectorWarn: "RiftAtlas's UI may have changed — the extension might need an update.",
      concede: "Concede", concedeConfirm: "Really concede?", yes: "Yes", no: "No",
      oppLeft: "Opponent left/disconnected",
      oppWait: (name, n) => (name || "Opponent") + " dropped — " + n + "s to return…",
      authFail: (m) => "Authentication failed: " + m,
      queued: (f) => `In queue (${f})…`, dequeued: "Left the queue.",
      foundHost: (n, r) => `Match found vs ${n} (${r}) — you host`,
      foundGuest: (n, r) => `Match found vs ${n} (${r}) — wait for the code`,
      creating: "Creating the room…",
      roomCreated: (c) => `Room ${c} created. Waiting for opponent…`,
      errCreate: (m) => "Error creating room: " + m,
      joining: (c) => `Joining room ${c}…`,
      joined: "Joined. Load your deck and start.",
      errJoin: (m) => "Error joining room: " + m,
      resolved: (v, d, r) => `${v}${d} — ${r}`,
      win: "Victory", loss: "Defeat", voided: "Voided",
      disputed: "Result under review (dispute).",
      cancelled: (m) => "Match cancelled: " + m,
      error: (m) => "Error: " + m,
      reasons: { score: "score", concession: "concession", walkover: "walkover", double_no_show: "void", disputed: "dispute" },
    },
    zh: {
      brandTop: "RIFT", brandBottom: "排位",
      md1: "单局", md3: "三局", playMd1: "单局 BO1", playMd3: "三局 BO3",
      leave: "退出队列", ladder: "查看完整天梯 →", minimize: "最小化",
      placement: "定级赛", tierDash: "—", w: "胜", l: "负", noMatches: "暂无对局",
      claimWin: "宣告胜利", contest: "申诉",
      griefAccused: "对手宣告你挂机 — 继续游戏或申诉。",
      banned: (d) => "因行为被禁赛至 " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) + "。",
      update: (v) => "有新版本 v" + v, download: "下载",
      connecting: "连接中…", stillConnecting: "仍在连接…",
      online: (n) => n + " 人在线",
      inQueue: (n) => n + " 人在排队",
      notInLobby: "请回到主界面（显示“Host Room”的页面）再加入队列。",
      ready: "就绪。", inGame: "对局进行中…", series: (a, b) => "系列赛 " + a + "–" + b, noToken: "请登录 RiftAtlas 并刷新（F5）。",
      notLogged: "未连接。请登录 RiftAtlas 并刷新（F5）。",
      sounds: "音效", sndMatch: "匹配成功", sndWin: "胜利", sndLoss: "失败",
      reportProblem: "报告问题", reportPlaceholder: "描述发生了什么…", reportSend: "发送报告", reportThanks: "谢谢！报告已发送。", reportFail: "发送失败，请重试。",
      matchOver: "对局结束", whoWon: "谁赢了？", youWonOpt: "你", confirmBtn: "确认",
      rateOpp: "评价对手", like: "点赞", dislike: "点踩",
      waitingOpp: "等待对手确认…",
      disagreeNote: "你们对胜者有分歧，请再次确认。",
      selectorWarn: "RiftAtlas 界面可能已变化 — 扩展可能需要更新。",
      concede: "认输", concedeConfirm: "确定认输？", yes: "是", no: "否",
      oppLeft: "对手已离开/掉线",
      oppWait: (name, n) => (name || "对手") + "掉线——" + n + "秒内可重连…",
      authFail: (m) => "认证失败：" + m,
      queued: (f) => `匹配中（${f}）…`, dequeued: "已离开队列。",
      foundHost: (n, r) => `匹配成功 vs ${n}（${r}）— 由你创建房间`,
      foundGuest: (n, r) => `匹配成功 vs ${n}（${r}）— 等待房间码`,
      creating: "正在创建房间…",
      roomCreated: (c) => `房间 ${c} 已创建，等待对手…`,
      errCreate: (m) => "创建房间出错：" + m,
      joining: (c) => `正在加入房间 ${c}…`,
      joined: "已加入房间，请载入卡组并开始。",
      errJoin: (m) => "加入房间出错：" + m,
      resolved: (v, d, r) => `${v}${d} — ${r}`,
      win: "胜利", loss: "失败", voided: "无效",
      disputed: "结果争议中（人工复核）。",
      cancelled: (m) => "对局已取消：" + m,
      error: (m) => "错误：" + m,
      reasons: { score: "比分", concession: "认输", walkover: "对手离场", double_no_show: "双方未出席", disputed: "争议" },
    },
  };
  function detectLang() {
    try { const s = localStorage.getItem("ranked_lang"); if (s && STRINGS[s]) return s; } catch {}
    const n = (navigator.language || "en").toLowerCase();
    if (n.startsWith("pt")) return "pt";
    if (n.startsWith("zh")) return "zh";
    return "en";
  }
  let lang = detectLang();
  const T = () => STRINGS[lang];
  function setLang(l) { lang = l; try { localStorage.setItem("ranked_lang", l); } catch {} rebuildUI(); }
  function reasonText(r) { return T().reasons[r] || r; }

  // ----------------------------- tiers -----------------------------
  // Lógica de rank extraída para ./ranks (pura e testada). fullRank recebe o idioma.
  const fullRank = (rating) => R.fullRank(rating, lang);
  const emblem = R.emblem;
  function fmtShort(f) { return f === "bo3" ? T().md3 : T().md1; }

  // ----------------------------- estado -----------------------------
  const state = {
    identity: null, plrId: null, ourPlayerId: null,
    ratings: {}, profile: null, ws: null, authed: false, match: null, griefWarning: null, update: null,
    queued: null,       // formato em fila (ou null) — controla o botão "Sair da fila"
    lastResult: null,   // { format, delta, youWon } — chip de +/- MMR estilo LoL
    confirm: null,      // { winner:"me"|"opp", rate:null|"like"|"dislike", waiting, round, note } — janela de confirmação
    selectorWarn: false, // UI do RiftAtlas mudou (âncora essencial sumiu) — mostra aviso
    oppGone: false,     // oponente desconectou/saiu da partida (sinal do RiftAtlas)
    oppGoneAt: 0,       // quando o oponente caiu (ms) — base do cronômetro de reconexão
    online: null,       // jogadores online agora (do backend) — null = desconhecido
    queueCounts: null,  // { bo1, bo3 } — quantos estão na fila de cada formato (do backend)
    concedeArm: false,  // botão desistir "armado" (aguardando confirmação)
    queuedAt: 0,        // quando entrou na fila (ms) — base do cronômetro de fila
    statusKind: null,   // estado do status p/ cor/ícone (override; senão é inferido)
    statusKey: () => T().connecting,
  };
  // janela de reconexão do oponente (1 min); espelha reconnectGraceMs do backend.
  const OPP_GRACE_MS = 60000;
  let oppGoneTimer = null;
  function startOppGoneTimer() { stopOppGoneTimer(); oppGoneTimer = setInterval(updateUI, 1000); }
  function stopOppGoneTimer() { if (oppGoneTimer) { clearInterval(oppGoneTimer); oppGoneTimer = null; } }
  // cronômetro de fila (atualiza o "na fila: M:SS" a cada segundo)
  let queueTimer = null;
  function startQueueTimer() { stopQueueTimer(); queueTimer = setInterval(updateUI, 1000); }
  function stopQueueTimer() { if (queueTimer) { clearInterval(queueTimer); queueTimer = null; } }
  function mmss(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function setStatus(fn, kind?) { state.statusKey = typeof fn === "function" ? fn : () => fn; state.statusKind = kind || null; updateUI(); }
  // cor/ícone do status: usa o override (erros) ou infere do contexto.
  function statusKind() {
    if (state.statusKind) return state.statusKind;
    if (!state.authed) return "connecting";
    if (state.match) return "ingame";
    if (state.queued) return "queued";
    return "ready";
  }

  // -------------------- ponte com o inpage (MAIN) --------------------
  const tokenWaiters = new Map();
  // Nonce da ponte: adotamos o 1º carimbo que o inpage mandar e, daí em diante,
  // só aceitamos mensagens com o mesmo carimbo (e vindas desta janela). Barra
  // scripts de terceiros/iframes tentando forjar placar, identidade ou token.
  let bridgeNonce = null;
  window.addEventListener("message", (ev) => {
    if (ev.source && ev.source !== window) return; // ignora iframes/outras janelas
    const d = ev.data;
    if (!d || d[TAG] !== true || d.dir !== "fromPage") return;
    if (bridgeNonce === null) bridgeNonce = d.n || null; // adota o carimbo da sessão
    else if (d.n !== bridgeNonce) return;                // carimbo divergente → descarta
    switch (d.kind) {
      case "identity": {
        const prev = state.identity && state.identity.id;
        const next = d.user && d.user.id;
        state.identity = d.user || null;
        if (prev && prev !== next) { // trocou de conta ou deslogou → derruba a conexão atual
          state.authed = false; try { if (state.ws) state.ws.close(); } catch {} state.ws = null;
        }
        if (d.user) maybeConnect();
        else { state.authed = false; try { if (state.ws) state.ws.close(); } catch {} state.ws = null; setStatus(() => T().notLogged, "error"); }
        updateUI();
        break;
      }
      case "match_ws": if (d.plrId) state.plrId = d.plrId; break;
      case "game_frame": onGameFrame(d.state); break;
      case "decks": onDecks(d); break;
      case "token": { const w = tokenWaiters.get(d.reqId); if (w) { tokenWaiters.delete(d.reqId); w(d.token); } break; }
      case "capture": { const w = tokenWaiters.get(d.reqId); if (w) { tokenWaiters.delete(d.reqId); w(d.frames); } break; }
    }
  });
  function toPage(p) { window.postMessage({ [TAG]: true, dir: "toPage", n: bridgeNonce, ...p }, "*"); }
  function getToken() {
    return new Promise((resolve) => {
      const reqId = Math.random().toString(36).slice(2);
      tokenWaiters.set(reqId, resolve);
      toPage({ kind: "getToken", reqId });
      setTimeout(() => { if (tokenWaiters.has(reqId)) { tokenWaiters.delete(reqId); resolve(null); } }, 5000);
    });
  }
  // investigação (debug): pega os frames capturados pelo inpage e copia pra área de transferência
  function requestCapture(): Promise<any[]> {
    return new Promise((resolve) => {
      const reqId = Math.random().toString(36).slice(2);
      tokenWaiters.set(reqId, resolve as any);
      toPage({ kind: "getCapture", reqId });
      setTimeout(() => { if (tokenWaiters.has(reqId)) { tokenWaiters.delete(reqId); resolve([]); } }, 5000);
    });
  }
  async function copyCapture(btn?: HTMLElement) {
    const frames = await requestCapture();
    const json = JSON.stringify(frames);
    try { await navigator.clipboard.writeText(json); if (btn) btn.textContent = `copiado ${frames.length} ✓`; }
    catch { if (btn) btn.textContent = "falhou — veja o console"; console.log("[ranked] captura:", json); }
  }

  // -------------------- conexão com o backend --------------------
  // backoff exponencial de reconexão (3s → 30s); zera ao autenticar com sucesso.
  let reconnectDelay = 3000;
  // Reagenda a reconexão. EM PARTIDA ATIVA usa intervalo CURTO e FIXO (2s): o backoff
  // exponencial (3→30s) podia empurrar a próxima tentativa para além da janela de
  // grace do backend e causar W.O. FALSO mesmo com o jogador presente. Fora de
  // partida mantém o backoff (poupa recursos).
  function scheduleReconnect() {
    const inMatch = !!state.match;
    setTimeout(maybeConnect, inMatch ? 2000 : reconnectDelay);
    if (!inMatch) reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }
  async function maybeConnect() {
    if (state.ws || !state.identity) return;
    const token = await getToken();
    // Sem token (ex.: cookie do Clerk renovando): NÃO desiste — segue tentando
    // (rápido se em partida). Antes isso parava a reconexão e podia virar W.O.
    if (!token) { setStatus(() => T().noToken, "error"); scheduleReconnect(); return; }
    const ws = new WebSocket(backendWs());
    state.ws = ws;
    ws.addEventListener("open", () =>
      send({ type: "auth", token, displayName: state.identity.username, riftatlasPlrId: state.plrId || undefined }));
    ws.addEventListener("message", (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } handleServer(m); });
    ws.addEventListener("close", () => { state.ws = null; state.authed = false; state.online = null; state.queueCounts = null; state.queued = null; state.queuedAt = 0; stopQueueTimer(); setStatus(() => T().connecting); updateUI(); scheduleReconnect(); });
    ws.addEventListener("error", () => ws.close());
  }
  function send(o) { if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(o)); }
  setInterval(() => { if (state.authed) send({ type: "heartbeat", matchId: state.match?.matchId }); }, 5000);
  // re-renderiza quando a tela do RiftAtlas muda (lobby ↔ sala/jogo), pra refletir
  // se dá pra entrar na fila (botões apagam/acendem sem precisar de evento do servidor).
  let _lastCanHost = null;
  setInterval(() => {
    const ch = !!(S && S.canHost && S.canHost());
    if (ch !== _lastCanHost) { _lastCanHost = ch; updateUI(); }
  }, 1000);

  async function refreshProfile() {
    if (!state.ourPlayerId) return;
    try {
      const res = await fetch(`${httpBase()}/api/player?id=${encodeURIComponent(state.ourPlayerId)}&format=bo1&_=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.error) { state.profile = { bo1: data.bo1, bo3: data.bo3 }; updateUI(); }
    } catch {}
  }

  // -------------------- checagem de atualização --------------------
  function cmpVer(a, b) {
    const pa = String(a).split("."), pb = String(b).split(".");
    for (let i = 0; i < 3; i++) { const x = +pa[i] || 0, y = +pb[i] || 0; if (x > y) return 1; if (x < y) return -1; }
    return 0;
  }
  async function checkUpdate() {
    try {
      const api = globalThis.browser || globalThis.chrome;
      const current = api?.runtime?.getManifest?.().version || "0.0.0";
      const info = await (await fetch(`${httpBase()}/api/ext-version`)).json();
      if (info && info.version && cmpVer(info.version, current) > 0) {
        state.update = { version: info.version, url: info.url };
        updateUI();
      }
    } catch {}
  }

  // -------------------- mensagens do servidor --------------------
  async function handleServer(msg) {
    switch (msg.type) {
      case "auth_ok":
        state.authed = true; state.ourPlayerId = msg.playerId; reconnectDelay = 3000;
        for (const r of msg.ratings) state.ratings[r.format] = r;
        setStatus(() => T().ready); refreshProfile(); break;
      case "auth_error":
        // token recusado (ex.: expirado). Zera o backoff: a próxima tentativa já
        // minta um token fresco — não adianta esperar 30s acumulados.
        reconnectDelay = 3000;
        setStatus(() => T().authFail(msg.message), "error"); break;
      case "online_count": state.online = typeof msg.count === "number" ? msg.count : null; if (msg.queued && typeof msg.queued === "object") state.queueCounts = msg.queued; updateUI(); break;
      case "queued": { const f = msg.format; state.queued = f; state.queuedAt = Date.now(); startQueueTimer(); setStatus(() => T().queued(fmtShort(f)) + " · " + mmss(Date.now() - state.queuedAt)); break; }
      case "dequeued": state.queued = null; state.queuedAt = 0; stopQueueTimer(); setStatus(() => T().dequeued); break;
      case "match_found":
        state.queued = null; state.queuedAt = 0; stopQueueTimer(); state.lastResult = null; state.oppGone = false; state.oppGoneAt = 0; state.concedeArm = false; stopOppGoneTimer();
        closeConfirm(); // limpa qualquer janela de confirmação pendente de uma partida anterior
        state.match = { matchId: msg.matchId, format: msg.format, side: msg.side, startedSent: false, confirmShown: false, oppName: msg.opponent?.displayName || "Oponente" };
        { const o = msg.opponent; setStatus(() => (msg.side === "host" ? T().foundHost : T().foundGuest)(o.displayName, Math.round(o.rating))); }
        playMatchSound(); // som ao encontrar partida
        break;
      case "confirm_waiting":
        if (state.confirm) { state.confirm.waiting = true; renderConfirm(); }
        else if (state.match) { openConfirm(null); state.confirm.waiting = true; renderConfirm(); } // retomada: já confirmei antes do reload
        break;
      case "confirm_again":
        if (state.confirm) { state.confirm.waiting = false; state.confirm.round = msg.round || 2; state.confirm.note = T().disagreeNote; state.confirm.deadline = Date.now() + CONFIRM_MS; renderConfirm(); startConfirmTimer(); }
        break;
      // retomada após reload: restaura o contexto da partida ativa
      case "match_active": {
        state.queued = null;
        const o = msg.opponent || {};
        state.match = { matchId: msg.matchId, format: msg.format, side: msg.side, startedSent: true, confirmShown: false, oppName: o.displayName || "Oponente" };
        setStatus(() => T().inGame); updateUI();
        break;
      }
      // abre a janela de confirmação a pedido do servidor (reload / cliente não detectou o fim).
      // Se este cliente já sabe quem venceu (detecção ou reconexão), pré-marca o vencedor
      // para o auto-envio funcionar ao zerar o cronômetro — senão o jogador escolhe.
      case "confirm_prompt":
        if (state.match && !state.confirm) openConfirm(state.match.lastWinner || null);
        break;
      case "create_room": await doCreateRoom(msg.matchId, msg.format); break;
      case "join_room": await doJoinRoom(msg.roomCode); break;
      case "match_resolved": {
        const d = msg;
        const before = Math.round(d.ratingBefore), after = Math.round(d.ratingAfter);
        const delta = d.youWon === null ? null : after - before;
        const fmt = state.match?.format || d.format || "bo1";
        state.queued = null;
        state.lastResult = { format: fmt, delta, youWon: d.youWon };
        // atualiza o MMR na hora (não espera o refreshProfile): aplica o ratingAfter
        if (d.youWon !== null) {
          if (state.ratings[fmt]) state.ratings[fmt].rating = after;
          if (state.profile && state.profile[fmt]) state.profile[fmt].rating = after;
        }
        // som de resultado
        if (d.youWon === true) playWinSound();
        else if (d.youWon === false) playLossSound();
        const sMy = seriesMy, sOpp = seriesOpp, sOn = seriesActive;
        setStatus(() => {
          const verb = d.youWon === null ? T().voided : d.youWon ? T().win : T().loss;
          const dtxt = delta === null ? "" : (delta >= 0 ? "+" + delta : "−" + Math.abs(delta));
          const base = dtxt ? `${verb} ${dtxt} · ${reasonText(d.reason)}` : `${verb} · ${reasonText(d.reason)}`;
          return sOn ? T().series(sMy, sOpp) + " · " + base : base; // ex.: "Série 2–1 · Vitória +20 · pontuação"
        });
        seriesActive = false;
        closeConfirm();
        state.match = null; state.griefWarning = null; state.oppGone = false; state.oppGoneAt = 0; stopOppGoneTimer(); refreshProfile(); setTimeout(refreshProfile, 3000); leaveToLobby(); break;
      }
      case "match_disputed": state.queued = null; setStatus(() => T().disputed); closeConfirm(); state.match = null; state.griefWarning = null; state.oppGone = false; state.oppGoneAt = 0; stopOppGoneTimer(); leaveToLobby(); break;
      case "match_cancelled": { const m = msg; state.queued = null; setStatus(() => T().cancelled(m.reason)); closeConfirm(); state.match = null; state.griefWarning = null; state.oppGone = false; state.oppGoneAt = 0; stopOppGoneTimer(); leaveToLobby(); break; }
      case "grief_warning": state.griefWarning = { matchId: msg.matchId }; setStatus(() => T().griefAccused); break;
      case "grief_cleared": state.griefWarning = null; break;
      case "queue_blocked": { const until = new Date(msg.until); setStatus(() => T().banned(until)); break; }
      case "error": { const m = msg; setStatus(() => T().error(m.message), "error"); break; }
    }
    updateUI();
  }

  // -------------------- driver da UI do RiftAtlas --------------------
  function ensureName() {
    const el = S.nameInput();
    if (el && !el.value && state.identity?.username) S.setReactInput(el, state.identity.username);
  }
  function waitFor(pred, timeout = 8000, interval = 150) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => { let v; try { v = pred(); } catch { v = null; } if (v) return resolve(v); if (Date.now() - t0 > timeout) return reject(new Error("timeout")); setTimeout(tick, interval); };
      tick();
    });
  }
  async function doCreateRoom(matchId, format) {
    try {
      ensureName(); setStatus(() => T().creating);
      const host = S.hostRoomBtn(); if (!host) throw new Error("Host Room");
      host.click();
      await waitFor(() => S.roomCode());
      const setup = S.roomSetupBtn();
      if (setup) {
        setup.click();
        const target = format === "bo3" ? "Best of 3" : "Best of 1";
        await waitFor(() => S.btnByText(target), 4000);
        S.setMatchOption("Game Mode", "1v1"); S.setMatchOption("Play Mode", "Constructed");
        S.setMatchOption("Match Format", target); S.setMatchOption("Deck Rules", "Standard");
        S.doneBtn()?.click();
      }
      const code = S.roomCode(); if (!code) throw new Error("room code");
      send({ type: "room_code", matchId, roomCode: code });
      setStatus(() => T().roomCreated(code));
      state.selectorWarn = false; updateUI(); // criou a sala → seletores OK
    } catch (e) {
      setStatus(() => T().errCreate(e.message));
      // falhou por ÂNCORA ausente (não timeout): a UI do RiftAtlas provavelmente mudou
      if (e.message === "Host Room" || e.message === "room code") { state.selectorWarn = true; updateUI(); }
    }
  }
  async function doJoinRoom(code) {
    try {
      ensureName(); setStatus(() => T().joining(code));
      await waitFor(() => S.joinCodeInput(), 6000);
      S.setReactInput(S.joinCodeInput(), code);
      await waitFor(() => S.joinSpectateBtn(), 3000);
      S.joinSpectateBtn().click();
      setStatus(() => T().joined);
      state.selectorWarn = false; updateUI();
    } catch (e) { setStatus(() => T().errJoin(e.message)); }
  }

  /**
   * Ao encerrar o match (Md1 ou Md3), sai da sala/jogo e volta pra tela do Host Room,
   * deixando o jogador pronto pra próxima fila. Idempotente e tolerante a diálogo
   * de confirmação. Não faz nada se já estiver no lobby.
   */
  let leaving = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /**
   * Esconde visualmente o diálogo de confirmação do RiftAtlas enquanto a extensão
   * o aciona — assim a saída acontece "sem mostrar" (nem pop-up nem cliques), mas
   * continua usando o mecanismo real do jogo. Mantém clicável (opacity:0).
   */
  function injectLeaveHider() {
    const s = document.createElement("style");
    s.id = "rk-leave-hider";
    s.textContent = `[role="dialog"],[aria-modal="true"],dialog[open]{opacity:0 !important;pointer-events:auto !important;transition:none !important}`;
    (document.head || document.documentElement).appendChild(s);
    return s;
  }
  async function leaveToLobby() {
    if (leaving) return;
    leaving = true;
    const hider = injectLeaveHider();
    try {
      // pausa curta só pra o resultado registrar (o diálogo de saída fica invisível)
      await sleep(1500);
      // Sequência real: "Leave"/"Leave Room" abre o diálogo; "Leave Game" vai à
      // tela inicial (Host Room). Tenta por ~25s, lidando com os dois passos.
      const t0 = Date.now();
      while (Date.now() - t0 < 25000) {
        if (S.canHost()) return; // chegou na tela do Host Room
        const lg = S.leaveGameBtn();           // diálogo (invisível) aberto → confirma indo pra home
        if (lg) { lg.click(); await sleep(700); continue; }
        const open = S.leaveMenuBtn();          // abre "Leave" (jogo) ou "Leave Room" (sala)
        if (open) { open.click(); await sleep(500); continue; }
        await sleep(500);
      }
    } catch { /* silencioso */ }
    finally { try { hider.remove(); } catch {} leaving = false; }
  }

  // -------------------- estado do jogo (via inpage) --------------------
  // Condição de vitória do RiftAtlas: 8 pontos de conquista (ver detect.js).
  // Md1 = 1 jogo decide; Md3 = melhor de 3, primeiro a 2 vitórias.
  // placar da série (para exibir no overlay e no resultado final)
  let seriesMy = 0, seriesOpp = 0, seriesActive = false;
  function showSeries(m, me) {
    const gw = (m.det && m.det.gameWins) || {};
    seriesMy = gw[me] || 0;
    const oppId = Object.keys(gw).find((id) => id !== me);
    seriesOpp = oppId ? (gw[oppId] || 0) : 0;
    seriesActive = true;
    setStatus(() => T().series(seriesMy, seriesOpp));
  }
  function onGameFrame(gs) {
    if (!state.match) return;
    const m = state.match;
    const me = state.plrId || gs.viewerPlayerId || null;

    // começou? qualquer fase além do lobby significa que a partida está em curso
    if (!m.startedSent && gs.phase && gs.phase !== "lobby") {
      m.startedSent = true;
      send({ type: "game_started", matchId: m.matchId });
      setStatus(() => T().inGame); // feedback visível no overlay
    }

    // queda/saída do oponente (sinal do RiftAtlas: disconnectedAtByPlayerId).
    // O jogador tem OPP_GRACE_MS (1 min) para voltar antes do W.O. — o backend
    // resolve automaticamente ao fim desse prazo (reconnectGraceMs).
    const oppGone = Array.isArray(gs.disconnected) && gs.disconnected.some((id) => id && id !== me);
    if (oppGone !== state.oppGone) {
      state.oppGone = oppGone;
      if (oppGone) { state.oppGoneAt = Date.now(); startOppGoneTimer(); }
      else { state.oppGoneAt = 0; stopOppGoneTimer(); }
      updateUI();
    }

    // placar -> informa o backend (ordenado host/joiner)
    if (gs.scores && me && m.side) {
      const mine = gs.scores[me] ?? 0;
      const oppId = Object.keys(gs.scores).find((id) => id !== me);
      const opp = oppId ? (gs.scores[oppId] ?? 0) : 0;
      const host = m.side === "host" ? mine : opp;
      const joiner = m.side === "host" ? opp : mine;
      if (host !== m.lastHost || joiner !== m.lastJoiner) {
        m.lastHost = host; m.lastJoiner = joiner;
        send({ type: "game_score", matchId: m.matchId, host, joiner });
      }
    }

    // detecção de vencedor/série — lógica pura e testável (ver detect.js):
    // conta 1 vitória por jogo (trava anti-dupla), exige ter visto o jogo em
    // andamento (placar < 8) para não contar um "8" obsoleto, e resolve a série
    // (Md1 = 1 vitória, Md3 = 2). Ao fechar a série, abre a confirmação do vencedor.
    if (gs.scores) {
      if (!m.det) m.det = D.initDetect();
      const res = D.applyScores(m.det, gs.scores);
      if (res.countedGame && m.format === "bo3" && me) showSeries(m, me); // 1–0, 1–1, 2–1…
      const winner = D.seriesWinner(m.det, m.format);
      if (winner && me) m.lastWinner = winner === me ? "me" : "opp"; // lembra p/ um confirm_prompt tardio
      if (!m.confirmShown && winner && me) {
        m.confirmShown = true;
        openConfirm(m.lastWinner);
      }
    }

    // fim autoritativo do RiftAtlas: desistência / saída / abandono (gameOutcome ou leftAt).
    // Encerra a partida com esse vencedor. (reason "score" já é tratado pelo placar acima.)
    if (gs.outcome && gs.outcome.winnerId && gs.outcome.reason !== "score" && me) {
      m.lastWinner = gs.outcome.winnerId === me ? "me" : "opp";
      if (!m.confirmShown) {
        m.confirmShown = true;
        openConfirm(m.lastWinner);
      }
    }

    // log opcional p/ depuração (silencioso por padrão; ligue com
    // localStorage.setItem("ranked_debug","1") no console da aba do RiftAtlas).
    if (DEBUG) { try { console.debug("[ranked] frame", { phase: gs.phase, me, scores: gs.scores, det: m.det, match: m.matchId }); } catch {} }
  }

  // Recebe os decks capturados pelo inpage e reporta ao backend (uma vez por partida).
  // "me" = este jogador (identificado pelo plrId desta partida); "opp" = o outro.
  function onDecks(d) {
    const m = state.match; if (!m || m.decksReported) return;
    const players = d.players || [];
    if (!players.length) return;
    const meId = state.plrId || d.viewerPlayerId || (players.find((p) => p.deck) || {}).id;
    const meP = players.find((p) => p.id === meId) || players.find((p) => p.deck) || players[0];
    const oppP = players.find((p) => p !== meP) || null;
    if (!meP || !meP.legendCode) return; // sem Legend ainda → espera outro snapshot
    m.decksReported = true;
    const pick = (p) => p ? { legendCode: p.legendCode, legendName: p.legendName, championCode: p.championCode, championName: p.championName } : null;
    send({
      type: "deck_report",
      matchId: m.matchId,
      me: { ...pick(meP), deck: meP.deck || null },
      opp: pick(oppP),
    });
  }

  // -------------------- janela de confirmação do vencedor --------------------
  const CONFIRM_MS = 30000; // 30s para responder (igual ao timeout do backend)
  let confirmEl = null, confirmTimer = null;
  function openConfirm(detectedWinner) {
    state.confirm = { winner: detectedWinner, rate: null, waiting: false, round: 1, note: "", deadline: Date.now() + CONFIRM_MS };
    renderConfirm();
    startConfirmTimer();
  }
  function closeConfirm() {
    stopConfirmTimer();
    state.confirm = null;
    if (confirmEl) { try { confirmEl.remove(); } catch {} confirmEl = null; }
  }
  function submitConfirm() {
    const c = state.confirm; if (!c || !state.match || c.waiting || !c.winner) return;
    c.waiting = true;
    send({ type: "confirm_result", matchId: state.match.matchId, winner: c.winner, rate: c.rate });
    renderConfirm();
  }
  // cronômetro: atualiza o número + a barra; ao zerar, envia o vencedor marcado.
  function paintTimer() {
    const c = state.confirm; if (!c || !confirmEl) return 0;
    const remMs = Math.max(0, (c.deadline || 0) - Date.now());
    const secs = Math.ceil(remMs / 1000);
    const pct = Math.max(0, Math.min(100, (remMs / CONFIRM_MS) * 100));
    const urg = secs <= 10;
    const sEl = confirmEl.querySelector("#rk-cf-secs");
    const bEl = confirmEl.querySelector("#rk-cf-bar");
    const rEl = confirmEl.querySelector("#rk-cf-ring");
    if (sEl) { sEl.textContent = secs; sEl.classList.toggle("urg", urg); }
    if (bEl) { bEl.style.width = pct + "%"; bEl.classList.toggle("urg", urg); }
    if (rEl) { const C = 131.95; rEl.style.strokeDashoffset = (C * (1 - pct / 100)).toFixed(1); rEl.classList.toggle("urg", urg); } // anel de progresso
    return remMs;
  }
  function confirmTick() {
    if (!state.confirm || !confirmEl) { stopConfirmTimer(); return; }
    const remMs = paintTimer();
    if (remMs <= 0) { stopConfirmTimer(); if (!state.confirm.waiting) submitConfirm(); }
  }
  function startConfirmTimer() { stopConfirmTimer(); confirmTick(); confirmTimer = setInterval(confirmTick, 250); }
  function stopConfirmTimer() { if (confirmTimer) { clearInterval(confirmTimer); confirmTimer = null; } }
  function initialOf(n) { return (String(n || "?").trim()[0] || "?").toUpperCase(); }
  function avColor(n) { let h = 0; const s = String(n || ""); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return "hsl(" + (h % 360) + " 42% 42%)"; }
  function confirmHTML() {
    const t = T(), c = state.confirm, opp = state.match?.oppName || "Oponente";
    const meInit = initialOf(state.identity?.username || t.youWonOpt);
    const sel = (w) => c.winner === w ? " sel" : "";
    const rsel = (r) => c.rate === r ? " on" : "";
    const note = c.note ? `<div class="rk-cf-note">${c.note}</div>` : "";
    const body = c.waiting
      ? `<div class="rk-cf-wait"><div class="rk-cf-spin"></div><div>${t.waitingOpp}</div></div>`
      : `
        <div class="rk-cf-q">${t.whoWon}</div>
        <div class="rk-cf-opts">
          <button class="rk-cf-opt${sel("me")}" data-w="me"><span class="rk-cf-av rk-me">${meInit}</span><span class="rk-cf-nm">${esc(t.youWonOpt)}</span><span class="rk-cf-chk">✓</span></button>
          <button class="rk-cf-opt${sel("opp")}" data-w="opp"><span class="rk-cf-av" style="background:${avColor(opp)}">${esc(initialOf(opp))}</span><span class="rk-cf-nm">${esc(opp)}</span><span class="rk-cf-chk">✓</span></button>
        </div>
        <div class="rk-cf-rate-l">${t.rateOpp}</div>
        <div class="rk-cf-rate">
          <button class="rk-cf-rt${rsel("like")}" data-r="like" title="${t.like}">👍 ${t.like}</button>
          <button class="rk-cf-rt dis${rsel("dislike")}" data-r="dislike" title="${t.dislike}">👎 ${t.dislike}</button>
        </div>
        <button class="rk-cf-go${c.winner ? " ready" : ""}" id="rk-cf-go"${c.winner ? "" : " disabled"}>${t.confirmBtn}</button>`;
    return `
      <style>
        #rk-confirm{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;
          background:rgba(6,9,16,.74);backdrop-filter:blur(4px);
          font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#dbe2ee}
        #rk-confirm .rk-cf-card{width:344px;max-width:92vw;background:linear-gradient(180deg,#0e1a2e,#080d18);
          border:1px solid rgba(200,170,110,.28);border-radius:16px;padding:20px 20px 18px;position:relative;
          box-shadow:0 34px 80px -24px rgba(0,0,0,.92),inset 0 1px 0 rgba(255,255,255,.04);animation:rkcf-in .22s ease both}
        @keyframes rkcf-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
        #rk-confirm .rk-cf-card::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;border-radius:16px 16px 0 0;
          background:linear-gradient(90deg,transparent,rgba(232,207,148,.85),transparent)}
        #rk-confirm .rk-cf-t{font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#c8aa6e;font-weight:800;text-align:center}
        #rk-confirm .rk-cf-q{font-size:16px;font-weight:700;color:#eef1f6;text-align:center;margin:4px 0 14px}
        #rk-confirm .rk-cf-ringwrap{position:relative;width:66px;height:66px;margin:14px auto 8px}
        #rk-confirm .rk-cf-svg{width:66px;height:66px;transform:rotate(-90deg)}
        #rk-confirm .rk-cf-trk{fill:none;stroke:rgba(255,255,255,.08);stroke-width:4}
        #rk-confirm .rk-cf-prg{fill:none;stroke:#e4c877;stroke-width:4;stroke-linecap:round;stroke-dasharray:131.95;stroke-dashoffset:0;transition:stroke-dashoffset .25s linear,stroke .2s}
        #rk-confirm .rk-cf-prg.urg{stroke:#e89a96}
        #rk-confirm .rk-cf-secs{position:absolute;inset:0;display:grid;place-items:center;font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;color:#e4c877;transition:color .15s}
        #rk-confirm .rk-cf-secs.urg{color:#e89a96}
        #rk-confirm .rk-cf-note{font-size:12px;color:#e0b06a;background:rgba(200,150,70,.12);border:1px solid rgba(200,150,70,.3);
          border-radius:8px;padding:8px 10px;margin:4px 0 12px;text-align:center}
        #rk-confirm .rk-cf-opts{display:flex;gap:10px;margin-bottom:16px}
        #rk-confirm .rk-cf-opt{position:relative;flex:1;min-width:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;
          border:1px solid rgba(200,170,110,.25);background:linear-gradient(180deg,#14223c,#0e1a2e);color:#eef1f6;border-radius:12px;padding:14px 8px;font-weight:700;font-size:13px;transition:.14s}
        #rk-confirm .rk-cf-opt:hover{border-color:rgba(200,170,110,.55);transform:translateY(-1px)}
        #rk-confirm .rk-cf-opt.sel{background:linear-gradient(180deg,rgba(228,200,119,.22),rgba(200,170,110,.07));border-color:#e4c877;box-shadow:0 10px 26px -12px rgba(200,170,110,.6)}
        #rk-confirm .rk-cf-av{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;font-size:18px;font-weight:800;color:#fff;flex:none;background:#5c7791;text-shadow:0 1px 2px rgba(0,0,0,.4)}
        #rk-confirm .rk-cf-av.rk-me{background:linear-gradient(160deg,#f0d89a,#c8aa6e);color:#140e02;text-shadow:none}
        #rk-confirm .rk-cf-nm{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        #rk-confirm .rk-cf-chk{position:absolute;top:7px;right:8px;width:18px;height:18px;border-radius:50%;background:#e4c877;color:#0b0f16;font-size:11px;font-weight:900;display:none;place-items:center}
        #rk-confirm .rk-cf-opt.sel .rk-cf-chk{display:grid}
        #rk-confirm .rk-cf-rate-l{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#8b7340;font-weight:800;margin:2px 2px 7px}
        #rk-confirm .rk-cf-rate{display:flex;gap:8px;margin-bottom:18px}
        #rk-confirm .rk-cf-rt{flex:1;cursor:pointer;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);
          color:#b4bdca;border-radius:8px;padding:9px 0;font-weight:600;font-size:12.5px;transition:.14s}
        #rk-confirm .rk-cf-rt:hover{background:rgba(255,255,255,.07)}
        #rk-confirm .rk-cf-rt.on{background:rgba(116,181,106,.18);border-color:rgba(116,181,106,.5);color:#9bd897}
        #rk-confirm .rk-cf-rt.dis.on{background:rgba(192,97,93,.18);border-color:rgba(192,97,93,.5);color:#e89a96}
        #rk-confirm .rk-cf-go{width:100%;cursor:pointer;border:1px solid rgba(200,170,110,.5);background:linear-gradient(180deg,#19274a,#111d33);
          color:#eef1f6;border-radius:11px;padding:13px 0;font-weight:800;font-size:14px;letter-spacing:.3px;transition:.14s}
        #rk-confirm .rk-cf-go.ready{background:linear-gradient(180deg,#f0d89a,#c8aa6e);color:#140e02;border-color:#e8cf94}
        #rk-confirm .rk-cf-go.ready:hover{box-shadow:0 10px 24px -10px rgba(200,170,110,.7)}
        #rk-confirm .rk-cf-go[disabled]{opacity:.4;cursor:default;box-shadow:none}
        #rk-confirm .rk-cf-wait{display:flex;flex-direction:column;align-items:center;gap:14px;padding:16px 0 8px;color:#b4bdca;text-align:center}
        #rk-confirm .rk-cf-spin{width:30px;height:30px;border-radius:50%;border:3px solid rgba(200,170,110,.2);border-top-color:#e4c877;animation:rkspin .8s linear infinite}
        @keyframes rkspin{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion: reduce){ #rk-confirm *{animation:none!important;transition:none!important} }
      </style>
      <div class="rk-cf-card">
        <div class="rk-cf-t">${t.matchOver}</div>
        <div class="rk-cf-ringwrap">
          <svg class="rk-cf-svg" viewBox="0 0 48 48"><circle class="rk-cf-trk" cx="24" cy="24" r="21"/><circle class="rk-cf-prg" id="rk-cf-ring" cx="24" cy="24" r="21"/></svg>
          <div class="rk-cf-secs" id="rk-cf-secs">30</div>
        </div>
        ${note}
        ${body}
      </div>`;
  }
  function renderConfirm() {
    if (!state.confirm) return;
    if (!confirmEl) { confirmEl = document.createElement("div"); confirmEl.id = "rk-confirm"; document.body.appendChild(confirmEl); }
    confirmEl.innerHTML = confirmHTML();
    paintTimer(); // sincroniza o cronômetro imediatamente (evita piscar o "30")
    if (state.confirm.waiting) return; // só o aviso de espera, sem controles
    confirmEl.querySelectorAll(".rk-cf-opt").forEach((b) =>
      b.addEventListener("click", () => { state.confirm.winner = b.dataset.w; renderConfirm(); }));
    confirmEl.querySelectorAll(".rk-cf-rt").forEach((b) =>
      b.addEventListener("click", () => { state.confirm.rate = state.confirm.rate === b.dataset.r ? null : b.dataset.r; renderConfirm(); }));
    const go = confirmEl.querySelector("#rk-cf-go");
    if (go) go.addEventListener("click", submitConfirm);
  }

  // ----------------------------- overlay UI -----------------------------
  let ui = null;
  function overlayHTML() {
    const t = T();
    return `
      <style>
        #ranked-overlay{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:320px;
          font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e7ecf4;
          background:linear-gradient(180deg,#0e1a2e,#080d18);border:1px solid rgba(200,170,110,.22);border-radius:16px;
          box-shadow:0 28px 70px -28px rgba(0,0,0,.92),0 2px 8px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.04);overflow:hidden;animation:rk-in .22s ease both}
        @keyframes rk-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
        #ranked-overlay::before{content:"";position:absolute;inset:0 0 auto 0;height:1px;z-index:2;
          background:linear-gradient(90deg,transparent,rgba(232,207,148,.8),transparent);pointer-events:none}
        #ranked-overlay::after{content:"";position:absolute;left:-40%;top:-60%;width:180%;height:150%;pointer-events:none;
          background:radial-gradient(closest-side,rgba(200,170,110,.10),transparent 70%)}
        #ranked-overlay.dragging{opacity:.96}
        #ranked-overlay .hd{position:relative;z-index:1;display:flex;align-items:center;gap:9px;padding:12px;cursor:move;user-select:none;
          background:linear-gradient(180deg,rgba(200,170,110,.08),transparent);border-bottom:1px solid rgba(200,170,110,.12)}
        #ranked-overlay .hd .mk{position:relative;width:32px;height:32px;display:grid;place-items:center;flex:none;border-radius:9px;
          background:linear-gradient(160deg,rgba(232,207,148,.28),rgba(160,123,56,.06));
          border:1px solid rgba(200,170,110,.35);box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 2px 6px rgba(0,0,0,.3)}
        #ranked-overlay .hd .wm{line-height:1}
        #ranked-overlay .hd .wm .a{font-size:9px;letter-spacing:3px;color:#c8aa6e;font-weight:800}
        #ranked-overlay .hd .wm .b{display:flex;align-items:center;gap:5px;font-size:13.5px;letter-spacing:.2px;font-weight:800;margin-top:4px;color:#f3f6fb}
        #ranked-overlay .hd .wm .b .ver{color:#6b778a;font-weight:700;font-size:8.5px;letter-spacing:.3px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);border-radius:5px;padding:1px 4px}
        #ranked-overlay .hd .sp{flex:1;min-width:4px}
        #ranked-overlay .lang{display:flex;gap:1px;background:rgba(0,0,0,.35);border-radius:7px;padding:2px;border:1px solid rgba(255,255,255,.05)}
        #ranked-overlay .lang button{cursor:pointer;background:0;border:0;color:#6a7484;font-size:10px;font-weight:800;padding:3px 5px;border-radius:5px;transition:.14s}
        #ranked-overlay .lang button:hover{color:#aeb8c6}
        #ranked-overlay .lang button.on{color:#120d02;background:linear-gradient(180deg,#eccf88,#c8aa6e);box-shadow:0 1px 3px rgba(0,0,0,.35)}
        #ranked-overlay .hd .cl,#ranked-overlay .hd .cfg{cursor:pointer;color:#b9c3d1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);line-height:1;border-radius:7px;transition:.14s;display:grid;place-items:center;width:22px;height:22px;flex:none;padding:0}
        #ranked-overlay .hd .cl:hover,#ranked-overlay .hd .cfg:hover{color:#f0d89a;background:rgba(200,170,110,.18);border-color:rgba(200,170,110,.45)}
        #ranked-overlay .hd .cl{font-size:18px;font-weight:700;padding-bottom:2px}
        #ranked-overlay .hd .cfg{font-size:13px}
        #ranked-overlay .bd{position:relative;z-index:1;padding:13px 14px 14px}
        #ranked-overlay .cards{display:flex;flex-direction:column;gap:9px;margin-bottom:13px}
        #ranked-overlay .fc{position:relative;display:flex;align-items:center;gap:12px;background:linear-gradient(180deg,#14223c,#0e1a2e);border:1px solid rgba(200,170,110,.12);border-radius:12px;padding:11px 12px;transition:border-color .16s,transform .16s,box-shadow .16s;overflow:hidden}
        #ranked-overlay .fc::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,#e8cf94,#a07b38);opacity:.75}
        #ranked-overlay .fc:hover{border-color:rgba(200,170,110,.32);transform:translateY(-1px);box-shadow:0 10px 24px -14px rgba(200,170,110,.4)}
        #ranked-overlay .fc .in{flex:1;min-width:0}
        #ranked-overlay .fc .l1{display:flex;align-items:center;gap:8px}
        #ranked-overlay .fc .fl{font-size:9px;font-weight:800;letter-spacing:.6px;color:#160f02;background:linear-gradient(180deg,#eccf88,#c8aa6e);border-radius:5px;padding:2px 6px;flex:none}
        #ranked-overlay .fc .tr{font-weight:800;font-size:14px;color:#f3f6fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.2px}
        #ranked-overlay .fc .po{margin-left:auto;color:#8793a5;font-weight:700;font-size:11px;font-variant-numeric:tabular-nums;flex:none;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:2px 7px}
        #ranked-overlay .fc .l2{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11px;color:#8793a5;font-variant-numeric:tabular-nums}
        #ranked-overlay .fc .l2 .mmr{color:#dbe2ee;font-weight:600}
        #ranked-overlay .fc .l2 .mmr b{color:#e8cf94;font-weight:800}
        #ranked-overlay .fc .l2 .dot{color:#37404f}
        #ranked-overlay .fc .l2 .wr.good{color:#78c86f;font-weight:800}
        #ranked-overlay .fc .l2 .wr.bad{color:#d1706c;font-weight:800}
        #ranked-overlay .fc .delta{margin-left:auto;flex:none;font-weight:800;font-size:11px;font-variant-numeric:tabular-nums;padding:2px 8px;border-radius:999px}
        #ranked-overlay .fc .delta.up{color:#9bd897;background:rgba(116,181,106,.15);border:1px solid rgba(116,181,106,.35)}
        #ranked-overlay .fc .delta.down{color:#e89a96;background:rgba(192,97,93,.15);border:1px solid rgba(192,97,93,.35)}
        #ranked-overlay .fc .bar{margin-top:9px;height:5px;border-radius:999px;background:rgba(0,0,0,.4);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.5)}
        #ranked-overlay .fc .bar > i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#a07b38,#e8cf94);box-shadow:0 0 8px rgba(232,207,148,.5)}
        #ranked-overlay .seg{display:flex;gap:9px}
        #ranked-overlay .seg button{position:relative;flex:1;cursor:pointer;border:1px solid rgba(200,170,110,.35);background:linear-gradient(180deg,#19274a,#111d33);color:#f3f6fb;border-radius:10px;padding:11px 0;font-weight:800;font-size:12.5px;letter-spacing:.3px;transition:.15s}
        #ranked-overlay .seg button:hover{color:#140e02;border-color:#e8cf94;background:linear-gradient(180deg,#f0d89a,#c8aa6e);box-shadow:0 10px 22px -10px rgba(200,170,110,.6),inset 0 1px 0 rgba(255,255,255,.3)}
        #ranked-overlay .seg button[disabled]{opacity:.35;cursor:default;box-shadow:none;color:#f3f6fb;background:linear-gradient(180deg,#19274a,#111d33)}
        #ranked-overlay .seg button.off{opacity:.5}
        #ranked-overlay .qn{display:none;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:10.5px;font-weight:800;line-height:1.5;vertical-align:middle;background:rgba(255,255,255,.1);color:#aeb8c6}
        #ranked-overlay .qn.on{display:inline-block}
        #ranked-overlay .qn.has{background:rgba(200,170,110,.2);color:#e2c889}
        #ranked-overlay .seg button:hover .qn{background:rgba(20,14,2,.18);color:#140e02}
        #ranked-overlay .cancel{width:100%;margin-top:9px;cursor:pointer;border:1px solid rgba(192,97,93,.35);background:rgba(60,25,28,.3);color:#e0a3a0;border-radius:9px;padding:8px 0;font-weight:700;font-size:11.5px;display:none;transition:.14s}
        #ranked-overlay .cancel:hover{background:rgba(80,30,34,.45)}
        #ranked-overlay .cancel.show{display:block}
        #ranked-overlay .status{margin-top:13px;display:flex;align-items:center;gap:9px;font-size:12px;color:#c2cbd8;min-height:18px;background:rgba(0,0,0,.28);border-radius:9px;padding:10px 12px;border:1px solid rgba(255,255,255,.05);border-left:3px solid rgba(200,170,110,.55)}
        #ranked-overlay .status .sdot{width:8px;height:8px;border-radius:50%;flex:none;background:#8b94a3}
        #ranked-overlay .status .stx{flex:1;min-width:0}
        #ranked-overlay .status.s-ready{border-left-color:#5fd36a}
        #ranked-overlay .status.s-ready .sdot{background:#5fd36a;box-shadow:0 0 7px rgba(95,211,106,.6)}
        #ranked-overlay .status.s-connecting{border-left-color:#e4c877}
        #ranked-overlay .status.s-connecting .sdot{background:#e4c877;animation:rk-pulse 1.5s infinite}
        #ranked-overlay .status.s-queued{border-left-color:#e4c877}
        #ranked-overlay .status.s-queued .sdot{background:#e4c877;box-shadow:0 0 7px rgba(228,200,119,.5)}
        #ranked-overlay .status.s-ingame{border-left-color:#5a88c4}
        #ranked-overlay .status.s-ingame .sdot{background:#5a88c4;box-shadow:0 0 7px rgba(90,136,196,.6)}
        #ranked-overlay .status.s-error{border-left-color:#d1706c}
        #ranked-overlay .status.s-error .sdot{background:#d1706c;box-shadow:0 0 7px rgba(209,112,108,.6)}
        #ranked-overlay .hd-dot{display:none}
        #ranked-overlay.min .hd-dot{display:block;position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;border:2px solid #0b1424;background:#8b94a3}
        #ranked-overlay.min .hd-dot.s-ready{background:#5fd36a}
        #ranked-overlay.min .hd-dot.s-connecting{background:#e4c877;animation:rk-pulse 1.5s infinite}
        #ranked-overlay.min .hd-dot.s-queued{background:#e4c877}
        #ranked-overlay.min .hd-dot.s-ingame{background:#5a88c4}
        #ranked-overlay.min .hd-dot.s-error{background:#d1706c}
        @media (prefers-reduced-motion: reduce){ #ranked-overlay *,#ranked-overlay *::before,#ranked-overlay *::after{animation:none!important;transition:none!important} }
        #ranked-overlay .online{display:none;align-items:center;gap:8px;margin-top:9px;font-size:11.5px;font-weight:700;color:#9fb0c0}
        #ranked-overlay .rk-dot{width:7px;height:7px;border-radius:50%;background:#51c15a;box-shadow:0 0 0 0 rgba(81,193,90,.6);animation:rk-pulse 2s infinite}
        @keyframes rk-pulse{0%{box-shadow:0 0 0 0 rgba(81,193,90,.5)}70%{box-shadow:0 0 0 5px rgba(81,193,90,0)}100%{box-shadow:0 0 0 0 rgba(81,193,90,0)}}
        #ranked-overlay .act-wrap{margin-top:9px;display:flex;gap:9px}
        #ranked-overlay .act-wrap:empty{display:none}
        #ranked-overlay .act{flex:1;cursor:pointer;border-radius:9px;padding:9px 0;font-weight:800;font-size:12px;border:1px solid;transition:.14s}
        #ranked-overlay .act.claim{border-color:rgba(200,170,110,.5);background:rgba(200,170,110,.13);color:#ecd9ab}
        #ranked-overlay .act.claim:hover{background:rgba(200,170,110,.22)}
        #ranked-overlay .act.contest{border-color:rgba(120,160,200,.5);background:rgba(90,136,196,.15);color:#bcd3ef}
        #ranked-overlay .act.contest:hover{background:rgba(90,136,196,.26)}
        #ranked-overlay .act[disabled]{opacity:.45;cursor:default}
        #ranked-overlay .opp-gone{margin-bottom:8px;font-size:11.5px;font-weight:700;color:#e8b2ae;background:rgba(192,97,93,.14);border:1px solid rgba(192,97,93,.34);border-radius:9px;padding:8px 10px;text-align:center}
        #ranked-overlay .opp-gone.wait{color:#e8cf94;background:rgba(200,170,110,.13);border-color:rgba(200,170,110,.34)}
        #ranked-overlay #rk-concede-wrap:empty{display:none}
        #ranked-overlay .concede-btn{width:100%;margin-top:9px;cursor:pointer;border:1px solid rgba(192,97,93,.3);background:rgba(60,25,28,.22);color:#cc9b99;border-radius:9px;padding:8px 0;font-weight:700;font-size:11px;transition:.14s}
        #ranked-overlay .concede-btn:hover{background:rgba(80,30,34,.4);color:#e0a3a0}
        #ranked-overlay .concede-confirm{margin-top:9px;display:flex;align-items:center;gap:7px;font-size:11.5px;color:#e0a3a0;background:rgba(60,25,28,.3);border:1px solid rgba(192,97,93,.4);border-radius:9px;padding:7px 9px}
        #ranked-overlay .concede-confirm span{flex:1}
        #ranked-overlay .concede-confirm button{cursor:pointer;border:0;border-radius:6px;padding:5px 11px;font-weight:800;font-size:11px}
        #ranked-overlay .concede-confirm .cc-yes{background:#c0615d;color:#fff}
        #ranked-overlay .concede-confirm .cc-no{background:rgba(255,255,255,.12);color:#cdd6e4}
        #ranked-overlay .upd-wrap:empty{display:none}
        #ranked-overlay .upd{margin-bottom:12px;font-size:11.5px;color:#ecd9ab;background:rgba(200,170,110,.12);
          border:1px solid rgba(200,170,110,.32);border-radius:9px;padding:9px 11px;display:flex;align-items:center;gap:7px}
        #ranked-overlay .upd a{color:#e8cf94;font-weight:800;text-decoration:none;margin-left:auto}
        #ranked-overlay .upd a:hover{text-decoration:underline}
        #ranked-overlay .upd.warn{color:#e8b2ae;background:rgba(192,97,93,.12);border-color:rgba(192,97,93,.34)}
        #ranked-overlay .foot{margin-top:13px;text-align:center}
        #ranked-overlay .foot a{color:#8a7647;font-size:11px;text-decoration:none;font-weight:700;letter-spacing:.3px;transition:.14s}
        #ranked-overlay .foot a:hover{color:#e8cf94}
        #ranked-overlay.min .bd{display:none}
        /* minimizado: só o símbolo + o botão (–). Esconde nome, versão e idiomas. */
        #ranked-overlay.min{width:auto}
        #ranked-overlay.min .hd{gap:8px;padding:9px 10px;border-bottom:0}
        #ranked-overlay.min .wm,
        #ranked-overlay.min .lang,
        #ranked-overlay.min .hd .cfg,
        #ranked-overlay.min .hd .sp{display:none}
        #ranked-overlay .settings{margin-top:12px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:8px}
        #ranked-overlay .settings .st-title{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#8b7340;font-weight:800;margin:2px 4px 6px}
        #ranked-overlay .st-row{display:flex;align-items:center;gap:8px;width:100%;cursor:pointer;background:0;border:0;color:#cdd6e4;font-size:12px;padding:7px;border-radius:7px}
        #ranked-overlay .st-row:hover{background:rgba(255,255,255,.04)}
        #ranked-overlay .st-row span{flex:1;text-align:left}
        #ranked-overlay .st-row .sw{width:30px;height:16px;border-radius:999px;background:#2a3344;position:relative;flex:none;transition:.15s}
        #ranked-overlay .st-row .sw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#6b7686;transition:.15s}
        #ranked-overlay .st-row.on .sw{background:linear-gradient(180deg,#e4c877,#c8aa6e)}
        #ranked-overlay .st-row.on .sw::after{left:16px;background:#1a1300}
        #ranked-overlay #rk-report-txt{width:100%;box-sizing:border-box;resize:vertical;min-height:52px;background:#0d1522;border:1px solid #2a3850;border-radius:8px;color:#dfe6f0;font-family:inherit;font-size:12px;padding:8px;outline:none}
        #ranked-overlay #rk-report-txt:focus{border-color:#c8aa6e}
        #ranked-overlay .rk-report-btn{width:100%;margin-top:7px;cursor:pointer;border:0;border-radius:8px;padding:9px 0;font-weight:700;font-size:12px;color:#1a1300;background:linear-gradient(180deg,#e4c877,#c8aa6e)}
        #ranked-overlay .rk-report-btn:disabled{opacity:.5;cursor:default}
        #ranked-overlay .rk-report-msg{font-size:11px;margin-top:6px;text-align:center;min-height:14px}
        #ranked-overlay .rk-report-msg.ok{color:#8fcf86} #ranked-overlay .rk-report-msg.err{color:#e0938f}
      </style>
      <div class="hd">
        <div class="mk"><svg width="19" height="19" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="rkmk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0d89a"/><stop offset="1" stop-color="#b5873a"/></linearGradient></defs><path d="M12 1.6l9 5.2v10.4L12 22.4 3 17.2V6.8L12 1.6z" fill="url(#rkmk)" stroke="#f0d89a" stroke-width="1" stroke-linejoin="round"/></svg><span class="hd-dot" id="rk-hdot"></span></div>
        <div class="wm"><div class="a">${t.brandTop}</div><div class="b">${t.brandBottom} <span class="ver">v${extVersion()}</span></div></div>
        <div class="sp"></div>
        <div class="lang">
          <button data-l="pt" class="${lang === "pt" ? "on" : ""}">PT</button>
          <button data-l="en" class="${lang === "en" ? "on" : ""}">EN</button>
          <button data-l="zh" class="${lang === "zh" ? "on" : ""}">中</button>
        </div>
        <button class="cfg" id="rk-cfg" title="${t.sounds}">⚙</button>
        <button class="cl" id="rk-min" title="${t.minimize}">–</button>
      </div>
      <div class="bd">
        <div class="upd-wrap" id="rk-update"></div>
        <div class="cards">
          <div class="fc" id="fc-bo1"></div>
          <div class="fc" id="fc-bo3"></div>
        </div>
        <div class="seg">
          <button data-f="bo1">${t.playMd1}<span class="qn" id="rk-qn-bo1"></span></button>
          <button data-f="bo3">${t.playMd3}<span class="qn" id="rk-qn-bo3"></span></button>
        </div>
        <button class="cancel" id="rk-cancel">${t.leave}</button>
        <div class="status" id="rk-status">${t.connecting}</div>
        <div class="online" id="rk-online"></div>
        <div class="act-wrap" id="rk-action"></div>
        <div id="rk-concede-wrap"></div>
        <div class="settings" id="rk-settings" style="display:none">
          <div class="st-title">${t.sounds}</div>
          <button class="st-row" data-snd="match"><span>${t.sndMatch}</span><i class="sw"></i></button>
          <button class="st-row" data-snd="win"><span>${t.sndWin}</span><i class="sw"></i></button>
          <button class="st-row" data-snd="loss"><span>${t.sndLoss}</span><i class="sw"></i></button>
          <div class="st-title" style="margin-top:12px">${t.reportProblem}</div>
          <textarea id="rk-report-txt" rows="3" maxlength="2000" placeholder="${t.reportPlaceholder}"></textarea>
          <button id="rk-report-send" class="rk-report-btn">${t.reportSend}</button>
          <div id="rk-report-msg" class="rk-report-msg"></div>
        </div>
        ${DEBUG ? `<button id="rk-cap" style="width:100%;margin-top:8px;cursor:pointer;border:1px solid rgba(120,160,200,.4);background:rgba(90,136,196,.12);color:#bcd3ef;border-radius:7px;padding:8px 0;font-weight:600;font-size:11.5px">⧉ Copiar captura (debug)</button>` : ""}
        <div class="foot"><a href="${LADDER_URL}" target="_blank" rel="noopener">${t.ladder}</a></div>
      </div>
    `;
  }
  // --------- arrastar o overlay para qualquer lugar da página ---------
  const POS_KEY = "ranked_pos";
  let drag = null;
  function clampPos(root) {
    const r = root.getBoundingClientRect();
    const left = Math.min(Math.max(0, r.left), Math.max(0, innerWidth - r.width));
    const top = Math.min(Math.max(0, r.top), Math.max(0, innerHeight - r.height));
    root.style.left = left + "px"; root.style.top = top + "px";
    root.style.right = "auto"; root.style.bottom = "auto";
    return { left, top };
  }
  function applySavedPos(root) {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (p && typeof p.left === "number" && typeof p.top === "number") {
        root.style.left = p.left + "px"; root.style.top = p.top + "px";
        root.style.right = "auto"; root.style.bottom = "auto";
        clampPos(root); // garante que fica visível mesmo em telas menores
      }
    } catch {}
  }
  function attachDragHandle(root, handle) {
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || (e.target.closest && e.target.closest("button"))) return; // ignora cliques nos controles
      const r = root.getBoundingClientRect();
      root.style.left = r.left + "px"; root.style.top = r.top + "px";
      root.style.right = "auto"; root.style.bottom = "auto";
      drag = { root, ox: r.left, oy: r.top, sx: e.clientX, sy: e.clientY };
      root.classList.add("dragging");
      e.preventDefault();
    });
  }
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    drag.root.style.left = (drag.ox + e.clientX - drag.sx) + "px";
    drag.root.style.top = (drag.oy + e.clientY - drag.sy) + "px";
  });
  window.addEventListener("mouseup", () => {
    if (!drag) return;
    const root = drag.root; drag = null;
    root.classList.remove("dragging");
    try { localStorage.setItem(POS_KEY, JSON.stringify(clampPos(root))); } catch {}
  });
  window.addEventListener("resize", () => { if (ui && ui.style.left) clampPos(ui); });

  // envia um relato de problema ao backend, com contexto automático (sem dados sensíveis)
  async function sendReport(txt, btn, msgEl) {
    const message = String(txt || "").trim();
    if (!message) return;
    btn.disabled = true; msgEl.className = "rk-report-msg"; msgEl.textContent = "…";
    const context: any = {
      version: extVersion(), lang,
      name: state.identity?.username || null,
      format: state.match?.format || state.queued || null,
      matchId: state.match?.matchId || null,
      page: (() => { try { return location.hostname; } catch { return null; } })(),
      ua: (() => { try { return navigator.userAgent; } catch { return null; } })(),
    };
    try {
      const r = await fetch(`${httpBase()}/api/report`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, playerId: state.ourPlayerId || null, context }),
      });
      if (!r.ok) throw new Error("http " + r.status);
      msgEl.className = "rk-report-msg ok"; msgEl.textContent = T().reportThanks;
      const ta = document.querySelector("#rk-report-txt") as HTMLTextAreaElement | null; if (ta) ta.value = "";
    } catch {
      msgEl.className = "rk-report-msg err"; msgEl.textContent = T().reportFail;
    } finally { btn.disabled = false; }
  }

  function wireUI(root) {
    { const cap = root.querySelector("#rk-cap"); if (cap) cap.addEventListener("click", () => copyCapture(cap)); }
    {
      const btn = root.querySelector("#rk-report-send");
      if (btn) btn.addEventListener("click", () => {
        const ta = root.querySelector("#rk-report-txt");
        const msgEl = root.querySelector("#rk-report-msg");
        sendReport(ta && ta.value, btn, msgEl);
      });
    }
    root.querySelectorAll(".seg button").forEach((b) =>
      b.addEventListener("click", () => {
        ensureAudio(); // destrava o som (gesto do usuário)
        if (!state.authed) return setStatus(() => T().stillConnecting);
        if (!S.canHost()) return setStatus(() => T().notInLobby);
        send({ type: "enqueue", format: b.dataset.f });
      }));
    root.querySelector("#rk-cancel").addEventListener("click", () => {
      send({ type: "dequeue", format: "bo1" }); send({ type: "dequeue", format: "bo3" });
      state.queued = null; setStatus(() => T().dequeued); // feedback imediato
    });
    root.querySelectorAll(".lang button").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.l)));
    root.querySelector("#rk-min").addEventListener("click", () => { root.classList.toggle("min"); root.querySelector("#rk-min").textContent = root.classList.contains("min") ? "+" : "–"; });
    // delegação dos botões de ação (reivindicar / contestar), que são recriados no updateUI
    root.addEventListener("click", (e) => {
      const el = e.target;
      if (!el || !el.classList) return;
      if (el.classList.contains("contest") && state.griefWarning) send({ type: "contest_grief", matchId: state.griefWarning.matchId });
      // reivindicar vitória (oponente saiu/desconectou) → W.O. após a janela de contestação
      else if (el.classList.contains("claim") && state.match) { send({ type: "report_grief", matchId: state.match.matchId }); el.setAttribute("disabled", "true"); }
      // desistir (com confirmação em 2 passos)
      else if (el.classList.contains("concede-btn")) { state.concedeArm = true; updateUI(); }
      else if (el.classList.contains("cc-no")) { state.concedeArm = false; updateUI(); }
      else if (el.classList.contains("cc-yes") && state.match) {
        state.concedeArm = false;
        send({ type: "report", matchId: state.match.matchId, outcome: "conceded" });
        setStatus(() => T().loss);
      }
    });
    const hd = root.querySelector(".hd");
    if (hd) attachDragHandle(root, hd);
    // configurações de som (engrenagem)
    const cfg = root.querySelector("#rk-cfg");
    const settings = root.querySelector("#rk-settings");
    if (cfg && settings) cfg.addEventListener("click", () => {
      settings.style.display = settings.style.display === "none" ? "block" : "none";
    });
    root.querySelectorAll(".st-row").forEach((r) => {
      r.classList.toggle("on", soundOn(r.dataset.snd));
      r.addEventListener("click", () => {
        const k = r.dataset.snd, nv = !soundOn(k);
        setSound(k, nv); r.classList.toggle("on", nv);
        if (nv) playSample(k); // toca uma amostra ao ligar
      });
    });
  }
  function buildUI() { const root = document.createElement("div"); root.id = "ranked-overlay"; root.innerHTML = overlayHTML(); document.body.appendChild(root); wireUI(root); applySavedPos(root); ui = root; }
  function rebuildUI() { if (!ui) return; const min = ui.classList.contains("min"); ui.innerHTML = overlayHTML(); if (min) ui.classList.add("min"); wireUI(ui); updateUI(); }

  function fmtCard(cardEl, fmtKey, label) {
    const prof = state.profile?.[fmtKey];
    const basic = state.ratings[fmtKey];
    if (!prof && !basic) { cardEl.innerHTML = `${emblem(null, "", false, 36)}<div class="in"><div class="l1"><span class="fl">${label}</span><span class="tr">${T().tierDash}</span></div></div>`; return; }
    const rating = Math.round(prof ? prof.rating : basic.rating);
    const provisional = prof ? prof.provisional : basic.provisional;
    const pos = prof && prof.position ? `#${prof.position}` : "";

    let emb, tierTxt, lpNum = null, apex = false;
    if (provisional) { emb = emblem(null, "", false, 36); tierTxt = T().placement; }
    else {
      const rk = fullRank(rating); apex = rk.apex;
      emb = emblem(rk.color, rk.apex ? "" : rk.division, rk.apex, 36);
      tierTxt = rk.apex ? rk.name : `${rk.name} ${rk.division}`;
      lpNum = Math.round(rk.lp);
    }
    const lpTag = (!provisional && lpNum !== null)
      ? `<span class="po" style="color:#8b94a3;margin-left:0;font-weight:600">${lpNum} LP</span>` : "";

    // chip de ganho/perda (estilo LoL), só pro formato do último resultado
    const lr = state.lastResult;
    let deltaChip = "";
    if (lr && lr.format === fmtKey && typeof lr.delta === "number") {
      const up = lr.delta >= 0;
      deltaChip = `<span class="delta ${up ? "up" : "down"}">${up ? "+" : "−"}${Math.abs(lr.delta)}</span>`;
    }

    // linha 2: MMR SEMPRE visível (fixo) + winrate + V/D
    let l2;
    if (prof && prof.games > 0) {
      const wr = prof.winrate >= 50 ? "good" : "bad";
      l2 = `<span class="mmr"><b>${rating}</b> MMR</span><span class="dot">·</span><span class="wr ${wr}">${Math.round(prof.winrate)}%</span><span class="dot">·</span><span>${prof.wins}${T().w} ${prof.losses}${T().l}</span>`;
    } else {
      l2 = `<span class="mmr"><b>${rating}</b> MMR</span><span class="dot">·</span><span>${T().noMatches}</span>`;
    }

    // barra de LP (0–100) estilo LoL, só pro rank normal (não apex/colocação)
    const bar = (!provisional && !apex && lpNum !== null)
      ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, lpNum))}%"></i></div>` : "";

    cardEl.innerHTML = `${emb}<div class="in">
      <div class="l1"><span class="fl">${label}</span><span class="tr">${tierTxt}</span>${lpTag}<span class="po">${pos}</span></div>
      <div class="l2">${l2}${deltaChip}</div>
      ${bar}</div>`;
  }
  function updateUI() {
    if (!ui) return;
    fmtCard(ui.querySelector("#fc-bo1"), "bo1", T().md1);
    fmtCard(ui.querySelector("#fc-bo3"), "bo3", T().md3);
    // status com ponto + cor por estado (conectando/pronto/na fila/em partida/erro)
    const kind = statusKind();
    const stEl = ui.querySelector("#rk-status");
    stEl.className = "status s-" + kind;
    stEl.innerHTML = `<span class="sdot"></span><span class="stx">${esc(state.statusKey())}</span>`;
    const hdot = ui.querySelector("#rk-hdot"); // ponto no header (visível quando minimizado)
    if (hdot) hdot.className = "hd-dot s-" + kind;
    // contador de jogadores online (do backend); some quando desconhecido/desconectado
    const onEl = ui.querySelector("#rk-online");
    if (onEl) {
      if (state.online != null && state.authed) {
        onEl.innerHTML = `<span class="rk-dot"></span>${T().online(state.online)}`;
        onEl.style.display = "flex";
      } else { onEl.innerHTML = ""; onEl.style.display = "none"; }
    }
    // quantos estão na fila de cada formato (do backend), ao lado de cada botão Jogar
    const qc = state.queueCounts;
    for (const f of ["bo1", "bo3"]) {
      const qnEl = ui.querySelector("#rk-qn-" + f);
      if (!qnEl) continue;
      const n = qc && typeof qc[f] === "number" ? qc[f] : null;
      if (state.authed && n != null) {
        qnEl.textContent = String(n);
        qnEl.setAttribute("title", T().inQueue(n));
        qnEl.classList.add("on");
        qnEl.classList.toggle("has", n > 0);
      } else {
        qnEl.textContent = "";
        qnEl.classList.remove("on", "has");
      }
    }
    const busy = !!state.match;
    const canHost = !!(S && S.canHost && S.canHost());
    ui.querySelectorAll(".seg button").forEach((b) => {
      b.disabled = busy || !state.authed;               // trava dura: em partida / desconectado
      b.classList.toggle("off", !busy && state.authed && !canHost); // só falta estar na tela inicial
      b.title = (!busy && state.authed && !canHost) ? T().notInLobby : "";
    });
    // mostra "Sair da fila" só quando realmente na fila (não pelo texto — "Fora da fila" também tem "fila")
    ui.querySelector("#rk-cancel").classList.toggle("show", !!state.queued && !state.match);
    // botões de ação em partida
    const act = ui.querySelector("#rk-action");
    if (state.griefWarning) act.innerHTML = `<button class="act contest">${T().contest}</button>`;
    else if (state.oppGone && state.match) {
      // 1 min para o oponente voltar: durante a janela mostra o cronômetro;
      // depois libera a reivindicação de vitória (o backend também dá o W.O.).
      const left = Math.ceil((OPP_GRACE_MS - (Date.now() - (state.oppGoneAt || 0))) / 1000);
      act.innerHTML = left > 0
        ? `<div class="opp-gone wait">⏳ ${esc(T().oppWait(state.match.oppName, left))}</div>`
        : `<div class="opp-gone">⚠ ${T().oppLeft}</div><button class="act claim">${T().claimWin}</button>`;
    }
    else act.innerHTML = "";
    // botão "Desistir" (com confirmação) durante a partida
    const cw = ui.querySelector("#rk-concede-wrap");
    if (cw) {
      if (state.match && !state.confirm) {
        cw.innerHTML = state.concedeArm
          ? `<div class="concede-confirm"><span>${T().concedeConfirm}</span><button class="cc-yes">${T().yes}</button><button class="cc-no">${T().no}</button></div>`
          : `<button class="concede-btn">${T().concede}</button>`;
      } else { cw.innerHTML = ""; state.concedeArm = false; }
    }
    // banners: atualização disponível + aviso de seletor (UI do RiftAtlas mudou)
    const upd = ui.querySelector("#rk-update");
    let updHtml = "";
    if (state.update) updHtml += `<div class="upd"><span>${T().update(state.update.version)}</span><a href="${state.update.url}" target="_blank" rel="noopener">${T().download}</a></div>`;
    if (state.selectorWarn) updHtml += `<div class="upd warn"><span>${T().selectorWarn}</span></div>`;
    upd.innerHTML = updHtml;
  }

  // ----------------------------- boot -----------------------------
  function boot() {
    if (!document.body) return setTimeout(boot, 200);
    buildUI(); updateUI(); checkUpdate();
    setInterval(checkUpdate, 15 * 60 * 1000); // reconfere atualização a cada 15 min
    // dica acionável: se não autenticou em ~10s, provavelmente falta login no RiftAtlas
    setTimeout(() => { if (!state.authed && !state.match) setStatus(() => T().notLogged, "error"); }, 10000);
  }
  boot();


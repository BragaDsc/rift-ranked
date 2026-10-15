// Templates HTML dos assets. Cada página é um documento completo do tamanho exato.
// Estética: navy profundo + ouro, brilho/bloom, GRÃO de filme (mata o look "flat/IA"),
// composição diagonal e cristais de elo facetados (pegada de UI de jogo/anime).

const G = {
  gold: "#c8aa6e", goldH: "#edd8a4", goldD: "#6f561f",
  txt: "#eceae2", dim: "#9aa3b2", muted: "#59636f",
  win: "#77ba6b", loss: "#c0615d", live: "#54c75e",
};
// elos (rating -> cor), nomes PT
const TIERS = [
  ["Bronze", "#9d6b3f"], ["Prata", "#9aa7b4"], ["Ouro", "#d2a43c"], ["Jade", "#3f9d9f"],
  ["Esmeralda", "#3f9d63"], ["Safira", "#5a88c4"], ["Ametista", "#8e63c0"], ["Rubi", "#c25049"], ["Diamante", "#caa94f"],
];
const shade = (hex, p) => {
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (p > 0 ? (255 - v) * p : v * p))));
  return "#" + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
};

// grão de filme via feTurbulence (data-uri). opacidade baixa + blend overlay.
const GRAIN = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`
)}`;

// cristal de elo (escudo hexagonal facetado), com brilho
function crystal(color, label, size = 92, glow = true) {
  const id = "g" + Math.random().toString(36).slice(2, 7);
  const top = shade(color, 0.42), bot = shade(color, -0.5), edge = shade(color, 0.3);
  return `<svg width="${size}" height="${size * 1.08}" viewBox="0 0 40 43" style="${glow ? `filter:drop-shadow(0 6px 18px ${color}66) drop-shadow(0 0 26px ${color}44)` : ""}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/><stop offset=".5" stop-color="${color}"/><stop offset="1" stop-color="${bot}"/></linearGradient>
      <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <path d="M20 1.5 L37 9 V24 C37 33 29 37 20 41 C11 37 3 33 3 24 V9 Z" fill="url(#${id})" stroke="${edge}" stroke-width="1.1"/>
    <path d="M20 1.5 L37 9 V15.5 C29 11.5 11 11.5 3 15.5 V9 Z" fill="url(#${id}f)"/>
    <path d="M20 1.5 L20 41 M3 9 L20 18 L37 9 M3 24 L20 18 L37 24" stroke="#000" stroke-opacity=".14" stroke-width=".7" fill="none"/>
    ${label ? `<text x="20" y="28" text-anchor="middle" font-family="Oswald,sans-serif" font-size="13" font-weight="700" fill="#0c0f16" opacity=".82">${label}</text>` : ""}
  </svg>`;
}

// badge "R" (ícone do app): quadrado arredondado, moldura dourada, R serifado, verniz + bloom
function badge(size = 128) {
  const r = Math.round(size * 0.225);
  return `<div style="position:relative;width:${size}px;height:${size}px">
    <div style="position:absolute;inset:-14%;background:radial-gradient(circle,${G.gold}3a,transparent 68%);filter:blur(6px)"></div>
    <div style="position:absolute;inset:0;border-radius:${r}px;padding:${Math.round(size*0.055)}px;
      background:linear-gradient(145deg,${G.goldH},${G.gold} 42%,${G.goldD});box-shadow:0 ${Math.round(size*0.06)}px ${Math.round(size*0.12)}px #000a, inset 0 1px 0 #fff6">
      <div style="position:relative;width:100%;height:100%;border-radius:${Math.round(r*0.72)}px;overflow:hidden;
        background:radial-gradient(120% 90% at 50% 8%,#1b2740,#0b1120 70%);box-shadow:inset 0 2px 10px #000c, inset 0 0 0 1px #0006">
        <div style="position:absolute;inset:0;background:linear-gradient(180deg,#ffffff24,transparent 46%)"></div>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
          <span style="font-family:'Playfair Display',Georgia,serif;font-weight:900;font-size:${Math.round(size*0.62)}px;line-height:1;
            background:linear-gradient(180deg,${G.goldH},${G.gold} 55%,${G.goldD});-webkit-background-clip:text;background-clip:text;color:transparent;
            text-shadow:0 2px 6px #0008;transform:translateY(${Math.round(size*0.02)}px)">R</span>
        </div>
      </div>
    </div>
  </div>`;
}

// <head> comum: fontes + tokens + camadas de fundo reutilizáveis (.stage/.beam/.grain/.vign)
function head(extra = "") {
  return `<head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@900&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;overflow:hidden;background:#06090f;color:${G.txt};
      font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
    .stage{position:relative;width:100%;height:100%;overflow:hidden;
      background:
        radial-gradient(130% 120% at 72% 18%, #1a2440 0%, #0d1424 38%, #080c15 68%, #06090f 100%);}
    /* feixe diagonal de luz dourada (o "rift") */
    .beam{position:absolute;inset:0;pointer-events:none;
      background:
        linear-gradient(118deg, transparent 38%, ${G.gold}22 49%, ${G.goldH}33 51%, ${G.gold}18 53%, transparent 64%);
      mix-blend-mode:screen;opacity:.8;filter:blur(1px)}
    .glows{position:absolute;inset:0;pointer-events:none;
      background:
        radial-gradient(40% 55% at 84% 20%, ${G.gold}26, transparent 70%),
        radial-gradient(45% 50% at 10% 92%, #2a60b033, transparent 72%)}
    .hex{position:absolute;inset:0;pointer-events:none;opacity:.05;
      background-image:linear-gradient(0deg,#9fc0ff 1px,transparent 1px),linear-gradient(90deg,#9fc0ff 1px,transparent 1px);
      background-size:46px 46px;-webkit-mask-image:radial-gradient(120% 100% at 70% 30%,#000 30%,transparent 78%)}
    .grain{position:absolute;inset:0;pointer-events:none;opacity:.07;mix-blend-mode:overlay;
      background-image:url("${GRAIN}");background-size:180px 180px}
    .vign{position:absolute;inset:0;pointer-events:none;
      box-shadow:inset 0 0 180px 60px #04060bcc, inset 0 0 60px 0 #04060b88}
    .anton{font-family:Anton,sans-serif;font-weight:400;letter-spacing:.5px}
    .osw{font-family:Oswald,sans-serif}
    .wm{font-family:Anton,sans-serif;background:linear-gradient(180deg,${G.goldH},${G.gold} 50%,${G.goldD});
      -webkit-background-clip:text;background-clip:text;color:transparent;
      filter:drop-shadow(0 2px 10px ${G.gold}3a);letter-spacing:1px}
    .chip{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:999px;
      background:linear-gradient(180deg,#141d2e,#0c1320);border:1px solid #2b3a52;
      color:#cfd6e2;font-weight:600;font-size:15px;box-shadow:0 2px 8px #0006, inset 0 1px 0 #ffffff12}
    .chip b{color:${G.gold};font-weight:700}
    .dot{width:8px;height:8px;border-radius:50%}
    .panel{background:linear-gradient(180deg,#121b2bdd,#0b1220ee);border:1px solid #2a3850;border-radius:16px;
      box-shadow:0 24px 60px #000a, inset 0 1px 0 #ffffff12, 0 0 0 1px #0006}
    .gold{color:${G.gold}} .dim{color:${G.dim}} .muted{color:${G.muted}}
    ${extra}
  </style></head>`;
}

const layers = `<div class="hex"></div><div class="glows"></div><div class="beam"></div><div class="grain"></div><div class="vign"></div>`;

// barrinha de progresso/valor
const bar = (pct, color, w = 150) =>
  `<span style="display:inline-block;width:${w}px;height:8px;border-radius:5px;background:#1b2434;overflow:hidden;vertical-align:middle">
     <span style="display:block;width:${pct}%;height:100%;border-radius:5px;background:linear-gradient(90deg,${shade(color,.2)},${color})"></span></span>`;

// avatar/crista abstrata de Legend (sem arte real)
function crest(c1, c2, letter, size = 44) {
  const id = "c" + Math.random().toString(36).slice(2, 7);
  return `<svg width="${size}" height="${size}" viewBox="0 0 44 44"><defs>
    <radialGradient id="${id}" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="${shade(c1,.3)}"/><stop offset="1" stop-color="${shade(c2,-.3)}"/></radialGradient></defs>
    <circle cx="22" cy="22" r="20" fill="url(#${id})" stroke="#ffffff33" stroke-width="1.3"/>
    <circle cx="22" cy="22" r="20" fill="none" stroke="#0008" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/>
    <text x="22" y="29" text-anchor="middle" font-family="Oswald,sans-serif" font-weight="700" font-size="20" fill="#fff" opacity=".92">${letter}</text></svg>`;
}

/* ----------------------------- MARQUEE 1400x560 ----------------------------- */
const marquee = `<!doctype html><html>${head(`
  .mq{position:absolute;inset:0;display:flex;align-items:center;padding:0 86px}
  .left{width:60%}
  .cry{position:absolute;right:70px;top:0;bottom:0;display:flex;align-items:center;gap:0}
`)}<body><div class="stage">${layers}
  <div class="cry">
    <div style="display:flex;align-items:flex-end;gap:-10px;transform:rotate(-6deg)">
      <div style="transform:translateY(34px) scale(.8);opacity:.9">${crystal(TIERS[2][1], "", 150)}</div>
      <div style="transform:translateY(6px) scale(.95);margin:0 -14px;opacity:.96">${crystal(TIERS[5][1], "", 168)}</div>
      <div style="transform:translateY(-16px) scale(1.12);z-index:2">${crystal(TIERS[8][1], "", 182)}</div>
    </div>
  </div>
  <div class="mq"><div class="left">
    <div style="display:flex;align-items:center;gap:22px;margin-bottom:22px">
      ${badge(96)}
      <div>
        <div class="wm" style="font-size:72px;line-height:.9">RIFT RANKED</div>
        <div class="osw" style="font-weight:500;font-size:23px;color:#c3ccd9;letter-spacing:.3px;margin-top:8px">Ranqueado competitivo para o RiftAtlas</div>
      </div>
    </div>
    <div style="display:flex;gap:12px;margin-top:30px;flex-wrap:wrap">
      <span class="chip"><span class="dot" style="background:${G.gold};box-shadow:0 0 8px ${G.gold}"></span> Fila por <b>MMR (Glicko-2)</b></span>
      <span class="chip">Ladder &amp; <b>Elos</b> por temporada</span>
      <span class="chip">Estatísticas de <b>Legends</b></span>
    </div>
  </div></div>
</div></body></html>`;

/* ----------------------------- TILE 440x280 ----------------------------- */
const tile = `<!doctype html><html>${head(`
  .t{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:22px}
`)}<body><div class="stage">${layers}
  <div style="position:absolute;right:-26px;top:-20px;transform:rotate(10deg);opacity:.9">${crystal(TIERS[8][1], "", 150)}</div>
  <div class="t">
    <div style="margin-bottom:16px">${badge(84)}</div>
    <div class="wm" style="font-size:46px;line-height:.86">RIFT<br>RANKED</div>
    <div class="osw" style="font-weight:500;font-size:16px;color:#c3ccd9;margin-top:12px;max-width:300px">Ranqueado de verdade no RiftAtlas</div>
  </div>
</div></body></html>`;

/* ---------- cabeçalho comum das screenshots (marca + título) ---------- */
const shotHead = (title, sub) => `
  <div style="position:absolute;top:40px;left:56px;right:56px;display:flex;align-items:center;gap:13px">
    ${badge(42)}<span class="wm" style="font-size:26px">RIFT RANKED</span>
    <span style="flex:1"></span>
    <span class="chip" style="font-size:13px;padding:7px 13px"><span class="dot" style="background:${G.live};box-shadow:0 0 8px ${G.live}"></span> ao vivo</span>
  </div>
  <div style="position:absolute;top:118px;left:56px;right:56px">
    <div class="anton" style="font-size:46px;line-height:1.02;color:#f3f1ea">${title}</div>
    <div style="font-size:19px;color:${G.dim};margin-top:10px;font-weight:500">${sub}</div>
  </div>`;

/* ---------- SHOT 1: Fila & Pareamento (overlay do app) ---------- */
const shot1 = `<!doctype html><html>${head()}<body><div class="stage">${layers}
  ${shotHead("Ranqueado de verdade no RiftAtlas", "Entre na fila e seja pareado por MMR — direto no navegador, sem configuração.")}
  <!-- overlay do app -->
  <div class="panel" style="position:absolute;right:90px;top:250px;width:420px;padding:0;overflow:hidden">
    <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #223049;background:linear-gradient(180deg,#16203300,#0c132033)">
      ${badge(30)}<span class="wm" style="font-size:19px">RIFT RANKED</span>
      <span style="flex:1"></span>
      <span style="display:flex;align-items:center;gap:7px;color:${G.live};font-weight:600;font-size:13px"><span class="dot" style="background:${G.live};box-shadow:0 0 8px ${G.live}"></span> Na fila</span>
      <span style="color:${G.muted};font-size:18px;margin-left:4px">—</span>
    </div>
    <div style="padding:18px">
      <div style="display:flex;align-items:center;gap:13px;padding:12px 14px;background:#0e1626;border:1px solid #223049;border-radius:12px;margin-bottom:16px">
        ${crystal(TIERS[2][1], "II", 46, false)}
        <div><div class="osw" style="font-weight:700;font-size:18px;color:${TIERS[2][1]}">Ouro II</div>
        <div style="color:${G.dim};font-size:13px">1 420 PR · 12 V / 7 D · 63% WR</div></div>
        <span style="flex:1"></span><div style="text-align:right"><div style="font-size:11px;color:${G.muted}">POSIÇÃO</div><div class="osw" style="font-weight:700;font-size:20px;color:${G.gold}">#38</div></div>
      </div>
      <div style="display:flex;gap:12px">
        <div style="flex:1;text-align:center;padding:16px 0;border-radius:12px;background:linear-gradient(180deg,${G.gold},${G.goldD});color:#1a1205;font-family:Oswald;font-weight:700;font-size:18px;box-shadow:0 8px 20px ${G.gold}33, inset 0 1px 0 #fff6">Jogar Md1</div>
        <div style="flex:1;text-align:center;padding:16px 0;border-radius:12px;background:#111a2b;border:1px solid #2a3a54;color:#d7dde8;font-family:Oswald;font-weight:700;font-size:18px">Jogar Md3</div>
      </div>
      <div style="margin-top:16px;display:flex;align-items:center;gap:11px;padding:13px 15px;border-radius:12px;background:#0d1522;border:1px solid #223049">
        <span style="position:relative;width:16px;height:16px"><span class="dot" style="width:16px;height:16px;background:${G.gold}33;position:absolute"></span><span class="dot" style="width:8px;height:8px;background:${G.gold};position:absolute;left:4px;top:4px;box-shadow:0 0 8px ${G.gold}"></span></span>
        <span style="color:#cdd5e1;font-weight:600;font-size:15px">Procurando oponente Md1…</span>
        <span style="flex:1"></span><span class="osw" style="font-weight:700;font-size:18px;color:${G.gold}">0:12</span>
      </div>
    </div>
  </div>
  <!-- legenda de apoio -->
  <div style="position:absolute;left:56px;bottom:70px;width:640px">
    <div style="display:flex;gap:40px">
      <div><div class="anton gold" style="font-size:30px;white-space:nowrap">Glicko-2</div><div class="dim" style="font-size:14px">pareamento por nível real</div></div>
      <div><div class="anton gold" style="font-size:30px;white-space:nowrap">Md1 · Md3</div><div class="dim" style="font-size:14px">melhor de 1 e melhor de 3</div></div>
      <div><div class="anton gold" style="font-size:30px;white-space:nowrap">0 setup</div><div class="dim" style="font-size:14px">abre e joga</div></div>
    </div>
  </div>
</div></body></html>`;

/* ---------- SHOT 2: Ladder & Elos ---------- */
function ladderRow(pos, name, ti, div, lp, wr, hl) {
  const [tn, tc] = TIERS[ti];
  const edge = pos === 1 ? G.gold : pos === 2 ? "#9fb0c0" : pos === 3 ? "#b07d4a" : "transparent";
  return `<div style="display:flex;align-items:center;gap:16px;padding:13px 20px;border-bottom:1px solid #182236;
      box-shadow:inset 3px 0 0 ${edge};background:${hl ? "#121c2e66" : "transparent"}">
    <span class="osw" style="width:34px;font-weight:700;font-size:18px;color:${pos <= 3 ? edge : G.dim}">${pos}</span>
    ${crystal(tc, div || "", 40, false)}
    <div style="flex:1"><div style="font-weight:600;font-size:17px;color:#e7eaf0">${name}</div>
      <div style="font-size:13px;color:${tc};font-weight:600">${tn}${div ? " " + div : ""}</div></div>
    <div style="text-align:right;width:92px"><div class="osw" style="font-weight:700;font-size:17px;color:${G.gold}">${lp} PR</div>
      <div style="font-size:12px;color:${G.muted}">${wr}% WR</div></div>
  </div>`;
}
const shot2 = `<!doctype html><html>${head()}<body><div class="stage">${layers}
  ${shotHead("Suba de Bronze a Diamante", "Ladder por temporada com posições, ratings e elos. Vença e escale.")}
  <div class="panel" style="position:absolute;left:56px;right:56px;top:252px;bottom:60px;overflow:hidden">
    <div style="display:flex;align-items:center;gap:14px;padding:16px 20px;border-bottom:1px solid #223049;background:linear-gradient(90deg,#15203400,#1a284044)">
      <span class="osw gold" style="font-weight:700;font-size:17px;letter-spacing:.5px">TEMPORADA 1 · Md1</span>
      <span style="flex:1"></span>
      <span class="chip" style="font-size:12.5px;padding:6px 12px">Top da ladder</span>
    </div>
    <div style="display:flex;height:calc(100% - 59px)">
      <div style="flex:1;border-right:1px solid #182236">
        ${ladderRow(1, "KaitoEdge", 8, "", 2516, 71, true)}
        ${ladderRow(2, "ValeNoctis", 8, "", 2488, 68, false)}
        ${ladderRow(3, "RamonBR", 7, "", 2342, 64, false)}
        ${ladderRow(4, "SkadiMain", 6, "", 2180, 61, false)}
        ${ladderRow(5, "LunaRift", 5, "I", 1960, 59, false)}
      </div>
      <div style="flex:1">
        ${ladderRow(6, "HexaByte", 5, "III", 1842, 57, false)}
        ${ladderRow(7, "AoiTempest", 4, "II", 1614, 55, false)}
        ${ladderRow(8, "DrakeV", 3, "I", 1498, 53, false)}
        ${ladderRow(9, "NovaStorm", 2, "II", 1286, 51, false)}
        ${ladderRow(10, "PixelSage", 1, "III", 1104, 49, false)}
      </div>
    </div>
  </div>
</div></body></html>`;

/* ---------- SHOT 3: Estatísticas de Legends ---------- */
function legRow(letter, c1, c2, name, wr, pr) {
  return `<div style="display:flex;align-items:center;gap:14px;padding:12px 4px;border-bottom:1px solid #18223688">
    ${crest(c1, c2, letter, 42)}
    <div style="width:130px;font-weight:600;font-size:16px;color:#e7eaf0">${name}</div>
    <div style="display:flex;align-items:center;gap:10px;width:235px"><span class="muted" style="font-size:12px;width:34px">WR</span>${bar(wr, G.win, 150)}<span class="osw" style="font-weight:700;color:${G.win};font-size:15px">${wr}%</span></div>
    <div style="display:flex;align-items:center;gap:10px;width:235px"><span class="muted" style="font-size:12px;width:34px">PR</span>${bar(pr, "#5a88c4", 150)}<span class="osw" style="font-weight:700;color:#7aa6e0;font-size:15px">${pr}%</span></div>
  </div>`;
}
const shot3 = `<!doctype html><html>${head()}<body><div class="stage">${layers}
  ${shotHead("Winrate, pickrate e confrontos", "Estatísticas de cada Legend e Legend vs Legend — global e por jogador.")}
  <div class="panel" style="position:absolute;left:56px;top:252px;bottom:60px;width:720px;padding:10px 24px">
    <div style="display:flex;gap:10px;padding:10px 4px 14px;color:${G.muted};font-size:12px;font-weight:700;letter-spacing:.5px">
      <span style="width:56px"></span><span style="width:130px">LEGEND</span><span style="width:235px">WINRATE</span><span style="width:235px">PICKRATE</span></div>
    ${legRow("V", "#c25049", "#7a2f2b", "Vanguard", 56, 24)}
    ${legRow("S", "#5a88c4", "#2d4f82", "Seraphine", 54, 19)}
    ${legRow("A", "#3f9d63", "#1f5a38", "Ashwalker", 52, 16)}
    ${legRow("M", "#8e63c0", "#4f3272", "Mournshade", 49, 12)}
    ${legRow("T", "#d2a43c", "#876418", "Tempest", 47, 9)}
  </div>
  <!-- card confronto -->
  <div class="panel" style="position:absolute;right:56px;top:252px;width:360px;padding:22px">
    <div class="osw gold" style="font-weight:700;font-size:15px;letter-spacing:.5px;margin-bottom:18px">LEGEND vs LEGEND</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
      <div style="text-align:center">${crest("#c25049", "#7a2f2b", "V", 66)}<div style="font-weight:600;margin-top:8px;font-size:15px">Vanguard</div></div>
      <div class="anton" style="font-size:26px;color:${G.muted}">VS</div>
      <div style="text-align:center">${crest("#5a88c4", "#2d4f82", "S", 66)}<div style="font-weight:600;margin-top:8px;font-size:15px">Seraphine</div></div>
    </div>
    <div style="height:14px;border-radius:8px;overflow:hidden;display:flex;box-shadow:inset 0 1px 3px #000a">
      <div style="width:58%;background:linear-gradient(90deg,${shade("#c25049",.2)},#c25049)"></div>
      <div style="width:42%;background:linear-gradient(90deg,#5a88c4,${shade("#5a88c4",-.2)})"></div></div>
    <div style="display:flex;justify-content:space-between;margin-top:9px;font-family:Oswald;font-weight:700;font-size:16px">
      <span style="color:#d9736d">58%</span><span class="muted" style="font-size:12px;font-weight:500;align-self:center">143 partidas</span><span style="color:#7aa6e0">42%</span></div>
  </div>
</div></body></html>`;

/* ---------- SHOT 4: Resultado justo + reconexão ---------- */
const ring = (pct) => {
  const C = 2 * Math.PI * 52, off = C * (1 - pct);
  return `<svg width="150" height="150" viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="#1c2638" stroke-width="9"/>
    <circle cx="60" cy="60" r="52" fill="none" stroke="${G.gold}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 60 60)" style="filter:drop-shadow(0 0 6px ${G.gold}aa)"/>
    <text x="60" y="56" text-anchor="middle" font-family="Oswald" font-weight="700" font-size="30" fill="#f1efe8">0:21</text>
    <text x="60" y="76" text-anchor="middle" font-family="Inter" font-size="11" fill="${G.muted}">confirmar</text></svg>`;
};
function playerCard(name, ti, won) {
  const [tn, tc] = TIERS[ti];
  return `<div style="flex:1;position:relative;padding:18px;border-radius:14px;text-align:center;
      background:${won ? `linear-gradient(180deg,${G.gold}1f,#0e1626)` : "#0e1626"};
      border:1.5px solid ${won ? G.gold : "#243348"};box-shadow:${won ? `0 0 0 3px ${G.gold}22,0 10px 24px ${G.gold}1f` : "none"}">
    ${won ? `<div style="position:absolute;top:-13px;left:50%;transform:translateX(-50%);background:linear-gradient(180deg,${G.gold},${G.goldD});color:#1a1205;font-family:Oswald;font-weight:700;font-size:12px;letter-spacing:.5px;padding:4px 14px;border-radius:999px;box-shadow:0 4px 10px ${G.gold}44">VENCEDOR</div>` : ""}
    <div style="display:flex;justify-content:center;margin-bottom:10px">${crystal(tc, "", 54, won)}</div>
    <div style="font-weight:700;font-size:18px;color:#eceef2">${name}</div>
    <div style="font-size:13px;color:${tc};font-weight:600">${tn}</div>
  </div>`;
}
const shot4 = `<!doctype html><html>${head()}<body><div class="stage">${layers}
  ${shotHead("Resultado justo. Robusto a quedas.", "Os dois confirmam o vencedor (30s). Caiu? 1 minuto para voltar antes do W.O.")}
  <!-- modal de confirmação -->
  <div class="panel" style="position:absolute;left:50%;top:300px;transform:translateX(-50%);width:600px;padding:28px 30px">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
      <div class="anton" style="font-size:24px;color:#f1efe8;flex:1">Quem venceu a partida?</div>
      <div style="transform:scale(.8);transform-origin:right">${ring(0.7)}</div>
    </div>
    <div style="display:flex;gap:16px">
      ${playerCard("RamonBR", 7, true)}
      ${playerCard("ValeNoctis", 8, false)}
    </div>
    <div style="margin-top:18px;text-align:center;padding:12px;border-radius:12px;background:linear-gradient(180deg,${G.gold},${G.goldD});color:#1a1205;font-family:Oswald;font-weight:700;font-size:17px;box-shadow:0 8px 20px ${G.gold}33,inset 0 1px 0 #fff6">Confirmar vitória de RamonBR</div>
  </div>
  <!-- toast de reconexão -->
  <div class="panel" style="position:absolute;left:70px;bottom:70px;width:360px;padding:16px 18px;border-color:${G.loss}66">
    <div style="display:flex;align-items:center;gap:11px;margin-bottom:10px">
      <span class="dot" style="width:11px;height:11px;background:${G.loss};box-shadow:0 0 9px ${G.loss}"></span>
      <span style="font-weight:700;font-size:15px;color:#f0dcd9">Oponente caiu — reconectando</span>
      <span style="flex:1"></span><span class="osw" style="font-weight:700;color:${G.loss};font-size:17px">0:47</span>
    </div>
    <div style="height:7px;border-radius:5px;background:#1b2434;overflow:hidden"><div style="width:78%;height:100%;background:linear-gradient(90deg,${shade(G.loss,.2)},${G.loss})"></div></div>
    <div style="font-size:12.5px;color:${G.dim};margin-top:9px">Aguardando o retorno antes do W.O. automático.</div>
  </div>
</div></body></html>`;

export const pages = [
  { name: "marquee-1400x560.jpg", w: 1400, h: 560, html: marquee },
  { name: "tile-440x280.jpg", w: 440, h: 280, html: tile },
  { name: "screenshot-1-fila-1280x800.jpg", w: 1280, h: 800, html: shot1 },
  { name: "screenshot-2-ladder-1280x800.jpg", w: 1280, h: 800, html: shot2 },
  { name: "screenshot-3-legends-1280x800.jpg", w: 1280, h: 800, html: shot3 },
  { name: "screenshot-4-partida-1280x800.jpg", w: 1280, h: 800, html: shot4 },
];

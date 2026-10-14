// Lógica de rank (estilo LoL) derivada do MMR: tier + divisão + LP + emblema.
// Puro e testável — não depende do content script.

export const RK_TIERS: [number, string][] = [
  [1000, "#9d6b3f"], [1200, "#9aa7b4"], [1400, "#d2a43c"], [1600, "#3f9d9f"],
  [1800, "#3f9d63"], [2000, "#5a88c4"], [2200, "#8e63c0"], [2350, "#c25049"], [2500, "#caa94f"],
];
export const TIER_NAMES: Record<string, string[]> = {
  pt: ["Bronze", "Prata", "Ouro", "Platina", "Esmeralda", "Diamante", "Mestre", "Grão-Mestre", "Desafiante"],
  en: ["Bronze", "Silver", "Gold", "Platinum", "Emerald", "Diamond", "Master", "Grandmaster", "Challenger"],
  zh: ["黑铁", "白银", "黄金", "铂金", "翡翠", "钻石", "大师", "宗师", "王者"],
};
export const ROMAN = ["IV", "III", "II", "I"];

export function fullRank(rating: number, lang: string) {
  let i = 0; RK_TIERS.forEach((x, k) => { if (rating >= x[0]) i = k; });
  const apex = i >= 6, color = RK_TIERS[i][1];
  const names = TIER_NAMES[lang] || TIER_NAMES.en;
  if (apex) return { i, name: names[i], color, apex, division: null as string | null, lp: Math.max(0, Math.round(rating - RK_TIERS[i][0])) };
  const band = (RK_TIERS[i + 1][0] - RK_TIERS[i][0]) / 4;
  const d = Math.min(3, Math.floor((rating - RK_TIERS[i][0]) / band));
  const lp = Math.min(100, Math.max(0, Math.round(((rating - RK_TIERS[i][0]) - d * band) / band * 100)));
  return { i, name: names[i], color, apex, division: ROMAN[d] as string | null, lp };
}

export function shade(hex: string, p: number) {
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = p < 0 ? 0 : 255, a = Math.abs(p);
  r = Math.round((t - r) * a + r); g = Math.round((t - g) * a + g); b = Math.round((t - b) * a + b);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

let _g = 0;
export function emblem(color: string | null, mark: string, apex: boolean, size?: number) {
  size = size || 34; const gray = !color; const c = color || "#4a5663";
  const id = "e" + _g++;
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="display:block;flex:none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, .3)}"/><stop offset="1" stop-color="${shade(c, -.45)}"/></linearGradient></defs>
    <path d="M20 2.5 L35 9.5 V23 C35 31 28 34.5 20 37.5 C12 34.5 5 31 5 23 V9.5 Z" fill="url(#${id})" stroke="${shade(c, .35)}" stroke-width="1.3"/>
    <path d="M20 2.5 L35 9.5 V15 C28 11.5 12 11.5 5 15 V9.5 Z" fill="#fff" fill-opacity="${gray ? .05 : .13}"/>
    ${apex ? `<circle cx="20" cy="21" r="4.3" fill="#fff" fill-opacity=".9"/>` : mark ? `<text x="20" y="26" text-anchor="middle" font-size="13" font-weight="800" fill="#10131a" font-family="ui-sans-serif,system-ui,sans-serif">${mark}</text>` : ""}
  </svg>`;
}

// Renderiza os assets da Chrome Web Store (HTML/CSS -> JPEG 24-bit no tamanho exato).
// Chrome headless (puppeteer-core) renderiza em 2x; sharp reduz p/ o tamanho final,
// achata o alfa (fundo opaco) e grava JPEG (sem canal alfa, como a loja exige).
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { pages } from "./pages.mjs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Caminho do Chrome: ajuste se o seu for diferente (ou defina CHROME_PATH).
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
// Default: grava na pasta store-assets (pai deste generator). Passe um arg p/ preview.
const OUT = process.argv[2] || join(HERE, "..");
const SCALE = 2;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--force-device-scale-factor=2", "--hide-scrollbars", "--no-sandbox", "--font-render-hinting=none"],
});

for (const p of pages) {
  const page = await browser.newPage();
  await page.setViewport({ width: p.w, height: p.h, deviceScaleFactor: SCALE });
  await page.setContent(p.html, { waitUntil: "networkidle0" });
  try { await page.evaluate(async () => { await document.fonts.ready; }); } catch {}
  await new Promise((r) => setTimeout(r, 350));
  const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: p.w, height: p.h } });
  const file = `${OUT}/${p.name}`;
  mkdirSync(dirname(file), { recursive: true });
  await sharp(png)
    .resize(p.w, p.h, { fit: "fill" })       // garante o tamanho EXATO
    .flatten({ background: "#06090f" })        // remove alfa -> 24-bit
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(file);
  console.log("ok:", p.name, `${p.w}x${p.h}`);
  await page.close();
}

await browser.close();
console.log("concluído ->", OUT);

// Bundla os content scripts TS com esbuild.
//   src/inpage.ts        -> dist/inpage.js   (mundo MAIN)
//   src/content/main.ts  -> dist/content.js  (mundo ISOLATED; inclui detect + selectors)
import { build } from "esbuild";

await build({
  entryPoints: { inpage: "src/inpage.ts", content: "src/content/main.ts" },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: ["chrome110", "firefox115"],
  legalComments: "none",
  charset: "utf8",
  logLevel: "info",
});
console.log("esbuild ok: dist/inpage.js + dist/content.js");

# Gerador dos assets da Chrome Web Store

HTML/CSS renderizado por **Chrome headless** (puppeteer-core, apontando pro Chrome
instalado) → **sharp** reduz pro tamanho exato, achata o alfa e grava **JPEG 24-bit
sem canal alfa** (como a loja exige).

```bash
npm i
node render.mjs                 # grava em ../ (extension/store-assets)
node render.mjs ./out           # ou numa pasta de preview
```

- Edite o visual em `pages.mjs` (fundo, cristais de elo, mockups da UI, textos).
- Ajuste o caminho do Chrome no topo de `render.mjs` se necessário.
- Saída: marquee 1400×560, tile 440×280 e 4 screenshots 1280×800.

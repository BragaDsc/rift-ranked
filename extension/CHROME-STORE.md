# Publicar o Rift Ranked na Chrome Web Store

Tudo que você precisa para subir a extensão. O pacote já está pronto.

## Arquivo para subir
`extension/rift-ranked-chrome-0.3.30.zip`
(gere novas versões com: `pwsh -File scripts/build-chrome-zip.ps1`)

Conteúdo do zip: `manifest.json` (versão Chrome, sem o bloco `gecko` do Firefox) + `dist/inpage.js` + `dist/content.js` + `icons/` (16/48/128).

## Passo a passo
1. Acesse o **Developer Dashboard**: https://chrome.google.com/webstore/devconsole
2. Pague a **taxa única de US$ 5** (se ainda não tiver conta de desenvolvedor).
3. **Add new item** → faça upload do `.zip` acima.
4. Preencha o **Store listing** (textos abaixo).
5. Em **Privacy practices**, cole as justificativas abaixo e informe a URL da política.
6. Escolha a **visibilidade** (recomendo *Não listado* — veja a nota no fim).
7. **Submit for review**.

## Ícone
Já incluído no pacote (`icons/icon16/48/128.png` — "R" dourado sobre fundo navy).
No painel da loja, use o **`icons/icon128.png`** como ícone 128×128 da listagem.

## Imagens (já prontas em `extension/store-assets/`)
JPEG 24-bit **sem canal alfa** (como a loja exige). Sobe no painel conforme o campo:
- **Ícone da loja (128×128):** `icons/icon128.png`
- **Screenshots (1280×800)** — sobe os 4:
  - `store-assets/screenshot-1-fila-1280x800.jpg` (fila & pareamento — overlay do app)
  - `store-assets/screenshot-2-ladder-1280x800.jpg` (ladder & elos)
  - `store-assets/screenshot-3-legends-1280x800.jpg` (estatísticas de Legends)
  - `store-assets/screenshot-4-partida-1280x800.jpg` (resultado justo + reconexão)
- **Marquee promo tile (1400×560):** `store-assets/marquee-1400x560.jpg`
- **Small promo tile (440×280):** `store-assets/tile-440x280.jpg`

Regenerar o kit (HTML/CSS → Chrome headless → JPEG no tamanho exato):
```bash
cd extension/store-assets/generator && npm i && node render.mjs
```
Edite o visual em `generator/pages.mjs`. Requer o Chrome instalado (caminho em `render.mjs`).

---

## Store listing — textos

**Nome**
```
Rift Ranked
```

**Resumo curto (até 132 caracteres)**
```
Ranqueado por MMR para o RiftAtlas: fila, pareamento, ladder e estatísticas de Legends (Md1 e Md3).
```

**Descrição**
```
Rift Ranked adiciona um sistema de ranqueado competitivo ao simulador RiftAtlas (play.riftatlas.com).

Recursos:
• Fila e pareamento automático por MMR (sistema Glicko-2).
• Formatos Md1 e Md3.
• Ladder com posições, ratings e perfis de jogador.
• Estatísticas por Legend: winrate, pickrate e confrontos Legend vs Legend.
• Confirmação do vencedor ao fim da partida e reputação (curtir/não curtir).
• Detecção de queda/saída do oponente, com janela de reconexão.

Projeto de fãs, sem afiliação com a Riot Games ou com os operadores do RiftAtlas.
```

**Categoria:** Jogos (ou Ferramentas)
**Idioma:** Português (Brasil)

---

## Privacy practices — o que marcar

**URL da política de privacidade**
```
https://app.megacards.com.br/ranked/privacidade
```

**E-mail de contato:** `riftboundbrasil@gmail.com`

**Finalidade única (single purpose)**
```
O Rift Ranked tem uma única finalidade: oferecer um sistema de ranqueado para o
simulador de cartas RiftAtlas (play.riftatlas.com). A extensão coloca o jogador
em uma fila, faz o pareamento por habilidade (MMR, sistema Glicko-2), orquestra a
sala da partida, registra o resultado e exibe o ladder, os perfis e as
estatísticas de Legends. Ela só atua nas páginas do RiftAtlas e se comunica apenas
com o servidor do ranqueado — não executa nenhuma outra função.
```

**Justificativa de cada permissão**

A extensão NÃO declara nenhuma permissão de API (ex.: `storage`, `tabs`, `scripting`,
`cookies`, `activeTab`) — usa apenas o armazenamento local da própria página. Só pede
acesso aos dois hosts estritamente necessários:

- Host `https://play.riftatlas.com/*`:
```
É onde a extensão funciona. O content script injetado nessa página lê o estado da partida em andamento (fase, placar e a Legend em jogo) para detectar o início, o fim e o vencedor. Sem esse acesso a extensão não tem o que ler.
```
- Host `https://app.megacards.com.br/*`:
```
É o servidor do ranqueado. A extensão se conecta a esse host (API e WebSocket) para entrar na fila, parear por MMR, orquestrar a sala, reportar o resultado e buscar ladder/estatísticas. Sem esse acesso não há ranqueado.
```

> Nota de revisão: nenhuma permissão foi mantida sem uso. A permissão `storage` foi
> removida na v0.3.30 porque a extensão guarda preferências no `localStorage` do site,
> que não exige permissão.

**Uso de dados — declare:**
- Coleta identificador/nome do jogador e dados de partida (resultado, Legend, placar). ✔
- NÃO vende dados a terceiros. ✔
- NÃO usa/transfere dados para fins não relacionados à função principal. ✔
- NÃO usa dados para avaliação de crédito/empréstimo. ✔

---

## Visibilidade: recomendação
Como é uma ferramenta de comunidade sobre um simulador não-oficial, use **"Não listada" (Unlisted)**:
- Não aparece na busca da loja, mas qualquer pessoa com o link instala com 1 clique.
- Revisão costuma ser mais tranquila.
- Você compartilha o link no Discord/grupo.

Se quiser alcance total na busca, escolha **"Pública"** (revisão mais rigorosa).

## Depois de aprovado
O Chrome passa a **atualizar a extensão sozinho**. Extensão publicada na loja **não pode** usar
atualização self-hosted (`update_url`) — então o aviso de versão via `version.json` vira só informativo
ou pode apontar para o link da loja.

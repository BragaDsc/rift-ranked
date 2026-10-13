# Rift Ranked

[![CI](https://github.com/BragaDsc/rift-ranked/actions/workflows/ci.yml/badge.svg)](https://github.com/BragaDsc/rift-ranked/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-c8aa6e.svg)](LICENSE)

Sistema de **ranqueado competitivo** (ladder por MMR Glicko-2) para o simulador de cartas
não-oficial **RiftAtlas** (`play.riftatlas.com`). É uma **extensão de navegador** (MV3,
Chrome/Firefox) que lê o estado da partida e dirige a fila, mais um **backend Node/TypeScript**
que faz pareamento, orquestra as salas, resolve o resultado e serve o ladder e as estatísticas.

> ⚠️ **Projeto de fãs.** Sem afiliação, patrocínio ou endosso da Riot Games nem dos
> operadores do RiftAtlas. "League of Legends", "Riftbound" e nomes de cartas/Legends são
> marcas de seus respectivos donos.

## 🎮 Jogar (instalar a extensão)

Quer só **jogar** o ranqueado? Instale a extensão no seu navegador — ela já se conecta sozinha
ao servidor oficial e aparece sobre o RiftAtlas, sem configurar nada.

➡️ **[Guia de instalação passo a passo (INSTALL.md)](INSTALL.md)** — Chrome, Edge e Firefox.

Resumo: instale a extensão → entre em **https://play.riftatlas.com** logado → o painel do
Rift Ranked aparece conectado → entre na fila. Ladder em **https://app.megacards.com.br/ranked**.

O restante deste README é para **desenvolver / hospedar** o projeto.

## Recursos

- 🎯 Fila e **pareamento por MMR** (Glicko-2), nos formatos Md1 e Md3.
- 🏆 **Ladder** por temporada com elos, ratings e perfis de jogador.
- ⚔️ **Estatísticas de Legends**: winrate, pickrate e confrontos Legend vs Legend (global e por jogador).
- ✅ **Confirmação de vencedor** com cronômetro; resolução semi-autoritativa por corroboração dos dois placares.
- 🔌 **Robustez a quedas**: detecta desconexão/saída e dá 1 minuto para reconectar antes do W.O.
- 👍 **Reputação** (likes) usada como desempate em divergências.

## Estrutura

```
backend/            Node + TypeScript (ESM, NodeNext)
  src/              fonte (orquestrador, Glicko-2, repositórios, WS/HTTP server)
  db/               schema.sql (1ª vez) + migrations.sql (idempotente)
  public/           páginas servidas (ladder, perfil, Legends, privacidade) + ext/version.json
  deploy.sh         roda no servidor: cria db/role, aplica schema+migrações, npm ci, pm2
  test/             vitest
extension/          extensão MV3 (Chrome/Firefox)
  src/              inpage.ts (MAIN, intercepta o WS) · content/*.ts (ISOLATED, UI + detecção)
  manifest.json           versão Firefox (com bloco gecko)
  manifest.chrome.json    versão Chrome (sem gecko)
  build.mjs               bundle com esbuild -> dist/
  build-ext.ps1           empacota o zip self-hosted
infra/              caddy-setup.sh
scripts/            push-backend.sh · deploy-ext.sh · build-chrome-zip.ps1
```

## Desenvolvimento

**Backend**

```bash
cd backend
npm install
npm run typecheck      # tsc --noEmit
npm run build          # compila src -> dist
npm test               # vitest
npm start              # sobe o servidor (sem DATABASE_URL = repositório em memória)
```

Sem `DATABASE_URL`, o backend usa um repositório **em memória** — ótimo para rodar/testar
localmente sem Postgres. Copie `backend/.env.example` para `backend/.env` para configurar.

**Extensão**

```bash
cd extension
npm install
node build.mjs         # bundle TS -> dist/ (inpage.js + content.js)
```

Carregue sem empacotar em `chrome://extensions` (modo desenvolvedor → "Carregar sem
compactação") apontando para a pasta `extension/` após o build. Por padrão a extensão fala
com a instância de referência; para self-host, aponte para o seu backend (ver host no código
e em `host_permissions` dos manifests).

## Self-hosting (produção)

Pré-requisitos no servidor: Node 20+, PostgreSQL, pm2 e um proxy reverso (ex.: Caddy — veja
`infra/caddy-setup.sh`). O deploy é via SSH:

```bash
export RANKED_SSH_KEY=/caminho/para/chave_de_deploy      # NÃO comite a chave
export RANKED_HOST=root@SEU_SERVIDOR                     # destino ssh
scripts/push-backend.sh    # compila, empacota, aplica migrações idempotentes e reinicia o pm2
```

- **Migrações:** adicione blocos idempotentes (`CREATE TABLE IF NOT EXISTS …`) em
  `backend/db/migrations.sql`; rodam sozinhas no deploy.
- **Segredos:** `PORT`, `DATABASE_URL`, `ADMIN_TOKEN` ficam em `.env` no servidor, **fora do Git**.
  Em produção o `deploy.sh` gera a senha do banco e o `ADMIN_TOKEN` aleatoriamente na 1ª vez.

**Extensão (pacotes):**

```bash
pwsh extension/build-ext.ps1          # zip self-hosted (extension/dist/)
pwsh scripts/build-chrome-zip.ps1     # zip pronto para a Chrome Web Store
scripts/deploy-ext.sh                 # publica o zip self-hosted + version.json
```

Ao publicar, bata a versão em `manifest.json`, `manifest.chrome.json` e
`backend/public/ext/version.json` (mesmo número). Passos e textos para a Chrome Web Store
estão em [`extension/CHROME-STORE.md`](extension/CHROME-STORE.md).

## Resetar a ladder (nova temporada — mantém as contas)

```bash
ssh "$RANKED_HOST" "set -a; . /opt/riftatlas-ranked/.env; set +a; \
  psql \$DATABASE_URL -c 'TRUNCATE rating_history, matches, player_ratings, queue_entries, conduct_events, player_conduct, player_likes;' \
  && pm2 restart riftatlas-ranked"
```

## Modelo de confiança

O placar/vencedor vem do cliente (o WS do RiftAtlas é interceptado). Camadas de confiança:

1. **Placar semi-autoritativo** (`scoreWatch`): o servidor cruza os `game_score` dos **dois**
   clientes — um jogo só é "verdade" quando ambos corroboram. Um cliente adulterado sozinho não corrobora.
2. **Janela de confirmação**: os dois confirmam o vencedor ao fim da partida.
3. Na **divergência**/timeout, decide o placar corroborado (1); sem corroboração, cai para
   re-pergunta e, por fim, **reputação** (likes).

A ponte MAIN↔ISOLATED é validada por **nonce + origem**. Trapaça com cliente adulterado fica
muito mais difícil (exige conluio do oponente), mas não é 100% impossível — limitação inerente
a um overlay sem acesso ao estado autoritativo do RiftAtlas.

## Privacidade

A extensão só atua no RiftAtlas e só fala com o backend do ranqueado. Detalhes em
[`backend/public/privacidade.html`](backend/public/privacidade.html).

## Licença

[MIT](LICENSE) — use, modifique e distribua livremente, mantendo o aviso de copyright.

## Contribuindo

Issues e pull requests são bem-vindos. Rode `npm run typecheck` e `npm test` no `backend/`
antes de abrir um PR; para a extensão, garanta que `node build.mjs` compila sem erros.

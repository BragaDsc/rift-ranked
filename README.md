# RiftAtlas Ranked

Sistema de ranqueado (ladder por MMR Glicko-2) sobre o `play.riftatlas.com`:
uma **extensão de navegador** que dirige a UI do RiftAtlas + um **backend Node/TypeScript**
(fila, pareamento, orquestração de salas, resolução de partida) hospedado no VPS.

> **Fonte de verdade.** Este repositório. O backend roda em `/opt/riftatlas-ranked`
> no VPS a partir do `dist/` compilado aqui. (Historicamente a fonte TS se perdeu e
> só restava o compilado; ela foi reconstruída a partir do `dist` + `.d.ts` e verificada
> recompilando para o mesmo JS. Não repita o erro: tudo passa por este Git.)

## Estrutura

```
backend/            Node + TypeScript (ESM, NodeNext)
  src/              FONTE (editar aqui)
  dist/             build (gerado por `npm run build`; NÃO versionado)
  db/               schema.sql (1ª vez) + migrations.sql (idempotente, roda todo deploy)
  public/           páginas servidas (leaderboard.html, player.html) + ext/version.json
  deploy.sh         roda NO VPS: cria db/role, aplica schema+migrações, npm ci, pm2
  backup.sh batch.sh
extension/          extensão MV3 (Chrome/Firefox)
  manifest.json
  src/              inpage.js (MAIN) · selectors.js + content.js (ISOLATED)
  build-ext.ps1     gera extension/dist/riftatlas-ranked.zip
infra/              caddy-setup.sh
scripts/            push-backend.sh · deploy-ext.sh
```

## Backend — desenvolver e publicar

```bash
cd backend
npm install
npm run typecheck      # tsc --noEmit
npm run build          # compila src -> dist
npm test               # vitest (se houver testes)
```

Deploy (compila, empacota, aplica migrações idempotentes e reinicia o pm2):

```bash
export RANKED_SSH_KEY=/caminho/para/chave_de_deploy      # NÃO comitar a chave
export RANKED_HOST=root@161.97.154.186                   # opcional (default)
scripts/push-backend.sh
```

- **Dev local:** sem `DATABASE_URL`, usa repositório em memória. Com `DATABASE_URL`, usa Postgres.
- **Migrações:** adicione blocos idempotentes (`CREATE TABLE IF NOT EXISTS …`) em
  `backend/db/migrations.sql`; rodam sozinhas no deploy. Nunca altere o schema do VPS na mão.

## Extensão — gerar e publicar

```bash
pwsh extension/build-ext.ps1        # gera extension/dist/riftatlas-ranked.zip
# bata a versão em manifest.json E em backend/public/ext/version.json (mesmo número),
# usando a URL versionada ?v=<versão> (necessário pelo cache do Cloudflare).
scripts/deploy-ext.sh
```

Verificar: `curl -s https://app.megacards.com.br/ranked/api/ext-version`.

## Infra (VPS Contabo, Ubuntu)

- pm2 `riftatlas-ranked`, porta **4100**; Caddy faz proxy de `app.megacards.com.br/ranked/*`.
- Postgres db `riftatlas_ranked`; segredos em `/opt/riftatlas-ranked/.env`
  (`PORT`, `DATABASE_URL`, `ADMIN_TOKEN`) — fora do Git.
- Backups automáticos do `deploy.sh`/`backup.sh` em `/opt/riftatlas-ranked/_bak` e `backups`.

## Resetar a ladder (nova temporada — mantém as contas)

```bash
ssh "$RANKED_HOST" "set -a; . /opt/riftatlas-ranked/.env; set +a; \
  psql \$DATABASE_URL -c 'TRUNCATE rating_history, matches, player_ratings, queue_entries, conduct_events, player_conduct;' \
  && pm2 restart riftatlas-ranked"
```

`player_likes` (reputação) persiste entre temporadas de propósito.

## Modelo de confiança (resumo)

O placar/vencedor vem do cliente (WS do RiftAtlas interceptado). Camadas de confiança:
1. **Placar semi-autoritativo** (`scoreWatch`): o servidor cruza os `game_score` dos
   DOIS clientes — um jogo só é "verdade" quando ambos corroboram o 8. Um cliente
   adulterado sozinho não corrobora.
2. **Janela de confirmação** (UX): os dois confirmam o vencedor ao fim da partida.
3. Na **divergência**/timeout, decide o placar corroborado (1); sem corroboração, cai
   para re-pergunta e, por fim, **reputação** (likes).
A ponte MAIN↔ISOLATED é validada por **nonce + origem**. Trapaça com cliente adulterado
fica muito mais difícil (precisa do conluio do oponente), mas não é 100% impossível —
limitação inerente a um overlay sem acesso ao estado autoritativo do RiftAtlas.

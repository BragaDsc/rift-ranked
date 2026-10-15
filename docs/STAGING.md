# Ambiente de testes (staging) + produção

Dois backends independentes no **mesmo VPS**, isolados de ponta a ponta. Você testa
o código novo no **staging** e só depois promove pro **prod** — sem risco pros
jogadores reais.

| | **Produção** | **Staging (testes)** |
|---|---|---|
| Processo pm2 | `riftatlas-ranked` | `riftatlas-ranked-staging` |
| Porta | 4100 | 4101 |
| Banco Postgres | `riftatlas_ranked` | `riftatlas_ranked_staging` |
| Role Postgres | `ranked` | `ranked_staging` |
| Diretório | `/opt/riftatlas-ranked` | `/opt/riftatlas-ranked-staging` |
| URL pública (WS) | `wss://app.megacards.com.br/ranked/ws` | `wss://app.megacards.com.br/staging/ranked/ws` |
| URL pública (API) | `https://app.megacards.com.br/ranked/...` | `https://app.megacards.com.br/staging/ranked/...` |

> O Caddy usa `handle_path /staging/*`, que **remove** o prefixo `/staging` antes do
> proxy. Então o backend de staging continua atendendo em `/ranked/*` sem nenhuma
> mudança de código — só muda a porta.

## Deploy

```bash
# publica no STAGING (porta 4101, banco próprio)
scripts/push-backend.sh staging

# depois de validar, promove pro PROD (porta 4100)
scripts/push-backend.sh prod      # 'prod' é o default; pode omitir
```

O mesmo bundle (`dist/`, `db/`, `public/`) vai pros dois; só mudam destino, banco,
role, porta e nome do pm2. As migrações (`db/migrations.sql`) são idempotentes e
rodam em cada deploy, nos dois bancos.

## Apontar a extensão pro staging

A extensão escolhe o backend por `localStorage` (cai no prod se não houver nada).
No console do RiftAtlas (play.riftatlas.com):

```js
// usar o servidor de TESTES
localStorage.setItem("ranked_backend_ws", "wss://app.megacards.com.br/staging/ranked/ws");
location.reload();

// voltar pro servidor de PRODUÇÃO
localStorage.removeItem("ranked_backend_ws");
location.reload();
```

A URL do HTTP é derivada automaticamente da do WS (troca `ws`→`http` e tira `/ws`).

## Primeira configuração do VPS (uma vez só)

O `push-backend.sh staging` já cria diretório, banco, role e processo pm2. Falta só
abrir a rota no Caddy (uma vez), com o padrão seguro (valida antes de recarregar e
restaura o backup se falhar):

```bash
# no VPS, dentro do repo/infra
bash infra/caddy-setup.sh prepare-staging   # faz backup, insere o bloco, VALIDA (não recarrega)
bash infra/caddy-setup.sh apply-staging     # troca e recarrega; auto-restaura se falhar
```

## Banco de staging: criar/resetar à vontade

O staging é descartável. Para popular com dados fictícios ou resetar:

```bash
# resetar a ladder de staging (mesmo endpoint admin do prod, na porta 4101)
curl -X POST "http://127.0.0.1:4101/ranked/api/admin/reset-season?confirm=RESET" \
  -H "x-admin-token: $STAGING_ADMIN_TOKEN"
```

O `ADMIN_TOKEN` do staging fica em `/opt/riftatlas-ranked-staging/.env` (gerado no
primeiro deploy, independente do token de prod).

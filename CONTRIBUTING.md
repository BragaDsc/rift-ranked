# Contribuindo com o Rift Ranked

Obrigado pelo interesse! Issues e pull requests são bem-vindos.

## Como começar

Pré-requisitos: **Node 20+** e **npm**. Para produção também PostgreSQL, pm2 e um proxy
reverso (ex.: Caddy) — mas para desenvolver **nada disso é necessário**.

```bash
git clone https://github.com/BragaDsc/rift-ranked.git
cd rift-ranked
```

### Backend

```bash
cd backend
npm install
npm start          # sobe o servidor SEM DATABASE_URL = repositório em memória
```

Sem `DATABASE_URL`, o backend roda inteiramente em memória — ótimo para testar sem banco.
Para configurar, copie `backend/.env.example` para `backend/.env`.

### Extensão

```bash
cd extension
npm install
node build.mjs     # bundle TypeScript -> dist/ (inpage.js + content.js)
```

Carregue em `chrome://extensions` → modo desenvolvedor → **Carregar sem compactação**,
apontando para a pasta `extension/`. Para testar contra um backend próprio, ajuste o host
no código e em `host_permissions` dos manifests.

## Antes de abrir um PR

Rode as verificações e garanta que passam:

```bash
# backend
cd backend && npm run typecheck && npm test

# extensão
cd extension && npx tsc --noEmit && npm test && node build.mjs
```

A CI (GitHub Actions) roda isso em todo push/PR. A suíte de testes é a **rede de
regressão**: cada bug que já quebrou em produção vira teste pra não voltar — reconexão
no meio da partida (`orchestrator.reconnect.test.ts`), teto de variação de MMR
(`ratingCap.test.ts`), pareamento em pool pequeno (`pairing.test.ts`), identidade via
cookie do Clerk (`extension/test/identity.test.mjs`).

- Mantenha o estilo e os padrões do código ao redor (nomes, comentários, idioma).
- Prefira commits pequenos e com mensagem clara (pode ser em pt-BR).
- Se mudar comportamento do orquestrador/ratings, **adicione ou ajuste testes** (`backend/test/`, vitest).
  Ao corrigir um bug, escreva primeiro o teste que o reproduz.
- Migrações de banco vão em `backend/db/migrations.sql` como blocos **idempotentes**
  (`CREATE TABLE IF NOT EXISTS …`) — nunca altere schema do servidor na mão.

## Ambiente de testes (staging)
Antes de promover pro prod, publique no servidor de testes e valide lá:
`scripts/push-backend.sh staging` (porta 4101, banco isolado) — detalhes em
**[docs/STAGING.md](docs/STAGING.md)**.

## Release da extensão
Antes de publicar uma nova versão, siga o **[checklist de smoke test](docs/SMOKE-TEST.md)**
(inclui a Definition of Done), usando o **staging** como ensaio final.

## Segurança e segredos

- **Nunca** comite segredos: `.env`, chaves SSH/`.pem`, tokens. O `.gitignore` já cobre isso.
- Dados de deploy do SEU servidor ficam em `scripts/deploy.local.env` (git-ignorado).
  Use `scripts/deploy.local.env.example` como modelo.
- Encontrou uma vulnerabilidade? Não abra issue pública — mande um e-mail para
  **riftboundbrasil@gmail.com**.

## Escopo e licença

O Rift Ranked é um **projeto de fãs** sobre o RiftAtlas, sem afiliação com a Riot Games.
Ao contribuir, você concorda que sua contribuição é licenciada sob a
[licença MIT](LICENSE) do projeto.

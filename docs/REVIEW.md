# Revisão do projeto — Product Owner & Quality Analyst

> Revisão de produto e qualidade do Rift Ranked. Usar como backlog/roadmap.
> Última atualização: 2026-10-14.

## 👔 Product Owner

### Proposta de valor
O RiftAtlas não tem ranqueado; o Rift Ranked entrega fila por MMR, ladder e stats
"estilo LoL" sem fricção. Diferencial forte — mas depende de um ecossistema de
terceiros (RiftAtlas/Clerk) que não controlamos.

### Lacunas de produto
1. **Onboarding/ativação** — primeiro uso quebra fácil (login, recarregar, painel).
   Falta estado de boas-vindas e erros acionáveis ("Faça login no RiftAtlas").
2. **Cold-start ("estádio vazio")** — maior risco: sem gente na fila, ninguém pareia.
   Prova social (contador de online ✅), fila agendada/eventos, notificação de fila.
3. **Retenção/progressão** — temporadas com fim + recompensa, metas ("faltam 3 vitórias
   pra Ouro I"), streaks, placement explícito.
4. **Métricas** — voando às cegas. Instrumentar ativação, tempo de fila, retenção
   D1/D7, % de disputa/concessão/desconexão. (Base criada: `/api/stats` + snapshots.)

### Riscos (ordenados)
1. Dependência do RiftAtlas (mudaram o Clerk e quebraram tudo) → alerta de quebra.
2. ToS/legal (ler WS + dirigir UI de outro site) → considerar parceria oficial.
3. Cold-start.
4. Anti-cheat: conluio de 2 jogadores ainda fura.
5. Operação de 1 pessoa (disputas manuais não escalam).

## 🔍 Quality Analyst

### Testes — avaliação
- **Forte:** domínio puro muito bem coberto (~55 testes: Glicko-2, state machine,
  pairing, reconcile, scoreWatch, ranks).
- **Lacunas (por risco):**
  1. **Zero E2E / runtime da extensão** — os piores bugs (Clerk removido, token
     expirado, botão cortado) não seriam pegos pelos testes atuais. Maior buraco.
  2. `wsServer`/`pgRepository` sem testes (auth, rotas, SQL).
  3. Sem **canário de contrato** com o RiftAtlas (`__session`/selectors).
  4. Migrações não testadas (rodam direto em produção).

### Não-funcional
| Dimensão | Estado | Ação |
|---|---|---|
| Confiabilidade | Melhorou (handlers globais, fim do vazamento) | Alerta se restarts > N/h |
| Observabilidade | Base criada (`/api/stats`, snapshots, authFail) | Error tracking (Sentry), logs estruturados |
| Segurança | Boa base; admin token agora aceita header | Rotacionar token; 2FA no reset |
| Performance | OK p/ escala atual | `EXPLAIN` nas queries de stats |
| Acessibilidade | Pouco foco | Contraste + navegação por teclado |

### Processo / Release
- CI roda typecheck+test mas **não bloqueia** e **não testa a extensão**.
- **Sem staging** — tudo vai direto pra produção; bugs achados pelos usuários.
- Sem "Definition of Done" → bugs reincidentes.

## 🎯 Top 10 priorizado
| # | Item | Lente | Esforço | Impacto |
|---|---|---|---|---|
| 1 | Analytics/métricas persistidas | PO | M | 🔥🔥🔥 (base feita) |
| 2 | Alerta de quebra (auth/selector) + error tracking | QA | M | 🔥🔥🔥 (sinal feito) |
| 3 | Staging + smoke-test manual da extensão | QA | M | 🔥🔥🔥 |
| 4 | Onboarding + erros acionáveis | PO | S | 🔥🔥 |
| 5 | Cold-start: "X na fila", fila agendada, notificação | PO | M | 🔥🔥 |
| 6 | Temporadas com fim + recompensa | PO | M | 🔥🔥 |
| 7 | Testes de wsServer/pgRepository + migração efêmera | QA | M | 🔥🔥 |
| 8 | Admin token no header (feito) + endurecer reset | QA | S | 🔥 (feito) |
| 9 | Canário de contrato RiftAtlas | QA | S | 🔥🔥 |
| 10 | a11y (contraste, teclado) | QA | S | 🔥 |

### Já entregue desta revisão
- Métricas: `/api/stats` (online, filas, partidas, authOk/authFail/authFailsLastHour),
  snapshots periódicos em `metrics_snapshots`, `/api/admin/metrics`.
- Sinal de quebra: pico de `authFailsLastHour` indica que o RiftAtlas mudou.
- Segurança: admin token via header (`Authorization: Bearer` ou `X-Admin-Token`).

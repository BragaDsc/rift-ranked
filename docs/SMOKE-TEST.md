# Smoke test — checklist pré-release

Rodar **antes de publicar uma nova versão da extensão**. Cobre os caminhos que já
quebraram em produção. Não substitui testes automatizados — é a rede final manual
enquanto não há ambiente de staging.

> Dica: para apontar a extensão a um backend local, no console do RiftAtlas:
> `localStorage.setItem("ranked_backend_ws","ws://localhost:4100/ranked/ws")` e recarregue.

## 0. Servidor (antes de tudo)
- [ ] `curl .../ranked/api/health` → `{"ok":true}`
- [ ] `curl .../ranked/api/stats` → responde; **`authFailsLastHour` == 0** (se > 0, o RiftAtlas pode ter mudado)

## 1. Instalação e conexão
- [ ] Atualizar/instalar a extensão e **recarregar** `play.riftatlas.com` (logado).
- [ ] Painel aparece e vai para **"Pronto."** (não fica em "Conectando…").
- [ ] Ratings dos dois formatos carregam (não ficam "—").
- [ ] Contador de **online** aparece.
- [ ] Testar em **Chrome** e em **Firefox 128+**.

## 2. UI / painel (bugs recorrentes)
- [ ] Botões do cabeçalho **visíveis e clicáveis**: minimizar (–), config (⚙), idiomas — nada cortado na borda.
- [ ] **Minimizar** vira só o escudo + (+); **restaurar** volta ao normal.
- [ ] **Arrastar** o painel pela barra e soltar; recarregar → **posição mantida**.
- [ ] Trocar idioma **PT / EN / 中** muda os textos.

## 3. Fila
- [ ] Fora da tela inicial (sem "Host Room"): botões Jogar desabilitados com dica.
- [ ] Entrar na fila (Md1) → status "Na fila…"; **Sair da fila** funciona.

## 4. Partida completa (precisa de 2 contas)
- [ ] Parear → "Partida encontrada"; sala criada/entrada automática.
- [ ] Jogo detecta início (status "Partida em andamento") e placar.
- [ ] Ao vencer (8 pontos ou gameOutcome): abre a **janela de confirmação** com
      cronômetro; escolher vencedor + **curtir/não curtir**; confirmar.
- [ ] Resolve: chip de **±MMR**, som, ladder e **perfil (histórico)** atualizam.
- [ ] Md3: placar de série (1–0, 1–1, 2–1) aparece.

## 5. Resiliência
- [ ] **Desconexão do oponente**: banner "⏳ caiu — Ns para voltar" com contagem.
- [ ] Oponente **volta** dentro de 1 min → jogo segue normal.
- [ ] Oponente **não volta** → vitória automática ao fim do minuto.
- [ ] **Desistir** (com confirmação) resolve a partida.
- [ ] Recarregar no meio da partida → estado é **restaurado** (match_active).

## 6. Fim
- [ ] Nenhum erro vermelho no console filtrando por `ranked`.
- [ ] `curl .../ranked/api/stats` → `authFail` não subiu durante o teste.

---

## Definition of Done (release da extensão)
1. `npm run typecheck` e `npm test` verdes (backend **e** extensão).
2. Versão batida em `manifest.json`, `manifest.chrome.json` e `ext/version.json`.
3. Este smoke test executado (ao menos as seções 0–3; 4–5 quando houver 2 contas).
4. Deploy + verificação do `ext-version`, commit, push e **GitHub Release** com os zips.

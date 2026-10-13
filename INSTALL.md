# Instalar o Rift Ranked e entrar no ranqueado

Guia para **jogadores**. Depois de instalar, a extensão já se conecta sozinha ao servidor
oficial e aparece por cima do RiftAtlas — não precisa criar conta nem configurar nada.

> **Requisito:** ter uma conta no RiftAtlas e estar logado em **https://play.riftatlas.com**.
> A extensão usa o seu login do RiftAtlas para te identificar no ranqueado.

## ⬇️ Baixar a extensão

Pegue o pacote na página de **[Releases do GitHub](https://github.com/BragaDsc/rift-ranked/releases/latest)**:

- **Chrome / Edge / Brave:** [`rift-ranked-chrome-0.3.33.zip`](https://github.com/BragaDsc/rift-ranked/releases/download/v0.3.33/rift-ranked-chrome-0.3.33.zip)
- **Firefox 128+:** [`rift-ranked-firefox-0.3.33.zip`](https://github.com/BragaDsc/rift-ranked/releases/download/v0.3.33/rift-ranked-firefox-0.3.33.zip)

Alternativa (mesmo pacote, sempre a versão publicada no servidor):
**https://app.megacards.com.br/ranked/ext/riftatlas-ranked.zip**

---

## Google Chrome / Microsoft Edge / Brave

### Opção 1 — Chrome Web Store (recomendado, quando disponível)
Instale com 1 clique pela página da loja: **_(link será adicionado após a aprovação)_**.
Atualizações passam a ser automáticas.

### Opção 2 — Instalação manual (enquanto não está na loja)
1. Baixe o pacote:
   **https://app.megacards.com.br/ranked/ext/riftatlas-ranked.zip**
2. **Extraia** o `.zip` em uma pasta (ex.: `Documentos\rift-ranked`).
3. Abra `chrome://extensions` (ou `edge://extensions`).
4. Ative o **Modo do desenvolvedor** (canto superior direito).
5. Clique em **Carregar sem compactação** e selecione a **pasta extraída**.
6. Pronto — o Rift Ranked aparece na lista de extensões.

---

## Mozilla Firefox (versão 128 ou mais nova)

### Opção 1 — Add-ons do Firefox / AMO (quando disponível)
Instalação permanente com 1 clique: **_(link será adicionado após a assinatura no AMO)_**.

### Opção 2 — Teste temporário (sem assinatura)
1. Baixe o pacote:
   **https://app.megacards.com.br/ranked/ext/riftatlas-ranked.zip**
2. Abra `about:debugging#/runtime/this-firefox`.
3. Clique em **Carregar extensão temporária…** e selecione o **`.zip`** baixado.
4. Pronto. _(Obs.: instalação temporária some ao fechar o Firefox.)_

---

## Como entrar no ranqueado

1. Abra **https://play.riftatlas.com** e **faça login** na sua conta.
2. O **painel do Rift Ranked** aparece sobre a página, no canto, já **conectado ao servidor**
   (status "Pronto.").
3. Escolha o formato (**Md1** ou **Md3**) e entre na **fila**.
4. Quando parear, a extensão abre/entra na sala da partida automaticamente.
5. Ao fim do jogo, **confirme o vencedor** na janela que aparece.
6. Acompanhe sua posição no **ladder**: **https://app.megacards.com.br/ranked**

Você **não precisa** digitar servidor, usuário ou senha: a conexão com
`app.megacards.com.br` e a autenticação pela sua conta do RiftAtlas são automáticas.

---

## Problemas comuns

- **O painel não aparece:** confirme que está logado no RiftAtlas e **recarregue a página**
  (F5). No Firefox, confira se a versão é **128+**.
- **"Não foi possível obter o token do RiftAtlas":** faça login no RiftAtlas e recarregue.
- **Versão antiga / comportamento estranho:** em `chrome://extensions`, clique em
  **Atualizar**/recarregar na extensão. A versão atual é a **0.3.33**.
- **Nada acontece ao chegar a 8 pontos:** geralmente é uma aba aberta antes da atualização —
  recarregue o RiftAtlas nas duas contas.

---

## Para desenvolvedores: apontar para outro servidor

Por padrão a extensão fala com `wss://app.megacards.com.br/ranked/ws`. Para testar contra um
backend local/próprio, abra o console (F12) na aba do RiftAtlas e rode:

```js
localStorage.setItem("ranked_backend_ws", "ws://localhost:4100/ranked/ws");
// para voltar ao oficial:
localStorage.removeItem("ranked_backend_ws");
```

Recarregue a página depois. Veja o [README](README.md) para rodar o backend.

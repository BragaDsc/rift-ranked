/**
 * Seletores centralizados do RiftAtlas (mapeados na Fase 0 — ver SELETORES.md).
 * Mundo ISOLADO (acessa o DOM). Nunca depender de className (muda por build);
 * usar IDs fixos, texto, fieldset+legend e aria-pressed.
 *
 * Exposto em self.RankedSelectors para o content.js (mesmo mundo isolado).
 */
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

  /** Dispara um set de valor que o React reconhece (input controlado). */
  function setReactInput(el, value) {
    if (!el) return false;
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /** true se o elemento está realmente visível na tela (não só presente no DOM). */
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity || "1") === 0) return false;
    // fora da viewport (ex.: aba inativa empurrada pra fora) também não conta
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    return true;
  }

  const S: any = {
    norm,
    setReactInput,
    isVisible,

    nameInput: () => document.querySelector("#right-rail-player-name"),
    joinCodeInput: () => document.querySelector("#join-code"),

    /** Botão por texto exato (case-insensitive). */
    btnByText: (txt) =>
      [...document.querySelectorAll("button")].find(
        (b) => norm(b.textContent) === norm(txt),
      ) || null,

    /** Código da sala na view da sala (elemento <code> com 4-8 alfanuméricos). */
    roomCode: () => {
      const c = [...document.querySelectorAll("code")].find((e) =>
        /^[A-Z0-9]{4,8}$/.test((e.textContent || "").trim()),
      );
      return c ? c.textContent.trim() : null;
    },

    hostRoomBtn: () => S.btnByText("Host Room"),
    joinSpectateBtn: () => S.btnByText("Join / Spectate"),
    roomSetupBtn: () =>
      document.querySelector('button[aria-label="Edit room setup"]') ||
      S.btnByText("Room Setup"),
    doneBtn: () => S.btnByText("Done"),
    startMatchBtn: () => S.btnByText("Start Match"),
    leaveRoomBtn: () => S.btnByText("Leave Room"),

    // Fluxo real de saída do RiftAtlas (confirmado no DOM):
    //  - no JOGO: botão "Leave"  → diálogo "Concede and leave?" com
    //    "To Lobby" (volta pra sala) | "Leave Game" (vai pra tela inicial) | "Stay"
    //  - na SALA: botão "Leave Room"
    // Pra voltar à tela do Host Room, a sequência é: Leave/Leave Room → "Leave Game".

    /** Abre o menu de sair: "Leave" (no jogo) ou "Leave Room" (na sala). */
    leaveMenuBtn: () =>
      [...document.querySelectorAll("button")].find((b) => {
        const t = norm(b.textContent);
        return t === "leave" || t === "leave room";
      }) || null,

    /** Confirmação que leva à tela inicial (Host Room) — NÃO "To Lobby". */
    leaveGameBtn: () =>
      [...document.querySelectorAll("button")].find((b) => norm(b.textContent) === "leave game") || null,

    /** true se o jogador está logado o suficiente pra hospedar (campo nome existe). */
    inLobby: () => !!S.nameInput() || !!S.hostRoomBtn(),
    inRoom: () => !!S.roomCode(),

    /**
     * true se dá pra entrar na fila AGORA: precisa estar na tela inicial com o
     * botão "Host Room" VISÍVEL e habilitado, e fora de qualquer sala/partida.
     * Numa SPA o botão pode ficar no DOM mas escondido após navegar — por isso
     * exigimos visibilidade real, não só presença. Mesma condição que a extensão
     * precisa pra conseguir criar a sala.
     */
    canHost: () => {
      const b = S.hostRoomBtn();
      return !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true" && isVisible(b) && !S.inRoom();
    },

    /**
     * Seleciona uma opção dentro do grupo certo do Room Setup / Match Settings.
     * Idempotente: só clica se ainda não estiver selecionado (aria-pressed).
     * legendText: "Game Mode" | "Play Mode" | "Match Format" | "Deck Rules" | "Format" | "Table" | "Card pool"
     */
    setMatchOption: (legendText, optionText) => {
      // tenta fieldset+legend; se não achar, procura por rótulo <p>/<legend> próximo
      let scope =
        [...document.querySelectorAll("fieldset")].find(
          (f) => norm(f.querySelector("legend")?.textContent) === norm(legendText),
        ) || null;

      let buttons;
      if (scope) {
        buttons = [...scope.querySelectorAll("button")];
      } else {
        // fallback: todos os botões cujo texto bate com a opção
        buttons = [...document.querySelectorAll("button")];
      }
      const b = buttons.find((x) => norm(x.textContent) === norm(optionText));
      if (!b) return false;
      if (b.getAttribute("aria-pressed") !== "true") b.click();
      return b.getAttribute("aria-pressed") === "true";
    },
  };

export { S };


// ==UserScript==
// @name         OLX: Clicar no Chat do Anúncio (preciso)
// @namespace    pequeno-gafanhoto
// @version      1.4
// @description  Espera pelo botão correto do anúncio (#price-box-button-chat) e clica; evita o Chat do header.
// @match        https://*.olx.com.br/*
// @match        https://olx.com.br/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // Seletores ultra-específicos para o botão do anúncio
  const PRIMARY_SELECTORS = [
    "#price-box-button-chat",
    "button#price-box-button-chat",
  ];

  const FALLBACK_SELECTORS = [
    'button[data-ds-component="DS-Button"][action="chat"]',
    'button.olx-button[action="chat"]',
  ];

  // Para garantir que é o botão do card de preço/detalhe do anúncio (não header)
  const PREFERRED_ANCESTORS = [
    '[id*="price"]',
    '[class*="price"]',
    '[data-testid*="price"]',
    '[data-testid*="ad"]',
    "main",
    "article",
  ].join(",");

  const clicked = new WeakSet();
  const offerClicked = new WeakSet();
  const sendOfferClicked = new WeakSet();
  let observer,
    pollId,
    chatObserver,
    offerPollId,
    inputObserver,
    inputPollInterval,
    messageObserver;
  let chatButtonClicked = false;
  let lastOfferValue = null;

  const STORAGE_KEY = "olx-last-offer-value";
  const log = (...a) => console.log("[TM-OLX-Chat-Preciso]", ...a);

  // Expõe funções globais para debug
  window.OLX_DEBUG = {
    getStoredValue: () => localStorage.getItem(STORAGE_KEY),
    setStoredValue: (val) => localStorage.setItem(STORAGE_KEY, val),
    clearStoredValue: () => localStorage.removeItem(STORAGE_KEY),
    logStatus: () => {
      log("=== STATUS DEBUG ===");
      log(`Valor salvo: ${localStorage.getItem(STORAGE_KEY)}`);
      log(`Chat clicado: ${chatButtonClicked}`);
      log(`URL: ${window.location.href}`);
    },
  };

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (
      cs.display === "none" ||
      cs.visibility === "hidden" ||
      parseFloat(cs.opacity) <= 0.01
    )
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isEnabled(el) {
    if (!el) return false;
    // Verifica se está desabilitado
    if (el.disabled || el.getAttribute("aria-disabled") === "true")
      return false;

    // Verifica se está em estado de carregamento
    const isLoading =
      el.classList.contains("loading") ||
      el.classList.contains("is-loading") ||
      el.hasAttribute("data-loading") ||
      el.getAttribute("aria-busy") === "true" ||
      // Verifica se há spinner/loader dentro do botão
      el.querySelector(
        '[class*="spinner"], [class*="loader"], [class*="loading"], svg[class*="spin"]'
      ) !== null ||
      // Verifica se o texto do botão indica carregamento
      (el.textContent && /carregando|loading/i.test(el.textContent));

    return !isLoading;
  }

  function isInPreferredArea(el) {
    return !!el.closest(PREFERRED_ANCESTORS);
  }

  function pickButton() {
    // 1) Tenta pelos seletores primários (ID exato)
    for (const sel of PRIMARY_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && isEnabled(el)) return el;
    }

    // 2) Fallback: combina action="chat" + DS-Button e valida área preferida
    const candidates = Array.from(
      document.querySelectorAll(FALLBACK_SELECTORS)
    ).filter((el) => isVisible(el) && isEnabled(el));

    // se houver muitos, dá preferência aos que estão na área principal/price box
    candidates.sort((a, b) => {
      const aMain = isInPreferredArea(a) ? 1 : 0;
      const bMain = isInPreferredArea(b) ? 1 : 0;
      if (aMain !== bMain) return bMain - aMain; // preferir quem está em área preferida
      // como desempate, quem estiver mais próximo do centro vertical da viewport
      const ay = a.getBoundingClientRect().top;
      const by = b.getBoundingClientRect().top;
      const cy = window.innerHeight / 2;
      const da = Math.abs(ay - cy);
      const db = Math.abs(by - cy);
      return da - db;
    });

    return candidates[0] || null;
  }

  function clickButton(btn) {
    if (!btn || clicked.has(btn)) return false;

    // Verifica novamente se está habilitado e não está carregando antes de clicar
    if (!isEnabled(btn)) {
      log("Botão não está pronto (desabilitado ou carregando), aguardando...");
      return false;
    }

    // Verifica se o botão está realmente visível e pronto
    if (!isVisible(btn)) {
      log("Botão não está visível, aguardando...");
      return false;
    }

    clicked.add(btn);

    try {
      // Garante estar visível na tela
      btn.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
    } catch {}

    // Pequeno delay para garantir que o botão terminou qualquer animação de carregamento
    // e está totalmente interativo
    setTimeout(() => {
      // Verifica novamente antes de clicar (pode ter mudado durante o delay)
      if (!isEnabled(btn) || !isVisible(btn)) {
        log("Botão não está mais pronto após delay, cancelando clique");
        return;
      }

      try {
        // Dispara sequência de eventos para simular interação real
        ["mouseover", "mousedown", "mouseup", "click"].forEach((type) =>
          btn.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              view: window,
            })
          )
        );
        log("Clique disparado no botão do anúncio:", btn);
        chatButtonClicked = true;
        // Após clicar no chat, inicia observação do botão "Fazer oferta"
        setTimeout(() => {
          startOfferObserver();
          startOfferPolling();
        }, 500);
      } catch {
        try {
          btn.click();
          log("Clique via .click():", btn);
          chatButtonClicked = true;
          // Após clicar no chat, inicia observação do botão "Fazer oferta"
          setTimeout(() => {
            startOfferObserver();
            startOfferPolling();
          }, 500);
        } catch (e) {
          console.warn("[TM-OLX-Chat-Preciso] Falha ao clicar", e);
        }
      }
    }, 200); // Delay reduzido para 200ms - tempo suficiente para animação mas não muito longo

    return true;
  }

  function tryClick() {
    const btn = pickButton();
    if (!btn) return false;

    // Segurança extra: não clicar em elementos que sejam header/topbar
    const isHeader = !!btn.closest(
      'header, nav, [class*="header"], [class*="topbar"], [id*="header"]'
    );
    if (isHeader) return false;

    return clickButton(btn);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      tryClick();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function startPolling() {
    if (pollId) return;
    pollId = setInterval(tryClick, 400); // Intervalo de 400ms - balanceia velocidade e tempo para carregamento
  }

  // === Funções para clicar no botão "Fazer oferta" ===

  function findOfferButton() {
    // Busca botão com texto "Fazer oferta" e classes específicas
    const buttons = Array.from(
      document.querySelectorAll(
        "button.olx-core-button.olx-core-button--secondary.olx-core-button--small"
      )
    );

    for (const btn of buttons) {
      // Verifica se contém o texto "Fazer oferta"
      if (btn.textContent.trim().includes("Fazer oferta")) {
        return btn;
      }
    }

    // Fallback: busca por qualquer botão com texto "Fazer oferta"
    const allButtons = Array.from(document.querySelectorAll("button"));
    for (const btn of allButtons) {
      if (
        btn.textContent.trim().includes("Fazer oferta") &&
        isVisible(btn) &&
        isEnabled(btn)
      ) {
        return btn;
      }
    }

    return null;
  }

  function clickOfferButton(btn) {
    if (!btn || offerClicked.has(btn)) return false;
    offerClicked.add(btn);
    try {
      btn.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
    } catch {}
    try {
      ["mouseover", "mousedown", "mouseup", "click"].forEach((type) =>
        btn.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        )
      );
      log('Clique disparado no botão "Fazer oferta":', btn);
      // Para de observar e polling após clicar
      stopOfferObserver();
      stopOfferPolling();
      // Aguarda o formulário de oferta aparecer e configura monitoramento
      setTimeout(() => {
        startInputObserver();
      }, 500);
      return true;
    } catch {
      try {
        btn.click();
        log('Clique via .click() no botão "Fazer oferta":', btn);
        stopOfferObserver();
        stopOfferPolling();
        // Aguarda o formulário de oferta aparecer e configura monitoramento
        setTimeout(() => {
          startInputObserver();
        }, 500);
        return true;
      } catch (e) {
        console.warn(
          '[TM-OLX-Chat-Preciso] Falha ao clicar em "Fazer oferta"',
          e
        );
        return false;
      }
    }
  }

  function tryClickOffer() {
    if (!chatButtonClicked) return false;
    const btn = findOfferButton();
    if (!btn) return false;
    return clickOfferButton(btn);
  }

  function startOfferObserver() {
    if (chatObserver) return;
    chatObserver = new MutationObserver(() => {
      tryClickOffer();
    });
    chatObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    log("Observador do botão 'Fazer oferta' iniciado");
  }

  function stopOfferObserver() {
    if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
      log("Observador do botão 'Fazer oferta' parado");
    }
  }

  function startOfferPolling() {
    if (offerPollId) return;
    offerPollId = setInterval(tryClickOffer, 200); // Reduzido de 400ms para 200ms
    log("Polling do botão 'Fazer oferta' iniciado");
  }

  function stopOfferPolling() {
    if (offerPollId) {
      clearInterval(offerPollId);
      offerPollId = null;
      log("Polling do botão 'Fazer oferta' parado");
    }
  }

  // === Fim das funções "Fazer oferta" ===

  // === Funções para salvar/restaurar valor do input de oferta ===

  function findOfferInput() {
    // Busca o input com as classes específicas
    const selectors = [
      'input.olx-core-input-textarea-element[aria-label="Sua oferta"]',
      'input.olx-core-input-textarea-element[placeholder*="R$"]',
      'input[aria-label*="oferta" i]',
      'input[placeholder*="R$"]',
      "input.olx-core-input-textarea-element",
    ];

    for (const selector of selectors) {
      const inputs = Array.from(document.querySelectorAll(selector));
      for (const input of inputs) {
        if (isVisible(input) && input.type === "text") {
          log(`Input encontrado com seletor: ${selector}`);
          return input;
        }
      }
    }

    return null;
  }

  function saveOfferValue(value) {
    try {
      // Remove formatação para salvar apenas números
      const cleanValue = value.replace(/[^\d]/g, "");
      if (cleanValue && cleanValue !== "0" && cleanValue !== "00") {
        localStorage.setItem(STORAGE_KEY, value);
        log(`Valor da oferta salvo: ${value}`);
      }
    } catch (e) {
      console.warn("[TM-OLX-Chat-Preciso] Erro ao salvar valor", e);
    }
  }

  function loadOfferValue() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        log(`✅ Valor da oferta recuperado do localStorage: ${saved}`);
        return saved;
      } else {
        log("ℹ️ Nenhum valor salvo encontrado no localStorage");
      }
    } catch (e) {
      console.warn("[TM-OLX-Chat-Preciso] Erro ao carregar valor", e);
    }
    return null;
  }

  function restoreOfferValue(input) {
    const savedValue = loadOfferValue();
    if (!savedValue || !input) return false;

    try {
      // Foca no input primeiro
      input.focus();

      // Define o valor
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      nativeInputValueSetter.call(input, savedValue);

      // Dispara eventos para o framework detectar a mudança
      input.dispatchEvent(
        new Event("input", { bubbles: true, cancelable: true })
      );
      input.dispatchEvent(
        new Event("change", { bubbles: true, cancelable: true })
      );

      // Remove foco
      input.blur();

      log(`Valor restaurado no input: ${savedValue}`);
      return true;
    } catch (e) {
      console.warn("[TM-OLX-Chat-Preciso] Erro ao restaurar valor", e);
      return false;
    }
  }

  function setupInputMonitoring() {
    const input = findOfferInput();
    if (!input) {
      log("Input de oferta não encontrado ainda");
      return false;
    }

    // Marca como monitorado para evitar duplicação
    if (input.hasAttribute("data-olx-monitored")) {
      log("Input já está sendo monitorado");
      return true;
    }
    input.setAttribute("data-olx-monitored", "true");

    log("Input de oferta encontrado, configurando...");

    // Aguarda um pouco antes de restaurar (para garantir que o campo está pronto)
    setTimeout(() => {
      restoreOfferValue(input);
    }, 300);

    // Monitora mudanças no input para salvar E capturar valor
    const saveOnChange = (e) => {
      const value = e.target.value;
      log(`Valor alterado detectado: ${value}`);
      if (value && value !== "R$ 0,00" && value.trim() !== "") {
        saveOfferValue(value);
        lastOfferValue = value; // Captura para usar na mensagem
      }
    };

    input.addEventListener("change", saveOnChange);
    input.addEventListener("blur", saveOnChange);
    // Também salva ao digitar (com debounce via timeout)
    let saveTimeout;
    input.addEventListener("input", (e) => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        const value = e.target.value;
        if (value && value !== "R$ 0,00" && value.trim() !== "") {
          saveOfferValue(value);
          lastOfferValue = value; // Captura para usar na mensagem
        }
      }, 1000); // Salva 1 segundo após parar de digitar
    });

    log("Monitoramento do input de oferta configurado");

    // Inicia monitoramento do botão "Enviar oferta"
    startSendOfferObserver();

    return true;
  }

  function trySetupInput() {
    const input = findOfferInput();
    if (!input) return false;
    return setupInputMonitoring();
  }

  function startInputObserver() {
    if (inputObserver) {
      log("Observer de input já está ativo");
      return;
    }

    let attempts = 0;
    const maxAttempts = 20; // Tenta por 20 vezes (8 segundos)

    // Tenta imediatamente
    if (trySetupInput()) {
      log("Input encontrado e configurado imediatamente!");
      return; // Não precisa continuar se já encontrou
    }

    // Polling para tentar encontrar o input
    inputPollInterval = setInterval(() => {
      attempts++;
      log(`Tentativa ${attempts} de encontrar input de oferta...`);

      if (trySetupInput()) {
        clearInterval(inputPollInterval);
        inputPollInterval = null;
        log("Input encontrado e configurado via polling!");
      } else if (attempts >= maxAttempts) {
        clearInterval(inputPollInterval);
        inputPollInterval = null;
        log("Número máximo de tentativas atingido para encontrar input");
      }
    }, 400);

    // Observer como backup
    inputObserver = new MutationObserver(() => {
      const input = findOfferInput();
      if (input && !input.hasAttribute("data-olx-monitored")) {
        setupInputMonitoring();
        // Se encontrou via observer, para o polling
        if (inputPollInterval) {
          clearInterval(inputPollInterval);
          inputPollInterval = null;
          log("Input encontrado via observer, polling parado");
        }
      }
    });
    inputObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    log("Observador do input de oferta iniciado");
  }

  // === Fim das funções de input ===

  // === Funções para detectar "Enviar oferta" e preencher mensagem ===

  function findSendOfferButton() {
    const buttons = Array.from(
      document.querySelectorAll(
        "button.olx-core-button.olx-core-button--primary.olx-core-button--medium"
      )
    );

    for (const btn of buttons) {
      if (btn.textContent.trim().includes("Enviar oferta")) {
        return btn;
      }
    }

    // Fallback
    const allButtons = Array.from(document.querySelectorAll("button"));
    for (const btn of allButtons) {
      if (
        btn.textContent.trim().includes("Enviar oferta") &&
        isVisible(btn) &&
        isEnabled(btn)
      ) {
        return btn;
      }
    }

    return null;
  }

  function findMessageTextarea() {
    const selectors = [
      "textarea#input-text-message",
      'textarea.olx-core-input-textarea-element[aria-label*="Digite uma mensagem"]',
      'textarea[placeholder*="Digite uma mensagem"]',
      "textarea.olx-core-textarea-element",
    ];

    for (const selector of selectors) {
      const textareas = Array.from(document.querySelectorAll(selector));
      for (const textarea of textareas) {
        if (isVisible(textarea)) {
          log(`Textarea de mensagem encontrado com seletor: ${selector}`);
          return textarea;
        }
      }
    }

    return null;
  }

  function findSendMessageButton() {
    // Busca pelo botão que contém o SVG path específico
    const paths = Array.from(
      document.querySelectorAll('path[fill-rule="evenodd"]')
    );

    for (const path of paths) {
      const d = path.getAttribute("d");
      if (d && d.includes("M2.04229758,14.0134155")) {
        // Encontrou o path, agora busca o botão pai
        const button = path.closest("button");
        if (button && isVisible(button) && isEnabled(button)) {
          log("Botão de enviar mensagem encontrado via SVG path");
          return button;
        }
      }
    }

    // Fallback: busca botões próximos ao textarea
    const textarea = findMessageTextarea();
    if (textarea) {
      const container = textarea.closest("form, div");
      if (container) {
        const buttons = Array.from(container.querySelectorAll("button"));
        for (const btn of buttons) {
          const svg = btn.querySelector("svg");
          if (svg && isVisible(btn) && isEnabled(btn)) {
            log("Botão de enviar mensagem encontrado via fallback");
            return btn;
          }
        }
      }
    }

    return null;
  }

  // Função para encontrar e validar o nome do usuário no chat
  function findUserName() {
    try {
      // Busca pelo span com o nome (comum em PC e mobile)
      // Padrão: <span class="typo-body-large" title="Nome Completo">Nome Completo</span>
      const nameSelectors = [
        "span.typo-body-large[title]",
        "span[title].typo-body-large",
        "a.olx-core-link span[title]",
        "a.olx-core-link span.typo-body-large",
      ];

      for (const selector of nameSelectors) {
        const elements = Array.from(document.querySelectorAll(selector));
        for (const el of elements) {
          // Prioriza o atributo title, depois o textContent
          const nameText = (
            el.getAttribute("title") || el.textContent?.trim()
          )?.trim();
          if (nameText) {
            // Valida o nome: deve ter nome e sobrenome, e o primeiro nome com pelo menos 4 caracteres
            const nameParts = nameText.split(/\s+/).filter((p) => p.length > 0);
            if (nameParts.length >= 2 && nameParts[0].length >= 4) {
              const firstName = nameParts[0];
              log(
                `✅ Nome do usuário encontrado e validado: ${firstName} (de: ${nameText})`
              );
              return firstName; // Retorna apenas o primeiro nome
            }
          }
        }
      }

      // Fallback: busca por spans com title que contenham nome completo
      const spansWithTitle = Array.from(
        document.querySelectorAll("span[title]")
      );
      for (const span of spansWithTitle) {
        const nameText = span.getAttribute("title")?.trim();
        if (nameText) {
          const nameParts = nameText.split(/\s+/).filter((p) => p.length > 0);
          if (nameParts.length >= 2 && nameParts[0].length >= 4) {
            // Verifica se não é um texto muito longo (provavelmente não é um nome)
            if (nameText.length < 50) {
              const firstName = nameParts[0];
              log(
                `✅ Nome do usuário encontrado via fallback: ${firstName} (de: ${nameText})`
              );
              return firstName;
            }
          }
        }
      }

      log(
        "ℹ️ Nome do usuário não encontrado ou não atende aos critérios (precisa: nome e sobrenome, primeiro nome com ≥4 caracteres)"
      );
      return null;
    } catch (e) {
      console.warn("[TM-OLX-Chat-Preciso] Erro ao buscar nome do usuário", e);
      return null;
    }
  }

  function fillMessage(textarea, offerValue) {
    if (!textarea) return false;

    // Tenta encontrar o nome do usuário
    const userName = findUserName();
    const greeting = userName ? `Olá ${userName}, tudo bem?` : `Olá, tudo bem?`;

    const message = `${greeting} Acabei de enviar uma oferta no valor de ${offerValue}. Sei que é um pouco abaixo do que você está pedindo, mas tenho real interesse na compra. Trabalho com revenda local aqui na minha cidade e pretendo adquirir o produto para revenda. Caso aceite, realizo o pagamento imediatamente para concretizarmos o negócio. Se não for possível, tudo bem, desejo ótimas vendas!`;

    try {
      textarea.focus();

      // Define o valor
      const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      nativeTextareaSetter.call(textarea, message);

      // Dispara eventos
      textarea.dispatchEvent(
        new Event("input", { bubbles: true, cancelable: true })
      );
      textarea.dispatchEvent(
        new Event("change", { bubbles: true, cancelable: true })
      );

      log(`✅ Mensagem preenchida com sucesso!`);
      log(`📝 Valor da oferta usado: ${offerValue}`);

      // Aguarda um pouco e clica no botão de enviar
      setTimeout(() => {
        clickSendMessageButton();
      }, 800);

      return true;
    } catch (e) {
      console.warn("[TM-OLX-Chat-Preciso] Erro ao preencher mensagem", e);
      return false;
    }
  }

  function clickSendMessageButton() {
    const sendBtn = findSendMessageButton();
    if (!sendBtn) {
      log("⚠️ Botão de enviar mensagem não encontrado");
      return false;
    }

    try {
      sendBtn.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
    } catch {}

    try {
      ["mouseover", "mousedown", "mouseup", "click"].forEach((type) =>
        sendBtn.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        )
      );
      log("✅ Clique disparado no botão de enviar mensagem!");
      return true;
    } catch {
      try {
        sendBtn.click();
        log("✅ Clique via .click() no botão de enviar mensagem!");
        return true;
      } catch (e) {
        console.warn(
          "[TM-OLX-Chat-Preciso] Falha ao clicar em enviar mensagem",
          e
        );
        return false;
      }
    }
  }

  function setupSendOfferMonitoring() {
    const sendBtn = findSendOfferButton();
    if (!sendBtn) return false;

    if (sendOfferClicked.has(sendBtn)) {
      log("Botão 'Enviar oferta' já está sendo monitorado");
      return true;
    }

    sendOfferClicked.add(sendBtn);
    log("Monitorando botão 'Enviar oferta'...");

    // Monitora clique no botão "Enviar oferta"
    const handleSendClick = () => {
      log('🎯 Botão "Enviar oferta" foi clicado!');

      // Captura o valor atual do input de oferta
      const offerInput = findOfferInput();
      const currentValue = offerInput
        ? offerInput.value
        : lastOfferValue || loadOfferValue();

      if (currentValue) {
        lastOfferValue = currentValue;
        log(`💰 Valor capturado da oferta: ${currentValue}`);
      }

      // Aguarda o textarea aparecer e preenche
      setTimeout(() => {
        let attempts = 0;
        const maxAttempts = 15;

        const tryFillMessage = setInterval(() => {
          attempts++;
          const textarea = findMessageTextarea();

          if (textarea) {
            clearInterval(tryFillMessage);
            fillMessage(textarea, currentValue || "R$ 0,00");
          } else if (attempts >= maxAttempts) {
            clearInterval(tryFillMessage);
            log("⚠️ Não foi possível encontrar o textarea de mensagem");
          }
        }, 300);
      }, 500);
    };

    sendBtn.addEventListener("click", handleSendClick);
    log("✅ Listener adicionado ao botão 'Enviar oferta'");
    return true;
  }

  function startSendOfferObserver() {
    if (messageObserver) {
      log("Observer de 'Enviar oferta' já está ativo");
      return;
    }

    // Tenta imediatamente
    setupSendOfferMonitoring();

    // Observer para detectar quando o botão aparecer
    messageObserver = new MutationObserver(() => {
      setupSendOfferMonitoring();
    });
    messageObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    log("Observador do botão 'Enviar oferta' iniciado");
  }

  // === Fim das funções de mensagem ===

  function hookSPA() {
    const _push = history.pushState;
    const _replace = history.replaceState;
    const trigger = () => setTimeout(tryClick, 0);
    history.pushState = function (...args) {
      const r = _push.apply(this, args);
      trigger();
      return r;
    };
    history.replaceState = function (...args) {
      const r = _replace.apply(this, args);
      trigger();
      return r;
    };
    window.addEventListener("popstate", trigger);
  }

  function init() {
    log("🚀 Iniciando script OLX Chat Automático...");
    log(`📍 URL atual: ${window.location.href}`);

    // Verifica valor salvo
    const savedValue = localStorage.getItem(STORAGE_KEY);
    if (savedValue) {
      log(`💾 Valor encontrado no localStorage: ${savedValue}`);
    } else {
      log("💾 Nenhum valor salvo encontrado");
    }

    hookSPA();

    // Tenta configurar input imediatamente caso já esteja visível
    setTimeout(() => {
      trySetupInput();
      startInputObserver();
    }, 1000);

    // Inicia imediatamente se o DOM já estiver pronto
    // Isso permite começar a buscar o botão antes de todos os recursos carregarem
    if (document.readyState === "loading") {
      // Se ainda está carregando, aguarda DOMContentLoaded (mais rápido que 'load')
      document.addEventListener("DOMContentLoaded", () => {
        startObserver();
        startPolling();
        tryClick(); // Tenta imediatamente
      });
    } else {
      // DOM já está pronto (interactive ou complete)
      startObserver();
      startPolling();
      tryClick(); // Tenta imediatamente
    }

    // Backup: também tenta quando a página estiver completamente carregada
    // (caso o botão só apareça após alguns recursos carregarem)
    window.addEventListener("load", tryClick);
  }

  // Otimização: Inicia mais cedo usando DOMContentLoaded em vez de 'load'
  // DOMContentLoaded dispara quando o HTML está parseado, muito antes de todos os recursos
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    // DOM já está pronto, inicia imediatamente
    init();
  } else {
    // Aguarda DOMContentLoaded (mais rápido) em vez de 'load'
    document.addEventListener("DOMContentLoaded", init);
    // Backup: também escuta 'load' caso DOMContentLoaded já tenha disparado
    window.addEventListener("load", () => {
      // Só inicia se ainda não foi iniciado
      if (!observer && !pollId) {
        init();
      }
    });
  }
})();

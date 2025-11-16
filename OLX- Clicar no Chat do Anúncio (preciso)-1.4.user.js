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
  let essentialLoaded = false; // Flag para indicar que o essencial foi carregado
  let resourceBlockerActive = false; // Flag para controlar bloqueio de recursos

  const STORAGE_KEY = "olx-last-offer-value";

  // === Sistema de otimização de performance ===

  // Verifica se o essencial está carregado (fotos + botão de chat)
  function checkEssentialLoaded() {
    if (essentialLoaded) return true;

    // Verifica se há fotos do produto carregadas
    const hasProductImages =
      document.querySelector(
        'img[alt*="produto"], img[alt*="anúncio"], img[src*="image"], [class*="image"], [class*="photo"], [class*="gallery"]'
      ) !== null || document.querySelectorAll("img").length >= 1; // Pelo menos uma imagem

    // Verifica se o botão de chat está presente (mesmo que ainda não esteja clicável)
    const hasChatButton =
      document.querySelector(PRIMARY_SELECTORS.join(", ")) !== null ||
      document.querySelector(FALLBACK_SELECTORS.join(", ")) !== null;

    // Considera essencial carregado se tiver imagens E botão de chat
    if (hasProductImages && hasChatButton) {
      essentialLoaded = true;
      startResourceBlocking();
      return true;
    }

    return false;
  }

  // Bloqueia recursos desnecessários após o essencial estar carregado
  // VERSÃO CONSERVADORA: Apenas remove elementos DOM, não bloqueia requisições
  function startResourceBlocking() {
    if (resourceBlockerActive) return;
    resourceBlockerActive = true;

    // NOTA: Não bloqueamos fetch/XHR para evitar quebrar a página
    // Apenas removemos elementos DOM não essenciais e otimizamos imagens

    // 1. Remove elementos não essenciais do DOM (apenas uma vez, de forma segura)
    try {
      removeNonEssentialElements();
    } catch (e) {}

    // 2. Observer para remover elementos que aparecem depois (modo conservador)
    let cleanupObserver;
    try {
      cleanupObserver = new MutationObserver((mutations) => {
        if (!essentialLoaded) return;

        // Limita processamento para não sobrecarregar
        let processed = 0;
        const maxProcess = 10; // Limita a 10 elementos por ciclo

        mutations.forEach((mutation) => {
          if (processed >= maxProcess) return;

          mutation.addedNodes.forEach((node) => {
            if (processed >= maxProcess) return;

            if (node.nodeType === 1) {
              try {
                removeNonEssentialElement(node);
                processed++;
              } catch (e) {
                // Ignora erros silenciosamente
              }
            }
          });
        });
      });

      // Observa apenas mudanças em childList, não em atributos
      if (document.body || document.documentElement) {
        cleanupObserver.observe(document.body || document.documentElement, {
          childList: true,
          subtree: false, // Apenas filhos diretos para ser mais seguro
        });
      }
    } catch (e) {}

    // 3. Otimiza imagens (apenas define lazy loading, não remove)
    try {
      const images = document.querySelectorAll("img");
      images.forEach((img) => {
        try {
          // Apenas define lazy loading para imagens não essenciais
          if (img.src && !isEssentialImage(img)) {
            img.loading = "lazy";
          }
        } catch (e) {
          // Ignora erros individuais
        }
      });
    } catch (e) {}
  }

  // Verifica se uma imagem é essencial (fotos do produto)
  function isEssentialImage(img) {
    const src = img.src || "";
    const alt = img.alt || "";
    const parent = img.closest(
      '[class*="gallery"], [class*="image"], [class*="photo"], [class*="product"]'
    );

    return (
      parent !== null ||
      /produto|anúncio|product|ad|gallery|photo|image/i.test(alt) ||
      /image|photo|gallery|product|ad/i.test(src) ||
      img.closest("main, article") !== null
    );
  }

  // Remove elementos não essenciais (modo conservador - apenas elementos muito específicos)
  function removeNonEssentialElements() {
    // Seletores MUITO específicos de elementos que podem ser removidos com segurança
    // Apenas elementos que claramente não são essenciais
    const nonEssentialSelectors = [
      'iframe[src*="ads"]',
      'iframe[src*="advertisement"]',
      '[class*="recommendation"]:not([class*="price"]):not([id*="price"])',
      '[class*="suggestion"]:not([class*="price"]):not([id*="price"])',
    ];

    nonEssentialSelectors.forEach((selector) => {
      try {
        const elements = document.querySelectorAll(selector);
        let removed = 0;
        const maxRemove = 5; // Limita remoções por seletor

        elements.forEach((el) => {
          if (removed >= maxRemove) return;

          // Verificações de segurança: não remove se estiver em áreas importantes
          if (
            !el.closest(
              'main, article, [id*="price"], [class*="price"], [id*="chat"], [class*="chat"]'
            ) &&
            !el.closest("form, button, input, textarea") &&
            el.offsetHeight > 0 && // Só remove se estiver visível
            el.offsetWidth > 0
          ) {
            try {
              el.remove();
              removed++;
            } catch (e) {
              // Ignora erros de remoção
            }
          }
        });
      } catch (e) {
        // Ignora erros silenciosamente
      }
    });
  }

  // Remove um elemento específico se não for essencial (modo muito conservador)
  function removeNonEssentialElement(node) {
    if (!node || node.nodeType !== 1) return;

    try {
      // NÃO remove se estiver em áreas essenciais
      if (
        node.closest(
          'main, article, [id*="price"], [class*="price"], [id*="chat"], [class*="chat"], form, button, input, textarea'
        )
      ) {
        return;
      }

      // NÃO remove elementos interativos ou importantes
      const tagName = node.tagName?.toLowerCase();
      if (
        [
          "img",
          "button",
          "input",
          "textarea",
          "select",
          "a",
          "script",
          "style",
          "link",
        ].includes(tagName) ||
        (node.matches &&
          node.matches("img, button, input, textarea, a, script, style, link"))
      ) {
        return;
      }

      // Apenas remove elementos muito específicos e claramente não essenciais
      const className = node.className?.toString() || "";
      const id = node.id || "";
      const combined = className + id;

      // Apenas remove se for claramente um iframe de ads ou elemento de recomendação muito específico
      if (
        (tagName === "iframe" && /ads|advertisement/i.test(node.src || "")) ||
        (tagName === "div" &&
          /recommendation|suggestion/i.test(combined) &&
          !node.closest("main, article"))
      ) {
        // Verificação final de segurança
        if (
          node.offsetHeight > 0 &&
          node.offsetWidth > 0 &&
          !node.closest("main, article")
        ) {
          node.remove();
        }
      }
    } catch (e) {
      // Ignora todos os erros silenciosamente
    }
  }

  // Expõe funções globais para debug
  window.OLX_DEBUG = {
    getStoredValue: () => localStorage.getItem(STORAGE_KEY),
    setStoredValue: (val) => localStorage.setItem(STORAGE_KEY, val),
    clearStoredValue: () => localStorage.removeItem(STORAGE_KEY),
    logStatus: () => {
      // Função de debug removida
    },
    checkEssential: () => checkEssentialLoaded(),
    forceBlockResources: () => {
      essentialLoaded = true;
      startResourceBlocking();
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
      return false;
    }

    // Verifica se o botão está realmente visível e pronto
    if (!isVisible(btn)) {
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
        chatButtonClicked = true;
        // Após clicar no chat, inicia observação do botão "Fazer oferta"
        setTimeout(() => {
          startOfferObserver();
          startOfferPolling();
        }, 500);
      } catch {
        try {
          btn.click();
          chatButtonClicked = true;
          // Após clicar no chat, inicia observação do botão "Fazer oferta"
          setTimeout(() => {
            startOfferObserver();
            startOfferPolling();
          }, 500);
        } catch (e) {}
      }
    }, 200); // Delay reduzido para 200ms - tempo suficiente para animação mas não muito longo

    return true;
  }

  function tryClick() {
    // Verifica se o essencial está carregado (otimização de performance)
    checkEssentialLoaded();

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
        stopOfferObserver();
        stopOfferPolling();
        // Aguarda o formulário de oferta aparecer e configura monitoramento
        setTimeout(() => {
          startInputObserver();
        }, 500);
        return true;
      } catch (e) {
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
  }

  function stopOfferObserver() {
    if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
    }
  }

  function startOfferPolling() {
    if (offerPollId) return;
    offerPollId = setInterval(tryClickOffer, 200); // Reduzido de 400ms para 200ms
  }

  function stopOfferPolling() {
    if (offerPollId) {
      clearInterval(offerPollId);
      offerPollId = null;
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
      }
    } catch (e) {}
  }

  function loadOfferValue() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return saved;
      } else {
      }
    } catch (e) {}
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

      return true;
    } catch (e) {
      return false;
    }
  }

  function setupInputMonitoring() {
    const input = findOfferInput();
    if (!input) {
      return false;
    }

    // Marca como monitorado para evitar duplicação
    if (input.hasAttribute("data-olx-monitored")) {
      // Mesmo se já estiver monitorado, verifica se o valor precisa ser atualizado
      const savedValue = loadOfferValue();
      const currentValue = input.value?.trim() || "";

      // Se o valor salvo é diferente do atual E o atual está vazio ou é o padrão, atualiza
      if (
        savedValue &&
        savedValue !== currentValue &&
        (currentValue === "" ||
          currentValue === "R$ 0,00" ||
          currentValue === "0")
      ) {
        setTimeout(() => {
          restoreOfferValue(input);
        }, 200);
      }
      return true;
    }
    input.setAttribute("data-olx-monitored", "true");

    // Restaura o valor salvo
    let restoreAttempts = 0;
    const maxRestoreAttempts = 3;
    const tryRestore = () => {
      restoreAttempts++;
      const savedValue = loadOfferValue();
      const currentValue = input.value?.trim() || "";

      if (savedValue) {
        // Se o valor atual está vazio ou é padrão, restaura o salvo
        if (
          currentValue === "" ||
          currentValue === "R$ 0,00" ||
          currentValue === "0"
        ) {
          restoreOfferValue(input);
        } else if (savedValue !== currentValue) {
          // Se o valor salvo é diferente, atualiza (usa o mais recente)
          restoreOfferValue(input);
        }
      }

      // Tenta novamente se necessário (caso o input ainda não esteja totalmente pronto)
      if (
        restoreAttempts < maxRestoreAttempts &&
        (!input.value || input.value === "")
      ) {
        setTimeout(tryRestore, 500);
      }
    };

    // Tenta restaurar imediatamente e depois com delays
    tryRestore();
    setTimeout(tryRestore, 300);
    setTimeout(tryRestore, 1000);

    // Monitora mudanças no input para salvar E capturar valor
    const saveOnChange = (e) => {
      const value = e.target.value?.trim() || "";
      if (value && value !== "R$ 0,00" && value !== "" && value !== "0") {
        const savedValue = loadOfferValue();
        // Só salva se o valor mudou (evita loops)
        if (value !== savedValue) {
          saveOfferValue(value);
          lastOfferValue = value; // Captura para usar na mensagem
        }
      }
    };

    input.addEventListener("change", saveOnChange);
    input.addEventListener("blur", saveOnChange);

    // Também salva ao digitar (com debounce via timeout)
    let saveTimeout;
    input.addEventListener("input", (e) => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        const value = e.target.value?.trim() || "";
        if (value && value !== "R$ 0,00" && value !== "" && value !== "0") {
          const savedValue = loadOfferValue();
          if (value !== savedValue) {
            saveOfferValue(value);
            lastOfferValue = value; // Captura para usar na mensagem
          }
        }
      }, 1000); // Salva 1 segundo após parar de digitar
    });

    // Verifica periodicamente se o valor foi alterado manualmente ou se precisa atualizar
    let checkInterval = setInterval(() => {
      if (!input.isConnected) {
        clearInterval(checkInterval);
        return;
      }

      const currentValue = input.value?.trim() || "";
      const savedValue = loadOfferValue();

      // Se o valor atual é válido e diferente do salvo, atualiza o salvo
      if (
        currentValue &&
        currentValue !== "R$ 0,00" &&
        currentValue !== "0" &&
        currentValue !== savedValue
      ) {
        saveOfferValue(currentValue);
        lastOfferValue = currentValue;
      }
      // Se o valor salvo existe mas o atual está vazio/padrão, restaura
      else if (
        savedValue &&
        (currentValue === "" ||
          currentValue === "R$ 0,00" ||
          currentValue === "0")
      ) {
        restoreOfferValue(input);
      }
    }, 2000); // Verifica a cada 2 segundos

    // Limpa o intervalo quando o input é removido
    const disconnectObserver = new MutationObserver(() => {
      if (!input.isConnected) {
        clearInterval(checkInterval);
        disconnectObserver.disconnect();
      }
    });
    disconnectObserver.observe(input.parentElement || document.body, {
      childList: true,
    });

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
      return;
    }

    let attempts = 0;
    const maxAttempts = 20; // Tenta por 20 vezes (8 segundos)

    // Tenta imediatamente
    if (trySetupInput()) {
      return; // Não precisa continuar se já encontrou
    }

    // Polling para tentar encontrar o input
    inputPollInterval = setInterval(() => {
      attempts++;

      if (trySetupInput()) {
        clearInterval(inputPollInterval);
        inputPollInterval = null;
      } else if (attempts >= maxAttempts) {
        clearInterval(inputPollInterval);
        inputPollInterval = null;
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
        }
      }
    });
    inputObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
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
      // Palavras que devem ser ignoradas (não são nomes)
      const ignoreWords = [
        "Último",
        "último",
        "acesso",
        "online",
        "offline",
        "visto",
        "há",
        "atrás",
        "minutos",
        "horas",
        "dias",
        "semana",
        "mês",
        "meses",
        "ver",
        "perfil",
        "voltar",
        "fechar",
        "chat",
        "mensagem",
        "conversa",
      ];

      // Função para validar se um texto é realmente um nome
      function isValidName(text) {
        if (!text || text.length < 2) return false;

        // Ignora textos que contenham palavras de status/tempo
        const lowerText = text.toLowerCase();
        if (ignoreWords.some((word) => lowerText.includes(word))) {
          return false;
        }

        // Ignora textos que parecem ser datas/horários
        if (/\d{1,2}:\d{2}/.test(text) || /\d{1,2}\/\d{1,2}/.test(text)) {
          return false;
        }

        // Ignora textos muito longos (provavelmente não são nomes)
        if (text.length > 50) return false;

        const nameParts = text.split(/\s+/).filter((p) => p.length > 0);

        // Se tiver apenas uma palavra, precisa ter pelo menos 4 caracteres
        if (nameParts.length === 1) {
          return (
            nameParts[0].length >= 4 &&
            !ignoreWords.includes(nameParts[0].toLowerCase())
          );
        }

        // Se tiver duas ou mais palavras, valida o primeiro nome
        if (nameParts.length >= 2) {
          const firstName = nameParts[0];
          // Primeiro nome deve ter pelo menos 2 caracteres e não ser uma palavra ignorada
          return (
            firstName.length >= 2 &&
            !ignoreWords.includes(firstName.toLowerCase()) &&
            // Verifica se não é um texto de status (ex: "Último acesso")
            !ignoreWords.some((word) => text.toLowerCase().includes(word))
          );
        }

        return false;
      }

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

          if (nameText && isValidName(nameText)) {
            const nameParts = nameText.split(/\s+/).filter((p) => p.length > 0);
            const firstName = nameParts[0];

            // Verifica se não está dentro de um contexto de status/tempo
            const parent = el.closest(
              '[class*="status"], [class*="time"], [class*="access"]'
            );
            if (!parent) {
              return firstName;
            }
          }
        }
      }

      // Fallback mais restritivo: busca apenas em áreas específicas do chat
      const chatHeader = document.querySelector(
        '[class*="chat"], [id*="chat"], [class*="conversation"]'
      );
      if (chatHeader) {
        const spansWithTitle = Array.from(
          chatHeader.querySelectorAll("span[title]")
        );
        for (const span of spansWithTitle) {
          const nameText = span.getAttribute("title")?.trim();
          if (nameText && isValidName(nameText)) {
            // Verifica se não está próximo a textos de status
            const nextSibling = span.nextElementSibling;
            const siblingText = nextSibling?.textContent?.toLowerCase() || "";
            if (!ignoreWords.some((word) => siblingText.includes(word))) {
              const nameParts = nameText
                .split(/\s+/)
                .filter((p) => p.length > 0);
              const firstName = nameParts[0];
              return firstName;
            }
          }
        }
      }

      return null;
    } catch (e) {
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

      // Aguarda um pouco e clica no botão de enviar
      setTimeout(() => {
        clickSendMessageButton();
      }, 800);

      return true;
    } catch (e) {
      return false;
    }
  }

  function clickSendMessageButton() {
    const sendBtn = findSendMessageButton();
    if (!sendBtn) {
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
      return true;
    } catch {
      try {
        sendBtn.click();
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  function setupSendOfferMonitoring() {
    const sendBtn = findSendOfferButton();
    if (!sendBtn) return false;

    if (sendOfferClicked.has(sendBtn)) {
      return true;
    }

    sendOfferClicked.add(sendBtn);

    // Monitora clique no botão "Enviar oferta"
    const handleSendClick = () => {
      // Captura o valor atual do input de oferta
      const offerInput = findOfferInput();
      const currentValue = offerInput
        ? offerInput.value
        : lastOfferValue || loadOfferValue();

      if (currentValue) {
        lastOfferValue = currentValue;
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
          }
        }, 300);
      }, 500);
    };

    sendBtn.addEventListener("click", handleSendClick);
    return true;
  }

  function startSendOfferObserver() {
    if (messageObserver) {
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
  }

  // === Fim das funções de mensagem ===

  function scrollToTop() {
    try {
      // Método 1: window.scrollTo (compatível com PC e mobile)
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: "instant", // instant para ser mais rápido, sem animação
      });
    } catch (e) {
      try {
        // Método 2: Fallback usando scrollTo simples
        window.scrollTo(0, 0);
      } catch (e2) {
        try {
          // Método 3: Fallback usando documentElement/body
          if (document.documentElement) {
            document.documentElement.scrollTop = 0;
          }
          if (document.body) {
            document.body.scrollTop = 0;
          }
        } catch (e3) {}
      }
    }
  }

  function hookSPA() {
    const _push = history.pushState;
    const _replace = history.replaceState;
    const trigger = () => {
      setTimeout(tryClick, 0);
      // Faz scroll para o topo quando a página muda (SPA)
      setTimeout(() => {
        scrollToTop();
      }, 100);
    };
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
    // Verifica valor salvo
    const savedValue = localStorage.getItem(STORAGE_KEY);
    if (savedValue) {
    } else {
    }

    hookSPA();

    // Faz scroll para o topo da página após um pequeno delay
    // Isso garante que as fotos do anúncio fiquem visíveis
    setTimeout(() => {
      scrollToTop();
    }, 100); // Pequeno delay para garantir que o DOM está renderizado

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
        // Faz scroll para o topo quando o DOM estiver pronto
        setTimeout(() => {
          scrollToTop();
        }, 150);
        // Verifica se o essencial está carregado periodicamente
        const essentialCheckInterval = setInterval(() => {
          if (checkEssentialLoaded()) {
            clearInterval(essentialCheckInterval);
          }
        }, 500);
        startObserver();
        startPolling();
        tryClick(); // Tenta imediatamente
      });
    } else {
      // DOM já está pronto (interactive ou complete)
      // Faz scroll para o topo
      setTimeout(() => {
        scrollToTop();
      }, 150);
      // Verifica se o essencial está carregado periodicamente
      const essentialCheckInterval = setInterval(() => {
        if (checkEssentialLoaded()) {
          clearInterval(essentialCheckInterval);
        }
      }, 500);
      startObserver();
      startPolling();
      tryClick(); // Tenta imediatamente
    }

    // Backup: também tenta quando a página estiver completamente carregada
    // (caso o botão só apareça após alguns recursos carregarem)
    window.addEventListener("load", () => {
      tryClick();
      // Faz scroll para o topo também quando tudo estiver carregado
      setTimeout(() => {
        scrollToTop();
      }, 200);
    });
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

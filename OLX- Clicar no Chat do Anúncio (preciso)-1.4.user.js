// ==UserScript==
// @name         OLX: Clicar no Chat do Anúncio (preciso) + Foco/Aba Ativa
// @namespace    pequeno-gafanhoto
// @version      1.5
// @description  Espera pelo botão correto do anúncio (#price-box-button-chat) e clica; evita o Chat do header. Re-tenta ao ativar a aba.
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

  // === NOVO: controle de varreduras por foco/visibilidade ===
  let sweepTimeout = null;
  let lastSweepAt = 0;
  const SWEEP_DEBOUNCE_MS = 120; // evita múltiplos sweeps colados
  const WATCHDOG_DELAY_MS = 4000; // watchdog para re-tentar se nada clicou
  let watchdogTimeout = null;

  const STORAGE_KEY = "olx-last-offer-value";
  const log = (...a) => console.log("[TM-OLX-Chat-Preciso]", ...a);

  // Expor debug
  window.OLX_DEBUG = {
    getStoredValue: () => localStorage.getItem(STORAGE_KEY),
    setStoredValue: (val) => localStorage.setItem(STORAGE_KEY, val),
    clearStoredValue: () => localStorage.removeItem(STORAGE_KEY),
    logStatus: () => {
      log("=== STATUS DEBUG ===");
      log(`Valor salvo: ${localStorage.getItem(STORAGE_KEY)}`);
      log(`Chat clicado: ${chatButtonClicked}`);
      log(`URL: ${window.location.href}`);
      log(`Última varredura: ${new Date(lastSweepAt).toLocaleTimeString()}`);
    },
    forceSweep: () => scheduleQuickSweep("manual"),
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
    return !el.disabled && !el.getAttribute("aria-disabled");
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

    candidates.sort((a, b) => {
      const aMain = isInPreferredArea(a) ? 1 : 0;
      const bMain = isInPreferredArea(b) ? 1 : 0;
      if (aMain !== bMain) return bMain - aMain;
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
    clicked.add(btn);
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
      log("Clique disparado no botão do anúncio:", btn);
      chatButtonClicked = true;
      afterChatClicked();
      return true;
    } catch {
      try {
        btn.click();
        log("Clique via .click():", btn);
        chatButtonClicked = true;
        afterChatClicked();
        return true;
      } catch (e) {
        console.warn("[TM-OLX-Chat-Preciso] Falha ao clicar", e);
        return false;
      }
    }
  }

  function afterChatClicked() {
    // Para watchdog de abertura de chat
    clearWatchdog("chat open");
    // Após clicar no chat, inicia observação do botão "Fazer oferta"
    setTimeout(() => {
      startOfferObserver();
      startOfferPolling();
    }, 500);
  }

  function tryClick() {
    const btn = pickButton();
    if (!btn) return false;

    // Segurança extra: não clicar em header/topbar
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
    pollId = setInterval(tryClick, 600);
  }

  function stopPolling() {
    if (pollId) {
      clearInterval(pollId);
      pollId = null;
    }
  }

  // === "Fazer oferta" ===

  function findOfferButton() {
    const buttons = Array.from(
      document.querySelectorAll(
        "button.olx-core-button.olx-core-button--secondary.olx-core-button--small"
      )
    );
    for (const btn of buttons) {
      if (btn.textContent.trim().includes("Fazer oferta")) return btn;
    }
    const allButtons = Array.from(document.querySelectorAll("button"));
    for (const btn of allButtons) {
      if (
        btn.textContent.trim().includes("Fazer oferta") &&
        isVisible(btn) &&
        isEnabled(btn)
      )
        return btn;
    }
    return null;
  }

  function clickOfferButton(btn) {
    if (!btn || offerClicked.has(btn)) return false;
    offerClicked.add(btn);
    try {
      btn.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    } catch {}
    try {
      ["mouseover", "mousedown", "mouseup", "click"].forEach((type) =>
        btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
      );
      log('Clique disparado no botão "Fazer oferta":', btn);
      stopOfferObserver();
      stopOfferPolling();
      setTimeout(() => startInputObserver(), 500);
      return true;
    } catch {
      try {
        btn.click();
        log('Clique via .click() no botão "Fazer oferta":', btn);
        stopOfferObserver();
        stopOfferPolling();
        setTimeout(() => startInputObserver(), 500);
        return true;
      } catch (e) {
        console.warn('[TM-OLX-Chat-Preciso] Falha ao clicar em "Fazer oferta"', e);
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
    chatObserver.observe(document.documentElement, { childList: true, subtree: true });
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
    offerPollId = setInterval(tryClickOffer, 400);
    log("Polling do botão 'Fazer oferta' iniciado");
  }

  function stopOfferPolling() {
    if (offerPollId) {
      clearInterval(offerPollId);
      offerPollId = null;
      log("Polling do botão 'Fazer oferta' parado");
    }
  }

  // === Salvar/restaurar valor do input de oferta ===

  function findOfferInput() {
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
      input.focus();
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      nativeInputValueSetter.call(input, savedValue);
      input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
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
    if (input.hasAttribute("data-olx-monitored")) {
      log("Input já está sendo monitorado");
      return true;
    }
    input.setAttribute("data-olx-monitored", "true");
    log("Input de oferta encontrado, configurando...");

    setTimeout(() => {
      restoreOfferValue(input);
    }, 300);

    const saveOnChange = (e) => {
      const value = e.target.value;
      log(`Valor alterado detectado: ${value}`);
      if (value && value !== "R$ 0,00" && value.trim() !== "") {
        saveOfferValue(value);
        lastOfferValue = value;
      }
    };

    input.addEventListener("change", saveOnChange);
    input.addEventListener("blur", saveOnChange);
    let saveTimeout;
    input.addEventListener("input", (e) => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        const value = e.target.value;
        if (value && value !== "R$ 0,00" && value.trim() !== "") {
          saveOfferValue(value);
          lastOfferValue = value;
        }
      }, 1000);
    });

    log("Monitoramento do input de oferta configurado");
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
    const maxAttempts = 20;

    if (trySetupInput()) {
      log("Input encontrado e configurado imediatamente!");
      return;
    }

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

    inputObserver = new MutationObserver(() => {
      const input = findOfferInput();
      if (input && !input.hasAttribute("data-olx-monitored")) {
        setupInputMonitoring();
        if (inputPollInterval) {
          clearInterval(inputPollInterval);
          inputPollInterval = null;
          log("Input encontrado via observer, polling parado");
        }
      }
    });
    inputObserver.observe(document.documentElement, { childList: true, subtree: true });
    log("Observador do input de oferta iniciado");
  }

  // === Detectar "Enviar oferta" e preencher mensagem ===

  function findSendOfferButton() {
    const buttons = Array.from(
      document.querySelectorAll(
        "button.olx-core-button.olx-core-button--primary.olx-core-button--medium"
      )
    );
    for (const btn of buttons) {
      if (btn.textContent.trim().includes("Enviar oferta")) return btn;
    }
    const allButtons = Array.from(document.querySelectorAll("button"));
    for (const btn of allButtons) {
      if (
        btn.textContent.trim().includes("Enviar oferta") &&
        isVisible(btn) &&
        isEnabled(btn)
      )
        return btn;
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
    // 1) via path do SVG conhecido
    const paths = Array.from(document.querySelectorAll('path[fill-rule="evenodd"]'));
    for (const path of paths) {
      const d = path.getAttribute("d");
      if (d && d.includes("M2.04229758,14.0134155")) {
        const button = path.closest("button");
        if (button && isVisible(button) && isEnabled(button)) {
          log("Botão de enviar mensagem encontrado via SVG path");
          return button;
        }
      }
    }
    // 2) fallback por proximidade ao textarea
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

  function fillMessage(textarea, offerValue) {
    if (!textarea) return false;

    const message = `Olá, tudo bem? Acabei de enviar uma oferta no valor de ${offerValue}. Sei que é um pouco abaixo do que você está pedindo, mas tenho real interesse na compra. Trabalho com revenda local aqui na minha cidade e pretendo adquirir o produto para revenda. Caso aceite, realizo o pagamento imediatamente para concretizarmos o negócio. Se não for possível, tudo bem, desejo ótimas vendas!`;

    try {
      textarea.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      setter.call(textarea, message);
      textarea.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      log(`✅ Mensagem preenchida com sucesso!`);
      log(`📝 Valor da oferta usado: ${offerValue}`);
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
      sendBtn.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    } catch {}
    try {
      ["mouseover", "mousedown", "mouseup", "click"].forEach((type) =>
        sendBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
      );
      log("✅ Clique disparado no botão de enviar mensagem!");
      return true;
    } catch {
      try {
        sendBtn.click();
        log("✅ Clique via .click() no botão de enviar mensagem!");
        return true;
      } catch (e) {
        console.warn("[TM-OLX-Chat-Preciso] Falha ao clicar em enviar mensagem", e);
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

    const handleSendClick = () => {
      log('🎯 Botão "Enviar oferta" foi clicado!');
      const offerInput = findOfferInput();
      const currentValue = offerInput ? offerInput.value : lastOfferValue || loadOfferValue();
      if (currentValue) {
        lastOfferValue = currentValue;
        log(`💰 Valor capturado da oferta: ${currentValue}`);
      }
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
    setupSendOfferMonitoring();
    messageObserver = new MutationObserver(() => {
      setupSendOfferMonitoring();
    });
    messageObserver.observe(document.documentElement, { childList: true, subtree: true });
    log("Observador do botão 'Enviar oferta' iniciado");
  }

  // === NOVO: Varredura quando a aba fica ativa ===

  function scheduleQuickSweep(reason = "unknown") {
    const now = Date.now();
    if (now - lastSweepAt < SWEEP_DEBOUNCE_MS) return;
    lastSweepAt = now;

    if (sweepTimeout) clearTimeout(sweepTimeout);
    sweepTimeout = setTimeout(() => {
      log(`🔎 Varredura rápida (${reason})`);
      // tenta clicar no chat, no botão de oferta e configurar input
      const okChat = tryClick();
      const okOffer = tryClickOffer();
      trySetupInput();
      // Se ainda não abrimos o chat, arma um watchdog para re-tentar
      if (!chatButtonClicked) armWatchdog("await chat");
      else clearWatchdog("chat already open");
    }, 60);
  }

  function armWatchdog(context) {
    clearWatchdog();
    watchdogTimeout = setTimeout(() => {
      log(`⏰ Watchdog re-tentando (${context})`);
      scheduleQuickSweep("watchdog");
    }, WATCHDOG_DELAY_MS);
  }

  function clearWatchdog(msg) {
    if (watchdogTimeout) {
      clearTimeout(watchdogTimeout);
      watchdogTimeout = null;
      if (msg) log(`🛑 Watchdog cancelado: ${msg}`);
    }
  }

  function hookTabActivation() {
    // quando a aba volta a ficar visível
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        scheduleQuickSweep("visibilitychange->visible");
      }
    });

    // quando a janela ganha foco
    window.addEventListener("focus", () => {
      scheduleQuickSweep("window focus");
    });

    // quando a página é mostrada (ex.: back/forward cache)
    window.addEventListener("pageshow", (e) => {
      if (e.persisted || document.visibilityState === "visible") {
        scheduleQuickSweep("pageshow");
      }
    });

    // segurança: se a aba estava sem foco por muito tempo e volta
    let blurAt = 0;
    window.addEventListener("blur", () => {
      blurAt = Date.now();
    });
    window.addEventListener("focus", () => {
      if (blurAt && Date.now() - blurAt > 1500) {
        scheduleQuickSweep("refocus-after-idle");
      }
      blurAt = 0;
    });
  }

  // === Navegação SPA ===

  function hookSPA() {
    const _push = history.pushState;
    const _replace = history.replaceState;
    const trigger = () => setTimeout(() => scheduleQuickSweep("spa-nav"), 0);
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

    const savedValue = localStorage.getItem(STORAGE_KEY);
    if (savedValue) log(`💾 Valor encontrado no localStorage: ${savedValue}`);
    else log("💾 Nenhum valor salvo encontrado");

    hookSPA();
    hookTabActivation(); // <=== NOVO

    // Tenta configurar input imediatamente caso já esteja visível
    setTimeout(() => {
      trySetupInput();
      startInputObserver();
    }, 1000);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        startObserver();
        startPolling();
        tryClick();
        armWatchdog("domcontentloaded");
      });
    } else {
      startObserver();
      startPolling();
      tryClick();
      armWatchdog("immediate");
    }
    window.addEventListener("load", () => scheduleQuickSweep("window load"));
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();

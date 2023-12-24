// ==UserScript==
// @name         Copiador de Código de Rastreio do AliExpress
// @namespace    https://sua.namespace.com
// @version      1.0
// @description  Descrição do Seu Script
// @match        https://www.aliexpress.com/p/order/index.html*
// @grant        none
// ==/UserScript==

// Aguarda o evento "window.onload" para garantir que a página carregue completamente
window.onload = function() {
    console.log('Página carregada completamente. Executando buceta?');
// Encontre todos os elementos <span>
// Encontre todos os elementos <span>
var elementosSpan = document.querySelectorAll('span');

// Crie um conjunto para armazenar códigos de rastreamento únicos
var codigosRastreamentoUnicos = new Set();

// Variável para armazenar os códigos de rastreamento
var listaCodigosRastreamento = '';

// Função para simular o posicionamento do mouse e aguardar antes de buscar o código de rastreamento
function simularMouseEObterRastreamento(elementoSpan) {
  // Crie um evento de mouseover (posicionamento do mouse)
  var eventoMouseOver = new MouseEvent('mouseover', {
    bubbles: true,
    cancelable: true,
    view: window
  });

  // Dispare o evento de mouseover no elemento <span>
  elementoSpan.dispatchEvent(eventoMouseOver);

  // Espere 4 segundos antes de procurar o elemento de rastreamento
  setTimeout(function() {
    // Encontre todos os elementos <p> com a classe "tracking-number-title"
    var elementosParagrafo = document.querySelectorAll('p.tracking-number-title');

    // Itere por todos os elementos de rastreamento
    for (var i = 0; i < elementosParagrafo.length; i++) {
      // Obtenha o texto do elemento <span> dentro do parágrafo
      var numeroRastreamento = elementosParagrafo[i].querySelector('span').textContent.trim();

      // Verifique se o código de rastreamento não está no conjunto de códigos únicos
      if (!codigosRastreamentoUnicos.has(numeroRastreamento)) {
        // Registre o número de Rastreamento no log
        console.log("Número de Rastreamento:", numeroRastreamento);

        // Adicione o código de rastreamento ao conjunto de códigos únicos
        codigosRastreamentoUnicos.add(numeroRastreamento);

        // Adicione o código de rastreamento à lista
        listaCodigosRastreamento += numeroRastreamento + '\n';
      }
    }

console.log('Quantidade de pacotes:', codigosRastreamentoUnicos.size);

    // Copie a lista de códigos de rastreamento para a área de transferência
    copiarParaAreaDeTransferencia(listaCodigosRastreamento);
  }, 4000); // Espere 4 segundos antes de buscar o código de rastreamento
}

// Função para copiar texto para a área de transferência
function copiarParaAreaDeTransferencia(texto) {
  var elementoTextArea = document.createElement('textarea');
  elementoTextArea.value = texto;
  document.body.appendChild(elementoTextArea);
  elementoTextArea.select();
  document.execCommand('copy');
  document.body.removeChild(elementoTextArea);
}

// Itere por todos os elementos <span> com texto "Acompanhar Pedido"
for (var i = 0; i < elementosSpan.length; i++) {
  if (elementosSpan[i].textContent === 'Acompanhar Pedido') {
    // Chame a função para simular o mouse e obter o rastreamento para o elemento atual
    simularMouseEObterRastreamento(elementosSpan[i]);
  }
}

    // Função para copiar todos os códigos de rastreamento para a área de transferência
// Função para copiar todos os códigos de rastreamento para a área de transferência
function copiarTodosParaAreaDeTransferencia() {
  copiarParaAreaDeTransferencia(listaCodigosRastreamento);
  alert("Todos os códigos de rastreamento foram copiados para a área de transferência!");
}

// Crie um botão para copiar todos os códigos de rastreamento
var botaoCopiarTodos = document.createElement("button");
botaoCopiarTodos.textContent = "Copiar Todos os Códigos de Rastreamento";
botaoCopiarTodos.addEventListener("click", copiarTodosParaAreaDeTransferencia);

// Adicione o botão no início do corpo do documento
document.body.prepend(botaoCopiarTodos);
}

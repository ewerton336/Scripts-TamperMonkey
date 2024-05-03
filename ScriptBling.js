// ==UserScript==
// @name         Editor de Vendas bling
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Editor de produto para o bling, com remoção de valores de descontos e taxa de frete
// @author       Ewerton Guimarães
// @match        https://www.bling.com.br/b/vendas.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bling.com.br
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Função para manipular a página
function manipulatePage() {
    console.log("Página com conteúdo após #edit carregada ou ativada!");

    var freteInput = document.getElementById("frete");
    freteInput.value = "0.00";

    var descontoInput = document.getElementById("desconto");
    descontoInput.value = "0.00";

    var produtoInput = document.getElementById("produto_descricao_0");

    if (produtoInput !== null) {
        // Execute o código de manipulação
        console.log("Elemento encontrado!");

        // Simula um clique no campo de entrada
        produtoInput.click();

        // Define o valor para "13666"
        produtoInput.value = "13666";

        // Simula um evento de entrada de teclado
        var inputEvent = new Event('input', { bubbles: true });
        produtoInput.dispatchEvent(inputEvent);

        // Simula a pressão da tecla Enter
        simulateEnterKeyPress(produtoInput);

        // Simula um evento de foco
        produtoInput.focus();
    }
}

function simulateEnterKeyPress(element) {
    var events = ['keydown', 'keypress', 'keyup'];
    for (var i = 0; i < events.length; i++) {
        var event = new KeyboardEvent(events[i], {
            'key': 'Enter',
            'code': 'Enter',
            'keyCode': 13,
            'which': 13,
            'bubbles': true,
            'composed': true,
            'cancelable': true
        });
        element.dispatchEvent(event);
    }
}


    // Função para verificar a visibilidade da aba e executar a manipulação
    function checkVisibilityAndManipulate() {
        if (document.visibilityState === 'visible') {
            manipulatePage();
        }
    }

    // Função para aguardar a disponibilidade do elemento
    function waitForElementToLoad() {
        var produtoInput = document.getElementById("produto_descricao_0");
        if (produtoInput !== null) {
            manipulatePage();
        } else {
            setTimeout(waitForElementToLoad, 100); // Tente novamente após 100 milissegundos
        }
    }

    // Verifica quando a página é carregada completamente
    window.addEventListener('load', function() {
        waitForElementToLoad();
    });

    // Verifica quando a visibilidade da aba muda
    document.addEventListener('visibilitychange', checkVisibilityAndManipulate);
})();

// Testa a lógica PURA da guarda que impede a suíte de teste de rodar fora de
// localhost (tools/tests.html grava/apaga dados de verdade no banco
// `financas`, e a página é servida pela mesma origem de produção que o
// usuário usa). É a única forma de provar essa decisão: `location.hostname`
// é unforgeable num navegador de verdade, então não dá pra simular a origem
// de produção navegando de verdade — mas a decisão em si (que hostnames são
// permitidos) é lógica pura e testável.
//
// Isto NÃO substitui a verificação de que a guarda de fato interrompe o
// carregamento em tools/tests.html — essa parte foi conferida por leitura
// de código e por confirmar que a suíte roda normalmente em localhost (onde
// a guarda deixa passar).

import { describe, it, assertEqual } from './harness.js';
import { origemSeguraParaTestesDestrutivos } from './fixtures/origem-teste.js';

describe('origem-teste: guarda contra rodar testes destrutivos fora de localhost', () => {
  it('permite localhost e 127.0.0.1', () => {
    assertEqual(origemSeguraParaTestesDestrutivos('localhost'), true);
    assertEqual(origemSeguraParaTestesDestrutivos('127.0.0.1'), true);
  });

  it('bloqueia a origem real de produção (GitHub Pages) — é a mesma origem do app anterior', () => {
    assertEqual(origemSeguraParaTestesDestrutivos('renewsolutionsbr.github.io'), false);
  });

  it('bloqueia qualquer outro hostname, inclusive vazio/ausente e parecidos com localhost', () => {
    assertEqual(origemSeguraParaTestesDestrutivos('example.com'), false);
    assertEqual(origemSeguraParaTestesDestrutivos(''), false);
    assertEqual(origemSeguraParaTestesDestrutivos(undefined), false);
    // Comparação exata, não "contém" — 'localhost.evil.com' ou
    // 'notlocalhost' não podem passar por semelhança de string.
    assertEqual(origemSeguraParaTestesDestrutivos('localhost.evil.com'), false);
    assertEqual(origemSeguraParaTestesDestrutivos('notlocalhost'), false);
  });
});

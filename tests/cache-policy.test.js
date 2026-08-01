import { describe, it, assert, assertDeepEqual } from './harness.js';
import { respostaCacheavel, cachesParaApagar } from '../src/core/cache-policy.js';

describe('cache-policy', () => {
  it('aceita resposta de sucesso da propria origem', () => {
    assert(respostaCacheavel({ ok: true, type: 'basic', status: 200 }) === true);
  });

  // O bug real que essa regra existe pra evitar: um 503 transitorio gravado
  // por cima do precache bom envenena o cache ate a proxima troca de versao.
  it('rejeita erro de servidor (503) para nao envenenar o cache', () => {
    assert(respostaCacheavel({ ok: false, type: 'basic', status: 503 }) === false);
  });

  it('rejeita 404, por exemplo de um deploy incompleto', () => {
    assert(respostaCacheavel({ ok: false, type: 'basic', status: 404 }) === false);
  });

  it('rejeita resposta opaca (cross-origin no-cors), que nao expoe status real', () => {
    assert(respostaCacheavel({ ok: false, type: 'opaque', status: 0 }) === false);
  });

  it('rejeita quando nao ha resposta', () => {
    assert(respostaCacheavel(null) === false);
    assert(respostaCacheavel(undefined) === false);
  });
});

// caches.keys() é por ORIGEM, não por escopo de service worker: no GitHub
// Pages, este app e o app anterior (cartão de crédito) vivem na mesma origem,
// em caminhos diferentes. Um activate ingênuo que apaga "tudo que não é o
// cache atual" apagaria também o cache offline do app anterior.
describe('cache-policy: cachesParaApagar (limpeza do activate do service worker)', () => {
  it('mantem so os caches do prefixo deste app, exceto o atual', () => {
    const chaves = ['financas-v1', 'financas-v2', 'outro-app-v1', 'livro-de-gastos-v3'];
    assertDeepEqual(cachesParaApagar(chaves, 'financas-v2', 'financas-'), ['financas-v1']);
  });

  it('nao toca em cache de outro app na mesma origem', () => {
    const chaves = ['outro-app-v1', 'outro-app-v2'];
    assertDeepEqual(cachesParaApagar(chaves, 'financas-v2', 'financas-'), []);
  });

  it('lista vazia quando so existe o cache atual', () => {
    assertDeepEqual(cachesParaApagar(['financas-v2'], 'financas-v2', 'financas-'), []);
  });

  it('trata entrada nula/indefinida como lista vazia', () => {
    assertDeepEqual(cachesParaApagar(null, 'financas-v2', 'financas-'), []);
    assertDeepEqual(cachesParaApagar(undefined, 'financas-v2', 'financas-'), []);
  });
});

import { describe, it, assert } from './harness.js';
import { respostaCacheavel } from '../src/core/cache-policy.js';

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

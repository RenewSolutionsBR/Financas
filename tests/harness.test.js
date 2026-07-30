import { describe, it, assert, assertEqual, assertDeepEqual, assertThrows } from './harness.js';

describe('harness', () => {
  it('assertEqual aceita valores iguais', () => {
    assertEqual(2 + 2, 4);
  });

  it('assertEqual rejeita valores diferentes', () => {
    assertThrows(() => assertEqual(1, 2));
  });

  it('assertDeepEqual compara estruturas aninhadas', () => {
    assertDeepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] });
    assertThrows(() => assertDeepEqual({ a: 1 }, { a: 2 }));
  });

  it('assert falha com mensagem própria', () => {
    try {
      assert(false, 'mensagem esperada');
      throw new Error('deveria ter lançado');
    } catch (e) {
      assertEqual(e.message, 'mensagem esperada');
    }
  });
});

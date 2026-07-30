import { describe, it, assertEqual } from './harness.js';
import { normalizeDescricao, escapeHtml } from '../src/core/text.js';

describe('text', () => {
  it('normaliza descrição sem alterar acentos', () => {
    assertEqual(normalizeDescricao('  padaria   do   joão '), 'PADARIA DO JOÃO');
    assertEqual(normalizeDescricao('MERCADO'), 'MERCADO');
    assertEqual(normalizeDescricao(null), '');
  });

  it('escapa HTML', () => {
    assertEqual(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assertEqual(escapeHtml('a & b'), 'a &amp; b');
    assertEqual(escapeHtml('aspas " e \''), 'aspas &quot; e &#39;');
  });

  it('normalizeDescricao colapsa tabulacao e quebra de linha', () => {
    assertEqual(normalizeDescricao('cafe\tcom\nleite'), 'CAFE COM LEITE');
  });

  it('escapeHtml escapa o E comercial antes dos sinais de menor e maior', () => {
    // Na ordem errada, "<" viraria "&lt;" e o "&" seria reescapado depois,
    // produzindo "&amp;lt;".
    assertEqual(escapeHtml('&amp;'), '&amp;amp;');
    assertEqual(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  });
});

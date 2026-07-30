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
});

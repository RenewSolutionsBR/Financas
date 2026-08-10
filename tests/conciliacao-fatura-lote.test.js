import { describe, it, assertEqual } from './harness.js';
import { formaCreditoParaCartao } from '../src/ui/conciliacao-fatura.js';

describe('conciliacao-fatura: formaCreditoParaCartao', () => {
  const formaCreditoA = { id: 'pm1', tipo: 'credito', ativo: true, contaPadraoId: 'cartaoA' };
  const formaCreditoB = { id: 'pm2', tipo: 'credito', ativo: true, contaPadraoId: 'cartaoB' };
  const formaCreditoSemPadrao = { id: 'pm3', tipo: 'credito', ativo: true };
  const formaDebito = { id: 'pm4', tipo: 'debito', ativo: true };
  const formaCreditoInativa = { id: 'pm5', tipo: 'credito', ativo: false, contaPadraoId: 'cartaoA' };

  it('prioriza a forma cuja conta padrao e exatamente o cartao da fatura', () => {
    const r = formaCreditoParaCartao('cartaoB', [formaCreditoA, formaCreditoB, formaDebito]);
    assertEqual(r.id, 'pm2');
  });

  it('sem forma com conta padrao batendo, cai na primeira forma de credito ativa', () => {
    const r = formaCreditoParaCartao('cartaoZ', [formaDebito, formaCreditoSemPadrao]);
    assertEqual(r.id, 'pm3');
  });

  it('ignora forma de credito desativada', () => {
    const r = formaCreditoParaCartao('cartaoA', [formaCreditoInativa, formaCreditoSemPadrao]);
    assertEqual(r.id, 'pm3');
  });

  it('sem nenhuma forma de credito ativa, devolve null', () => {
    const r = formaCreditoParaCartao('cartaoA', [formaDebito, formaCreditoInativa]);
    assertEqual(r, null);
  });
});

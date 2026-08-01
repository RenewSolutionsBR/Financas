import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  canonicalizar, aplicarRegra, aprenderRegra, candidatosRetroativos, novaRegra,
} from '../src/domain/classification.js';
import { CATEGORIA_A_CLASSIFICAR } from '../src/domain/categories.js';

describe('classification: canonicalizar', () => {
  it('extrato com tipo e contraparte: a contraparte vira a chave', () => {
    // Espaçamento duplo é o separador real do extrato Santander (ver 6.3).
    assertEqual(canonicalizar('PIX ENVIADO   Fulano de Tal', 'extrato'), 'FULANO DE TAL');
  });

  it('extrato sem contraparte (sem espaço duplo): o proprio tipo vira a chave', () => {
    assertEqual(canonicalizar('TARIFA MANUTENCAO CONTA', 'extrato'), 'TARIFA MANUTENCAO CONTA');
  });

  it('fatura nao separa tipo/contraparte — o texto inteiro e a chave', () => {
    // Sem isso, uma descricao de fatura com espaco duplo por acaso teria só
    // metade do nome do estabelecimento usada pra casar regra.
    assertEqual(canonicalizar('SUPERMERCADO  BOM PRECO LTDA', 'fatura'), 'SUPERMERCADO BOM PRECO LTDA');
  });

  it('maiusculas e remove acentos', () => {
    assertEqual(canonicalizar('Padaria São José', 'fatura'), 'PADARIA SAO JOSE');
  });

  it('colapsa espacos multiplos depois de tirar tipo/contraparte', () => {
    assertEqual(canonicalizar('Loja   Exemplo    Ltda', 'fatura'), 'LOJA EXEMPLO LTDA');
  });

  it('remove sufixo de parcela NN/NN', () => {
    assertEqual(canonicalizar('LOJA EXEMPLO 03/12', 'fatura'), 'LOJA EXEMPLO');
  });

  it('remove prefixo de adquirente PAG*, MP* e PAGSEGURO*', () => {
    assertEqual(canonicalizar('PAG*LOJAEXEMPLO', 'fatura'), 'LOJAEXEMPLO');
    assertEqual(canonicalizar('MP*LOJAEXEMPLO', 'fatura'), 'LOJAEXEMPLO');
    assertEqual(canonicalizar('PAGSEGURO*LOJAEXEMPLO', 'fatura'), 'LOJAEXEMPLO');
  });

  it('PAGSEGURO* nao e cortado pela metade pelo prefixo mais curto PAG*', () => {
    // Prova que a ordem das alternativas no regex importa: se "PAG" fosse
    // tentado antes de "PAGSEGURO", sobraria "SEGURO*LOJAEXEMPLO".
    assertEqual(canonicalizar('PAGSEGURO*OUTRALOJA', 'fatura'), 'OUTRALOJA');
  });

  it('remove sequencia de 6+ digitos (numero de documento/NSU)', () => {
    assertEqual(canonicalizar('COMPRA LOJA 123456789', 'fatura'), 'COMPRA LOJA');
  });

  it('sequencia de 5 digitos NAO e removida (nao e documento/NSU)', () => {
    // Prova que o limiar e >= 6, nao "qualquer numero": um CEP ou codigo de
    // loja de 5 digitos faz parte legitima do nome.
    assertEqual(canonicalizar('LOJA 12345', 'fatura'), 'LOJA 12345');
  });

  it('remove sufixo de UF quando reconhecivel', () => {
    assertEqual(canonicalizar('LOJA EXEMPLO SP', 'fatura'), 'LOJA EXEMPLO');
  });

  it('token final que NAO e UF valida fica intacto', () => {
    // "BR" nao esta na lista de 27 UFs — prova que a remocao e por lista, nao
    // por "duas letras maiusculas no fim".
    assertEqual(canonicalizar('LOJA EXEMPLO BR', 'fatura'), 'LOJA EXEMPLO BR');
  });

  it('as seis etapas compoem em sequencia, no mesmo texto', () => {
    assertEqual(
      canonicalizar('PIX ENVIADO   PAG*Padaria São José 123456 02/06 SP', 'extrato'),
      'PADARIA SAO JOSE'
    );
  });

  it('entrada vazia ou nula devolve string vazia, sem lancar', () => {
    assertEqual(canonicalizar('', 'fatura'), '');
    assertEqual(canonicalizar(null, 'fatura'), '');
    assertEqual(canonicalizar(undefined, 'extrato'), '');
  });
});

describe('classification: aplicarRegra (precedencia)', () => {
  const linha = { descricaoCanonica: 'PADARIA XYZ', contaId: 'acc_1', origem: 'extrato' };

  it('regra exata com contaId igual a da linha vence sobre qualquer outra', () => {
    const regras = [
      { id: 'r1', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'ambos', categoriaId: 'geral', ativa: true, acertos: 0 },
      { id: 'r2', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'extrato', contaId: 'acc_1', categoriaId: 'alimentacao', ativa: true, acertos: 0 },
    ];
    assertEqual(aplicarRegra(linha, regras).id, 'r2');
  });

  it('sem regra de contaId, exata com escopo igual a origem vence sobre escopo ambos', () => {
    const regras = [
      { id: 'r1', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'ambos', categoriaId: 'geral', ativa: true, acertos: 0 },
      { id: 'r2', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'extrato', categoriaId: 'alimentacao', ativa: true, acertos: 0 },
    ];
    assertEqual(aplicarRegra(linha, regras).id, 'r2');
  });

  it('exata vence sobre contem, contem vence sobre regex', () => {
    const regras = [
      { id: 'r_regex', padrao: 'PADARIA', tipoMatch: 'regex', escopo: 'ambos', categoriaId: 'x', ativa: true, acertos: 99 },
      { id: 'r_contem', padrao: 'XYZ', tipoMatch: 'contem', escopo: 'ambos', categoriaId: 'y', ativa: true, acertos: 0 },
      { id: 'r_exata', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'ambos', categoriaId: 'z', ativa: true, acertos: 0 },
    ];
    assertEqual(aplicarRegra(linha, regras).id, 'r_exata');
    assertEqual(aplicarRegra(linha, regras.filter((r) => r.id !== 'r_exata')).id, 'r_contem');
  });

  it('regra de escopo incompativel (fatura, numa linha de extrato) nunca casa', () => {
    const regras = [{ id: 'r1', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'fatura', categoriaId: 'x', ativa: true, acertos: 0 }];
    assertEqual(aplicarRegra(linha, regras), null);
  });

  it('regra inativa nunca casa, mesmo sendo a mais especifica', () => {
    const regras = [{ id: 'r1', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'extrato', contaId: 'acc_1', categoriaId: 'x', ativa: false, acertos: 0 }];
    assertEqual(aplicarRegra(linha, regras), null);
  });

  it('empate dentro do mesmo nivel de precedencia: vence a de mais acertos', () => {
    const regras = [
      { id: 'r_pouco', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'ambos', categoriaId: 'x', ativa: true, acertos: 2 },
      { id: 'r_muito', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'ambos', categoriaId: 'y', ativa: true, acertos: 40 },
    ];
    assertEqual(aplicarRegra(linha, regras).id, 'r_muito');
  });

  it('tipoMatch contem casa por substring da descricao canonica', () => {
    const regras = [{ id: 'r1', padrao: 'PADAR', tipoMatch: 'contem', escopo: 'ambos', categoriaId: 'x', ativa: true, acertos: 0 }];
    assertEqual(aplicarRegra(linha, regras).id, 'r1');
  });

  it('tipoMatch regex casa pelo padrao como expressao regular', () => {
    const regras = [{ id: 'r1', padrao: '^PADARIA \\w+$', tipoMatch: 'regex', escopo: 'ambos', categoriaId: 'x', ativa: true, acertos: 0 }];
    assertEqual(aplicarRegra(linha, regras).id, 'r1');
  });

  it('regex invalido nao lanca — so nao casa', () => {
    const regras = [{ id: 'r1', padrao: '(', tipoMatch: 'regex', escopo: 'ambos', categoriaId: 'x', ativa: true, acertos: 0 }];
    assertEqual(aplicarRegra(linha, regras), null);
  });

  it('nenhuma regra casando devolve null', () => {
    assertEqual(aplicarRegra(linha, []), null);
  });
});

describe('classification: aprenderRegra', () => {
  const dados = { descricaoCanonica: 'PADARIA XYZ', escopo: 'extrato', categoriaId: 'alimentacao', contaId: 'acc_1' };

  it('cria regra nova quando nao existe nenhuma com o mesmo padrao/escopo', () => {
    const regra = aprenderRegra(dados, []);
    assertEqual(regra.padrao, 'PADARIA XYZ');
    assertEqual(regra.escopo, 'extrato');
    assertEqual(regra.categoriaId, 'alimentacao');
    assertEqual(regra.tipoMatch, 'exato');
    assertEqual(regra.origem, 'aprendida');
    assertEqual(regra.acertos, 0);
    assert(regra.ativa, 'regra aprendida nasce ativa');
  });

  it('sobrescreve regra existente com categoria diferente e ZERA acertos — o usuario sempre vence a maquina', () => {
    const existente = { id: 'r1', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'extrato', categoriaId: 'outros', origem: 'aprendida', acertos: 50, ativa: true };
    const regra = aprenderRegra(dados, [existente]);
    assertEqual(regra.id, 'r1', 'sobrescreve a MESMA regra, nao cria uma segunda');
    assertEqual(regra.categoriaId, 'alimentacao');
    assertEqual(regra.acertos, 0, 'acertos zera quando a categoria muda — a confianca antiga nao vale mais');
  });

  it('mesma categoria de novo: mantem a regra e os acertos intactos (nao e uma correcao)', () => {
    const existente = { id: 'r1', padrao: 'PADARIA XYZ', tipoMatch: 'exato', escopo: 'extrato', categoriaId: 'alimentacao', origem: 'aprendida', acertos: 12, ativa: true };
    const regra = aprenderRegra(dados, [existente]);
    assertEqual(regra.acertos, 12);
  });
});

describe('classification: candidatosRetroativos', () => {
  it('so pega A_CLASSIFICAR com origemRef e mesma descricao canonica da regra', () => {
    const regra = { padrao: 'PADARIA XYZ', tipoMatch: 'exato' };
    const t1 = { id: 't1', categoria: CATEGORIA_A_CLASSIFICAR, origemRef: { statementId: 's1', linhaId: 'l1' } };
    const t2 = { id: 't2', categoria: CATEGORIA_A_CLASSIFICAR, origemRef: { statementId: 's1', linhaId: 'l2' } }; // descricao diferente
    const t3 = { id: 't3', categoria: 'alimentacao', origemRef: { statementId: 's1', linhaId: 'l3' } }; // ja classificado
    const t4 = { id: 't4', categoria: CATEGORIA_A_CLASSIFICAR, origemRef: null }; // lancamento manual, sem origem
    const mapa = new Map([['t1', 'PADARIA XYZ'], ['t2', 'OUTRA COISA'], ['t3', 'PADARIA XYZ'], ['t4', 'PADARIA XYZ']]);
    const resultado = candidatosRetroativos([t1, t2, t3, t4], regra, mapa);
    // assertEqual usa Object.is (igualdade por referencia): dois arrays
    // literais com o mesmo conteudo nunca sao Object.is-iguais, entao aqui
    // precisa ser assertDeepEqual (compara por valor), senao o teste falha
    // sempre, mesmo com a implementacao correta.
    assertDeepEqual(resultado.map((t) => t.id), ['t1']);
  });

  it('regra nao-exata (contem/regex) nunca reaplica retroativamente — risco de falso positivo em massa', () => {
    const regra = { padrao: 'PADAR', tipoMatch: 'contem' };
    const t1 = { id: 't1', categoria: CATEGORIA_A_CLASSIFICAR, origemRef: { statementId: 's1', linhaId: 'l1' } };
    const mapa = new Map([['t1', 'PADARIA XYZ']]);
    assertDeepEqual(candidatosRetroativos([t1], regra, mapa), []);
  });
});

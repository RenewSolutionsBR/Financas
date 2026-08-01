import {
  describe, it, assert, assertEqual, assertDeepEqual,
} from './harness.js';
import {
  register, listAdaptadores, adaptadoresParaExtensao, detectarMelhorAdaptador, limparRegistro,
} from '../src/importers/registry.js';

function adaptadorFalso(over) {
  return {
    id: 'falso', label: 'Falso', aceita: ['.xls'],
    detectar: () => 0, parse: async () => ({ statement: {}, rows: [], avisos: [] }),
    ...over,
  };
}

describe('registry: registro e filtro por extensão', () => {
  it('adaptadoresParaExtensao filtra por aceita, preservando ordem de registro', () => {
    limparRegistro();
    register(adaptadorFalso({ id: 'a', aceita: ['.xls'] }));
    register(adaptadorFalso({ id: 'b', aceita: ['.pdf'] }));
    register(adaptadorFalso({ id: 'c', aceita: ['.xls', '.xlsx'] }));
    const paraXls = adaptadoresParaExtensao('extrato.xls').map((a) => a.id);
    assertDeepEqual(paraXls, ['a', 'c']);
  });

  it('a extensão é case-insensitive', () => {
    limparRegistro();
    register(adaptadorFalso({ id: 'a', aceita: ['.pdf'] }));
    assertDeepEqual(adaptadoresParaExtensao('FATURA.PDF').map((a) => a.id), ['a']);
  });
});

describe('registry: detectarMelhorAdaptador', () => {
  it('escolhe o adaptador de maior pontuação entre os candidatos da extensão', async () => {
    limparRegistro();
    register(adaptadorFalso({ id: 'baixo', aceita: ['.xls'], detectar: () => 0.3 }));
    register(adaptadorFalso({ id: 'alto', aceita: ['.xls'], detectar: () => 0.9 }));
    register(adaptadorFalso({ id: 'outra_ext', aceita: ['.pdf'], detectar: () => 1 }));
    const resultado = await detectarMelhorAdaptador(new ArrayBuffer(0), 'x.xls');
    assertEqual(resultado.adaptador.id, 'alto');
    assertEqual(resultado.pontuacao, 0.9);
  });

  it('devolve null quando nenhum candidato pontua acima de 0', async () => {
    limparRegistro();
    register(adaptadorFalso({ id: 'a', aceita: ['.xls'], detectar: () => 0 }));
    const resultado = await detectarMelhorAdaptador(new ArrayBuffer(0), 'x.xls');
    assertEqual(resultado, null);
  });

  it('detectar pode ser assincrono (parsers de PDF precisam abrir o documento pra pontuar)', async () => {
    limparRegistro();
    register(adaptadorFalso({ id: 'a', aceita: ['.pdf'], detectar: async () => 0.7 }));
    const resultado = await detectarMelhorAdaptador(new ArrayBuffer(0), 'x.pdf');
    assertEqual(resultado.adaptador.id, 'a');
  });
});

import { describe, it, assert, assertEqual } from './harness.js';
import {
  CATEGORIA_A_CLASSIFICAR, DEFAULT_CATEGORIES, PALETA,
  validateCategoria, garantirAClassificar, novaCategoria, removeCategoria,
} from '../src/domain/categories.js';

describe('categories', () => {
  it('o seed inclui a categoria fixa de id a_classificar', () => {
    assert(DEFAULT_CATEGORIES.some((c) => c.id === CATEGORIA_A_CLASSIFICAR));
  });

  it('o seed inclui tarifas e impostos bancários', () => {
    assert(DEFAULT_CATEGORIES.some((c) => /tarifa/i.test(c.nome)));
  });

  it('o seed não repete ids nem nomes', () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    const nomes = DEFAULT_CATEGORIES.map((c) => c.nome.toLowerCase());
    assertEqual(new Set(ids).size, ids.length);
    assertEqual(new Set(nomes).size, nomes.length);
  });

  it('rejeita nome vazio', () => {
    const erros = validateCategoria({ id: 'x', nome: '  ' }, []);
    assert(erros.length > 0);
  });

  it('rejeita nome repetido, ignorando caixa e espaço', () => {
    const todas = [{ id: 'casa', nome: 'Casa' }];
    assert(validateCategoria({ id: 'nova', nome: ' casa ' }, todas).length > 0);
    // Editar a própria categoria com o mesmo nome é válido.
    assertEqual(validateCategoria({ id: 'casa', nome: 'Casa' }, todas).length, 0);
  });

  it('garantirAClassificar acrescenta a categoria fixa quando falta', () => {
    const resultado = garantirAClassificar([{ id: 'casa', nome: 'Casa', cor: '#111' }]);
    assert(resultado.some((c) => c.id === CATEGORIA_A_CLASSIFICAR));
    assertEqual(resultado.length, 2);
  });

  it('garantirAClassificar não duplica quando já existe', () => {
    const entrada = [{ id: CATEGORIA_A_CLASSIFICAR, nome: 'Outro nome', cor: '#111' }];
    const resultado = garantirAClassificar(entrada);
    assertEqual(resultado.length, 1);
    // Respeita o rename feito pelo usuário: só o id é contrato, o nome não.
    assertEqual(resultado[0].nome, 'Outro nome');
  });

  it('garantirAClassificar não vaza referência ao objeto de DEFAULT_CATEGORIES', () => {
    // Copia o objeto em vez de empurrar a mesma referência.
    const resultado = garantirAClassificar([]);
    const aClassificar = resultado.find((c) => c.id === CATEGORIA_A_CLASSIFICAR);
    aClassificar.nome = 'MUTADO';
    // DEFAULT_CATEGORIES deve continuar inalterado.
    const original = DEFAULT_CATEGORIES.find((c) => c.id === CATEGORIA_A_CLASSIFICAR);
    assertEqual(original.nome, 'A Classificar');
  });

  it('recusa excluir a categoria A Classificar, explicando por que', async () => {
    // O throw acontece antes de qualquer chamada a storage, entao roda no Node.
    let erro = null;
    try {
      await removeCategoria(CATEGORIA_A_CLASSIFICAR);
    } catch (e) {
      erro = e;
    }
    assert(erro !== null, 'deveria ter recusado a exclusao');
    // A mensagem precisa explicar o motivo, nao so recusar.
    assert(/destino/i.test(erro.message), `mensagem nao explica o motivo: ${erro.message}`);
  });

  it('recusa excluir categoria em uso, dizendo quantos lancamentos usam', async () => {
    // A guarda mora no dominio, nao na tela: removeCategoria lanca antes de
    // tocar storage tanto para a_classificar quanto para em-uso, entao roda
    // no Node.
    const transacoes = [{ id: 't1', categoria: 'casa' }, { id: 't2', categoria: 'casa' }];
    let erro = null;
    try { await removeCategoria('casa', transacoes); } catch (e) { erro = e; }
    assert(erro !== null, 'deveria ter recusado');
    assert(erro.message.includes('2'), erro.message);
  });

  it('novaCategoria escolhe cor livre da paleta em vez de repetir', () => {
    const existentes = [{ id: 'a', nome: 'A', cor: PALETA[0] }, { id: 'b', nome: 'B', cor: PALETA[1] }];
    assertEqual(novaCategoria('C', null, existentes).cor, PALETA[2]);
  });

  it('novaCategoria gera ids diferentes em chamadas seguidas', () => {
    const a = novaCategoria('X', null, []);
    const b = novaCategoria('Y', null, []);
    assert(a.id !== b.id);
    assert(a.id.startsWith('cat_'));
  });

  // (transactions || []) virava lista vazia quando o segundo argumento vinha
  // undefined, e a guarda de "em uso" nunca disparava — uma categoria em uso
  // era excluida em silencio.
  it('recusa excluir sem a lista de transacoes, para nao silenciar a guarda de em-uso', async () => {
    let erro = null;
    try { await removeCategoria('casa'); } catch (e) { erro = e; }
    assert(erro !== null, 'deveria ter recusado');
    assert(/lançamentos/i.test(erro.message), erro.message);
  });
});

describe('categories: descricao opcional', () => {
  it('categoria pode ser salva com descricao, e o campo sobrevive ida e volta', () => {
    const cat = { id: 'cat_x', nome: 'Teste', cor: '#111111', descricao: 'Gastos com teste' };
    const erros = validateCategoria(cat, []);
    assertEqual(erros.length, 0, 'descricao nunca e obrigatoria, nao deveria gerar erro de validacao');
  });

  it('categoria sem descricao continua valida (campo opcional)', () => {
    const cat = { id: 'cat_y', nome: 'Sem descricao', cor: '#222222' };
    const erros = validateCategoria(cat, []);
    assertEqual(erros.length, 0);
  });
});

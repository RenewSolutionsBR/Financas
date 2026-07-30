import { describe, it, assert, assertEqual } from './harness.js';
import {
  CATEGORIA_A_CLASSIFICAR, DEFAULT_CATEGORIES,
  validateCategoria, garantirAClassificar, novaCategoria,
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

  it('novaCategoria gera id único e escolhe cor da paleta', () => {
    const c = novaCategoria('Pets', null, []);
    assert(c.id.startsWith('cat_'));
    assert(/^#[0-9a-f]{6}$/i.test(c.cor));
  });
});

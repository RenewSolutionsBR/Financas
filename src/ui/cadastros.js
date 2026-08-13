// Aba Cadastros. Só monta a aba a partir das quatro seções (contas, formas,
// categorias, regras); cada seção coleta o próprio formulário e delega a
// validação para domain/ — nenhuma regra de negócio mora aqui.
//
// A seção "Backup" saiu daqui em v20: backup, exportações, diagnóstico e as
// ações de apagar vivem no menu "Ferramentas" do cabeçalho
// (src/ui/ferramentas.js). Cadastros voltou a ser só o que o nome diz —
// cadastrar contas, formas, categorias e regras.

import { secaoContas } from './cadastros-contas.js';
import { secaoFormas } from './cadastros-formas.js';
import { secaoCategorias } from './cadastros-categorias.js';
import { secaoRegras } from './cadastros-regras.js';

export async function renderCadastros() {
  const painel = document.getElementById('tabCadastros');
  painel.innerHTML = '';
  painel.append(
    await secaoContas(renderCadastros),
    await secaoFormas(renderCadastros),
    await secaoCategorias(renderCadastros),
    await secaoRegras(renderCadastros)
  );
}

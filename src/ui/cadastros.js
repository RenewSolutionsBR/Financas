// Aba Cadastros. Só monta a aba a partir das cinco seções (contas, formas,
// categorias, regras, backup); cada seção coleta o próprio formulário e
// delega a validação para domain/ — nenhuma regra de negócio mora aqui.

import { secaoContas } from './cadastros-contas.js';
import { secaoFormas } from './cadastros-formas.js';
import { secaoCategorias } from './cadastros-categorias.js';
import { secaoRegras } from './cadastros-regras.js';
import { secaoBackup } from './cadastros-backup.js';

export async function renderCadastros() {
  const painel = document.getElementById('tabCadastros');
  painel.innerHTML = '';
  painel.append(
    await secaoContas(renderCadastros),
    await secaoFormas(renderCadastros),
    await secaoCategorias(renderCadastros),
    await secaoRegras(renderCadastros),
    secaoBackup(renderCadastros)
  );
}

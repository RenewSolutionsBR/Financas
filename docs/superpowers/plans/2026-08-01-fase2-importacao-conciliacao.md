
# Fase 2 — Importação, Conciliação e Memória: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar fatura de cartão e extrato bancário, conciliar automaticamente com os lançamentos do usuário, aprender a classificar descrições recorrentes, e nunca contar o mesmo dinheiro duas vezes entre as duas fontes.

**Architecture:** Registro de adaptadores desacoplado (`importers/`) alimenta um formato de linha único; dois motores de conciliação (`reconcile-card.js`, `reconcile-bank.js`) casam essas linhas com `transactions` existentes; `classification.js` aprende com cada correção do usuário e classifica sozinho da próxima vez. Toda a lógica de casamento, janela e classificação é pura (sem DOM/IndexedDB) e testável em Node — a UI (`ui/conciliacao.js`) só orquestra.

**Tech Stack:** Vanilla JS ES modules · IndexedDB · SheetJS (`xlsx.full.min.js`, já vendorizado) · PDF.js (`pdf.min.mjs` + `pdf.worker.min.mjs`, a vendorizar nesta fase — ver Task 5).

**Spec:** `docs/superpowers/specs/2026-07-29-financas-multi-conta-design.md` — leia as seções 6 (contrato de importação), 7 (conciliação), 8 (memória de classificação), 9 (telas) e 10 (testes) antes de começar. A seção 2 (princípios preservados) e a nota no topo da seção 5.7 explicam por que esta fase **porta** lógica do app anterior em vez de reinventá-la — várias decisões abaixo (janela de 35 dias, `POOL_SLACK_DAYS = 3`, namespaces de id `seed_`/`confirmed_`) só existem porque já foram validadas com faturas reais de 09/2025 a 06/2026, e mudá-las sem necessidade reintroduziria bugs já resolvidos uma vez.

## Global Constraints

- **Zero build step, zero dependências em runtime.** PDF.js entra em `vendor/`, servido da mesma origem — mesma regra do SheetJS na Fase 1.
- **Repositório é PÚBLICO.** Nenhum dado pessoal em código, seed, teste ou fixture. Esta fase é a que mais lida com documentos financeiros reais (faturas, extratos) — leia a nota de privacidade em cada task que cria fixture antes de escrever uma linha.
- **Datas em ISO (`YYYY-MM-DD`) internamente.** Formatação `DD/MM/AAAA` só em `ui/`.
- **Valores monetários sempre positivos** em `transactions.valor` e nas linhas normalizadas (`rows[].valor`); o sentido vem de `natureza` (transações) ou `sinal` (linhas importadas: `'debito'` | `'credito'`).
- **Nenhum módulo pode tocar `indexedDB`, `document` ou `window` no momento da importação.** Só `core/storage.js` chama `indexedDB`, sempre dentro de função. `domain/reconcile-card.js`, `domain/reconcile-bank.js`, `domain/classification.js` e `domain/parcelas.js` são lógica pura — recebem os dados já carregados como argumento, nunca leem storage sozinhos. Isso é o que permite testá-los no Node.
- **Regras puras e persistência ficam separadas dentro do arquivo**, funções de persistência agrupadas ao final sob `// --- Persistência ---`. Nenhuma função pura chama `storage`.
- **Nenhum arquivo deve passar de ~250 linhas.** Os adaptadores de importação (Task 5, especialmente) tendem a crescer — divida por responsabilidade (ex.: extração de texto vs. parsing de linha vs. checksum) em módulos irmãos no mesmo diretório se precisar, nunca um arquivo único de 600 linhas.
- **Toda categoria é buscada por id (`CATEGORIA_A_CLASSIFICAR`), nunca por nome.**
- **Não reinvente o que já foi validado em produção.** As tasks 3, 5 e 8 portam algoritmos do app anterior (`Cartão de Credito/gastos-app/src/reconcile.js` e `pdf-parser.js`) com valores e regras exatos — eles estão colados nos passos, não resumidos. Se um valor no seu raciocínio divergir do que está colado no passo, o passo vence.
- **IDs determinísticos onde a idempotência depende disso.** Previsões de parcela usam o namespace `seed_...`, confirmações usam `confirmed_...`, e **nunca** o gerador aleatório `uid()` de `core/ids.js` — a mesma compra precisa sempre computar o mesmo id, senão reimportar uma fatura duplica em vez de atualizar. Isso é o oposto do padrão usado em `novaTransaction`/`novaConta` (que usam `uid()` de propósito, porque aqueles ids nunca precisam ser recomputados). O `id` de linha importada (`rows[].id`) é um hash estável de conta+data+valor+descrição+documento+ordinal, pelo mesmo motivo: reimportar um período sobreposto não pode duplicar.
- **Idioma:** identificadores em português para conceito de negócio, inglês para termo técnico consagrado. Comentários e UI em português.
- **Commits:** mensagem em português, imperativo, sem emoji. Rodapé `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Estrutura de arquivos desta fase

| Arquivo | Responsabilidade |
|---|---|
| `src/importers/registry.js` | contrato de adaptador, `register`/`detectar`/`parse` |
| `src/domain/classification.js` | canonicalização, regras de classificação, aprendizado |
| `src/domain/parcelas.js` | identidade de parcela, previsões, auto-confirmação, duplicidade |
| `src/importers/santander-cartao-pdf.js` | fatura Visa e Mastercard em PDF |
| `src/importers/santander-extrato-xls.js` | extrato de conta corrente `.xls` |
| `src/importers/generic-table.js` | CSV/XLS com mapeamento de colunas do usuário |
| `src/domain/reconcile-card.js` | conciliação de fatura |
| `src/domain/reconcile-bank.js` | conciliação de extrato, natureza automática |
| `src/ui/parcelas.js` | aba Parcelas |
| `src/ui/conciliacao.js` | aba Conciliação |
| `src/ui/cadastros-regras.js` | Cadastros → Regras de classificação |
| `vendor/pdf.min.mjs`, `vendor/pdf.worker.min.mjs` | PDF.js, copiado do app anterior |

Módulos já existentes que esta fase só **consome**, sem modificar a interface: `core/storage.js` (`getByIndex` já existe, usado por `by_contaId`/`by_tipo`/`by_padrao`/`by_parcelaKey`), `domain/accounts.js` (`plasticosDoTitular`, `contaPagadoraEfetiva`, `contaQueCasaDescricao`), `domain/categories.js` (`CATEGORIA_A_CLASSIFICAR`), `domain/transactions.js` (`novaTransaction`, `contaComoGasto`), `core/dates.js`, `core/money.js`, `core/ids.js` (`stableHash`), `ui/components.js`, `ui/cadastros-comuns.js`.

---

### Task 1: `importers/registry.js` — contrato de adaptador

Sem um contrato estável entre "arquivo do usuário" e "linha normalizada", nenhuma das tasks seguintes tem uma interface comum para desenvolver contra. Esta vem primeiro por isso — é puramente o formato, sem nenhum adaptador real ainda.

**Files:**
- Create: `src/importers/registry.js`
- Test: `tests/registry.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `register(adaptador)` — `adaptador = { id, label, aceita: string[], detectar(buffer) -> number 0..1, parse(buffer, opcoes) -> Promise<{ statement, rows, avisos }> }`
  - `listAdaptadores() -> adaptador[]`
  - `adaptadoresParaExtensao(nomeArquivo) -> adaptador[]` — filtra por `aceita`, mantendo a ordem de registro
  - `async detectarMelhorAdaptador(buffer, nomeArquivo) -> { adaptador, pontuacao } | null` — roda `detectar` em cada candidato de `adaptadoresParaExtensao`, devolve o de maior pontuação (ou `null` se nenhum candidato pontuar acima de 0)
  - `limparRegistro()` — só para teste, esvazia o registro entre suítes

O formato de linha normalizada (o que `parse` devolve em `rows[]`) é o contrato central da fase inteira — cole este comentário no topo do arquivo, ele documenta o que todo adaptador das Tasks 5-7 precisa produzir:

```js
// Formato de linha normalizada que TODO adaptador devolve em `rows[]`. A
// conciliação e a UI nunca sabem de qual banco ou tipo de documento a linha
// veio — só enxergam este formato.
//
// {
//   id,                 // hash estável: conta+data+valor+descricao+documento+ordinal
//                        // (ver core/ids.js stableHash). Torna a importação IDEMPOTENTE:
//                        // reimportar um período sobreposto não duplica linha nem lançamento.
//   data,                // ISO
//   valor,               // sempre positivo
//   sinal,               // 'debito' | 'credito'
//   descricao,           // texto original do documento
//   descricaoCanonica,   // canonicalizar(descricao, escopo) de domain/classification.js
//   documento,           // nº do documento, quando houver
//   tipoDetectado,       // prefixo classificador do extrato, quando houver
//   parcela_atual, parcela_total,  // só fatura, null nas demais
//   cartaoFinal,         // só fatura: final do plástico (titular ou adicional) de onde saiu
//   secao,               // só fatura: 'despesas' | 'pagamentos_creditos'
//   valorUSD,            // só fatura: coluna US$, quando != 0, senão null
//   saldo,               // só extrato, null na fatura
//   raw,                 // linha bruta, para depuração
// }
```

- [ ] **Step 1: Escrever os testes do registro**

Crie `tests/registry.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
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
```

- [ ] **Step 2: Implementar `registry.js`**

```js
// Registro de adaptadores de importação. Adicionar um banco/formato novo =
// um arquivo em importers/ mais uma chamada a register() — nunca precisa
// tocar em conciliação, domínio ou UI, porque todos consomem só o formato
// de linha normalizada (ver comentário no topo deste arquivo).

const adaptadores = [];

export function register(adaptador) {
  adaptadores.push(adaptador);
}

export function limparRegistro() {
  adaptadores.length = 0;
}

export function listAdaptadores() {
  return [...adaptadores];
}

export function adaptadoresParaExtensao(nomeArquivo) {
  const ext = ('.' + String(nomeArquivo || '').split('.').pop()).toLowerCase();
  return adaptadores.filter((a) => a.aceita.some((e) => e.toLowerCase() === ext));
}

export async function detectarMelhorAdaptador(buffer, nomeArquivo) {
  const candidatos = adaptadoresParaExtensao(nomeArquivo);
  let melhor = null;
  let melhorPontuacao = 0;
  for (const adaptador of candidatos) {
    const pontuacao = await adaptador.detectar(buffer);
    if (pontuacao > melhorPontuacao) { melhor = adaptador; melhorPontuacao = pontuacao; }
  }
  return melhor ? { adaptador: melhor, pontuacao: melhorPontuacao } : null;
}
```

- [ ] **Step 3: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: os 5 testes novos passam, nenhuma regressão nos existentes.

- [ ] **Step 4: Commit**

```bash
git add tests/registry.test.js src/importers/registry.js
git commit -m "Adiciona registro de adaptadores de importacao"
```

---

### Task 2: `domain/classification.js` — memória de classificação

Precisa existir antes dos adaptadores (Tasks 5-7), porque toda linha importada carrega `descricaoCanonica` calculada por este módulo — é o contrato da Task 1.

**Files:**
- Create: `src/domain/classification.js`
- Test: `tests/classification.test.js`

**Interfaces:**
- Consumes: `domain/categories.js` (`CATEGORIA_A_CLASSIFICAR`)
- Produces:
  - `canonicalizar(descricao, escopo) -> string`
  - `aplicarRegra(linha, regras) -> regra | null` — `linha = { descricaoCanonica, contaId, origem }`, `origem = 'fatura' | 'extrato'`
  - `aprenderRegra(dados, regras) -> regra` — `dados = { descricaoCanonica, escopo, categoriaId, contaId }`, devolve a regra nova ou a existente sobrescrita (não persiste sozinha — quem chama grava via `saveRegra`)
  - `candidatosRetroativos(transactions, regra, descricaoCanonicaPorTransacao) -> transaction[]`
  - `novaRegra(dados) -> regra`
  - `async listRegras() -> regra[]`
  - `async saveRegra(regra) -> void`
  - `async removeRegra(id) -> void`

- [ ] **Step 1: Escrever os testes de `canonicalizar`**

Crie `tests/classification.test.js`:

```js
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

  it('PAGSEGURO* e removido por inteiro, nao so o prefixo PAG*', () => {
    // O literal '\*' logo apos cada alternativa faz o motor retroceder e
    // achar "PAGSEGURO*" mesmo que "PAG" seja tentado primeiro — a ordem das
    // alternativas nao muda o resultado aqui (verificado). Este teste prova
    // que o prefixo INTEIRO some, nao que a ordem importe.
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
    assertDeepEqual(resultado.map((t) => t.id), ['t1']);
  });

  it('regra nao-exata (contem/regex) nunca reaplica retroativamente — risco de falso positivo em massa', () => {
    const regra = { padrao: 'PADAR', tipoMatch: 'contem' };
    const t1 = { id: 't1', categoria: CATEGORIA_A_CLASSIFICAR, origemRef: { statementId: 's1', linhaId: 'l1' } };
    const mapa = new Map([['t1', 'PADARIA XYZ']]);
    assertDeepEqual(candidatosRetroativos([t1], regra, mapa), []);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tools/run-tests.mjs`
Expected: FALHOU em todos os testes de `classification.test.js` — `canonicalizar is not a function` (o módulo ainda não existe).

- [ ] **Step 3: Implementar `classification.js`**

```js
// Memória de classificação: aprende a categoria (e opcionalmente forma de
// pagamento/natureza) de uma descrição recorrente a partir das correções do
// usuário, e aplica sozinha da próxima vez que a mesma descrição aparecer
// numa fatura ou extrato importado. Nunca opina sobre lançamento MANUAL — só
// atua no momento em que uma linha importada vira lançamento (spec 8.4).

import { uid } from '../core/ids.js';
import { CATEGORIA_A_CLASSIFICAR } from './categories.js';
import * as storage from '../core/storage.js';

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

// PAGSEGURO, PAG e MP: os três exigem o literal '\*' logo em seguida, então
// a ordem das alternativas NÃO importa aqui — se o motor casar "PAG" e o
// '\*' seguinte falhar (por vir "SEGURO" no meio), ele retrocede e tenta as
// outras alternativas na mesma posição até achar "PAGSEGURO*" inteiro.
// Verificado: 'PAGSEGURO|PAG|MP' e 'PAG|MP|PAGSEGURO' produzem o mesmo
// resultado para 'PAGSEGURO*...'. A ordem aqui é só legibilidade.
const PREFIXO_ADQUIRENTE_RE = /^(PAGSEGURO|PAG|MP)\*/;
const SUFIXO_PARCELA_RE = /\s*\d{2}\/\d{2}\s*$/;
const DOCUMENTO_RE = /\d{6,}/g;

export function canonicalizar(descricaoBruta, escopo) {
  let texto = String(descricaoBruta || '').trim();
  if (!texto) return '';

  // 1. Extrato: "TIPO␣␣CONTRAPARTE" (espaçamento duplo, ver 6.3) — a
  // contraparte é a chave; sem espaço duplo, o texto inteiro (o "tipo") vira
  // a chave. Fatura não separa: um espaço duplo ali é só formatação do PDF,
  // não um separador semântico, e cortar pela metade perderia nome de loja.
  if (escopo === 'extrato') {
    const partes = texto.split(/\s{2,}/).filter(Boolean);
    texto = partes.length > 1 ? partes[partes.length - 1] : partes[0] || texto;
  }

  // 2. Maiúsculas, sem acento, espaços colapsados. \p{Mn} (marca não
  // espaçadora) é o que a decomposição NFD produz para cada acento — mais
  // robusto que listar o intervalo Unicode de marcas combinantes na mão.
  texto = texto
    .toUpperCase()
    .normalize('NFD').replace(/\p{Mn}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 6. Sufixo de UF, quando o último token é uma sigla de estado válida —
  // por lista fechada de 27, não "duas letras maiúsculas no fim" (evitaria
  // cortar siglas legítimas de nome de loja, tipo "BR"). Executado ANTES da
  // etapa 3 (numeração da spec 8.1 preservada nos comentários, ordem de
  // EXECUÇÃO invertida entre as duas): quando a UF vem depois do número de
  // parcela ("... 02/06 SP"), a UF fica sobrando no fim da string e a etapa
  // 3 (ancorada em `$`) não alcança o "02/06" — sem inverter, "02/06"
  // sobrevivia à canonicalização inteira.
  const tokens = texto.split(' ');
  const ultimo = tokens[tokens.length - 1];
  if (tokens.length > 1 && UFS.includes(ultimo)) {
    texto = tokens.slice(0, -1).join(' ');
  }

  // 3. Sufixo de parcela NN/NN.
  texto = texto.replace(SUFIXO_PARCELA_RE, '').trim();

  // 4. Prefixo de adquirente.
  texto = texto.replace(PREFIXO_ADQUIRENTE_RE, '');

  // 5. Sequência de 6+ dígitos (documento/NSU) — um código de 5 dígitos ou
  // menos costuma ser parte legítima do nome (CEP curto, código de loja).
  texto = texto.replace(DOCUMENTO_RE, '').replace(/\s+/g, ' ').trim();

  return texto.trim();
}

function padraoCasa(regra, descricaoCanonica) {
  if (regra.tipoMatch === 'exato') return regra.padrao === descricaoCanonica;
  if (regra.tipoMatch === 'contem') return descricaoCanonica.includes(regra.padrao);
  if (regra.tipoMatch === 'regex') {
    try { return new RegExp(regra.padrao).test(descricaoCanonica); }
    catch (e) { return false; } // padrão inválido nunca casa, nunca derruba a conciliação
  }
  return false;
}

function escopoCompativel(regra, origemLinha) {
  return regra.escopo === origemLinha || regra.escopo === 'ambos';
}

// Precedência (spec 8.2): a primeira regra que casar nesta ordem vence;
// empate (mais de uma regra no mesmo nível) é decidido pelo maior `acertos`.
// Compatibilidade de escopo é pré-condição em TODOS os níveis — os níveis
// 1-3 além disso escalonam a especificidade dentro do tipoMatch 'exato'.
export function aplicarRegra(linha, regras) {
  const ativas = (regras || []).filter((r) =>
    r.ativa !== false && escopoCompativel(r, linha.origem) && padraoCasa(r, linha.descricaoCanonica)
  );
  if (!ativas.length) return null;

  const melhorDoNivel = (candidatas) => {
    if (!candidatas.length) return null;
    return candidatas.reduce((a, b) => ((b.acertos || 0) > (a.acertos || 0) ? b : a));
  };

  const exatas = ativas.filter((r) => r.tipoMatch === 'exato');
  const nivel1 = melhorDoNivel(exatas.filter((r) => r.contaId && r.contaId === linha.contaId));
  if (nivel1) return nivel1;

  const nivel2 = melhorDoNivel(exatas.filter((r) => r.escopo === linha.origem));
  if (nivel2) return nivel2;

  const nivel3 = melhorDoNivel(exatas.filter((r) => r.escopo === 'ambos'));
  if (nivel3) return nivel3;

  const nivel4 = melhorDoNivel(ativas.filter((r) => r.tipoMatch === 'contem'));
  if (nivel4) return nivel4;

  return melhorDoNivel(ativas.filter((r) => r.tipoMatch === 'regex'));
}

// Cria ou sobrescreve a regra aprendida com esta descrição canônica+escopo.
// Não persiste — devolve o objeto pronto para `saveRegra`. `acertos` zera
// quando a categoria muda (o usuário está corrigindo a máquina); permanece
// quando a categoria é a mesma de antes (não é uma correção).
export function aprenderRegra(dados, regrasExistentes) {
  const existente = (regrasExistentes || []).find((r) =>
    r.tipoMatch === 'exato' && r.padrao === dados.descricaoCanonica && r.escopo === dados.escopo
  );
  const mudouCategoria = existente && existente.categoriaId !== dados.categoriaId;
  return {
    id: existente ? existente.id : uid('rule'),
    padrao: dados.descricaoCanonica,
    tipoMatch: 'exato',
    escopo: dados.escopo,
    contaId: dados.contaId || null,
    categoriaId: dados.categoriaId,
    formaPagamentoId: (existente && !mudouCategoria) ? existente.formaPagamentoId : null,
    naturezaSugerida: (existente && !mudouCategoria) ? existente.naturezaSugerida : null,
    origem: 'aprendida',
    acertos: existente && !mudouCategoria ? (existente.acertos || 0) : 0,
    criadoEm: existente ? existente.criadoEm : Date.now(),
    ultimoUsoEm: Date.now(),
    ativa: true,
  };
}

// Lançamentos ainda em "A Classificar", com origem numa linha importada, cuja
// descrição canônica bate com a regra recém aprendida. `descricaoCanonicaPorTransacao`
// é pré-calculada pelo chamador (Map id->descricaoCanonica) porque a transação
// em si não guarda esse campo, só a linha de origem guarda. Só regras EXATAS
// reaplicam retroativamente — 'contem'/'regex' aplicadas em massa sobre o
// histórico têm risco real de falso positivo que o usuário não pediu.
export function candidatosRetroativos(transactions, regra, descricaoCanonicaPorTransacao) {
  if (!regra || regra.tipoMatch !== 'exato') return [];
  return (transactions || []).filter((t) =>
    t.categoria === CATEGORIA_A_CLASSIFICAR &&
    t.origemRef &&
    descricaoCanonicaPorTransacao.get(t.id) === regra.padrao
  );
}

export function novaRegra(dados) {
  return {
    id: uid('rule'),
    tipoMatch: 'exato',
    escopo: 'ambos',
    contaId: null,
    formaPagamentoId: null,
    naturezaSugerida: null,
    origem: 'manual',
    acertos: 0,
    criadoEm: Date.now(),
    ultimoUsoEm: null,
    ativa: true,
    ...dados,
  };
}

// --- Persistência ---

export async function listRegras() {
  return storage.getAll('classificationRules');
}

export async function saveRegra(regra) {
  return storage.put('classificationRules', regra);
}

export async function removeRegra(id) {
  return storage.remove('classificationRules', id);
}
```

- [ ] **Step 4: Rodar de novo**

Run: `node tools/run-tests.mjs`
Expected: PASS em todos os testes de `classification.test.js`, nenhuma regressão.

- [ ] **Step 5: Sabotar `PREFIXO_ADQUIRENTE_RE` e confirmar que o teste específico cai**

Troque temporariamente para `/^(PAG|MP)\*/` (remove `PAGSEGURO` da alternação — trocar só a ORDEM não derruba nada, como o comentário do regex já explica).
Run: `node tools/run-tests.mjs`
Expected: FALHOU só em `'PAGSEGURO* e removido por inteiro, nao so o prefixo PAG*'` — prova que o teste não é vácuo. Reverta antes de continuar.

- [ ] **Step 6: Commit**

```bash
git add tests/classification.test.js src/domain/classification.js
git commit -m "Adiciona memoria de classificacao: canonicalizacao, precedencia e aprendizado"
```

---

### Task 3: `domain/parcelas.js` — identidade de parcela, previsões, auto-confirmação, duplicidade

Esta task **porta**, não reinventa. O algoritmo abaixo é o mesmo de `Cartão de Credito/gastos-app/src/reconcile.js` e `src/app.js` (funções `computeParcelaKey`, `computeParcelaGroups`, `addMonths`, `syncPredictions`, `autoConfirmParcelas`, `splitParcelas`, `findParcelaDuplicates`), já validado em produção com faturas reais de 09/2025 a 06/2026. As diferenças do app novo são só de nome de campo (`t.previsto`, `t.natureza` já existem; o app antigo não tinha `natureza`, então toda previsão/confirmação de fatura ganha `natureza: 'despesa'` explícito) e de **isolamento por cartão**: como o app novo tem multi-cartão, quem chama estas funções (Task 8/Task 12) é responsável por filtrar `transactions`/`allFaturaRows` para o grupo titular+adicionais do cartão sendo processado **antes** de chamar — as funções aqui continuam operando sobre a lista que recebem, exatamente como antes, sem saber de cartão nenhum.

**Files:**
- Create: `src/domain/parcelas.js`
- Test: `tests/parcelas.test.js`

**Interfaces:**
- Consumes: `core/dates.js`, `domain/categories.js` (`CATEGORIA_A_CLASSIFICAR`)
- Produces:
  - `computeParcelaKey(descricao, dataCompraOriginal, parcelaTotal) -> string`
  - `computeParcelaGroups(allFaturaRows) -> group[]`
  - `syncPredictions(allFaturaRows, existingTransactions, contaId, formaPagamentoId) -> { toAdd, toRemoveIds }`
  - `autoConfirmParcelas(faturaRows, transactions, dataCorte, contaId, formaPagamentoId) -> { updatedTransactions, confirmed, removedIds }`
  - `splitParcelas(total, n) -> number[]`
  - `addMonthsISO(iso, n) -> string` — mesmo clamp de dia de `addMonths`, devolve ISO
  - `findParcelaDuplicates(transactions, allFaturaRows, desc, data, n, valorParcela) -> transaction[]`

- [ ] **Step 1: Escrever os testes**

Crie `tests/parcelas.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  computeParcelaKey, computeParcelaGroups, syncPredictions, autoConfirmParcelas,
  splitParcelas, findParcelaDuplicates,
} from '../src/domain/parcelas.js';
import { CATEGORIA_A_CLASSIFICAR } from '../src/domain/categories.js';

describe('parcelas: computeParcelaKey', () => {
  it('normaliza a descricao (maiuscula, sem espaco duplo) antes de compor a chave', () => {
    assertEqual(
      computeParcelaKey('  loja   exemplo  ', '2026-06-01', 3),
      computeParcelaKey('LOJA EXEMPLO', '2026-06-01', 3)
    );
  });

  it('descricoes diferentes geram chaves diferentes', () => {
    assert(computeParcelaKey('LOJA A', '2026-06-01', 3) !== computeParcelaKey('LOJA B', '2026-06-01', 3));
  });
});

describe('parcelas: splitParcelas (divisao por centavos, resto nas primeiras)', () => {
  it('divide exato quando o total e multiplo de n', () => {
    assertDeepEqual(splitParcelas(300, 3), [100, 100, 100]);
  });

  it('resto de centavos vai pras PRIMEIRAS parcelas, uma unidade de centavo cada', () => {
    // 100,00 / 3 = 33,33333... -> 33,34 + 33,33 + 33,33 (resto de 1 centavo na primeira)
    assertDeepEqual(splitParcelas(100, 3), [33.34, 33.33, 33.33]);
  });

  it('soma das parcelas bate EXATO com o total, sem residuo de ponto flutuante', () => {
    const vals = splitParcelas(999.97, 7);
    const soma = vals.reduce((a, b) => a + b, 0);
    assertEqual(Math.round(soma * 100), Math.round(999.97 * 100));
  });
});

describe('parcelas: computeParcelaGroups + syncPredictions', () => {
  const CONTA = 'acc_cartao_1';
  const FORMA = 'pm_credito';

  function rowParcelamento(over) {
    return {
      tipo: 'parcelamento', descricao: 'LOJA EXEMPLO', data: '2026-04-10',
      vencimento: '2026-05-01', valor: 100, parcela_atual: 1, parcela_total: 3,
      ...over,
    };
  }

  it('gera previsoes para as parcelas RESTANTES, uma por mes, com id determinístico seed_', () => {
    const { toAdd } = syncPredictions([rowParcelamento()], [], CONTA, FORMA);
    assertEqual(toAdd.length, 2, 'parcela 1/3 ja veio na fatura; restam 2 previsoes (2/3 e 3/3)');
    assert(toAdd.every((t) => t.id.startsWith('seed_')), 'toda previsao usa o namespace seed_');
    assert(toAdd.every((t) => t.previsto === true && t.natureza === 'despesa'), 'previsao e despesa nao efetivada');
    assert(toAdd.every((t) => t.contaId === CONTA && t.formaPagamentoId === FORMA));
    assert(toAdd.every((t) => t.parcela_total === 3), 'parcela_total precisa vir do grupo original (3), nao ser recalculado errado a partir de "remaining"');
    assertDeepEqual(toAdd.map((t) => t.parcela_atual).sort(), [2, 3]);
  });

  it('mesma compra gera o MESMO id de previsao em duas chamadas — idempotencia', () => {
    const r1 = syncPredictions([rowParcelamento()], [], CONTA, FORMA);
    const r2 = syncPredictions([rowParcelamento()], [], CONTA, FORMA);
    assertDeepEqual(r1.toAdd.map((t) => t.id).sort(), r2.toAdd.map((t) => t.id).sort());
  });

  it('previsao sem lancamento real cai em A_CLASSIFICAR; com lancamento real da mesma parcelaKey, herda a categoria dele', () => {
    const key = computeParcelaKey('LOJA EXEMPLO', '2026-04-10', 3);
    const semHistorico = syncPredictions([rowParcelamento()], [], CONTA, FORMA);
    assert(semHistorico.toAdd.every((t) => t.categoria === CATEGORIA_A_CLASSIFICAR));

    const comHistorico = syncPredictions(
      [rowParcelamento()],
      [{ id: 'x', previsto: false, parcelaKey: key, categoria: 'alimentacao' }],
      CONTA, FORMA
    );
    assert(comHistorico.toAdd.every((t) => t.categoria === 'alimentacao'));
  });

  it('marca pra remover previsoes ANTIGAS (previsto true, sem origemManual) — wipe-and-regenerate', () => {
    const antiga = { id: 'seed_velho', previsto: true, origemManual: false };
    const { toRemoveIds } = syncPredictions([rowParcelamento()], [antiga], CONTA, FORMA);
    assertEqual(toRemoveIds, ['seed_velho']);
  });

  it('previsao de parcelamento MANUAL (origemManual true) NUNCA entra na lista de remocao', () => {
    // computeParcelaGroups so enxerga linha de FATURA — uma previsao manual
    // nunca seria regenerada de qualquer forma, entao tem que sobreviver.
    const manual = { id: 'x123', previsto: true, origemManual: true };
    const { toRemoveIds } = syncPredictions([rowParcelamento()], [manual], CONTA, FORMA);
    assertDeepEqual(toRemoveIds, []);
  });

  it('lancamento CONFIRMADO (previsto false) nunca entra na lista de remocao', () => {
    const confirmado = { id: 'confirmed_x', previsto: false };
    const { toRemoveIds } = syncPredictions([rowParcelamento()], [confirmado], CONTA, FORMA);
    assertDeepEqual(toRemoveIds, []);
  });
});

describe('parcelas: autoConfirmParcelas', () => {
  const CONTA = 'acc_cartao_1';
  const FORMA = 'pm_credito';
  const key = computeParcelaKey('LOJA EXEMPLO', '2026-04-10', 3);

  function rowParcelamento(over) {
    return {
      tipo: 'parcelamento', descricao: 'LOJA EXEMPLO', data: '2026-04-10',
      vencimento: '2026-06-01', valor: 33.33, parcela_atual: 2, parcela_total: 3,
      ...over,
    };
  }

  it('parcela_atual > 1 confirma sozinha MESMO SEM candidato previsto', () => {
    const { confirmed, updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [], null, CONTA, FORMA);
    assertEqual(confirmed.length, 1);
    assertEqual(updatedTransactions[0].previsto, false);
    assertEqual(updatedTransactions[0].natureza, 'despesa');
    assert(updatedTransactions[0].id.startsWith('confirmed_'));
  });

  it('parcela_atual === 1 SEM candidato previsto NAO confirma — exige toque manual', () => {
    const row1 = rowParcelamento({ parcela_atual: 1, parcela_total: 3 });
    const { confirmed } = autoConfirmParcelas([row1], [], null, CONTA, FORMA);
    assertEqual(confirmed.length, 0);
  });

  it('confirma usando a data de CORTE da fatura, nao o vencimento, quando o corte e conhecido', () => {
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [], '2026-05-28', CONTA, FORMA);
    assertEqual(updatedTransactions[0].data, '2026-05-28');
  });

  it('sem corte conhecido, cai no vencimento', () => {
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [], null, CONTA, FORMA);
    assertEqual(updatedTransactions[0].data, '2026-06-01');
  });

  it('o id confirmado NUNCA reaproveita o id da previsao — namespaces sempre diferentes', () => {
    const previsao = { id: 'seed_algumacoisa', previsto: true, parcelaKey: key, data: '2026-05-30' };
    const { updatedTransactions, removedIds } = autoConfirmParcelas([rowParcelamento()], [previsao], null, CONTA, FORMA);
    assert(updatedTransactions[0].id !== previsao.id);
    assert(updatedTransactions[0].id.startsWith('confirmed_'));
    assertEqual(removedIds, [previsao.id], 'o id antigo da previsao precisa ser removido explicitamente');
  });

  it('com candidato previsto, escolhe o de data MAIS PROXIMA do vencimento desta fatura entre varios', () => {
    const longe = { id: 'seed_longe', previsto: true, parcelaKey: key, data: '2026-04-01', categoria: 'outros' };
    const perto = { id: 'seed_perto', previsto: true, parcelaKey: key, data: '2026-05-29', categoria: 'lazer' };
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [longe, perto], null, CONTA, FORMA);
    assertEqual(updatedTransactions[0].categoria, 'lazer', 'devia ter escolhido o candidato mais perto do vencimento (perto), herdando a categoria dele');
  });

  it('sem candidato previsto mas com IRMAO REAL da mesma parcelaKey, herda a categoria do irmao em vez de A_CLASSIFICAR', () => {
    const irmaoReal = { id: 'confirmed_outro', previsto: false, parcelaKey: key, categoria: 'transporte' };
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [irmaoReal], null, CONTA, FORMA);
    assertEqual(updatedTransactions[0].categoria, 'transporte');
  });

  it('sem candidato e sem irmao real, cai em A_CLASSIFICAR', () => {
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [], null, CONTA, FORMA);
    assertEqual(updatedTransactions[0].categoria, CATEGORIA_A_CLASSIFICAR);
  });
});

describe('parcelas: findParcelaDuplicates', () => {
  it('acha por identidade EXATA (mesma parcelaKey)', () => {
    const key = computeParcelaKey('LOJA X', '2026-06-01', 4);
    const t = { id: 't1', parcelaKey: key };
    const resultado = findParcelaDuplicates([t], [], 'LOJA X', '2026-06-01', 4, 25);
    assertDeepEqual(resultado.map((r) => r.id), ['t1']);
  });

  it('acha por heuristica fraca: valor <R$0,05, data <=15 dias, descricao por substring bidirecional, so parcela_atual>1', () => {
    const rowFatura = { tipo: 'parcelamento', parcela_atual: 2, parcela_total: 4, descricao: 'LOJA EXEMPLO XYZ', data: '2026-06-05', valor: 25.02 };
    const key = computeParcelaKey('LOJA EXEMPLO XYZ', '2026-06-05', 4);
    const t = { id: 't1', parcelaKey: key };
    const resultado = findParcelaDuplicates([t], [rowFatura], 'LOJA EXEMPLO', '2026-06-10', 4, 25);
    assertDeepEqual(resultado.map((r) => r.id), ['t1']);
  });

  it('heuristica fraca IGNORA linha de fatura com parcela_atual === 1', () => {
    const rowFatura = { tipo: 'parcelamento', parcela_atual: 1, parcela_total: 4, descricao: 'LOJA EXEMPLO XYZ', data: '2026-06-05', valor: 25.02 };
    const resultado = findParcelaDuplicates([], [rowFatura], 'LOJA EXEMPLO', '2026-06-10', 4, 25);
    assertDeepEqual(resultado, []);
  });

  it('diferenca de valor >= R$0,05 nao conta como duplicata fraca', () => {
    const rowFatura = { tipo: 'parcelamento', parcela_atual: 2, parcela_total: 4, descricao: 'LOJA EXEMPLO', data: '2026-06-05', valor: 25.10 };
    const resultado = findParcelaDuplicates([], [rowFatura], 'LOJA EXEMPLO', '2026-06-10', 4, 25);
    assertDeepEqual(resultado, []);
  });

  it('diferenca de data > 15 dias nao conta como duplicata fraca', () => {
    const rowFatura = { tipo: 'parcelamento', parcela_atual: 2, parcela_total: 4, descricao: 'LOJA EXEMPLO', data: '2026-05-01', valor: 25 };
    const resultado = findParcelaDuplicates([], [rowFatura], 'LOJA EXEMPLO', '2026-06-10', 4, 25);
    assertDeepEqual(resultado, []);
  });

  it('sem nenhuma pista, devolve lista vazia', () => {
    assertDeepEqual(findParcelaDuplicates([], [], 'NADA', '2026-06-10', 2, 10), []);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tools/run-tests.mjs`
Expected: FALHOU em todos os testes de `parcelas.test.js` (módulo ainda não existe).

- [ ] **Step 3: Implementar `parcelas.js`**

```js
// Identidade de parcela, previsões de parcela futura e auto-confirmação por
// fatura — PORTADO do app anterior (reconcile.js), já validado em produção
// com faturas reais de 09/2025 a 06/2026. Isolamento por cartão NÃO é
// responsabilidade deste módulo: quem chama filtra `allFaturaRows`/
// `existingTransactions` para o grupo titular+adicionais certo ANTES de
// chamar (ver Task 8, reconcile-card.js).

import { CATEGORIA_A_CLASSIFICAR } from './categories.js';

function normalizeDescricao(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export function computeParcelaKey(descricao, dataCompraOriginal, parcelaTotal) {
  return `${normalizeDescricao(descricao)}|${dataCompraOriginal}|${parcelaTotal}`;
}

// Preserva o "dia" só até onde o mês de destino permitir (dia 30 virando
// fevereiro fica 28/29, não estoura pra março) — sem isso, duas previsões
// seguidas podiam cair no mesmo mês, empurrando a última parcela adiante do
// que realmente aconteceria.
function addMonths(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, daysInTarget));
  return target;
}
function ymOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

// Versão ISO de addMonths, exportada para quem precisa de string em vez de
// Date (Task 4, parcelamento manual). Mesmo clamp de dia, uma única
// implementação — o app anterior tinha duas cópias quase idênticas
// (addMonths aqui e addMonthsClamped em app.js) e isso não se repete aqui.
export function addMonthsISO(iso, n) {
  const d = addMonths(iso, n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function computeParcelaGroups(allFaturaRows) {
  const map = new Map();
  for (const r of allFaturaRows || []) {
    if (r.tipo !== 'parcelamento' || !r.parcela_total) continue;
    const key = computeParcelaKey(r.descricao, r.data, r.parcela_total);
    const cur = map.get(key);
    if (!cur || r.parcela_atual > cur.parcela_atual) map.set(key, { ...r, key });
  }
  const groups = [];
  for (const r of map.values()) {
    const remaining = r.parcela_total - r.parcela_atual;
    if (remaining <= 0) continue;
    const months = [];
    for (let k = 1; k <= remaining; k++) {
      const dt = addMonths(r.vencimento, k);
      months.push({ ym: ymOf(dt), valor: r.valor, numero: r.parcela_atual + k });
    }
    groups.push({ key: r.key, descricao: r.descricao, dataCompraOriginal: r.data, remaining, parcelaTotal: r.parcela_total, months });
  }
  return groups;
}

// Recria do zero todas as previsões (previsto:true) a partir do histórico
// mais atual, em vez de só acumular por cima das antigas: se a fatura mudou
// o ritmo de cobrança, a previsão antiga fica errada e precisa SUMIR, não só
// ganhar uma nova ao lado. Confirmados nunca são tocados. Previsões de
// parcelamento MANUAL (origemManual:true) ficam de fora da limpeza —
// computeParcelaGroups só enxerga linha de fatura, então nunca as
// regeneraria de qualquer forma.
export function syncPredictions(allFaturaRows, existingTransactions, contaId, formaPagamentoId) {
  const groups = computeParcelaGroups(allFaturaRows);
  const categoriaPorKey = new Map();
  (existingTransactions || []).forEach((t) => {
    if (!t.previsto && t.parcelaKey && t.categoria) categoriaPorKey.set(t.parcelaKey, t.categoria);
  });

  const toRemoveIds = (existingTransactions || [])
    .filter((t) => t.previsto && !t.origemManual)
    .map((t) => t.id);

  const toAdd = [];
  groups.forEach((g) => {
    g.months.forEach((m) => {
      const safeKey = (g.descricao + '|' + m.valor.toFixed(2) + '|' + m.ym).replace(/[^a-zA-Z0-9]/g, '_');
      toAdd.push({
        id: 'seed_' + safeKey,
        descricao: `${g.descricao} (parcela prevista)`,
        valor: m.valor,
        data: m.ym + '-01',
        categoria: categoriaPorKey.get(g.key) || CATEGORIA_A_CLASSIFICAR,
        natureza: 'despesa',
        origem: 'fatura',
        previsto: true,
        contaId,
        formaPagamentoId,
        parcelaKey: g.key,
        parcela_atual: m.numero,
        parcela_total: g.parcelaTotal,
      });
    });
  });

  return { toAdd, toRemoveIds };
}

function dateDiffDays(iso1, iso2) {
  return Math.abs((new Date(iso1) - new Date(iso2)) / 86400000);
}

export function autoConfirmParcelas(faturaRows, transactions, dataCorte, contaId, formaPagamentoId) {
  const byId = new Map((transactions || []).map((t) => [t.id, t]));
  const confirmed = [];
  const removedIds = [];
  const usedIds = new Set();

  for (const row of faturaRows || []) {
    if (row.tipo !== 'parcelamento') continue;
    const key = computeParcelaKey(row.descricao, row.data, row.parcela_total);
    const candidates = (transactions || []).filter((t) => t.previsto && t.parcelaKey === key && !usedIds.has(t.id));
    let candidate = null;
    if (candidates.length) {
      candidates.sort((a, b) => dateDiffDays(a.data, row.vencimento) - dateDiffDays(b.data, row.vencimento));
      candidate = candidates[0];
    }
    if (!candidate && !(row.parcela_atual > 1)) continue; // parcela 1 de verdade: exige confirmação manual

    const irmaoReal = !candidate ? (transactions || []).find((t) => !t.previsto && t.parcelaKey === key) : null;

    const descricaoBase = (candidate ? candidate.descricao : row.descricao).replace(/\s*\(parcela prevista\)\s*$/i, '');
    const newId = `confirmed_${key.replace(/[^a-zA-Z0-9]/g, '_')}_${row.vencimento}`;
    if (candidate) {
      usedIds.add(candidate.id);
      if (candidate.id !== newId) { byId.delete(candidate.id); removedIds.push(candidate.id); }
    }
    const updated = {
      id: newId,
      descricao: descricaoBase,
      valor: row.valor,
      data: dataCorte || row.vencimento,
      categoria: candidate ? candidate.categoria : (irmaoReal ? irmaoReal.categoria : CATEGORIA_A_CLASSIFICAR),
      natureza: 'despesa',
      origem: 'fatura',
      previsto: false,
      conciliadoAutomaticamente: true,
      contaId,
      formaPagamentoId,
      parcela_atual: row.parcela_atual,
      parcela_total: row.parcela_total,
      parcelaKey: key,
    };
    byId.set(updated.id, updated);
    confirmed.push({ before: candidate, after: updated, faturaRow: row });
  }

  return { updatedTransactions: [...byId.values()], confirmed, removedIds };
}

// Divide um total em N parcelas por CENTAVOS inteiros, distribuindo o resto
// (uma unidade de centavo por vez) nas primeiras parcelas — nunca em ponto
// flutuante direto, senão a soma das parcelas diverge do total por residuo.
export function splitParcelas(total, n) {
  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / n);
  const remainder = totalCents - baseCents * n;
  const vals = [];
  for (let i = 0; i < n; i++) vals.push((baseCents + (i < remainder ? 1 : 0)) / 100);
  return vals;
}

function normalizeDescLoose(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ' '); }

// Antes de criar uma compra parcelada "do zero" (checkbox manual em
// Lançamentos), verifica se ela já tem algo ligado no app — por identidade
// exata (mesma parcelaKey) ou por uma pista mais fraca (linha de fatura já
// importada com parcela_atual > 1, descrição parecida, valor de parcela
// próximo, data de compra próxima). As TRÊS condições fracas juntas evitam
// disparar aviso pra qualquer compra homônima não relacionada — comerciantes
// recorrentes geram várias linhas de parcelamento genuinamente diferentes
// com a mesma descrição ao longo do tempo.
export function findParcelaDuplicates(transactions, allFaturaRows, desc, data, n, valorParcela) {
  const key = computeParcelaKey(desc, data, n);
  const normDesc = normalizeDescLoose(desc);
  const fuzzyRows = (allFaturaRows || []).filter((r) =>
    r.tipo === 'parcelamento' && r.parcela_atual > 1 &&
    Math.abs(r.valor - valorParcela) < 0.05 &&
    Math.abs((new Date(r.data + 'T00:00:00') - new Date(data + 'T00:00:00')) / 86400000) <= 15 &&
    (normalizeDescLoose(r.descricao).includes(normDesc) || normDesc.includes(normalizeDescLoose(r.descricao)))
  );
  const fuzzyKeys = new Set(fuzzyRows.map((r) => computeParcelaKey(r.descricao, r.data, r.parcela_total)));
  return (transactions || []).filter((t) => t.parcelaKey === key || (t.parcelaKey && fuzzyKeys.has(t.parcelaKey)));
}
```

- [ ] **Step 4: Rodar de novo**

Run: `node tools/run-tests.mjs`
Expected: PASS em todos os testes de `parcelas.test.js`.

- [ ] **Step 5: Sabotar o namespace de confirmação e confirmar que o teste de não-reaproveitamento cai**

Troque temporariamente `confirmed_${key...}` por `candidate ? candidate.id : ...` (reaproveitando o id da previsão quando existe candidato).
Run: `node tools/run-tests.mjs`
Expected: FALHOU em `'o id confirmado NUNCA reaproveita o id da previsao...'`. Reverta antes de continuar — esta é a regra que evita a classe de bug documentada no comentário de `autoConfirmParcelas` no app anterior (recálculo de previsão colidindo com confirmação já gravada).

- [ ] **Step 6: Commit**

```bash
git add tests/parcelas.test.js src/domain/parcelas.js
git commit -m "Porta identidade de parcela, previsoes e auto-confirmacao do app anterior"
```

---

### Task 4: Lançamentos — compra parcelada manual + aviso de duplicidade

Wire da Task 3 na tela de uso diário: o checkbox "Compra parcelada" que cria N lançamentos de uma vez (parcela 1 real, 2..N previstas), com checagem de duplicidade antes de criar. `src/ui/lancamentos.js` já está perto do limite de ~250 linhas (fechou a Fase 1 com ~370, mesmo com o teto — decisão já registrada no ledger da Fase 1 como aceitável por compartilhar estado mutável). Esta feature entra num módulo **irmão**, não dentro do arquivo existente.

**Files:**
- Create: `src/ui/lancamentos-parcelado.js`
- Modify: `src/ui/lancamentos.js` (form ganha o checkbox e delega pro módulo novo)
- Test: `tests/lancamentos-parcelado.test.js`

**Interfaces:**
- Consumes: `domain/parcelas.js` (`computeParcelaKey`, `splitParcelas`, `addMonthsISO`, `findParcelaDuplicates`), `domain/categories.js` (`CATEGORIA_A_CLASSIFICAR`), `core/ids.js` (`uid`), `ui/components.js` (`el`, `abrirModal`)
- Produces:
  - `montarLancamentosParcelados(dados) -> transaction[]` — pura, `dados = { descricao, data, valorTotal, numParcelas, categoria, formaPagamentoId, contaId }`
  - `async campoParceladoEModal(ctx) -> { checkbox, painelExtra, confirmarEObterLancamentos: async (transactions, allFaturaRows) => transaction[] | null }` — orquestra a UI (checkbox + campos condicionais + modal de duplicidade), devolve `null` se o usuário cancelou no modal

- [ ] **Step 1: Escrever os testes da parte pura**

Crie `tests/lancamentos-parcelado.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { montarLancamentosParcelados } from '../src/ui/lancamentos-parcelado.js';
import { computeParcelaKey } from '../src/domain/parcelas.js';
import { CATEGORIA_A_CLASSIFICAR } from '../src/domain/categories.js';

function dados(over) {
  return {
    descricao: 'Loja Exemplo', data: '2026-06-10', valorTotal: 300, numParcelas: 3,
    categoria: 'lazer', formaPagamentoId: 'pm_credito', contaId: 'acc_cartao_1',
    ...over,
  };
}

describe('lancamentos-parcelado: montarLancamentosParcelados', () => {
  it('cria N lancamentos, um por mes, com a soma batendo exatamente com o total', () => {
    const lista = montarLancamentosParcelados(dados());
    assertEqual(lista.length, 3);
    const soma = lista.reduce((a, t) => a + t.valor, 0);
    assertEqual(Math.round(soma * 100), 300 * 100);
  });

  it('so a PRIMEIRA parcela vira lancamento real; as demais sao previsto+origemManual', () => {
    const [p1, p2, p3] = montarLancamentosParcelados(dados());
    assertEqual(p1.previsto, undefined, 'parcela 1 nao tem a chave previsto — e um lancamento real desde o inicio');
    assertEqual(p2.previsto, true);
    assertEqual(p2.origemManual, true);
    assertEqual(p3.previsto, true);
    assertEqual(p3.origemManual, true);
  });

  it('todas compartilham a MESMA parcelaKey e o mesmo grupo_parcela', () => {
    const lista = montarLancamentosParcelados(dados());
    const key = computeParcelaKey('Loja Exemplo', '2026-06-10', 3);
    assert(lista.every((t) => t.parcelaKey === key));
    assert(lista.every((t) => t.grupo_parcela === lista[0].grupo_parcela));
  });

  it('parcela_atual/parcela_total numerados corretamente, datas um mes depois da outra', () => {
    const lista = montarLancamentosParcelados(dados());
    assertDeepEqual(lista.map((t) => t.parcela_atual), [1, 2, 3]);
    assert(lista.every((t) => t.parcela_total === 3));
    assertDeepEqual(lista.map((t) => t.data), ['2026-06-10', '2026-07-10', '2026-08-10']);
  });

  it('so a parcela 2+ ganha o sufixo "(parcela prevista)" na descricao', () => {
    const [p1, p2] = montarLancamentosParcelados(dados());
    assertEqual(p1.descricao, 'Loja Exemplo');
    assertEqual(p2.descricao, 'Loja Exemplo (parcela prevista)');
  });

  it('todas natureza despesa, origem manual, mesma conta/forma do formulario', () => {
    const lista = montarLancamentosParcelados(dados());
    assert(lista.every((t) => t.natureza === 'despesa' && t.origem === 'manual'));
    assert(lista.every((t) => t.formaPagamentoId === 'pm_credito' && t.contaId === 'acc_cartao_1'));
  });

  it('ids sao todos distintos entre si', () => {
    const lista = montarLancamentosParcelados(dados());
    assertEqual(new Set(lista.map((t) => t.id)).size, 3);
  });

  it('dia 31 clampado corretamente ao virar mes mais curto (fevereiro)', () => {
    const lista = montarLancamentosParcelados(dados({ data: '2026-01-31', numParcelas: 3 }));
    assertDeepEqual(lista.map((t) => t.data), ['2026-01-31', '2026-02-28', '2026-03-31']);
  });
});
```

- [ ] **Step 2: Implementar a parte pura de `lancamentos-parcelado.js`**

```js
// Compra parcelada lançada manualmente (não veio de fatura importada). Só a
// parcela 1 vira lançamento REAL agora; 2..N viram previsto+origemManual —
// mesmo tratamento das parcelas que vêm de fatura, pra não competir por
// casamento de valor na conciliação com a parcela real do mês em curso, e
// pra a conciliação automática (por parcelaKey) já reconhecê-las quando a
// fatura de cada mês futuro chegar (ver domain/parcelas.js).

import { uid } from '../core/ids.js';
import { computeParcelaKey, splitParcelas, addMonthsISO, findParcelaDuplicates } from '../domain/parcelas.js';
import { el, abrirModal } from './components.js';
import { formatDateBR } from '../core/dates.js';
import { fmtBRL } from '../core/money.js';

export function montarLancamentosParcelados(dados) {
  const { descricao, data, valorTotal, numParcelas, categoria, formaPagamentoId, contaId } = dados;
  const vals = splitParcelas(valorTotal, numParcelas);
  const parcelaKey = computeParcelaKey(descricao, data, numParcelas);
  const grupoId = uid('grp');
  const lista = [];
  for (let i = 0; i < numParcelas; i++) {
    lista.push({
      id: uid('tx'),
      descricao: i === 0 ? descricao : `${descricao} (parcela prevista)`,
      valor: vals[i],
      data: addMonthsISO(data, i),
      categoria, natureza: 'despesa', origem: 'manual', formaPagamentoId, contaId,
      grupo_parcela: grupoId, parcelaKey, parcela_atual: i + 1, parcela_total: numParcelas,
      ...(i === 0 ? {} : { previsto: true, origemManual: true }),
    });
  }
  return lista;
}
```

- [ ] **Step 3: Rodar os testes da parte pura**

Run: `node tools/run-tests.mjs`
Expected: PASS nos 8 testes de `lancamentos-parcelado.test.js`.

- [ ] **Step 4: Implementar a parte de UI — modal de duplicidade e wiring no formulário**

Continue em `lancamentos-parcelado.js`, abaixo de `montarLancamentosParcelados`:

```js
// Modal com três saídas — não window.confirm, que só tem OK/Cancelar:
// apagar os lançamentos antigos e criar os novos no lugar; criar os novos
// mantendo os antigos (o usuário decide depois, caso o aviso seja falso
// positivo); ou desistir de lançar. Duplicatas com `origemRef` (vinculadas a
// uma linha de fatura/extrato já importada — spec 11, pendência do app
// anterior) aparecem PRIMEIRO e marcadas: são confirmadas por documento, não
// só pela heurística de descrição/valor/data parecidos.
async function confirmarDuplicidade(duplicatas) {
  const ordenadas = [...duplicatas].sort((a, b) => (b.origemRef ? 1 : 0) - (a.origemRef ? 1 : 0));
  return abrirModal({
    titulo: 'Compra parecida já lançada',
    corpo: el('div', {}, [
      el('p', { text: 'Encontrei lançamento(s) parecido(s) com esta compra parcelada:' }),
      el('ul', {}, ordenadas.map((d) =>
        el('li', { text: `${d.origemRef ? '[confirmado por documento] ' : ''}${formatDateBR(d.data)} — ${d.descricao} — ${fmtBRL(d.valor)}` })
      )),
    ]),
    acoes: [
      { id: 'cancelar', rotulo: 'Cancelar' },
      { id: 'manter', rotulo: 'Manter os dois' },
      { id: 'apagar', rotulo: 'Apagar os antigos e lançar', classe: 'btn-perigo' },
    ],
  });
}

// Monta o checkbox "Compra parcelada" e os dois campos que ele revela (valor
// total, número de parcelas). `ctx.onRemoverTransacoes(ids)` é chamado
// quando o usuário escolhe "apagar os antigos" — quem chama (lancamentos.js)
// decide como remover (await removeTransaction por id) e re-renderizar.
export function campoParceladoEModal(ctx) {
  const chkParcelado = el('input', { type: 'checkbox' });
  const inpValorTotal = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00' });
  const inpNumParcelas = el('input', { type: 'text', inputmode: 'numeric', placeholder: '2' });
  const painelExtra = el('div', { class: 'linha-form', style: 'display:none' }, [
    ctx.campo('Valor total', inpValorTotal), ctx.campo('Nº de parcelas', inpNumParcelas),
  ]);
  chkParcelado.addEventListener('change', () => {
    painelExtra.style.display = chkParcelado.checked ? '' : 'none';
  });

  async function confirmarEObterLancamentos(transactions, allFaturaRows, base) {
    const valorTotal = ctx.parseMoneyBR(inpValorTotal.value);
    const numParcelas = parseInt(inpNumParcelas.value, 10);
    if (valorTotal === null) return { erro: 'Valor total inválido. Use vírgula para os centavos.' };
    if (!numParcelas || numParcelas < 2) return { erro: 'Número de parcelas precisa ser 2 ou mais.' };

    const duplicatas = findParcelaDuplicates(transactions, allFaturaRows, base.descricao, base.data, numParcelas, valorTotal / numParcelas);
    if (duplicatas.length) {
      const escolha = await confirmarDuplicidade(duplicatas);
      if (escolha === 'cancelar' || escolha === null) return { erro: null, cancelado: true };
      if (escolha === 'apagar') await ctx.onRemoverTransacoes(duplicatas.map((d) => d.id));
    }

    return { lista: montarLancamentosParcelados({ ...base, valorTotal, numParcelas }) };
  }

  return { checkbox: chkParcelado, painelExtra, confirmarEObterLancamentos };
}
```

- [ ] **Step 5: Ligar em `src/ui/lancamentos.js`**

No `formulario(ctx, transacoes)` existente: importe `campoParceladoEModal` de `./lancamentos-parcelado.js`, chame `campoParceladoEModal({ campo, parseMoneyBR, onRemoverTransacoes: async (ids) => { for (const id of ids) await removeTransaction(id); } })`, insira `checkbox`/`painelExtra` no form (rótulo "Compra parcelada", visível só quando **não** está editando — `!emEdicao`, mesmo raciocínio de não misturar os dois fluxos que o app anterior já tinha). No `salvar()`, antes da checagem de reentrância de sempre: se `chkParcelado.checked` e não é edição, desvie para `confirmarEObterLancamentos`; se devolver `erro`, `toast(erro, 'erro')` e pare; se `cancelado`, pare em silêncio (o usuário já viu o modal); senão, `await saveTransactions(lista)` (já existe em `domain/transactions.js`), `toast(`${lista.length} parcelas lançadas, uma por mês.`, 'ok')`, `resetLancamentos()`-equivalente do form (reaproveite o fluxo de reset pós-salvar já existente) e `renderLancamentos()`. Fora desse desvio, o fluxo de lançamento único continua exatamente como está hoje.

- [ ] **Step 6: Verificação no navegador**

Servidor local, `index.html`: marcar "Compra parcelada", preencher valor total e nº de parcelas, lançar — confirme N-1 lançamentos futuros com `previsto: true` via `storage.getAll('transactions')` no console (a UI de Lançamentos ainda não distingue visualmente previsto de confirmado nesta fase — isso é decisão de exibição da Task 11, não desta task). Repita a mesma compra (mesma descrição/data/parcelas) — confirme que o modal de duplicidade aparece.

- [ ] **Step 7: Commit**

```bash
git add tests/lancamentos-parcelado.test.js src/ui/lancamentos-parcelado.js src/ui/lancamentos.js
git commit -m "Adiciona compra parcelada manual com aviso de duplicidade em Lancamentos"
```

---

### Task 5: `importers/santander-cartao-pdf.js` — fatura Visa e Mastercard em PDF

**Esta task porta um algoritmo já validado em produção, mas com três extensões genuinamente novas** (spec 6.4): distinção titular/adicional por plástico, natureza por seção (a seção "Pagamento e Demais Créditos" deixa de ser descartada), e extração do bloco "Período das compras". **A ordem de trabalho importa**: porte primeiro o núcleo exatamente como está abaixo (Steps 1-4), rode contra as três faturas Mastercard reais em `07 Financeiro/Gastos/Faturas/` (fora do repositório) e **meça onde diverge** antes de escrever as extensões (Steps 5-7) — não adivinhe o formato do cabeçalho de plástico nem do bloco de período sem ter visto o texto real primeiro.

**⚠️ Nota de privacidade, leia antes de começar**: os PDFs em `Faturas/` são documentos financeiros reais do usuário. Nada do texto extraído deles pode ir para um commit sem passar por anonimização manual (nomes, valores, números de cartão trocados por fictícios, preservando só a estrutura). Ao medir o parser contra os arquivos reais, faça isso **fora do diretório do repositório** (num script solto, ou no console do navegador apontando pro caminho absoluto do arquivo) — nunca copie um PDF ou o texto bruto extraído dele para dentro de `financas-app/`, nem temporariamente.

**Files:**
- Create: `src/importers/santander-cartao-pdf.js` (núcleo puro: `parseFaturaTexto` e o `register`/`detectar`/`parse` que o consome)
- Create: `src/importers/santander-cartao-pdf-extrair.js` (browser-only: extração de texto via `pdf.js` — `extractLines` e seus helpers, Step 8)
- Copy: `vendor/pdf.min.mjs`, `vendor/pdf.worker.min.mjs` de `Cartão de Credito/gastos-app/vendor/`
- Test: `tests/santander-cartao-pdf.test.js`
- Test fixture: `tests/fixtures/fatura-texto-sintetica.js` (texto **sintético**, no formato que `extractLines` produz — não derivado de nenhum PDF real; ver nota de privacidade acima)

**Interfaces:**
- Consumes: `importers/registry.js` (`register`), `domain/classification.js` (`canonicalizar`), `core/ids.js` (`stableHash`)
- Produces: `santander-cartao-pdf.js` registra o adaptador `santander-cartao-pdf` (`register({ id: 'santander-cartao-pdf', ... })`) e exporta as funções internas necessárias para teste: `parseFaturaTexto(linhas, arquivo, vencimentoDate)` (pura — recebe linhas já extraídas do PDF, sem depender de `pdf.js`, para ser testável em Node sem abrir um PDF de verdade; devolve `{ rows, checksum, avisos }`), `extractCutoffDateDeLinhas(linhas, vencimentoDate)`, `extrairPeriodoCompras(linhas, dataCorteISO)`, `resolveDate(dd, mm, vencimento)`, `vencimentoFromText(linhas)`, `toISOExportado(d)`. `santander-cartao-pdf-extrair.js` exporta só `extractLines(doc)`, importado por `santander-cartao-pdf.js`.

**Divisão em dois arquivos, decidida antes do dispatch** (não durante a implementação): a extração de texto do PDF em si (`extractLines`, que usa `pdf.js` e só roda no navegador — Step 8) mais o núcleo de parsing (`parseFaturaTexto` e seus helpers, Steps 1-7) juntos passariam de ~300 linhas, acima do teto de ~250 dos Global Constraints. A fronteira pura/impura que a task já separa (`parseFaturaTexto` testável em Node vs. `extractLines` browser-only) é exatamente onde cortar — cada lado já era conceitualmente independente, então a divisão não força nenhuma reestruturação, só move o Step 8 para o arquivo `-extrair.js`.

- [ ] **Step 1: Vendorizar o PDF.js**

```bash
cp "../../Cartão de Credito/gastos-app/vendor/pdf.min.mjs" vendor/
cp "../../Cartão de Credito/gastos-app/vendor/pdf.worker.min.mjs" vendor/
```

- [ ] **Step 2: Escrever os testes do núcleo de parsing (contra texto fixo, não PDF)**

Crie `tests/fixtures/fatura-texto-sintetica.js` — **linhas de texto sintéticas**, no formato exato que `extractLines` produziria, mas com dados totalmente fictícios (nunca copie linha real de fatura, mesmo anonimizando depois — comece do zero seguindo só a estrutura da seção 6.4 do spec):

```js
// Linhas de texto sintéticas no formato que extractLines() produz — não são
// derivadas de nenhuma fatura real. Servem só para exercitar o parser contra
// a estrutura documentada na spec (6.4), com dados 100% fictícios.
export const LINHAS_FATURA_SINTETICA = [
  'até 25/05',
  'Detalhamento da Fatura',
  'TITULAR EXEMPLO - 1234 XXXX XXXX 5678',
  'Parcelamentos',
  'Compra Data Descrição Parcela R$ US$',
  '20/04 20/04 LOJA MOVEIS EXEMPLO 02/06 150,00',
  'VALOR TOTAL 150,00',
  'Despesas',
  '22/04 22/04 SUPERMERCADO EXEMPLO 320,50',
  '23/04 23/04 FARMACIA EXEMPLO 45,00',
  'VALOR TOTAL 365,50',
  'Pagamento e Demais Créditos',
  '10/04 10/04 DEB AUTOM DE FATURA EM C/ 890,00',
  'VALOR TOTAL 890,00',
  'Resumo da Fatura',
];
```

Crie `tests/santander-cartao-pdf.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { parseFaturaTexto, resolveDate } from '../src/importers/santander-cartao-pdf.js';
import { LINHAS_FATURA_SINTETICA } from './fixtures/fatura-texto-sintetica.js';

const VENCIMENTO = new Date(2026, 4, 1); // 01/05/2026

describe('santander-cartao-pdf: resolveDate', () => {
  it('resolve DD/MM pro ano do vencimento quando a data cai antes (com folga de 5 dias)', () => {
    const d = resolveDate(28, 4, VENCIMENTO);
    assertEqual(d.getFullYear(), 2026);
    assertEqual(d.getMonth(), 3); // abril
  });

  it('resolve pro ano ANTERIOR quando a data (compra parcelada antiga) fica bem depois do vencimento na leitura ingenua', () => {
    // Compra de dezembro, fatura de maio do ano seguinte: sem retroceder o
    // ano, "12/25" cairia DEPOIS do vencimento de maio/2026.
    const d = resolveDate(15, 12, VENCIMENTO);
    assertEqual(d.getFullYear(), 2025);
  });

  it('testa ate 3 anos pra tras antes de desistir e usar o ano do vencimento', () => {
    const d = resolveDate(1, 1, new Date(2020, 0, 10));
    assert(d.getFullYear() <= 2020);
  });
});

describe('santander-cartao-pdf: parseFaturaTexto — nucleo (secoes, checksum, parcela)', () => {
  it('separa parcelamento, despesa avulsa e pagamento/credito nas tres secoes', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const porSecao = (s) => rows.filter((r) => r.secao === s);
    assertEqual(porSecao('despesas').length, 3, '1 parcelamento + 2 despesas avulsas, todas secao despesas');
    assertEqual(porSecao('pagamentos_creditos').length, 1);
  });

  it('linha de "Pagamento e Demais Creditos" NAO e descartada — vem no resultado (diferente do app anterior)', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const pagamento = rows.find((r) => r.secao === 'pagamentos_creditos');
    assert(pagamento, 'a linha de pagamento de fatura precisa estar em rows, nao ser pulada');
    assertEqual(pagamento.sinal, 'credito');
    assertEqual(pagamento.valor, 890);
  });

  it('despesa avulsa vem com sinal debito', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const despesa = rows.find((r) => r.descricao.includes('SUPERMERCADO'));
    assertEqual(despesa.sinal, 'debito');
    assertEqual(despesa.valor, 320.5);
  });

  it('extrai parcela_atual/parcela_total da coluna NN/NN', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const parcelado = rows.find((r) => r.descricao.includes('MOVEIS'));
    assertEqual(parcelado.parcela_atual, 2);
    assertEqual(parcelado.parcela_total, 6);
  });

  it('despesa avulsa (sem coluna de parcela) tem parcela_atual/parcela_total null', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const despesa = rows.find((r) => r.descricao.includes('FARMACIA'));
    assertEqual(despesa.parcela_atual, null);
    assertEqual(despesa.parcela_total, null);
  });

  it('checksum bate quando a soma de cada secao fecha com o VALOR TOTAL impresso', () => {
    const { checksum } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    assert(checksum.ok, JSON.stringify(checksum.sections));
  });

  it('checksum acusa quando a soma NAO bate', () => {
    const linhasQuebradas = LINHAS_FATURA_SINTETICA.map((l) =>
      l === '22/04 22/04 SUPERMERCADO EXEMPLO 320,50' ? '22/04 22/04 SUPERMERCADO EXEMPLO 999,99' : l
    );
    const { checksum, avisos } = parseFaturaTexto(linhasQuebradas, 'fatura-teste.pdf', VENCIMENTO);
    assert(!checksum.ok);
    assert(avisos.some((a) => /não bate/i.test(a)));
  });

  it('descricaoCanonica vem calculada em toda linha, com escopo fatura', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    assert(rows.every((r) => typeof r.descricaoCanonica === 'string' && r.descricaoCanonica.length > 0));
  });

  it('id de cada linha e determinístico: reparsear o MESMO texto gera os MESMOS ids', () => {
    const r1 = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const r2 = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    assertDeepEqual(r1.rows.map((r) => r.id), r2.rows.map((r) => r.id));
  });

  it('duas linhas de mesma data/valor/descricao (raro, mas possivel) geram ids DIFERENTES pelo ordinal', () => {
    const linhas = [
      ...LINHAS_FATURA_SINTETICA.slice(0, 5),
      '22/04 22/04 FARMACIA EXEMPLO 45,00',
      '22/04 22/04 FARMACIA EXEMPLO 45,00',
      'VALOR TOTAL 90,00',
      'Resumo da Fatura',
    ];
    const { rows } = parseFaturaTexto(linhas, 'fatura-teste.pdf', VENCIMENTO);
    const ids = rows.filter((r) => r.descricao.includes('FARMACIA')).map((r) => r.id);
    assertEqual(ids.length, 2);
    assert(ids[0] !== ids[1], 'sem o ordinal no hash, as duas linhas identicas colidiriam no mesmo id e uma sumiria na conciliacao');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node tools/run-tests.mjs`
Expected: FALHOU em todos (módulo ainda não existe).

- [ ] **Step 4: Implementar o núcleo — extração de texto (browser-only) e parsing (puro)**

```js
// Adaptador de fatura Santander (Visa e Mastercard). A extração de texto do
// PDF (extractLines) usa pdf.js e só roda no navegador; o parsing em si
// (parseFaturaTexto) é PURO — recebe linhas de texto já prontas — e é o que
// os testes exercitam, sem nunca abrir um PDF de verdade no Node.

import { register } from './registry.js';
import { canonicalizar } from '../domain/classification.js';
import { stableHash } from '../core/ids.js';

function moneyToNumber(str) {
  return parseFloat(String(str).trim().replace(/\./g, '').replace(',', '.'));
}
const MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

// Resolve o ano de uma data DD/MM dada como referência o vencimento: escolhe
// o ano mais recente que não fique DEPOIS do vencimento (+5 dias de folga) —
// cobre tanto despesas do ciclo corrente quanto a data de compra original de
// parcelamentos antigos (até ~3 anos atrás).
export function resolveDate(dd, mm, vencimento) {
  const slack = new Date(vencimento);
  slack.setDate(slack.getDate() + 5);
  for (let back = 0; back <= 3; back++) {
    const year = vencimento.getFullYear() - back;
    const candidate = new Date(year, mm - 1, dd);
    if (!isNaN(candidate) && candidate <= slack) return candidate;
  }
  return new Date(vencimento.getFullYear(), mm - 1, dd);
}

function toISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const CARD_HEADER_RE = /XXXX\s*XXXX\s*(\d{4})\s*$/;
const ROW_RE = /^(?:\S+\s+)?(\d{2})\/(\d{2})\s+(.+)$/;
const PARCELA_TAG_RE = /(\d{2})\/(\d{2})\s*$/;
const CUTOFF_RE = /realizados?\D*?at[éeè]\s+(\d{2})\/(\d{2})|^at[éeè]\s+(\d{2})\/(\d{2})/i;

export function extractCutoffDateDeLinhas(linhas, vencimentoDate) {
  for (const linha of (linhas || []).slice(0, 20)) {
    const m = CUTOFF_RE.exec(linha.trim());
    if (m) {
      const dd = parseInt(m[1] || m[3], 10);
      const mm = parseInt(m[2] || m[4], 10);
      return resolveDate(dd, mm, vencimentoDate);
    }
  }
  return null;
}

// Núcleo do parsing: state machine por linha, idêntica em espírito à do app
// anterior (mode: null|'credito'|'parcelamento'|'despesa'), com UMA mudança
// deliberada — linhas do modo 'credito' (seção "Pagamento e Demais
// Créditos") não são mais descartadas, viram linha normalizada com
// secao:'pagamentos_creditos' e sinal:'credito' (spec 6.4/7.1c: a
// atribuição de natureza real acontece em reconcile-card.js, não aqui).
export function parseFaturaTexto(linhas, arquivo, vencimentoDate) {
  const avisos = [];
  const rows = [];
  const sections = [];
  let mode = null;
  let inDetalhamento = false;
  let cardEnding = null;
  let sectionSum = 0;
  let lastDate = null;
  let ordinal = 0;

  const flushSection = (expected) => {
    const ok = Math.abs(sectionSum - expected) < 0.02;
    sections.push({ cardEnding, expected, computed: Math.round(sectionSum * 100) / 100, ok });
    if (!ok) avisos.push(`Cartão final ${cardEnding}: soma calculada (R$ ${sectionSum.toFixed(2)}) não bate com o "VALOR TOTAL" da fatura (R$ ${expected.toFixed(2)}).`);
    sectionSum = 0;
  };

  for (const rawLine of linhas || []) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/Detalhamento da Fatura/i.test(line)) { inDetalhamento = true; continue; }
    if (!inDetalhamento) continue;
    if (/^Resumo da Fatura/i.test(line)) break;

    const cardMatch = CARD_HEADER_RE.exec(line);
    if (cardMatch) { cardEnding = cardMatch[1]; mode = null; continue; }

    if (/^Pagamento e Demais/i.test(line)) { mode = 'credito'; continue; }
    if (/^Parcelamentos\s*$/i.test(line)) { mode = 'parcelamento'; continue; }
    if (/^Despesas\s*$/i.test(line)) { mode = 'despesa'; continue; }
    if (/^Compra\s+Data\s+Descri/i.test(line)) continue;

    const totalMatch = /^VALOR TOTAL\s+(-?[\d.,]+)/i.exec(line);
    if (totalMatch) { flushSection(moneyToNumber(totalMatch[1])); mode = null; continue; }

    if (mode === null) continue;
    if (/^COTA[ÇC][ÃA]O/i.test(line)) continue;

    const iofMatch = /^IOF DESPESA NO EXTERIOR\s+([\d.,]+)/i.exec(line);
    if (iofMatch) {
      if (!lastDate) { avisos.push(`Linha de IOF sem lançamento anterior para herdar a data: "${line}"`); continue; }
      const valor = moneyToNumber(iofMatch[1]);
      sectionSum += valor;
      rows.push(montarLinha({
        secao: mode === 'credito' ? 'pagamentos_creditos' : 'despesas',
        sinal: mode === 'credito' ? 'credito' : 'debito',
        data: toISO(lastDate), descricao: 'IOF DESPESA NO EXTERIOR', valor,
        parcela_atual: null, parcela_total: null, cardEnding,
      }, arquivo, vencimentoDate, ordinal++));
      continue;
    }

    const rowMatch = ROW_RE.exec(line);
    if (!rowMatch) continue;
    const [, ddStr, mmStr, rest] = rowMatch;
    const dd = parseInt(ddStr, 10);
    const mm = parseInt(mmStr, 10);
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) continue;

    const moneyTokens = rest.match(MONEY_RE);
    if (!moneyTokens || moneyTokens.length === 0) continue;

    const firstMoneyIdx = rest.indexOf(moneyTokens[0]);
    let descAndMaybeParcela = rest.slice(0, firstMoneyIdx).trim();

    let parcelaAtual = null, parcelaTotal = null;
    const parcelaMatch = PARCELA_TAG_RE.exec(descAndMaybeParcela);
    if (parcelaMatch) {
      parcelaAtual = parseInt(parcelaMatch[1], 10);
      parcelaTotal = parseInt(parcelaMatch[2], 10);
      descAndMaybeParcela = descAndMaybeParcela.slice(0, parcelaMatch.index).trim();
    }
    const descricao = descAndMaybeParcela.replace(/\s+/g, ' ').trim();
    if (!descricao) continue;

    let valor, valorUSD = null;
    if (moneyTokens.length >= 3) { valor = moneyToNumber(moneyTokens[moneyTokens.length - 2]); valorUSD = moneyToNumber(moneyTokens[moneyTokens.length - 1]); }
    else if (moneyTokens.length === 2) { valor = moneyToNumber(moneyTokens[0]); valorUSD = moneyToNumber(moneyTokens[1]); }
    else valor = moneyToNumber(moneyTokens[0]);

    const dataResolvida = resolveDate(dd, mm, vencimentoDate);
    lastDate = dataResolvida;

    const secao = mode === 'credito' ? 'pagamentos_creditos' : 'despesas';
    sectionSum += Math.abs(valor);
    rows.push(montarLinha({
      secao, sinal: mode === 'credito' ? 'credito' : 'debito',
      data: toISO(dataResolvida), descricao, valor: Math.abs(valor), valorUSD,
      parcela_atual: parcelaAtual, parcela_total: parcelaTotal, cardEnding,
    }, arquivo, vencimentoDate, ordinal++));
  }

  const checksum = { ok: sections.length > 0 && sections.every((s) => s.ok), sections };
  if (sections.length === 0) avisos.push('Não encontrei nenhuma seção "VALOR TOTAL" pra conferir — não foi possível validar esta fatura automaticamente.');

  return { rows, checksum, avisos };
}

function montarLinha(campos, arquivo, vencimentoDate, ordinal) {
  const descricaoCanonica = canonicalizar(campos.descricao, 'fatura');
  const id = stableHash([campos.cardEnding, campos.data, campos.valor, campos.descricao, arquivo, ordinal]);
  return {
    id, documento: null, tipoDetectado: null, saldo: null, raw: campos.descricao,
    ...campos, descricaoCanonica,
  };
}
```

- [ ] **Step 5: Rodar de novo**

Run: `node tools/run-tests.mjs`
Expected: PASS em todos os testes de `santander-cartao-pdf.test.js`.

- [ ] **Step 6: Medir contra as faturas reais — fora do repositório, sem copiar nada real pra dentro dele**

Ainda sem `extractLines` (que depende de `pdf.js` e roda só no navegador). Monte um harness solto **fora da pasta do projeto** — por exemplo em `07 Financeiro/Gastos/` mesmo — que carregue `pdf.min.mjs`, abra cada um dos três PDFs em `Faturas/`, rode a extração de linhas (o algoritmo de clusterização/reconstrução de coluna, colado no Step 8 abaixo) e chame `parseFaturaTexto` com o resultado. Rode contra as três faturas Mastercard e anote, sem copiar texto real pra lugar nenhum do repositório:

1. O `checksum.ok` fecha nas três?
2. O formato exato da linha de cabeçalho de plástico bate com `CARD_HEADER_RE`? Ela tem o formato `NOME - BBBB XXXX XXXX FFFF` da spec 6.4, ou outro? Existe algum `@` de cartão adicional nas três faturas (podem não ter, já que são do mesmo titular seguido)?
3. Existe o bloco "Período das compras" nas três? Qual o texto exato de cada uma das quatro faixas?
4. Alguma linha cai em `avisos` por não bater em `ROW_RE`?

Reporte o resultado no relatório da task antes de continuar pro Step 7 — as extensões dos Steps 7-8 dependem do que for medido aqui, não do que está adivinhado no spec.

- [ ] **Step 7: Estender para titular/adicional e o bloco "Período das compras"**

Com base na medição do Step 6, ajuste `CARD_HEADER_RE` para capturar também o prefixo `@` (adicional) — ponto de partida, ajuste conforme o texto real:

```js
const CARD_HEADER_RE = /^(@)?[^-]*-\s*\d{4}\s*XXXX\s*XXXX\s*(\d{4})\s*$/;
// grupo 1: presença de '@' => adicional. grupo 2: final do cartão.
```

Adicione `plastico: 'titular' | 'adicional'` à linha normalizada, e teste com uma fixture sintética que tenha os dois tipos de bloco (siga o mesmo princípio do Step 2 — texto inventado, não copiado).

Exporte também `extrairPeriodoCompras(linhas, dataCorteISO)`, que varre as primeiras linhas da página 1 (mesma região onde `CUTOFF_RE` já procura) por faixas `DD/MM/AA a DD/MM/AA` e escolhe a que **termina** na `dataCorte` já extraída:

```js
const FAIXA_PERIODO_RE = /(\d{2})\/(\d{2})\/(\d{2})\s*a\s*(\d{2})\/(\d{2})\/(\d{2})/g;

export function extrairPeriodoCompras(linhas, dataCorteISO) {
  if (!dataCorteISO) return null;
  const texto = (linhas || []).slice(0, 30).join(' ');
  const faixas = [];
  let m;
  while ((m = FAIXA_PERIODO_RE.exec(texto))) {
    faixas.push({ inicio: `20${m[3]}-${m[2]}-${m[1]}`, fim: `20${m[6]}-${m[5]}-${m[4]}` });
  }
  return faixas.find((f) => f.fim === dataCorteISO) || null;
}
```

Teste antes de implementar (quatro faixas sintéticas, confirme que a certa é escolhida pela coincidência de fim com o corte, e que nenhuma faixa batendo devolve `null` sem lançar):

```js
describe('santander-cartao-pdf: extrairPeriodoCompras', () => {
  it('escolhe a faixa cujo FIM bate com a dataCorte, entre quatro faixas', () => {
    const linhas = [
      'Período das compras',
      '26/02/26 a 25/03/26  26/03/26 a 25/04/26  26/04/26 a 25/05/26  26/05/26 a 24/06/26',
    ];
    const resultado = extrairPeriodoCompras(linhas, '2026-05-25');
    assertDeepEqual(resultado, { inicio: '2026-04-26', fim: '2026-05-25' });
  });

  it('nenhuma faixa batendo com o corte devolve null, sem lancar', () => {
    const linhas = ['26/02/26 a 25/03/26'];
    assertEqual(extrairPeriodoCompras(linhas, '2026-12-31'), null);
  });

  it('sem dataCorte conhecida, devolve null direto (nao ha o que comparar)', () => {
    assertEqual(extrairPeriodoCompras(['26/02/26 a 25/03/26'], null), null);
  });
});
```

- [ ] **Step 8: `santander-cartao-pdf-extrair.js` — extração de texto (browser-only)**

Crie o segundo arquivo (ver "Divisão em dois arquivos" acima). Extração de texto portada do app anterior — `clusterRowsFromItems`, `reconstructSegment`, `reconstructPageLines`, `extractLines`, `getPageItems`. **Uma correção deliberada em relação ao original**: o app anterior tinha o nome real do usuário hardcoded em `LABEL_LINE_RE` (`TITULAR EXEMPLO|@\s*RENE`) — funcionava só porque era um app de um usuário só, mas não pode entrar num repositório público, e também não generalizava para outro titular. A versão abaixo reconhece a **forma estrutural** da linha de cabeçalho de cartão (mesmo padrão de `CARD_HEADER_RE` do outro arquivo) em vez de um nome específico — funciona para qualquer titular, sem dado pessoal no código-fonte.

Sem testes automatizados (depende de `pdf.js` real, é browser-only) — só a verificação manual do Step 9.

```js
// Extração de texto de PDF via pdf.js — browser-only, sem equivalente
// testável em Node. A lógica de parsing de linha (que é testável) mora em
// santander-cartao-pdf.js; este arquivo só produz as linhas de texto que
// aquele consome.

function clusterRowsFromItems(items, yTol = 2.2) {
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const rows = [];
  let cur = [];
  let curY = null;
  for (const it of sorted) {
    if (curY === null || Math.abs(it.y - curY) <= yTol) {
      cur.push(it);
      curY = curY === null ? it.y : curY;
    } else {
      rows.push(cur);
      cur = [it];
      curY = it.y;
    }
  }
  if (cur.length) rows.push(cur);
  return rows.map((r) => r.sort((a, b) => a.x - b.x).map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim());
}

const COMPLETE_ROW_RE = /^(?:\S+\s+)?\d{2}\/\d{2}\s+.+\d,\d{2}\s*$/;
// Reconhece linha de cabeçalho de cartão pela FORMA estrutural (mesmo padrão
// do CARD_HEADER_RE em santander-cartao-pdf.js), não por nome de pessoa —
// o app anterior tinha o nome real do usuário hardcoded aqui, o que não
// pode se repetir num repositório público nem generaliza para outro titular.
const LABEL_LINE_RE = /^(Parcelamentos|Despesas|Pagamento e Demais|VALOR TOTAL|Compra\s+Data|Detalhamento da Fatura|Resumo da Fatura|IOF DESPESA|@?[^-]+-\s*\d{4}\s*XXXX\s*XXXX\s*\d{4})/i;

function scoreCompleteness(lines) {
  return lines.reduce((n, l) => n + ((COMPLETE_ROW_RE.test(l) || LABEL_LINE_RE.test(l)) ? 1 : 0), 0);
}

function reconstructSegment(items, depth = 0) {
  if (!items.length || depth > 4) return clusterRowsFromItems(items);
  const xs = [...new Set(items.map((it) => Math.round(it.x)))].sort((a, b) => a - b);
  const noSplitLines = clusterRowsFromItems(items);
  if (xs.length < 2) return noSplitLines;

  let bestLines = noSplitLines;
  let bestScore = scoreCompleteness(noSplitLines);

  for (let i = 0; i < xs.length - 1; i++) {
    const gap = xs[i + 1] - xs[i];
    if (gap < 35) continue;
    const mid = (xs[i] + xs[i + 1]) / 2;
    const left = items.filter((it) => it.x < mid);
    const right = items.filter((it) => it.x >= mid);
    if (left.length < 5 || right.length < 5) continue;
    const combined = [...reconstructSegment(left, depth + 1), ...reconstructSegment(right, depth + 1)];
    const combinedScore = scoreCompleteness(combined);
    if (combinedScore > bestScore) { bestLines = combined; bestScore = combinedScore; }
  }
  return bestLines;
}

function clusterRowsWithY(items, yTol = 2.2) {
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const rows = [];
  let cur = [];
  let curY = null;
  for (const it of sorted) {
    if (curY === null || Math.abs(it.y - curY) <= yTol) {
      cur.push(it);
      curY = curY === null ? it.y : curY;
    } else {
      rows.push({ y: curY, items: cur });
      cur = [it];
      curY = it.y;
    }
  }
  if (cur.length) rows.push({ y: curY, items: cur });
  return rows.map(({ y, items: r }) => ({ y, text: r.sort((a, b) => a.x - b.x).map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim() }));
}

function reconstructPageLines(items, alreadyInDetail) {
  if (!items.length) return { lines: [], stillInDetail: alreadyInDetail };

  const rough = clusterRowsWithY(items);
  let yTop = null;
  let yFooter = null;
  for (const { y, text } of rough) {
    if (/Detalhamento da Fatura/i.test(text)) yTop = yTop === null ? y : Math.max(yTop, y);
    if (/Juros e Custo Efetivo Total/i.test(text)) yFooter = yFooter === null ? y : Math.max(yFooter, y);
  }

  const inDetailAtStart = alreadyInDetail || yTop !== null;
  if (!inDetailAtStart) return { lines: [], stillInDetail: false };

  const hi = yTop !== null ? yTop + 3 : Math.max(...items.map((it) => it.y)) + 1;
  const lo = yFooter !== null ? yFooter + 3 : Math.min(...items.map((it) => it.y)) - 1;
  const bandItems = items.filter((it) => it.y >= lo && it.y <= hi);

  let lines = reconstructSegment(bandItems);
  if (yTop !== null) lines = ['Detalhamento da Fatura', ...lines];
  return { lines, stillInDetail: true };
}

async function getPageItems(page) {
  const content = await page.getTextContent();
  return content.items
    .filter((it) => it.str && it.str.trim().length > 0)
    .map((it) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));
}

export async function extractLines(doc) {
  const allLines = [];
  let inDetail = false;
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const items = await getPageItems(page);
    const { lines, stillInDetail } = reconstructPageLines(items, inDetail);
    inDetail = stillInDetail;
    allLines.push(...lines);
    if (lines.some((l) => /^Resumo da Fatura/i.test(l.trim()))) break;
  }
  return allLines;
}
```

- [ ] **Step 9: `vencimentoFromText` + `detectar`/`parse`/`register` — completar `santander-cartao-pdf.js`**

O app anterior extraía o vencimento preferencialmente do NOME do arquivo (`Visa-DD-MM-AAAA.pdf`), porque era a convenção pessoal de um usuário só com um cartão. O app novo é multi-cartão e não pode depender de convenção de nome de arquivo — **só o texto do PDF** (rótulo "Vencimento" impresso), que é o que já funcionava como fallback no app anterior e não depende de ninguém ter renomeado nada.

Escreva o teste primeiro, em `tests/santander-cartao-pdf.test.js` (junto dos demais):

```js
describe('santander-cartao-pdf: vencimentoFromText', () => {
  it('acha a data de vencimento pelo rotulo "Vencimento" em linha propria, olhando as 2 linhas seguintes', () => {
    const linhas = ['Fatura', 'Vencimento', 'irrelevante', '25/06/2026', 'resto'];
    const d = vencimentoFromText(linhas);
    assertEqual(d.getFullYear(), 2026);
    assertEqual(d.getMonth(), 5); // junho
    assertEqual(d.getDate(), 25);
  });

  it('acha tambem quando "Vencimento" e a data estao na MESMA linha', () => {
    const d = vencimentoFromText(['Vencimento: 25/06/2026']);
    assertEqual(d.getDate(), 25);
  });

  it('sem nenhum rotulo de vencimento reconhecivel, devolve null', () => {
    assertEqual(vencimentoFromText(['nada aqui']), null);
  });
});
```

Implemente em `santander-cartao-pdf.js` (portado do app anterior, mesma lógica):

```js
function vencimentoFromText(linhas) {
  for (let i = 0; i < linhas.length; i++) {
    if (/^Vencimento$/i.test(linhas[i].trim())) {
      for (let j = i + 1; j < Math.min(i + 3, linhas.length); j++) {
        const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(linhas[j]);
        if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      }
    }
    const inline = /Vencimento\D+(\d{2})\/(\d{2})\/(\d{4})/i.exec(linhas[i]);
    if (inline) return new Date(parseInt(inline[3], 10), parseInt(inline[2], 10) - 1, parseInt(inline[1], 10));
  }
  return null;
}

export function toISOExportado(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
```

Rode `node tools/run-tests.mjs` e confirme PASS nos três testes acima antes de seguir. Agora complete o adaptador, importando `extractLines` do arquivo do Step 8:

```js
import { extractLines } from './santander-cartao-pdf-extrair.js';

async function getPdfjs() {
  const lib = await import('../../vendor/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
  return lib;
}

async function parse(arrayBuffer, opcoes) {
  const pdfjsLib = await getPdfjs();
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const linhas = await extractLines(doc);

  const vencimentoDate = vencimentoFromText(linhas);
  if (!vencimentoDate) {
    throw new Error('Não consegui identificar a data de vencimento desta fatura (procurei o rótulo "Vencimento" no texto do PDF).');
  }
  const vencimentoISO = toISOExportado(vencimentoDate);

  const dataCorteDate = extractCutoffDateDeLinhas(linhas, vencimentoDate);
  const dataCorteISO = dataCorteDate ? toISOExportado(dataCorteDate) : null;
  const periodoCompras = extrairPeriodoCompras(linhas, dataCorteISO);

  const { rows, checksum, avisos } = parseFaturaTexto(linhas, opcoes.arquivo, vencimentoDate);
  if (!dataCorteISO) avisos.push('Não encontrei a data de corte no PDF — a janela de conciliação vai usar uma estimativa.');

  return {
    statement: {
      tipo: 'fatura', contaId: opcoes.contaId, adaptador: 'santander-cartao-pdf',
      arquivo: opcoes.arquivo, importadoEm: Date.now(),
      vencimento: vencimentoISO,
      dataCorte: dataCorteISO,
      periodoCompras,
      totalImpresso: checksum.sections.reduce((soma, s) => soma + s.expected, 0),
      rows,
    },
    rows, avisos, checksum,
  };
}

function detectar() {
  // O registry já filtra por extensão (.pdf); todo arquivo que chega aqui
  // já passou por esse filtro, então pontua 1 sem checagem adicional —
  // não há hoje um segundo adaptador de PDF para desempatar contra.
  return 1;
}

register({ id: 'santander-cartao-pdf', label: 'Fatura Santander (PDF)', aceita: ['.pdf'], detectar, parse });
```

- [ ] **Step 10: Verificação manual no navegador com um dos PDFs reais**

Servidor local, importe um dos três PDFs de `Faturas/` pela UI (ainda sem tela de Conciliação pronta — use um harness de teste manual em `tools/`, análogo ao `test-parser.html` do app anterior, criado só pra esta verificação). Confirme: checksum fecha, todas as linhas de despesa/parcelamento aparecem, a linha de pagamento de fatura aparece com `secao:'pagamentos_creditos'`, plástico e período de compras extraídos corretamente. **Não** commite nenhum artefato dessa verificação manual (nem print, nem texto extraído).

- [ ] **Step 11: Commit**

```bash
git add vendor/pdf.min.mjs vendor/pdf.worker.min.mjs tests/santander-cartao-pdf.test.js tests/fixtures/fatura-texto-sintetica.js src/importers/santander-cartao-pdf.js src/importers/santander-cartao-pdf-extrair.js
git commit -m "Adiciona adaptador de fatura Santander PDF, com plastico e periodo de compras"
```

---

### Task 6: `importers/santander-extrato-xls.js` — extrato de conta corrente

Diferente da Task 5, este adaptador é **novo** — o app anterior não lia extrato nenhum, só fatura de cartão. A estrutura vem inteira da spec (6.3), sem algoritmo de referência para portar. Mesmo padrão de fronteira pura/impura da Task 5: `parseLinhasExtrato` (pura, recebe matriz de células já lida) é testável em Node; só `parse` (que chama `XLSX.read`) toca a biblioteca vendorizada, e por isso é browser-only.

**Files:**
- Create: `src/importers/santander-extrato-xls.js`
- Test: `tests/santander-extrato-xls.test.js`

**Interfaces:**
- Consumes: `importers/registry.js` (`register`), `domain/classification.js` (`canonicalizar`), `core/money.js` (`parseMoneyBR`), `core/ids.js` (`stableHash`)
- Produces: registra `santander-extrato-xls`; exporta `parseLinhasExtrato(linhas, contaId, arquivo)` pura, onde `linhas` é matriz de células (array de arrays de string) no formato que `XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })` produz.

- [ ] **Step 1: Escrever os testes da parte pura**

Crie `tests/santander-extrato-xls.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { parseLinhasExtrato } from '../src/importers/santander-extrato-xls.js';

// Matriz sintética no formato de linhas/células que sheet_to_json({header:1})
// produziria — estrutura da spec 6.3, dados 100% fictícios.
function planilhaSintetica(over) {
  const base = [
    ['EXTRATO DE CONTA CORRENTE'],
    ['Conta: 0001-123456-7'],
    ['Extrato de 01/05/2026 a 31/05/2026'],
    [],
    ['Data', 'Descrição', 'Docto', 'Situação', 'Crédito (R$)', 'Débito (R$)', 'Saldo (R$)'],
    ['01/05/2026', 'SALDO ANTERIOR', '', '', '', '', '1.000,00'],
    ['03/05/2026', 'PIX RECEBIDO   Fulano de Tal', '000123', 'Efetivada', '250,00', '', '1.250,00'],
    ['05/05/2026', 'PIX ENVIADO   Beltrano da Silva', '000124', 'Efetivada', '', '-100,00', '1.150,00'],
    ['10/05/2026', 'TARIFA MANUTENCAO CONTA', '000125', 'Efetivada', '', '-30,00', '1.120,00'],
    ['31/05/2026', 'TOTAL', '', '', '250,00', '-130,00', '1.120,00'],
  ];
  return over ? over(base) : base;
}

describe('santander-extrato-xls: parseLinhasExtrato', () => {
  it('extrai contaId, periodo e saldo inicial/final do cabecalho e rodape', () => {
    const { statement } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(statement.periodoInicio, '2026-05-01');
    assertEqual(statement.periodoFim, '2026-05-31');
    assertEqual(statement.saldoInicial, 1000);
    assertEqual(statement.saldoFinal, 1120);
  });

  it('gera uma linha normalizada por lancamento, pulando SALDO ANTERIOR e TOTAL', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(rows.length, 3);
  });

  it('credito e debito viram sinal e valor SEMPRE positivo', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    const pix = rows.find((r) => r.descricao.includes('Fulano'));
    assertEqual(pix.sinal, 'credito');
    assertEqual(pix.valor, 250);
    const enviado = rows.find((r) => r.descricao.includes('Beltrano'));
    assertEqual(enviado.sinal, 'debito');
    assertEqual(enviado.valor, 100, 'valor sempre positivo, mesmo a celula de debito vindo negativa');
  });

  it('documento vem da coluna Docto', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(rows.find((r) => r.descricao.includes('Fulano')).documento, '000123');
  });

  it('saldo da linha vem da coluna Saldo (R$)', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(rows.find((r) => r.descricao.includes('Fulano')).saldo, 1250);
  });

  it('descricaoCanonica calculada com escopo extrato (separa tipo/contraparte)', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(rows.find((r) => r.descricao.includes('Fulano')).descricaoCanonica, 'FULANO DE TAL');
  });

  it('tipoDetectado e a parte ANTES do espaco duplo, para casar padroesExtrato depois', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(rows.find((r) => r.descricao.includes('Fulano')).tipoDetectado, 'PIX RECEBIDO');
  });

  it('linha sem contraparte (sem espaco duplo): tipoDetectado e descricaoCanonica sao o texto inteiro', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    const tarifa = rows.find((r) => r.descricao.includes('TARIFA'));
    assertEqual(tarifa.tipoDetectado, 'TARIFA MANUTENCAO CONTA');
    assertEqual(tarifa.descricaoCanonica, 'TARIFA MANUTENCAO CONTA');
  });

  it('checksum fecha quando saldoInicial + creditos - debitos = saldoFinal', () => {
    const { checksum } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assert(checksum.ok, JSON.stringify(checksum));
  });

  it('checksum acusa divergencia', () => {
    const quebrada = planilhaSintetica((linhas) => {
      const copia = linhas.map((l) => [...l]);
      copia[5][6] = '999,00'; // mexe no saldo anterior, sem tocar nos lancamentos
      return copia;
    });
    const { checksum, avisos } = parseLinhasExtrato(quebrada, 'acc_1', 'extrato.xls');
    assert(!checksum.ok);
    assert(avisos.some((a) => /não bate/i.test(a)));
  });

  it('id de cada linha e deterministico entre duas chamadas iguais', () => {
    const r1 = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    const r2 = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertDeepEqual(r1.rows.map((r) => r.id), r2.rows.map((r) => r.id));
  });

  it('contaId se propaga pra cada linha (necessario pro casamento por conta na conciliacao)', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assert(rows.every((r) => r.contaId === 'acc_1'));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tools/run-tests.mjs`
Expected: FALHOU (módulo não existe).

- [ ] **Step 3: Implementar a parte pura**

```js
// Adaptador de extrato de conta corrente Santander (.xls, BIFF8). A leitura
// da planilha em si (parse, que chama XLSX.read) é browser-only; o parsing
// da matriz de células já lida (parseLinhasExtrato) é PURO e testável em Node.

import { register } from './registry.js';
import { canonicalizar } from '../domain/classification.js';
import { parseMoneyBR } from '../core/money.js';
import { stableHash } from '../core/ids.js';

function celula(linha, i) { return String((linha && linha[i]) || '').trim(); }

function dataBRparaISO(txt) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(txt);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function parseLinhasExtrato(linhas, contaId, arquivo) {
  const avisos = [];
  let agencia = null, numero = null, periodoInicio = null, periodoFim = null;
  let headerIdx = -1;

  for (let i = 0; i < linhas.length; i++) {
    const primeira = celula(linhas[i], 0);
    const contaMatch = /Conta:\s*(\d+)-(\d+[\d-]*)/.exec(primeira);
    if (contaMatch) { agencia = contaMatch[1]; numero = contaMatch[2]; }
    const periodoMatch = /Extrato de (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/.exec(primeira);
    if (periodoMatch) { periodoInicio = dataBRparaISO(periodoMatch[1]); periodoFim = dataBRparaISO(periodoMatch[2]); }
    if (/^Data$/i.test(primeira) && /Descri/i.test(celula(linhas[i], 1)) && /Saldo/i.test(celula(linhas[i], 6))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    return { statement: { periodoInicio, periodoFim, saldoInicial: null, saldoFinal: null }, rows: [], avisos: ['Não encontrei o cabeçalho de tabela do extrato — arquivo fora do formato esperado.'] };
  }

  let saldoInicial = null;
  let saldoFinal = null;
  let somaCreditos = 0;
  let somaDebitos = 0;
  const rows = [];
  let ordinal = 0;

  for (let i = headerIdx + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const descricaoCol = celula(l, 1);
    const dataISO = dataBRparaISO(celula(l, 0));
    const saldoCol = parseMoneyBR(celula(l, 6));

    if (/^SALDO ANTERIOR$/i.test(descricaoCol)) { saldoInicial = saldoCol; continue; }
    if (/^TOTAL$/i.test(descricaoCol)) { saldoFinal = saldoCol; break; }
    if (!dataISO) continue; // linha de rodapé/consolidado, sem data — ignorada

    const creditoTxt = celula(l, 4);
    const debitoTxt = celula(l, 5);
    const credito = creditoTxt ? parseMoneyBR(creditoTxt) : null;
    const debito = debitoTxt ? parseMoneyBR(debitoTxt) : null;
    if (credito === null && debito === null) continue;

    const sinal = credito !== null ? 'credito' : 'debito';
    const valor = Math.abs(credito !== null ? credito : debito);
    if (sinal === 'credito') somaCreditos += valor; else somaDebitos += valor;

    const partes = descricaoCol.split(/\s{2,}/).filter(Boolean);
    const tipoDetectado = partes.length > 1 ? partes[0] : descricaoCol;
    const descricaoCanonica = canonicalizar(descricaoCol, 'extrato');
    const documento = celula(l, 2) || null;

    rows.push({
      id: stableHash([contaId, dataISO, valor, descricaoCol, documento, ordinal++]),
      data: dataISO, valor, sinal, descricao: descricaoCol, descricaoCanonica,
      documento, tipoDetectado, saldo: saldoCol, contaId, raw: l.join(' | '),
      parcela_atual: null, parcela_total: null, cartaoFinal: null, secao: null, valorUSD: null,
    });
  }

  const checksum = { ok: false, saldoInicial, saldoFinal, somaCreditos, somaDebitos };
  if (saldoInicial !== null && saldoFinal !== null) {
    const esperado = saldoInicial + somaCreditos - somaDebitos;
    checksum.ok = Math.abs(esperado - saldoFinal) < 0.02;
    if (!checksum.ok) avisos.push(`Saldo calculado (R$ ${esperado.toFixed(2)}) não bate com o saldo final do extrato (R$ ${saldoFinal.toFixed(2)}).`);
  } else {
    avisos.push('Não encontrei "SALDO ANTERIOR" e/ou "TOTAL" — não foi possível validar o extrato automaticamente.');
  }

  return {
    statement: { agencia, numero, periodoInicio, periodoFim, saldoInicial, saldoFinal },
    rows, avisos, checksum,
  };
}

function detectar(matriz) {
  let pontuacao = 0;
  const primeiras = (matriz || []).slice(0, 10).map((l) => celula(l, 0));
  if (primeiras.some((t) => /^EXTRATO DE CONTA CORRENTE$/i.test(t))) pontuacao += 0.4;
  if (primeiras.some((t) => /^Conta:/i.test(t))) pontuacao += 0.3;
  if ((matriz || []).slice(0, 15).some((l) => /^Data$/i.test(celula(l, 0)) && /Descri/i.test(celula(l, 1)))) pontuacao += 0.3;
  return pontuacao;
}

async function lerMatriz(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', codepage: 1252 });
  const primeiraAba = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[primeiraAba], { header: 1, raw: false, defval: '' });
}

async function parse(arrayBuffer, opcoes) {
  const matriz = await lerMatriz(arrayBuffer);
  const { statement, rows, avisos, checksum } = parseLinhasExtrato(matriz, opcoes.contaId, opcoes.arquivo);
  return {
    statement: { ...statement, tipo: 'extrato', contaId: opcoes.contaId, adaptador: 'santander-extrato-xls', arquivo: opcoes.arquivo, importadoEm: Date.now(), rows },
    rows, avisos, checksum,
  };
}

register({
  id: 'santander-extrato-xls', label: 'Extrato Santander (.xls)', aceita: ['.xls', '.xlsx'],
  detectar: async (buffer) => detectar(await lerMatriz(buffer)),
  parse,
});
```

- [ ] **Step 4: Rodar de novo**

Run: `node tools/run-tests.mjs`
Expected: PASS em todos os testes de `santander-extrato-xls.test.js`.

- [ ] **Step 5: Verificar contra o arquivo real, sem copiar nada dele pro repositório**

Mesma disciplina de privacidade da Task 5: abra `07 Financeiro/Gastos/Extrato Santander 01-05-2026 - 30-06-2026.xls` num harness fora do repositório (ou temporariamente apontando pro caminho absoluto num teste manual não commitado), confirme que `detectar` pontua alto, que o checksum fecha, e que a separação tipo/contraparte por `\s{2,}` realmente ocorre no arquivo real como a spec descreve — **isto é o único ponto de toda a task que não foi validado contra dado real antes de escrever o parser**, porque não havia parser de extrato no app anterior pra medir primeiro. Se o formato real divergir da fixture sintética em algum detalhe (nome exato de coluna, código de página, formato de `Conta:`), ajuste o parser e adicione um teste sintético novo que cubra o caso encontrado — não ajuste só pra fazer aquele arquivo específico passar.

- [ ] **Step 6: Commit**

```bash
git add tests/santander-extrato-xls.test.js src/importers/santander-extrato-xls.js
git commit -m "Adiciona adaptador de extrato Santander xls"
```

---

### Task 7: `importers/generic-table.js` — CSV/XLS de qualquer banco, mapeamento manual

Diferente das Tasks 5-6, este adaptador nunca tenta adivinhar o formato — o usuário mapeia as colunas uma vez (na tela de Conciliação, Task 12) e o mapeamento fica salvo em `accounts.mapeamentoImportacao` para reuso. `detectar` pontua **sempre baixo** de propósito: é a rede de segurança para bancos sem adaptador dedicado, nunca deve vencer `santander-extrato-xls`/`santander-cartao-pdf` na pontuação automática.

**Files:**
- Create: `src/importers/generic-table.js`
- Test: `tests/generic-table.test.js`

**Interfaces:**
- Consumes: `importers/registry.js`, `domain/classification.js` (`canonicalizar`), `core/money.js` (`parseMoneyBR`), `core/ids.js` (`stableHash`)
- Produces: registra `generic-table`; exporta `parseLinhasGenerico(linhas, mapeamento, contaId, arquivo)` pura. `mapeamento = { colData, colDescricao, colValor, colDocumento, temCabecalho, escopo }` — índices de coluna (0-based) na matriz de linhas; `escopo` é `'fatura'` ou `'extrato'`, escolhido pelo usuário, usado só para `canonicalizar`.

- [ ] **Step 1: Escrever os testes da parte pura**

Crie `tests/generic-table.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { parseLinhasGenerico } from '../src/importers/generic-table.js';

function mapeamentoPadrao() {
  return { colData: 0, colDescricao: 1, colValor: 2, colDocumento: 3, temCabecalho: true, escopo: 'extrato' };
}

describe('generic-table: parseLinhasGenerico', () => {
  const linhas = [
    ['Data', 'Historico', 'Valor', 'Doc'],
    ['01/06/2026', 'Compra Loja X', '-50,00', '111'],
    ['02/06/2026', 'Recebimento Y', '200,00', '222'],
  ];

  it('pula a linha de cabecalho quando temCabecalho e true', () => {
    const { rows } = parseLinhasGenerico(linhas, mapeamentoPadrao(), 'acc_1', 'generico.csv');
    assertEqual(rows.length, 2);
  });

  it('nao pula nenhuma linha quando temCabecalho e false', () => {
    const semCabecalho = linhas.slice(1);
    const { rows } = parseLinhasGenerico(semCabecalho, { ...mapeamentoPadrao(), temCabecalho: false }, 'acc_1', 'generico.csv');
    assertEqual(rows.length, 2);
  });

  it('valor negativo vira sinal debito e valor absoluto positivo; positivo vira credito', () => {
    const { rows } = parseLinhasGenerico(linhas, mapeamentoPadrao(), 'acc_1', 'generico.csv');
    assertEqual(rows[0].sinal, 'debito');
    assertEqual(rows[0].valor, 50);
    assertEqual(rows[1].sinal, 'credito');
    assertEqual(rows[1].valor, 200);
  });

  it('descricaoCanonica usa o escopo do mapeamento', () => {
    const { rows } = parseLinhasGenerico(linhas, { ...mapeamentoPadrao(), escopo: 'fatura' }, 'acc_1', 'generico.csv');
    assertEqual(rows[0].descricaoCanonica, 'COMPRA LOJA X');
  });

  it('linha com data invalida ou valor ilegivel e pulada, com aviso — nao quebra o import inteiro', () => {
    const comLinhaRuim = [...linhas, ['data-invalida', 'Lixo', 'abc', '999']];
    const { rows, avisos } = parseLinhasGenerico(comLinhaRuim, mapeamentoPadrao(), 'acc_1', 'generico.csv');
    assertEqual(rows.length, 2, 'a linha ruim nao deve gerar linha normalizada');
    assert(avisos.length > 0);
  });

  it('id deterministico entre duas chamadas iguais', () => {
    const r1 = parseLinhasGenerico(linhas, mapeamentoPadrao(), 'acc_1', 'generico.csv');
    const r2 = parseLinhasGenerico(linhas, mapeamentoPadrao(), 'acc_1', 'generico.csv');
    assertDeepEqual(r1.rows.map((r) => r.id), r2.rows.map((r) => r.id));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tools/run-tests.mjs`
Expected: FALHOU (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// Adaptador genérico: colunas mapeadas manualmente pelo usuário na tela de
// Conciliação (Task 12), não adivinhadas. Serve para qualquer banco sem
// adaptador dedicado. `detectar` pontua sempre baixo — nunca deve vencer um
// adaptador que reconheça o formato de verdade.

import { register } from './registry.js';
import { canonicalizar } from '../domain/classification.js';
import { parseMoneyBR } from '../core/money.js';
import { stableHash } from '../core/ids.js';

function dataParaISO(txt) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(txt || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseLinhasGenerico(linhas, mapeamento, contaId, arquivo) {
  const avisos = [];
  const rows = [];
  const dados = mapeamento.temCabecalho ? (linhas || []).slice(1) : (linhas || []);
  let ordinal = 0;

  for (const l of dados) {
    const dataISO = dataParaISO(l[mapeamento.colData]);
    const descricao = String(l[mapeamento.colDescricao] || '').trim();
    const valorBruto = parseMoneyBR(String(l[mapeamento.colValor] || '').trim());
    if (!dataISO || !descricao || valorBruto === null) {
      avisos.push(`Linha ignorada por dado ilegível: ${JSON.stringify(l)}`);
      continue;
    }
    const documento = mapeamento.colDocumento != null ? String(l[mapeamento.colDocumento] || '').trim() || null : null;
    const valor = Math.abs(valorBruto);
    const sinal = valorBruto < 0 ? 'debito' : 'credito';
    rows.push({
      id: stableHash([contaId, dataISO, valor, descricao, documento, ordinal++]),
      data: dataISO, valor, sinal, descricao,
      descricaoCanonica: canonicalizar(descricao, mapeamento.escopo),
      documento, tipoDetectado: null, saldo: null, contaId, raw: l.join ? l.join(' | ') : String(l),
      parcela_atual: null, parcela_total: null, cartaoFinal: null, secao: null, valorUSD: null,
    });
  }

  return { rows, avisos, checksum: { ok: true, sections: [], nota: 'Formato genérico não tem total impresso para validar automaticamente.' } };
}

function detectar() {
  return 0.05; // rede de segurança: nunca vence um adaptador que reconhece o formato de verdade
}

async function lerMatriz(arrayBuffer, nomeArquivo) {
  const isCsv = /\.csv$/i.test(nomeArquivo || '');
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(arrayBuffer), { type: 'string' })
    : XLSX.read(arrayBuffer, { type: 'array' });
  const primeiraAba = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[primeiraAba], { header: 1, raw: false, defval: '' });
}

async function parse(arrayBuffer, opcoes) {
  const matriz = await lerMatriz(arrayBuffer, opcoes.arquivo);
  const { rows, avisos, checksum } = parseLinhasGenerico(matriz, opcoes.mapeamento, opcoes.contaId, opcoes.arquivo);
  return {
    statement: { tipo: opcoes.mapeamento.escopo, contaId: opcoes.contaId, adaptador: 'generic-table', arquivo: opcoes.arquivo, importadoEm: Date.now(), rows },
    rows, avisos, checksum,
  };
}

register({ id: 'generic-table', label: 'Planilha genérica (mapeamento manual)', aceita: ['.csv', '.xls', '.xlsx'], detectar, parse });
```

- [ ] **Step 4: Rodar de novo**

Run: `node tools/run-tests.mjs`
Expected: PASS em todos os testes de `generic-table.test.js`.

- [ ] **Step 5: Commit**

```bash
git add tests/generic-table.test.js src/importers/generic-table.js
git commit -m "Adiciona adaptador generico de planilha com mapeamento manual"
```

---

### Task 8: `domain/reconcile-card.js` — conciliação de fatura

**Porta** `runReconciliation`/`buildFullReconciliationRows`/`getReconciliationWindow` do app anterior (já validados em produção), com três extensões da spec 7.1: **(a) isolamento por cartão** — o pool de candidatos é filtrado para o grupo titular+adicionais via `plasticosDoTitular` (já existe em `domain/accounts.js`, Fase 1), então Visa e Mastercard nunca se confundem; **(b) janela de três níveis** — período impresso (Task 5) > encadeamento por `dataCorte` > estimativa de 35 dias, nesta ordem de precedência; **(c) linhas de "Pagamento e Demais Créditos" saem do balde de despesa** — ficam num bucket separado (`pagamentosCreditos`), que a Task 10 usa para a regra de registro único do pagamento de fatura.

**Files:**
- Create: `src/domain/reconcile-card.js`
- Test: `tests/reconcile-card.test.js`

**Interfaces:**
- Consumes: `domain/accounts.js` (`plasticosDoTitular`)
- Produces:
  - `getReconciliationWindow(fatura, faturasList) -> { windowStart, windowEnd, fonte }` — `fonte = 'periodo_impresso' | 'encadeamento' | 'estimativa'`
  - `runReconciliation(fatura, faturasList, transactions, accounts) -> { autoMatched, matched, faturaUnmatched, appUnmatched, pagamentosCreditos }`
  - `buildFullReconciliationRows(faturasList, allTransactions, accounts) -> row[]`

- [ ] **Step 1: Escrever os testes**

Crie `tests/reconcile-card.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { getReconciliationWindow, runReconciliation, buildFullReconciliationRows } from '../src/domain/reconcile-card.js';

const TITULAR = 'acc_cartao_titular';
const ADICIONAL = 'acc_cartao_adicional';
const OUTRO_CARTAO = 'acc_cartao_outro';
const contas = [
  { id: TITULAR, tipo: 'cartao' },
  { id: ADICIONAL, tipo: 'cartao', cartaoPaiId: TITULAR },
  { id: OUTRO_CARTAO, tipo: 'cartao' },
];

function fat(over) { return { id: 'f1', vencimento: '2026-06-01', dataCorte: '2026-05-25', contaId: TITULAR, rows: [], ...over }; }

describe('reconcile-card: getReconciliationWindow — precedencia de 3 niveis', () => {
  it('nivel 1: usa o periodo de compras IMPRESSO quando existe, ignorando encadeamento/estimativa', () => {
    const fatura = fat({ periodoCompras: { inicio: '2026-04-26', fim: '2026-05-25' } });
    const { windowStart, windowEnd, fonte } = getReconciliationWindow(fatura, [fatura]);
    assertEqual(fonte, 'periodo_impresso');
    assertEqual(windowStart.toISOString().slice(0, 10), '2026-04-26');
    assertEqual(windowEnd.toISOString().slice(0, 10), '2026-05-25');
  });

  it('nivel 2: sem periodo impresso, encadeia pelo dataCorte da fatura anterior', () => {
    const anterior = fat({ id: 'f0', vencimento: '2026-05-01', dataCorte: '2026-04-25' });
    const atual = fat({ id: 'f1', vencimento: '2026-06-01', dataCorte: '2026-05-25' });
    const { windowStart, fonte } = getReconciliationWindow(atual, [anterior, atual]);
    assertEqual(fonte, 'encadeamento');
    assertEqual(windowStart.toISOString().slice(0, 10), '2026-04-26', 'comeca no dia SEGUINTE ao corte da fatura anterior');
  });

  it('nivel 3: sem periodo impresso e sem fatura anterior, cai na estimativa de 35 dias', () => {
    const atual = fat({ vencimento: '2026-06-01', dataCorte: '2026-05-25' });
    const { windowStart, fonte } = getReconciliationWindow(atual, [atual]);
    assertEqual(fonte, 'estimativa');
    assertEqual(windowStart.toISOString().slice(0, 10), '2026-04-20', '35 dias antes do corte');
  });
});

describe('reconcile-card: runReconciliation — isolamento por cartao', () => {
  it('so pool transacoes do TITULAR e seus ADICIONAIS, nunca de outro cartao', () => {
    const fatura = fat({ dataCorte: '2026-05-25', rows: [] });
    const transactions = [
      { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-10', valor: 50 },
      { id: 't2', previsto: false, contaId: ADICIONAL, data: '2026-05-11', valor: 30 },
      { id: 't3', previsto: false, contaId: OUTRO_CARTAO, data: '2026-05-12', valor: 40 },
    ];
    const { appUnmatched } = runReconciliation(fatura, [fatura], transactions, contas);
    assertDeepEqual(appUnmatched.map((t) => t.id).sort(), ['t1', 't2'], 't3 (outro cartao) nunca pode aparecer aqui, mesmo estando na janela de datas certa');
  });

  it('linha da secao pagamentos_creditos NUNCA entra nos baldes de despesa, so em pagamentosCreditos', () => {
    const fatura = fat({
      dataCorte: '2026-05-25',
      rows: [{ tipo: 'despesa', secao: 'pagamentos_creditos', data: '2026-05-05', descricao: 'DEB AUTOM DE FATURA EM C/', valor: 200, vencimento: '2026-06-01' }],
    });
    const { autoMatched, matched, faturaUnmatched, pagamentosCreditos } = runReconciliation(fatura, [fatura], [], contas);
    assertEqual(autoMatched.length + matched.length + faturaUnmatched.length, 0);
    assertEqual(pagamentosCreditos.length, 1);
  });

  it('despesa avulsa casa por valor e ate 2 dias de diferenca de data', () => {
    const fatura = fat({ dataCorte: '2026-05-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-10', descricao: 'LOJA X', valor: 50, vencimento: '2026-06-01' }] });
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-11', valor: 50 };
    const { matched } = runReconciliation(fatura, [fatura], [t], contas);
    assertEqual(matched.length, 1);
  });

  it('conciliadoAutomaticamente:true no lancamento do app vai pro balde autoMatched, nao matched', () => {
    const fatura = fat({ dataCorte: '2026-05-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-10', descricao: 'LOJA X', valor: 50, vencimento: '2026-06-01' }] });
    const t = { id: 't1', previsto: false, conciliadoAutomaticamente: true, contaId: TITULAR, data: '2026-05-10', valor: 50 };
    const { autoMatched, matched } = runReconciliation(fatura, [fatura], [t], contas);
    assertEqual(autoMatched.length, 1);
    assertEqual(matched.length, 0);
  });

  it('previsto:true nunca entra no pool de candidatos (nao e lancamento efetivado)', () => {
    const fatura = fat({ dataCorte: '2026-05-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-10', descricao: 'LOJA X', valor: 50, vencimento: '2026-06-01' }] });
    const t = { id: 't1', previsto: true, contaId: TITULAR, data: '2026-05-10', valor: 50 };
    const { matched, faturaUnmatched } = runReconciliation(fatura, [fatura], [t], contas);
    assertEqual(matched.length, 0);
    assertEqual(faturaUnmatched.length, 1);
  });
});

describe('reconcile-card: buildFullReconciliationRows', () => {
  it('lancamento sem cartao correspondente em nenhuma fatura sai como "Só no app"', () => {
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-10', valor: 50, descricao: 'Solto' };
    const rows = buildFullReconciliationRows([], [t], contas);
    assertEqual(rows.length, 1);
    assertEqual(rows[0].status, 'Só no app');
  });

  it('nao reaproveita o MESMO lancamento em duas faturas diferentes', () => {
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-10', valor: 50, descricao: 'X' };
    const f1 = fat({ id: 'f1', dataCorte: '2026-05-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-10', descricao: 'X', valor: 50, vencimento: '2026-06-01' }] });
    const f2 = fat({ id: 'f2', vencimento: '2026-07-01', dataCorte: '2026-06-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-10', descricao: 'X', valor: 50, vencimento: '2026-07-01' }] });
    const rows = buildFullReconciliationRows([f1, f2], [t], contas);
    const conciliados = rows.filter((r) => r.status.startsWith('Conciliado'));
    assertEqual(conciliados.length, 1, 'o lancamento so pode casar com UMA das duas faturas');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tools/run-tests.mjs`
Expected: FALHOU (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// Conciliação de fatura — PORTADO de reconcile.js do app anterior, já
// validado em produção. Três extensões da spec 7.1: isolamento por cartão
// (plasticosDoTitular), janela de três níveis (getReconciliationWindow), e
// linhas de "Pagamento e Demais Créditos" saem do balde de despesa.

import { plasticosDoTitular } from './accounts.js';
import { computeParcelaKey } from './parcelas.js';

const POOL_SLACK_DAYS = 3;

function dateDiffDays(iso1, iso2) {
  return Math.abs((new Date(iso1) - new Date(iso2)) / 86400000);
}

function closestIndexByKey(pool, key, referenceDate) {
  let bestIdx = -1, bestDiff = Infinity;
  pool.forEach((e, i) => {
    if (e.used || e.parcelaKey !== key) return;
    const diff = dateDiffDays(e.data, referenceDate);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  });
  return bestIdx;
}

// Nível 1 (período impresso) > nível 2 (encadeamento pelo dataCorte da
// fatura anterior) > nível 3 (estimativa de 35 dias). O nível 1 é
// estritamente mais preciso — não depende da fatura anterior ter sido
// importada — e por isso vence sempre que existir.
export function getReconciliationWindow(fatura, faturasList) {
  if (fatura.periodoCompras && fatura.periodoCompras.inicio && fatura.periodoCompras.fim) {
    return {
      windowStart: new Date(fatura.periodoCompras.inicio + 'T00:00:00'),
      windowEnd: new Date(fatura.periodoCompras.fim + 'T00:00:00'),
      fonte: 'periodo_impresso',
    };
  }
  const sorted = [...faturasList].sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));
  const idx = sorted.findIndex((f) => f.vencimento === fatura.vencimento);
  const windowEnd = fatura.dataCorte ? new Date(fatura.dataCorte) : new Date(fatura.vencimento);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  if (prev && prev.dataCorte) {
    const windowStart = new Date(prev.dataCorte);
    windowStart.setDate(windowStart.getDate() + 1);
    return { windowStart, windowEnd, fonte: 'encadeamento' };
  }
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - 35);
  return { windowStart, windowEnd, fonte: 'estimativa' };
}

function getPoolWindow(fatura, faturasList) {
  const { windowStart, windowEnd } = getReconciliationWindow(fatura, faturasList);
  const poolStart = new Date(windowStart); poolStart.setDate(poolStart.getDate() - POOL_SLACK_DAYS);
  const poolEnd = new Date(windowEnd); poolEnd.setDate(poolEnd.getDate() + POOL_SLACK_DAYS);
  return { poolStart, poolEnd, windowStart, windowEnd };
}

function poolDoCartao(fatura, transactions, accounts) {
  const plasticos = new Set(plasticosDoTitular(fatura.contaId, accounts));
  return (transactions || []).filter((t) => !t.previsto && plasticos.has(t.contaId));
}

export function runReconciliation(fatura, faturasList, transactions, accounts) {
  const itensDespesa = (fatura.rows || []).filter((r) => r.secao !== 'pagamentos_creditos');
  const pagamentosCreditos = (fatura.rows || []).filter((r) => r.secao === 'pagamentos_creditos');

  const { poolStart, poolEnd, windowStart, windowEnd } = getPoolWindow(fatura, faturasList);
  const appPool = poolDoCartao(fatura, transactions, accounts)
    .filter((t) => new Date(t.data) >= poolStart && new Date(t.data) <= poolEnd)
    .map((t) => ({ ...t, used: false, dentroDaJanela: new Date(t.data) >= windowStart && new Date(t.data) <= windowEnd }));

  const autoMatched = [];
  const matched = [];
  const faturaUnmatched = [];

  itensDespesa.forEach((item) => {
    let idx = -1;
    if (item.tipo === 'parcelamento') {
      const key = computeParcelaKey(item.descricao, item.data, item.parcela_total);
      idx = closestIndexByKey(appPool, key, item.vencimento);
      if (idx < 0) idx = appPool.findIndex((t) => !t.used && Math.abs(t.valor - item.valor) < 0.01);
    } else {
      idx = appPool.findIndex((t) => !t.used && Math.abs(t.valor - item.valor) < 0.01 && dateDiffDays(t.data, item.data) <= 2);
    }
    if (idx >= 0) {
      appPool[idx].used = true;
      const bucket = appPool[idx].conciliadoAutomaticamente ? autoMatched : matched;
      bucket.push({ fatura: item, app: appPool[idx] });
    } else {
      faturaUnmatched.push(item);
    }
  });
  const appUnmatched = appPool.filter((t) => !t.used && t.dentroDaJanela);

  return { autoMatched, matched, faturaUnmatched, appUnmatched, pagamentosCreditos };
}

export function buildFullReconciliationRows(faturasList, allTransactions, accounts) {
  const pool = (allTransactions || []).filter((t) => !t.previsto).map((t) => ({ ...t, used: false }));
  const rows = [];
  const sorted = [...faturasList].sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));

  sorted.forEach((fatura) => {
    const plasticos = new Set(plasticosDoTitular(fatura.contaId, accounts));
    const { poolStart, poolEnd } = getPoolWindow(fatura, faturasList);
    (fatura.rows || []).filter((r) => r.secao !== 'pagamentos_creditos').forEach((item) => {
      let idx = -1;
      if (item.tipo === 'parcelamento') {
        const key = computeParcelaKey(item.descricao, item.data, item.parcela_total);
        idx = closestIndexByKey(pool, key, item.vencimento);
        if (idx < 0) idx = pool.findIndex((t) => !t.used && plasticos.has(t.contaId) && new Date(t.data) >= poolStart && new Date(t.data) <= poolEnd && Math.abs(t.valor - item.valor) < 0.01);
      } else {
        idx = pool.findIndex((t) => !t.used && plasticos.has(t.contaId) && new Date(t.data) >= poolStart && new Date(t.data) <= poolEnd && Math.abs(t.valor - item.valor) < 0.01 && dateDiffDays(t.data, item.data) <= 2);
      }
      const parcela = item.parcela_atual ? `${item.parcela_atual}/${item.parcela_total}` : '';
      if (idx >= 0) {
        const t = pool[idx];
        t.used = true;
        rows.push({ status: t.conciliadoAutomaticamente ? 'Conciliado (automático)' : 'Conciliado', vencimentoFatura: fatura.vencimento, dataFatura: item.data, descricaoFatura: item.descricao, parcela, valorFatura: item.valor, dataLancamento: t.data, descricaoLancamento: t.descricao, categoria: t.categoria, valorLancamento: t.valor });
      } else {
        rows.push({ status: 'Só na fatura', vencimentoFatura: fatura.vencimento, dataFatura: item.data, descricaoFatura: item.descricao, parcela, valorFatura: item.valor, dataLancamento: '', descricaoLancamento: '', categoria: '', valorLancamento: '' });
      }
    });
  });

  pool.filter((t) => !t.used).forEach((t) => {
    rows.push({ status: 'Só no app', vencimentoFatura: '', dataFatura: '', descricaoFatura: '', parcela: '', valorFatura: '', dataLancamento: t.data, descricaoLancamento: t.descricao, categoria: t.categoria, valorLancamento: t.valor });
  });

  rows.sort((a, b) => {
    const da = a.dataLancamento || a.dataFatura, db = b.dataLancamento || b.dataFatura;
    return da < db ? -1 : da > db ? 1 : 0;
  });
  return rows;
}
```

- [ ] **Step 4: Rodar de novo**

Run: `node tools/run-tests.mjs`
Expected: PASS em todos os testes de `reconcile-card.test.js`.

- [ ] **Step 5: Sabotar o isolamento por cartão e confirmar que o teste específico cai**

Troque temporariamente `poolDoCartao` para devolver `transactions.filter(t => !t.previsto)` sem filtrar por `plasticos`.
Run: `node tools/run-tests.mjs`
Expected: FALHOU em `'so pool transacoes do TITULAR e seus ADICIONAIS...'`. Reverta antes de continuar.

- [ ] **Step 6: Commit**

```bash
git add tests/reconcile-card.test.js src/domain/reconcile-card.js
git commit -m "Porta conciliacao de fatura com isolamento por cartao e janela de 3 niveis"
```

---

### Task 9: `domain/reconcile-bank.js` — conciliação de extrato, natureza automática

**Módulo novo** — o app anterior não tinha extrato. A etapa 1 (atribuição de natureza) é o mecanismo central que impede a dupla contagem entre extrato e fatura (spec 7.2): antes de qualquer casamento, toda linha do extrato recebe uma `natureza`, e só `despesa` soma no total.

**Files:**
- Create: `src/domain/reconcile-bank.js`
- Test: `tests/reconcile-bank.test.js`

**Interfaces:**
- Consumes: `domain/accounts.js` (`contaQueCasaDescricao`, `TIPO_CARTAO`), `domain/classification.js` (`canonicalizar`)
- Produces:
  - `atribuirNatureza(linha, accounts, apelidosTitular) -> { natureza, contaCasadaId }`
  - `confrontarFaturaDebito(linha, statementsFatura) -> { faturaId, valorFatura, diferenca, aviso } | null` — só quando `natureza === 'pagamento_fatura'`
  - `runReconciliationBank(extrato, transactions) -> { autoMatched, matched, extratoUnmatched, appUnmatched }`

- [ ] **Step 1: Escrever os testes de `atribuirNatureza`**

Crie `tests/reconcile-bank.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { atribuirNatureza, confrontarFaturaDebito, runReconciliationBank } from '../src/domain/reconcile-bank.js';
import { TIPO_CARTAO, TIPO_CONTA } from '../src/domain/accounts.js';

const CARTAO = { id: 'acc_cartao_1', tipo: TIPO_CARTAO, matchers: ['MASTER CARD FINAL 0000'] };
const OUTRA_CONTA_PROPRIA = { id: 'acc_poupanca', tipo: TIPO_CONTA, matchers: ['JOAO DA SILVA'] };
const accounts = [CARTAO, OUTRA_CONTA_PROPRIA];
const apelidos = ['JOAO DA SILVA', 'JOAO SILVA'];

function linha(over) { return { descricao: '', sinal: 'debito', valor: 100, data: '2026-05-04', ...over }; }

describe('reconcile-bank: atribuirNatureza', () => {
  it('descricao casa matcher de CARTAO em linha de debito: pagamento_fatura', () => {
    const l = linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', sinal: 'debito' });
    const { natureza, contaCasadaId } = atribuirNatureza(l, accounts, apelidos);
    assertEqual(natureza, 'pagamento_fatura');
    assertEqual(contaCasadaId, CARTAO.id);
  });

  it('mesma descricao mas CREDITO (estorno de pagamento, por exemplo) NAO vira pagamento_fatura', () => {
    const l = linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', sinal: 'credito' });
    assertEqual(atribuirNatureza(l, accounts, apelidos).natureza, 'receita', 'so debito confirma pagamento de fatura; credito cai na regra de sinal');
  });

  it('contraparte casa apelido do titular: transferencia', () => {
    const l = linha({ descricao: 'PIX ENVIADO   JOAO DA SILVA', sinal: 'debito' });
    assertEqual(atribuirNatureza(l, accounts, apelidos).natureza, 'transferencia');
  });

  it('contraparte casa OUTRA CONTA cadastrada (nao so apelido pessoal): transferencia', () => {
    const l = linha({ descricao: 'TED ENVIADA   JOAO DA SILVA', sinal: 'debito' });
    assertEqual(atribuirNatureza(l, accounts, []).natureza, 'transferencia', 'casou pelo matcher da conta cadastrada, sem apelido nenhum configurado');
  });

  it('sinal credito sem nenhum matcher: receita', () => {
    const l = linha({ descricao: 'PIX RECEBIDO   Fulano Desconhecido', sinal: 'credito' });
    assertEqual(atribuirNatureza(l, accounts, apelidos).natureza, 'receita');
  });

  it('debito sem nenhum matcher: despesa (o caso default)', () => {
    const l = linha({ descricao: 'COMPRA LOJA QUALQUER', sinal: 'debito' });
    assertEqual(atribuirNatureza(l, accounts, apelidos).natureza, 'despesa');
  });

  it('precedencia: pagamento_fatura vence sobre transferencia quando os dois matchers, por acaso, casassem', () => {
    // Cenario de borda deliberado: um apelido do titular casando por acidente
    // na mesma descricao de um debito de fatura — pagamento_fatura e mais
    // especifico e tem que vencer.
    const l = linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000 JOAO DA SILVA', sinal: 'debito' });
    assertEqual(atribuirNatureza(l, accounts, apelidos).natureza, 'pagamento_fatura');
  });
});

describe('reconcile-bank: confrontarFaturaDebito', () => {
  const statementsFatura = [
    { id: 's1', tipo: 'fatura', contaId: CARTAO.id, vencimento: '2026-06-01', totalImpresso: 123.01 },
    { id: 's2', tipo: 'fatura', contaId: CARTAO.id, vencimento: '2026-05-01', totalImpresso: 200 },
  ];

  it('vincula a fatura de VENCIMENTO MAIS PROXIMO da data do debito', () => {
    const l = linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', valor: 123.01, data: '2026-05-04' });
    const resultado = confrontarFaturaDebito({ ...l, contaCasadaId: CARTAO.id }, statementsFatura);
    assertEqual(resultado.faturaId, 's1');
    assertEqual(resultado.aviso, null, 'valores batem, sem aviso');
  });

  it('gera aviso NAO BLOQUEANTE quando o valor debitado diverge do total da fatura', () => {
    const l = linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', valor: 100, data: '2026-05-04' });
    const resultado = confrontarFaturaDebito({ ...l, contaCasadaId: CARTAO.id }, statementsFatura);
    assertEqual(resultado.faturaId, 's1');
    assert(resultado.aviso !== null);
    assertEqual(resultado.diferenca, 23.01);
  });
});

describe('reconcile-bank: runReconciliationBank — 4 baldes e idempotencia', () => {
  it('so DESPESA soma — pagamento_fatura/transferencia/receita ficam de fora do total mesmo conciliados', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [
      linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', valor: 100, data: '2026-05-04' }),
      linha({ descricao: 'COMPRA MERCADO', valor: 50, sinal: 'debito', data: '2026-05-05' }),
    ] };
    const { extratoUnmatched } = runReconciliationBank(extrato, [], accounts, apelidos, []);
    const pagamentoFatura = extratoUnmatched.find((l) => l.natureza === 'pagamento_fatura');
    const despesa = extratoUnmatched.find((l) => l.natureza === 'despesa');
    assert(pagamentoFatura && despesa);
  });

  it('casamento por valor/data com tolerancia de 2 dias e conta compativel', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [linha({ descricao: 'COMPRA MERCADO', valor: 50, sinal: 'debito', data: '2026-05-05' })] };
    const t = { id: 't1', previsto: false, natureza: 'despesa', contaId: 'acc_corrente_1', data: '2026-05-06', valor: 50 };
    const { matched } = runReconciliationBank(extrato, [t], accounts, apelidos, []);
    assertEqual(matched.length, 1);
  });

  it('lancamento de OUTRA conta nao casa, mesmo com valor/data identicos', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [linha({ descricao: 'COMPRA MERCADO', valor: 50, sinal: 'debito', data: '2026-05-05' })] };
    const t = { id: 't1', previsto: false, natureza: 'despesa', contaId: 'acc_corrente_OUTRA', data: '2026-05-05', valor: 50 };
    const { matched, extratoUnmatched } = runReconciliationBank(extrato, [t], accounts, apelidos, []);
    assertEqual(matched.length, 0);
    assertEqual(extratoUnmatched.length, 1);
  });

  it('lancamento SEM conta definida ainda casa (regra: extrato bate com contaId do lancamento OU lancamento sem conta)', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [linha({ descricao: 'COMPRA MERCADO', valor: 50, sinal: 'debito', data: '2026-05-05' })] };
    const t = { id: 't1', previsto: false, natureza: 'despesa', contaId: null, data: '2026-05-05', valor: 50 };
    const { matched } = runReconciliationBank(extrato, [t], accounts, apelidos, []);
    assertEqual(matched.length, 1);
  });

  it('empate de candidatos: vence o de descricao canonica mais parecida', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [linha({ descricao: 'COMPRA SUPERMERCADO EXEMPLO', valor: 50, sinal: 'debito', data: '2026-05-05' })] };
    const longe = { id: 'longe', previsto: false, natureza: 'despesa', contaId: 'acc_corrente_1', data: '2026-05-05', valor: 50, descricao: 'Outra coisa qualquer' };
    const perto = { id: 'perto', previsto: false, natureza: 'despesa', contaId: 'acc_corrente_1', data: '2026-05-05', valor: 50, descricao: 'Supermercado Exemplo' };
    const { matched } = runReconciliationBank(extrato, [longe, perto], accounts, apelidos, []);
    assertEqual(matched[0].app.id, 'perto');
  });

  it('reimportar o MESMO extrato (mesmos ids de linha) nao duplica no balde extratoUnmatched', () => {
    const rowFixo = linha({ descricao: 'COMPRA MERCADO', valor: 50, sinal: 'debito', data: '2026-05-05', id: 'row_fixo_1' });
    const extrato = { contaId: 'acc_corrente_1', rows: [rowFixo] };
    const r1 = runReconciliationBank(extrato, [], accounts, apelidos, []);
    const r2 = runReconciliationBank(extrato, [], accounts, apelidos, []);
    assertDeepEqual(r1.extratoUnmatched.map((l) => l.id), r2.extratoUnmatched.map((l) => l.id));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tools/run-tests.mjs`
Expected: FALHOU (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// Conciliação de extrato bancário. A etapa 1 (atribuirNatureza) é o
// mecanismo que impede a dupla contagem entre extrato e fatura: roda ANTES
// de qualquer casamento, e só natureza:'despesa' soma no total (regra de
// ouro, domain/transactions.js).

import { contaQueCasaDescricao, TIPO_CARTAO } from './accounts.js';
import { canonicalizar } from './classification.js';

function dateDiffDays(iso1, iso2) {
  return Math.abs((new Date(iso1) - new Date(iso2)) / 86400000);
}

// Ordem de precedência (spec 7.2, tabela): pagamento_fatura > transferencia
// > receita (por sinal) > despesa (default). Cada nível só se aplica se o
// anterior não casou — pagamento_fatura vence mesmo que a descrição também
// contenha, por acidente, um apelido do titular.
export function atribuirNatureza(linha, accounts, apelidosTitular) {
  const cartoes = (accounts || []).filter((a) => a.tipo === TIPO_CARTAO);
  const contaCartao = contaQueCasaDescricao(linha.descricao, cartoes);
  if (linha.sinal === 'debito' && contaCartao) {
    return { natureza: 'pagamento_fatura', contaCasadaId: contaCartao.id };
  }

  const contasComoApelido = (apelidosTitular || []).map((nome) => ({ matchers: [nome] }));
  const contaTransferencia = contaQueCasaDescricao(linha.descricao, [...(accounts || []), ...contasComoApelido]);
  if (contaTransferencia) {
    return { natureza: 'transferencia', contaCasadaId: contaTransferencia.id || null };
  }

  if (linha.sinal === 'credito') return { natureza: 'receita', contaCasadaId: null };
  return { natureza: 'despesa', contaCasadaId: null };
}

// Vincula o débito de pagamento de fatura ao statement de FATURA daquele
// cartão com vencimento mais próximo da data do débito, e confronta o valor.
// A divergência é só um AVISO — pagamento parcial ou encargo são legítimos.
export function confrontarFaturaDebito(linha, statementsFatura) {
  const doCartao = (statementsFatura || []).filter((s) => s.tipo === 'fatura' && s.contaId === linha.contaCasadaId);
  if (!doCartao.length) return null;
  const maisProxima = [...doCartao].sort((a, b) => dateDiffDays(a.vencimento, linha.data) - dateDiffDays(b.vencimento, linha.data))[0];
  const diferenca = Math.round(Math.abs(maisProxima.totalImpresso - linha.valor) * 100) / 100;
  const divergiu = diferenca >= 0.02;
  return {
    faturaId: maisProxima.id,
    valorFatura: maisProxima.totalImpresso,
    diferenca,
    aviso: divergiu ? `O débito de ${linha.data} (R$ ${linha.valor.toFixed(2)}) não bate com o total da fatura vinculada (R$ ${maisProxima.totalImpresso.toFixed(2)}).` : null,
  };
}

function similaridadeCanonica(a, b) {
  const setA = new Set(canonicalizar(a, 'extrato').split(' ').filter(Boolean));
  const setB = new Set(canonicalizar(b, 'extrato').split(' ').filter(Boolean));
  if (!setA.size || !setB.size) return 0;
  let intersecao = 0;
  for (const t of setA) if (setB.has(t)) intersecao++;
  return intersecao / new Set([...setA, ...setB]).size; // Jaccard
}

export function runReconciliationBank(extrato, transactions, accounts, apelidosTitular, statementsFatura) {
  const comNatureza = (extrato.rows || []).map((linha) => ({ ...linha, ...atribuirNatureza(linha, accounts, apelidosTitular) }));

  const pool = (transactions || []).filter((t) => !t.previsto).map((t) => ({ ...t, used: false }));
  const autoMatched = [];
  const matched = [];
  const extratoUnmatched = [];

  comNatureza.forEach((linha) => {
    const candidatos = pool
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !t.used && Math.abs(t.valor - linha.valor) < 0.01 && dateDiffDays(t.data, linha.data) <= 2 && (!t.contaId || t.contaId === extrato.contaId));
    if (!candidatos.length) { extratoUnmatched.push(linha); return; }
    candidatos.sort((a, b) => similaridadeCanonica(linha.descricao, b.t.descricao) - similaridadeCanonica(linha.descricao, a.t.descricao));
    const escolhido = candidatos[0];
    pool[escolhido.i].used = true;
    const bucket = escolhido.t.conciliadoAutomaticamente ? autoMatched : matched;
    bucket.push({ extrato: linha, app: escolhido.t });
  });

  const appUnmatched = pool.filter((t) => !t.used);
  return { autoMatched, matched, extratoUnmatched, appUnmatched };
}
```

- [ ] **Step 4: Rodar de novo**

Run: `node tools/run-tests.mjs`
Expected: PASS em todos os testes de `reconcile-bank.test.js`.

- [ ] **Step 5: Sabotar a precedência e confirmar que o teste de borda cai**

Troque temporariamente a ordem em `atribuirNatureza` para checar `contaTransferencia` **antes** de `contaCartao`.
Run: `node tools/run-tests.mjs`
Expected: FALHOU só em `'precedencia: pagamento_fatura vence sobre transferencia...'`. Reverta antes de continuar.

- [ ] **Step 6: Commit**

```bash
git add tests/reconcile-bank.test.js src/domain/reconcile-bank.js
git commit -m "Adiciona conciliacao de extrato com atribuicao automatica de natureza"
```

---

### Task 10: `domain/pagamento-fatura.js` — regra de registro único

Integra as Tasks 8 e 9 (spec 7.3): um mesmo pagamento de fatura é documentado no extrato (débito, o dinheiro saindo de verdade) **e** na fatura seguinte (crédito, seção "Pagamento e Demais Créditos", só quitação do saldo). O lançamento **canônico é sempre o do extrato**. A regra precisa funcionar nas duas ordens de importação: extrato antes da fatura, e fatura antes do extrato.

**Files:**
- Create: `src/domain/pagamento-fatura.js`
- Test: `tests/pagamento-fatura.test.js`

**Interfaces:**
- Consumes: `domain/categories.js` (`CATEGORIA_A_CLASSIFICAR`)
- Produces: `processarPagamentoFatura(linhaPagamento, origemLinha, transactions, faturaVinculadaId) -> { acao: 'criado'|'complementado'|'ja_completo', transaction }` — `origemLinha = 'extrato' | 'fatura'`, `linhaPagamento = { id, statementId, descricao, valor, data, contaId }` (o `contaId` do lançamento resultante — para pagamento vindo do extrato é a conta corrente; vindo da fatura é `null`, e o casamento por valor/data com o lançamento do extrato completa depois).

- [ ] **Step 1: Escrever os testes**

Crie `tests/pagamento-fatura.test.js`:

```js
import { describe, it, assert, assertEqual } from './harness.js';
import { processarPagamentoFatura } from '../src/domain/pagamento-fatura.js';
import { CATEGORIA_A_CLASSIFICAR } from '../src/domain/categories.js';

function linhaExtrato(over) {
  return { id: 'row_extrato_1', statementId: 'stmt_extrato', descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', valor: 123.01, data: '2026-05-04', contaId: 'acc_corrente_1', ...over };
}
function linhaFatura(over) {
  return { id: 'row_fatura_1', statementId: 'stmt_fatura_junho', descricao: 'DEB AUTOM DE FATURA EM C/', valor: 123.01, data: '2026-05-04', contaId: null, ...over };
}

describe('pagamento-fatura: extrato chega ANTES da fatura', () => {
  it('cria o lancamento CANONICO a partir do extrato, natureza pagamento_fatura', () => {
    const { acao, transaction } = processarPagamentoFatura(linhaExtrato(), 'extrato', [], null);
    assertEqual(acao, 'criado');
    assertEqual(transaction.natureza, 'pagamento_fatura');
    assertEqual(transaction.origem, 'extrato');
    assertEqual(transaction.categoria, CATEGORIA_A_CLASSIFICAR);
    assertEqual(transaction.previsto, false);
  });

  it('quando a fatura seguinte chega depois com a linha correspondente, CASA em vez de criar um segundo lancamento', () => {
    const { transaction: doExtrato } = processarPagamentoFatura(linhaExtrato(), 'extrato', [], null);
    // Simula o que o chamador real faz depois de gravar: o lancamento
    // persistido ganha um id. Sem isso, doExtrato.id ficaria undefined e o
    // teste nao provaria nada sobre preservacao de id.
    const doExtratoPersistido = { ...doExtrato, id: 'tx_do_extrato_1' };
    const { acao, transaction } = processarPagamentoFatura(linhaFatura(), 'fatura', [doExtratoPersistido], 'stmt_fatura_maio_paga');
    assertEqual(acao, 'complementado');
    assertEqual(transaction.id, 'tx_do_extrato_1', 'precisa ser o MESMO lancamento do extrato, nao um novo');
  });
});

describe('pagamento-fatura: fatura chega ANTES do extrato', () => {
  it('cria o lancamento PROVISORIO a partir da fatura, com faturaVinculadaId', () => {
    const { acao, transaction } = processarPagamentoFatura(linhaFatura(), 'fatura', [], 'stmt_fatura_maio_paga');
    assertEqual(acao, 'criado');
    assertEqual(transaction.origem, 'fatura');
    assertEqual(transaction.faturaVinculadaId, 'stmt_fatura_maio_paga');
  });

  it('quando o extrato chega depois, CASA por valor/data e completa origemRef, sem duplicar', () => {
    const { transaction: daFatura } = processarPagamentoFatura(linhaFatura(), 'fatura', [], 'stmt_fatura_maio_paga');
    const daFaturaComId = { ...daFatura, id: 'tx_provisorio_1' };
    const { acao, transaction } = processarPagamentoFatura(linhaExtrato(), 'extrato', [daFaturaComId], null);
    assertEqual(acao, 'complementado');
    assertEqual(transaction.id, 'tx_provisorio_1');
    assertEqual(transaction.origemRef.statementId, 'stmt_extrato', 'origemRef passa a apontar pra linha do extrato, a fonte canonica');
  });
});

describe('pagamento-fatura: em QUALQUER ordem, resultado final e exatamente UM lancamento', () => {
  it('extrato -> fatura: 1 lancamento so, fora do total de gasto', () => {
    const r1 = processarPagamentoFatura(linhaExtrato(), 'extrato', [], null);
    const r2 = processarPagamentoFatura(linhaFatura(), 'fatura', [r1.transaction], 'stmt_fatura_maio_paga');
    assertEqual([r1, r2].filter((r) => r.acao === 'criado').length, 1);
  });

  it('fatura -> extrato: 1 lancamento so, fora do total de gasto', () => {
    const r1 = processarPagamentoFatura(linhaFatura(), 'fatura', [], 'stmt_fatura_maio_paga');
    const r2 = processarPagamentoFatura(linhaExtrato(), 'extrato', [r1.transaction], null);
    assertEqual([r1, r2].filter((r) => r.acao === 'criado').length, 1);
  });
});

describe('pagamento-fatura: reprocessar a MESMA linha nao duplica nem regride', () => {
  it('chamar de novo com o mesmo lancamento ja completo devolve ja_completo, sem mexer em nada', () => {
    const { transaction: existente } = processarPagamentoFatura(linhaExtrato(), 'extrato', [], null);
    const comId = { ...existente, id: 'tx_1' };
    const resultado = processarPagamentoFatura(linhaExtrato(), 'extrato', [comId], null);
    assertEqual(resultado.acao, 'ja_completo');
    assertEqual(resultado.transaction.id, 'tx_1');
  });
});

describe('pagamento-fatura: valores fora da tolerancia NAO casam entre si', () => {
  it('diferenca de valor >= 0.01 nao casa — cria um segundo lancamento em vez de complementar', () => {
    const { transaction: doExtrato } = processarPagamentoFatura(linhaExtrato({ valor: 123.01 }), 'extrato', [], null);
    const { acao } = processarPagamentoFatura(linhaFatura({ valor: 150.00 }), 'fatura', [doExtrato], 'x');
    assertEqual(acao, 'criado', 'valores bem diferentes nao devem ser tratados como o mesmo pagamento');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tools/run-tests.mjs`
Expected: FALHOU (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// Regra de registro único do pagamento de fatura (spec 7.3): o mesmo evento
// aparece no extrato (canônico) e na fatura seguinte (confirmação). Funciona
// nas duas ordens de importação porque a busca por um lançamento existente
// (valor+data, dentro de tolerância) é o mesmo teste não importa qual fonte
// chegou primeiro.

import { CATEGORIA_A_CLASSIFICAR } from './categories.js';

const TOLERANCIA_DIAS = 2;

export function processarPagamentoFatura(linhaPagamento, origemLinha, transactions, faturaVinculadaId) {
  const existente = (transactions || []).find((t) =>
    t.natureza === 'pagamento_fatura' &&
    Math.abs(t.valor - linhaPagamento.valor) < 0.01 &&
    Math.abs((new Date(t.data) - new Date(linhaPagamento.data)) / 86400000) <= TOLERANCIA_DIAS
  );

  if (existente) {
    if (existente.origemRef) return { acao: 'ja_completo', transaction: existente };
    return {
      acao: 'complementado',
      transaction: { ...existente, origemRef: { statementId: linhaPagamento.statementId, linhaId: linhaPagamento.id } },
    };
  }

  return {
    acao: 'criado',
    transaction: {
      descricao: linhaPagamento.descricao,
      valor: linhaPagamento.valor,
      data: linhaPagamento.data,
      natureza: 'pagamento_fatura',
      origem: origemLinha,
      origemRef: { statementId: linhaPagamento.statementId, linhaId: linhaPagamento.id },
      faturaVinculadaId: faturaVinculadaId || null,
      contaId: linhaPagamento.contaId || null,
      categoria: CATEGORIA_A_CLASSIFICAR,
      conciliadoAutomaticamente: true,
      previsto: false,
    },
  };
}
```

**Nota de wiring para a Task 12 (Conciliação, quando ligar este módulo à UI)**: quem chama precisa gerar o `id` do lançamento antes de gravar (`uid('tx')` de `core/ids.js`) quando `acao === 'criado'` — este módulo devolve o objeto sem `id` de propósito, porque decidir o id é responsabilidade de quem persiste, não de uma função pura. Quando `acao === 'complementado'` ou `'ja_completo'`, o `id` já vem preenchido dentro de `transaction` (veio do lançamento existente).

- [ ] **Step 4: Rodar de novo**

Run: `node tools/run-tests.mjs`
Expected: PASS em todos os testes de `pagamento-fatura.test.js`.

- [ ] **Step 5: Commit**

```bash
git add tests/pagamento-fatura.test.js src/domain/pagamento-fatura.js
git commit -m "Adiciona regra de registro unico do pagamento de fatura"
```

---

### Task 11: `ui/parcelas.js` — aba Parcelas

Substitui o placeholder `<p class="vazio">` de `#tabParcelas` (`index.html`) por uma tela real: lista de compras parceladas com parcelas futuras, mês a mês, agrupadas por cartão de origem (spec 9: "inalterada, exceto por passar a exibir o cartão de origem"). Puramente uma vitrine de `computeParcelaGroups` (Task 3) — não escreve nada, só lê.

**Files:**
- Create: `src/ui/parcelas.js`
- Modify: `src/app.js` (roteamento: chama `renderParcelas()` ao entrar na aba, mesmo padrão de `renderLancamentos()`)

**Interfaces:**
- Consumes: `domain/parcelas.js` (`computeParcelaGroups`), `domain/transactions.js` (`listTransactions`), `domain/accounts.js` (`listAccounts`), `ui/components.js` (`el`), `core/money.js` (`fmtBRL`)
- Produces: `async renderParcelas() -> Promise<void>`

- [ ] **Step 1: Implementar**

Padrão idêntico a `renderLancamentos()` (Fase 1): monta o painel a partir do zero a cada chamada, sem estado próprio de módulo além do necessário.

```js
// Aba Parcelas: vitrine de computeParcelaGroups (domain/parcelas.js). Não
// escreve nada — só lê transactions e mostra o que ainda falta pagar de
// cada compra parcelada, agrupado por cartão.

import { el } from './components.js';
import { fmtBRL } from '../core/money.js';
import { computeParcelaGroups } from '../domain/parcelas.js';
import { listTransactions } from '../domain/transactions.js';
import { listAccounts, TIPO_CARTAO } from '../domain/accounts.js';

export async function renderParcelas() {
  const painel = document.getElementById('tabParcelas');
  const [transactions, contas] = await Promise.all([listTransactions(), listAccounts()]);
  const cartoes = contas.filter((c) => c.tipo === TIPO_CARTAO);

  // computeParcelaGroups só enxerga LINHA DE FATURA (r.tipo === 'parcelamento'),
  // não transaction — mas cada transaction confirmada por autoConfirmParcelas
  // guarda parcela_atual/parcela_total/parcelaKey/contaId, o suficiente para
  // reconstruir a mesma entrada aqui sem duplicar a fonte de verdade.
  const porCartao = new Map(cartoes.map((c) => [c.id, []]));
  for (const c of cartoes) {
    const rowsDoGrupo = transactions
      .filter((t) => !t.previsto && t.parcelaKey && t.parcela_total && t.contaId === c.id)
      .map((t) => ({ tipo: 'parcelamento', descricao: t.descricao.replace(/\s*\(parcela prevista\)\s*$/i, ''), data: t.data, vencimento: t.data, parcela_atual: t.parcela_atual, parcela_total: t.parcela_total, valor: t.valor }));
    porCartao.set(c.id, computeParcelaGroups(rowsDoGrupo));
  }

  painel.innerHTML = '';
  const secoes = cartoes
    .filter((c) => porCartao.get(c.id).length)
    .map((c) => el('div', { class: 'secao-parcelas' }, [
      el('h3', { text: c.nome }),
      ...porCartao.get(c.id).map((g) => el('div', { class: 'grupo-parcela' }, [
        el('div', { class: 'grupo-parcela-titulo', text: `${g.descricao} — ${g.remaining} parcela(s) restante(s)` }),
        el('ul', {}, g.months.map((m) => el('li', { text: `${m.ym} — ${fmtBRL(m.valor)}` }))),
      ])),
    ]));

  painel.append(secoes.length ? el('div', {}, secoes) : el('p', { class: 'vazio', text: 'Nenhuma parcela futura no momento.' }));
}
```

- [ ] **Step 2: Ligar no roteamento**

Em `src/app.js`: import `renderParcelas` de `./ui/parcelas.js`, chame no `case 'Parcelas':` do roteador de abas (mesmo padrão de `Lancamentos`/`Cadastros`).

- [ ] **Step 3: Verificação no navegador**

Servidor local: lance uma compra parcelada manual (Task 4) com 4 parcelas, confirme que a aba Parcelas mostra as 3 restantes com o valor e mês certos, agrupadas sob o cartão certo. Zero erro no console.

- [ ] **Step 4: Commit**

```bash
git add src/ui/parcelas.js src/app.js
git commit -m "Adiciona aba Parcelas, agrupada por cartao de origem"
```

---

### Task 12: `ui/conciliacao.js` — a aba Conciliação

A maior task da fase: liga o registro de adaptadores (Task 1), os dois motores de conciliação (Tasks 8-9), a regra de registro único (Task 10) e a memória de classificação (Task 2) numa tela só. Pelo limite de ~250 linhas por arquivo, esta task entrega **quatro módulos**, cada um com uma responsabilidade:

| Arquivo | Responsabilidade |
|---|---|
| `ui/conciliacao.js` | Entrada da aba: escolha de conta/cartão e tipo de documento, delega para os outros três |
| `ui/conciliacao-import.js` | Upload, detecção/escolha de adaptador, mapeamento manual (`generic-table`), preview com checksum, commit da importação |
| `ui/conciliacao-fatura.js` | 4 baldes de uma fatura selecionada, `+lançar`, exportar conciliação completa |
| `ui/conciliacao-extrato.js` | 4 baldes de um extrato selecionado, natureza editável por linha, `+ lançar em lote` |

**Files:**
- Create: `src/ui/conciliacao.js`, `src/ui/conciliacao-import.js`, `src/ui/conciliacao-fatura.js`, `src/ui/conciliacao-extrato.js`
- Modify: `src/app.js` (roteamento)

**Interfaces:**
- Consumes: `importers/registry.js`, `domain/reconcile-card.js`, `domain/reconcile-bank.js`, `domain/pagamento-fatura.js`, `domain/parcelas.js`, `domain/classification.js`, `domain/accounts.js`, `domain/payment-methods.js` (`listFormas`, `formaPorPrefixoExtrato`), `domain/transactions.js` (`novaTransaction`, `saveTransactions`), `core/storage.js` (`getByIndex`, `put`, `putMany`, `remove` — todos já existem; nenhum `domain/statements.js` dedicado nesta fase, `conciliacao-import.js` chama `storage.put('statements', ...)` direto, sem regra de validação além do que os adaptadores já garantem), `core/ids.js` (`uid`), `ui/components.js`
- Produces: `async renderConciliacao() -> Promise<void>`

- [ ] **Step 1: `ui/conciliacao-import.js` — upload, detecção, preview, commit**

Fluxo, nesta ordem: (1) usuário escolhe conta/cartão de destino (select, já disponível no contexto que `conciliacao.js` passa) e um arquivo (`<input type=file>`); (2) `detectarMelhorAdaptador(buffer, nomeArquivo)` (Task 1) sugere o adaptador, com um `<select>` para o usuário trocar manualmente entre os candidatos de `adaptadoresParaExtensao`; (3) se o adaptador escolhido for `generic-table`, mostra a UI de mapeamento de colunas (índices de coluna para data/descrição/valor/documento, escopo fatura/extrato) **antes** de chamar `parse` — sem mapeamento, `generic-table.parse` não tem o que fazer; (4) chama `adaptador.parse(buffer, { contaId, arquivo, mapeamento })`; (5) mostra preview: contagem de linhas, `checksum.ok` com destaque visual, lista de `avisos`; se `checksum.ok === false`, botão de confirmar fica com um segundo passo de "importar mesmo assim" (`confirmar()` de `components.js`) em vez de bloquear — mesmo comportamento do app anterior; (6) ao confirmar, `commitImportacao(statement, rows, tipo, contaId)`.

`commitImportacao` é o coração da task — orquestra os módulos de domínio na ordem certa:

```js
// Grava o statement e processa as linhas importadas, na ordem que evita
// estado intermediário inconsistente: statement primeiro (para existir um
// id a referenciar em origemRef), depois parcelamento (Task 3) OU natureza
// bancária (Task 9) dependendo do tipo, depois a regra de registro único do
// pagamento de fatura (Task 10) para as linhas relevantes de QUALQUER tipo,
// por fim a classificação automática (Task 2) do que sobrou sem categoria.
export async function commitImportacao({ tipo, contaId, statement, rows, transactions, accounts, apelidosTitular, allStatements, regras, formas }) {
  const statementCompleto = { ...statement, id: `${contaId}|${tipo}|${statement.vencimento || statement.periodoFim}`, contaId, tipo };
  await storage.put('statements', statementCompleto); // core/storage.js — nenhum domain/statements.js dedicado existe nesta fase; put() genérico basta, não há regra de validação além do que os adaptadores já garantem

  if (tipo === 'fatura') {
    const rowsParcelamento = rows.filter((r) => r.tipo === 'parcelamento' && r.secao !== 'pagamentos_creditos');
    const rowsPagamento = rows.filter((r) => r.secao === 'pagamentos_creditos');
    // Mesma resolução da Fase 1 (Task 14, achado #9): busca a forma ATIVA do
    // tipo certo, nunca crava 'pm_credito' — o usuário pode ter renomeado,
    // desativado ou excluído a forma padrão antes de importar.
    const formaCredito = (formas || []).find((f) => f.tipo === 'credito' && f.ativo !== false);
    if (!formaCredito) {
      throw new Error('Cadastre uma forma de pagamento do tipo "Crédito" antes de importar uma fatura (Cadastros → Formas de pagamento).');
    }

    const { updatedTransactions, removedIds } = autoConfirmParcelas(rowsParcelamento, transactions, statementCompleto.dataCorte, contaId, formaCredito.id);
    // grava updatedTransactions (put) e remove removedIds — mesma sequência do commitFaturaImport do app anterior (Task 3, nota de ordem)
    const { toAdd, toRemoveIds } = syncPredictions(rowsParcelamento, updatedTransactions, contaId, formaCredito.id);
    // remove toRemoveIds, grava toAdd

    const statementsFaturaDoCartao = allStatements.filter((s) => s.tipo === 'fatura' && s.contaId === contaId);
    const faturaAnterior = statementsFaturaDoCartao
      .filter((s) => s.id !== statementCompleto.id && s.vencimento < statementCompleto.vencimento)
      .sort((a, b) => (a.vencimento < b.vencimento ? 1 : -1))[0];
    for (const linhaPagamento of rowsPagamento) {
      const { transaction } = processarPagamentoFatura(
        { ...linhaPagamento, statementId: statementCompleto.id },
        'fatura',
        [...updatedTransactions, ...toAdd],
        faturaAnterior ? faturaAnterior.id : null
      );
      // grava transaction (com uid('tx') se acao==='criado', ver nota da Task 10)
    }
  } else if (tipo === 'extrato') {
    const comNatureza = rows.map((linha) => ({ ...linha, ...atribuirNatureza(linha, accounts, apelidosTitular) }));
    for (const linha of comNatureza) {
      if (linha.natureza === 'pagamento_fatura') {
        const confronto = confrontarFaturaDebito(linha, allStatements.filter((s) => s.tipo === 'fatura'));
        const { transaction } = processarPagamentoFatura({ ...linha, statementId: statementCompleto.id, contaId }, 'extrato', transactions, confronto ? confronto.faturaId : null);
        // grava transaction
      }
      // transferencia/receita/despesa NAO criam lancamento sozinhas aqui — ficam
      // disponiveis pra "+lancar"/"+lancar em lote" na tela de extrato (Step 3),
      // com a natureza ja sugerida preenchida no formulario
    }
  }
}
```

Escreva o teste desta orquestração como teste de **integração de domínio** (não de UI — chama `commitImportacao`-equivalente sem tocar `storage`, recebendo os arrays já prontos e conferindo o que seria gravado) em `tests/conciliacao-import.test.js`: fatura com 1 parcelamento e 1 pagamento gera exatamente 1 previsão nova (parcela restante) e 1 lançamento de pagamento_fatura sem duplicar; extrato com 1 linha de pagamento_fatura mais 3 despesas gera 1 lançamento de pagamento_fatura e nenhum lançamento para as despesas (ficam para o lote); reimportar a mesma fatura duas vezes não duplica nada (ids determinísticos de Tasks 3/5 garantem isso — escreva o teste que prova).

- [ ] **Step 2: `ui/conciliacao-fatura.js` — 4 baldes de fatura + export**

`renderBaldesFatura(fatura, faturasList, transactions, accounts)` chama `runReconciliation` (Task 8) e desenha quatro listas (mesmos rótulos do app anterior: "Conciliado automaticamente", "Conciliado", "Na fatura, não lançado no app", "No app, não na fatura"). Cada item de "não lançado no app" tem um botão `+ lançar` que preenche a aba Lançamentos (via `sessionStorage` ou um pequeno estado de módulo exportado, lido por `lancamentos.js` no próximo render — mesmo espírito do `pendingParcelaKey` do app anterior) e troca de aba. Um botão "Exportar conciliação completa" chama `buildFullReconciliationRows` (Task 8) e usa `XLSX.utils.json_to_sheet`/`writeFile`, mesmo padrão de `backup-xlsx.js`.

- [ ] **Step 3: `ui/conciliacao-extrato.js` — 4 baldes de extrato + lançar em lote**

`renderBaldesExtrato(extrato, transactions, accounts, apelidosTitular, categorias, formas, regras)` chama `runReconciliationBank` (Task 9). Cada linha do balde "extratoUnmatched" mostra: natureza (já atribuída por `atribuirNatureza`, com um `<select>` para o usuário corrigir — corrigir grava `naturezaSugerida` na regra aprendida via `aprenderRegra`, Task 2), categoria sugerida (via `aplicarRegra(linha, regras)`, mostrando "A Classificar" quando nenhuma regra casa), forma de pagamento sugerida (via `formaPorPrefixoExtrato(linha.tipoDetectado, formas)`, já existente da Fase 1), e um checkbox de seleção. Botão **"+ lançar em lote"** habilitado quando ≥1 linha selecionada: para cada linha selecionada, monta uma `transaction` com `novaTransaction` (`domain/transactions.js`), a natureza/categoria/forma **do estado atual do formulário daquela linha** (não recalculada — o usuário pode ter corrigido antes de lançar), `origem: 'extrato'`, `origemRef: { statementId, linhaId: linha.id }`, `classificadoAutomaticamente: !!regraAplicada`, `regraId: regraAplicada ? regraAplicada.id : null`; grava todas de uma vez com `saveTransactions` (`domain/transactions.js`, já existe). Ao lançar, se a categoria escolhida para uma linha divergir da sugerida automaticamente, chama `aprenderRegra` (Task 2) e oferece aplicar retroativamente (`candidatosRetroativos`) aos lançamentos em "A Classificar" com a mesma `descricaoCanonica`.

- [ ] **Step 4: `ui/conciliacao.js` — entrada da aba**

```js
import { el } from './components.js';
import { listAccounts, TIPO_CARTAO, TIPO_CONTA } from '../domain/accounts.js';
import * as storage from '../core/storage.js';
import { renderImportacao } from './conciliacao-import.js';
import { renderBaldesFatura } from './conciliacao-fatura.js';
import { renderBaldesExtrato } from './conciliacao-extrato.js';

let contaSelecionadaId = null;
let documentoSelecionadoId = null;

export async function renderConciliacao() {
  const painel = document.getElementById('tabConciliacao');
  const contas = await listAccounts();
  const documentos = contaSelecionadaId ? await storage.getByIndex('statements', 'by_contaId', contaSelecionadaId) : [];

  painel.innerHTML = '';
  painel.append(
    montarSeletorContaCartao(contas), // <select> agrupado: cartões primeiro (rotulados "Fatura"), contas depois ("Extrato") — spec 9
    montarSeletorDocumento(documentos),
    el('div', { id: 'painelImportacao' }),
    el('div', { id: 'painelBaldes' })
  );
  await renderImportacao(document.getElementById('painelImportacao'), contaSelecionadaId, renderConciliacao);

  const doc = documentos.find((d) => d.id === documentoSelecionadoId);
  if (doc && doc.tipo === 'fatura') await renderBaldesFatura(document.getElementById('painelBaldes'), doc, documentos, contas);
  else if (doc && doc.tipo === 'extrato') await renderBaldesExtrato(document.getElementById('painelBaldes'), doc, contas);
}
```

(`montarSeletorContaCartao`/`montarSeletorDocumento` seguem o mesmo idioma de `<select>` + `addEventListener('change', ...)` já usado em `lancamentos.js`/`cadastros-*.js` — atualizam `contaSelecionadaId`/`documentoSelecionadoId` e chamam `renderConciliacao()` de novo.)

- [ ] **Step 5: Ligar no roteamento**

Em `src/app.js`: import `renderConciliacao`, chame no `case 'Conciliacao':`.

- [ ] **Step 6: Verificação no navegador**

Servidor local: importe o extrato sintético usado nos testes da Task 6 (ou um arquivo de teste equivalente, nunca o real) por upload de verdade na tela; confirme detecção automática do adaptador, checksum, os quatro baldes, lançar em lote de 2 linhas, e que o total em Lançamentos reflete só as `despesa`. Repita com uma fatura de teste (Task 5) confirmando os quatro baldes e `+lançar`. Console sem erro.

- [ ] **Step 7: Commit**

```bash
git add tests/conciliacao-import.test.js src/ui/conciliacao*.js src/app.js
git commit -m "Adiciona aba Conciliacao: importacao, 4 baldes e lancar em lote"
```

---

### Task 13: `ui/cadastros-regras.js` — Cadastros → Regras de classificação

Última task de implementação da fase. Segue **exatamente** o padrão já estabelecido pelas seções de Cadastros da Fase 1 (`cadastros-categorias.js` é o precedente mais próximo — leia-o antes de escrever): uma `secaoRegras(aoMudar)` que a `ui/cadastros.js` já existente passa a chamar junto das outras quatro.

**Files:**
- Create: `src/ui/cadastros-regras.js`
- Modify: `src/ui/cadastros.js` (acrescenta a seção à lista de `await secao*(renderCadastros)`)

**Interfaces:**
- Consumes: `domain/classification.js` (`listRegras`, `saveRegra`, `removeRegra`), `domain/categories.js` (`listCategorias`), `ui/components.js`, `ui/cadastros-comuns.js` (`secao`, `campo`, `mostrarErros`)
- Produces: `async secaoRegras(aoMudar) -> Promise<HTMLElement>`

- [ ] **Step 1: Implementar**

```js
// Seção "Regras" da aba Cadastros: lista, edita, desativa e exclui as
// regras de classification.js. Diferente de conta/forma/categoria, uma
// regra não é referenciada por transaction via chave estrangeira — excluir
// não tem guarda de "em uso", só a confirmação padrão.

import { el, toast, abrirModal, confirmar } from './components.js';
import { secao, campo, mostrarErros } from './cadastros-comuns.js';
import { listRegras, saveRegra, removeRegra, novaRegra } from '../domain/classification.js';
import { listCategorias } from '../domain/categories.js';

const ROTULO_TIPO_MATCH = { exato: 'Exata', contem: 'Contém', regex: 'Expressão regular' };
const ROTULO_ESCOPO = { fatura: 'Fatura', extrato: 'Extrato', ambos: 'Fatura e extrato' };

export async function secaoRegras(aoMudar) {
  const [todas, categorias] = await Promise.all([listRegras(), listCategorias()]);
  const nomeCategoria = (id) => (categorias.find((c) => c.id === id) || {}).nome || '—';

  const ordenadas = [...todas].sort((a, b) => (b.acertos || 0) - (a.acertos || 0));
  const lista = el('div', { class: 'lista-cadastro' },
    ordenadas.map((r) => el('div', { class: `item-cadastro${r.ativa === false ? ' inativo' : ''}` }, [
      el('span', { class: 'item-nome', text: `${r.padrao}${r.ativa === false ? ' — desativada' : ''}` }),
      el('span', { class: 'item-meta', text: `${ROTULO_TIPO_MATCH[r.tipoMatch]} · ${ROTULO_ESCOPO[r.escopo]} · ${nomeCategoria(r.categoriaId)} · ${r.acertos || 0} acerto(s)` }),
      el('button', { class: 'btn btn-mini', text: 'Editar', onclick: () => editarRegra(r, categorias, aoMudar) }),
      el('button', { class: 'btn btn-mini', text: r.ativa === false ? 'Ativar' : 'Desativar', onclick: () => alternarAtiva(r, aoMudar) }),
      el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluirRegra(r, aoMudar) }),
    ]))
  );

  return secao('Regras de classificação', [
    ordenadas.length ? lista : el('p', { class: 'vazio', text: 'Nenhuma regra ainda. Regras nascem sozinhas quando você corrige a categoria de um lançamento importado, ou você cria uma manualmente.' }),
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: '+ Regra manual', onclick: () => editarRegra(novaRegra({ padrao: '', categoriaId: categorias[0] ? categorias[0].id : '' }), categorias, aoMudar) }),
    ]),
  ]);
}

async function editarRegra(regra, categorias, aoMudar) {
  const inpPadrao = el('input', { type: 'text', value: regra.padrao });
  const selTipoMatch = el('select', {}, Object.entries(ROTULO_TIPO_MATCH).map(([v, texto]) =>
    el('option', { value: v, text: texto, ...(v === regra.tipoMatch ? { selected: 'selected' } : {}) })
  ));
  const selEscopo = el('select', {}, Object.entries(ROTULO_ESCOPO).map(([v, texto]) =>
    el('option', { value: v, text: texto, ...(v === regra.escopo ? { selected: 'selected' } : {}) })
  ));
  const selCategoria = el('select', {}, categorias.map((c) =>
    el('option', { value: c.id, text: c.nome, ...(c.id === regra.categoriaId ? { selected: 'selected' } : {}) })
  ));

  const escolha = await abrirModal({
    titulo: regra.padrao ? 'Editar regra' : 'Nova regra',
    corpo: el('div', { class: 'form' }, [
      campo('Padrão (descrição canônica)', inpPadrao),
      campo('Tipo de correspondência', selTipoMatch),
      campo('Vale para', selEscopo),
      campo('Categoria', selCategoria),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
  if (escolha !== 'salvar') return;

  const padrao = inpPadrao.value.trim();
  if (!padrao) return mostrarErros(['O padrão não pode ficar em branco.']);
  if (selTipoMatch.value === 'regex') {
    try { new RegExp(padrao); } catch (e) { return mostrarErros([`Expressão regular inválida: ${e.message}`]); }
  }

  await saveRegra({ ...regra, padrao, tipoMatch: selTipoMatch.value, escopo: selEscopo.value, categoriaId: selCategoria.value });
  toast('Regra salva.', 'ok');
  await aoMudar();
}

async function alternarAtiva(regra, aoMudar) {
  await saveRegra({ ...regra, ativa: regra.ativa === false });
  toast(regra.ativa === false ? 'Regra ativada.' : 'Regra desativada.', 'ok');
  await aoMudar();
}

async function excluirRegra(regra, aoMudar) {
  if (!(await confirmar(`Excluir a regra "${regra.padrao}"?`))) return;
  await removeRegra(regra.id);
  toast('Excluída.', 'ok');
  await aoMudar();
}
```

- [ ] **Step 2: Ligar em `cadastros.js`**

Acrescente `import { secaoRegras } from './cadastros-regras.js';` e `await secaoRegras(renderCadastros)` à lista de seções já existente.

- [ ] **Step 3: Verificação no navegador**

Servidor local: crie uma regra manual, edite, desative (confirme o rótulo "— desativada" e o botão virar "Ativar"), exclua. Confirme que uma regra criada via `aprenderRegra` na Task 12 (corrigir categoria de uma linha lançada em lote) aparece aqui com `origem: 'aprendida'` refletido — se o rótulo de origem não estiver na lista acima, adicione (`r.origem === 'aprendida' ? 'aprendida' : 'manual'` no `item-meta`). Console sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/ui/cadastros-regras.js src/ui/cadastros.js
git commit -m "Adiciona Cadastros: Regras de classificacao"
```

---

## Gap conhecido, deliberadamente fora do escopo desta fase

Spec 9 lista "filtros por forma, conta e classificados automaticamente" para a aba Lançamentos. A Fase 1 entregou forma e classificados automaticamente; **filtro por conta ainda não tem controle na UI**, embora `filterTransactions` (domain/transactions.js) já aceite `f.contas` desde a Fase 1 — é literalmente um `<select>` a mais em `barraFiltros`, mesmo padrão do filtro de forma já existente. Não vale uma task própria nesta fase (é polimento de tela já pronta, não importação/conciliação/memória, que é o tema desta fase), mas fica registrado aqui para não se perder: adicionar na Fase 3 (Dashboard, acabamento) ou antes, se o uso real da Conciliação (que agora grava `contaId` em muito mais lançamentos do que a Fase 1) tornar a falta desse filtro incômoda na prática.

## Verificação de fim de fase

Antes de declarar a Fase 2 concluída, confirme cada item com evidência, não por impressão:

- [ ] `node tools/run-tests.mjs` termina com código 0 e nenhuma falha
- [ ] `tools/tests.html` mostra todos os testes verdes, inclusive os de navegador
- [ ] As três faturas Mastercard reais (`Faturas/`) importam com checksum fechando nas três — se alguma não fechar, o motivo é conhecido e documentado (não é "não sei por quê")
- [ ] O extrato real (`Extrato Santander 01-05-2026 - 30-06-2026.xls`) importa com checksum fechando
- [ ] Nenhum artefato derivado de documento financeiro real (texto extraído, print, PDF) foi commitado em nenhum momento — `git log --all --diff-filter=A --name-only` no histórico da branch inteira, e `git grep` por trechos de texto que só poderiam vir de um documento real, não de fixture sintética
- [ ] Uma compra que aparece nas duas fontes (extrato e fatura seguinte) gera **exatamente um** lançamento, nas duas ordens de importação (extrato→fatura e fatura→extrato) — teste manual com dado real, não só a suíte automatizada
- [ ] O total de gastos do Dashboard/Lançamentos não muda só por importar um extrato ou fatura cujas linhas já estavam representadas de outra forma (pagamento de fatura, transferência) — a regra de ouro se sustenta com dado real, não só fixture
- [ ] Reimportar a mesma fatura ou o mesmo extrato duas vezes não duplica nada (ids determinísticos) — teste manual, clicando duas vezes de propósito
- [ ] Corrigir a categoria de um lançamento importado cria/atualiza uma regra em Cadastros → Regras, e a aplica automaticamente na próxima linha com a mesma descrição canônica
- [ ] `git status --porcelain` não lista nenhum `.pdf`/`.xls`/`.xlsx`/`.csv` fora do que o `.gitignore` já bloqueia
- [ ] Nenhum número de conta, agência, final de cartão real ou nome de pessoa aparece em `git grep` no repositório (histórico inteiro da branch, não só HEAD)

Só então escreva o plano da Fase 3 (Dashboard, acabamento, documentação).

# Manual de Suporte e Assistência — Livro de Gastos

Manual para quem vai dar suporte ao usuário (humano ou assistente de IA), não para o usuário final — para isso existe `MANUAL_USUARIO.md`. Aqui o objetivo é diferente: entender a lógica interna com profundidade suficiente para (1) diferenciar um bug real de uma interpretação errada do usuário ou de uma decisão de produto proposital, e (2) ter uma base de sintomas conhecidos para agilizar o diagnóstico. Atualizado até v16 (2026-08-11).

Este documento tem dois capítulos deliberadamente separados:

- **Capítulo 1 — Suporte Nível 1**: como pensar sobre um relato de problema, sem histórico de bugs específicos. Serve tanto para triagem inicial quanto para quem nunca leu o código.
- **Capítulo 2 — Investigação Nível 2**: base de sintomas → causa → ação já validados em produção, mais técnica, com referências a arquivos e funções. Use quando o Capítulo 1 não resolveu ou quando o sintoma bate com algo já visto antes.

Para arquitetura de código (camadas, convenções, como rodar testes), ver `DOCUMENTACAO_TECNICA.md`. Para decisões de design e histórico completo de bugs corrigidos, ver `CONTEUDO_PROJETO.md` — este manual resume o que é operacionalmente relevante para suporte, mas `CONTEUDO_PROJETO.md` é a fonte mais completa.

---

# Capítulo 1 — Suporte Nível 1: como raciocinar sobre um relato

## O modelo mental do app, em uma página

O app tem exatamente **uma regra de ouro** que decide o que conta como gasto: `natureza === 'despesa' && !previsto` (`domain/transactions.js`, função `contaComoGasto`). Todo o resto — Dashboard, total do período, aba Lançamentos — deriva dessa regra. Se um valor "não está batendo", a primeira pergunta é sempre: **essa transação é despesa? Está confirmada (não é previsão)?**

O app tem duas fontes de importação, que nunca se misturam:

- **Fatura de cartão de crédito** (PDF) → aba Conciliação, sub-fluxo "Fatura". Toda compra parcelada gera 1 lançamento real (a parcela do mês desta fatura) + previsões das parcelas futuras.
- **Extrato bancário** (`.xls` ou planilha genérica) → aba Conciliação, sub-fluxo "Extrato". Cobre despesas de débito/Pix/boleto, receitas, transferências entre contas próprias, e o pagamento da fatura em si (o débito saindo da conta).

Um cartão de crédito **nunca** aparece no extrato como despesa direta — só o pagamento da fatura aparece lá, uma vez, como `pagamento_fatura` (natureza que nunca conta como gasto, para não contar a mesma compra duas vezes: uma pela fatura, outra pelo pagamento).

## Pergunta 1: o usuário está olhando o lugar certo?

Antes de investigar qualquer "não está aparecendo" ou "o total está errado", confirme com o usuário:

- **Qual aba** ele está olhando (Lançamentos, Dashboard, Parcelas)?
- **Qual filtro** está ativo (mês, ano, forma, conta, natureza, "só automáticos")? Um filtro esquecido é a causa mais comum de "sumiu".
- **A transação é despesa confirmada**, ou é receita/transferência/pagamento de fatura (nunca soma como gasto, por design) ou é uma previsão de parcela futura ainda não confirmada (também nunca soma)?

## Pergunta 2: bug, decisão de produto, ou interpretação do usuário?

Três categorias diferentes, cada uma com resposta diferente:

| Categoria | Como reconhecer | O que fazer |
|---|---|---|
| **Bug real** | O comportamento contradiz a regra documentada do próprio app (ex.: uma despesa confirmada não aparece no total). | Investigar (Capítulo 2), reproduzir com dado real do usuário quando possível, corrigir a causa raiz. |
| **Decisão de produto** | O comportamento é estranho à primeira vista, mas foi feito de propósito, documentado em `CONTEUDO_PROJETO.md` → "Decisões críticas de design". | Explicar o motivo ao usuário. NUNCA "corrigir" sem confirmar que ele realmente quer mudar a regra — pode ser um pedido de feature nova, não um bug. |
| **Interpretação errada do usuário** | O app está se comportando exatamente como projetado, mas o usuário esperava outra coisa (ex.: achava que uma previsão de parcela já contava como gasto). | Explicar o modelo mental correto. Considerar se a UI poderia deixar isso mais claro — às vezes uma "interpretação errada" recorrente é sinal de que falta um aviso na tela, não que o usuário está errado. |

Decisões de produto conhecidas que costumam ser confundidas com bug:

- **Parcela 1/n nunca confirma sozinha** — mesmo a fatura trazendo a parcela 1 de uma compra nova, ela sempre cai no balde "Na fatura, não no app", exigindo confirmação manual (via "+lançar"). Proposital: força revisão de categoria/forma antes de virar lançamento real. Só a partir da parcela 2/n a auto-confirmação age sozinha.
- **Previsões de parcela nunca contam como gasto, mesmo em "A Classificar"** — elas só existem para dar visibilidade do compromisso futuro (aba Parcelas). Confirmar a parcela é o que a transforma em gasto de verdade.
- **App é local-only, sem sincronização entre aparelhos.** A única ponte é o backup `.xlsx` manual. Se o usuário espera ver os mesmos dados no celular e no computador automaticamente, isso nunca foi implementado por design.
- **Cadastro (conta, cartão, forma, categoria) já usado em algum lançamento não pode ser excluído, só desativado.** Preserva o histórico — um cadastro desativado some dos formulários de lançamento novo, mas continua aparecendo em lançamentos antigos.

## Pergunta 3: "eu corrigi mas continua igual" — antes de tudo, é cache?

**Regra de ouro do suporte**: sempre que o usuário diz que um fix não funcionou, a PRIMEIRA coisa a checar é a versão do app exibida no rodapé do menu **Ferramentas** (`v16`, por exemplo), comparando com a versão do commit mais recente publicado. Isso já causou pelo menos 4 falsos alarmes de "bug não corrigido" documentados em `CONTEUDO_PROJETO.md`.

Como resolver:
- **Computador/navegador desktop**: force-reload (`Ctrl+Shift+R` ou `Ctrl+F5`).
- **Celular / PWA instalado**: feche o app completamente (não só minimizar) e reabra. Se não pegar, limpe cache/dados do site nas configurações do navegador (não confundir com "limpar dados do app" do Android, que apagaria o IndexedDB local).

**ATENÇÃO — a versão no rodapé NÃO é prova de que o código é novo (até v23).** O GitHub Pages manda `Cache-Control: max-age=600`, então por 10 minutos o navegador servia módulos velhos sem perguntar ao servidor, e `version.js` podia vir novo enquanto o resto vinha antigo: o app mostrava a versão nova rodando lógica antiga. Isso causou investigações inteiras em v20, v22 e v23. A partir da **v24** o app se defende sozinho (import map com `?v=APP_VERSION` + `cache: 'reload'` no service worker para HTML/version.js/modulos.js), mas ao dar suporte a um aparelho que ainda não passou pela v24, confirme o código de verdade — por exemplo, pedindo um sintoma que só a versão nova produz — antes de concluir que o fix não funcionou.

Se depois de confirmar a versão nova o problema persistir, aí sim é hora de investigar (Capítulo 2).

## Pergunta 4: dado sintético vs. dado real

Se depois das perguntas acima o problema parece real e a versão está atualizada, o próximo passo é sempre pedir o **dado real** do usuário, não tentar reproduzir "razoavelmente" — a canonicalização de texto, formatos de PDF/planilha e nomes reais têm nuances (espaçamento, acentuação, prefixos de banco) que uma reprodução sintética costuma errar. Formas de obter o dado real sem comprometer privacidade desnecessariamente:

- **Exportar backup completo** (Ferramentas → Backup → Exportar backup) — traz tudo, incluindo `statements.rows` com o texto bruto de cada linha importada.
- **Exportar "Conciliação completa"** (aba Conciliação) — mais focado, mostra o status de casamento de cada linha.
- **Exportar log** (aba Lançamentos → Exportar log) — histórico de eventos, útil para entender a sequência de ações que levou ao estado atual.

Repositório é **público** — nunca commitar nenhum desses arquivos nem colar dados pessoais em código/teste/log de auditoria.

## Quando escalar para o Capítulo 2

Escale quando: (a) o sintoma já bate com algo na tabela de sintomas conhecidos, (b) a versão está confirmada atualizada e o problema persiste, (c) o comportamento genuinamente contradiz a regra de ouro ou uma das decisões de design documentadas, sem explicação óbvia.

---

# Capítulo 2 — Investigação Nível 2: lógica interna e base de sintomas

## Vocabulário técnico essencial

| Termo | Significado |
|---|---|
| **Vencimento** | Data em que a fatura vence/é paga. Extraído do PDF. |
| **Data de corte** (`dataCorte`) | Data limite de compras incluídas NESTA fatura — depois disso, cai na próxima. |
| **Período de compras** (`periodoCompras`) | Faixa impressa na própria fatura (ex. "24/04/26 a 25/05/26") — fonte mais precisa quando existe. |
| **`previsto`** | `true` = parcela futura ainda não confirmada (não conta como gasto, id prefixo `seed_`). `false` = confirmada/real (conta como gasto se `natureza === 'despesa'`, id prefixo `confirmed_` quando auto-confirmada). |
| **`parcelaKey`** | Identidade de uma COMPRA parcelada inteira (não de uma parcela específica): `descrição normalizada + data da compra original + total de parcelas`. Heurística herdada do app anterior, não uma chave garantidamente única. |
| **`origem`** | Discriminador de proveniência de uma transação: `'manual'`, `'fatura'`, ou implícito extrato. Nunca deixa uma exportação/conciliação "roubar" uma transação da fonte errada. |
| **`origemRef`** | `{ statementId, linhaId }` — aponta para a linha exata do documento importado que gerou esta transação. Usado por `candidatosRetroativos`/`reclassificarComRegras` para nunca tocar lançamento manual puro. |
| **`faturaVencimento`** | Vencimento REAL da fatura, separado de `data` (que guarda a data de corte, usada para exibição/agrupamento por mês). Só gravado em transações confirmadas por fatura. |
| **`classificadoAutomaticamente`** | `true` quando uma regra da memória de classificação decidiu a categoria sozinha, sem intervenção do usuário naquele lançamento específico. |

## O vencimento e o período de compras da fatura, em detalhe

Cada fatura de cartão cobre um período de compras terminando na sua data de corte (geralmente ~5 dias antes do vencimento). Exemplo real (fatura de vencimento 30/05):

```
MAR.  24/02/26 a 23/03/26   ← fatura de março (já paga)
ABR.  24/03/26 a 23/04/26   ← fatura de abril (já paga)
MAI.  24/04/26 a 25/05/26   ← A FATURA ATUAL (vence 30/05)
JUN.  26/05/26 a 23/06/26   ← próxima fatura, ainda abrindo
```

Uma compra feita em 26/05 (já depois do corte de 25/05) NÃO entra na fatura de 30/05 — entra na de junho. Isso é o motivo mais comum de "essa compra devia estar nesta fatura e não está".

Para calcular esse período, o app usa 3 fontes em ordem de precedência (`getReconciliationWindow`, `domain/reconcile-card.js`):

1. **Período impresso no PDF** (mais confiável, não depende de nada mais).
2. **Encadeamento pela data de corte da fatura anterior já importada** (`dataCorte anterior + 1 dia` até `dataCorte desta`) — usado quando o PDF não trouxe o período impresso.
3. **Estimativa de 35 dias antes do corte** — último recurso, quando nem 1 nem 2 estão disponíveis (ex.: primeira fatura importada, sem histórico).

Consequência prática: se o usuário importa faturas fora de ordem cronológica, ou pula uma fatura, o Nível 2 pode ficar indisponível para a fatura seguinte (porque a "anterior" nunca foi importada) — nesse caso, cai para o Nível 3 (estimativa), que pode desalinhar o pool de conciliação em alguns dias. `POOL_SLACK_DAYS` (±3 dias de folga) absorve pequenas divergências, mas não substitui importar em ordem quando possível.

## Os 4 baldes da conciliação de fatura, com precisão

Import de fatura → `runReconciliation` (`domain/reconcile-card.js`) monta 4 grupos:

```
Para cada linha da fatura (exceto pagamentos_creditos):
  SE é parcelamento (tipo === 'parcelamento'):
    1º tenta achar por parcelaKey + data mais próxima do vencimento
    2º fallback: mesmo valor, dentro da janela de datas do cartão
  SENÃO (compra avulsa):
    valor bate (diferença < R$0,01) E data dentro de 2 dias E dentro da janela do cartão

  SE achou par não usado ainda:
    → "Conciliado automaticamente" (conciliadoAutomaticamente:true, veio de autoConfirmParcelas)
    → "Conciliado" (par achado manualmente, ex. já tinha sido lançado à mão antes)
  SENÃO:
    → "Na fatura, não no app" (usuário precisa "+lançar")

Sobra no pool (lançamentos do app) sem casar E dentro da janela:
    → "No app, não na fatura"
```

O pool de candidatos é restrito a `plasticosDoTitular` (o cartão titular + seus adicionais) — nunca mistura cartões diferentes, mesmo que tenham compras de valor/data parecidos no mesmo período.

**"Conciliado automaticamente" só existe para parcela_atual > 1** (`autoConfirmParcelas`, `domain/parcelas.js`) — é a parcela 2/n em diante de uma compra cuja parcela 1 já foi confirmada antes (em uma fatura anterior). A parcela 1/n de uma compra NOVA nunca aparece aqui — sempre cai em "Na fatura, não no app", por decisão de produto (ver Capítulo 1).

## Conciliação de extrato — diferente de fatura

`runReconciliationBank` (`domain/reconcile-bank.js`):

1. `atribuirNatureza` classifica CADA linha do extrato antes de qualquer casamento, por ordem de precedência: `pagamento_fatura` (bate matcher de cartão cadastrado + é débito) > `transferencia` (bate matcher de outra conta própria ou apelido do titular) > `receita` (crédito sem matcher) > `despesa` (default).
2. Pool de candidatos = transações não-previstas com `origem !== 'fatura'` — uma parcela confirmada por fatura pertence exclusivamente à conciliação de fatura, nunca pode ser "roubada" pela conciliação de extrato.
3. Casamento: valor bate + data dentro de 2 dias + mesma conta (ou sem conta definida).

Sintoma clássico de configuração incompleta: se um cartão não tem seus "matchers" (texto que identifica a linha do extrato como pagamento daquele cartão) bem cadastrados em Contas & Cartões, o débito da fatura no extrato cai em `despesa` genérica em vez de `pagamento_fatura` — e ENTÃO conta como gasto duas vezes (uma pela fatura, outra pelo "pagamento" mal classificado). Ver sintoma #6 abaixo.

## Pagamento de fatura — evento único, visto por dois lados

O mesmo pagamento aparece no EXTRATO (débito saindo da conta) e na FATURA seguinte (linha "pagamentos_creditos", a quitação do saldo anterior). `processarPagamentoFatura` (`domain/pagamento-fatura.js`) usa valor+data (tolerância 2 dias) para reconhecer que é o MESMO evento, não importa qual lado chegou primeiro — o segundo lado a chegar só complementa `origemRef`, nunca duplica o lançamento. O lançamento canônico é sempre o do extrato (é o único dos três "lugares" que representa movimentação de caixa de fato).

## Memória de classificação (regras) — como decide a categoria

`aplicarRegra` (`domain/classification.js`) casa uma regra a uma linha importada por `descricaoCanonica` (texto normalizado — maiúsculas, sem acento, sem prefixo de adquirente tipo "PAG*", sem sequência de 6+ dígitos de documento/NSU, sem sufixo de UF ou de parcela) e por compatibilidade de `escopo` (`'fatura'`, `'extrato'`, ou `'ambos'`).

Precedência quando mais de uma regra casa: (1) regra exata com `contaId` batendo o cartão/conta específico > (2) exata com escopo igual à origem > (3) exata com escopo `'ambos'` > (4) tipo `'contém'` > (5) tipo `'regex'`. Empate dentro do mesmo nível é decidido pelo maior `acertos`.

Regra é **aprendida** (`aprenderRegra`) quando o usuário corrige (ou confirma sem sugestão prévia) a categoria de um item vindo de importação — nunca de um lançamento 100% manual (`origem: 'manual'`), por decisão de produto: a memória "não deve opinar" sobre algo que o usuário nunca deixou o app tentar classificar sozinho.

Reaplicação retroativa a lançamentos antigos já em "A Classificar" existe em dois formatos:
- **No momento em que a regra nasce/muda** (`candidatosRetroativos`) — modal "Aplicar retroativamente?" oferecido automaticamente.
- **Sob demanda, a qualquer momento** (`reclassificarComRegras` + botão "Reaplicar regras a lançamentos existentes" em Cadastros → Regras) — cobre o caso de uma regra manual cadastrada depois que a fatura/extrato já foi importado.

Ambas exigem `t.origemRef` presente — nunca tocam lançamento manual puro.

## Propagação de categoria entre parcelas da mesma compra

Ao editar a categoria de uma transação com `parcelaKey` (aba Lançamentos), o app pergunta "Aplicar às outras parcelas?" e, se confirmado, atualiza TODAS as outras transações do mesmo `parcelaKey` com categoria diferente — tanto confirmadas quanto previsões futuras (`outrasParcelasParaAtualizar`, `domain/parcelas.js`). Separadamente, `syncPredictions` também propaga a categoria de uma parcela confirmada para as previsões recriadas na próxima importação de fatura — os dois mecanismos cobrem momentos diferentes (edição manual vs. importação nova) e não conflitam.

---

## Base de sintomas conhecidos → causa → ação

Cada linha resume um problema real já investigado (ver `CONTEUDO_PROJETO.md` para o relato completo de cada um).

### 1. "Corrigi um bug mas o app continua com o problema"

- **Causa quase sempre**: cache do service worker servindo JS antigo, `APP_VERSION` não subiu, ou o usuário não recarregou de verdade.
- **Ação**: confirmar a versão exibida no rodapé do menu Ferramentas contra o último commit publicado, ANTES de reinvestigar lógica. Force-reload (desktop) ou fechar/reabrir + limpar cache do site (celular).

### 2. "A aba Parcelas mostra o mês errado"

- **Causa possível A**: `computeParcelaGroups` usada com o parâmetro `primeiraNoMesmoMes` errado para o contexto (importação de fatura precisa `true`; consulta viva na aba Parcelas com âncora confirmada precisa `false`).
- **Causa possível B**: parcela 1/n lançada via "+lançar" sem propagar `faturaVencimento` — a projeção usava a data da compra em vez do vencimento real.
- **Causa possível C** (não é bug): a âncora disponível é uma previsão "adivinhada" (parcela 1 ainda não confirmada) — aviso visual `ancoraNaoConfirmada` já cobre isso, orientando confirmar a parcela 1.
- **Ação**: checar qual das três se aplica ANTES de propor fix — já foram 3 causas raiz diferentes empilhadas sob o mesmo sintoma relatado. Sempre re-testar com o cenário exato do usuário depois de cada fix, corrigir uma causa não significa que o sintoma sumiu.

### 3. "Regra de classificação não aplica, mesmo com descrição idêntica"

- **Causa possível A** (fatura): `aplicarRegra` nunca era chamada no fluxo de fatura — só no de extrato (bug histórico, corrigido v12).
- **Causa possível B** (extrato): a linha passada para `aplicarRegra` não carregava o campo `origem` (só `natureza`), então nenhuma regra de escopo `'extrato'` nunca casava, mesmo com texto idêntico ao padrão salvo (bug histórico, corrigido v14).
- **Ação de diagnóstico**: pedir o texto exato salvo no campo "Padrão" da regra (Cadastros → Regras → Editar) e comparar com a descrição real do item (exportar backup/conciliação para ver o texto bruto — nunca confiar em transcrição manual do usuário, espaçamento importa). Testar `canonicalizar(textoReal, escopo)` isoladamente contra o padrão salvo antes de suspeitar de outra causa.

### 4. "Editei a categoria de uma parcela, as outras não atualizaram"

- **Causa possível A**: a propagação nunca existia (implementada só na v15).
- **Causa possível B**: a v15 só propagava parcelas já confirmadas, excluindo previsões futuras — o usuário via "as seguintes continuam a classificar" porque `syncPredictions` só propaga categoria na PRÓXIMA importação de fatura, não na hora (corrigido v16).
- **Ação**: confirmar a versão é v16+; o modal "Aplicar às outras parcelas?" deve aparecer ao salvar a edição, listando quantas parcelas (confirmadas + previstas) serão afetadas.

### 5. Backup `.xlsx` parece travado ou perde dado ao reimportar

- **Causa**: célula de planilha acima do limite de 32.767 caracteres do formato XLSX — comum em `statements.rows` de extrato com muitos lançamentos (campo `raw` grande). Versões pré-v5 truncavam a célula em SILÊNCIO ao escrever (sem erro), corrompendo o dado de forma irrecuperável nesse backup específico.
- **Ação**: confirmar a versão do app no momento em que o backup problemático foi GERADO (não a atual) — um backup de uma versão pré-v5 tem o dado já perdido, reimportar não resolve. Backups de v5+ dividem células grandes em colunas extras (`campo__2`, `campo__3`...) automaticamente.

### 6. Pagamento de fatura contando como gasto duas vezes (ou nenhuma)

- **Causa mais provável**: matchers do cartão mal configurados em Contas & Cartões — o débito da fatura no extrato não é reconhecido como `pagamento_fatura` (cai em `despesa` genérica), OU o cartão nunca casa com nenhuma linha (fica sem vínculo).
- **Ação**: conferir os "matchers" cadastrados na conta do cartão contra o texto real da linha de débito no extrato (ex.: "DEBITO AUT. FAT.CARTAO..."). Sem matcher correto, `atribuirNatureza` nunca classifica como `pagamento_fatura`.

### 7. Exportação "Conciliação completa" mostra status diferente da tela ao vivo

- **Causa histórica**: `buildFullReconciliationRows` é uma função separada de `runReconciliation`/`runReconciliationBank` — já divergiu 2 vezes por terem sido escritas independentemente (ex.: export não cobria extrato bancário até v6; export "roubava" transação de fatura para o loop de extrato até correção posterior).
- **Ação**: se a tela ao vivo e o export divergem, comparar as duas funções diretamente no código — elas precisam espelhar a mesma lógica de casamento. Não é garantido que fiquem sincronizadas automaticamente.

### 8. Conta padrão de forma de pagamento não oferece cartão de crédito

- **Causa histórica**: o combo de conta padrão em Formas de Pagamento ficou hardcoded só para contas correntes, mesmo quando o tipo da forma era Crédito (corrigido antes da v11).
- **Ação**: se o sintoma reaparecer, checar se o combo em Cadastros → Formas de Pagamento filtra dinamicamente por `tipoContaParaForma(tipo)` ao trocar o tipo no mesmo formulário aberto.

### 9. Lançamento de cartão sem `contaId` nunca aparece na conciliação de nenhum cartão

- **Causa**: formulário de Lançamentos permitiu salvar uma forma do tipo Crédito sem conta/cartão selecionado — `poolDoCartao`/`plasticosDoTitular` filtram por `contaId`, então o lançamento nunca entra em nenhum pool.
- **Ação**: validação já bloqueia isso na maioria dos casos (`validateTransaction` + checagem de `tipoContaParaForma`), mas se aparecer, verificar se o lançamento problemático tem `contaId` vazio/nulo e checar a forma de pagamento usada.

### 10. "+lançar" da fatura cria lançamento duplicado a cada clique

- **Causa histórica**: o rascunho não carregava o `contaId` do próprio cartão da fatura, caindo na conta padrão da última forma usada (que podia ser outro cartão/conta) — o lançamento salvava com `contaId` errado, nunca era achado pelo pool de conciliação daquele cartão, o item continuava aparecendo em "não lançado" e cada clique gerava outro lançamento.
- **Ação**: já corrigido — o rascunho sempre carrega `contaId` explícito do cartão da fatura. Se reaparecer, checar se `itemFatura`/`montarLinhaFatura` (`conciliacao-fatura.js`) ainda propaga `contaId` corretamente no rascunho.

### 11. Fatura importada de PLANILHA sobrescreveu a do mês anterior

- **Causa**: até v20, o adaptador genérico (`generic-table.js`) não preenchia `vencimento` nem `periodoFim` no statement, e o id do documento (`idDeterministicoDoDocumento`) saía `contaId|fatura|undefined` — TODA planilha da mesma conta colidia no mesmo id. Importar junho substituía maio em silêncio, sem nem disparar o aviso de "já importado" (que compara justamente por esse id).
- **Ação**: confirmar v21+. Na tela de importação, o campo "Vencimento da fatura" é obrigatório para planilha de fatura (a tela recusa analisar sem ele). Extrato deriva o período das datas das próprias linhas. Se o usuário perdeu uma fatura assim numa versão antiga, o dado do documento anterior não é recuperável — só reimportando o arquivo original.

### 12. Compra parcelada importada de planilha não gera as parcelas futuras

- **Causa**: até v20, `parseLinhasGenerico` cravava `parcela_atual`/`parcela_total` em `null` e nunca definia `tipo`. Como `autoConfirmParcelas` e `syncPredictions` filtram por `tipo === 'parcelamento'`, a informação de parcela era lida e descartada sem aviso.
- **Ação**: confirmar v21+ e que a coluna "Parcela" foi preenchida no formato `3/10` (ou `3 de 10`). Célula vazia é compra à vista, não erro. Valores impossíveis (`7/5`, `0/5`) geram aviso na tela de análise e a linha entra como à vista. Se o usuário montou a planilha à mão, conferir se indicou o índice da coluna de parcela no mapeamento (ou usou "Usar ordem do modelo").

### 13. Planilha: linha pulada com "data inválida" justamente onde a data foi preenchida certo

- **Sintoma**: algumas linhas importam e outras não; as que falham são as que têm data DE VERDADE (célula de data do Excel), enquanto as digitadas como texto funcionam — o inverso do esperado.
- **Causa**: até v21, a leitura usava `raw: false` e recebia a string de EXIBIÇÃO da célula, no locale de quem salvou o arquivo (ex.: `"7/5/26"` — sem zero à esquerda, ano de 2 dígitos, ambíguo entre dia e mês). O regex exigia `dd/mm/aaaa` e rejeitava. Valia para os dois caminhos: `lancamentos-xlsx.js` e `generic-table.js` (fatura/extrato por planilha).
- **Ação**: confirmar v22+. Se reaparecer, inspecionar a célula crua com `XLSX.read(buf, {cellDates:true})` e olhar `t` (tipo) e `v` (valor): `t=n` com `v` numérico é data de série do Excel, e o parser tem que receber `Date`, nunca o texto `w`.

### 14. Planilha: coluna Parcela vira data e a compra entra como à vista

- **Causa**: `"3/10"` digitado numa célula de formato Geral é convertido pelo Excel em 3 de outubro; o texto original se perde no arquivo. O app não tem como recuperar a parcela sem risco de inventar um parcelamento errado, então gera aviso e trata como compra à vista.
- **Ação**: orientar a formatar a coluna Parcela como TEXTO antes de digitar (as instruções do modelo já dizem isso). Não é bug: é limitação do formato de arquivo.

### 15. Planilha de lançamentos importada duas vezes gerou duplicatas

- **Contexto**: a importação de lançamentos grava DIRETO, sem os baldes da conciliação — não há tela para revisar o casamento depois.
- **Causa (até v22)**: não havia nenhuma checagem de duplicata; reimportar o mesmo arquivo, ou dois arquivos com meses sobrepostos, criava cópias em silêncio.
- **Ação**: confirmar v23+. O modal de confirmação passa a listar as linhas com MESMA DATA e MESMO VALOR de algo já lançado, e oferece "Importar só N nova(s)". Se o usuário já criou duplicatas numa versão anterior, elas precisam ser apagadas à mão (aba Lançamentos) — o app não remove nada retroativamente.
- **Não é bug**: a heurística é data+valor de propósito, sem exigir descrição igual. Dois gastos legítimos de mesmo valor no mesmo dia (dois cafés de R$ 5,00) são marcados como possível duplicata e trazem o aviso "(descrição diferente — confira)"; cabe ao usuário escolher "Importar tudo".

### 16. Modelo de planilha importado cai no adaptador errado ("Extrato Santander")

- **Sintoma**: ao escolher `modelo-fatura.xlsx` (ou extrato/lançamentos) na aba Conciliação, o campo Adaptador vem com "Extrato Santander (.xls)" e a análise falha com "0 linha(s) lidas" e "não encontrei o cabeçalho de tabela do extrato".
- **Causa (até v24)**: os dois adaptadores aceitam `.xlsx` e quem decide é a pontuação de `detectar`. O detector do Santander dá 0.3 para qualquer planilha com "Data" na coluna 0 e "Descri..." na coluna 1 — o cabeçalho dos próprios modelos — contra 0.05 do adaptador genérico.
- **Ação**: confirmar v25+ **e** que o modelo foi baixado na v25 ou depois. Modelos antigos não têm a linha de marcador (`LIVRO DE GASTOS — MODELO ...` na primeira célula) e continuam caindo no adaptador errado: basta rebaixar o modelo em Ferramentas → Modelos de planilha. Como contorno imediato em arquivo antigo, dá para trocar o adaptador à mão para "Planilha genérica" e preencher o mapeamento de colunas.

## Checklist rápido de investigação técnica

1. Reproduzir com **dado real** do usuário sempre que possível (backup/export), não com dado sintético inventado.
2. Checar `APP_VERSION` primeiro, antes de qualquer outra coisa.
3. Rodar `node tools/run-tests.mjs` (500+ testes de lógica pura) para confirmar que a base está íntegra antes de investigar um sintoma específico.
4. Identificar a função de domínio responsável (a maior parte da lógica financeira mora em `domain/`, é pura, testável isoladamente em Node sem abrir navegador).
5. Testar a função isolada com o dado real, comparando entrada/saída esperada.
6. Se o sintoma persistir após 2 hipóteses testadas e descartadas, considerar se não é uma decisão de produto disfarçada de bug (voltar ao Capítulo 1, Pergunta 2) antes de insistir numa 3ª hipótese técnica.

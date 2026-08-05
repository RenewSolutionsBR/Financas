# Manual do Usuário — Livro de Gastos

Este manual explica como usar o aplicativo, aba por aba. Não é preciso conhecimento técnico para lê-lo.

O Livro de Gastos é um app de controle de gastos pessoais que roda inteiramente no seu navegador. Todos os dados ficam guardados só neste aparelho (no armazenamento local do navegador); nada é enviado para nenhum servidor. A única forma de levar seus dados para outro aparelho é pelo backup manual, explicado na seção Cadastros.

## Primeira execução

Ao abrir o app pela primeira vez, ele oferece um assistente para cadastrar sua primeira conta corrente e seu primeiro cartão. Você também pode pular esse passo e cadastrar depois, na aba Cadastros. Se você já usava uma versão anterior do app, é possível importar um backup dela na seção Backup de Cadastros.

## Aba Lançamentos

É a tela de uso diário: aqui você registra cada gasto, receita, transferência ou pagamento de fatura.

**Como lançar algo novo:**
1. Preencha descrição, data, valor, categoria, forma de pagamento e a conta/cartão de onde saiu o dinheiro.
2. Escolha a "natureza" do lançamento: Despesa (um gasto normal), Receita (dinheiro entrando), Transferência (movimentação entre suas próprias contas) ou Pagamento de fatura.
3. Clique em Salvar.

Só lançamentos do tipo Despesa (e que não sejam uma previsão de parcela futura) entram nas somas de gastos mostradas no Dashboard. Isso evita contar o mesmo dinheiro duas vezes — por exemplo, uma compra no cartão e o pagamento da fatura dela não são somados juntos.

**Compra parcelada:** ao marcar a opção de parcelamento, o app cria a primeira parcela como lançamento real e as parcelas seguintes como previsão (aparecem em cinza/marcadas como "prevista"). Conforme as faturas forem importadas e conciliadas, essas previsões vão sendo confirmadas automaticamente.

**Filtros:** no topo da lista você pode filtrar por mês, forma de pagamento e conta/cartão, além de mostrar só os lançamentos classificados automaticamente pela memória do app (explicada na aba Conciliação).

**Editar e excluir:** cada linha da lista tem botões para editar ou remover o lançamento.

## Aba Conciliação

É onde você importa documentos (fatura de cartão em PDF, extrato bancário) e confere se cada linha do documento já tem um lançamento correspondente no app, ou lança as que faltam.

**Como importar um documento:**
1. Escolha a conta ou cartão a que o documento pertence.
2. Escolha o arquivo (PDF de fatura ou planilha de extrato). O app tenta identificar sozinho o formato do arquivo; se não conseguir, você pode indicar manualmente qual banco/formato usar.
3. Confira o resumo antes de confirmar a importação.

**Depois de importar**, o app organiza os itens em grupos ("baldes"):
- **Conciliado (automático)**: o app já tinha uma confirmação automática de parcela e bateu.
- **Conciliado**: uma linha do documento bateu com um lançamento que já existia no app.
- **Só no documento**: apareceu na fatura/extrato mas ainda não tem lançamento correspondente. Há um botão "+ lançar" em cada item para criar o lançamento na hora, ou "+ lançar em lote" para vários de uma vez (disponível na conciliação de extrato).
- **Só no app**: existe um lançamento seu que não apareceu no documento importado — vale checar se não é um lançamento duplicado ou com data/valor errados.

**Memória de classificação:** quando você corrige a categoria (ou a forma de pagamento) de um item vindo de um documento importado, o app memoriza essa escolha. Da próxima vez que uma descrição parecida aparecer, ele já sugere (ou aplica) a mesma categoria automaticamente. Essas regras podem ser revisadas na aba Cadastros, seção Regras.

**Pagamento de fatura:** o débito do pagamento da fatura, visto no extrato da conta, e a linha de crédito correspondente na fatura seguinte do cartão são o mesmo evento financeiro. O app reconhece isso e cria apenas um único lançamento para o pagamento, não importa qual dos dois documentos você importar primeiro.

## Aba Parcelas

Uma vitrine somente de consulta (não é possível editar nada aqui) que mostra:
- Quanto você tem previsto de parcelas futuras, mês a mês, somando todos os cartões.
- O detalhamento de cada compra parcelada em aberto, agrupado por cartão.

Serve para você ter uma visão rápida do compromisso futuro assumido no cartão de crédito.

## Aba Dashboard

O painel de gastos. Mostra:
- **Total do período**: soma de tudo que conta como gasto no mês ou ano selecionado.
- **Gráfico em rosca por categoria**: mostra a proporção de cada categoria de gasto no período.
- **Barras mensais**: evolução do total de gastos nos últimos meses com dado registrado.

**Filtros disponíveis**: ano, mês, forma de pagamento e conta/cartão. Eles se combinam — por exemplo, é possível ver só os gastos de um cartão específico em um mês específico.

## Aba Cadastros

Reúne tudo que configura o app. Está dividida em seções:

**Contas & Cartões**: cadastre suas contas correntes e cartões de crédito. Um cartão pode ser marcado como "adicional" de outro (o cartão titular) — útil quando a fatura de um cartão titular também traz os gastos de um cartão adicional vinculado à mesma fatura. Contas e cartões não usados em nenhum lançamento podem ser excluídos; os que já têm histórico só podem ser desativados (ficam fora dos formulários de novos lançamentos, mas o histórico continua intacto).

**Formas de Pagamento**: cadastre e organize as formas que você usa (cartão de crédito, débito, Pix, dinheiro, boleto, etc.). Cada forma tem um "tipo" que define, por exemplo, se ela concilia com fatura, com extrato, ou com nenhum dos dois.

**Categorias**: as categorias de gasto usadas nos lançamentos e no Dashboard. A categoria "A Classificar" é fixa e não pode ser excluída — é o destino padrão de tudo que ainda não foi categorizado.

**Regras**: lista as regras aprendidas (ou criadas manualmente) pela memória de classificação. Você pode editar, desativar ou excluir cada uma.

**Backup**: exporta todos os seus dados para um arquivo `.xlsx`, que serve tanto como cópia de segurança quanto como forma de levar seus dados para outro aparelho ou navegador (importando o mesmo arquivo lá). Também é aqui que se importa um backup vindo de uma versão anterior do app.

## Dúvidas frequentes

**Meus dados estão seguros se eu limpar os dados do navegador?** Não — os dados ficam só no armazenamento local do navegador. Faça backups periódicos pela seção Backup de Cadastros.

**Por que um lançamento não aparece no total do Dashboard?** Só despesas efetivamente realizadas (não previsões de parcela futura) contam como gasto. Receitas, transferências entre suas contas e pagamentos de fatura aparecem na lista de lançamentos, mas nunca somam como gasto — isso evita contar o mesmo dinheiro duas vezes.

**O app funciona sem internet?** Sim, depois de aberto uma vez, o app funciona offline (é instalável como aplicativo no celular ou computador).

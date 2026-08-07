# Log de auditoria — Design

## Objetivo

Um log técnico de eventos que registram mudanças na base de dados local, com data/hora, para facilitar debug de problemas como os investigados nesta sessão (fatura com vencimento errado, lançamento sem conta ficando invisível na conciliação, parcelas confirmadas voltando a aparecer como pendentes). Não é um sistema de auditoria formal/imutável — é uma ferramenta de diagnóstico.

## Escopo

**Dentro do escopo:**
- Registrar eventos com timestamp, tipo e um resumo textual (contagens, nunca descrição/valor de item individual — precisa ser seguro para exportar e compartilhar em debug, já que o repositório é público).
- Guardar os eventos numa store nova do IndexedDB (`auditLog`), com limite de 500 eventos — ao ultrapassar, os mais antigos são removidos automaticamente.
- Botão "Exportar log" na aba Lançamentos (ao lado de "Backup completo"), baixando um `.json` com todos os eventos guardados, mais recente primeiro.

**Fora do escopo:**
- Tela dedicada para visualizar o log dentro do app (só exportação, por enquanto).
- Qualquer garantia de imutabilidade/à prova de adulteração — é local, no IndexedDB do próprio usuário, sem proteção especial.
- Registrar leituras (só escritas que mudam a base).

## Tipos de evento

| Tipo | Quando dispara | Exemplo de resumo |
|---|---|---|
| `importacao_fatura` | Fim de `commitImportacaoEGravar` com `tipo: 'fatura'` | "Importou fatura: 18 linhas, 10 confirmadas automaticamente, 4 previstas, 2 pagamentos" |
| `importacao_extrato` | Fim de `commitImportacaoEGravar` com `tipo: 'extrato'` | "Importou extrato: 42 linhas, 1 pagamento de fatura reconhecido" |
| `lancamento_criado` | Salvar um lançamento novo (Lançamentos, não vindo de rascunho) | "Lançamento criado" |
| `lancamento_editado` | Salvar edição de um lançamento existente | "Lançamento editado" |
| `lancamento_excluido` | Excluir um lançamento pelo ✕ na listagem | "Lançamento excluído" |
| `lancar_da_conciliacao` | Salvar um lançamento criado via "+lançar" (Conciliação) | "Lançamento criado a partir da Conciliação" |
| `cadastro_atualizado` | Salvar/editar conta, forma de pagamento ou categoria | "Cadastro de conta atualizado" |
| `apagar_transacoes` | `storage.resetTransacoes()` | "Apagou todas as transações e documentos importados" |
| `apagar_tudo` | `storage.resetAllData()` | "Apagou todos os dados do app" |
| `backup_importado` | Restaurar um backup | "Importou backup" |

Todos os resumos são texto fixo com contagens dinâmicas quando fizer sentido (importação); nunca incluem descrição, valor específico, nome de conta/cartão ou qualquer dado que identifique uma compra ou pessoa.

## Modelo de dados

```js
{
  id: 'audit_<uid>',
  timestamp: 1738900000000, // Date.now()
  tipo: 'importacao_fatura', // um dos valores da tabela acima
  resumo: 'Importou fatura: 18 linhas, 10 confirmadas automaticamente, 4 previstas, 2 pagamentos',
}
```

Nova store IndexedDB `auditLog`, `keyPath: 'id'`, sem índices adicionais (a exportação sempre lê tudo e ordena em memória). Adiciona ao schema como `DB_VERSION = 3` (migração vazia — só cria a store nova, não mexe em dado existente).

## Arquitetura

Módulo novo `src/domain/audit-log.js`:

```js
export async function registrarEvento(tipo, resumo) {
  await storage.put('auditLog', { id: uid('audit'), timestamp: Date.now(), tipo, resumo });
  await aplicarLimiteDeEventos(); // remove os mais antigos além de 500
}

export async function listarEventos() {
  const eventos = await storage.getAll('auditLog');
  return eventos.sort((a, b) => b.timestamp - a.timestamp);
}
```

Cada ponto de escrita já existente (commitImportacaoEGravar, salvar de lancamentos-form.js, excluir de lancamentos.js, salvar de cadastros-*.js, resetTransacoes/resetAllData de storage.js, importar backup de backup-comum.js) ganha uma chamada a `registrarEvento(...)` logo após a escrita real ter sucesso — sem alterar a lógica de negócio existente.

## Exportação

Função `exportarLog()` em `lancamentos.js` (ou extraída para `backup-comum.js`, junto de `baixarBackup`): lê `listarEventos()`, monta um Blob JSON, baixa como `log-financas-AAAA-MM-DD.json`. Botão ao lado de "Backup completo" no rodapé de Lançamentos.

## Testes

- `domain/audit-log.js`: `registrarEvento` grava corretamente; limite de 500 remove os mais antigos primeiro (testável com storage real via IndexedDB fake, mesmo padrão dos outros testes de storage).
- Pontos de integração: cada fluxo que já tem teste (commitImportacao, salvar lançamento, excluir, resetTransacoes) ganha uma asserção adicional de que um evento correspondente foi criado — sem duplicar toda a suíte, só adicionar a checagem no teste já existente onde fizer sentido.

// GERADO POR tools/gerar-modulos.mjs — não edite à mão.
// Rode `node tools/gerar-modulos.mjs` depois de criar ou remover um módulo.
//
// Lista de TODOS os módulos ES do app. Fonte única para dois consumidores
// que antes mantinham listas próprias e saíram de sincronia:
//
// 1. index.html — monta o import map que põe `?v=APP_VERSION` na URL de
//    cada módulo. Sem isso o navegador serve código velho do cache HTTP por
//    até 10 minutos depois de uma publicação (o GitHub Pages manda
//    `Cache-Control: max-age=600`, medido em 2026-08-13), mostrando a
//    versão nova no rodapé enquanto roda a lógica antiga.
// 2. sw.js — precache do service worker (uso offline).
export const MODULOS = [
  './src/app.js',
  './src/core/cache-policy.js',
  './src/core/dates.js',
  './src/core/db-schema.js',
  './src/core/ids.js',
  './src/core/modulos.js',
  './src/core/money.js',
  './src/core/storage.js',
  './src/core/text.js',
  './src/domain/accounts.js',
  './src/domain/audit-log.js',
  './src/domain/categories.js',
  './src/domain/classification.js',
  './src/domain/pagamento-fatura.js',
  './src/domain/parcelas.js',
  './src/domain/payment-methods.js',
  './src/domain/reconcile-bank.js',
  './src/domain/reconcile-card.js',
  './src/domain/remover-documento.js',
  './src/domain/transactions.js',
  './src/importers/backup-xlsx.js',
  './src/importers/generic-table.js',
  './src/importers/lancamentos-xlsx.js',
  './src/importers/modelos-planilha.js',
  './src/importers/registry.js',
  './src/importers/santander-cartao-pdf-datas.js',
  './src/importers/santander-cartao-pdf-extrair.js',
  './src/importers/santander-cartao-pdf.js',
  './src/importers/santander-extrato-xls.js',
  './src/ui/backup-comum.js',
  './src/ui/cadastros-categorias.js',
  './src/ui/cadastros-comuns.js',
  './src/ui/cadastros-contas.js',
  './src/ui/cadastros-formas.js',
  './src/ui/cadastros-regras.js',
  './src/ui/cadastros.js',
  './src/ui/components.js',
  './src/ui/conciliacao-extrato.js',
  './src/ui/conciliacao-fatura.js',
  './src/ui/conciliacao-import.js',
  './src/ui/conciliacao.js',
  './src/ui/dashboard.js',
  './src/ui/ferramentas.js',
  './src/ui/lancamentos-filtros.js',
  './src/ui/lancamentos-form-helpers.js',
  './src/ui/lancamentos-form.js',
  './src/ui/lancamentos-parcelado.js',
  './src/ui/lancamentos.js',
  './src/ui/onboarding.js',
  './src/ui/parcelas.js',
  './src/ui/tabs.js',
  './src/version.js',
];

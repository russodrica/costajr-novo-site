-- 102_relatorio_visita_pdf_original.sql
--
-- Relatórios antigos entram como o PDF QUE JÁ FOI EMITIDO.
--
-- Eles já foram assinados e enviados a clientes: reimprimir no layout novo
-- criaria uma segunda versão do mesmo documento, com aparência diferente da que
-- está na mão do cliente. Então guardamos o arquivo original e o portal apenas
-- o guarda, lista e entrega.
--
-- Os campos de data, número e responsável continuam preenchidos: é o que
-- permite listar, ordenar e achar o relatório sem abrir o PDF.

alter table obras_rdo add column if not exists pdf_path     text;
alter table obras_rdo add column if not exists pdf_nome     text;
alter table obras_rdo add column if not exists pdf_tamanho  bigint;

comment on column obras_rdo.pdf_path is
  'Caminho no depósito do PDF original emitido no sistema antigo. Quando preenchido, a tela entrega este arquivo em vez de montar o relatório.';

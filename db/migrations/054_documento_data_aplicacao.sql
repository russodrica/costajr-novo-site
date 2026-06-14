-- 054_documento_data_aplicacao.sql
-- Data de aplicação para documentos disciplinares (advertência / suspensão).
-- Não é vencimento — é a data em que a medida foi aplicada.
alter table rh_documentos add column if not exists data_aplicacao date;

notify pgrst, 'reload schema';

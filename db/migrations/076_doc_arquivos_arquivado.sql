-- 076_doc_arquivos_arquivado.sql
-- Histórico de versões POR ARQUIVO: cada anexo de um documento pode ser marcado
-- como "arquivado" (versão antiga). Assim o painel mostra só as versões VIGENTES
-- (não arquivadas) de cada documento, e as antigas ficam num "histórico" acessível.
-- Não confundir com doc_empresa.arquivado (que esconde o DOCUMENTO inteiro).

alter table doc_empresa_arquivos add column if not exists arquivado boolean not null default false;
alter table doc_empresa_arquivos add column if not exists arquivado_em timestamptz;

create index if not exists idx_doc_empresa_arquivos_arquivado on doc_empresa_arquivos(arquivado);

notify pgrst, 'reload schema';

-- 100_relatorio_visita_importados.sql
--
-- Relatórios trazidos do app Diário de Obra (web.diariodeobra.app).
--
-- Eles entram como REGISTRO no portal, não como anexo solto: ficam
-- pesquisáveis, saem no PDF do padrão novo e continuam existindo quando a
-- assinatura do app for encerrada. Mas não são editáveis — são histórico do
-- que foi registrado em campo, e reabrir para edição falsearia o registro.

alter table obras_rdo add column if not exists origem        text not null default 'portal';
alter table obras_rdo add column if not exists numero_origem text;
alter table obras_rdo add column if not exists link_origem   text;

do $$ begin
  alter table obras_rdo add constraint obras_rdo_origem_ck
    check (origem in ('portal', 'importado'));
exception when duplicate_object then null; end $$;

comment on column obras_rdo.origem is
  'portal = criado aqui (editável) | importado = veio do app Diário de Obra (somente leitura).';
comment on column obras_rdo.numero_origem is
  'Número do relatório no sistema de origem, para conferência com o histórico antigo.';

-- a mesma importação rodada duas vezes não duplica o relatório
create unique index if not exists idx_obras_rdo_origem_unico
  on obras_rdo(fundacao_id, data, numero_origem)
  where origem = 'importado' and fundacao_id is not null;

create index if not exists idx_obras_rdo_origem on obras_rdo(origem);

-- 103_obras_fundacao_anexos.sql
--
-- HISTÓRICO como ANEXO, não como registro editável.
--
-- Os relatórios emitidos no sistema anterior já foram assinados e enviados aos
-- clientes. Guardá-los como registro do portal — mesmo bloqueado — deixa a
-- impressão de que aquilo pode ser reaberto e mexido, e um dia alguém mexe.
-- Aqui eles viram ARQUIVO: o portal guarda, lista e entrega. Não edita.
--
-- Os relatórios NOVOS continuam em `obras_rdo`, que é o fluxo de trabalho vivo.
-- São duas coisas diferentes e agora moram em lugares diferentes.

create table if not exists obras_fundacao_anexos (
  id text primary key default gen_random_uuid()::text,
  fundacao_id text not null references obras_fundacao(id) on delete cascade,
  tipo text not null default 'relatorio',        -- relatorio | outro
  data date,                                     -- data do relatório, para ordenar
  numero text,                                   -- número no sistema de origem
  titulo text,
  responsavel text,
  storage_path text not null,
  nome_arquivo text,
  content_type text not null default 'application/pdf',
  tamanho bigint,
  origem text not null default 'diario-de-obra',
  origem_link text,
  criado_por text,
  created_at timestamptz not null default now()
);

create index if not exists idx_obras_fund_anexos on obras_fundacao_anexos(fundacao_id, data desc);

-- a mesma importação rodada duas vezes não duplica o arquivo
create unique index if not exists idx_obras_fund_anexos_unico
  on obras_fundacao_anexos(fundacao_id, data, numero) where numero is not null;

alter table obras_fundacao_anexos enable row level security;

comment on table obras_fundacao_anexos is
  'Arquivos de histórico da obra de fundação — principalmente os relatórios em PDF emitidos no sistema anterior. Somente guarda e entrega; não há edição.';

-- ─── limpeza da tentativa anterior ──────────────────────────────────────────
-- Os relatórios que entraram como registro "importado" saem: o histórico passa
-- a viver nos anexos. Nenhum relatório criado no portal é tocado.
delete from obras_rdo_fotos where rdo_id in (select id from obras_rdo where origem = 'importado');
delete from obras_rdo_checklist where rdo_id in (select id from obras_rdo where origem = 'importado');
delete from obras_rdo where origem = 'importado';

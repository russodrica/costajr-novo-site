-- 104_anexos_onedrive.sql
--
-- Histórico da fundação guardado no ONEDRIVE da empresa, não no depósito do
-- portal.
--
-- Motivo: são 1.178 relatórios, cerca de 1,3 GB. O depósito do portal tem 1 GB
-- no total e já está em 85% com o que roda hoje (RH, documentos, negócios).
-- O OneDrive corporativo já é pago e tem espaço de sobra — é onde esse acervo
-- deve morar. O portal passa a ser o índice: sabe qual relatório existe, de
-- qual obra, de que data, e entrega o link do arquivo.

alter table obras_fundacao_anexos add column if not exists armazenamento text not null default 'portal';
alter table obras_fundacao_anexos add column if not exists web_url       text;
alter table obras_fundacao_anexos add column if not exists item_id       text;

-- arquivo no OneDrive não tem caminho no depósito do portal
alter table obras_fundacao_anexos alter column storage_path drop not null;

do $$ begin
  alter table obras_fundacao_anexos add constraint obras_fund_anexos_armazenamento_ck
    check (armazenamento in ('portal', 'onedrive'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table obras_fundacao_anexos add constraint obras_fund_anexos_local_ck
    check (
      (armazenamento = 'portal'   and storage_path is not null) or
      (armazenamento = 'onedrive' and web_url is not null)
    );
exception when duplicate_object then null; end $$;

comment on column obras_fundacao_anexos.armazenamento is
  'portal = arquivo no depósito do portal | onedrive = arquivo no OneDrive da empresa, aberto pelo web_url.';
comment on column obras_fundacao_anexos.web_url is
  'Endereço do arquivo no OneDrive/SharePoint, para abrir direto.';

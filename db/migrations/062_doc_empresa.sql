-- 062_doc_empresa.sql
-- Documentos da Empresa: repositório de documentos institucionais (certidões,
-- contrato social, CNPJ, CREA/CAU, seguros, balanços, contratos de clientes e
-- de fornecedores...) — portado do board Monday "DOCUMENTOS EMPRESA".
-- Cada documento tem uma CATEGORIA (a "divisão atual" = grupos do Monday),
-- data de VALIDADE opcional (ou marcada como "não aplicável") e gera ALERTA
-- automático de vencimento (30/15/7 dias e no dia) quando houver validade.

create table if not exists doc_empresa (
  id text primary key default gen_random_uuid()::text,
  categoria text not null default 'Documentos Diversos',
  nome text not null,
  periodicidade text,                          -- Mensal / Anual / Consulta Mensal / Sem validade
  validade date,                               -- data de vencimento (null quando não aplicável ou não definida)
  validade_na boolean not null default false,  -- "não aplicável" (documento sem validade — não cobra alerta)
  site text,                                   -- link de emissão/consulta da certidão
  observacoes text,
  arquivado boolean not null default false,    -- esconde do painel sem apagar (defasados/históricos)
  monday_id text unique,                       -- idempotência do import
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table doc_empresa enable row level security;
create index if not exists idx_doc_empresa_categoria on doc_empresa(categoria);
create index if not exists idx_doc_empresa_validade on doc_empresa(validade);
create index if not exists idx_doc_empresa_arquivado on doc_empresa(arquivado);

-- Anexos (1 documento pode ter vários arquivos: 3 CRLVs, 10 certidões de cartório,
-- 2 RGs de sócios...). Bucket PRIVADO 'doc-empresa' (documentos sensíveis — LGPD).
create table if not exists doc_empresa_arquivos (
  id text primary key default gen_random_uuid()::text,
  doc_id text not null references doc_empresa(id) on delete cascade,
  nome text not null,
  storage_path text not null,
  monday_asset_id text unique,                 -- idempotência do import
  criado_por text,
  created_at timestamptz not null default now()
);
alter table doc_empresa_arquivos enable row level security;
create index if not exists idx_doc_empresa_arquivos_doc on doc_empresa_arquivos(doc_id);

notify pgrst, 'reload schema';

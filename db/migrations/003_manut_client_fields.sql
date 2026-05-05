-- Migration 003: Adiciona campos faltantes em manut_clientes e manut_lojas
-- Seguro para rodar em banco com dados existentes (ADD COLUMN IF NOT EXISTS)
-- Data: 2026-05-05

-- Campo endereco, cidade e uf no cliente (complementam manut_lojas)
-- Usados na exibição rápida do painel admin sem join
alter table manut_clientes
  add column if not exists endereco text,
  add column if not exists cidade text,
  add column if not exists uf text;

-- Campo especialidades como array de text (além de jsonb em manut_lojas)
-- Permite filtro direto no admin sem deserializar jsonb
alter table manut_lojas
  alter column especialidades type text[] using
    case
      when especialidades is null then null
      when jsonb_typeof(especialidades) = 'array' then
        array(select jsonb_array_elements_text(especialidades))
      else null
    end;

-- Índice de performance para busca por status
create index if not exists idx_manut_leads_etapa on manut_leads(etapa);
create index if not exists idx_manut_cupons_codigo on manut_cupons(codigo);

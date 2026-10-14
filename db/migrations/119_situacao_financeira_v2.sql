-- 119_situacao_financeira_v2.sql
-- Situação Financeira enxuta (pedido da Adriana, 14/10/2026): valor de quitação negociado e "quitada"
-- por dívida, protesto cancelado, lista do que há A REAVER (créditos, processos, consórcios) e plano de
-- ação novo (plano 'v2' — o 'v1' de 13/10 exigia equipe/investimento e fica só de histórico).
-- Padrão do projeto: ids text, RLS ligado sem policy (só service role), enums validados na API.

alter table fin_sf_dividas add column if not exists valor_proposta numeric;          -- valor de quitação proposto/negociado
alter table fin_sf_dividas add column if not exists proposta_obs text;               -- quem propôs, quando, condições
alter table fin_sf_dividas add column if not exists quitada boolean not null default false;
alter table fin_sf_dividas add column if not exists quitada_em date;
alter table fin_sf_dividas add column if not exists valor_pago numeric;              -- quanto custou quitar

alter table fin_sf_protestos add column if not exists cancelado boolean not null default false;
alter table fin_sf_protestos add column if not exists cancelado_em date;

alter table fin_sf_acoes add column if not exists plano text not null default 'v1';  -- v1 (13/10, histórico) | v2 (14/10)
alter table fin_sf_acoes add column if not exists valor_vendido numeric;             -- quanto já faturou com a ideia

create table if not exists fin_sf_reaver (
  id text primary key default gen_random_uuid()::text,
  tipo text not null,               -- credito_tributario | processo | consorcio | outro
  titulo text not null,
  contraparte text,
  valor_estimado numeric,
  chance text,                      -- alta | media | baixa | nao_sei
  situacao text,
  previsao text,                    -- quando deve entrar (texto livre: "2027", "após sentença")
  fonte text,
  observacao text,
  recebido boolean not null default false,
  recebido_em date,
  valor_recebido numeric,
  ordem int,
  ativo boolean not null default true,
  atualizado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fin_sf_reaver_tipo on fin_sf_reaver(tipo);
alter table fin_sf_reaver enable row level security;

notify pgrst, 'reload schema';

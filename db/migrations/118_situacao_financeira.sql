-- 118_situacao_financeira.sql
-- Aba "Situação Financeira" (grupo Diretoria, só admin): dívidas por grupo (imposto/banco/fornecedor/outro),
-- protestos título a título, plano de ação de receita e blocos de texto/números do painel.
-- Padrão do projeto: ids text, RLS ligado sem policy (só service role), enums validados na API (sem CHECK).

create table if not exists fin_sf_dividas (
  id text primary key default gen_random_uuid()::text,
  grupo text not null,              -- imposto | banco | fornecedor | outro
  subgrupo text,                    -- PGFN | RFB | Municipio SP | Estado SP | Bradesco | Caixa | ... | Trabalhista | Socios
  credor text not null,
  identificacao text,               -- inscricao / CDA / contrato / processo
  natureza text,                    -- ex.: Simples Nacional, IRRF retido, CCB capital de giro
  retido boolean not null default false,   -- tributo descontado de terceiros (risco penal)
  valor numeric,                    -- valor atual (piso)
  valor_teto numeric,               -- teto, quando o valor e incerto
  parcela_mensal numeric,           -- parcela contratual/acordada por mes
  situacao text,                    -- inscrita | intimada | protestada | ajuizada | execucao | citada | atrasada | em_dia | acordo | negociacao
  risco text,                       -- texto curto (empresa/CPF/bloqueio)
  data_ref date,                    -- data do valor
  fonte text,
  observacao text,
  ordem int,
  ativo boolean not null default true,
  atualizado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fin_sf_dividas_grupo on fin_sf_dividas(grupo);

create table if not exists fin_sf_protestos (
  id text primary key default gen_random_uuid()::text,
  secao text not null,              -- protestado_cenprot | pgfn_intimado | fora_da_cenprot
  grupo text,                       -- imposto | banco | fornecedor | outro
  tabeliao text not null,
  credor text not null,
  credor_cnpj text,
  documento text,
  valor_principal numeric,
  valor_protestado numeric,
  custas numeric,
  vencimento date,
  data_protocolo date,
  prazo_limite date,
  data_protesto date,
  protocolo text,
  situacao_vobi text,
  confianca text,                   -- confirmado | provavel | nao_identificado
  observacao text,
  fontes text,
  resposta_cartorio text,           -- o que o cartorio respondeu ao e-mail de 13/10/2026
  ordem int,
  ativo boolean not null default true,
  atualizado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fin_sf_protestos_tab on fin_sf_protestos(tabeliao);

create table if not exists fin_sf_acoes (
  id text primary key default gen_random_uuid()::text,
  codigo int,                       -- numero da ideia no plano de 13/10/2026
  onda int,                         -- 1 (esta semana) | 2 (30-90 dias) | 3 (90+ dias)
  titulo text not null,
  grupo text,
  descricao text,
  como_o_mercado_fatura text,
  investimento text,
  dificuldade text,
  prazo_primeiro_faturamento text,
  potencial_mensal text,
  margem_tipica text,
  precisa_de text,
  impeditivos text,
  primeiros_passos jsonb,
  roteiro_venda text,
  fontes jsonb,
  ajuste_revisor text,              -- o que a revisao critica mandou ajustar
  descartada boolean not null default false,
  motivo_descarte text,
  top10_ordem int,
  top10_porque text,
  status text not null default 'ideia',   -- ideia | testando | em_andamento | feito | descartado
  responsavel text,
  prazo date,
  notas text,
  ordem int,
  atualizado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fin_sf_acoes_onda on fin_sf_acoes(onda);

create table if not exists fin_sf_painel (
  chave text primary key,           -- numeros_chave | meta | plano_vendas | alertas | despesas_fixas | creditos | lacunas
  dados jsonb not null,
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);

alter table fin_sf_dividas enable row level security;
alter table fin_sf_protestos enable row level security;
alter table fin_sf_acoes enable row level security;
alter table fin_sf_painel enable row level security;

notify pgrst, 'reload schema';

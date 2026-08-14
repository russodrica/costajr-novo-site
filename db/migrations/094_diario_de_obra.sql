-- 094_diario_de_obra.sql
--
-- DIÁRIO DE OBRA (RDO) dentro do portal.
--
-- Já existia uma `obras_rdo` enxuta (migration 028): data, clima, efetivo como
-- um número solto, atividades e fotos num array de texto. Serve para anotar,
-- mas não substitui o app que a Costa Júnior paga hoje. Esta migration amplia
-- o que existe e acrescenta o que faltava, SEM apagar nada:
--
--   * efetivo por função e equipamentos viram listas estruturadas (jsonb),
--     em vez de um número e um campo de texto;
--   * ocorrências ganham TIPO (do catálogo) além da descrição;
--   * fotos ganham tabela própria, com legenda e ordem — o array antigo
--     continua lá e segue funcionando na tela antiga;
--   * checklist de verificação por relatório;
--   * catálogos de funções, equipamentos, tipos de ocorrência e modelos de
--     checklist, que é o que o app chama de "pré-cadastro".
--
-- O diário se pendura nas OBRAS QUE JÁ EXISTEM no portal (249 hoje). Essa é a
-- vantagem de trazer para cá: não vira um segundo cadastro de obras para
-- alguém manter em dia.

-- ─── ampliação da obras_rdo ─────────────────────────────────────────────────
alter table obras_rdo add column if not exists efetivo_itens   jsonb not null default '[]'::jsonb;
alter table obras_rdo add column if not exists equipamentos_itens jsonb not null default '[]'::jsonb;
alter table obras_rdo add column if not exists ocorrencias_itens  jsonb not null default '[]'::jsonb;
alter table obras_rdo add column if not exists responsavel     text;
alter table obras_rdo add column if not exists inicio_jornada  time;
alter table obras_rdo add column if not exists fim_jornada     time;
alter table obras_rdo add column if not exists condicao        text;   -- praticavel | parcial | impraticavel
alter table obras_rdo add column if not exists observacoes     text;
alter table obras_rdo add column if not exists status          text not null default 'rascunho';
alter table obras_rdo add column if not exists publicado_em    timestamptz;
alter table obras_rdo add column if not exists updated_at      timestamptz not null default now();

-- `atividades` era NOT NULL: um relatório começa em branco e só depois é
-- preenchido, então a exigência atrapalhava salvar rascunho.
alter table obras_rdo alter column atividades drop not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'obras_rdo_status_check') then
    alter table obras_rdo add constraint obras_rdo_status_check
      check (status in ('rascunho', 'publicado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'obras_rdo_condicao_check') then
    alter table obras_rdo add constraint obras_rdo_condicao_check
      check (condicao is null or condicao in ('praticavel', 'parcial', 'impraticavel'));
  end if;
end $$;

comment on column obras_rdo.efetivo_itens is
  'Mão de obra do dia: [{"funcao":"Pedreiro","qtd":4,"empresa":"Própria"}]';
comment on column obras_rdo.equipamentos_itens is
  'Equipamentos em uso: [{"nome":"Betoneira","qtd":1,"horas":6}]';
comment on column obras_rdo.ocorrencias_itens is
  'Ocorrências do dia: [{"tipo":"Chuva","descricao":"Parada das 14h às 17h","horas":3}]';

-- ─── fotos com legenda ──────────────────────────────────────────────────────
create table if not exists obras_rdo_fotos (
  id uuid primary key default gen_random_uuid(),
  rdo_id text not null references obras_rdo(id) on delete cascade,
  storage_path text not null,             -- bucket privado "obras" (projeto costajr2)
  nome_arquivo text,
  content_type text,
  tamanho bigint,
  legenda text,
  ordem integer not null default 0,
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rdo_fotos on obras_rdo_fotos(rdo_id, ordem, created_at);

-- ─── checklist do relatório ─────────────────────────────────────────────────
create table if not exists obras_rdo_checklist (
  id uuid primary key default gen_random_uuid(),
  rdo_id text not null references obras_rdo(id) on delete cascade,
  item text not null,
  situacao text not null default 'pendente' check (situacao in ('ok', 'nao', 'na', 'pendente')),
  observacao text,
  ordem integer not null default 0
);
create index if not exists idx_rdo_checklist on obras_rdo_checklist(rdo_id, ordem);

-- ─── catálogos (o "pré-cadastro" do app) ────────────────────────────────────
create table if not exists obras_cat_funcoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists obras_cat_equipamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists obras_cat_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  cor text default '#6B7280',
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists obras_checklist_modelos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  itens jsonb not null default '[]'::jsonb,   -- ["EPI em uso", "Área isolada", ...]
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Sementes: começa com o básico de canteiro para ninguém encarar tela vazia.
-- ON CONFLICT DO NOTHING => rodar de novo não duplica nem sobrescreve o que a
-- equipe já tiver ajustado.
insert into obras_cat_funcoes (nome) values
  ('Encarregado'), ('Mestre de obras'), ('Pedreiro'), ('Servente'), ('Carpinteiro'),
  ('Armador'), ('Eletricista'), ('Encanador'), ('Pintor'), ('Gesseiro'),
  ('Soldador'), ('Operador de máquina'), ('Técnico de segurança'), ('Engenheiro'),
  ('Estagiário'), ('Ajudante geral')
on conflict (nome) do nothing;

insert into obras_cat_equipamentos (nome) values
  ('Betoneira'), ('Andaime'), ('Bomba de concreto'), ('Compactador'), ('Escavadeira'),
  ('Retroescavadeira'), ('Guincho'), ('Gerador'), ('Compressor'), ('Martelete'),
  ('Serra circular'), ('Policorte'), ('Caminhão'), ('Munck'), ('Plataforma elevatória')
on conflict (nome) do nothing;

insert into obras_cat_ocorrencias (nome, cor) values
  ('Chuva', '#2563EB'),
  ('Falta de material', '#D97706'),
  ('Falta de mão de obra', '#D97706'),
  ('Falta de energia', '#DC2626'),
  ('Acidente / incidente', '#DC2626'),
  ('Retrabalho', '#DC2626'),
  ('Interferência do cliente', '#7C3AED'),
  ('Liberação de área pendente', '#7C3AED'),
  ('Projeto incompleto ou divergente', '#7C3AED'),
  ('Visita técnica', '#059669'),
  ('Vistoria de segurança', '#059669'),
  ('Recebimento de material', '#059669'),
  ('Concretagem', '#059669'),
  ('Paralisação', '#DC2626'),
  ('Outros', '#6B7280')
on conflict (nome) do nothing;

insert into obras_checklist_modelos (nome, itens) values
  ('Segurança do trabalho', '["EPI em uso por toda a equipe","Área de risco isolada e sinalizada","Extintor no prazo e acessível","Andaime travado e com guarda-corpo","Ordem e limpeza do canteiro","Instalação elétrica provisória protegida"]'::jsonb),
  ('Qualidade do serviço', '["Serviço conferido com o projeto","Material aprovado antes da aplicação","Medidas conferidas em campo","Registro fotográfico feito"]'::jsonb)
on conflict do nothing;

-- ─── RLS (o acesso é sempre pela service role, via API do portal) ───────────
alter table obras_rdo_fotos enable row level security;
alter table obras_rdo_checklist enable row level security;
alter table obras_cat_funcoes enable row level security;
alter table obras_cat_equipamentos enable row level security;
alter table obras_cat_ocorrencias enable row level security;
alter table obras_checklist_modelos enable row level security;

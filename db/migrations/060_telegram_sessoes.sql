-- 060_telegram_sessoes.sql
-- Estado das conversas do bot do Telegram (fluxo "registrar movimentação de ativo").
create table if not exists telegram_sessoes (
  telegram_user_id text primary key,
  nome text,
  chat_id text,
  estado text,
  dados jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table telegram_sessoes enable row level security;

-- E-mail pessoal separado do corporativo na ficha do colaborador.
-- (o "email" existente = corporativo; telefone/telefone_pessoal já são separados)
alter table rh_colaboradores add column if not exists email_pessoal text;

notify pgrst, 'reload schema';

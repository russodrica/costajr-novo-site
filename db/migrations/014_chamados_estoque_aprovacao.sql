-- Migration 014: Conclusão de chamado com evidências e aprovação de alteração de preço
-- Data: 2026-05-12

-- 1. Chamados: campos de conclusão pelo técnico
alter table manut_chamados add column if not exists observacao_conclusao text;
alter table manut_chamados add column if not exists fotos_evidencia text[];
alter table manut_chamados add column if not exists motivo_pendencia text;

-- 2. Aprovação de alteração de preço de item de estoque
create table if not exists manut_estoque_alteracoes (
  id text primary key default gen_random_uuid()::text,
  estoque_id text not null references manut_estoque(id) on delete cascade,
  tecnico_id text references manut_tecnicos(id) on delete set null,
  preco_anterior numeric(10,2),
  preco_novo numeric(10,2) not null,
  qtd_minima_anterior integer,
  qtd_minima_nova integer,
  status text not null default 'pendente' check (status in ('pendente','aprovada','rejeitada')),
  motivo text,
  resposta_admin text,
  decidido_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_estoque_alt_status on manut_estoque_alteracoes(status, created_at desc);
create index if not exists idx_estoque_alt_tec on manut_estoque_alteracoes(tecnico_id);

-- 3. Bucket Storage para fotos de evidência de chamados (público para leitura)
-- Criado via dashboard Supabase ou SQL: insert em storage.buckets
insert into storage.buckets (id, name, public)
values ('chamados', 'chamados', true)
on conflict (id) do nothing;

create policy if not exists "chamados publico select" on storage.objects
  for select to public using (bucket_id = 'chamados');

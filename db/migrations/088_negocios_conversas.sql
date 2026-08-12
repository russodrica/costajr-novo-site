-- 088_negocios_conversas.sql
-- Histórico de conversas/tratativas de cada card de Novos Negócios.
--
-- É o diário do negócio: "liguei para o proprietário", "cliente pediu desconto",
-- "corretor mandou a matrícula". Cada anotação guarda a data, QUEM escreveu e o
-- texto, e pode ter prints/fotos anexados.
--
-- As imagens da anotação reaproveitam negocios_anexos (mesmo cofre, mesmo
-- endpoint de download), mas com conversa_id preenchido — assim elas NÃO entram
-- na galeria do catálogo, que é vitrine.

create table if not exists negocios_conversas (
  id uuid primary key default gen_random_uuid(),
  imovel_id uuid not null references negocios_imoveis(id) on delete cascade,
  data date not null default current_date,
  autor text,
  texto text not null,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_neg_conversas_imovel on negocios_conversas(imovel_id, data desc);

alter table negocios_anexos add column if not exists conversa_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'negocios_anexos_conversa_fk') then
    alter table negocios_anexos
      add constraint negocios_anexos_conversa_fk
      foreign key (conversa_id) references negocios_conversas(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_neg_anexos_conversa on negocios_anexos(conversa_id);

-- a espécie ganha "conversa" (print/foto que pertence a uma anotação)
alter table negocios_anexos drop constraint if exists negocios_anexos_especie_check;
alter table negocios_anexos add constraint negocios_anexos_especie_check
  check (especie in ('foto', 'documento', 'conversa'));

comment on table negocios_conversas is
  'Histórico de tratativas de um card de Novos Negócios (data, autor, texto, prints).';

notify pgrst, 'reload schema';

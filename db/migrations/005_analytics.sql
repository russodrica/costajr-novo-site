-- ============================================================================
-- ANALYTICS — registro de visitas anônimas para o painel /admin
-- Retenção: 90 dias (cleanup via função page_views_cleanup)
-- ============================================================================

create table if not exists page_views (
  id          bigserial primary key,
  visited_at  timestamptz not null default now(),
  path        text        not null,
  session_id  text        not null,
  referrer    text,
  ref_host    text,
  ref_kind    text,
  utm_source  text,
  utm_medium  text,
  utm_campaign text,
  device      text,
  os          text,
  browser     text,
  country     text,
  region      text,
  city        text,
  is_bot      boolean     not null default false
);

create index if not exists idx_page_views_visited_at on page_views(visited_at desc);
create index if not exists idx_page_views_path       on page_views(path, visited_at desc);
create index if not exists idx_page_views_session    on page_views(session_id, visited_at desc);
create index if not exists idx_page_views_ref_host   on page_views(ref_host) where ref_host is not null;

-- Cleanup: apaga registros com mais de 90 dias.
-- Chamar manualmente, via cron Supabase (pg_cron) ou pelo botão no painel.
create or replace function page_views_cleanup()
returns integer
language plpgsql
as $$
declare
  removed integer;
begin
  delete from page_views where visited_at < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Migration 067: rate limiting atômico no Postgres (serverless-safe)
-- ============================================================================
-- Sem Redis/Upstash: uma tabela + função fazem janela fixa atômica. Cada "hit"
-- é um único statement (upsert) — sem corrida entre lambdas da Vercel. Usado para
-- frear brute-force de login e spam de formulários públicos. Fail-open no código:
-- se o RPC falhar, o request passa (nunca trava o app por causa do limitador).
-- ➜ Rodar UMA vez no Supabase SQL Editor. Idempotente.
-- ============================================================================

create table if not exists public.rate_limits (
  bucket   text primary key,
  count    integer not null default 0,
  reset_at timestamptz not null
);
alter table if exists public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- rl_hit: incrementa o contador da janela e devolve TRUE se ainda dentro do limite.
create or replace function public.rl_hit(p_bucket text, p_limit integer, p_window_secs integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as r (bucket, count, reset_at)
    values (p_bucket, 1, now() + make_interval(secs => p_window_secs))
  on conflict (bucket) do update set
    count    = case when r.reset_at < now() then 1 else r.count + 1 end,
    reset_at = case when r.reset_at < now() then now() + make_interval(secs => p_window_secs) else r.reset_at end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.rl_hit(text, integer, integer) from anon, authenticated;

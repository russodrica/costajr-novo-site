-- Migration 068: verificação de novo dispositivo/local (step-up por OTP)
-- ============================================================================
-- Defesa contra senha clonada/roubada: ao logar de um DISPOSITIVO novo (ou após
-- 30 dias), exige um código (OTP) enviado por e-mail/Telegram antes de liberar a
-- sessão. A "confiança" é chaveada no COOKIE do dispositivo (não no IP — evita
-- falso-positivo em celular que troca de IP/torre). Guardamos só o HASH do device.
--
-- trusted_devices: dispositivos confiáveis por usuário (profile_id).
-- login_otps: desafios de código em aberto (expira em minutos, com lockout).
-- IDs text (padrão do projeto). RLS ligado, service-role-only.
-- ➜ Rodar UMA vez no Supabase SQL Editor. Idempotente.
-- ============================================================================

create table if not exists public.trusted_devices (
  id            text primary key default gen_random_uuid()::text,
  profile_id    text not null,
  device_hash   text not null,                       -- HMAC(JWT_SECRET, td_id) — nunca o td_id cru
  last_ip       text,
  last_geo      text,
  user_agent    text,
  trusted_until timestamptz not null,                -- reconfirmação a cada 30 dias
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  unique (profile_id, device_hash)
);
create index if not exists idx_trusted_devices_profile on public.trusted_devices(profile_id);

create table if not exists public.login_otps (
  id            text primary key default gen_random_uuid()::text,
  profile_id    text not null,
  code_hash     text not null,                       -- sha256(codigo + profile_id + JWT_SECRET)
  device_hash   text not null,                       -- dispositivo a confiar quando validar
  canal         text not null default 'email',       -- email | telegram
  destino_masc  text,                                -- ex.: "j***@costajr.com.br" (só p/ exibir)
  attempts      integer not null default 0,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_login_otps_profile on public.login_otps(profile_id);

alter table if exists public.trusted_devices enable row level security;
alter table if exists public.login_otps      enable row level security;
revoke all on public.trusted_devices, public.login_otps from anon, authenticated;

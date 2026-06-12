-- ============================================================================
-- 032 — Comercial: interações com leads (paridade com o Manus)
-- Cada contato registrado (WhatsApp, ligação, e-mail, visita) alimenta o
-- alerta de "dias sem contato" e os rankings por vendedor.
-- ============================================================================

create table if not exists manut_leads_interacoes (
  id text primary key default gen_random_uuid()::text,
  lead_id text not null references manut_leads(id),
  tipo text not null check (tipo in ('whatsapp','ligacao','email','visita','outro')),
  observacao text,
  vendedor text not null,           -- e-mail/nome de quem registrou
  created_at timestamptz not null default now()
);
create index if not exists idx_leads_inter_lead on manut_leads_interacoes(lead_id, created_at desc);
create index if not exists idx_leads_inter_vendedor on manut_leads_interacoes(vendedor, created_at desc);

alter table manut_leads_interacoes enable row level security;

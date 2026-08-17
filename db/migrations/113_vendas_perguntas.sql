-- 113 — Vendas: perguntas dos compradores no Mercado Livre
--
-- "Sim construir" (Adriana, 17/08/2026): o robô lê as perguntas não
-- respondidas na API do ML, monta um RASCUNHO de resposta a partir da ficha
-- (medidas, material, capacidade...) e deixa aqui. Ela revisa/edita no
-- painel e aprova com um clique; a rodada seguinte do robô envia ao ML.
-- Resposta 100% automática ficou de fora de propósito: resposta errada fica
-- pública no anúncio.
--
-- Só cria tabela nova. Nada é apagado. (db/COMO_MIGRAR.md)

create table if not exists vendas_perguntas (
  id uuid primary key default gen_random_uuid(),
  ml_question_id text not null unique,
  ml_item_id text,
  produto_id uuid references vendas_produtos(id),
  produto_nome text,
  pergunta text not null,
  comprador text,
  perguntado_em timestamptz,
  rascunho text,
  resposta text,
  status text not null default 'pendente'
    check (status in ('pendente','aprovada','respondida','descartada','erro')),
  erro_envio text,
  respondido_em timestamptz,
  criado_em timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendas_perguntas_status_idx on vendas_perguntas (status, perguntado_em desc);

comment on table vendas_perguntas is
  'Perguntas de compradores no ML. Fluxo: robô grava pendente+rascunho → Adriana aprova/edita no painel → robô envia e marca respondida.';

notify pgrst, 'reload schema';

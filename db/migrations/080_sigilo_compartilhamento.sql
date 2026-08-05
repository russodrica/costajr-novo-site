-- 080_sigilo_compartilhamento.sql
-- "Sigiloso — não compartilhar": marca documentos que NÃO podem sair da empresa
-- pelos botões "Enviar documentos" (e-mail / WhatsApp) do painel.
--
-- O documento continua VISÍVEL e baixável para quem já tem acesso à tela — o que
-- muda é que ele some da lista de envio E é barrado no servidor (não é só um
-- "esconder" visual: mesmo forjando o pedido, a API recusa).
--
-- Dois níveis, que se somam:
--   1) por ITEM  → coluna nao_compartilhar em cada tabela de documento;
--   2) por BANCO/CARTÃO → tabela doc_bancos_sigilosos. Vale para extratos, faturas
--      e contratos daquele banco — inclusive os que forem anexados no futuro.

alter table doc_extratos_bancarios add column if not exists nao_compartilhar boolean not null default false;
alter table doc_cartao_faturas     add column if not exists nao_compartilhar boolean not null default false;
alter table doc_emprestimos        add column if not exists nao_compartilhar boolean not null default false;
alter table doc_empresa_arquivos   add column if not exists nao_compartilhar boolean not null default false;

create index if not exists idx_extratos_nao_compartilhar on doc_extratos_bancarios(nao_compartilhar);
create index if not exists idx_faturas_nao_compartilhar  on doc_cartao_faturas(nao_compartilhar);
create index if not exists idx_docarq_nao_compartilhar   on doc_empresa_arquivos(nao_compartilhar);

-- Bancos/cartões sigilosos por padrão.
create table if not exists doc_bancos_sigilosos (
  banco text primary key,
  criado_por text,
  created_at timestamptz not null default now()
);
alter table doc_bancos_sigilosos enable row level security;

-- VillelaPay já entra marcado (pedido da Adriana em 05/08/2026). É só um registro
-- de dados: dá para desmarcar a qualquer momento pelo botão 🔒 Sigilo do painel.
insert into doc_bancos_sigilosos (banco, criado_por)
values ('VillelaPay', 'migration 080')
on conflict (banco) do nothing;

notify pgrst, 'reload schema';

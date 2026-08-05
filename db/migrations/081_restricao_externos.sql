-- 081_restricao_externos.sql
-- Restrição por PESSOA para usuários EXTERNOS (perfil "fornecedor" — o contador).
--
-- Diferente do sigilo da 080 (que tira o documento da lista de "Enviar documentos"
-- para TODO mundo), aqui o documento simplesmente NÃO EXISTE para o usuário externo:
-- não aparece na tela dele e o link direto é recusado. A equipe interna (admin,
-- financeiro, jurídico) continua vendo tudo normalmente.
--
-- Como funciona:
--   restrito_externo = false (padrão) → todos os externos veem, como sempre foi;
--   restrito_externo = true           → NENHUM externo vê, exceto quem estiver
--                                       listado em doc_externo_permitido.
-- Deny-by-default de propósito: um contador novo que entre depois NÃO passa a ver
-- documento restrito sem alguém liberar na mão.

alter table doc_extratos_bancarios add column if not exists restrito_externo boolean not null default false;
alter table doc_cartao_faturas     add column if not exists restrito_externo boolean not null default false;
alter table doc_emprestimos        add column if not exists restrito_externo boolean not null default false;
alter table doc_empresa_arquivos   add column if not exists restrito_externo boolean not null default false;

create index if not exists idx_extratos_restrito_ext on doc_extratos_bancarios(restrito_externo);
create index if not exists idx_faturas_restrito_ext  on doc_cartao_faturas(restrito_externo);
create index if not exists idx_docarq_restrito_ext   on doc_empresa_arquivos(restrito_externo);

-- Exceções: externos que PODEM ver um documento restrito.
create table if not exists doc_externo_permitido (
  tabela text not null,          -- doc_extratos_bancarios | doc_cartao_faturas | doc_emprestimos | doc_empresa_arquivos
  registro_id text not null,
  profile_id text not null,      -- portal_profiles.id do usuário externo
  criado_por text,
  created_at timestamptz not null default now(),
  primary key (tabela, registro_id, profile_id)
);
create index if not exists idx_externo_permitido_doc on doc_externo_permitido(tabela, registro_id);
alter table doc_externo_permitido enable row level security;

-- Regras por BANCO/CARTÃO inteiro (vale para o que já existe e para o que vier depois).
-- A 080 criou a tabela com o sentido único de "não compartilhar"; agora ela guarda
-- as duas regras separadamente, porque são coisas diferentes.
alter table doc_bancos_sigilosos add column if not exists bloqueia_envio boolean not null default true;
alter table doc_bancos_sigilosos add column if not exists restrito_externo boolean not null default false;

-- VillelaPay: o que a Adriana realmente precisa é que o CONTADOR não veja.
-- Ela mesma continua podendo enviar por e-mail/WhatsApp quando quiser.
update doc_bancos_sigilosos
   set restrito_externo = true, bloqueia_envio = false
 where banco = 'VillelaPay';

notify pgrst, 'reload schema';

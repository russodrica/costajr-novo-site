-- 115_fornecedor_acesso.sql
--
-- PROBLEMA: ao criar um acesso de fornecedor (contador, por exemplo), o portal
-- nao perguntava NADA sobre liberacoes. Todo fornecedor nascia enxergando os
-- dois modulos (Documentos da Empresa + Documentos Bancarios) e TODOS os bancos.
-- Para tirar algo dele era preciso lembrar de esconder documento a documento
-- (ou banco a banco) DEPOIS -- ou seja, o padrao era "ve tudo".
--
-- SOLUCAO: a liberacao passa a ser escolhida NA CRIACAO do login.
--   * MODULOS  -> gravados na tabela que ja existe (portal_perm_usuario).
--                 Sem linha = sem acesso (deny-by-default no permissoes.ts).
--   * BANCOS   -> tabela nova abaixo: "todos" ou uma lista fechada.
--
-- Nada aqui muda o que os fornecedores de hoje enxergam: o backfill grava a
-- permissao que eles ja tinham na pratica, agora de forma explicita e visivel
-- na tela. A partir de agora quem for criado nasce SO com o que for marcado.

-- ── 1. Lista de bancos liberados por fornecedor ─────────────────────────────
create table if not exists portal_fornecedor_acesso (
  profile_id    text primary key references portal_profiles(id) on delete cascade,
  bancos_modo   text not null default 'todos' check (bancos_modo in ('todos', 'lista')),
  bancos        text[] not null default '{}',
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

comment on table portal_fornecedor_acesso is
  'Escopo de bancos do usuario externo (fornecedor/contador). bancos_modo=lista => so os bancos do array.';

alter table portal_fornecedor_acesso enable row level security;
-- sem policy: so o service role (servidor do portal) le e escreve.

-- ── 2. Backfill: mantem o acesso atual dos fornecedores ja cadastrados ──────
-- (grava explicitamente o que hoje e implicito: ver os 2 modulos, todos os bancos)
insert into portal_perm_usuario (profile_id, modulo, nivel)
select p.id, m.modulo, 'ver'
  from portal_profiles p
 cross join (values ('doc-empresa'), ('doc-bancarios')) as m(modulo)
 where (p.role = 'fornecedor' or p.roles @> array['fornecedor'])
on conflict (profile_id, modulo) do nothing;

insert into portal_fornecedor_acesso (profile_id, bancos_modo, bancos, atualizado_por)
select p.id, 'todos', '{}', 'migration 115'
  from portal_profiles p
 where (p.role = 'fornecedor' or p.roles @> array['fornecedor'])
on conflict (profile_id) do nothing;

-- ── conferencia ─────────────────────────────────────────────────────────────
-- Cada fornecedor deve aparecer com 2 modulos e 1 linha de escopo de bancos.
select p.email,
       (select count(*) from portal_perm_usuario u
         where u.profile_id = p.id and u.modulo in ('doc-empresa','doc-bancarios') and u.nivel <> 'nenhum') as modulos_liberados,
       (select bancos_modo from portal_fornecedor_acesso a where a.profile_id = p.id) as bancos
  from portal_profiles p
 where (p.role = 'fornecedor' or p.roles @> array['fornecedor'])
 order by p.email;

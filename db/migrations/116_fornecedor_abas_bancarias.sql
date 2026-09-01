-- 116_fornecedor_abas_bancarias.sql
--
-- Dentro de "Documentos Bancarios" existem tres abas: Extratos, Faturas de
-- Cartao e Emprestimos/Financiamentos. Ate aqui o usuario externo so via
-- EXTRATOS -- as outras duas eram bloqueadas no codigo, sem opcao de liberar.
--
-- Decisao (Adriana, 26/08): a liberacao passa a ser escolhida por fornecedor,
-- como ja acontece com os modulos e com a lista de bancos. Padrao continua
-- FECHADO: quem ja existe segue vendo so extratos, e as duas abas novas so
-- aparecem para quem for marcado na tela de Fornecedores.

alter table portal_fornecedor_acesso
  add column if not exists faturas     boolean not null default false,
  add column if not exists emprestimos boolean not null default false;

comment on column portal_fornecedor_acesso.faturas is
  'Aba "Faturas de Cartao" dentro de Documentos Bancarios (padrao: fechado).';
comment on column portal_fornecedor_acesso.emprestimos is
  'Aba "Emprestimos e Financiamentos" dentro de Documentos Bancarios (padrao: fechado).';

-- conferencia: nenhuma linha deve nascer liberada
select count(*) filter (where faturas or emprestimos) as liberados_indevidamente,
       count(*) as total_fornecedores
  from portal_fornecedor_acesso;

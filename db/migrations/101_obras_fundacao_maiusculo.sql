-- 101_obras_fundacao_maiusculo.sql
--
-- Nome da obra e nome do cliente sempre em MAIÚSCULO na carteira de fundação.
-- Sem isso a mesma obra aparece escrita de três formas diferentes conforme
-- quem cadastrou, e a lista deixa de ordenar junto o que é a mesma coisa.
--
-- Aqui só a carteira de FUNDAÇÃO. As 249 obras de Obras & Projetos ficam como
-- estão: elas alimentam financeiro, ativos e relatórios antigos, e renomear em
-- massa mexeria em telas que ninguém pediu para mexer.

update obras_fundacao
   set nome = upper(nome),
       cliente = upper(cliente),
       updated_at = now()
 where nome <> upper(nome)
    or (cliente is not null and cliente <> upper(cliente));

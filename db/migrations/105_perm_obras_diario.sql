-- 105_perm_obras_diario.sql
--
-- "Liberei a Fundação para o usuário e não abre."
--
-- Motivo: as rotas de API da fundação e do relatório de visita moram sob
-- /api/admin/obras/..., e a trava central mapeava esse caminho para o módulo
-- "Obras & Projetos". Ou seja: quem recebia só "Obras de Fundação" via a tela
-- no menu, mas levava 403 em toda ação.
--
-- O código passou a mapear as rotas para os módulos certos
-- (obras/fundacao -> obras-fundacao, obras/diario -> obras-diario).
-- Falta o outro lado: quem já trabalhava com Obras precisa continuar podendo
-- usar o Relatório de Visita, então herda a mesma permissão no módulo novo.

insert into portal_perm_usuario (profile_id, modulo, nivel)
select p.profile_id, 'obras-diario', p.nivel
  from portal_perm_usuario p
 where p.modulo = 'obras'
on conflict (profile_id, modulo) do nothing;

-- reforça a herança da fundação (a 096 rodou antes de novos usuários entrarem)
insert into portal_perm_usuario (profile_id, modulo, nivel)
select p.profile_id, 'obras-fundacao', p.nivel
  from portal_perm_usuario p
 where p.modulo = 'obras'
on conflict (profile_id, modulo) do nothing;

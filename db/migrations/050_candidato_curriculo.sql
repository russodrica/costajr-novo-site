-- 050_candidato_curriculo.sql
-- Currículo do candidato como ARQUIVO no bucket privado "rh" (LGPD), além do link.
-- curriculo_path = caminho no Storage (nunca público); download via URL assinada no admin.
alter table rh_candidatos add column if not exists curriculo_path text;
alter table rh_candidatos add column if not exists curriculo_nome text;

notify pgrst, 'reload schema';

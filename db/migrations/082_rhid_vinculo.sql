-- 082_rhid_vinculo.sql
-- Liga o colaborador do Portal à pessoa cadastrada na ControliD (RHiD).
--
-- Até aqui o casamento era feito SÓ por CPF (ver src/pages/api/admin/rh/ponto-mensal.ts).
-- Isso quebra quando o CPF está escrito diferente nos dois sistemas — foi o que
-- aconteceu com o GIVANILDO e o CRISPIM: batem ponto normalmente na ControliD,
-- mas o Portal não achava o registro deles e o ponto vinha vazio.
--
-- Com esta coluna, dá para amarrar na mão pela tela de Vínculo. A regra passa a ser:
--   1) usa rhid_person_id, se estiver preenchido;
--   2) senão, cai no casamento automático por CPF (comportamento antigo).

alter table rh_colaboradores add column if not exists rhid_person_id integer;
create index if not exists idx_rh_colab_rhid on rh_colaboradores(rhid_person_id);

comment on column rh_colaboradores.rhid_person_id is
  'ID da pessoa na ControliD/RHiD. Preenchido pela tela de Vinculo quando o CPF diverge entre os sistemas.';

notify pgrst, 'reload schema';

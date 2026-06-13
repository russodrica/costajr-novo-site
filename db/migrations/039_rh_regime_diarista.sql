-- ============================================================================
-- 039 — Adiciona a modalidade "diarista" ao regime do colaborador.
--        Diaristas são profissionais esporádicos — categoria/aba separada.
-- ============================================================================

do $$
declare cn text;
begin
  select conname into cn from pg_constraint
   where conrelid = 'rh_colaboradores'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%regime%';
  if cn is not null then execute 'alter table rh_colaboradores drop constraint ' || quote_ident(cn); end if;
end $$;

alter table rh_colaboradores
  add constraint rh_colaboradores_regime_check
  check (regime in ('clt', 'pj', 'estagio', 'temporario', 'socio', 'diarista'));

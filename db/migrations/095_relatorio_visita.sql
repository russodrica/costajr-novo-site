-- 095_relatorio_visita.sql
--
-- O "Diário de Obra" passa a se chamar RELATÓRIO DE VISITA.
--
-- Mudou o produto, não só o nome:
--   * o caminho começa pela OBRA (cadastro que já existe) e o relatório nasce
--     de dentro dela;
--   * mão de obra e equipamentos saem do relatório — a visita registra o que
--     foi visto, não a folha de efetivo do dia;
--   * o relatório passa a dizer POR QUAL EMPRESA é emitido: Costa Júnior
--     Engenharia e Construções ou Costa Júnior Consultoria e Geotecnia.
--
-- As colunas antigas (efetivo_itens, equipamentos_itens, efetivo) NÃO são
-- apagadas: relatório já gravado é registro do que aconteceu na obra, e
-- derrubar coluna é irreversível. Elas só deixam de ser preenchidas e de
-- aparecer na tela.

alter table obras_rdo add column if not exists empresa text not null default 'engenharia';

do $$ begin
  alter table obras_rdo add constraint obras_rdo_empresa_ck
    check (empresa in ('engenharia', 'consultoria'));
exception when duplicate_object then null; end $$;

comment on column obras_rdo.empresa is
  'Empresa que emite o relatório de visita: engenharia | consultoria. Define logo, razão social e CNPJ no cabeçalho impresso.';

comment on column obras_rdo.efetivo_itens is
  'DESCONTINUADO na v2 (Relatório de Visita). Mantido pelo histórico já gravado.';
comment on column obras_rdo.equipamentos_itens is
  'DESCONTINUADO na v2 (Relatório de Visita). Mantido pelo histórico já gravado.';

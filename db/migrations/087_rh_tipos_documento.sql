-- 087_rh_tipos_documento.sql
-- Libera os novos tipos de documento do RH.
--
-- A coluna rh_documentos.tipo tem uma trava (check constraint) que só aceitava
-- 8 valores: contrato, aso, ficha_epi, advertencia, atestado, certificado, cnh
-- e outro. Por isso "Suspensão", "Folha de ponto", "Férias" e companhia eram
-- recusados pelo banco — a tela oferecia, o usuário escolhia, e a gravação
-- voltava com erro de constraint.
--
-- A lista aqui tem de acompanhar TIPOS_DOC_RH em src/lib/rhTiposDoc.ts.

alter table rh_documentos drop constraint if exists rh_documentos_tipo_check;

alter table rh_documentos add constraint rh_documentos_tipo_check check (
  tipo in (
    'contrato', 'aditivo', 'admissional',
    'advertencia', 'suspensao',
    'atestado', 'aso', 'ficha_epi',
    'espelho_ponto', 'ferias', 'holerite', 'rescisao',
    'vale_transporte', 'dados_bancarios',
    'certificado', 'cnh', 'declaracao',
    'outro'
  )
);

comment on column rh_documentos.tipo is
  'Tipo do documento. Valores em src/lib/rhTiposDoc.ts (TIPOS_DOC_RH) — mexer nos dois lugares.';

notify pgrst, 'reload schema';

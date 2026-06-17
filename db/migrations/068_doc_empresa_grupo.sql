-- 068: sub-grupos dentro de "Documento Fiscal" para doc_empresa
-- Rodar no SQL Editor do Supabase (dashboard.supabase.com → project llmtnzhzozvhlknjmrdr)

ALTER TABLE doc_empresa
  ADD COLUMN IF NOT EXISTS grupo text;

COMMENT ON COLUMN doc_empresa.grupo IS
  'Sub-grupo de "Documento Fiscal": CND | Trabalhistas | Sócios | Diversos';

-- Move certidões de "Documentos Institucionais" → "Documento Fiscal" com grupo "CND"
UPDATE doc_empresa
SET
  categoria = 'Documento Fiscal',
  grupo     = 'CND'
WHERE arquivado = false
  AND categoria = 'Documentos Institucionais'
  AND lower(nome) LIKE '%certid%';

NOTIFY pgrst, 'reload schema';

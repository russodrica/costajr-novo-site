-- ============================================================================
-- 035 — Bucket de Storage para fotos e anexos de ativos
--        (fotos do equipamento, condição na entrega/devolução, anexos)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ativos',
  'ativos',
  true,
  10485760,  -- 10 MB por arquivo
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leitura pública (URLs não enumeráveis); uploads só via service_role no backend.
DROP POLICY IF EXISTS "Public read ativos" ON storage.objects;
CREATE POLICY "Public read ativos"
ON storage.objects FOR SELECT
USING (bucket_id = 'ativos');

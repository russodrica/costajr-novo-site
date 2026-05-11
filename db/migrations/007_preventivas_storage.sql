-- Migration 007: bucket de Storage para fotos/assinaturas das preventivas
-- Rodar no Supabase SQL Editor.

-- Cria o bucket "preventivas" público (leitura) — uploads via service_role no backend.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'preventivas',
  'preventivas',
  true,
  10485760,  -- 10 MB por arquivo
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policy: qualquer um pode LER (bucket público) — necessário para exibir as fotos no portal/admin
DROP POLICY IF EXISTS "Public read preventivas" ON storage.objects;
CREATE POLICY "Public read preventivas"
ON storage.objects FOR SELECT
USING (bucket_id = 'preventivas');

-- Migration 011: bucket para comprovantes de pagamento de materiais

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'materiais',
  'materiais',
  true,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read materiais" ON storage.objects;
CREATE POLICY "Public read materiais"
ON storage.objects FOR SELECT
USING (bucket_id = 'materiais');

-- Migration 001: adiciona autenticação própria ao portal_profiles
-- Rodar no Supabase SQL Editor

ALTER TABLE portal_profiles
  ADD COLUMN IF NOT EXISTS senha_hash text,
  ADD COLUMN IF NOT EXISTS senha_troca_obrigatoria boolean NOT NULL DEFAULT true;

-- Criar primeiro admin (executar com a hash gerada pelo script abaixo)
-- Para gerar a hash: node -e "
--   const salt='::cjr-manut-salt-v1';
--   const enc=new TextEncoder().encode('SUA_SENHA'+salt);
--   crypto.subtle.digest('SHA-256',enc).then(h=>console.log([...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('')));
-- "
--
-- INSERT INTO portal_profiles (email, display_name, full_name, role, approval_status, senha_hash, senha_troca_obrigatoria)
-- VALUES ('adriana@costajr.com.br', 'Adriana Russo', 'Adriana Russo da Costa', 'admin', 'approved', '<HASH_AQUI>', false)
-- ON CONFLICT (email) DO UPDATE SET
--   role = 'admin',
--   approval_status = 'approved',
--   senha_hash = EXCLUDED.senha_hash,
--   senha_troca_obrigatoria = false;

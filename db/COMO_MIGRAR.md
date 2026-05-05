# Regras de Migration — Costa Júnior

## Regra de ouro: nunca perder dados

**`schema.sql`** = apenas para projetos Supabase NOVOS E VAZIOS (setup inicial).  
**Nunca rode `schema.sql` em um banco que já tem dados.**

---

## Como fazer uma mudança de schema

1. Crie um arquivo em `db/migrations/` com o próximo número:
   ```
   db/migrations/004_descricao_curta.sql
   ```

2. O arquivo **só pode conter instruções aditivas**:
   ```sql
   -- ✅ PERMITIDO
   ALTER TABLE manut_clientes ADD COLUMN IF NOT EXISTS novo_campo text;
   CREATE TABLE IF NOT EXISTS nova_tabela (...);
   CREATE INDEX IF NOT EXISTS idx_... ON ...;
   INSERT INTO ... ON CONFLICT DO NOTHING;

   -- ❌ PROIBIDO — apaga dados
   DROP TABLE ...;
   TRUNCATE ...;
   DELETE FROM ... (sem WHERE específico);
   ALTER TABLE ... DROP COLUMN ...;
   ```

3. Rode **apenas o novo arquivo** no Supabase SQL Editor.  
   Nunca rode arquivos anteriores nem o schema.sql completo.

4. Marque o arquivo como rodado (comentário no topo):
   ```sql
   -- Rodado em: 2026-05-10 por Adriana
   ```

---

## Antes de qualquer migration em produção

1. Acesse o Supabase Dashboard → **Settings → Backups**
2. Baixe o backup mais recente
3. Só então rode o migration

---

## Migrations rodadas até hoje

| Arquivo | O que faz | Rodado em |
|---------|-----------|-----------|
| `001_portal_auth.sql` | Adiciona senha_hash ao portal_profiles | 2026-05-04 |
| `002_manut_leads_cupons_contrato.sql` | Cria manut_leads, manut_cupons, manut_contrato | 2026-05-05 |
| `003_manut_client_fields.sql` | Adiciona endereco/cidade/uf a manut_clientes | Pendente ⚠️ |

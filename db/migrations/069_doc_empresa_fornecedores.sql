-- 069_doc_empresa_fornecedores.sql
-- Adiciona coluna para custo mensal em "Empresas Fornecedoras".
-- O campo "grupo" (adicionado na 068) é reutilizado como tipo/subtipo da fornecedora.

ALTER TABLE doc_empresa ADD COLUMN IF NOT EXISTS valor_mensal numeric(12,2);

COMMENT ON COLUMN doc_empresa.valor_mensal IS 'Custo mensal recorrente (R$) — usado em Empresas Fornecedoras';

NOTIFY pgrst, 'reload schema';

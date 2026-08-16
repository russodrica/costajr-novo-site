-- ============================================================================
-- 106 — Vendas: margem alvo do catálogo passa de 20% para 18%
--
-- Ordem da Adriana (16/08/2026): "tendo em vista que todas as vendas foram
-- inferiores a 20%, sugiro alterar as margens dos nossos produtos para 18%".
-- As 4 vendas reais mensuráveis do período saíram com 15,0% / 19,9% / 19,3% /
-- 8,5% — o alvo de 20% não estava se realizando na venda, e preço menor
-- compete melhor. O piso de 15% NÃO muda (margem_minima_pct fica como está):
-- a regra "nunca abaixo de 15%" continua valendo, inclusive na regra de
-- competição da auditoria.
--
-- Quem lê este valor: o painel /admin/vendas, o publicador (preço dos
-- anúncios novos da fila), o reprecificador e — a partir de 16/08 — a
-- auditoria diária (auditoria_ml.py agora usa margem_alvo_pct da config como
-- mira quando --alvo não é passado).
--
-- UPDATE com WHERE em uma linha de configuração; nada é apagado, e o valor
-- continua editável pelo painel (botões de meta). (db/COMO_MIGRAR.md)
-- ============================================================================

update vendas_config
   set margem_alvo_pct = 18,
       updated_at = now()
 where id = 'default'
   and margem_alvo_pct is distinct from 18;

notify pgrst, 'reload schema';

-- ============================================================================
-- 038 — Função de resumo do fluxo de caixa AGREGADA NO BANCO
--        Corrige a agregação que era feita em JS sobre .limit(5000) (errava com
--        25k+ lançamentos). Agora SUM/GROUP BY no Postgres — correto e rápido.
-- ============================================================================

create or replace function fin_resumo_caixa(p_meses int default 6)
returns jsonb
language plpgsql
as $$
declare
  v_meses int := least(24, greatest(1, p_meses));
  v_inicio date := (date_trunc('month', current_date) - ((v_meses - 1) || ' months')::interval)::date;
  v_mes_atual text := to_char(current_date, 'YYYY-MM');
  v_por_mes jsonb;
  v_cards jsonb;
begin
  with meses as (
    select to_char((v_inicio + (g || ' months')::interval), 'YYYY-MM') as mes
    from generate_series(0, v_meses - 1) g
  ),
  prev as (
    select to_char(data_vencimento, 'YYYY-MM') as mes, tipo, sum(valor) as total
    from fin_lancamentos
    where status <> 'cancelado' and data_vencimento >= v_inicio
    group by 1, 2
  ),
  pago as (
    select to_char(data_pagamento, 'YYYY-MM') as mes, tipo, sum(valor) as total
    from fin_lancamentos
    where status = 'pago' and data_pagamento is not null and data_pagamento >= v_inicio
    group by 1, 2
  ),
  manut as (
    select to_char(data_pagamento, 'YYYY-MM') as mes, sum(valor) as total
    from manut_pagamentos
    where status = 'pago' and data_pagamento is not null and data_pagamento >= v_inicio
    group by 1
  )
  select jsonb_object_agg(m.mes, jsonb_build_object(
    'receitas_previstas', coalesce((select total from prev where prev.mes = m.mes and prev.tipo = 'receita'), 0),
    'despesas_previstas', coalesce((select total from prev where prev.mes = m.mes and prev.tipo = 'despesa'), 0),
    'receitas_recebidas', coalesce((select total from pago where pago.mes = m.mes and pago.tipo = 'receita'), 0),
    'despesas_pagas',     coalesce((select total from pago where pago.mes = m.mes and pago.tipo = 'despesa'), 0),
    'manut_recebido',     coalesce((select total from manut where manut.mes = m.mes), 0)
  )) into v_por_mes from meses m;

  -- cards do mês corrente + atrasados (sobre TODOS os lançamentos em aberto)
  select jsonb_build_object(
    'a_receber', coalesce(sum(valor) filter (where tipo='receita' and to_char(data_vencimento,'YYYY-MM')=v_mes_atual), 0),
    'a_pagar',   coalesce(sum(valor) filter (where tipo='despesa' and to_char(data_vencimento,'YYYY-MM')=v_mes_atual), 0),
    'atrasados_receber',     coalesce(sum(valor) filter (where tipo='receita' and (status='atrasado' or data_vencimento < current_date)), 0),
    'atrasados_pagar',       coalesce(sum(valor) filter (where tipo='despesa' and (status='atrasado' or data_vencimento < current_date)), 0),
    'atrasados_receber_qtd', coalesce(count(*)   filter (where tipo='receita' and (status='atrasado' or data_vencimento < current_date)), 0),
    'atrasados_pagar_qtd',   coalesce(count(*)   filter (where tipo='despesa' and (status='atrasado' or data_vencimento < current_date)), 0)
  ) into v_cards
  from fin_lancamentos
  where status in ('previsto', 'atrasado');

  return jsonb_build_object(
    'meses', v_meses, 'mes_corrente', v_mes_atual,
    'por_mes', coalesce(v_por_mes, '{}'::jsonb), 'cards', coalesce(v_cards, '{}'::jsonb)
  );
end;
$$;

-- DRE simplificado: total por categoria (receita/despesa) no período.
create or replace function fin_dre(p_inicio date, p_fim date)
returns table(categoria_id text, categoria text, tipo text, total numeric)
language sql
as $$
  select l.categoria_id,
         coalesce(c.nome, '(sem categoria)') as categoria,
         l.tipo,
         sum(l.valor) as total
  from fin_lancamentos l
  left join fin_categorias c on c.id = l.categoria_id
  where l.status <> 'cancelado'
    and l.data_vencimento >= p_inicio and l.data_vencimento < p_fim
  group by l.categoria_id, c.nome, l.tipo
  order by l.tipo, total desc;
$$;

-- 092_negocios_proprietarios_prazo_indeterminado.sql
--
-- O Termo de Autorização de Venda deixou de ter prazo fixo de 90 dias: agora
-- vale até o proprietário pedir o cancelamento (decisão da Adriana em
-- 12/08/2026, versão do termo 2026-08-12.2).
--
-- A coluna prazo_dias nasceu `not null default 90`. Com o prazo indeterminado,
-- o valor correto é NULL — e era exatamente isso que estava derrubando todo
-- cadastro novo pelo formulário público (violação de NOT NULL, que a tela
-- mostrava como "Não deu para registrar agora").
--
-- Os aceites antigos NÃO são tocados: cada um guarda o texto integral do termo
-- que a pessoa leu, então quem assinou com 90 dias continua com 90 dias.

alter table negocios_proprietarios
  alter column prazo_dias drop not null;

alter table negocios_proprietarios
  alter column prazo_dias set default null;

comment on column negocios_proprietarios.prazo_dias is
  'Prazo do termo em dias. NULL = indeterminado (vale até o proprietário pedir o cancelamento).';

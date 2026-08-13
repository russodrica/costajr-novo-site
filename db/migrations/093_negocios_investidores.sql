-- 093_negocios_investidores.sql
--
-- Terceira linha de Novos Negócios: INVESTIDORES. Além de quem tem imóvel para
-- vender (negocios_proprietarios) e de quem procura imóvel (negocios_imoveis
-- com tipo='busca'), agora há quem quer aplicar dinheiro em imóvel.
--
-- O cadastro entra pelo site da CR (crintermediacao.com.br/investidor) e a
-- equipe acompanha em Novos Negócios > Investidores.

create table if not exists negocios_investidores (
  id uuid primary key default gen_random_uuid(),

  -- quem é
  nome text not null,
  email text,
  telefone text,
  cidade text,
  uf text,
  tipo_pessoa text default 'fisica' check (tipo_pessoa in ('fisica', 'juridica')),
  empresa text,

  -- o que procura
  operacoes text[],                       -- compra_venda | permuta | incorporacao | renda | loteamento
  tipos_imovel text[],                    -- terreno | area | galpao | comercial | residencial | rural
  regioes text,                           -- texto livre: "zona sul de SP, ABC"
  ticket_min numeric(14,2),
  ticket_max numeric(14,2),
  prazo text,                             -- imediato | 6_meses | 12_meses | sem_pressa
  recursos text,                          -- proprio | financiamento | misto
  experiencia text,                       -- primeira | alguma | recorrente
  observacoes text,

  -- controle
  origem text default 'site',
  status text not null default 'novo' check (status in ('novo', 'qualificado', 'ativo', 'arquivado')),
  responsavel text,
  aceite_lgpd boolean not null default false,
  aceite_ip text,
  aceite_user_agent text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists negocios_investidores_status_idx on negocios_investidores(status);
create index if not exists negocios_investidores_criado_idx on negocios_investidores(created_at desc);

comment on table negocios_investidores is
  'Investidores captados pelo site da CR. Perfil de investimento para casar com o catálogo de terrenos e empreendimentos.';

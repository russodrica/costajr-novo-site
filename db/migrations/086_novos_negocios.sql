-- 086_novos_negocios.sql
-- Módulo NOVOS NEGÓCIOS: venda de terrenos, venda de empreendimentos e busca de
-- imóveis. As três telas são o MESMO cadastro com `tipo` diferente — assim o
-- catálogo, os anexos, os interessados e o resumo funcionam igual nas três sem
-- triplicar código (e um item pode "virar" outro tipo sem perder histórico).
--
-- Estrutura:
--   negocios_imoveis        -> o card do catálogo (foto de capa + todos os dados)
--   negocios_anexos         -> fotos da galeria E documentos (matrícula, IPTU...)
--   negocios_oportunidades  -> interessados de cada card, com o status do funil
--
-- Arquivos ficam no bucket PRIVADO `negocios` (projeto costajr2, o mesmo bridge
-- de espaço usado pelo doc-empresa). Nada é público: a tela pede o arquivo pelo
-- endpoint autenticado, que devolve uma URL assinada de 10 minutos.

create table if not exists negocios_imoveis (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('terreno', 'empreendimento', 'busca')),
  codigo text,
  titulo text not null,
  descricao text,
  capa_anexo_id uuid,                      -- foto de capa do catálogo (FK adiada, ver abaixo)

  -- funil do próprio item
  status text not null default 'disponivel',
  -- terreno/empreendimento: disponivel | reservado | vendido | pausado
  -- busca:                  procurando  | encontrado | encerrado

  -- localização
  endereco text, numero text, bairro text, cidade text, uf text, cep text,
  referencia text,

  -- números
  area_total numeric,                      -- m² de terreno
  area_construida numeric,                 -- m² construídos
  quartos integer, suites integer, banheiros integer, vagas integer,
  valor numeric,                           -- valor pedido / de venda
  valor_minimo numeric,                    -- piso de negociação (uso interno)
  comissao_percent numeric,

  -- terreno
  matricula text, inscricao_municipal text, zoneamento text, topografia text,

  -- empreendimento
  incorporadora text, previsao_entrega date,
  unidades_total integer, unidades_disponiveis integer,

  -- busca de imóveis (o que o cliente procura)
  cliente_nome text, cliente_contato text, perfil_procurado text,
  faixa_valor_min numeric, faixa_valor_max numeric,

  -- captação
  proprietario_nome text, proprietario_contato text, origem text,
  responsavel text, observacoes text,

  ativo boolean not null default true,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists negocios_anexos (
  id uuid primary key default gen_random_uuid(),
  imovel_id uuid not null references negocios_imoveis(id) on delete cascade,
  especie text not null default 'documento' check (especie in ('foto', 'documento')),
  titulo text,
  tipo text,                               -- matricula | iptu | contrato | planta | certidao | outro
  storage_path text not null,
  nome_arquivo text,
  content_type text,
  tamanho bigint,
  criado_por text,
  created_at timestamptz not null default now()
);

create table if not exists negocios_oportunidades (
  id uuid primary key default gen_random_uuid(),
  imovel_id uuid not null references negocios_imoveis(id) on delete cascade,
  nome text not null,
  email text, telefone text, origem text,
  valor_proposto numeric,
  status text not null default 'contatado'
    check (status in ('contatado', 'em_negociacao', 'fechado', 'perdido')),
  motivo_perda text,
  ultimo_contato date,
  proximo_contato date,
  fechado_em date,
  responsavel text,
  observacoes text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- capa aponta para um anexo do próprio imóvel; se a foto some, o card fica sem capa
-- (e não quebra). Por isso set null, não cascade.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'negocios_imoveis_capa_fk'
  ) then
    alter table negocios_imoveis
      add constraint negocios_imoveis_capa_fk
      foreign key (capa_anexo_id) references negocios_anexos(id) on delete set null;
  end if;
end $$;

create index if not exists idx_neg_imoveis_tipo    on negocios_imoveis(tipo, ativo);
create index if not exists idx_neg_imoveis_status  on negocios_imoveis(status);
create index if not exists idx_neg_imoveis_cidade  on negocios_imoveis(cidade);
create index if not exists idx_neg_anexos_imovel   on negocios_anexos(imovel_id, especie);
create index if not exists idx_neg_oport_imovel    on negocios_oportunidades(imovel_id);
create index if not exists idx_neg_oport_status    on negocios_oportunidades(status);

comment on table negocios_imoveis is
  'Novos Negócios: cada linha é um card do catálogo. tipo = terreno | empreendimento | busca.';
comment on column negocios_imoveis.valor_minimo is
  'Piso de negociação — uso interno, nunca sai em material para o cliente.';
comment on table negocios_oportunidades is
  'Interessados/oportunidades de cada card. status = contatado | em_negociacao | fechado | perdido.';

notify pgrst, 'reload schema';

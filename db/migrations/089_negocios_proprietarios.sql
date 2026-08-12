-- 089_negocios_proprietarios.sql
-- Cadastro de PROPRIETÁRIOS com aceite do Termo de Autorização de Venda.
--
-- O proprietário preenche um formulário PÚBLICO (link enviado por WhatsApp ou
-- e-mail), aceita o termo e vira um cadastro que pode ser puxado na ficha do
-- terreno.
--
-- Sobre a prova do aceite: guardamos o TEXTO INTEIRO do termo aceito, e não só
-- um "true". Se o termo mudar amanhã, o que ficou registrado continua sendo o
-- que aquela pessoa leu — sem isso, o aceite não vale grande coisa.
--
-- Dados pessoais (CPF, RG, endereço) são dados sensíveis de LGPD: a tabela só é
-- lida pelo portal com service role, e a tela fica restrita a admin/comercial.

create table if not exists negocios_proprietarios (
  id uuid primary key default gen_random_uuid(),

  -- qualificação (as mesmas do termo)
  nome text not null,
  nacionalidade text,
  estado_civil text,
  profissao text,
  rg text,
  cpf text,
  -- contato (não está no termo, mas sem isso não dá para trabalhar)
  telefone text,
  email text,
  -- endereço residencial
  cep text, endereco text, numero text, complemento text,
  bairro text, cidade text, uf text,

  -- imóvel declarado no termo
  imovel_endereco text, imovel_numero text, imovel_bairro text,
  imovel_cidade text, imovel_uf text, imovel_cep text,
  imovel_matricula text, imovel_area numeric, imovel_descricao text,
  valor_referencia numeric,

  -- aceite
  termo_versao text not null,
  termo_texto text not null,
  aceito_em timestamptz not null default now(),
  aceite_ip text,
  aceite_user_agent text,
  assinatura_nome text,           -- nome digitado como assinatura
  prazo_dias integer not null default 90,
  aviso_dias integer not null default 5,

  -- controle interno
  status text not null default 'novo' check (status in ('novo', 'aprovado', 'arquivado')),
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_neg_prop_status on negocios_proprietarios(status, created_at desc);
create index if not exists idx_neg_prop_cpf on negocios_proprietarios(cpf);
create index if not exists idx_neg_prop_nome on negocios_proprietarios(nome);

-- liga o cadastro do catálogo ao proprietário que assinou a autorização
alter table negocios_imoveis add column if not exists proprietario_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'negocios_imoveis_proprietario_fk') then
    alter table negocios_imoveis
      add constraint negocios_imoveis_proprietario_fk
      foreign key (proprietario_id) references negocios_proprietarios(id) on delete set null;
  end if;
end $$;

create index if not exists idx_neg_imoveis_prop on negocios_imoveis(proprietario_id);

comment on table negocios_proprietarios is
  'Proprietários que aceitaram o Termo de Autorização de Venda pelo formulário público. Contém dados pessoais (LGPD).';
comment on column negocios_proprietarios.termo_texto is
  'Texto integral do termo no momento do aceite — é isto que dá validade à autorização.';

notify pgrst, 'reload schema';

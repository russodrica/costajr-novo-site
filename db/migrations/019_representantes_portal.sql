-- Migration 019: Portal do Representante
-- - Adiciona campos de PIX em manut_representantes (chave + tipo)
-- - Adiciona autenticação (senha_hash, troca obrigatória, last_login_at) — espelha estrutura de manut_clientes
-- - Cria manut_representantes_materiais (biblioteca de materiais de treinamento que o rep consome no portal)
-- - Cria manut_representantes_aprovacoes (auditoria: quando foi aprovado, por quem, observação)
-- Data: 2026-05-21
-- Seguro para rodar em banco com dados existentes (IF NOT EXISTS).

-- 1. PIX + Autenticação no representante
alter table manut_representantes add column if not exists chave_pix text;
alter table manut_representantes add column if not exists tipo_chave_pix text
  check (tipo_chave_pix is null or tipo_chave_pix in ('cpf','cnpj','email','telefone','aleatoria'));
alter table manut_representantes add column if not exists senha_hash text;
alter table manut_representantes add column if not exists senha_troca_obrigatoria boolean not null default true;
alter table manut_representantes add column if not exists last_login_at timestamptz;
alter table manut_representantes add column if not exists aprovado_em timestamptz;
alter table manut_representantes add column if not exists aprovado_por text;

-- 2. Materiais de treinamento (biblioteca consumida pelos representantes)
create table if not exists manut_representantes_materiais (
  id text primary key default gen_random_uuid()::text,
  titulo text not null,
  descricao text,
  tipo text not null default 'link' check (tipo in ('pdf','video','link','texto','imagem','script_whatsapp')),
  url text,
  conteudo text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  destaque boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_manut_rep_materiais_ativo
  on manut_representantes_materiais(ativo, ordem);

-- Conteúdo inicial: 3 materiais essenciais (pode ser expandido pelo admin depois)
insert into manut_representantes_materiais (titulo, descricao, tipo, conteudo, ordem, destaque)
values
  (
    'Como funciona o programa Indique e Ganhe',
    'Visão geral das regras de comissão por plano (trimestral 4%, semestral 7%, anual 10%).',
    'texto',
    E'## Quanto você ganha\n\nSua comissão é calculada sobre o valor TOTAL pago pelo cliente que usa seu cupom:\n\n- **Plano Trimestral (3 meses)**: 4% de comissão. O cliente NÃO recebe desconto neste plano.\n- **Plano Semestral (6 meses)**: 7% de comissão. O cliente recebe 20% × 1 mês de desconto.\n- **Plano Anual (12 meses)**: 10% de comissão. O cliente recebe 20% × 2 meses de desconto.\n\n## Como recebe\n\nA Costa Júnior faz o repasse via PIX. Cadastre sua chave PIX na aba "Meu Perfil" pra agilizar.\n\nO saldo só vira pagamento quando o cliente paga a fatura.\n\n## Importante\n\nVocê só ganha em vendas com SEU cupom. Repasse o código exato pro seu indicado.',
    1,
    true
  ),
  (
    'Script pronto pra WhatsApp',
    'Texto base que você pode copiar e adaptar pra divulgar.',
    'script_whatsapp',
    E'Oi! Conheci a Costa Júnior, uma empresa de manutenção predial em SP que atende com plano fixo mensal (eletricista + bombeiro hidráulico + pedreiro juntos, sem precisar contratar 3 prestadores diferentes).\n\nO valor começa em R$ 250/mês pra quiosques e quem fecha trimestre/semestre/ano pra frente paga ainda menos.\n\nSe quiser dar uma olhada, é só usar meu cupom *{SEU_CODIGO}* aqui:\nhttps://www.costajr.com.br/manutencao/contratar?cupom={SEU_CODIGO}\n\nUsando o cupom você ganha desconto E me ajuda. 🙏',
    2,
    true
  ),
  (
    'Tirando dúvidas comuns',
    'Respostas pra perguntas que aparecem quando você divulga.',
    'texto',
    E'**"O técnico vai mesmo aparecer?"**\nSim — todo cliente tem visita preventiva mensal agendada pelo painel. Em caso de chamado emergencial, a Costa Júnior atende em até 24h úteis.\n\n**"E se eu precisar de uma especialidade extra?"**\nO plano base inclui 1 disciplina. Adicionar eletricidade + hidráulica + civil custa R$ 50/cada/mês.\n\n**"Tem fidelidade?"**\nNão é fidelidade contratual — o cliente paga pelo período que escolheu (3, 6 ou 12 meses) e os descontos são aplicados nos primeiros meses. Pagamento à vista no Mercado Pago.\n\n**"Atende minha região?"**\nA empresa está na Grande SP. Pra outras regiões, é preciso conversar com a Adriana primeiro.',
    3,
    false
  )
on conflict do nothing;

-- 3. Histórico de aprovações (auditoria)
create table if not exists manut_representantes_aprovacoes (
  id text primary key default gen_random_uuid()::text,
  representante_id text not null references manut_representantes(id) on delete cascade,
  acao text not null check (acao in ('aprovado','rejeitado','reativado','desativado')),
  feito_por text,
  observacao text,
  created_at timestamptz not null default now()
);

create index if not exists idx_manut_rep_aprovacoes_rep
  on manut_representantes_aprovacoes(representante_id, created_at desc);

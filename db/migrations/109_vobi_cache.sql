-- 109_vobi_cache.sql
-- Cache persistente de catálogos da Vobi (hoje: a lista de ~2.540 fornecedores).
--
-- POR QUE EXISTE: a Vobi tem cota de 1000 requisições/hora (header
-- `ratelimit-policy: 1000;w=3600`) COMPARTILHADA por toda a integração — bot do
-- Telegram, telas /admin/vobi-*, lembretes e o Excel financeiro diário do repo
-- costajunior-financeiro-diario (que sozinho gasta ~600 num run das 07:00).
--
-- O cache da lista de fornecedores era só em memória, e na Vercel cada cold
-- start começa do zero: toda baixa de pagamento rebaixava as 6 páginas de
-- /supplier. Em 17/09/2026 isso estourou a cota e o bot respondeu
-- "HTTP 429" no meio de um comprovante que ele já tinha lido certo.
--
-- Com esta tabela a lista sobrevive entre invocações, e quando a Vobi recusa
-- (429) o bot usa a última cópia salva em vez de falhar.

create table if not exists vobi_cache (
  chave text primary key,
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);

alter table vobi_cache enable row level security;
-- sem policy: acesso exclusivo por service role no backend (mesmo padrão de
-- ativos/RH — a anon key nunca toca esta tabela).

notify pgrst, 'reload schema';

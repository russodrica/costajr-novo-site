# costajr-novo — Revisão de Segurança e Performance (11/06/2026)

Auditoria do portal **costajr-novo** (Astro + Supabase + Vercel) — o projeto que está em produção em `costajr.com.br`. Stack: Astro API routes, Supabase (service-role), auth JWT (jose), Mercado Pago.

## 1. Vulnerabilidades CRÍTICAS corrigidas

1. **Bypass total de admin** (`src/lib/auth.ts`) — `requireAdmin` liberava acesso de administrador para **qualquer requisição** que enviasse o header `x-portal-auth: bypass`, bastando a variável `ADMIN_BYPASS_KEY` estar definida (e ela está, no `.env` de produção). O código nem comparava o token com a chave. Qualquer pessoa na internet virava admin. **Corrigido:** o bypass agora só funciona em ambiente de desenvolvimento (`import.meta.env.DEV`) **e** quando o token enviado é exatamente igual à `ADMIN_BYPASS_KEY`. Em produção, totalmente desativado.

2. **Preço da contratação definido pelo cliente** (`src/lib/manut/clientes.ts` → `contratarSubmit`) — o valor mensal e o total cobrado vinham do `body` enviado pelo navegador (`plano.valorMensal`, `plano.valorTotal`) e iam direto para a cobrança no Mercado Pago. Um cliente malicioso podia pagar **R$ 1** por um plano anual. **Corrigido:** criei `calcularPrecoServidor()`, que recalcula o preço no servidor a partir da tabela `manut_precificacao` (preço base por tamanho de loja) + nº de especialidades + desconto de duração + cupom validado no banco. Os valores do cliente passaram a ser **ignorados** para fins de cobrança e de registro.

3. **JWT_SECRET com fallback inseguro** (`src/lib/auth.ts`) — se a variável `JWT_SECRET` não estivesse configurada, o código usava o secret fixo `"dev-secret"`, tornando todos os tokens forjáveis (acesso a qualquer conta). **Corrigido:** em produção, a aplicação agora **falha ao subir** se `JWT_SECRET` não estiver definida, em vez de usar um valor previsível.

## 2. Vulnerabilidade ALTA corrigida

4. **IDOR na criação de material pelo técnico** (`src/pages/api/manut/tecnico/materiais.ts`) — o `POST` aceitava `loja_id` e `cliente_id` do corpo da requisição e inseria um material (gera cobrança ao lojista) **sem verificar** que o técnico atende aquela loja. Um técnico podia lançar materiais/cobranças em lojas de outros clientes. **Corrigido:** agora valida que a loja está vinculada ao técnico (`manut_tecnico_lojas`) e usa o `cliente_id` **real** da loja (buscado no banco), ignorando o enviado pelo técnico.

## 3. Melhorias aplicadas

- **Headers de segurança globais** (`src/middleware.ts`) em todas as respostas: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` e `HSTS`.

## 4. Pontos bons já existentes (verificados, sem alteração)

- **Webhook do Mercado Pago** (`src/pages/api/manut/mp_webhook.ts` + `mpWebhook.ts`): **revalida** o pagamento consultando a API do MP por ID antes de ativar cliente/material — não confia no corpo recebido. Boa prática.
- **Cron de cashback** (`api/cron/cashback-renovacao.ts`): protegido por `CRON_SECRET`.
- **Rotas do cliente** (ex.: `cliente/materiais.ts`, `cliente/orcamentos.ts`): filtram corretamente por `cliente_id = claims.sub` (sem IDOR).
- **Performance**: 31 índices criados nas migrations; sem padrão N+1 relevante no acesso ao banco (diferente do projeto legado). Não foram necessárias correções de performance.

## 5. Recomendações para uma próxima rodada (não bloqueantes)

Prioridade **MÉDIA**:
- **Hash de senha fraco** (`src/lib/auth.ts` → `hashSenha`): usa SHA-256 com **salt fixo global**, vulnerável a rainbow tables e brute force rápido. O ideal é migrar para `bcrypt`/`argon2` (com salt por usuário). É uma mudança sensível porque invalida os hashes atuais — exige estratégia de migração (re-hash no próximo login). Por isso **não** apliquei agora.
- **Assinatura do webhook MP**: além da revalidação que já existe, vale validar o header `x-signature` do Mercado Pago como defesa adicional.
- **Whitelist de campos nos PATCH de admin**: algumas rotas admin repassam o `body` inteiro para `update()`, permitindo alterar colunas não previstas. Restringir aos campos esperados.
- **Mensagens de erro**: ~27 rotas retornam `e.message` cru (inclui mensagens do Supabase), o que pode vazar nomes de colunas/estrutura. Padronizar para mensagens genéricas ao cliente e log detalhado só no servidor.

Prioridade **BAIXA**:
- Listagens admin (`admin/clientes/index.ts`) sem `.limit()` — podem ficar pesadas conforme a base cresce (paginar).
- 27 rotas usam `select("*")` — reduzir para as colunas necessárias.

## 6. Verificação

- `tsc --noEmit` (`npm run lint`): **limpo**.
- `npm run build` (Astro + adapter Vercel): **concluído com sucesso** (gera `.vercel/output`).

> ⚠️ Durante o build no ambiente isolado, instalei binários Linux do Rollup/esbuild dentro de `node_modules` (apenas para o build de validação aqui). Na sua máquina Windows, rode um `npm install` antes do próximo build/deploy para restaurar os binários nativos do Windows. Isso não afeta o código-fonte.

## 7. Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/lib/auth.ts` | Remoção do bypass de admin em produção + JWT_SECRET obrigatório |
| `src/lib/manut/clientes.ts` | Recálculo de preço no servidor (`calcularPrecoServidor`) |
| `src/pages/api/manut/tecnico/materiais.ts` | Correção de IDOR (vínculo técnico↔loja) |
| `src/middleware.ts` | Headers de segurança globais |

## 8. Observação sobre consolidação

Este (`costajr-novo`) é o portal **oficial e integrado** — já reúne fórum, treinamentos, onboarding, documentos, gestão comercial e manutenção num único projeto, em rede própria (Astro/Supabase/Vercel), sem dependência do Wix. As pastas `PORTALCJR\forum-cjr`, `forum-cjr-novo`, `manus-export` e `Portal CJR` são versões **legadas** (React/tRPC/MySQL-Railway) e podem ser arquivadas. A auditoria que fiz no `forum-cjr-novo` continua válida como histórico, mas as correções que importam para produção são as deste documento.

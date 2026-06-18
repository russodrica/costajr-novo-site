# HOWTO — Deploy do site novo

Guia pra colocar o site novo no ar (Astro + Supabase + Vercel). Ordem importa.

---

## ETAPA 1 — Criar 3 contas grátis (10 min)

| Serviço | URL | Login com | Pra quê |
|---|---|---|---|
| **GitHub** | https://github.com | Email | Hospedar o código |
| **Supabase** | https://supabase.com | GitHub | Banco PostgreSQL |
| **Vercel** | https://vercel.com | GitHub | Hospedagem do site |
| **Resend** | https://resend.com | Email | Envio de email |

Faça login com GitHub em todas as 3 (Supabase, Vercel, Resend) — fica mais rápido depois.

---

## ETAPA 2 — Criar projeto Supabase (5 min)

1. https://supabase.com/dashboard → **New project**
2. Nome: `costajr`
3. Senha do banco: gere uma forte e **anote** (você vai precisar)
4. Região: `South America (São Paulo)`
5. Plano: Free
6. Aguarde ~2 min até provisionar
7. Vá em **SQL Editor** → cole o conteúdo de `db/schema.sql` e clique **Run**
8. Confira em **Table Editor** que apareceram as 22 tabelas (`portal_*`, `manut_*`, `blog_posts`, `leads`)

### Pegar credenciais
- **Settings → API**: copie `Project URL`, `anon public`, `service_role`
- Vamos usar essas 3 chaves no próximo passo

---

## ETAPA 3 — Subir código pro GitHub (5 min)

```bash
cd "D:/OneDrive - Costa Jr/T.I/3_Documentacao de Sistemas/PORTALCJR/costajr-novo"
git init
git add .
git commit -m "Initial commit - Costa Junior site novo"
```

No GitHub:
1. Crie repositório novo: **costajr-novo** (privado)
2. No terminal:

```bash
git remote add origin https://github.com/SEU_USUARIO/costajr-novo.git
git branch -M main
git push -u origin main
```

---

## ETAPA 4 — Deploy na Vercel (5 min)

1. https://vercel.com/new → importe `costajr-novo`
2. Framework: **Astro** (detecta automático)
3. Em **Environment Variables**, adicione:

```
PUBLIC_SUPABASE_URL = (do Supabase)
PUBLIC_SUPABASE_ANON_KEY = (do Supabase)
SUPABASE_SERVICE_ROLE_KEY = (do Supabase)
JWT_SECRET = (gerar — passo 5)
MP_ACCESS_TOKEN = APP_USR-xxxxx   (pegue no painel do Mercado Pago — NUNCA commitar o valor real)
SITE_BASE_URL = https://costajr.com.br
ADMIN_BYPASS_KEY = cjr-2026
```

> **JWT_SECRET**: gere com este comando no PowerShell:
> ```ps
> [Convert]::ToBase64String((1..32 | %{ Get-Random -Maximum 256 }))
> ```

4. Clique **Deploy** — aguarde ~2 min
5. Vercel dá uma URL temporária `costajr-novo-xxx.vercel.app`. **Teste tudo aí antes de mexer no domínio.**

---

## ETAPA 5 — Migrar dados do Wix → Supabase (depois do deploy)

Vou criar um script `db/import-from-wix.ts` que:
- Lê via API as coleções `Manut_Clientes`, `Manut_Lojas`, etc do Wix
- Insere correspondente no Supabase
- Migra também `Portal_Profiles` (membros), `Portal_KB` (base de conhecimento)

Roda só uma vez, **depois** que tudo estiver funcionando no domínio temporário.

```bash
npm run db:import
```

---

## ETAPA 6 — Apontar `costajr.com.br` pra Vercel (5 min)

**Só faça depois de testar tudo no domínio temporário.**

### 6.1 Na Vercel
1. Projeto `costajr-novo` → **Settings → Domains**
2. Add: `costajr.com.br` e `www.costajr.com.br`
3. Vercel mostra os DNS records necessários — anote

### 6.2 No Registro.br (https://registro.br/painel)
1. Domínio `costajr.com.br` → **Editar Zona**
2. **Apague** os registros A/AAAA atuais (apontam pro Wix)
3. **Adicione** os que a Vercel pediu (geralmente):
   - `A` `@` → `76.76.21.21`
   - `CNAME` `www` → `cname.vercel-dns.com`
4. Salvar — propagação leva 15 min a 4h

### 6.3 Mercado Pago — atualizar webhook
- https://mercadopago.com.br/developers/panel/app/.../webhooks
- URL de produção: continua a mesma `https://costajr.com.br/_functions/manut_mp_webhook`
- ❌ ATUALIZAR pra: `https://costajr.com.br/api/manut/mp_webhook` (caminho novo)

---

## ETAPA 7 — Cancelar Wix (depois de tudo migrado e testado)

- Aguarde 30 dias com tudo funcionando no novo
- Acesse Wix → cancelar plano premium

---

## Custos previstos

| Item | Custo |
|---|---|
| Supabase Free | R$ 0 (até 500MB DB + 1GB storage) |
| Vercel Hobby | R$ 0 (até 100GB tráfego) |
| Resend Free | R$ 0 (3k emails/mês) |
| Domínio (já paga) | R$ 40/ano no Registro.br |
| **TOTAL ano 1** | **R$ 40/ano** |

Quando crescer (~1.000 clientes Manutenção):
- Supabase Pro: US$ 25/mês (~R$ 130)
- Vercel: continua grátis até estourar tráfego

---

## Status atual do código (5/maio/2026)

✅ **Pronto:**
- Estrutura completa Astro + TypeScript
- Schema Supabase com todas as tabelas (22)
- Lib `auth.ts` (JWT + hash + helpers)
- Lib `supabase.ts` (cliente público + admin)
- Lib `mercadopago.ts` (preapproval + webhook)
- Lib `manut/clientes.ts` (login, dashboard, contratar)
- Lib `manut/chamados.ts` (CRUD + admin)
- Lib `manut/mpWebhook.ts` (processar webhook MP)
- Endpoint `/api/manut/contratar` (landing pública)
- Endpoint `/api/manut/mp_webhook`
- Endpoint `/api/manut/cliente/login`
- Layout Astro base + página inicial moderna

🚧 **Em andamento (vou continuar):**
- Endpoints restantes (clienteMe, dashboard, lojas, chamados CRUD)
- Lib `manut/preventivas.ts`, `materiais.ts`, `orcamentos.ts`, `tecnicos.ts`
- Lib `portal/*.ts` (admin, KB, chat, profiles)
- Páginas Astro: /sobre, /servicos, /contato, /artigos
- Páginas SPAs: /portal/cliente, /portal/tecnico, /portal/admin, /manutencao/contratar
- Script `db/import-from-wix.ts`

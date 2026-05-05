# Costa Júnior — Site institucional + Portal CJR

Migração 100% do Wix → Astro + Supabase + Vercel.

## Stack

- **Frontend institucional:** Astro (SSR + SSG)
- **Apps internos:** SPAs HTML/JS (Portal Cliente, Técnico, Admin, Contratar Manutenção)
- **Backend API:** Astro server endpoints (Vercel Functions)
- **Banco de dados:** Supabase PostgreSQL
- **Storage:** Supabase Storage (fotos, PDFs)
- **Auth:** Supabase Auth (membros + admin)
- **Email:** Resend
- **Pagamento:** Mercado Pago (Checkout Pro + Subscriptions)
- **Hospedagem:** Vercel (free tier)
- **Domínio:** costajr.com.br

## Estrutura de pastas

```
costajr-novo/
  src/
    pages/                    # Rotas Astro (frontend)
      index.astro             # Início
      sobre.astro
      servicos.astro
      artigos.astro
      contato.astro
      intranet.astro          # Hub da intranet
      manutencao/
        contratar.astro       # Landing pública
      portal/
        cliente/[...].astro   # SPA Cliente
        tecnico/[...].astro   # SPA Técnico
        admin/[...].astro     # SPA Admin
      api/                    # Backend endpoints
        manut/
          contratar.ts
          mp_webhook.ts
          cliente/login.ts
          cliente/me.ts
          tecnico/login.ts
          ...
        portal/
          stats.ts
          members/...
        admin/...
    components/               # Componentes Astro/React reusáveis
    layouts/                  # Layouts Astro
    lib/
      supabase.ts             # Cliente Supabase
      mercadopago.ts          # Helper MP (port do manut.web.js)
      auth.ts                 # JWT helpers
      manut/                  # Lógica de manutenção (port de manut.web.js)
        clientes.ts
        chamados.ts
        preventivas.ts
        materiais.ts
        ...
      portal/                 # Lógica admin/portal
        profiles.ts
        kb.ts
        chat.ts
  public/                     # Assets estáticos (logos, imagens)
  db/
    schema.sql                # Schema PostgreSQL completo
    migrations/               # Alterações futuras
    seed.sql                  # Dados iniciais (planos, etc)
    import-from-wix.ts        # Script de migração Wix → Supabase
  astro.config.mjs
  package.json
  tsconfig.json
  vercel.json
  .env.example
  README.md
```

## Setup local (depois que o repo estiver pronto)

```bash
npm install
cp .env.example .env  # preencher com credenciais
npm run dev           # localhost:4321
```

## Deploy

Push no GitHub → Vercel detecta e deploya automático.

## Migração de dados

```bash
npm run db:migrate    # cria tabelas no Supabase
npm run db:import     # importa do Wix CMS via API
```

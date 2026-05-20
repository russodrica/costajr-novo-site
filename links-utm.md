# Links UTM prontos pra divulgação — Costa Júnior

> Use estes links **sempre** que for divulgar o site fora do próprio costajr.com.br.
> Eles aparecem no `/admin/analytics` agrupados por origem, então você descobre qual canal traz mais visita e — depois — quais convertem em pré-cadastro.

---

## 📱 Instagram

### Bio do Instagram (link único do perfil)
```
https://www.costajr.com.br/manutencao?utm_source=instagram&utm_medium=bio&utm_campaign=perfil
```

### Stories — com sticker "Link"
```
https://www.costajr.com.br/manutencao?utm_source=instagram&utm_medium=stories
```

### Posts no feed (quando puder colocar link nos comentários ou no Linktree)
```
https://www.costajr.com.br/manutencao?utm_source=instagram&utm_medium=post
```

### Anúncio pago no Instagram (quando começar a rodar)
```
https://www.costajr.com.br/manutencao?utm_source=instagram&utm_medium=ads&utm_campaign=NOME_DA_CAMPANHA
```
*Troque `NOME_DA_CAMPANHA` pelo nome do anúncio, ex: `lancamento-marco`.*

---

## 💬 WhatsApp

### Link individual pra mandar pra cliente em conversa
```
https://www.costajr.com.br/manutencao?utm_source=whatsapp&utm_medium=mensagem
```

### Status do WhatsApp
```
https://www.costajr.com.br/manutencao?utm_source=whatsapp&utm_medium=status
```

### Link no WhatsApp Business (descrição do perfil comercial)
```
https://www.costajr.com.br/manutencao?utm_source=whatsapp&utm_medium=perfil
```

---

## 📧 Email

### Assinatura de email (rodapé padrão dos seus emails)
```
https://www.costajr.com.br?utm_source=email&utm_medium=assinatura
```

### Email de proposta comercial
```
https://www.costajr.com.br/manutencao?utm_source=email&utm_medium=proposta
```

### Newsletter / email marketing
```
https://www.costajr.com.br/manutencao?utm_source=email&utm_medium=newsletter&utm_campaign=NOME_DA_CAMPANHA
```

---

## 🖨️ Offline (cartão, panfleto, banner físico)

### Cartão de visita
```
https://www.costajr.com.br?utm_source=offline&utm_medium=cartao
```

### Panfleto / folder
```
https://www.costajr.com.br?utm_source=offline&utm_medium=panfleto
```

### Banner em loja parceira / evento
```
https://www.costajr.com.br?utm_source=offline&utm_medium=banner&utm_campaign=NOME_DO_EVENTO
```

---

## 🔗 LinkedIn

### Perfil pessoal / posts orgânicos
```
https://www.costajr.com.br/manutencao?utm_source=linkedin&utm_medium=organico
```

### Página da empresa
```
https://www.costajr.com.br/manutencao?utm_source=linkedin&utm_medium=pagina-empresa
```

---

## 📘 Facebook

### Perfil/Página orgânico
```
https://www.costajr.com.br/manutencao?utm_source=facebook&utm_medium=organico
```

### Anúncio pago
```
https://www.costajr.com.br/manutencao?utm_source=facebook&utm_medium=ads&utm_campaign=NOME_DA_CAMPANHA
```

---

## 🎯 Google Ads (quando rodar campanha paga)

Use o **gerador de URL UTM** do Google: https://ga-dev-tools.google/campaign-url-builder/

Padrão sugerido pra campanha de busca:
```
https://www.costajr.com.br/manutencao?utm_source=google&utm_medium=cpc&utm_campaign=manutencao-predial-sp&utm_content=ANUNCIO
```

---

## 📊 Como ver os resultados

1. Acesse [costajr.com.br/admin/analytics](https://www.costajr.com.br/admin/analytics)
2. Aguarde alguns dias depois de começar a usar os links acima
3. Em "De onde vieram (sites externos)" você vai ver as origens detalhadas
4. Em "Origem do tráfego" você verá redes sociais aumentando

**Dica:** crie links curtos no [bitly.com](https://bitly.com) ou similar — fica mais fácil de digitar em ambientes onde URL longa atrapalha (ex: stories, cartão de visita).

---

## 🛠️ Como funciona por baixo

Quando alguém clica num link `?utm_source=instagram&utm_medium=bio`, o middleware do site (em `src/middleware.ts`) lê esses parâmetros e salva na tabela `page_views` do Supabase. O painel `/admin/analytics` agrega esses dados.

Os parâmetros são:
- **utm_source**: ONDE veio (instagram, whatsapp, email, google, facebook…)
- **utm_medium**: COMO veio (bio, stories, post, mensagem, cpc, ads…)
- **utm_campaign**: NOME da campanha específica (opcional, mas ajuda a comparar campanhas A vs B)
- **utm_content**: variação do anúncio (opcional — usado pra testar 2 versões do mesmo anúncio)

---

**Criado em 2026-05-20**

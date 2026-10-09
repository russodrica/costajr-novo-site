# O que você mandou no Telegram × o que entrou na Vobi

Fonte: export do grupo **CJR_ADM** (14/06 a 09/10/2026, 890 mensagens, 60 comprovantes),
cruzado com a Vobi em 09/10/2026. **Versão 2 — corrigida.**

> **A primeira versão desta lista acusava 7 pagamentos faltando. Quatro eram erro meu.**
> Eu procurei pelo valor da conta (ex.: R$ 475,00) na lista de contas **em aberto** — e isso
> não acha: (1) compra no cartão fica gravada com os juros embutidos (R$ 537,13); (2) o que
> já foi pago não está na lista de abertas; (3) o nome do fornecedor não vem junto da conta.
> Descobri hoje que a API aceita **busca por nome do lançamento**, e com isso achei os quatro.

---

## ✅ Estavam lançados — eu errei na primeira lista

| Data | Eu disse | Na verdade |
|---|---|---|
| 28/09 | L J G TECNOLOGIA R$ 537,13 não existe | É o **lançamento da SLTECH que você pediu para separar** — já está feito: fornecedor LJG TECNOLOGIA, R$ 791,56 em duas parcelas (R$ 537,13 e R$ 254,43), vencendo 02/11, no cartão, aguardando a fatura de novembro |
| 28/09 | L J G TECNOLOGIA R$ 254,43 não existe | A segunda parcela do mesmo lançamento, acima |
| 17/09 | CEF MATRIZ R$ 723,78 não existe | É o **FGTS_08/2026** — e está **pago**, com baixa em 17/09, Santander, PIX, sem juros |
| 01/10 | SIMONE CARDOSO R$ 317,40 não existe | É o **REEMBOLSO_ELÉTRICA_SIMONE_CARDOSO** (obra Cyrela W.I.K / Escola Alberto Conte) — **pago**, baixa em 02/10, Santander, PIX |

Só uma observação sobre o LJG: o fornecedor foi trocado, mas o **nome** do lançamento continua
"SLTECH SUPORTE REMOTO E BACKUP" (é o nome do serviço, repetido em todas as mensalidades).
Se quiser, eu renomeio para LJG em todas.

## ❌ Falta de verdade — 3 itens

| Data | Quem | Pago | Situação | O que fazer |
|---|---|---|---|---|
| 28/09 | TOKIO MARINE — **seguro da frota** | R$ 1.900,32 | É a **parcela 3/6** do seguro. O lançamento existe ("SEGURO TOKIO MARINE - FROTA, boletos pagos no cartão Nubank") e tem só as parcelas **1/6** (R$ 1.730,23, paga em 28/07) e **2/6** (R$ 1.875,46, paga em 24/08). A 3/6 nunca foi registrada | eu registro: boleto R$ 1.680,48 + R$ 219,84 de encargos, na fatura de 02/11 — **preciso da sua autorização para gravar** |
| 08/10 | recebimento de Adriana Russo da Costa | R$ 60,00 | **é receita**, e não existe receita de R$ 60,00 lançada | me diga de que é, que eu lanço |
| 09/10 | transferência saindo do Banco Villela | R$ 1.889,94 | você cancelou no passo "para qual conta entrou" | reenviar no grupo e escolher o destino |

**Conferi que a 3/6 não duplica nada:** não existe nenhuma parcela de R$ 1.900,32 na base, e
não existe nenhuma parcela de R$ 1.632,63 (o valor de face do carnê) em lugar nenhum da Vobi —
ou seja, as seis parcelas do seguro **não estão lançadas como carnê**; cada boleto entra uma a
uma neste lançamento, conforme é pago no cartão. É por isso que ele nunca aparecia nas buscas.

## ✅ Entrou certo — não precisa fazer nada

ENEL R$ 107,56 (16/09, cartão) · TD SYNNEX R$ 431,34 (17/09) · JÉSSICA R$ 1.416,67 (21/09) ·
CONSTRUTIVO BPO R$ 1.542,79 (21/09) · CHIP VIVO R$ 26,00 (23/09) · TECSYSTEM R$ 620,00 (23/09) ·
MERCADO LIVRE R$ 1.237,89 (25/09) · as baixas de 24 e 25/09 (R$ 600,00 · 119,51 · 340,00 ·
2.223,06 · 187,50 · 2.500,00 · 700,00 · 982,75 · 2.090,71) · as **15 compras da fatura do
Nubank** R$ 6.281,14 (25/09) · R$ 4.860,00 (29/09) · JOSUEL R$ 630,00 (07/10) ·
sindicato R$ 56,82 (08/10, baixei hoje) · 4 transferências entre contas (R$ 571,56 · 1.127,50 ·
1.419,43 · 2.078,02)

**Susto conferido:** a ENEL de R$ 107,56 aparece "Lançado no cartão" **três vezes** na conversa
(16/09 às 08:10, 09:04 e 09:13). Na Vobi existe **uma só** parcela de R$ 107,56 em 02/10, paga.
Não duplicou.

---

## Por que falhou, e o que já mudou

**1. Resposta da leitura cortada no meio — 4 comprovantes perdidos em 16/09.**
A mensagem de erro entregava a causa: *"respondeu fora de JSON: ```json { "valor": 107.56,"*.
O leitor tinha acertado o valor; a resposta é que chegou truncada e o sistema jogava tudo fora.
**Corrigido:** agora ele aproveita o que chegou. Testado com as duas respostas truncadas reais.

**2. Limite da Vobi (HTTP 429) — 16 e 17/09.** Mil consultas por hora para tudo.
Corrigido em 17/09 (cópia local dos fornecedores + aviso claro + botão "tentar de novo").

**3. Conversa abandonada — a maior causa.** O bot pergunta "a qual vencimento se refere?" e a
conversa morre ali. O aviso das 9h já lista essas pendências, e agora você pode pedir a
qualquer hora: mande **`/pendencias`** no grupo.

**4. O bot desistia cedo demais.** Quando não achava conta em aberto pelo fornecedor, ele
parava — foi o que aconteceu com o seguro da Tokio. **Corrigido:** agora ele também procura o
**lançamento pelo nome** (é como eu achei o "SEGURO TOKIO MARINE - FROTA" hoje).

**5. Comprovante que some sem deixar rastro.** Até hoje só ficava registrado o que o bot
*escrevia* na Vobi. Agora **todo comprovante que chega vira uma linha em /admin/logs**.

# O que você mandou no Telegram × o que entrou na Vobi

Fonte: export do grupo **CJR_ADM** (14/06 a 09/10/2026, 890 mensagens) cruzado com as
**1.302 parcelas de despesa em aberto** na Vobi, conferidas hoje, 09/10/2026.

Foram **60 comprovantes enviados**. Boa parte é o mesmo papel reenviado até funcionar
(o Construtivo foi 4 vezes, a ENEL 3, a Caixa 4). Em pagamentos distintos:

---

## ❌ Pagou e NÃO está na Vobi — 7 itens, R$ 5.783,06

| Data | Favorecido | Pago | Por que não entrou | O que fazer |
|---|---|---|---|---|
| 17/09 | CEF MATRIZ | R$ 723,78 | nenhum fornecedor com esse nome tem conta em aberto | me diga do que é (depósito judicial? guia?) |
| 28/09 | TOKIO MARINE (seguro) | R$ 1.900,32 | conta R$ 1.680,48 + R$ 219,84 de encargos do cartão. As 6 parcelas existem na sua tela mas **não aparecem em nenhuma busca da API** | abra a parcela na Vobi → "Detalhes da parcela" → copie o ID → mande no grupo com o comprovante |
| 28/09 | L J G TECNOLOGIA | R$ 537,13 | conta R$ 475,00 + R$ 62,13. Não existe nada em aberto com esse valor nem com esse nome | parece não estar lançado — lançar |
| 28/09 | L J G TECNOLOGIA | R$ 254,43 | conta R$ 225,00 + R$ 29,43. Idem | lançar |
| 01/10 | 53.870.821 SIMONE CARDOSO | R$ 317,40 | a única conta da Simone em aberto é de **R$ 11.340,00 venc. 17/11** — o bot ofereceu essa e você cancelou, com razão | lançar como pagamento novo |
| 08/10 | recebimento de Adriana Russo da Costa | R$ 60,00 | **é receita**, e não há receita de R$ 60,00 em aberto | lançar a receita e reenviar |
| 09/10 | transferência saindo do Banco Villela | R$ 1.889,94 | você cancelou no passo "para qual conta entrou" | reenviar e escolher a conta de destino |

## ✅ Entrou certo — não precisa fazer nada

ENEL R$ 107,56 (16/09, no cartão) · TD SYNNEX R$ 431,34 (17/09) · JÉSSICA R$ 1.416,67 (21/09) ·
CONSTRUTIVO BPO R$ 1.542,79 (21/09) · CHIP VIVO R$ 26,00 (23/09) · as 6 baixas de 24 e 25/09
(R$ 600,00 · 119,51 · 340,00 · 2.223,06 · 187,50 · 2.500,00 · 700,00 · 982,75 · 2.090,71) ·
as **15 compras da fatura do Nubank** R$ 6.281,14 (25/09) · R$ 4.860,00 (29/09) ·
JOSUEL R$ 630,00 (07/10) · 4 transferências entre contas (R$ 571,56 · 1.127,50 · 1.419,43 · 2.078,02)

**Dois sustos que conferi e estão bem:**
- A **ENEL de R$ 107,56** aparece lançada 3 vezes na conversa (08:10, 09:04 e 09:13 de 16/09).
  Fui na Vobi: existe **uma só** parcela de R$ 107,56 em 02/10, já paga. Não duplicou.
- **TECSYSTEM R$ 620,00** (23/09) e **MERCADO LIVRE R$ 1.237,89** (25/09) ficaram no meio da
  conversa, mas as contas correspondentes **não estão mais em aberto** — foram baixadas depois,
  por outro caminho. Nada a fazer.

---

## Por que falhou, e o que já mudou

**1. Resposta da leitura cortada no meio — 4 comprovantes perdidos em 16/09.**
A mensagem de erro entregava a causa: *"respondeu fora de JSON: ```json { "valor": 107.56,"*.
O leitor tinha acertado o valor; a resposta é que chegou truncada e o sistema jogava tudo fora.
**Corrigido hoje:** agora ele aproveita o que chegou (valor, encargos, favorecido, forma).
Testado com as duas respostas truncadas reais: as duas passam a funcionar.

**2. Limite da Vobi (HTTP 429) — 16 e 17/09.** A Vobi libera 1.000 consultas por hora para tudo.
Já estava corrigido em 17/09 (cópia local dos fornecedores + aviso claro + botão "tentar de novo").

**3. Conversa abandonada — a maior causa.** O bot pergunta "a qual vencimento se refere?" e
a conversa morre ali. **O aviso diário das 9h já lista essas pendências**, e desde hoje você
pode pedir a qualquer momento: mande **`/pendencias`** no grupo e ele mostra tudo que começou
e não terminou, com botão para retomar cada uma.

**4. Comprovante que some sem deixar rastro.** Até hoje só ficava registrado o que o bot
*escrevia* na Vobi. Agora **todo comprovante que chega vira uma linha em /admin/logs** —
dá para cruzar recebido × baixado sem depender de export de conversa.

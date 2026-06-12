# Benchmark de softwares — Construção civil e manutenção predial (BR 2025/2026)
## Gap Analysis do Portal CJR e Top 10 melhorias

> Gerado em 12/06/2026 por pesquisa de mercado. Contexto: Costa Júnior Engenharia
> (manutenção predial + obras, ~100 colaboradores) com portal próprio Astro+Supabase.

## (a) Líderes por categoria e funcionalidades-chave

### 1. Financeiro / ERP de obra
| Software | Funcionalidades mais valorizadas |
|---|---|
| **Sienge** (líder) | Conciliação bancária por leitura de extrato (OFX/API), integração bancária para pagamentos/cobranças, medição de obra vinculada a pagamento, custo por obra/centro de custo, IA para prever atraso e margem |
| **Vobi** | 100% nuvem, orçamento com base SINAPI, composição de custos automatizada, portal do cliente da obra |
| **Obra Prima / GO** | Controle financeiro por obra simples, importação OFX, comparativo orçado x realizado |
| **Conta Azul** | Conciliação bancária automática, emissão de NF-e/NFS-e integrada, cobrança automática (boleto/Pix) |

### 2. RH / DP
| Software | Funcionalidades mais valorizadas |
|---|---|
| **Gupy** (R&S) | ATS com IA para triagem de currículos, admissão digital, testes online |
| **Convenia** (DP) | Admissão 100% digital (foto dos docs pelo celular + contrato assinado à distância), assinatura eletrônica em férias/ponto/desligamento, gestão de ASOs, holerites |
| **Sólides** | Perfil comportamental (DISC), jornada do colaborador, clima e engajamento |
| **Factorial** | Ponto conforme Portaria 671, avaliação de desempenho, organograma |

### 3. Comercial / CRM
| Software | Funcionalidades mais valorizadas |
|---|---|
| **CV CRM** (líder no setor) | 365+ funcionalidades para construtoras: espelho de disponibilidade, simulador de financiamento, assinatura digital nativa, chat com IA para leads, pós-venda integrado ao portal do cliente |
| **Pipedrive** | Automação de funil, e-mail/WhatsApp integrados, relatórios de conversão por etapa |
| **RD Station** | Automação de marketing → CRM, lead scoring |
| **Agendor** | Funis múltiplos, integração WhatsApp, app offline para vendedor externo |

### 4. Operacional / Gestão de obra
| Software | Funcionalidades mais valorizadas |
|---|---|
| **Mobuss** | Diário de obra (RDO) digital com mapa de chuvas, histograma de efetivo, checklists de qualidade (FVS) com foto, assistência técnica pós-obra |
| **Prevision** | Planejamento por linha de balanço, todas as obras numa tela em tempo real |
| **Agilean** | Lean Construction, apontamento de avanço físico via WhatsApp, avanço só conta se a qualidade aprovar |

### 5. Gestão de ativos / patrimônio
| Software | Funcionalidades mais valorizadas |
|---|---|
| **Fracttal One** (líder CMMS LATAM) | OS mobile, QR code por ativo, árvore de ativos, planos de manutenção preventiva com reprogramação automática, preditiva com IoT/IA |
| **TrakSM** | Inventário com QR/RFID, termo de responsabilidade, ciclo de vida e depreciação |

**Tendências transversais 2026:** IA aplicada a orçamento/cronograma, BIM (Estratégia BIM BR), gêmeos digitais para manutenção preditiva, dado em tempo real conectado ao financeiro.

## (b) Gap Analysis — Portal CJR vs mercado

| Módulo CJR | Já tem (à frente de muito concorrente) | Falta para ser referência |
|---|---|---|
| **Financeiro** | Contas a pagar/receber, fluxo de caixa, Mercado Pago | Conciliação bancária OFX/Open Finance, custo por obra/centro de custo, orçado x realizado, régua de cobrança Pix/boleto |
| **RH** | Ficha, férias, documentos com vencimento (96 colaboradores + 306 docs já migrados) | Admissão digital pelo celular, D4Sign nos fluxos de RH, gestão ativa de ASOs/NRs com alertas, holerite no portal |
| **Comercial** | Kanban de leads, propostas, metas | Proposta com aceite digital pelo link, integração WhatsApp, funil de pós-venda/recorrência |
| **Operacional** | Módulo Obras, portais cliente/técnico | RDO digital com foto e clima, checklist FVS no app do técnico, apontamento via celular |
| **Ativos** | Termo de responsabilidade com aceite digital (diferencial!) | QR code por ativo, inventário periódico, depreciação |
| **Colaborador** | Onboarding, treinamentos, fórum, base de conhecimento | Trilhas com certificado, pesquisa de clima |

**Resumo:** o portal CJR já cobre a *largura* que empresas de 100 pessoas normalmente só conseguem com 4-5 assinaturas (Convenia + Agendor + Fracttal + Sienge GO ≈ R$ 2-4 mil/mês). Os gaps estão na *profundidade*: automação bancária, assinatura digital embutida em todos os fluxos e captura de dados em campo pelo celular do técnico.

## (c) TOP 10 melhorias priorizadas (impacto x esforço)

| # | Melhoria | Justificativa |
|---|---|---|
| 1 | **Concluir D4Sign e plugá-la em TODOS os fluxos** (proposta, contrato de admissão, férias, termo de ativo) | Código pronto; é o recurso nº 1 que Convenia e CV CRM vendem como diferencial. *Status: aguardando token da D4Sign.* |
| 2 | **OS do técnico com foto antes/depois obrigatória + geolocalização** | Vira prova de serviço para o cliente e reduz disputa de chamado — coração do negócio de manutenção |
| 3 | **QR code nos ativos patrimoniais** (etiqueta → página do ativo) | Custo baixíssimo; iguala TrakSM/Fracttal e impressiona em auditoria |
| 4 | **Conciliação bancária por importação OFX** no Financeiro | Recurso mais citado do Sienge/Conta Azul; elimina horas de planilha por semana |
| 5 | **Custo por obra/contrato + orçado x realizado** | Transforma o fluxo de caixa em ferramenta de margem por contrato |
| 6 | **Admissão digital**: link para o candidato subir documentos pelo celular | Convenia cobra ~R$ 30/colaborador/mês por isso; o módulo de docs com vencimento já é metade do caminho |
| 7 | **RDO (diário de obra) digital com clima, efetivo e fotos** | Exigência contratual crescente; começar simples (form + foto) |
| 8 | **Proposta comercial com link de aceite online** | Encurta ciclo comercial e alimenta a meta do kanban automaticamente |
| 9 | **Régua de cobrança automática Pix/boleto via Mercado Pago** | MP já integrado; reduz inadimplência sem trabalho manual |
| 10 | **Plano de manutenção preventiva por ativo do cliente** (gera OS automática) | Diferencia um CMMS de um help desk; motor de receita recorrente |

**Onde o CJR pode ser pioneiro:** nenhum player nacional combina, num produto só, CMMS de manutenção predial + portal do cliente com pagamento + RH/DP — os concorrentes obrigam a costurar 4 sistemas. Itens 1-3 são quick wins (≤2 semanas cada); itens 5 e 10 são os estruturantes de maior retorno.

# Benchmark RH: Portal CJR × Sólides — o que podemos melhorar

> Pesquisa em 13/06/2026. A Sólides é a maior plataforma de RH/DP do Brasil
> para PMEs. Comparamos o que ela entrega com o que o nosso RH já faz, para
> priorizar melhorias. Fontes no fim.

## O que a Sólides entrega (núcleo)
- **Profiler** — mapeamento de **perfil comportamental** (DISC) em ~5 min; +50 indicadores (perfil, liderança, pontos de melhoria). É o carro-chefe.
- **Recrutamento & Seleção (ATS)** — vagas, triagem, funil, testes, banco de talentos, página de vagas pública.
- **Avaliação de Desempenho** — ciclos (ex.: trimestral), 90°/180°/360°, PDI.
- **Pesquisa de Clima / eNPS** — engajamento e clima.
- **Controle de Ponto eletrônico** + jornada/banco de horas (Portaria 671).
- **Folha de pagamento / DP** + benefícios.
- **People Analytics** — turnover, headcount, absenteísmo, dashboards.
- **Onboarding** e admissão digital.

## Onde o Portal CJR já está em paridade (✅)
| Área | Portal CJR |
|---|---|
| Cadastro/ficha do colaborador | ✅ ficha completa, blocos, anexos por slot, obrigatórios |
| Documentos + vencimentos | ✅ slots, validade clara, alertas 30/15/7, lixeira 30 dias |
| Recrutamento (ATS) | ✅ vagas + kanban de candidatos (funil do board) + contratar |
| Admissão digital | ✅ /admissao/[token] (candidato envia docs) |
| Onboarding | ✅ módulo com vídeo + políticas + progresso |
| Férias | ✅ programação, parcelas, lembretes, sem 2 no mesmo período |
| EPI | ✅ ficha gerada no sistema, CA, alertas 15 dias, assinatura |
| Desligamento | ✅ entrevista + checklist + revogação de acesso |
| Auditoria/segurança | ✅ log de tudo + lixeira (a Sólides não expõe isso ao cliente) |

## Gaps vs Sólides — recomendações priorizadas

| # | Melhoria | Valor | Esforço | Observação |
|---|---|---|---|---|
| **1** | **Avaliação de Desempenho** (ciclo trimestral, formulário p/ coordenador, PDI) | Alto | Médio | **Já está no board** ("Avaliação de Desempenho — envio trimestral"). Reaproveita o motor de notificações. |
| **2** | **Pesquisa de Clima / eNPS** (trimestral, anônima) | Alto | Baixo-Médio | Também no board. Link público por período + dashboard de resultado. |
| **3** | **Perfil comportamental (DISC simplificado)** no candidato e no colaborador | Alto (diferencial) | Médio-Alto | Hoje guardamos só o PDF de "Teste de Personalidade". Um questionário próprio (12–24 itens) gera o perfil dentro do funil de R&S. |
| **4** | **People Analytics de RH** (turnover, headcount por regime/setor, absenteísmo, % docs/EPIs vencidos, tempo médio de contratação) | Alto | Médio | Usa dados que **já temos**. Painel novo no admin. |
| **5** | **Página pública de vagas + candidatura** (candidato se inscreve → cai no kanban) | Médio-Alto | Médio | Mesmo padrão da admissão digital. Alimenta o R&S sem digitação. |
| **6** | **Banco de talentos** (candidatos reprovados reaproveitáveis, com tags) | Médio | Baixo | Já temos `rh_candidatos`; falta a visão de "pool" e busca. |
| 7 | **Controle de ponto / jornada (Portaria 671)** | Médio | **Muito alto** + risco legal | **Recomendação: NÃO construir.** Integrar a uma solução certificada (a CJR já fala em banco de horas). Construir ponto homologado é caro e arriscado. |
| 8 | **Folha de pagamento / DP** | — | Muito alto | **Não construir.** Domínio regulado; manter na contabilidade (o board já manda p/ contabilidade na admissão). |

## Sugestão de ordem
1. **Avaliação de Desempenho** + **Pesquisa de Clima** (estão no board, fecham o ciclo de gestão de pessoas).
2. **People Analytics de RH** (rápido, alto impacto, dados já existem).
3. **Página pública de vagas** + **banco de talentos** (turbina o R&S recém-criado).
4. **Perfil comportamental DISC** (diferencial competitivo; faz o R&S "pensar" como a Sólides).
5. Ponto e folha: **integrar**, não construir.

---
Fontes: [15 funcionalidades da Sólides](https://solides.com.br/blog/funcionalidades-solides/) · [Recrutamento e Seleção](https://solides.com.br/solucoes/recrutamento-e-selecao/) · [Sistema de RH](https://solides.com.br/blog/sistema-de-rh/)

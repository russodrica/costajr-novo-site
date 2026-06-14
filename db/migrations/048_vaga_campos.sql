-- ============================================================================
-- 048 — Campos da vaga (alinhar com o app PowerApps "Gestão de pessoas").
--   Form da vaga: Titulo, Data (abertura), Demanda, Area(=setor), Data prevista
--   p/ inicio, Perfil desejado, Habilitacao, Trabalho (modo), Tipo de contratacao,
--   Status. Acrescenta o que faltava em rh_vagas.
-- ============================================================================

alter table rh_vagas add column if not exists data_abertura date;
alter table rh_vagas add column if not exists data_prevista date;
alter table rh_vagas add column if not exists demanda text;            -- Nova | Reposição | Aumento de quadro
alter table rh_vagas add column if not exists perfil_desejado text;    -- Colaborativo | Competitivo | Analítico | Executor ...
alter table rh_vagas add column if not exists habilitacao text;        -- Indiferente | Obrigatória
alter table rh_vagas add column if not exists modo_trabalho text;      -- Presencial | Remoto | Híbrido
alter table rh_vagas add column if not exists tipo_contratacao text;   -- CLT | PJ | CLT, PJ ...

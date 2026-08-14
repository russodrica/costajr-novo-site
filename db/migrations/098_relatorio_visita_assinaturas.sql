-- 098_relatorio_visita_assinaturas.sql
--
-- Assinatura no próprio relatório, feita com o dedo na tela do celular ainda
-- em campo — em vez de imprimir, assinar no papel e digitalizar depois.
--
-- A assinatura é guardada como imagem PNG em base64 (data URL). É um traço
-- monocromático pequeno, na casa de poucos KB: cabe no registro e viaja junto
-- com ele, sem depender de um arquivo solto no depósito de fotos que pode se
-- perder de vista.

alter table obras_rdo add column if not exists assinatura_visita       text;
alter table obras_rdo add column if not exists assinatura_visita_nome  text;
alter table obras_rdo add column if not exists assinatura_cliente      text;
alter table obras_rdo add column if not exists assinatura_cliente_nome text;
alter table obras_rdo add column if not exists assinado_em             timestamptz;

comment on column obras_rdo.assinatura_visita is
  'PNG em data URL da assinatura de quem fez a visita (traçada com o dedo/mouse na tela).';
comment on column obras_rdo.assinatura_cliente is
  'PNG em data URL da assinatura de quem recebeu a visita na obra.';

-- ─── uma foto só por arquivo enviado ────────────────────────────────────────
-- Sem isto, um duplo toque no botão de enviar registra a MESMA foto duas vezes
-- e o relatório sai com a imagem repetida.
delete from obras_rdo_fotos a
 using obras_rdo_fotos b
 where a.storage_path = b.storage_path
   and a.ctid > b.ctid;

create unique index if not exists idx_obras_rdo_fotos_path
  on obras_rdo_fotos(storage_path);

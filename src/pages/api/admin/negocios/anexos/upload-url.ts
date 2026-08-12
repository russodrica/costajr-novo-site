import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../lib/permissoes";
import {
  BUCKET_NEGOCIOS, storageNegocios, garantirBucketNegocios, TIPOS_ANEXO_VALORES,
} from "../../../../../lib/negocios";

export const prerender = false;

const MODULO = "negocios";
const EXT_FOTO = ["jpg", "jpeg", "png", "webp", "heic", "gif"];
const EXT_DOC = [...EXT_FOTO, "pdf", "doc", "docx", "xls", "xlsx", "csv"];

// POST /api/admin/negocios/anexos/upload-url
// Devolve uma URL assinada para o navegador mandar o arquivo DIRETO ao bucket
// privado. É o mesmo caminho já usado pelos Documentos da Empresa e Bancários.
//
// Por que não multipart: o Astro recusa POST de formulário quando o cabeçalho
// Origin não bate (proteção contra CSRF) e isso derruba QUALQUER envio de
// arquivo por formulário no portal. Passando por URL assinada o corpo nem
// atravessa a Vercel — some junto o limite de tamanho da função.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const body = await request.json().catch(() => null);
    if (!body) return jsonErr(400, "Envie os dados do arquivo.");

    const imovel_id = String(body.imovel_id || "").trim();
    if (!imovel_id) return jsonErr(400, "Cadastro não informado.");
    const { data: imovel } = await db.from("negocios_imoveis").select("id").eq("id", imovel_id).maybeSingle();
    if (!imovel) return jsonErr(404, "Cadastro não encontrado.");

    const pedida = String(body.especie || "documento");
    const especie = pedida === "foto" ? "foto" : pedida === "conversa" ? "conversa" : "documento";
    const tipo = String(body.tipo || "outro").trim();
    if (especie === "documento" && !TIPOS_ANEXO_VALORES.includes(tipo)) return jsonErr(400, "Tipo de documento inválido.");

    const nomeOriginal = String(body.nome || "arquivo").slice(0, 150);
    const ext = (nomeOriginal.includes(".") ? nomeOriginal.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    const permitidas = especie === "foto" ? EXT_FOTO : EXT_DOC;
    if (!ext || !permitidas.includes(ext)) {
      return jsonErr(400, especie === "foto"
        ? "Para a galeria, envie uma imagem (JPG, PNG ou WEBP)."
        : `Extensão .${ext || "?"} não aceita — envie PDF, Word, Excel ou imagem.`);
    }

    await garantirBucketNegocios();
    const slug = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pasta = especie === "foto" ? "fotos" : especie === "conversa" ? "conversas" : "docs";
    const path = `${pasta}/${imovel_id}/${slug}.${ext}`;
    const { data, error } = await storageNegocios().storage.from(BUCKET_NEGOCIOS).createSignedUploadUrl(path);
    if (error) return jsonErr(500, `Não deu para preparar o envio: ${error.message}`);

    return jsonOk({ signed_url: data.signedUrl, path, nome_original: nomeOriginal });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

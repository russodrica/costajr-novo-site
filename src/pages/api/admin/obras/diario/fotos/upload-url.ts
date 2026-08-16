import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../../lib/supabase";
import { bloqueioSeSoLeitura } from "../../../../../../lib/permissoes";
import { BUCKET_OBRAS, storageObras, garantirBucketObras } from "../../../../../../lib/rdo";

export const prerender = false;
const MODULO = "obras-diario";
const EXT_OK = ["jpg", "jpeg", "png", "webp", "heic", "gif"];

// POST /api/admin/obras/diario/fotos/upload-url  { rdo_id, nome }
// Devolve uma URL assinada para o navegador (ou o celular, na obra) mandar a
// foto DIRETO ao bucket privado.
//
// Por que não multipart: o Astro recusa POST de formulário quando o Origin não
// bate (proteção anti-CSRF), o que derruba qualquer envio de arquivo por
// formulário. Com URL assinada o arquivo nem passa pela Vercel — some junto o
// limite de tamanho da função, o que importa para foto de celular.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const bl = await bloqueioSeSoLeitura(admin, MODULO); if (bl) return bl;
    const db = supabaseAdmin();

    const body = await request.json().catch(() => null);
    const rdo_id = String(body?.rdo_id || "").trim();
    if (!rdo_id) return jsonErr(400, "Relatório não informado.");

    const { data: rdo } = await db.from("obras_rdo").select("id, obra_id, fundacao_id").eq("id", rdo_id).maybeSingle();
    if (!rdo) return jsonErr(404, "Relatório não encontrado.");

    const nomeOriginal = String(body?.nome || "foto.jpg").slice(0, 150);
    const ext = (nomeOriginal.includes(".") ? nomeOriginal.split(".").pop() : "")
      ?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    if (!ext || !EXT_OK.includes(ext)) {
      return jsonErr(400, "Envie uma imagem (JPG, PNG, WEBP ou HEIC).");
    }

    const slug = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pasta = rdo.fundacao_id || rdo.obra_id || "sem-obra";
    const path = `rdo/${pasta}/${rdo_id}/${slug}.${ext}`;

    // O bucket é criado na primeira foto. Se ele não existir e a criação falhar,
    // o erro precisa CHEGAR à tela: "não deu para enviar" sem motivo é o que
    // torna esse tipo de problema impossível de resolver à distância.
    let assinada = await storageObras().storage.from(BUCKET_OBRAS).createSignedUploadUrl(path);
    if (assinada.error) {
      const erroCriacao = await garantirBucketObras();
      if (erroCriacao) {
        console.error("[rdo-foto] bucket:", erroCriacao);
        return jsonErr(500, `Depósito de fotos indisponível: ${erroCriacao}`);
      }
      assinada = await storageObras().storage.from(BUCKET_OBRAS).createSignedUploadUrl(path);
    }
    const { data, error } = assinada;
    if (error || !data?.signedUrl) {
      console.error("[rdo-foto] signed url:", error?.message);
      return jsonErr(500, `Não deu para preparar o envio: ${error?.message || "sem URL"}`);
    }

    return jsonOk({ signed_url: data.signedUrl, path, nome_original: nomeOriginal });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

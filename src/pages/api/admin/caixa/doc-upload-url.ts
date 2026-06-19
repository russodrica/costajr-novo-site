import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { bloqueioSeSoLeitura } from "~/lib/permissoes";

export const prerender = false;

// POST { nome, content_type } → URL assinada p/ o navegador subir o arquivo direto
// ao bucket PRIVADO `rh` (LGPD), na pasta inbox/. Sem passar pelo limite de body da Vercel.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    const _ro = await bloqueioSeSoLeitura(admin, "caixa-entrada"); if (_ro) return _ro;
    const { nome } = await request.json();
    if (!nome) return jsonErr(400, "Informe o nome do arquivo.");

    const ext = String(nome).split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const permitidas = ["pdf", "png", "jpg", "jpeg", "webp", "doc", "docx"];
    if (!permitidas.includes(ext)) return jsonErr(400, `Formato .${ext} não aceito — envie PDF, imagem ou DOC/DOCX.`);

    const slug = String(nome)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 50).toLowerCase();
    const path = `inbox/${Date.now()}-${slug || "doc"}.${ext}`;

    const sb = supabaseAdmin();
    const { data, error } = await sb.storage.from("rh").createSignedUploadUrl(path);
    if (error) return jsonErr(500, error.message);
    return jsonOk({ signed_url: data.signedUrl, token: data.token, path });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

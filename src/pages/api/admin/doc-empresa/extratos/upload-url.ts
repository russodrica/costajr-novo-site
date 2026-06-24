import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

const PERFIS = ["admin", "financeiro", "juridico"];
const EXT_OK = ["pdf", "jpg", "jpeg", "png", "webp", "xls", "xlsx", "csv", "ofx"];

function slugBanco(s: string) {
  return String(s || "banco").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "banco";
}

// POST → devolve URL assinada p/ subir o extrato DIRETO ao bucket privado doc-empresa,
// sob extratos/{ano}/{mm}/{banco}/. Sem passar pelo limite de body da Vercel.
export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");
    const body = await request.json();
    const ano = Number(body.ano), mes = Number(body.mes);
    const banco = String(body.banco || "").trim();
    if (!ano || ano < 2000 || mes < 1 || mes > 12 || !banco) return jsonErr(400, "Informe ano, mês e banco.");

    const nomeOriginal = String(body.nome || "extrato").slice(0, 150);
    const ext = (nomeOriginal.includes(".") ? nomeOriginal.split(".").pop() : "")?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    if (!EXT_OK.includes(ext)) return jsonErr(400, `Extensão .${ext} não permitida.`);

    const db = supabaseAdmin();
    const slug = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `extratos/${ano}/${String(mes).padStart(2, "0")}/${slugBanco(banco)}/${slug}.${ext}`;
    const { data, error } = await db.storage.from("doc-empresa").createSignedUploadUrl(path);
    if (error) return jsonErr(500, error.message);
    return jsonOk({ signed_url: data.signedUrl, path, nome_original: nomeOriginal });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};

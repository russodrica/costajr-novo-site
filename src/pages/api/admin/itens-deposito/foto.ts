import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { bloqueioSeSoLeitura } from "../../../../lib/permissoes";
import { ITENS_BUCKET, gravarItens, lerItens } from "../../../../lib/itensDeposito";

export const prerender = false;

// Miniatura para a tela do administrador (cookie de admin).
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, ["admin"])) return new Response("Sem permissão", { status: 403 });
    const db = supabaseAdmin();
    const n = Number(url.searchParams.get("n"));
    const item = (await lerItens(db)).find((i) => i.n === n);
    if (!item?.foto) return new Response("Sem foto", { status: 404 });
    const { data } = await db.storage.from(ITENS_BUCKET).download(item.foto);
    if (!data) return new Response("Sem foto", { status: 404 });
    return new Response(await data.arrayBuffer(), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" } });
  } catch {
    return new Response("Não autenticado", { status: 401 });
  }
};

// POST multipart (campo "arquivo") ?n=<item> → troca a foto do item. A tela já
// reduz a imagem para JPEG de até ~1100 px; aqui só conferimos tipo e tamanho.
export const POST: APIRoute = async ({ request, url }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, ["admin"])) return jsonErr(403, "Sem permissão");
    const ro = await bloqueioSeSoLeitura(admin, "itens-deposito"); if (ro) return ro;
    const n = Number(url.searchParams.get("n"));
    const form = await request.formData();
    const arq = form.get("arquivo");
    if (!arq || typeof arq === "string") return jsonErr(400, "Envie uma imagem.");
    const buf = new Uint8Array(await (arq as File).arrayBuffer());
    if (buf.length < 1000 || buf.length > 4_000_000) return jsonErr(400, "Imagem inválida ou grande demais (máx. 4 MB).");
    // JPEG começa com FF D8 FF
    if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return jsonErr(400, "Use uma imagem JPEG.");

    const db = supabaseAdmin();
    const itens = await lerItens(db);
    const it = itens.find((i) => i.n === n);
    if (!it) return jsonErr(404, "Item não encontrado.");

    const nova = `fotos/${n}-${Date.now()}.jpg`; // chave nova: não pega cache da foto antiga
    const { error } = await db.storage.from(ITENS_BUCKET).upload(nova, buf, { contentType: "image/jpeg", upsert: false });
    if (error) return jsonErr(500, "Não consegui guardar a foto: " + error.message);
    const antiga = it.foto;
    it.foto = nova;
    await gravarItens(db, itens);
    if (antiga && antiga !== nova) { try { await db.storage.from(ITENS_BUCKET).remove([antiga]); } catch { /* ignora */ } }
    await registrarAcao(db, { req: request, admin }, {
      acao: "editar", entidade: "itens_deposito_item", registro_id: String(n),
      descricao: `Trocou a foto do item #${n} (${it.nome})`,
    });
    return jsonOk({ ok: true, foto: nova });
  } catch (e: any) {
    const auth = e.message === "Não autenticado" || e.message === "Token inválido";
    return jsonErr(auth ? 401 : 500, e.message || "Falha ao trocar a foto.");
  }
};

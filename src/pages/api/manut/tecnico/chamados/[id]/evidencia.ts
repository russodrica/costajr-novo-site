import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { uploadFotoEvidencia } from "~/lib/manut/chamados";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const { mime, data_base64 } = await request.json();
    if (!mime || !data_base64) return jsonErr(400, "mime e data_base64 obrigatórios");
    const tiposOk = ["image/jpeg", "image/png", "image/webp"];
    if (!tiposOk.includes(mime)) return jsonErr(400, "Formato inválido (use JPG, PNG ou WEBP)");
    const r = await uploadFotoEvidencia({
      chamadoId: params.id!,
      tecnicoId: claims.sub,
      mime,
      dataBase64: data_base64,
    });
    return jsonOk(r);
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};

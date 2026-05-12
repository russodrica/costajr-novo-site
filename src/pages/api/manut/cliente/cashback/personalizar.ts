import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const { codigo: codigoRaw } = await request.json();
    const codigo = String(codigoRaw || "").trim().toUpperCase();
    if (codigo.length < 5) return jsonErr(400, "Mínimo 5 caracteres");
    if (!/^[A-Z0-9]+$/.test(codigo)) return jsonErr(400, "Apenas letras e números");

    const db = supabaseAdmin();

    // Cupom indicação atual do cliente
    const { data: meu } = await db
      .from("manut_cupons")
      .select("id,codigo")
      .eq("cliente_dono_id", claims.sub)
      .eq("tipo", "indicacao")
      .maybeSingle();
    if (!meu) return jsonErr(404, "Cupom de indicação não encontrado — recarregue a página");
    if (meu.codigo === codigo) return jsonOk({ ok: true, codigo });

    // Verifica unicidade
    const { data: dup } = await db.from("manut_cupons").select("codigo").eq("codigo", codigo).maybeSingle();
    if (dup) return jsonErr(409, "Esse código já está em uso. Escolha outro.");

    const { error } = await db.from("manut_cupons").update({ codigo }).eq("id", meu.id);
    if (error) throw new Error(error.message);

    return jsonOk({ ok: true, codigo });
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};

import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { criarPreferenceMaterial } from "~/lib/mercadopago";

export const prerender = false;

// POST /api/manut/cliente/materiais/[id]/pagamento
// Gera (ou reutiliza) o link de pagamento Mercado Pago para o material.
// Resposta: { initPoint, preferenceId }
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireCliente(request);
    const id = params.id!;
    const db = supabaseAdmin();

    const { data: mat } = await db
      .from("manut_materiais")
      .select("*, manut_clientes(nome,email)")
      .eq("id", id)
      .single();
    if (!mat) return jsonErr(404, "Material não encontrado");
    if (mat.cliente_id !== claims.sub) return jsonErr(403, "Material não pertence a você");

    // Reusa o link existente se já foi criado
    if (mat.mercado_pago_init_point) {
      return jsonOk({ initPoint: mat.mercado_pago_init_point, preferenceId: mat.mercado_pago_preference_id, reused: true });
    }

    const mp = await criarPreferenceMaterial({
      cliente: {
        id: claims.sub,
        email: claims.email || (mat.manut_clientes as any)?.email || "comprador@costajr.com.br",
        nome: (mat.manut_clientes as any)?.nome || "Cliente",
      },
      material: {
        id: mat.id,
        descricao: mat.descricao,
        valor: Number(mat.valor),
      },
    });
    if (!mp.ok) return jsonErr(400, "Falha ao gerar pagamento: " + mp.motivo);

    await db
      .from("manut_materiais")
      .update({
        mercado_pago_preference_id: mp.preferenceId,
        mercado_pago_init_point: mp.initPoint,
      })
      .eq("id", id);

    return jsonOk({ initPoint: mp.initPoint, preferenceId: mp.preferenceId, reused: false });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};

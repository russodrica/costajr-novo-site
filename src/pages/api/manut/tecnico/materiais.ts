import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    const { data, error } = await supabaseAdmin()
      .from("manut_materiais")
      .select("*, manut_lojas(nome), manut_clientes(nome)")
      .eq("tecnico_solicitante_id", claims.sub)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    const body = await request.json();
    const { chamado_id, loja_id, cliente_id, descricao, valor } = body;
    if (!descricao?.trim()) throw new Error("Descrição é obrigatória");
    if (!valor || Number(valor) <= 0) throw new Error("Valor inválido");
    if (!loja_id || !cliente_id) throw new Error("Loja e cliente são obrigatórios");

    // SEGURANÇA (IDOR): o técnico só pode lançar material em loja vinculada a ele.
    const lojasDele = await listarLojaIdsDoTecnico(claims.sub);
    if (!lojasDele.includes(loja_id)) {
      return jsonErr(403, "Loja não vinculada a este técnico");
    }
    // O cliente_id precisa ser o dono real da loja (não o enviado pelo técnico).
    const { data: loja } = await supabaseAdmin()
      .from("manut_lojas")
      .select("cliente_id")
      .eq("id", loja_id)
      .maybeSingle();
    if (!loja) throw new Error("Loja não encontrada");
    const clienteReal = (loja as any).cliente_id;

    const { data, error } = await supabaseAdmin()
      .from("manut_materiais")
      .insert({
        tecnico_solicitante_id: claims.sub,
        chamado_id: chamado_id || null,
        loja_id,
        cliente_id: clienteReal,
        descricao: descricao.trim(),
        valor: Number(valor),
        status: "pendente_aprovacao",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return jsonOk(data, 201);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 400, e.message);
  }
};

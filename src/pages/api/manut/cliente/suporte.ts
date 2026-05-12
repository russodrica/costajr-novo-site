import type { APIRoute } from "astro";
import { requireCliente, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { enviarEmailSuporteAdmin } from "~/lib/mailer";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const { data } = await supabaseAdmin()
      .from("manut_suporte")
      .select("*")
      .eq("usuario_tipo", "cliente")
      .eq("usuario_id", claims.sub)
      .order("created_at", { ascending: false });
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireCliente(request);
    const { assunto, descricao } = await request.json();
    if (!assunto || !descricao) return jsonErr(400, "Assunto e descrição obrigatórios");

    const db = supabaseAdmin();
    const { data: cli } = await db.from("manut_clientes").select("nome,email").eq("id", claims.sub).maybeSingle();

    const { data: ticket, error } = await db
      .from("manut_suporte")
      .insert({
        usuario_tipo: "cliente",
        usuario_id: claims.sub,
        usuario_nome: cli?.nome,
        assunto: String(assunto).slice(0, 200),
        descricao: String(descricao).slice(0, 4000),
        status: "aberto",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    try {
      await enviarEmailSuporteAdmin({
        clienteNome: cli?.nome || "Cliente",
        email: cli?.email || "",
        assunto: ticket.assunto,
        descricao: ticket.descricao,
        ticketId: ticket.id,
      });
    } catch (e: any) {
      console.warn("[suporte] email falhou:", e?.message);
    }

    return jsonOk(ticket);
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};

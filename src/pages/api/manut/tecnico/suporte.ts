import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { enviarEmailSuporteAdmin } from "~/lib/mailer";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    const { data } = await supabaseAdmin()
      .from("manut_suporte")
      .select("*")
      .eq("usuario_tipo", "tecnico")
      .eq("usuario_id", claims.sub)
      .order("created_at", { ascending: false });
    return jsonOk(data || []);
  } catch (e: any) {
    return jsonErr(401, e.message);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const claims = await requireTecnico(request);
    const { assunto, descricao } = await request.json();
    if (!assunto || !descricao) return jsonErr(400, "Assunto e descrição obrigatórios");

    const db = supabaseAdmin();
    const { data: tec } = await db.from("manut_tecnicos").select("nome,email").eq("id", claims.sub).maybeSingle();

    const { data: ticket, error } = await db
      .from("manut_suporte")
      .insert({
        usuario_tipo: "tecnico",
        usuario_id: claims.sub,
        usuario_nome: tec?.nome,
        assunto: String(assunto).slice(0, 200),
        descricao: String(descricao).slice(0, 4000),
        status: "aberto",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    try {
      await enviarEmailSuporteAdmin({
        clienteNome: tec?.nome || "Técnico",
        email: tec?.email || "",
        assunto: ticket.assunto,
        descricao: ticket.descricao,
        ticketId: ticket.id,
      });
    } catch (e: any) {
      console.warn("[suporte][tecnico] email falhou:", e?.message);
    }

    return jsonOk(ticket);
  } catch (e: any) {
    return jsonErr(400, e.message);
  }
};

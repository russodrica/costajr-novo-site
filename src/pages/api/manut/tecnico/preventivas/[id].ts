import type { APIRoute } from "astro";
import { requireTecnico, jsonOk, jsonErr } from "~/lib/auth";
import { supabaseAdmin } from "~/lib/supabase";
import { listarLojaIdsDoTecnico } from "~/lib/manut/tecnicos";
import { checklistInicial } from "~/lib/manut/checklist";

export const prerender = false;

// GET — detalhe da preventiva
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const id = params.id!;
    const db = supabaseAdmin();
    const { data: prev, error } = await db
      .from("manut_preventivas")
      .select("*, manut_lojas(nome,endereco,cidade,uf,tamanho_m2,especialidades), manut_clientes(nome,telefone,email)")
      .eq("id", id)
      .single();
    if (error || !prev) return jsonErr(404, "Preventiva não encontrada");

    // Autorização: precisa estar atribuída a ele OU ele cobre a loja
    const lojasDele = await listarLojaIdsDoTecnico(claims.sub);
    const autorizado = prev.tecnico_atribuido_id === claims.sub || lojasDele.includes(prev.loja_id);
    if (!autorizado) return jsonErr(403, "Sem permissão para esta preventiva");

    return jsonOk(prev);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};

// PATCH — atualizar checklist / iniciar / concluir
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const claims = await requireTecnico(request);
    const id = params.id!;
    const body = await request.json();
    // Campos permitidos: action ("iniciar" | "concluir") OU checklist + status manual
    const db = supabaseAdmin();
    const { data: prev, error: getErr } = await db
      .from("manut_preventivas")
      .select("id,loja_id,tecnico_atribuido_id,status,checklist,data_executada")
      .eq("id", id)
      .single();
    if (getErr || !prev) return jsonErr(404, "Preventiva não encontrada");

    const lojasDele = await listarLojaIdsDoTecnico(claims.sub);
    const autorizado = prev.tecnico_atribuido_id === claims.sub || lojasDele.includes(prev.loja_id);
    if (!autorizado) return jsonErr(403, "Sem permissão");

    const updates: any = {};

    if (body.action === "iniciar") {
      if (prev.status === "concluida" || prev.status === "cancelada") {
        return jsonErr(400, "Preventiva já encerrada");
      }
      updates.status = "em_execucao";
      // Auto-atribui ao técnico que iniciou (se ainda não atribuído)
      if (!prev.tecnico_atribuido_id) updates.tecnico_atribuido_id = claims.sub;
      // Inicializa checklist se ainda não existe
      if (!prev.checklist) updates.checklist = checklistInicial();
    } else if (body.action === "concluir") {
      if (prev.status !== "em_execucao") {
        return jsonErr(400, "Inicie a preventiva antes de concluir");
      }
      updates.status = "concluida";
      updates.data_executada = new Date().toISOString();
      if (prev.checklist) {
        const checklist = { ...prev.checklist, concluido_em: new Date().toISOString() };
        if (body.checklist) Object.assign(checklist, body.checklist);
        updates.checklist = checklist;
      }
    } else if (body.checklist) {
      updates.checklist = body.checklist;
    } else {
      return jsonErr(400, "Nada a atualizar");
    }

    const { data, error } = await db
      .from("manut_preventivas")
      .update(updates)
      .eq("id", id)
      .select("*, manut_lojas(nome,endereco,cidade,uf), manut_clientes(nome)")
      .single();
    if (error) return jsonErr(400, error.message);
    return jsonOk(data);
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" || e.message === "Token inválido" ? 401 : 500, e.message);
  }
};

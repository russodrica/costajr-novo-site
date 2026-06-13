import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../../lib/auth";
import { supabaseAdmin } from "../../../../../lib/supabase";

export const prerender = false;

const REGIMES = ["clt", "pj", "estagio", "temporario", "socio", "diarista"];
const STATUS = ["ativo", "ferias", "afastado", "desligado"];
const REGIME_ROTULO: Record<string, string> = { clt: "clt", pj: "pj", estagio: "estagio", "estágio": "estagio", temporario: "temporario", "temporário": "temporario", socio: "socio", "sócio": "socio", diarista: "diarista" };
const STATUS_ROTULO: Record<string, string> = { ativo: "ativo", ferias: "ferias", "férias": "ferias", afastado: "afastado", desligado: "desligado" };

const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function mapHeader(h: string): string | null {
  const n = norm(h);
  const m: Record<string, string> = {
    "id": "id", "nome": "nome", "e mail": "email", "email": "email", "telefone": "telefone",
    "cpf": "cpf", "rg": "rg", "data nascimento": "data_nascimento", "cargo": "cargo", "setor": "setor",
    "regime": "regime", "salario": "salario", "data admissao": "data_admissao", "status": "status",
    "cidade": "cidade", "uf": "uf", "pix": "pix", "banco": "banco", "agencia": "agencia", "conta": "conta",
    "observacoes": "observacoes",
  };
  return m[n] || null;
}

function parseCsv(texto: string): string[][] {
  let t = texto.replace(/^﻿/, "");
  const head = t.split("\n")[0];
  const delim = (head.match(/;/g)?.length || 0) >= (head.match(/,/g)?.length || 0) ? ";" : ",";
  const linhas: string[][] = []; let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c; }
    else if (c === '"') aspas = true;
    else if (c === delim) { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo.length || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function dataValida(s: string): string | null {
  const v = String(s || "").trim(); if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/) || v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const iso = v.includes("/") ? `${m[3]}-${m[2]}-${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`;
  return isNaN(new Date(iso).getTime()) ? null : iso;
}

// POST { csv, confirmar?: boolean } — importa colaboradores em massa (dry-run ou executa)
export const POST: APIRoute = async ({ request }) => {
  let admin;
  try { admin = await requireAdminCookie(request); } catch { return jsonErr(401, "Não autenticado."); }

  try {
    const { csv: texto, confirmar } = await request.json();
    if (!texto || typeof texto !== "string") return jsonErr(400, "Envie o conteúdo do arquivo CSV.");
    const rows = parseCsv(texto).filter((r) => !(r.length === 1 && r[0].trim() === "") && !String(r[0]).trim().startsWith("#"));
    if (rows.length < 2) return jsonErr(400, "Planilha sem dados.");

    const headers = rows[0].map(mapHeader);
    if (!headers.includes("nome")) return jsonErr(400, "Cabeçalho inválido: a coluna 'Nome' é obrigatória. Baixe o modelo.");
    const presentes = new Set(headers.filter(Boolean) as string[]);

    const db = supabaseAdmin();
    const { data: existentes } = await db.from("rh_colaboradores").select("id, cpf");
    const idsValidos = new Set((existentes || []).map((c) => c.id));
    const idPorCpf = new Map<string, string>();
    for (const c of existentes || []) if (c.cpf) idPorCpf.set(String(c.cpf).replace(/\D/g, ""), c.id);

    const analise = { criar: 0, atualizar: 0, erros: [] as { linha: number; motivo: string }[] };
    const inserir: any[] = []; const atualizar: { id: string; patch: any }[] = [];

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (cells.every((c) => !String(c).trim())) continue;
      const obj: Record<string, string> = {};
      headers.forEach((campo, i) => { if (campo) obj[campo] = (cells[i] ?? "").trim(); });

      if (!obj.nome) { analise.erros.push({ linha: r + 1, motivo: "Nome vazio" }); continue; }

      let regime: string | undefined;
      if (presentes.has("regime") && obj.regime) {
        regime = REGIME_ROTULO[norm(obj.regime)] || (REGIMES.includes(obj.regime) ? obj.regime : "");
        if (!regime) { analise.erros.push({ linha: r + 1, motivo: `Regime inválido: "${obj.regime}"` }); continue; }
      }
      let status: string | undefined;
      if (presentes.has("status") && obj.status) {
        status = STATUS_ROTULO[norm(obj.status)] || (STATUS.includes(obj.status) ? obj.status : "");
        if (!status) { analise.erros.push({ linha: r + 1, motivo: `Status inválido: "${obj.status}"` }); continue; }
      }
      let salario: number | null = null;
      if (presentes.has("salario") && obj.salario) {
        salario = Number(String(obj.salario).replace(/\./g, "").replace(",", ".")) || Number(obj.salario);
        if (isNaN(salario as number)) { analise.erros.push({ linha: r + 1, motivo: `Salário inválido: "${obj.salario}"` }); continue; }
      }
      let dataNasc: string | null = null, dataAdm: string | null = null;
      if (presentes.has("data_nascimento") && obj.data_nascimento) {
        dataNasc = dataValida(obj.data_nascimento);
        if (!dataNasc) { analise.erros.push({ linha: r + 1, motivo: `Data de nascimento inválida: "${obj.data_nascimento}"` }); continue; }
      }
      if (presentes.has("data_admissao") && obj.data_admissao) {
        dataAdm = dataValida(obj.data_admissao);
        if (!dataAdm) { analise.erros.push({ linha: r + 1, motivo: `Data de admissão inválida: "${obj.data_admissao}"` }); continue; }
      }

      const campo: any = { nome: obj.nome };
      const set = (col: string, key: string, val: any) => { if (presentes.has(col)) campo[key] = val; };
      set("email", "email", obj.email || null);
      set("telefone", "telefone", obj.telefone || null);
      set("cpf", "cpf", obj.cpf || null);
      set("rg", "rg", obj.rg || null);
      set("data_nascimento", "data_nascimento", dataNasc);
      set("cargo", "cargo", obj.cargo || null);
      set("setor", "setor", obj.setor || null);
      if (presentes.has("regime")) campo.regime = regime || null;
      set("salario", "salario", salario);
      set("data_admissao", "data_admissao", dataAdm);
      if (presentes.has("status")) campo.status = status || "ativo";
      set("cidade", "cidade", obj.cidade || null);
      set("uf", "uf", obj.uf || null);
      set("pix", "pix", obj.pix || null);
      set("banco", "banco", obj.banco || null);
      set("agencia", "agencia", obj.agencia || null);
      set("conta", "conta", obj.conta || null);
      set("observacoes", "observacoes", obj.observacoes || null);

      const cpfDig = (obj.cpf || "").replace(/\D/g, "");
      let idAlvo = obj.id && idsValidos.has(obj.id) ? obj.id : null;
      if (!idAlvo && obj.id) { analise.erros.push({ linha: r + 1, motivo: `ID informado não existe: ${obj.id}` }); continue; }
      if (!idAlvo && cpfDig.length === 11 && idPorCpf.has(cpfDig)) idAlvo = idPorCpf.get(cpfDig)!;

      if (idAlvo) { atualizar.push({ id: idAlvo, patch: { ...campo, updated_at: new Date().toISOString() } }); analise.atualizar++; }
      else { inserir.push({ ...campo, criado_por: admin.email }); analise.criar++; }
    }

    if (!confirmar) return jsonOk({ dry_run: true, ...analise, total_linhas: rows.length - 1 });

    let criados = 0, atualizados = 0;
    for (let i = 0; i < inserir.length; i += 200) {
      const { data, error } = await db.from("rh_colaboradores").insert(inserir.slice(i, i + 200)).select("id");
      if (error) return jsonErr(500, `Erro ao inserir: ${error.message}`);
      criados += data?.length || 0;
    }
    for (const u of atualizar) {
      const { error } = await db.from("rh_colaboradores").update(u.patch).eq("id", u.id);
      if (!error) atualizados++;
    }
    return jsonOk({ ok: true, criados, atualizados, erros: analise.erros });
  } catch (e: any) {
    return jsonErr(500, `Falha na importação: ${e?.message || e}`);
  }
};

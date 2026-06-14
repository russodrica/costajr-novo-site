import type { APIRoute } from "astro";
import { requireAdminCookie, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";
import { enviarTelegram, escTg } from "../../../../lib/telegram";

export const prerender = false;

const CATEGORIAS_VALIDAS = ["telefonia", "informatica", "equipamento_obra", "epi", "veiculo", "mobiliario", "outros"];

// rótulos PT (do export) → enum
const CAT_POR_ROTULO: Record<string, string> = {
  telefonia: "telefonia", informatica: "informatica", "equip de obra": "equipamento_obra",
  equipamento_obra: "equipamento_obra", "equipamento de obra": "equipamento_obra",
  epi: "epi", veiculo: "veiculo", mobiliario: "mobiliario", outros: "outros",
};

const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// header normalizado → campo interno (null = coluna ignorada)
function mapHeader(h: string): string | null {
  const n = norm(h);
  const m: Record<string, string> = {
    "id": "id",
    "categoria": "categoria",
    "descricao": "descricao",
    "subcategoria": "subcategoria",
    "codigo interno": "codigo_interno",
    "no patrimonial": "numero_patrimonial", "n patrimonial": "numero_patrimonial", "numero patrimonial": "numero_patrimonial",
    "no de serie": "numero_serie", "numero de serie": "numero_serie", "no serie": "numero_serie", "n serie": "numero_serie",
    "marca": "marca", "modelo": "modelo", "fabricante": "fabricante",
    "valor aquisicao": "valor_aquisicao", "valor aquisicao r": "valor_aquisicao", "valor": "valor_aquisicao",
    "data aquisicao": "data_aquisicao",
    "fornecedor": "fornecedor",
    "no nota fiscal": "numero_nota_fiscal", "numero nota fiscal": "numero_nota_fiscal", "nota fiscal": "numero_nota_fiscal",
    "garantia ate": "garantia_fim",
    "campos especificos": "campos",
    "observacoes": "observacoes",
  };
  return m[n] || null; // status, com quem/onde etc → ignorados
}

// parser de CSV (BOM, delimitador ; ou , , aspas com delimitador/quebra embutidos)
function parseCsv(texto: string): string[][] {
  let t = texto.replace(/^﻿/, "");
  const delim = (t.split("\n")[0].match(/;/g)?.length || 0) >= (t.split("\n")[0].match(/,/g)?.length || 0) ? ";" : ",";
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], dentroAspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (dentroAspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else dentroAspas = false; }
      else campo += c;
    } else {
      if (c === '"') dentroAspas = true;
      else if (c === delim) { linha.push(campo); campo = ""; }
      else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
      else if (c === "\r") { /* ignora */ }
      else campo += c;
    }
  }
  if (campo.length || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function parseCampos(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const par of String(s || "").split(";")) {
    const i = par.indexOf("=");
    if (i > 0) { const k = norm(par.slice(0, i)).replace(/ /g, "_"); const v = par.slice(i + 1).trim(); if (k && v) out[k] = v; }
  }
  return out;
}

function dataValida(s: string): string | null {
  const v = String(s || "").trim();
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/) || v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const iso = v.includes("/") ? `${m[3]}-${m[2]}-${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`;
  return isNaN(new Date(iso).getTime()) ? null : iso;
}

// POST { csv, confirmar?: boolean } → analisa (dry-run) ou executa a importação em massa
export const POST: APIRoute = async ({ request }) => {
  let admin;
  try { admin = await requireAdminCookie(request); }
  catch { return jsonErr(401, "Não autenticado."); }

  try {
    const { csv, confirmar } = await request.json();
    if (!csv || typeof csv !== "string") return jsonErr(400, "Envie o conteúdo do arquivo CSV.");

    const rows = parseCsv(csv).filter((r) => !(r.length === 1 && r[0].trim() === "") && !String(r[0]).trim().startsWith("#"));
    if (rows.length < 2) return jsonErr(400, "Planilha sem dados (precisa de cabeçalho + ao menos 1 linha).");

    const headers = rows[0].map(mapHeader);
    if (!headers.includes("categoria") || !headers.includes("descricao")) {
      return jsonErr(400, "Cabeçalho inválido: são obrigatórias as colunas 'Categoria' e 'Descrição'. Baixe o modelo.");
    }
    const presentes = new Set(headers.filter(Boolean) as string[]); // colunas existentes na planilha

    const db = supabaseAdmin();
    // mapa de patrimônio → id (p/ casar linhas sem ID)
    const { data: existentes } = await db.from("ativos").select("id, numero_patrimonial");
    const idPorPatrimonio = new Map<string, string>();
    for (const a of existentes || []) if (a.numero_patrimonial) idPorPatrimonio.set(String(a.numero_patrimonial).trim().toLowerCase(), a.id);
    const idsValidos = new Set((existentes || []).map((a) => a.id));

    const analise = { criar: 0, atualizar: 0, erros: [] as { linha: number; motivo: string }[] };
    const paraInserir: any[] = [];
    const paraAtualizar: { id: string; patch: any }[] = [];

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (cells.every((c) => !String(c).trim())) continue; // linha vazia
      const obj: Record<string, string> = {};
      headers.forEach((campo, i) => { if (campo) obj[campo] = (cells[i] ?? "").trim(); });

      const categoria = CAT_POR_ROTULO[norm(obj.categoria)] || (CATEGORIAS_VALIDAS.includes(obj.categoria) ? obj.categoria : "");
      if (!categoria) { analise.erros.push({ linha: r + 1, motivo: `Categoria inválida: "${obj.categoria}"` }); continue; }
      if (!obj.descricao) { analise.erros.push({ linha: r + 1, motivo: "Descrição vazia" }); continue; }

      let valor: number | null = null;
      if (obj.valor_aquisicao) {
        valor = Number(String(obj.valor_aquisicao).replace(/\./g, "").replace(",", ".")) || Number(obj.valor_aquisicao);
        if (isNaN(valor as number)) { analise.erros.push({ linha: r + 1, motivo: `Valor inválido: "${obj.valor_aquisicao}"` }); continue; }
      }
      const dataAq = obj.data_aquisicao ? dataValida(obj.data_aquisicao) : null;
      if (obj.data_aquisicao && !dataAq) { analise.erros.push({ linha: r + 1, motivo: `Data de aquisição inválida: "${obj.data_aquisicao}"` }); continue; }
      const garantiaFim = obj.garantia_fim ? dataValida(obj.garantia_fim) : null;
      if (obj.garantia_fim && !garantiaFim) { analise.erros.push({ linha: r + 1, motivo: `Data de garantia inválida: "${obj.garantia_fim}"` }); continue; }

      // Monta apenas com as colunas PRESENTES na planilha (atualização parcial não
      // apaga campos ausentes). categoria/descricao são sempre obrigatórios.
      const campo: any = { categoria, descricao: obj.descricao };
      const setSe = (col: string, key: string, val: any) => { if (presentes.has(col)) campo[key] = val; };
      setSe("subcategoria", "subcategoria", obj.subcategoria || null);
      setSe("codigo_interno", "codigo_interno", obj.codigo_interno || null);
      setSe("numero_patrimonial", "numero_patrimonial", obj.numero_patrimonial || null);
      setSe("numero_serie", "numero_serie", obj.numero_serie || null);
      setSe("marca", "marca", obj.marca || null);
      setSe("modelo", "modelo", obj.modelo || null);
      setSe("fabricante", "fabricante", obj.fabricante || null);
      setSe("valor_aquisicao", "valor_aquisicao", valor);
      setSe("data_aquisicao", "data_aquisicao", dataAq);
      setSe("fornecedor", "fornecedor", obj.fornecedor || null);
      setSe("numero_nota_fiscal", "numero_nota_fiscal", obj.numero_nota_fiscal || null);
      if (presentes.has("garantia_fim")) { campo.garantia = !!garantiaFim; campo.garantia_fim = garantiaFim; }
      if (presentes.has("campos")) campo.campos = obj.campos ? parseCampos(obj.campos) : {};
      setSe("observacoes", "observacoes", obj.observacoes || null);

      // decide criar vs atualizar
      const patrim = obj.numero_patrimonial || "";
      let idAlvo = obj.id && idsValidos.has(obj.id) ? obj.id : null;
      if (!idAlvo && obj.id) { analise.erros.push({ linha: r + 1, motivo: `ID informado não existe: ${obj.id}` }); continue; }
      if (!idAlvo && patrim) {
        const achado = idPorPatrimonio.get(patrim.trim().toLowerCase());
        if (achado) idAlvo = achado;
      }

      if (idAlvo) { paraAtualizar.push({ id: idAlvo, patch: { ...campo, updated_at: new Date().toISOString() } }); analise.atualizar++; }
      else { paraInserir.push({ ...campo, status: "em_estoque", criado_por: admin.email }); analise.criar++; }
    }

    // dry-run: só devolve a análise
    if (!confirmar) {
      return jsonOk({ dry_run: true, ...analise, total_linhas: rows.length - 1 });
    }

    // execução
    let criados = 0, atualizados = 0;
    if (paraInserir.length) {
      for (let i = 0; i < paraInserir.length; i += 200) {
        const lote = paraInserir.slice(i, i + 200);
        const { data, error } = await db.from("ativos").insert(lote).select("id");
        if (error) return jsonErr(500, `Erro ao inserir: ${error.message}`);
        criados += data?.length || 0;
        if (data?.length) {
          await db.from("ativos_movimentos").insert(data.map((d) => ({
            ativo_id: d.id, tipo: "cadastro", descricao: "Ativo importado em massa", status_novo: "em_estoque", feito_por: admin.email,
          })));
        }
      }
    }
    for (const u of paraAtualizar) {
      const { error } = await db.from("ativos").update(u.patch).eq("id", u.id);
      if (!error) {
        atualizados++;
        await db.from("ativos_movimentos").insert({ ativo_id: u.id, tipo: "edicao", descricao: "Dados atualizados via importação em massa", feito_por: admin.email });
      }
    }

    if (criados > 0) {
      await registrarAcao(db, { req: request, admin }, {
        acao: "criar", entidade: "ativos", registro_id: null,
        descricao: `Importou ${criados} ativo(s) em massa`,
        dados: { criados, atualizados },
      });
    }

    if (criados > 0 || atualizados > 0) {
      enviarTelegram(`📥 <b>Importação de ativos</b>\n${criados} criado(s) · ${atualizados} atualizado(s)\nPor ${escTg(admin.email)}`).catch(() => { /* best-effort */ });
    }

    return jsonOk({ ok: true, criados, atualizados, erros: analise.erros });
  } catch (e: any) {
    return jsonErr(500, `Falha na importação: ${e?.message || e}`);
  }
};

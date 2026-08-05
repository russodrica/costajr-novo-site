import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase";
import { enviarTelegram } from "../../../lib/telegram";

export const prerender = false;

// ════════════════════════════════════════════════════════════════════════
// Ponte entre o bot Comercial do Telegram e a sessão do Claude que monta o
// orçamento (decisão da Adriana, 05/08/2026).
//
// POR QUE ESTE ENDPOINT EXISTE: uma função da Vercel NÃO consegue escrever
// na pasta do computador da Adriana (`_CLAUDE COMERCIAL` no OneDrive). Então
// o bot só REGISTRA o serviço aqui, e quem tem acesso à pasta (o Claude, pelo
// bridge do desktop) vem BUSCAR. É por isso que é o Claude que puxa, e não o
// bot que empurra.
//
// IMPORTANTE — nada de arquivo é guardado em nuvem nossa (regra da Adriana:
// "não é pra subir isso pra nenhuma nuvem"). O que fica salvo é só o
// `file_id` do Telegram; os bytes são baixados sob demanda aqui e vão direto
// pra pasta dela. O Supabase guarda apenas o registro do serviço (texto).
//
// Protegido pelo mesmo segredo das outras integrações (INTEGRA_TELEGRAM_SECRET).
//   GET  /api/integra/comercial-jobs              → lista os serviços pendentes
//   GET  /api/integra/comercial-jobs?id=X&arquivo=0 → baixa 1 arquivo (bytes)
//   POST /api/integra/comercial-jobs {id,status,mensagem} → fecha o serviço
// ════════════════════════════════════════════════════════════════════════

function env(n: string) { return (import.meta.env as any)[n] || (process.env as any)[n] || ""; }
const SECRET = env("INTEGRA_TELEGRAM_SECRET");
const TOKEN_COMERCIAL = env("TELEGRAM_BOT_TOKEN_COMERCIAL");
const PREFIXO = "jobcom:";

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function autorizado(request: Request, url: URL): boolean {
  if (!SECRET) return false;
  const chave = request.headers.get("x-integra-secret") || url.searchParams.get("key") || "";
  return chave === SECRET;
}

// Baixa o arquivo direto do Telegram (getFile → download). O token nunca sai
// do servidor.
async function baixarDoTelegram(fileId: string): Promise<{ buf: ArrayBuffer; nome: string } | null> {
  if (!TOKEN_COMERCIAL) return null;
  try {
    const f = await fetch(`https://api.telegram.org/bot${TOKEN_COMERCIAL}/getFile`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });
    const j: any = await f.json().catch(() => ({}));
    const path = j?.result?.file_path;
    if (!path) return null;
    const r = await fetch(`https://api.telegram.org/file/bot${TOKEN_COMERCIAL}/${path}`);
    if (!r.ok) return null;
    return { buf: await r.arrayBuffer(), nome: String(path).split("/").pop() || "arquivo" };
  } catch { return null; }
}

export const GET: APIRoute = async ({ request, url }) => {
  try {
    if (!SECRET) return json({ ok: false, error: "INTEGRA_TELEGRAM_SECRET não configurado" }, 503);
    if (!autorizado(request, url)) return json({ ok: false, error: "não autorizado" }, 401);
    const db = supabaseAdmin();

    const id = url.searchParams.get("id") || "";
    const idxArquivo = url.searchParams.get("arquivo");

    // ── baixar UM arquivo do serviço ──
    if (id && idxArquivo != null) {
      const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", PREFIXO + id).maybeSingle();
      const arquivos = data?.dados?.arquivos || [];
      const a = arquivos[Number(idxArquivo)];
      if (!a?.file_id) return json({ ok: false, error: "arquivo não encontrado neste serviço" }, 404);
      const baixado = await baixarDoTelegram(a.file_id);
      if (!baixado) return json({ ok: false, error: "não consegui baixar do Telegram (arquivo expirado?)" }, 502);
      return new Response(baixado.buf, {
        status: 200,
        headers: {
          "content-type": a.ct || "application/octet-stream",
          "content-disposition": `attachment; filename="${encodeURIComponent(a.nome || baixado.nome)}"`,
        },
      });
    }

    // ── listar serviços pendentes (sem os bytes) ──
    const { data } = await db.from("telegram_sessoes")
      .select("telegram_user_id, estado, dados, updated_at")
      .like("telegram_user_id", PREFIXO + "%")
      .order("updated_at", { ascending: true })
      .limit(50);
    const todos = data || [];
    const querTodos = url.searchParams.get("todos") === "1";
    const jobs = todos
      .filter((j: any) => querTodos || j.estado === "pendente")
      .map((j: any) => ({
        id: String(j.telegram_user_id).slice(PREFIXO.length),
        estado: j.estado,
        atualizado_em: j.updated_at,
        chat_id: j.dados?.chat_id ?? null,
        solicitante: j.dados?.solicitante ?? null,
        proposta: j.dados?.proposta ?? {},
        arquivos: (j.dados?.arquivos || []).map((a: any, i: number) => ({ indice: i, nome: a.nome, ct: a.ct, campo: a.campo })),
      }));
    return json({ ok: true, jobs });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
};

// Fecha o serviço e (opcionalmente) avisa no grupo de onde ele veio.
export const POST: APIRoute = async ({ request, url }) => {
  try {
    if (!SECRET) return json({ ok: false, error: "INTEGRA_TELEGRAM_SECRET não configurado" }, 503);
    if (!autorizado(request, url)) return json({ ok: false, error: "não autorizado" }, 401);
    const body: any = await request.json().catch(() => ({}));
    const id = String(body.id || "");
    if (!id) return json({ ok: false, error: "informe o id do serviço" }, 400);
    const status = body.status === "erro" ? "erro" : "concluido";
    const db = supabaseAdmin();
    const { data } = await db.from("telegram_sessoes").select("dados").eq("telegram_user_id", PREFIXO + id).maybeSingle();
    if (!data) return json({ ok: false, error: "serviço não encontrado" }, 404);

    await db.from("telegram_sessoes").update({
      estado: status,
      dados: { ...(data.dados || {}), fechado_em: new Date().toISOString(), mensagem: body.mensagem || null },
      updated_at: new Date().toISOString(),
    }).eq("telegram_user_id", PREFIXO + id);

    const chatId = data.dados?.chat_id;
    const msg = String(body.mensagem || "").slice(0, 3000);
    if (chatId && msg && TOKEN_COMERCIAL) {
      await fetch(`https://api.telegram.org/bot${TOKEN_COMERCIAL}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "HTML", disable_web_page_preview: true }),
      }).catch(() => {});
    } else if (msg) {
      await enviarTelegram(msg, { canal: "ADM" }).catch(() => {});
    }
    return json({ ok: true, id, estado: status });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
};

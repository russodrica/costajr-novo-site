// ============================================================================
// Camada de IA (LLM) compartilhada. Provedor escolhido automaticamente (nesta ordem):
//   1) GEMINI_API_KEY  -> Google Gemini Flash (grátis, AI Studio)
//   2) NVIDIA_API_KEY  -> gpt-oss-120b (grátis, formato OpenAI)
//   3) ANTHROPIC_API_KEY -> Claude Haiku (pago, barato)
//   4) nenhum -> null (quem chama decide o fallback). Nada quebra sem chave.
// Usada pela JunIA (juniaIA.ts) e pela Caixa de Entrada (organizar texto / ler documento).
// ============================================================================
import Anthropic from "@anthropic-ai/sdk";

const MODELO_GEMINI = "gemini-2.0-flash";
const MODELO_NVIDIA = "openai/gpt-oss-120b";
const MODELO_CLAUDE = "claude-haiku-4-5";

const envGemini = () => process.env.GEMINI_API_KEY ?? import.meta.env.GEMINI_API_KEY;
const envNvidia = () => process.env.NVIDIA_API_KEY ?? import.meta.env.NVIDIA_API_KEY;
const envClaude = () => process.env.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY;

export function llmConfigurado(): boolean {
  return !!(envGemini() || envNvidia() || envClaude());
}
export function geminiConfigurado(): boolean {
  return !!envGemini();
}

export type HistMsg = { role: "user" | "assistant"; content: string };

// ── Chamadas aos provedores (texto) ──────────────────────────────────────────
async function chamarGemini(key: string, system: string, mensagens: HistMsg[]): Promise<string | null> {
  const contents = mensagens.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 900, temperature: 0.4 },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("");
  return String(text || "").trim() || null;
}

async function chamarNvidia(key: string, system: string, mensagens: HistMsg[]): Promise<string | null> {
  const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO_NVIDIA,
      max_tokens: 1200,
      temperature: 0.4,
      messages: [{ role: "system", content: system }, ...mensagens],
    }),
  });
  if (!r.ok) throw new Error(`NVIDIA ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  const msg = j?.choices?.[0]?.message;
  return ((msg?.content || msg?.reasoning_content || "") as string).trim() || null;
}

async function chamarClaude(key: string, system: string, mensagens: HistMsg[]): Promise<string | null> {
  const client = new Anthropic({ apiKey: key });
  const resp = await client.messages.create({
    model: MODELO_CLAUDE,
    max_tokens: 800,
    system,
    messages: mensagens as any,
  });
  const bloco = resp.content.find((b: any) => b.type === "text") as any;
  return (bloco?.text || "").trim() || null;
}

// Gera texto via o primeiro provedor configurado. Retorna null se nenhum estiver setado.
export async function gerarTextoLLM(system: string, mensagens: HistMsg[]): Promise<string | null> {
  const gm = envGemini();
  if (gm) return chamarGemini(gm, system, mensagens);
  const nv = envNvidia();
  if (nv) return chamarNvidia(nv, system, mensagens);
  const an = envClaude();
  if (an) return chamarClaude(an, system, mensagens);
  return null;
}

// ── Leitura de DOCUMENTO (PDF/imagem) — só Gemini (inline_data). ──────────────
// Retorna o texto bruto do modelo (espera-se JSON). null se não houver chave Gemini
// ou se o arquivo não for PDF/imagem.
export async function lerDocumentoGemini(
  system: string,
  prompt: string,
  base64: string,
  mimeType: string,
): Promise<string | null> {
  const key = envGemini();
  if (!key) return null;
  const mt = (mimeType || "").toLowerCase();
  if (!(mt === "application/pdf" || mt.startsWith("image/"))) return null;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mt, data: base64 } }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.1 },
    }),
  });
  if (!r.ok) throw new Error(`Gemini(doc) ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("");
  return String(text || "").trim() || null;
}

// Extrai o primeiro objeto JSON de uma string (tolerante a ```json e texto em volta).
export function extrairJson(txt: string): any | null {
  let s = String(txt || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  try { return JSON.parse(s); } catch { return null; }
}

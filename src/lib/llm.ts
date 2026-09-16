// ============================================================================
// Camada de IA (LLM) compartilhada. Provedor escolhido automaticamente (nesta ordem):
//   1) GEMINI_API_KEY  -> Google Gemini Flash (grátis, AI Studio)
//   2) NVIDIA_API_KEY  -> gpt-oss-120b (grátis, formato OpenAI)
//   3) ANTHROPIC_API_KEY -> Claude Haiku (pago, barato)
//   4) nenhum -> null (quem chama decide o fallback). Nada quebra sem chave.
// Usada pela JunIA (juniaIA.ts) e pela Caixa de Entrada (organizar texto / ler documento).
// ============================================================================
import Anthropic from "@anthropic-ai/sdk";

const MODELO_GROQ = "openai/gpt-oss-120b";
const MODELO_NVIDIA = "openai/gpt-oss-120b";
const MODELO_CLAUDE = "claude-haiku-4-5";

const envGroq = () => process.env.GROQ_API_KEY ?? import.meta.env.GROQ_API_KEY;
const envGemini = () => process.env.GEMINI_API_KEY ?? import.meta.env.GEMINI_API_KEY;
const envNvidia = () => process.env.NVIDIA_API_KEY ?? import.meta.env.NVIDIA_API_KEY;
const envClaude = () => process.env.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY;

export function llmConfigurado(): boolean {
  return !!(envGroq() || envGemini() || envNvidia() || envClaude());
}
export function geminiConfigurado(): boolean {
  return !!envGemini();
}

export type HistMsg = { role: "user" | "assistant"; content: string };

// ── Chamadas aos provedores (texto) ──────────────────────────────────────────
// Cada MODELO do Gemini tem cota gratuita separada — tentamos vários antes de desistir.
const MODELOS_GEMINI = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-flash-latest", "gemini-1.5-flash"];

async function geminiUmModelo(key: string, modelo: string, system: string, mensagens: HistMsg[]): Promise<string | null> {
  const contents = mensagens.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 900, temperature: 0.4 },
    }),
  });
  if (!r.ok) throw new Error(`Gemini(${modelo}) ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j: any = await r.json();
  const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("");
  return String(text || "").trim() || null;
}

async function chamarGemini(key: string, system: string, mensagens: HistMsg[]): Promise<string | null> {
  let ultimoErro: any = null;
  for (const modelo of MODELOS_GEMINI) {
    try {
      const r = await geminiUmModelo(key, modelo, system, mensagens);
      if (r) return r;
    } catch (e) { ultimoErro = e; } // 429/erro nesse modelo -> tenta o próximo
  }
  if (ultimoErro) throw ultimoErro;
  return null;
}

async function chamarGroq(key: string, system: string, mensagens: HistMsg[]): Promise<string | null> {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO_GROQ,
      max_tokens: 1200,
      temperature: 0.4,
      messages: [{ role: "system", content: system }, ...mensagens],
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j: any = await r.json();
  const msg = j?.choices?.[0]?.message;
  return ((msg?.content || msg?.reasoning_content || "") as string).trim() || null;
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

// Gera texto tentando os provedores configurados EM ORDEM (Gemini -> NVIDIA -> Claude).
// Se um falhar (ex.: cota 429), tenta o próximo. Retorna null se nenhum estiver setado;
// lança o último erro se todos os configurados falharam (quem chama trata/faz fallback).
export async function gerarTextoLLM(system: string, mensagens: HistMsg[]): Promise<string | null> {
  const tentativas: Array<() => Promise<string | null>> = [];
  const gq = envGroq(); if (gq) tentativas.push(() => chamarGroq(gq, system, mensagens));
  const gm = envGemini(); if (gm) tentativas.push(() => chamarGemini(gm, system, mensagens));
  const nv = envNvidia(); if (nv) tentativas.push(() => chamarNvidia(nv, system, mensagens));
  const an = envClaude(); if (an) tentativas.push(() => chamarClaude(an, system, mensagens));
  if (!tentativas.length) return null;
  let ultimoErro: any = null;
  for (const t of tentativas) {
    try { const r = await t(); if (r) return r; }
    catch (e) { ultimoErro = e; } // falhou esse provedor -> tenta o próximo
  }
  if (ultimoErro) throw ultimoErro;
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

  // Tenta os mesmos modelos do texto (cada um tem cota gratuita separada) — todos leem PDF/imagem.
  let ultimoErro: any = null;
  for (const modelo of MODELOS_GEMINI) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mt, data: base64 } }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.1 },
        }),
      });
      if (!r.ok) throw new Error(`Gemini(doc/${modelo}) ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const j: any = await r.json();
      const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("");
      const out = String(text || "").trim();
      if (out) return out;
    } catch (e) { ultimoErro = e; } // 429/erro nesse modelo -> tenta o próximo
  }
  if (ultimoErro) throw ultimoErro;
  return null;
}

// ── Leitura de IMAGEM por outro provedor (plano B do Gemini) ─────────────────
// O Gemini é o único que lê PDF, mas a cota grátis dele é curta: numa sequência
// de leituras ele começa a devolver 429 e a leitura por imagem simplesmente
// parava. Estes modelos do Groq leem IMAGEM (não PDF).
// CONFERIDO na documentação do Groq (console.groq.com/docs/vision, 16/09/2026):
// são estes os multimodais ativos — os Llama 4 Scout/Maverick foram retirados.
// Limite de 20 MB por requisição com imagem.
const MODELOS_GROQ_VISAO = ["qwen/qwen3.6-27b", "qwen/qwen3.8-27b"];

async function groqVisaoUm(key: string, modelo: string, system: string, prompt: string, base64: string, mt: string, modoJson: boolean) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 900,
      temperature: 0.1,
      // modo JSON: documentado para estes multimodais e evita o modelo responder
      // em prosa (foi o que aconteceu na primeira tentativa em produção)
      ...(modoJson ? { response_format: { type: "json_object" } } : {}),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `${system}\n\n${prompt}` },
          { type: "image_url", image_url: { url: `data:${mt};base64,${base64}` } },
        ],
      }],
    }),
  });
  if (!r.ok) throw new Error(`GroqVisão(${modelo}${modoJson ? "/json" : ""}) ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j: any = await r.json();
  const msg = j?.choices?.[0]?.message;
  // os qwen têm modo "thinking": o JSON pode vir em reasoning_content
  return String(msg?.content || msg?.reasoning_content || "").trim() || null;
}

async function chamarGroqVisao(key: string, system: string, prompt: string, base64: string, mt: string): Promise<string | null> {
  let ultimoErro: any = null;
  for (const modelo of MODELOS_GROQ_VISAO) {
    for (const modoJson of [true, false]) { // se o modelo recusar o modo JSON, tenta sem
      try {
        const out = await groqVisaoUm(key, modelo, system, prompt, base64, mt, modoJson);
        if (out) return out;
      } catch (e) { ultimoErro = e; }
    }
  }
  if (ultimoErro) throw ultimoErro;
  return null;
}

/**
 * Lê um documento (PDF ou imagem) tentando os provedores EM ORDEM:
 * Gemini (PDF e imagem) -> Groq visão (só imagem). Devolve também o motivo do
 * erro, porque "não consegui ler" sem motivo é impossível de diagnosticar.
 */
export async function lerDocumentoLLM(
  system: string,
  prompt: string,
  base64: string,
  mimeType: string,
): Promise<{ texto: string | null; provedor: string; erro: string }> {
  const mt = (mimeType || "").toLowerCase();
  if (!(mt === "application/pdf" || mt.startsWith("image/"))) {
    return { texto: null, provedor: "", erro: "formato não suportado" };
  }
  let erro = "";
  const gm = envGemini();
  if (gm) {
    try {
      const r = await lerDocumentoGemini(system, prompt, base64, mimeType);
      if (r) return { texto: r, provedor: "Gemini", erro: "" };
    } catch (e: any) { erro = String(e?.message || e); }
  }
  const gq = envGroq();
  if (gq && mt.startsWith("image/")) {
    try {
      const r = await chamarGroqVisao(gq, system, prompt, base64, mt);
      if (r) return { texto: r, provedor: "Groq", erro: "" };
    } catch (e: any) { erro = String(e?.message || e); }
  }
  if (!erro) erro = gm || gq ? "os leitores não devolveram nada" : "nenhum leitor de imagem configurado";
  return { texto: null, provedor: "", erro };
}

/**
 * Extrai um objeto JSON de uma resposta de modelo.
 *
 * Tolerante a ```json, a texto em volta e — importante — a modelos com modo
 * "thinking", que escrevem raciocínio ANTES do JSON. A versão anterior pegava
 * do primeiro "{" ao último "}", o que quebrava quando havia chaves no meio do
 * raciocínio. Agora varremos os blocos balanceados (ignorando chaves dentro de
 * strings) e ficamos com o ÚLTIMO que der parse — que é a resposta final.
 */
export function extrairJson(txt: string): any | null {
  const s = String(txt || "").replace(/```(?:json)?/gi, " ");
  let melhor: any = null;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{") continue;
    let nivel = 0, dentro = false, esc = false;
    for (let k = i; k < s.length; k++) {
      const c = s[k];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { dentro = !dentro; continue; }
      if (dentro) continue;
      if (c === "{") nivel++;
      else if (c === "}") {
        nivel--;
        if (nivel === 0) {
          try {
            const o = JSON.parse(s.slice(i, k + 1));
            if (o && typeof o === "object" && !Array.isArray(o)) melhor = o;
          } catch { /* não era JSON válido — segue procurando */ }
          i = k; // não reexaminar o que já foi consumido
          break;
        }
      }
    }
  }
  return melhor;
}

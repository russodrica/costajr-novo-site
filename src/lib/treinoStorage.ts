// ============================================================================
// Treinamentos servidos de um bucket PRIVADO via URL assinada (só abre logado).
// Os arquivos foram movidos de `portal` (público) para `treinamentos` (privado),
// mantendo a MESMA chave. As tabelas ainda guardam a URL pública antiga em
// url_video / url — usamos isso só para DERIVAR a chave; a entrega é sempre
// uma URL assinada nova. Link externo (YouTube) passa direto.
// ============================================================================
import { signToken, verifyToken } from "./auth";

export const TREINO_BUCKET = "treinamentos";

// ── Token do player com marca d'água ────────────────────────────────────────
// Leva QUEM vai assistir (nome) — o player /treino/[token] estampa esse nome por
// cima do vídeo. Token assinado (JWT) com validade própria; se o link for
// encaminhado, abre com o nome da pessoa ORIGINAL (rastreável).
export type TreinoTokenData = { vtipo: "video" | "pdf"; id: string; nome: string };
export function assinarTreinoToken(d: TreinoTokenData, ttl = "12h"): Promise<string> {
  return signToken({ tipo: "treino", vtipo: d.vtipo, id: d.id, nome: (d.nome || "Colaborador").slice(0, 60) } as any, ttl);
}
export async function lerTreinoToken(token: string): Promise<TreinoTokenData | null> {
  try {
    const c: any = await verifyToken<any>(token);
    if (c?.tipo !== "treino" || !c?.id) return null;
    return { vtipo: c.vtipo === "pdf" ? "pdf" : "video", id: String(c.id), nome: String(c.nome || "Colaborador") };
  } catch {
    return null;
  }
}

// Nome de exibição do usuário logado (pra estampar no player). Best-effort.
export async function nomeDoUsuario(db: any, sub?: string | null, emailFallback?: string | null): Promise<string> {
  try {
    if (sub) {
      const { data } = await db.from("portal_profiles").select("display_name, full_name, email").eq("id", sub).maybeSingle();
      const n = data?.display_name || data?.full_name;
      if (n) return String(n);
      if (data?.email) return String(data.email).split("@")[0];
    }
  } catch { /* ignore */ }
  return emailFallback ? String(emailFallback).split("@")[0] : "Colaborador";
}

// Extrai a chave (caminho dentro do bucket) de uma URL pública do bucket `portal`.
export function keyDeUrlPortal(url?: string | null): string | null {
  if (!url) return null;
  const m = String(url).match(/\/object\/public\/portal\/(.+)$/);
  return m ? decodeURIComponent(m[1].split("?")[0]) : null;
}

// Devolve uma URL ASSINADA (privada, expira) quando o arquivo está no bucket
// privado; se for link externo (YouTube/Vimeo) ou não estiver lá, devolve a
// própria url como fallback (nunca quebra).
export async function urlAssinadaTreino(db: any, url?: string | null, secs = 21600): Promise<string | null> {
  if (!url) return null;
  const key = keyDeUrlPortal(url);
  if (!key) return url; // externo — não mexe
  try {
    const { data } = await db.storage.from(TREINO_BUCKET).createSignedUrl(key, secs);
    return data?.signedUrl || url;
  } catch {
    return url;
  }
}

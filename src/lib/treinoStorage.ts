// ============================================================================
// Treinamentos servidos de um bucket PRIVADO via URL assinada (só abre logado).
// Os arquivos foram movidos de `portal` (público) para `treinamentos` (privado),
// mantendo a MESMA chave. As tabelas ainda guardam a URL pública antiga em
// url_video / url — usamos isso só para DERIVAR a chave; a entrega é sempre
// uma URL assinada nova. Link externo (YouTube) passa direto.
// ============================================================================
export const TREINO_BUCKET = "treinamentos";

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

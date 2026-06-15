// ════════════════════════════════════════════════════════════════════════
// Mapa estático SEM chave de API (para embutir no PDF do relatório de ponto).
//  1º Yandex (mostra os marcadores e auto-enquadra)
//  2º Wikimedia (fallback — mapa centralizado, sem marcador)
// Retorna bytes de imagem (PNG) prontos p/ pdf-lib (embedPng), ou null se falhar.
// ════════════════════════════════════════════════════════════════════════

const UA = { "User-Agent": "CostaJrRH/1.0 (+rh@costajr.com.br)" };

export type Ponto = { lat: number; lng: number };

// remove (0,0)/inválidos e pontos repetidos (arredonda a ~11m)
export function pontosValidos(pontos: Ponto[]): Ponto[] {
  const seen = new Set<string>();
  const out: Ponto[] = [];
  for (const p of pontos) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.lat === 0 && p.lng === 0) continue;
    const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function urlYandex(ps: Ponto[]): string | null {
  if (!ps.length) return null;
  const pt = ps.slice(0, 30).map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)},pm2rdm`).join("~");
  return `https://static-maps.yandex.ru/1.x/?l=map&size=600,400&pt=${pt}`;
}

function urlWikimedia(ps: Ponto[]): string | null {
  if (!ps.length) return null;
  const lat = ps.reduce((s, p) => s + p.lat, 0) / ps.length;
  const lng = ps.reduce((s, p) => s + p.lng, 0) / ps.length;
  return `https://maps.wikimedia.org/img/osm-intl,13,${lat.toFixed(5)},${lng.toFixed(5)},600x400.png`;
}

export async function baixarMapa(pontos: Ponto[]): Promise<Uint8Array | null> {
  const ps = pontosValidos(pontos);
  if (!ps.length) return null;
  for (const u of [urlYandex(ps), urlWikimedia(ps)]) {
    if (!u) continue;
    try {
      const r = await fetch(u, { headers: UA });
      if (!r.ok) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length < 600) continue; // provavelmente imagem vazia/erro
      if (buf[0] === 0x89 && buf[1] === 0x50) return buf; // PNG
    } catch { /* tenta o próximo provedor */ }
  }
  return null;
}

// Link clicável para ver a localização no Google Maps (vai no PDF/CSV).
export function linkMapa(p: Ponto): string {
  return `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

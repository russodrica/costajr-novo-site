// Helpers para o tracking de visitas. Tudo síncrono e leve — roda em cada request.

const BOT_RX = /(bot|crawl|spider|slurp|bingpreview|duckduckbot|facebookexternalhit|whatsapp|telegrambot|vercel|axios|wget|curl|python-requests|node-fetch|monitor|uptime|headlesschrome|lighthouse|pingdom|gtmetrix)/i;

export function isBot(ua: string): boolean {
  return !ua || BOT_RX.test(ua);
}

export function parseUserAgent(ua: string): { device: string; os: string; browser: string } {
  const u = (ua || "").toLowerCase();

  let device = "desktop";
  if (/tablet|ipad/.test(u)) device = "tablet";
  else if (/mobi|iphone|android.*mobile/.test(u)) device = "mobile";

  let os = "outro";
  if (/windows nt/.test(u)) os = "Windows";
  else if (/mac os x|macintosh/.test(u)) os = "macOS";
  else if (/iphone|ipad|ipod/.test(u)) os = "iOS";
  else if (/android/.test(u)) os = "Android";
  else if (/linux/.test(u)) os = "Linux";

  let browser = "outro";
  if (/edg\//.test(u)) browser = "Edge";
  else if (/opr\/|opera/.test(u)) browser = "Opera";
  else if (/chrome\//.test(u) && !/edg\//.test(u)) browser = "Chrome";
  else if (/firefox\//.test(u)) browser = "Firefox";
  else if (/safari\//.test(u) && !/chrome\//.test(u)) browser = "Safari";

  return { device, os, browser };
}

const SEARCH_HOSTS = ["google.", "bing.", "duckduckgo.", "yahoo.", "yandex.", "baidu.", "ecosia.", "brave."];
const SOCIAL_HOSTS = ["facebook.", "instagram.", "linkedin.", "x.com", "twitter.", "t.co", "youtube.", "youtu.be", "tiktok.", "whatsapp.", "wa.me", "telegram.", "t.me", "pinterest.", "reddit."];

export function classifyReferrer(referrer: string, currentHost: string): { ref_host: string | null; ref_kind: string } {
  if (!referrer) return { ref_host: null, ref_kind: "direct" };
  let host = "";
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { ref_host: null, ref_kind: "direct" };
  }
  if (!host) return { ref_host: null, ref_kind: "direct" };
  const own = (currentHost || "").toLowerCase().replace(/^www\./, "");
  if (host === own) return { ref_host: host, ref_kind: "internal" };
  if (SEARCH_HOSTS.some((h) => host.includes(h))) return { ref_host: host, ref_kind: "search" };
  if (SOCIAL_HOSTS.some((h) => host.includes(h))) return { ref_host: host, ref_kind: "social" };
  return { ref_host: host, ref_kind: "referral" };
}

// Path tracking — só conta páginas, ignora estáticos, APIs e o próprio /admin.
const SKIP_PREFIXES = ["/api/", "/_", "/admin", "/portal-cliente", "/portal-tecnico", "/favicon", "/robots.txt", "/sitemap"];
const SKIP_EXTS = /\.(css|js|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|mp4|mp3|pdf|zip|txt|xml|json)$/i;

export function shouldTrack(pathname: string): boolean {
  if (!pathname) return false;
  if (SKIP_EXTS.test(pathname)) return false;
  return !SKIP_PREFIXES.some((p) => pathname.startsWith(p));
}

// Sessão: cookie cjr_sid, expira após 30min de inatividade, dura no máx. 24h.
const SESSION_COOKIE = "cjr_sid";
const SESSION_TTL_MS = 30 * 60 * 1000;     // 30 min
const SESSION_MAX_MS = 24 * 60 * 60 * 1000; // 24 h

export function readSessionCookie(cookieHeader: string): { sid: string; createdAt: number; lastSeen: number } | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)cjr_sid=([^;]+)/);
  if (!m) return null;
  try {
    const [sid, created, last] = decodeURIComponent(m[1]).split("|");
    const c = Number(created), l = Number(last);
    if (!sid || !c || !l) return null;
    return { sid, createdAt: c, lastSeen: l };
  } catch {
    return null;
  }
}

export function nextSession(existing: ReturnType<typeof readSessionCookie>): { sid: string; createdAt: number; lastSeen: number; isNew: boolean } {
  const now = Date.now();
  if (existing) {
    const idle = now - existing.lastSeen;
    const total = now - existing.createdAt;
    if (idle <= SESSION_TTL_MS && total <= SESSION_MAX_MS) {
      return { ...existing, lastSeen: now, isNew: false };
    }
  }
  // Gera novo SID: random + timestamp (sem libs externas)
  const sid = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return { sid, createdAt: now, lastSeen: now, isNew: true };
}

export function buildSessionCookie(s: { sid: string; createdAt: number; lastSeen: number }): string {
  const value = encodeURIComponent(`${s.sid}|${s.createdAt}|${s.lastSeen}`);
  // 24h max-age (a renovação acontece em cada visita dentro do TTL).
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=86400; SameSite=Lax`;
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    ""
  );
}

// Geo: Vercel injeta esses headers automaticamente.
export function getGeo(req: Request): { country: string | null; region: string | null; city: string | null } {
  return {
    country: req.headers.get("x-vercel-ip-country") || null,
    region: req.headers.get("x-vercel-ip-country-region") || null,
    city: decodeIfPercent(req.headers.get("x-vercel-ip-city")),
  };
}

function decodeIfPercent(v: string | null): string | null {
  if (!v) return null;
  try { return decodeURIComponent(v); } catch { return v; }
}

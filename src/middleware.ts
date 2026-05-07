import { defineMiddleware } from "astro:middleware";
import { supabaseAdmin } from "./lib/supabase";
import {
  isBot,
  parseUserAgent,
  classifyReferrer,
  shouldTrack,
  readSessionCookie,
  nextSession,
  buildSessionCookie,
  getGeo,
} from "./lib/analytics";

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();

  try {
    const req = context.request;
    if (req.method !== "GET") return response;

    const url = new URL(req.url);
    if (!shouldTrack(url.pathname)) return response;

    // Só registra páginas HTML reais (não navegações de prefetch / fetch JSON).
    const accept = req.headers.get("accept") || "";
    if (!accept.includes("text/html")) return response;

    const ua = req.headers.get("user-agent") || "";
    const bot = isBot(ua);

    // Sessão (mesmo bots ganham um sid pra dedupe básico, mas marcamos is_bot).
    const sessionState = nextSession(readSessionCookie(req.headers.get("cookie") || ""));
    response.headers.append("Set-Cookie", buildSessionCookie(sessionState));

    if (bot) return response;

    const { device, os, browser } = parseUserAgent(ua);
    const referrer = req.headers.get("referer") || "";
    const { ref_host, ref_kind } = classifyReferrer(referrer, url.host);
    const geo = getGeo(req);

    const payload = {
      path: url.pathname,
      session_id: sessionState.sid,
      referrer: referrer || null,
      ref_host,
      ref_kind,
      utm_source: url.searchParams.get("utm_source"),
      utm_medium: url.searchParams.get("utm_medium"),
      utm_campaign: url.searchParams.get("utm_campaign"),
      device,
      os,
      browser,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      is_bot: false,
    };

    // Fire-and-forget — não bloqueia a resposta.
    supabaseAdmin()
      .from("page_views")
      .insert(payload)
      .then(({ error }) => {
        if (error) console.error("[analytics] insert falhou:", error.message);
      });
  } catch (err) {
    console.error("[analytics] erro no middleware:", err);
  }

  return response;
});

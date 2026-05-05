import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente público (anon) — usado no front (browser)
export function supabasePublic(): SupabaseClient {
  return createClient(
    import.meta.env.PUBLIC_SUPABASE_URL!,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

// Cliente admin (service role) — só backend, NUNCA exposto no browser
let _adminClient: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient;
  _adminClient = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL!,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return _adminClient;
}

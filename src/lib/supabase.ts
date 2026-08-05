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

// Cliente admin do projeto "costajr2" — bridge de espaço, usado SÓ pelo bucket
// `doc-empresa` (o banco de dados continua todo no projeto principal, isso é
// só um segundo depósito de arquivo, criado quando o Storage do projeto
// principal passou do limite grátis de 1 GB). Ver .env: SUPABASE2_URL /
// SUPABASE2_SERVICE_ROLE_KEY. Quando a migração pro SharePoint estiver pronta,
// este cliente e o bucket duplicado somem.
let _adminClient2: SupabaseClient | null = null;
export function supabaseAdmin2(): SupabaseClient {
  if (_adminClient2) return _adminClient2;
  _adminClient2 = createClient(
    import.meta.env.SUPABASE2_URL!,
    import.meta.env.SUPABASE2_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return _adminClient2;
}

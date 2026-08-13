import { createClient } from "@supabase/supabase-js";

// Server-only client. Uses the service role key so it can bypass RLS —
// never import this file from client code or expose the key to the browser.
// Required env vars (set in .env locally and in Vercel Project Settings):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

let client: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null; // Supabase belum dikonfigurasi — fitur history-persist dilewati

  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return client;
}

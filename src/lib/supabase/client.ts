import { type SupabaseClient, createClient } from "@supabase/supabase-js";

// Browser Supabase client. Returns null until the project URL and anon key are set
// (in .env.local, or the Vercel project's environment variables).
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key);
  return client;
}

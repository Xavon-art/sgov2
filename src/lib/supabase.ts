import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** The publishable key is designed to ship in the browser. No secret belongs here. */
export const isSupabaseConfigured = Boolean(url && key);

export const supabase = isSupabaseConfigured
  ? createClient(url as string, key as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

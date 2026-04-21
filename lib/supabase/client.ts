import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let browserClient: SupabaseClient<Database> | undefined;

/**
 * Supabase client for Client Components (singleton in the browser).
 */
export function createClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  if (typeof window !== "undefined") {
    if (!browserClient) {
      browserClient = createSupabaseClient<Database>(url, anonKey);
    }
    return browserClient;
  }

  return createSupabaseClient<Database>(url, anonKey);
}

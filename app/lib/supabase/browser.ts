"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase browser client.
 *
 * createBrowserClient from @supabase/ssr:
 *  - Stores the session in a cookie (shared with the server/middleware).
 *  - The module is cached by the bundler, so this is effectively a singleton.
 *  - Do NOT call createBrowserClient inside a hook or render — keep it here at
 *    module level so one instance is shared across the whole app.
 */
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 👇 ADD THIS PART
if (typeof window !== "undefined") {
  (window as any).supabase = supabase;
}

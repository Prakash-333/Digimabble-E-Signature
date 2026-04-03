"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-project.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

// Note: createClient will succeed with placeholders, preventing build-time crashes.
// Actual requests will fail at runtime if the real values are missing.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

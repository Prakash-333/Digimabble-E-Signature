"use client";

type SupabaseLikeError = {
  code?: string | null;
  message?: string | null;
};

export function isMissingSupabaseTable(error: SupabaseLikeError | null | undefined, tableName: string) {
  if (!error) {
    return false;
  }

  return (
    error.code === "PGRST205" &&
    typeof error.message === "string" &&
    error.message.includes(`'public.${tableName}'`)
  );
}

export function getMissingTableMessage(tableName: string) {
  return `The connected Supabase project is missing the public.${tableName} table. Run supabase/schema.sql in the Supabase SQL Editor, then refresh this page.`;
}

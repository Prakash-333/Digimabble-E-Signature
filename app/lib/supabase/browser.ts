"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Check if we have valid credentials
const isConfigured =
  supabaseUrl &&
  supabaseUrl !== "https://placeholder-project.supabase.co" &&
  supabaseAnonKey &&
  supabaseAnonKey !== "placeholder-anon-key";

// ---------------------------------------------------------------------------
// Mock client (used when env vars are missing / placeholder)
// ---------------------------------------------------------------------------

const createConsistentHash = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++)
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(16).padStart(12, "0");
};

const getSimulatedUser = () => {
  if (typeof window === "undefined")
    return {
      id: "mock-user-id",
      email: "test@gmail.com",
      user_metadata: { full_name: "Mock User" },
    };

  const savedEmail = localStorage.getItem("mock_auth_email");
  if (savedEmail) {
    const id = `mock-0000-0000-0000-${createConsistentHash(savedEmail)}`;
    const full_name = savedEmail.split("@")[0] || "User";
    return { id, email: savedEmail, user_metadata: { full_name } };
  }

  return {
    id: "mock-user-id",
    email: "test@gmail.com",
    user_metadata: { full_name: "Mock User" },
  };
};

const createMockClient = () => {
  const mockAuth = {
    getSession: async () => {
      if (
        typeof window !== "undefined" &&
        !localStorage.getItem("mock_auth_email")
      )
        return { data: { session: null }, error: null };
      return {
        data: { session: { user: getSimulatedUser() } },
        error: null,
      };
    },
    getUser: async () => ({
      data: { user: getSimulatedUser() },
      error: null,
    }),
    signInWithPassword: async ({ email }: { email: string }) => {
      if (typeof window !== "undefined")
        localStorage.setItem("mock_auth_email", email.trim().toLowerCase());
      return {
        data: {
          user: getSimulatedUser(),
          session: { access_token: "mock-token", user: getSimulatedUser() },
        },
        error: null,
      };
    },
    signUp: async ({ email }: { email: string }) => {
      if (typeof window !== "undefined")
        localStorage.setItem("mock_auth_email", email.trim().toLowerCase());
      return { data: { user: getSimulatedUser() }, error: null };
    },
    signOut: async () => {
      if (typeof window !== "undefined")
        localStorage.removeItem("mock_auth_email");
      return { error: null };
    },
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
  };

  const mockQueryBuilder: any = {
    select: (..._args: any[]) => mockQueryBuilder,
    eq: (..._args: any[]) => mockQueryBuilder,
    or: (..._args: any[]) => mockQueryBuilder,
    order: (..._args: any[]) => mockQueryBuilder,
    limit: (..._args: any[]) => mockQueryBuilder,
    upsert: async (..._args: any[]) => ({ data: null, error: null }),
    insert: async (..._args: any[]) => ({ data: null, error: null }),
    update: async (..._args: any[]) => ({ data: null, error: null }),
    delete: async (..._args: any[]) => ({ data: null, error: null }),
    single: async (..._args: any[]) => ({ data: null, error: null }),
    maybeSingle: async (..._args: any[]) => ({ data: null, error: null }),
    then: (resolve: (val: { data: any[]; error: null }) => void) =>
      resolve({ data: [], error: null }),
  };

  return {
    auth: mockAuth,
    from: () => mockQueryBuilder,
    channel: (_name: string) => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
    }),
    removeChannel: async () => {},
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  } as unknown as any;
};

// ---------------------------------------------------------------------------
// Real Supabase client — SINGLETON pattern.
//
// KEY RULES:
//  1. createClientComponentClient() reads the session from the COOKIE that
//     middleware.ts writes on every request. Do NOT pass a custom storageKey —
//     that would redirect the client to read from localStorage under a
//     different key, which the middleware never writes to, causing the session
//     to appear missing on every normal (non-hard) refresh.
//  2. Keep a module-level singleton so the same client instance (and its
//     in-memory token cache) is reused across soft navigations in Next.js
//     App Router. Calling createClientComponentClient() on every render
//     creates a fresh, session-less client.
// ---------------------------------------------------------------------------
let _supabaseInstance: ReturnType<typeof createClientComponentClient> | null =
  null;

const getSupabaseClient = () => {
  if (!isConfigured) return createMockClient();

  // Server-side: always create a fresh instance (no window / singleton)
  if (typeof window === "undefined") {
    return createClientComponentClient({
      supabaseUrl: supabaseUrl!,
      supabaseKey: supabaseAnonKey!,
    });
  }

  // Client-side: reuse the same instance for the lifetime of the tab.
  // Do NOT pass a custom storageKey here — let it use the default cookie
  // storage that @supabase/auth-helpers-nextjs and the middleware both use.
  if (!_supabaseInstance) {
    _supabaseInstance = createClientComponentClient({
      supabaseUrl: supabaseUrl!,
      supabaseKey: supabaseAnonKey!,
    });
  }

  return _supabaseInstance;
};

export const supabase = getSupabaseClient();

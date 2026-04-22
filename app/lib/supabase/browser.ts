"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Check if we have valid credentials
const isConfigured = supabaseUrl && 
                   supabaseUrl !== "https://placeholder-project.supabase.co" && 
                   supabaseAnonKey && 
                   supabaseAnonKey !== "placeholder-anon-key";

// Helper to make deterministic pseudo-UUIDs from emails for the mock client
const createConsistentHash = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash << 5) - hash + str.charCodeAt(i) | 0;
  return Math.abs(hash).toString(16).padStart(12, '0');
};

const getSimulatedUser = () => {
  if (typeof window === "undefined") return { id: "mock-user-id", email: "test@gmail.com", user_metadata: { full_name: "Mock User" } };
  
  const savedEmail = localStorage.getItem("mock_auth_email");
  if (savedEmail) {
    const id = `mock-0000-0000-0000-${createConsistentHash(savedEmail)}`;
    const full_name = savedEmail.split("@")[0] || "User";
    return { id, email: savedEmail, user_metadata: { full_name } };
  }
  
  return { id: "mock-user-id", email: "test@gmail.com", user_metadata: { full_name: "Mock User" } };
};

// Create a mock client that returns empty/success results for common operations
const createMockClient = () => {
  const mockAuth = {
    getSession: async () => {
      if (typeof window !== "undefined" && !localStorage.getItem("mock_auth_email")) return { data: { session: null }, error: null };
      return { data: { session: { user: getSimulatedUser() } }, error: null };
    },
    getUser: async () => ({ 
      data: { user: getSimulatedUser() }, 
      error: null 
    }),
    signInWithPassword: async ({ email }: { email: string }) => {
      if (typeof window !== "undefined") localStorage.setItem("mock_auth_email", email.trim().toLowerCase());
      return { 
        data: { 
          user: getSimulatedUser(), 
          session: { access_token: "mock-token", user: getSimulatedUser() } 
        }, 
        error: null 
      };
    },
    signUp: async ({ email }: { email: string }) => {
      if (typeof window !== "undefined") localStorage.setItem("mock_auth_email", email.trim().toLowerCase());
      return { 
        data: { user: getSimulatedUser() }, 
        error: null 
      };
    },
    signOut: async () => {
      if (typeof window !== "undefined") localStorage.removeItem("mock_auth_email");
      return { error: null };
    },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  };

  const mockQueryBuilder = {
    select: <T = any>(...args: any[]) => mockQueryBuilder as any,
    eq: <T = any>(...args: any[]) => mockQueryBuilder as any,
    order: <T = any>(...args: any[]) => mockQueryBuilder as any,
    limit: <T = any>(...args: any[]) => mockQueryBuilder as any,
    upsert: async <T = any>(...args: any[]) => ({ data: null as any, error: null }),
    insert: async <T = any>(...args: any[]) => ({ data: null as any, error: null }),
    update: async <T = any>(...args: any[]) => ({ data: null as any, error: null }),
    delete: async <T = any>(...args: any[]) => ({ data: null as any, error: null }),
    single: async <T = any>(...args: any[]) => ({ data: null as any, error: null }),
    maybeSingle: async <T = any>(...args: any[]) => ({ data: null as any, error: null }),
    then: (resolve: (val: { data: any[]; error: any | null }) => void) => resolve({ data: [], error: null }),
  };

  return {
    auth: mockAuth,
    from: () => mockQueryBuilder,
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  } as unknown as any;
};

// Auth config — NOTE: do NOT use flowType:'pkce' here.
// PKCE requires a BroadcastChannel lock that deadlocks under Next.js HMR,
// causing "Loading session..." to hang for 2-5 minutes on every hot-reload.
const authConfig = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false, // No OAuth redirect flow; avoids extra URL parse on load
  storageKey: `sb-${supabaseUrl?.split("//")[1]?.split(".")[0]}-auth-token`,
};

// Version stamp — increment this whenever auth config changes to bust the window cache.
const CLIENT_VERSION = "v3-no-pkce";
const WINDOW_KEY = `_supabaseInstance_${CLIENT_VERSION}`;

// Singleton instance to prevent multiple client initializations
let supabaseInstance: any;

const getSupabaseClient = () => {
  // If we already have a module-level instance, return it
  if (supabaseInstance) return supabaseInstance;

  if (typeof window !== "undefined") {
    // Clear any stale PKCE lock entries from localStorage that cause getSession() to hang
    Object.keys(localStorage).forEach((key) => {
      if (key.includes("-lock-") || key.includes("pkce")) {
        localStorage.removeItem(key);
      }
    });

    // Use a versioned key so old cached clients (with PKCE) are ignored
    if ((window as any)[WINDOW_KEY]) {
      supabaseInstance = (window as any)[WINDOW_KEY];
      return supabaseInstance;
    }

    supabaseInstance = isConfigured
      ? createClient(supabaseUrl!, supabaseAnonKey!, { auth: authConfig })
      : createMockClient();

    // Cache with versioned key in development
    if (process.env.NODE_ENV === 'development') {
      (window as any)[WINDOW_KEY] = supabaseInstance;
    }

    return supabaseInstance;
  }

  // Fallback for SSR
  return isConfigured
    ? createClient(supabaseUrl!, supabaseAnonKey!, { auth: authConfig })
    : createMockClient();
};

export const supabase = getSupabaseClient();

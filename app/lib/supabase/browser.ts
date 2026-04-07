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
    select: () => mockQueryBuilder,
    eq: () => mockQueryBuilder,
    order: () => mockQueryBuilder,
    limit: () => mockQueryBuilder,
    upsert: async () => ({ data: null, error: null }),
    insert: async () => ({ data: null, error: null }),
    update: async () => ({ data: null, error: null }),
    delete: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (resolve: any) => resolve({ data: [], error: null }),
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
  } as any;
};

// Export either the real client or the mock
export const supabase = isConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createMockClient();


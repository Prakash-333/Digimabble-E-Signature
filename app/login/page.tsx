/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { type Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase/browser";

const isGmailAddress = (value: string) =>
  /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(value.trim());

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("test@gmail.com");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession()
      .then((res: any) => {
        const { data, error } = res;
        if (error) {
          console.error("Login session check error:", error);
          return;
        }
        if (mounted && data?.session) {
          router.replace("/dashboard");
        }
      })
      .catch((err: any) => {
        console.error("Unexpected error in login initial check:", err);
      });
    return () => { mounted = false; };
  }, [router]);

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isGmailAddress(email)) {
      setError("Please use a Gmail address ending in @gmail.com.");
      return;
    }

    setLoading(true);
    setError(null);

    const { data: loginData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // ── DEBUG: Remove once session is confirmed working ──────────────────
    console.log("🔐 [LOGIN] RESULT:", loginData);
    console.log("🔐 [LOGIN] SESSION:", loginData?.session ?? "NO SESSION");
    console.log("🔐 [LOGIN] USER:", loginData?.user ?? "NO USER");
    console.log("🔐 [LOGIN] ERROR:", signInError ?? "none");
    console.log("🔐 [LOGIN] Access Token:", loginData?.session?.access_token ? "present" : "MISSING");
    // ── END DEBUG ────────────────────────────────────────────────────────

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.replace("/dashboard");
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-violet-300/40 blur-3xl animate-pulse" />
        <div className="absolute -bottom-28 left-1/4 h-[460px] w-[460px] rounded-full bg-violet-200/40 blur-3xl" />
        <div className="absolute -right-32 top-10 h-[520px] w-[520px] rounded-full bg-violet-200/50 blur-3xl animate-pulse" />
      </div>

      <div className="relative w-full max-w-lg rounded-[2.5rem] bg-white/80 p-10 shadow-2xl shadow-violet-200/60 backdrop-blur-xl border border-white/40">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-extrabold tracking-wider text-violet-600 uppercase">
            SMARTDOCS
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-sm font-semibold text-white shadow-lg shadow-violet-200">
            S
          </div>
          <div>
            <p className="text-base font-bold tracking-tight text-slate-900 uppercase">
              SMARTDOCS
            </p>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Intelligent Agreement Management</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 rounded-2xl bg-slate-100/80 p-1.5 text-xs font-semibold">
          <Link
            href="/login"
            className="rounded-xl bg-white px-4 py-2.5 text-center text-violet-700 shadow-sm transition-all"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="rounded-xl px-4 py-2.5 text-center text-slate-500 hover:text-violet-600 transition-colors"
          >
            Create Account
          </Link>
        </div>

        <div className="mt-8 space-y-1.5 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Welcome back <span className="align-middle inline-block hover:animate-bounce cursor-default">👋</span>
          </h1>
          <p className="text-sm text-slate-500">
            Sign in to your SMARTDOCS account
          </p>
        </div>

        <form onSubmit={handleLogin} className="mt-8 space-y-5">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              pattern="^[a-zA-Z0-9._%+\-]+@gmail\.com$"
              title="Use a Gmail address ending in @gmail.com"
              className="w-full rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-50"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs px-1">
              <label className="font-bold uppercase tracking-wider text-slate-500">Password</label>
              <button
                type="button"
                className="font-semibold text-violet-600 hover:text-violet-700 transition-colors"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 pr-12 text-sm text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-50"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-2 inline-flex w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-violet-50 hover:text-violet-600 transition-all"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative mt-2 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-violet-600 p-[1px] transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            <div className="flex h-full w-full items-center justify-center gap-2 rounded-[inherit] bg-transparent px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-200/50">
              <span>{loading ? "Signing In..." : "Sign In"}</span>
              <span className="text-xl transition-transform group-hover:translate-x-1">→</span>
            </div>
          </button>
        </form>

        {error && (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
          <div className="h-px flex-1 bg-slate-200" />
          <span>or continue with</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3 text-sm">
          <button 
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="inline-flex w-full sm:flex-1 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-95 disabled:opacity-50"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-50 text-[12px] font-bold text-slate-900 border border-slate-200">
              G
            </span>
            <span className="font-semibold">{loading ? "Connecting..." : "Google"}</span>
          </button>
          <button className="inline-flex w-full sm:flex-1 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-95">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0A66C2] text-[12px] font-bold text-white">
              in
            </span>
            <span className="font-semibold">LinkedIn</span>
          </button>
        </div>

        <p className="mt-8 text-center text-sm text-slate-500 font-medium">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-bold text-violet-600 hover:text-violet-700 transition-colors underline decoration-violet-200 underline-offset-4 hover:decoration-violet-600"
          >
            Create your workspace
          </Link>
        </p>
      </div>
    </div>
  );
}

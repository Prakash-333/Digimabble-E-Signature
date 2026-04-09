"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { type Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase/browser";

const isGmailAddress = (value: string) =>
  /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(value.trim());

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (data.session) {
        router.replace("/dashboard");
      }
    });
  }, [router]);

  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isGmailAddress(email)) {
      setError("Please use a Gmail address ending in @gmail.com.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    if (signUpData.user) {
      await supabase.from("profiles").upsert({
        id: signUpData.user.id,
        full_name: fullName,
        company: null,
        timezone: "Asia/Kolkata (IST)",
      });
    }

    setLoading(false);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (!signInError) {
      router.replace("/dashboard");
      return;
    }

    setMessage("Account created.");
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-violet-300/40 blur-3xl animate-pulse" />
        <div className="absolute -bottom-28 left-1/4 h-[460px] w-[460px] rounded-full bg-violet-200/40 blur-3xl" />
        <div className="absolute -right-32 top-10 h-[520px] w-[520px] rounded-full bg-violet-200/50 blur-3xl animate-pulse" />
      </div>

      <div className="relative w-full max-w-lg rounded-[2.5rem] bg-white/80 p-10 shadow-2xl shadow-violet-200/60 backdrop-blur-xl border border-white/40">
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 text-sm font-semibold text-white shadow-lg shadow-violet-200">
              S
            </div>
            <div>
              <p className="text-base font-bold tracking-tight text-slate-900">
                SMARTDOCS CRM
              </p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Intelligent Agreement Management</p>
            </div>
          </div>
        </div>

        <div className="mb-8 space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Register
          </h1>
          <p className="text-sm text-slate-500">
            Join the SmartDocs platform for intelligent agreements.
          </p>
        </div>

        <form onSubmit={handleRegister} className="space-y-5">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">
              Full name
            </label>
            <input
              type="text"
              placeholder="Priya Sharma"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              className="w-full rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-50"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">
              Work email
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              pattern="^[a-zA-Z0-9._%+\-]+@gmail\.com$"
              title="Use a Gmail address ending in @gmail.com"
              className="w-full rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-50"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">
              Password
            </label>
            <input
              type="password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-50"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative mt-2 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-violet-600 p-[1px] transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            <div className="flex h-full w-full items-center justify-center gap-2 rounded-[inherit] bg-transparent px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-200/50">
              <span>{loading ? "Registering..." : "Register"}</span>
              <span className="text-xl transition-transform group-hover:translate-x-1">→</span>
            </div>
          </button>
        </form>

        {error && (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {message && (
          <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </p>
        )}

        <p className="mt-8 text-center text-sm text-slate-500 font-medium">
          Already have credentials?{" "}
          <Link
            href="/login"
            className="font-bold text-slate-700 transition-colors underline decoration-slate-200 underline-offset-4 hover:text-violet-600 hover:decoration-violet-600"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

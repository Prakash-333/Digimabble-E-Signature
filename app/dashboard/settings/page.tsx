"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/browser";

type Profile = {
  fullName: string;
  workEmail: string;
  company: string;
  timezone: string;
};

export default function SettingsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>({
    fullName: "Priya Sharma",
    workEmail: "priya@nimbuscrm.demo",
    company: "Nimbus Demo",
    timezone: "Asia/Kolkata (IST)",
  });
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user;
      if (!currentUser) return;
      setUserId(currentUser.id);

      const { data: row } = await supabase
        .from("profiles")
        .select("full_name, company, timezone")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (row) {
        setProfile((prev) => ({
          fullName: row.full_name ?? prev.fullName,
          workEmail: currentUser.email ?? prev.workEmail,
          company: row.company ?? prev.company,
          timezone: row.timezone ?? prev.timezone,
        }));
      } else {
        setProfile((prev) => ({
          ...prev,
          workEmail: currentUser.email ?? prev.workEmail,
        }));
      }
    };

    loadProfile();
  }, []);

  const saveProfile = async () => {
    if (!userId) {
      setBanner("Please sign in again to save your profile.");
      return;
    }

    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      full_name: profile.fullName,
      company: profile.company,
      timezone: profile.timezone,
    });

    if (error) {
      setBanner("Could not save to Supabase.");
      return;
    }

    setBanner("Saved to Supabase.");
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Settings
        </h1>
        <p className="mt-1 text-xs text-slate-500 md:text-sm">
          Configure your profile and workspace for
          this platform.
        </p>
      </div>

      {banner && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          {banner}
        </div>
      )}

      <div className="flex flex-col gap-6">
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Profile</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 text-xs">
              <label className="block font-medium text-slate-700">
                Full name
              </label>
              <input
                type="text"
                value={profile.fullName}
                onChange={(e) =>
                  setProfile((prev) => ({ ...prev, fullName: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-xs text-slate-900 outline-none ring-0 transition-all focus:border-violet-400 focus:ring-4 focus:ring-violet-50"
              />
            </div>
            <div className="space-y-1.5 text-xs">
              <label className="block font-medium text-slate-700">
                Work email
              </label>
              <input
                type="email"
                value={profile.workEmail}
                onChange={(e) =>
                  setProfile((prev) => ({ ...prev, workEmail: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-xs text-slate-900 outline-none ring-0 transition-all focus:border-violet-400 focus:ring-4 focus:ring-violet-50"
              />
            </div>
            <div className="space-y-1.5 text-xs">
              <label className="block font-medium text-slate-700">
                Company
              </label>
              <input
                type="text"
                value={profile.company}
                onChange={(e) =>
                  setProfile((prev) => ({ ...prev, company: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-xs text-slate-900 outline-none ring-0 transition-all focus:border-violet-400 focus:ring-4 focus:ring-violet-50"
              />
            </div>
            <div className="space-y-1.5 text-xs">
              <label className="block font-medium text-slate-700">
                Timezone
              </label>
              <select
                value={profile.timezone}
                onChange={(e) =>
                  setProfile((prev) => ({ ...prev, timezone: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 outline-none ring-0 transition-all focus:border-violet-400 focus:ring-4 focus:ring-violet-50"
              >
                <option>Asia/Kolkata (IST)</option>
                <option>UTC</option>
                <option>Europe/London</option>
                <option>America/New_York</option>
              </select>
            </div>
          </div>
          <button
            className="mt-2 inline-flex rounded-full bg-violet-600 px-6 py-2.5 text-xs font-semibold text-white shadow-md transition-all hover:bg-violet-700 active:scale-95"
            onClick={saveProfile}
            type="button"
          >
            Save changes
          </button>
        </section>

      </div>

    </div>
  );
}

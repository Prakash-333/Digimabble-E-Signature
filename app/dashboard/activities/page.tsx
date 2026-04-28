"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase/browser";
import { IS_SUPABASE_CONFIGURED } from "../../lib/env";
import { Loader2, AlertCircle } from "lucide-react";

type ActivityType = "Call" | "Email" | "Meeting" | "Document";

type Activity = {
  id: string;
  type: ActivityType;
  subject: string;
  relatedTo: string;
  dueDate: string;
  status: "Planned" | "Completed" | "Overdue";
};

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadActivities = async () => {
      if (!IS_SUPABASE_CONFIGURED) {
        setLoading(false);
        return;
      }

      try {
        interface DocumentRow {
          id: string;
          name: string;
          subject: string | null;
          sent_at: string | null;
          status: string | null;
        }

        const { data, error: supabaseError } = await supabase
          .from("documents")
          .select("id, name, subject, sent_at, status")
          .order("sent_at", { ascending: false })
          .limit(10);

        if (supabaseError) throw supabaseError;

        const mapped: Activity[] = (data as DocumentRow[] ?? []).map((doc) => ({
          id: doc.id,
          type: "Document",
          subject: doc.subject || doc.name,
          relatedTo: doc.name,
          dueDate: doc.sent_at ? new Date(doc.sent_at).toLocaleDateString() : "N/A",
          status: doc.status === "completed" ? "Completed" : "Planned",
        }));

        setActivities(mapped);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load activities";
        console.error("Failed to load activities:", err);
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadActivities();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
        <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
        <span className="ml-2 text-sm text-slate-500">Loading activities...</span>
      </div>
    );
  }

  if (!IS_SUPABASE_CONFIGURED) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm">
        <AlertCircle className="mx-auto h-8 w-8 text-amber-600" />
        <h3 className="mt-2 text-sm font-semibold text-amber-900">Supabase Not Configured</h3>
        <p className="mt-1 text-xs text-amber-700">
          Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Activities
          </h1>
          <p className="mt-1 text-xs text-slate-500 md:text-sm">
            Keep track of calls, emails, and meetings across your deals and
            contacts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button className="rounded-full border border-violet-200 bg-violet-50 px-3 py-2 font-medium text-violet-700 hover:bg-violet-100 hover:border-violet-300">
            Today
          </button>
          <button className="rounded-full border border-slate-200 bg-slate-100 px-3 py-2 font-medium text-slate-800 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700">
            This week
          </button>
          <button className="rounded-full border border-slate-200 bg-white px-3 py-2 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700 font-medium text-slate-600">
            Overdue
          </button>
          <button className="rounded-full bg-[color:var(--color-brand-primary)] px-4 py-2 font-medium text-white shadow-sm hover:bg-blue-700">
            + Add activity
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Subject</th>
              <th className="px-4 py-2 text-left font-medium">Related to</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity, index) => (
              <tr
                key={activity.id}
                className={index % 2 === 0 ? "bg-white" : "bg-slate-50/70"}
              >
                <td className="px-4 py-2 text-slate-800">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--color-brand-primary)]/10 text-[11px] font-semibold text-[color:var(--color-brand-primary)]">
                    {activity.type[0]}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-900">{activity.subject}</td>
                <td className="px-4 py-2 text-slate-700">
                  {activity.relatedTo}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={
                      "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium " +
                      (activity.status === "Completed"
                        ? "bg-emerald-50 text-emerald-800"
                        : activity.status === "Planned"
                          ? "bg-sky-50 text-sky-800"
                          : "bg-amber-50 text-amber-800")
                    }
                  >
                    {activity.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-slate-600">
                  {activity.dueDate}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

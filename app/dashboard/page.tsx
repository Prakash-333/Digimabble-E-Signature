"use client";

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase/browser";
import { isMissingSupabaseTable } from "../lib/supabase/errors";
import { getMatchingRecipient, isCompletedForRecipient, normalizeEmail, type SharedDocumentRecord } from "../lib/documents";
import { getHiddenNotificationIds, getSeenNotificationIds } from "../lib/notification-storage";
import { FileText, CheckCircle2, XCircle, Clock, ArrowUpRight } from "lucide-react";

type MyDocumentCountRow = {
  id: string;
  category: "personal" | "company";
};

type DocumentStatusRow = {
  id: string;
  status: "draft" | "waiting" | "reviewing" | "reviewed" | "approved" | "signed" | "completed" | "rejected";
  sent_at?: string | null;
  recipients?: { status?: string; email?: string; name?: string; role?: string }[];
};

type DateRange = "7" | "30" | "90" | "all";

type RecentDocument = {
  id: string;
  name: string;
  status: string;
  sent_at: string;
  recipients: { status?: string }[];
  direction: "sent" | "received";
};

const dateRangeOptions: { label: string; value: DateRange }[] = [
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
  { label: "All time", value: "all" },
];

function filterByDateRange(docs: DocumentStatusRow[], range: DateRange): DocumentStatusRow[] {
  if (range === "all") return docs;
  const days = Number(range);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return docs.filter((d) => {
    if (!d.sent_at) return false;
    return new Date(d.sent_at) >= cutoff;
  });
}

export default function DashboardPage() {
  const [personalCount, setPersonalCount] = useState(0);
  const [companyCount, setCompanyCount] = useState(0);
  const [userLabel, setUserLabel] = useState("User");
  const [notificationCount, setNotificationCount] = useState(0);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [allSentDocs, setAllSentDocs] = useState<DocumentStatusRow[]>([]);
  const [recentDocs, setRecentDocs] = useState<RecentDocument[]>([]);

  useEffect(() => {
    const loadCounts = async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return;

      setUserLabel(user.user_metadata?.full_name || user.email || "User");
      const userEmail = normalizeEmail(user.email);

      const [{ data: docs, error: docsError }, { data: sentDocs, error: sentDocsError }, { data: notificationRows, error: notificationError }, { data: recentRows, error: recentError }] = await Promise.all([
        supabase
          .from("my_documents")
          .select("id, category")
          .eq("owner_id", user.id),
        supabase
          .from("documents")
          .select("id, status, recipients, sent_at")
          .eq("owner_id", user.id),
        supabase
          .from("documents")
          .select("id, owner_id, recipients, status, category, sender, sent_at, file_url, file_key, content, name, subject")
          .or(`owner_id.eq.${user.id},recipients.cs.[{"email":"${userEmail}"}]`)
          .order("sent_at", { ascending: false })
          .limit(200),
        supabase
          .from("documents")
          .select("id, name, status, sent_at, recipients, owner_id")
          .eq("owner_id", user.id)
          .order("sent_at", { ascending: false })
          .limit(5),
      ]);

      if (docsError && !isMissingSupabaseTable(docsError, "my_documents")) {
        console.warn("Failed to load my_documents counts:", docsError);
      }

      if (sentDocsError && !isMissingSupabaseTable(sentDocsError, "documents")) {
        console.warn("Failed to load documents counts:", sentDocsError);
      }

      if (notificationError && !isMissingSupabaseTable(notificationError, "documents")) {
        console.warn("Failed to load notifications count:", notificationError);
      }

      if (recentError && !isMissingSupabaseTable(recentError, "documents")) {
        console.warn("Failed to load recent documents:", recentError);
      }

      const personalDocs = ((docs ?? []) as MyDocumentCountRow[]).filter((d) => d.category === "personal").length;
      const companyDocs = ((docs ?? []) as MyDocumentCountRow[]).filter((d) => d.category === "company").length;
      const sent = (sentDocs ?? []) as DocumentStatusRow[];

      setPersonalCount(personalDocs);
      setCompanyCount(companyDocs);
      setAllSentDocs(sent);

      const recent = (recentRows ?? []).map((row: DocumentStatusRow & { name?: string; owner_id: string }) => ({
        id: row.id,
        name: row.name || "Untitled Document",
        status: row.status,
        sent_at: row.sent_at || new Date().toISOString(),
        recipients: Array.isArray(row.recipients) ? row.recipients : [],
        direction: row.owner_id === user.id ? "sent" as const : "received" as const,
      }));
      setRecentDocs(recent);

      const hiddenIds = getHiddenNotificationIds(user.id);
      const seenIds = getSeenNotificationIds(user.id);
      
      let count = 0;
      if (userEmail) {
        ((notificationRows ?? []) as SharedDocumentRecord[]).forEach((row) => {
          if (row.owner_id !== user.id) {
            // Incoming Request
            if (hiddenIds.has(row.id) || seenIds.has(row.id)) return;
            const isRecipient = Boolean(getMatchingRecipient(row.recipients, userEmail));
            if (isRecipient && !isCompletedForRecipient(row.status)) {
              count++;
            }
          } else {
            // Outgoing Update (track completions)
            row.recipients.forEach((r) => {
              if (["signed", "reviewed", "approved", "rejected"].includes(r.status || "")) {
                const virtualId = `${row.id}_${normalizeEmail(r.email)}_${r.status}`;
                if (!hiddenIds.has(virtualId) && !seenIds.has(virtualId)) {
                  count++;
                }
              }
            });
          }
        });
      }
      setNotificationCount(count);
    };

    loadCounts();
  }, []);

  const { documentsSent, pendingCount, approvedCount, rejectedCount } = useMemo(() => {
    const filtered = filterByDateRange(allSentDocs, dateRange);
    return {
      documentsSent: filtered.length,
      pendingCount: filtered.filter((d) => d.status === "waiting" || d.status === "reviewing").length,
      approvedCount: filtered.filter((d) => d.status === "approved" || d.status === "reviewed" || d.status === "signed" || d.status === "completed").length,
      rejectedCount: filtered.filter((d) => {
        if (d.status === "rejected") return true;
        if (Array.isArray(d.recipients)) return d.recipients.some((r) => r.status === "rejected");
        return false;
      }).length,
    };
  }, [allSentDocs, dateRange]);

  const overview = [
    { label: "Documents Sent", value: documentsSent, href: "/dashboard/documents", color: "bg-blue-50 border-blue-200", icon: "bg-blue-100 text-blue-600", svg: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
    { label: "Signed", value: approvedCount, href: "/dashboard/documents?filter=approved", color: "bg-emerald-50 border-emerald-200", icon: "bg-emerald-100 text-emerald-600", svg: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
    { label: "Pending", value: pendingCount, href: "/dashboard/documents?filter=pending", color: "bg-amber-50 border-amber-200", icon: "bg-amber-100 text-amber-600", svg: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
    { label: "Changes Required", value: rejectedCount, href: "/dashboard/documents?filter=rejected", color: "bg-rose-50 border-rose-200", icon: "bg-rose-100 text-rose-600", svg: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
    { label: "Company Documents", value: companyCount, href: "/dashboard/my-documents?filter=company", color: "bg-violet-50 border-violet-200", icon: "bg-violet-100 text-violet-600", svg: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
    { label: "Personal Documents", value: personalCount, href: "/dashboard/my-documents?filter=personal", color: "bg-sky-50 border-sky-200", icon: "bg-sky-100 text-sky-600", svg: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
  ];

  return (
    <div className="px-4 pb-8 pt-6 md:px-10 md:pb-12 md:pt-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Welcome back, {userLabel}!</h1>
          <p className="mt-1 text-sm text-slate-500">
            Here&apos;s an overview of your recent documents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            id="date-range"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          >
            {dateRangeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
      {notificationCount > 0 && (
        <Link
          href="/dashboard/notifications"
          className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4 text-sm shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-100/70"
        >
          <div>
            <p className="font-bold text-violet-900">
              You have {notificationCount} new notification{notificationCount > 1 ? "s" : ""}.
            </p>
            <p className="text-violet-700">
              Check it here.
            </p>
          </div>
          <span className="rounded-full bg-white px-4 py-2 text-xs font-bold text-violet-700 shadow-sm">
            Open Notifications
          </span>
        </Link>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {overview.map((item) => (
          <Link
            key={item.label}
            href={item.href || "#"}
            className={`group rounded-xl border p-4 shadow-sm transition-all hover:shadow-md ${item.color}`}
          >
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.icon}`}>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.svg} />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-600">{item.label}</p>
                <p className="mt-0.5 text-2xl font-bold text-slate-900 tabular-nums">{item.value}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {/* Recent Documents Section */}
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-xs font-semibold tracking-[0.18em] text-slate-700">
            RECENT DOCUMENTS
          </h2>
          <Link href="/dashboard/documents" className="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors flex items-center gap-1">
            View All <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="divide-y divide-slate-200">
          {recentDocs.length === 0 ? (
            <p className="px-6 py-8 text-sm text-slate-400 text-center">No recent documents found.</p>
          ) : (
            recentDocs.map((doc) => {
              const recipientStatuses = doc.recipients.map((r) => r.status || "pending");
              const rejectedCount = recipientStatuses.filter((s) => s === "rejected").length;
              const completedCount = recipientStatuses.filter((s) => ["signed", "reviewed", "approved"].includes(s)).length;
              const totalCount = doc.recipients.length;

              let statusLabel = "Pending";
              let statusColor = "bg-blue-100 text-blue-700";
              let StatusIcon = Clock;

              if (doc.status === "rejected" || (rejectedCount > 0 && rejectedCount === totalCount)) {
                statusLabel = "Changes Required";
                statusColor = "bg-red-100 text-red-700";
                StatusIcon = XCircle;
              } else if (rejectedCount > 0) {
                statusLabel = `${rejectedCount} Changes Required`;
                statusColor = "bg-red-100 text-red-700";
                StatusIcon = XCircle;
              } else if (totalCount > 0 && completedCount === totalCount) {
                statusLabel = "Signed";
                statusColor = "bg-green-100 text-green-700";
                StatusIcon = CheckCircle2;
              } else if (doc.status === "signed" || doc.status === "completed") {
                statusLabel = "Signed";
                statusColor = "bg-green-100 text-green-700";
                StatusIcon = CheckCircle2;
              } else if (doc.status === "reviewed" || doc.status === "approved") {
                statusLabel = doc.status === "reviewed" ? "Reviewed" : "Approved";
                statusColor = "bg-green-100 text-green-700";
                StatusIcon = CheckCircle2;
              } else if (doc.status === "reviewing") {
                statusLabel = "Under Review";
                statusColor = "bg-yellow-100 text-yellow-700";
              }

              return (
                <Link
                  key={doc.id}
                  href="/dashboard/documents"
                  className="flex items-center justify-between px-6 py-3 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{doc.name}</p>
                      <p className="text-xs text-slate-400">
                        {doc.direction === "received" ? "Received" : "Sent"} • {new Date(doc.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold shrink-0 ${statusColor}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusLabel}
                  </span>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

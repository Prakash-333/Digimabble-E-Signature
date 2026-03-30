"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase/browser";
import { isMissingSupabaseTable } from "../lib/supabase/errors";
import { getMatchingRecipient, isCompletedForRecipient, normalizeEmail, type SharedDocumentRecord } from "../lib/documents";
import { getHiddenNotificationIds, getSeenNotificationIds } from "../lib/notification-storage";

type MyDocumentCountRow = {
  id: string;
  category: "personal" | "company";
};

type DocumentStatusRow = {
  id: string;
  status: "draft" | "waiting" | "reviewing" | "reviewed" | "approved" | "signed" | "completed" | "rejected";
};

export default function DashboardPage() {
  const [personalCount, setPersonalCount] = useState(0);
  const [companyCount, setCompanyCount] = useState(0);
  const [documentsSent, setDocumentsSent] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);
  const [userLabel, setUserLabel] = useState("User");
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    const loadCounts = async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return;

      setUserLabel(user.user_metadata?.full_name || user.email || "User");
      const userEmail = normalizeEmail(user.email);

      const [{ data: docs, error: docsError }, { data: sentDocs, error: sentDocsError }, { data: notificationRows, error: notificationError }] = await Promise.all([
        supabase
          .from("my_documents")
          .select("id, category")
          .eq("owner_id", user.id),
        supabase
          .from("documents")
          .select("id, status")
          .eq("owner_id", user.id),
        supabase
          .from("documents")
          .select("id, owner_id, recipients, status, category, sender, sent_at, file_url, file_key, content, name, subject")
          .order("sent_at", { ascending: false })
          .limit(200),
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

      const personalDocs = ((docs ?? []) as MyDocumentCountRow[]).filter((d) => d.category === "personal").length;
      const companyDocs = ((docs ?? []) as MyDocumentCountRow[]).filter((d) => d.category === "company").length;
      const sent = (sentDocs ?? []) as DocumentStatusRow[];

      setPersonalCount(personalDocs);
      setCompanyCount(companyDocs);
      setDocumentsSent(sent.length);
      setPendingCount(sent.filter((d) => d.status === "waiting" || d.status === "reviewing").length);
      setApprovedCount(sent.filter((d) => d.status === "approved" || d.status === "reviewed" || d.status === "signed" || d.status === "completed").length);
      const hiddenIds = getHiddenNotificationIds(user.id);
      const seenIds = getSeenNotificationIds(user.id);
      setNotificationCount(
        userEmail
          ? ((notificationRows ?? []) as SharedDocumentRecord[]).filter((row) => {
              if (row.owner_id === user.id) return false;
              if (hiddenIds.has(row.id) || seenIds.has(row.id)) return false;
              return Boolean(getMatchingRecipient(row.recipients, userEmail)) && !isCompletedForRecipient(row.status);
            }).length
          : 0
      );
    };

    loadCounts();
  }, []);

  const overview = [
    { label: "Documents sent", value: documentsSent, href: "/dashboard/documents" },
    { label: "Approved", value: approvedCount, href: "/dashboard/documents?filter=approved" },
    { label: "Pending", value: pendingCount, href: "/dashboard/documents?filter=pending" },
    { label: "Company documents", value: companyCount, href: "/dashboard/my-documents?filter=company" },
    { label: "Personal documents", value: personalCount, href: "/dashboard/my-documents?filter=personal" },
  ];

  return (
    <div className="px-4 pb-8 pt-6 md:px-10 md:pb-12 md:pt-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Welcome back, {userLabel}!</h1>
        <p className="mt-1 text-sm text-slate-500">
          Here&apos;s an overview of your recent documents.
        </p>
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]}">
        <aside className="h-fit space-y-6">
          {/* Overview Section */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="px-6 py-4">
              <h2 className="text-xs font-semibold tracking-[0.18em] text-slate-700">
                OVERVIEW
              </h2>
            </header>
            <div className="divide-y divide-slate-200 px-6 pb-4">
              {overview.map((item) => (
                <Link
                  key={item.label}
                  href={item.href || "#"}
                  className="flex items-center justify-between py-4 text-sm hover:bg-slate-50 group"
                >
                  <span className="text-slate-700 group-hover:text-violet-600 transition-colors">{item.label}</span>
                  <span className="font-semibold tabular-nums text-slate-900 group-hover:text-violet-600 transition-colors">
                    {item.value}
                  </span>
                </Link>
              ))}
            </div>
          </div>


        </aside>
      </div>
    </div>
  );
}

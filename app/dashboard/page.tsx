"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase/browser";

export default function DashboardPage() {
  const [personalCount, setPersonalCount] = useState(0);
  const [companyCount, setCompanyCount] = useState(0);
  const [documentsSent, setDocumentsSent] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);

  useEffect(() => {
    const loadCounts = async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return;

      const [{ data: docs }, { data: sentDocs }] = await Promise.all([
        supabase
          .from("my_documents")
          .select("id, category")
          .eq("owner_id", user.id),
        supabase
          .from("documents")
          .select("id, status")
          .eq("owner_id", user.id),
      ]);

      const personalDocs = (docs ?? []).filter((d: any) => d.category === "personal").length;
      const companyDocs = (docs ?? []).filter((d: any) => d.category === "company").length;
      const sent = sentDocs ?? [];

      setPersonalCount(personalDocs);
      setCompanyCount(companyDocs);
      setDocumentsSent(sent.length);
      setPendingCount(sent.filter((d: any) => d.status === "waiting" || d.status === "reviewing").length);
      setApprovedCount(sent.filter((d: any) => d.status === "approved" || d.status === "reviewed" || d.status === "signed" || d.status === "completed").length);
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
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Welcome back, Raj!</h1>
        <p className="mt-1 text-sm text-slate-500">
          Here's an overview of your recent documents.
        </p>
      </div>
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

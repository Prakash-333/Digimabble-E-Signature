/* eslint-disable @next/next/no-img-element */
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, FileText, PenLine as Pen } from "lucide-react";
import { supabase } from "../../lib/supabase/browser";

export default function PublicSignPage() {
  const { id } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [document, setDocument] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const loadDocument = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from("documents")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (fetchError) throw fetchError;
        if (!data) {
          setError("Document not found or access expired.");
        } else {
          setDocument(data);
        }
      } catch (err: any) {
        console.error("Load error:", err);
        setError("Failed to load document.");
      } finally {
        setLoading(false);
      }
    };

    loadDocument();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
        <p className="mt-4 text-sm font-medium text-slate-500">Loading document...</p>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
        <div className="h-16 w-16 rounded-full bg-red-50 flex items-center justify-center mb-6">
          <FileText className="h-8 w-8 text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Document Unavailable</h1>
        <p className="mt-2 text-slate-500 max-w-sm">{error || "This document could not be found."}</p>
        <button 
          onClick={() => router.push('/')}
          className="mt-8 rounded-full bg-violet-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-200"
        >
          Go to Homepage
        </button>
      </div>
    );
  }

  // If the document is already signed, show a success message
  if (document.status === "signed" || document.status === "reviewed") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
        <div className="h-20 w-20 rounded-full bg-green-50 flex items-center justify-center mb-6">
          <CheckCircle2 className="h-10 w-10 text-green-500" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Document Completed</h1>
        <p className="mt-2 text-slate-600 max-w-sm">This document has already been successfully reviewed and signed.</p>
        <p className="mt-1 text-sm text-slate-400">Thank you for using SMARTDOCS.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-[10px] font-bold text-white shadow-sm">
            S
          </div>
          <p className="text-sm font-bold tracking-tight text-slate-900 uppercase">SMARTDOCS</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-slate-900">{document.name}</p>
          <p className="text-[10px] text-slate-500">Public Signing ID: {id ? id.toString().slice(0, 8) : "..."}...</p>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-6">
        <div className="mx-auto h-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto bg-slate-100 p-8">
             <div className="mx-auto max-w-[800px] bg-white shadow-2xl p-12 min-h-[1000px]">
                {document.content ? (
                  <div className="prose prose-slate max-w-none" dangerouslySetInnerHTML={{ __html: document.content }} />
                ) : (
                  <div className="flex flex-col items-center justify-center py-40">
                    <FileText className="h-16 w-16 text-slate-200 mb-4" />
                    <p className="text-slate-500 font-medium">Please open this document in the main application to sign.</p>
                  </div>
                )}
             </div>
          </div>
          
          <div className="border-t border-slate-200 bg-white p-6 shadow-up">
            <div className="mx-auto max-w-2xl flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-900">Ready to sign?</p>
                <p className="text-xs text-slate-500">By clicking the button, you agree to the electronic signature terms.</p>
              </div>
              <button 
                onClick={() => {
                  // Forward to the dashboard signing page for the real experience
                  // Since they aren't logged in, they'll see the login page if we don't handle guest sessions.
                  // For now, redirect with a message.
                  router.push(`/dashboard/sign-document?documentId=${id}`);
                }}
                className="flex items-center gap-2 rounded-full bg-violet-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-violet-200 transition-all hover:scale-105 active:scale-95"
              >
                <Pen className="h-4 w-4" />
                Sign Document Now
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

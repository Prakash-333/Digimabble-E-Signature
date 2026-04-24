"use client";

import { Suspense, useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { Search, ChevronLeft, Loader2, List, LayoutGrid, Image as ImageIcon, FileImage, Plus, Trash2, X, PenTool, Type, CloudUpload, Eye, CheckCircle2, Building2, Globe, Edit3, Save, RotateCcw } from "lucide-react";
import { highlightHtmlEdits } from "../../lib/diff";
import { OFFER_LETTER_TEMPLATE, type Template } from "./data";
import { useUploadThing } from "../../lib/uploadthing-client";
import { supabase } from "../../lib/supabase/browser";
import {
  analyzeDocumentFile,
  extractPlaceholdersFromText,
  renderPdfPreviewPages,
  type PdfPreviewPage,
} from "../../lib/document-analysis";
import { normalizeEmail, normalizeRecipients, logDocumentEvent } from "../../lib/documents";
import { getScopedStorageItem, setScopedStorageItem } from "../../lib/user-storage";
import { getStoredSignature, setStoredSignature } from "../../lib/signature-storage";
import {
  DOCUMENT_STAGE_MIN_HEIGHT,
  DOCUMENT_STAGE_PADDING,
  DOCUMENT_STAGE_WIDTH,
  isStructuredDocumentHtml,
} from "../../lib/document-stage";

type TemplateId = string | number;

type AppTemplate = Omit<Template, "id"> & {
  id: TemplateId;
  fileDataUrl?: string;
  mimeType?: string;
  detectedText?: string;
  detectedPlaceholders?: string[];
  sourceFileName?: string;
};

type TemplateRow = {
  id: string;
  owner_id: string;
  name: string;
  category: string;
  color: string | null;
  preview: {
    headline?: string;
    sections?: Array<{ title: string; lines: string[] }>;
    fileUrl?: string;
    mimeType?: string;
    detectedPlaceholders?: string[];
    sourceFileName?: string;
  } | null;
  content: string | null;
  created_at: string;
  updated_at: string;
};

type Recipient = { name: string; email: string; role?: string; company?: string };

type RecipientContactRow = {
  id: string;
  owner_id: string;
  category: string;
  name: string;
  email: string;
};

type ReviewedDocumentRow = {
  id: string;
  name: string;
  category: string | null;
  file_url: string | null;
  content: string | null;
};

type ProfileRow = {
  full_name: string | null;
  company: string | null;
  timezone: string | null;
};

type SignatureRow = {
  data_url: string;
};

const getTemplatePlaceholders = (template: AppTemplate) => {
  if (template.detectedPlaceholders?.length) {
    return template.detectedPlaceholders;
  }

  if (template.detectedText) {
    return extractPlaceholdersFromText(template.detectedText);
  }

  if (template.name.includes("Employment Offer") || template.name.includes("Offer Letter")) {
    return Array.from(new Set((OFFER_LETTER_TEMPLATE.match(/\[([^\]]+)\]|\{([^}]+)\}|\(([^)]+)\)/g) || []).map((item) => item.replace(/[\[\](){}]/g, ""))));
  }

  return [];
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatTemplateUpdatedLabel = (value?: string) =>
  new Date(value ?? Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const mapTemplateRowToAppTemplate = (row: TemplateRow): AppTemplate => ({
  id: row.id,
  initial: row.name.charAt(0).toUpperCase(),
  name: row.name,
  category: (row.category as Template["category"]) || "Legal",
  updated: formatTemplateUpdatedLabel(row.updated_at),
  uses: "0 uses",
  color: row.color ?? "bg-violet-50 text-violet-600",
  preview: {
    headline: row.preview?.headline || row.name,
    sections: row.preview?.sections ?? [{ title: "Document", lines: ["Saved template"] }],
  },
  fileDataUrl: row.preview?.fileUrl,
  mimeType: row.preview?.mimeType,
  detectedText: row.content ?? undefined,
  detectedPlaceholders: row.preview?.detectedPlaceholders ?? undefined,
  sourceFileName: row.preview?.sourceFileName,
});

const persistSharedDocument = async (record: {
  id: string;
  name: string;
  subject: string;
  recipients: { name: string; email: string; role?: string }[];
  sender: { fullName: string; workEmail: string };
  sentAt: string;
  status: string;
  fileUrl?: string | null;
  fileKey?: string | null;
  category?: string | null;
  content?: string | null;
}) => {
  const { data } = await supabase.auth.getUser();
  const currentUser = data.user;
  if (!currentUser) {
    throw new Error("Please sign in again before sending this document.");
  }

  const senderEmail = normalizeEmail(currentUser.email);
  if (!senderEmail) {
    throw new Error("Your account is missing an email address.");
  }

  const recipients = normalizeRecipients(record.recipients);
  if (!recipients.length) {
    throw new Error("Please choose at least one valid recipient email.");
  }

  const { data: insertedRow, error } = await supabase
    .from("documents")
    .upsert({
      id: record.id,
      owner_id: currentUser.id,
      name: record.name,
      subject: record.subject,
      recipients,
      sender: {
        ...record.sender,
        workEmail: senderEmail,
      },
      sent_at: record.sentAt,
      status: record.status,
      file_url: record.fileUrl ?? null,
      file_key: record.fileKey ?? null,
      category: record.category ?? null,
      content: record.content ?? null,
      updated_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message || "Failed to save the shared document.");
  }

  return insertedRow;
};

function TemplatesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSearch = searchParams.get("search") || "";

  const [previewId, setPreviewId] = useState<TemplateId | null>(null);
  const [openMenuId, setOpenMenuId] = useState<TemplateId | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState(urlSearch);
  const [starred, setStarred] = useState<Set<TemplateId>>(new Set());
  const [useStep, setUseStep] = useState<"review" | "type_selection" | "recipients" | "internal_recipients" | "external_recipients" | "send" | null>(null);
  const [selectedForUse, setSelectedForUse] = useState<TemplateId | null>(null);
  const [appTemplates, setAppTemplates] = useState<AppTemplate[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null | undefined>(undefined);
  const [continuingDocumentId, setContinuingDocumentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedDocumentIdRef = useRef<string | null>(null);
  const pendingTemplateAnalysisRef = useRef<Array<{
    fileName: string;
    mimeType: string;
    dataUrl: string;
    textContent: string;
    placeholders: string[];
  }>>([]);

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        let user = (session?.user ?? undefined);
        
        if (!user) {
          const { data: authData, error: authError } = await supabase.auth.getUser();
          if (authError) {
            if (authError.message?.includes("stole it")) return;
            throw authError;
          }
          user = authData.user;
        }

        setCurrentUserId(user?.id ?? null);
      } catch (err) {
        console.error("Auth lock error in templates:", err);
      }
    };

    void loadCurrentUser();
  }, []);

  useEffect(() => {
    if (currentUserId === undefined) return;

    if (!currentUserId) return;

    const loadTemplates = async () => {
      const { data: rows, error } = await supabase
        .from("templates")
        .select("id, owner_id, name, category, color, preview, content, created_at, updated_at")
        .eq("owner_id", currentUserId)
        .order("updated_at", { ascending: false });

      if (error) {
        console.warn("Failed to load templates:", error);
        setAppTemplates([]);
        return;
      }

      const remoteTemplates = (rows ?? []).map((row: TemplateRow) => mapTemplateRowToAppTemplate(row));
      setAppTemplates(prev => {
        // Keep any 'review-' injected templates so they aren't overwritten
        const injected = prev.filter((t: AppTemplate) => String(t.id).startsWith("review-"));
        // Filter out remote templates that have the same name as injected ones to avoid duplicates
        const injectedNames = new Set(injected.map((t: AppTemplate) => t.name));
        const filteredRemote = remoteTemplates.filter((t: AppTemplate) => !injectedNames.has(t.name));
        return [...injected, ...filteredRemote];
      });
    };

    void loadTemplates();
  }, [currentUserId]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId !== null) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);

  const { startUpload, isUploading } = useUploadThing("templateUploader", {
    onClientUploadComplete: async (res) => {
      const analyses = pendingTemplateAnalysisRef.current;
      if (res && res.length > 0 && currentUserId) {
        const payload = res.map((file, index) => {
          const analysis = analyses[index];
          const baseName = file.name.replace(/\.[^/.]+$/, "");
          const placeholderCount = analysis?.placeholders?.length ?? 0;

          return {
            name: baseName,
            category: "Legal",
            color: "bg-violet-50 text-violet-600",
            owner_id: currentUserId,
            content: analysis?.textContent ?? null,
            preview: {
              headline: baseName,
              sections: [
                {
                  title: "Document",
                  lines: [
                    analysis?.textContent?.trim()
                      ? `${analysis.textContent.slice(0, 220)}${analysis.textContent.length > 220 ? "..." : ""}`
                      : "This document was uploaded into the system via UploadThing.",
                    placeholderCount > 0
                      ? `${placeholderCount} placeholder${placeholderCount === 1 ? "" : "s"} detected automatically.`
                      : "No placeholders were detected yet.",
                  ],
                },
              ],
              fileUrl: file.url,
              mimeType: analysis?.mimeType ?? file.type,
              detectedPlaceholders: analysis?.placeholders ?? [],
              sourceFileName: file.name,
            },
          };
        });

        const { data: insertedRows, error } = await supabase
          .from("templates")
          .insert(payload)
          .select("id, owner_id, name, category, color, preview, content, created_at, updated_at");

        if (error) {
          alert(`Template save failed: ${error.message}`);
        } else {
          const newTemplates = (insertedRows ?? []).map((row: TemplateRow) => mapTemplateRowToAppTemplate(row));
          setAppTemplates((prev) => [...newTemplates, ...prev]);
        }
      }

      pendingTemplateAnalysisRef.current = [];
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    onUploadError: (error) => {
      alert(`Upload failed: ${error.message}`);
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter(
        (file) =>
          file.type === "application/pdf" ||
          file.type.startsWith("image/") ||
          file.type === "application/msword" ||
          file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          file.type === "text/plain" ||
          file.type === "text/csv" ||
          file.name.toLowerCase().endsWith(".txt") ||
          file.name.toLowerCase().endsWith(".csv")
      );
      if (!files.length) {
        alert("Please add a PDF, Image, Word, Text, or CSV document.");
        e.target.value = "";
        return;
      }

      try {
        const analyses = await Promise.all(
          files.map(async (file) => {
            const result = await analyzeDocumentFile(file);
            return {
              fileName: file.name,
              mimeType: file.type,
              dataUrl: result.dataUrl,
              textContent: result.textContent,
              placeholders: result.placeholders,
            };
          })
        );
        pendingTemplateAnalysisRef.current = analyses;
      } catch (error) {
        console.error("Document analysis failed:", error);
        pendingTemplateAnalysisRef.current = [];
      }

      await startUpload(files);
      e.target.value = "";
    }
  };

  // Check for step parameters to open template flow at specific steps
  useEffect(() => {
    if (currentUserId === undefined) return;

    const stepParam = searchParams.get("step") as "recipients" | "type_selection" | null;
    const documentId = searchParams.get("documentId");
    
    if (!(stepParam === "recipients" || stepParam === "type_selection") || !documentId || !currentUserId) return;
    if (loadedDocumentIdRef.current === documentId) return;

    loadedDocumentIdRef.current = documentId;

    const loadReviewedDocument = async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, category, file_url, content")
        .eq("id", documentId)
        .eq("owner_id", currentUserId)
        .maybeSingle();

      const docData = data as ReviewedDocumentRow | null;

      if (error || !docData) {
        console.warn("Failed to load reviewed document:", error);
        return;
      }

      loadedDocumentIdRef.current = documentId;
      setContinuingDocumentId(documentId);

      const tempId = `review-${docData.id}`;
      
      setAppTemplates((prev) => {
        const nameExists = prev.find((t) => t.name === docData.name && !String(t.id).startsWith("review-"));
        
        if (nameExists) {
           // If a saved template with the same name exists, we'll merge and select IT instead of creating a new temporary one.
           setTimeout(() => {
              setSelectedForUse(nameExists.id);
              setUseStep(stepParam);
           }, 0);
          return prev.map((t) =>
            t.name === docData.name
              ? {
                  ...t,
                  detectedText: docData.content ?? t.detectedText,
                  fileDataUrl: docData.file_url ?? t.fileDataUrl,
                }
              : t
          );
        }

        if (!prev.some(t => t.id === tempId)) {
          const tempTemplate: AppTemplate = {
            id: tempId,
            initial: docData.name.charAt(0).toUpperCase(),
            name: docData.name,
            category: (docData.category as Template["category"]) || "Legal",
            updated: formatTemplateUpdatedLabel(),
            uses: "0 uses",
            color: "bg-violet-50 text-violet-600",
            fileDataUrl: docData.file_url ?? undefined,
            detectedText: docData.content ?? undefined,
            preview: {
              headline: docData.name,
              sections: [{ title: "Document", lines: ["Reviewed document ready to send"] }],
            },
          };
          
          setTimeout(() => {
            setSelectedForUse(tempId);
            setUseStep(stepParam);
          }, 0);
          
          return [tempTemplate, ...prev];
        }

        setTimeout(() => {
          setSelectedForUse(tempId);
          setUseStep(stepParam);
        }, 0);
        
        return prev;
      });
    };

    void loadReviewedDocument();
  }, [searchParams, currentUserId]);

  const filteredTemplates = useMemo(() => {
    let filtered = appTemplates;

    // Filter by category
    if (selectedCategory === "Starred") {
      filtered = filtered.filter(tpl => starred.has(tpl.id));
    } else if (selectedCategory !== "All") {
      filtered = filtered.filter(tpl => tpl.category === selectedCategory);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(tpl =>
        tpl.name.toLowerCase().includes(query) ||
        tpl.category.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [searchQuery, selectedCategory, appTemplates, starred]);

  const selectedForPreview = useMemo(
    () => appTemplates.find((tpl) => tpl.id === previewId) ?? null,
    [previewId, appTemplates]
  );

  const selectedTemplateForUse = useMemo(
    () => appTemplates.find((tpl) => tpl.id === selectedForUse) ?? null,
    [selectedForUse, appTemplates]
  );

  const getTemplateKind = (tpl: AppTemplate) => {
    if (tpl.mimeType?.startsWith("image/")) return "image";
    if (tpl.mimeType === "application/pdf" || tpl.sourceFileName?.toLowerCase().endsWith(".pdf")) return "pdf";
    if (
      tpl.mimeType === "application/msword" ||
      tpl.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      tpl.sourceFileName?.toLowerCase().endsWith(".doc") ||
      tpl.sourceFileName?.toLowerCase().endsWith(".docx")
    ) return "word";
    return "template";
  };

  const getTemplatePreview = (tpl: AppTemplate) => {
    if (tpl.fileDataUrl && tpl.mimeType?.startsWith("image/")) {
      return <img src={tpl.fileDataUrl} alt={tpl.name} className="h-full w-full object-cover" />;
    }

    return (
      <div className="flex h-full w-full flex-col bg-white p-5">
        <div className="space-y-1">
          <p className="line-clamp-6 text-[11px] leading-relaxed text-slate-600">
            {tpl.preview.sections[0]?.lines[0] || tpl.name}
          </p>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="px-2 pb-8 pt-0 md:px-4 md:pb-10 md:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        {/* Search Bar & Upload Row */}
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search templates by name or contact type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-10 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 shadow-sm"
          />
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        </div>

        <div className="relative">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="application/pdf,image/*,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv,.txt,.csv"
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="inline-flex items-center rounded-xl border border-violet-600 bg-white px-4 py-2.5 text-xs font-semibold text-violet-600 shadow-sm hover:bg-violet-600 hover:text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "+ Upload Template"
            )}
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">

        {/* Category Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          {["All", "Starred", "Legal", "Sales", "HR"].map((label) => (
            <button
              key={label}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${selectedCategory === label
                ? "bg-violet-600 text-white shadow-md active:scale-95"
                : "bg-white border border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-600 shadow-sm"
                }`}
              onClick={() => setSelectedCategory(label)}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto inline-flex items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-all ${viewMode === "list" ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-all ${viewMode === "grid" ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className={`mt-6 ${viewMode === "grid" ? "grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4" : "space-y-3"}`}>
        {filteredTemplates.length === 0 ? (
          <div className="col-span-full rounded-[2.5rem] border-2 border-dashed border-slate-100 bg-white px-6 py-20 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-violet-50 mb-6 transition-transform duration-300">
              <svg className="h-8 w-8 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">No documents yet</h3>
          </div>
        ) : (
          filteredTemplates.map((tpl) => (
            <article
              key={tpl.id}
              className={viewMode === "grid"
                ? "group relative flex flex-col justify-between overflow-visible rounded-[1.6rem] border border-slate-200 bg-[#eef2f7] shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
                : "flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              }
            >
              <div className={viewMode === "grid" ? "contents" : "flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"}>
                {viewMode === "grid" ? null : getTemplatePreview(tpl)}
              </div>
              <div className={viewMode === "grid" ? "px-1.5 pb-1.5 pt-2" : "min-w-0 flex-1"}>
                  <div className="flex items-start justify-between gap-1.5">
                  <div className="flex items-start gap-2 min-w-0">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${getTemplateKind(tpl) === "pdf" ? "bg-red-100 text-red-600" : getTemplateKind(tpl) === "image" ? "bg-emerald-100 text-emerald-600" : getTemplateKind(tpl) === "word" ? "bg-blue-100 text-blue-600" : tpl.color}`}
                    >
                      {getTemplateKind(tpl) === "image" ? <ImageIcon className="h-4 w-4" /> : getTemplateKind(tpl) === "pdf" ? "PDF" : getTemplateKind(tpl) === "word" ? "DOC" : <FileImage className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {tpl.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Updated {tpl.updated}
                      </p>
                    </div>
                  </div>
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 transition-all active:scale-95"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === tpl.id ? null : tpl.id);
                      }}
                      aria-label={`Menu for ${tpl.name}`}
                    >
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="6" r="1.5" />
                        <circle cx="12" cy="12" r="1.5" />
                        <circle cx="12" cy="18" r="1.5" />
                      </svg>
                    </button>
                    {openMenuId === tpl.id && (
                      <div className="absolute right-0 top-9 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-lg z-30 overflow-hidden">
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-2"
                          onClick={async () => {
                            const nextName = window.prompt("Rename template", tpl.name);
                            if (!nextName || !nextName.trim()) {
                              setOpenMenuId(null);
                              return;
                            }

                            if (typeof tpl.id === "string") {
                              const { error } = await supabase
                                .from("templates")
                                .update({ name: nextName.trim() })
                                .eq("id", tpl.id);

                              if (error) {
                                alert(`Rename failed: ${error.message}`);
                                setOpenMenuId(null);
                                return;
                              }
                            }

                            setAppTemplates((prev) => prev.map((item) => (
                              item.id === tpl.id
                                ? {
                                    ...item,
                                    name: nextName.trim(),
                                    updated: formatTemplateUpdatedLabel(),
                                  }
                                : item
                            )));
                            setOpenMenuId(null);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-2"
                          onClick={() => {
                            setStarred(prev => {
                              const newStarred = new Set(prev);
                              if (newStarred.has(tpl.id)) {
                                newStarred.delete(tpl.id);
                              } else {
                                newStarred.add(tpl.id);
                              }
                              return newStarred;
                            });
                            setOpenMenuId(null);
                          }}
                        >
                          {starred.has(tpl.id) ? "Remove Starred" : "Add to Starred"}
                        </button>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-2"
                          onClick={() => {
                            setPreviewId(tpl.id);
                            setOpenMenuId(null);
                          }}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-xs font-medium text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2"
                          onClick={async () => {
                            if (confirm(`Delete template "${tpl.name}"?`)) {
                              if (typeof tpl.id === "string") {
                                const { error } = await supabase.from("templates").delete().eq("id", tpl.id);
                                if (error) {
                                  alert(`Delete failed: ${error.message}`);
                                  setOpenMenuId(null);
                                  return;
                                }
                              }
                              setAppTemplates(prev => prev.filter(t => t.id !== tpl.id));
                            }
                            setOpenMenuId(null);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {viewMode === "grid" && (
                  <div className="mt-1.5 h-48 overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
                    {getTemplatePreview(tpl)}
                  </div>
                )}
              </div>
              <div className={viewMode === "grid" ? "border-t border-slate-200 bg-white/50 px-1.5 py-1.5" : "shrink-0"}>
                <div className={`flex items-center ${viewMode === "grid" ? "justify-end text-[11px] text-slate-500" : "gap-2"}`}>
                  <button
                    onClick={() => {
                      setSelectedForUse(tpl.id);
                      setUseStep("review");
                    }}
                    className="inline-flex min-w-[52px] shrink-0 items-center justify-center rounded-full border border-violet-600 bg-white px-3 py-1.5 text-[11px] font-semibold text-violet-600 shadow-sm hover:bg-violet-600 hover:text-white transition-all active:scale-95 group"
                  >
                    Use
                  </button>
                </div>
              </div>
            </article>

          ))
        )}
      </div>

      {/* Use Template Modal Flow */}
      {useStep && selectedTemplateForUse && (
        <TemplateFlowModal
          template={selectedTemplateForUse}
          step={useStep}
          setStep={setUseStep}
          router={router}
          currentUserId={currentUserId}
          onClose={() => {
            setUseStep(null);
            setSelectedForUse(null);
          }}
        />
      )}

      {/* Legacy Preview Modal */}
      {selectedForPreview && !useStep && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewId(null);
          }}
        >
          <div className="relative flex max-h-[60vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Close button - top right */}
            <button
              type="button"
              className="absolute -right-1 -top-1 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-slate-500 shadow-sm hover:bg-red-50 hover:text-red-500"
              onClick={() => setPreviewId(null)}
              aria-label="Close preview"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold ${selectedForPreview.color}`}
                >
                  {selectedForPreview.initial}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {selectedForPreview.name}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Last updated {selectedForPreview.updated} · {selectedForPreview.uses} uses
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedForUse(selectedForPreview.id);
                    setUseStep("review");
                    setPreviewId(null);
                  }}
                  className="inline-flex min-w-[108px] shrink-0 items-center justify-center rounded-full border border-violet-600 bg-white px-4 py-2 text-xs font-semibold text-violet-600 shadow-sm hover:bg-violet-600 hover:text-white transition-all active:scale-95 group"
                >
                  <span className="transition-colors group-hover:text-white">Use template</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-8">
                {selectedForPreview.fileDataUrl ? (
                  <div className="flex min-h-[50vh] items-center justify-center rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
                    {selectedForPreview.mimeType?.startsWith("image/") ? (
                      <img
                        src={selectedForPreview.fileDataUrl}
                        alt={selectedForPreview.name}
                        className="max-h-[70vh] w-auto max-w-full object-contain"
                      />
                    ) : getTemplateKind(selectedForPreview) === "word" ? (
                      <div className="w-full max-h-[70vh] overflow-y-auto">
                        <div className="mb-4 flex items-center gap-2">
                          <span className="inline-flex rounded-md bg-blue-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">
                            DOC
                          </span>
                        </div>
                        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
                          {selectedForPreview.detectedText || "No text content could be extracted from this Word document."}
                        </div>
                      </div>
                    ) : (
                      <iframe
                        src={selectedForPreview.fileDataUrl}
                        title={selectedForPreview.name}
                        className="h-[70vh] w-full rounded-[1rem] border border-slate-200 bg-white"
                      />
                    )}
                  </div>
                ) : (
                  <div className="text-[13px] text-slate-500 leading-relaxed">
                    {(() => {
                      const templateName = selectedForPreview.name;
                      let templateContent = "";

                      if (templateName.includes("Employment Offer") || templateName.includes("Offer Letter")) {
                        templateContent = OFFER_LETTER_TEMPLATE;
                      }

                      if (!templateContent) {
                        return (
                          <div className="space-y-4">
                            {selectedForPreview.preview.sections.map((section) => (
                              <div key={section.title}>
                                <p className="font-semibold text-slate-700">{section.title}</p>
                                <p className="text-slate-500 mt-1">{section.lines.join(", ")}</p>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      let filledContent = templateContent;
                      filledContent = filledContent.replace(/<strong>/g, '<span class="font-bold">').replace(/<\/strong>/g, '</span>');
                      return <div dangerouslySetInnerHTML={{ __html: filledContent.replace(/\n/g, "<br/>") }} />;
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading templates...</div>}>
      <TemplatesContent />
    </Suspense>
  );
}
const RECIPIENT_CATEGORIES = ["Companies", "Employees", "Investors", "Clients", "Reviewer"] as const;
const CATEGORY_STORAGE_KEY = "smartdocs.recipient-categories.v1";
const INTERNAL_COMPANY_NAME = "Digimabble";

const createEmptyRecipientGroups = (categories: readonly string[] = RECIPIENT_CATEGORIES): Record<string, Recipient[]> =>
  categories.reduce<Record<string, Recipient[]>>((acc, category) => {
    acc[category] = [];
    return acc;
  }, {});

// Generate template fields based on the template content
const generateTemplateFields = (templateContent: string) => {
  const regex = /\[([^\]]+)\]|\{([^}]+)\}|\(([^)]+)\)/g;
  const matches = Array.from(templateContent.matchAll(regex));
  const placeholders = Array.from(new Set(matches.map(m => m[1] || m[2] || m[3])));

  // Define the order of fields
  const fieldOrder = [
    "CANDIDATE_NAME",
    "DESIGNATION",
    "ANNUAL_COST",
    "COST_IN_WORDS",
    "JOINING_DATE",
    "WORK_LOCATION",
    "SENDER_NAME",
    "SENDER_DESIGNATION",
    "SENDER_COMPANY",
    "CURRENT_DATE"
  ];

  // Helper to check if a key is truly a date key
  const isDateKey = (key: string) =>
    key.endsWith("_DATE") ||
    key === "START_DATE" ||
    key === "CURRENT_DATE";

  // Sort placeholders based on the defined order
  const sortedPlaceholders = placeholders.sort((a, b) => {
    const indexA = fieldOrder.indexOf(a);
    const indexB = fieldOrder.indexOf(b);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  return sortedPlaceholders
    .filter(ph => ph !== "SIGNATURE") // Signature is handled separately
    .map(key => ({
      key,
      label: key.split("_").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" "),
      type: isDateKey(key) ? "date" : "text"
    }));
};

function TemplateFlowModal({ template, step, setStep, onClose, router, currentUserId }: {
  template: AppTemplate,
  step: "review" | "type_selection" | "recipients" | "internal_recipients" | "external_recipients" | "send",
  setStep: (s: "review" | "type_selection" | "recipients" | "internal_recipients" | "external_recipients" | "send" | null) => void,
  onClose: () => void,
  router: ReturnType<typeof useRouter>,
  currentUserId: string | null | undefined
}) {
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const todayISO = new Date().toISOString().split("T")[0];

  const hasUploadedDocument = Boolean(template.fileDataUrl);
  const isOfferLetterTemplate = template.name.toLowerCase().includes("employment offer") || 
                               template.name.toLowerCase().includes("offer letter");
  const templateContent = isOfferLetterTemplate
    ? OFFER_LETTER_TEMPLATE
    : (template.detectedText || "");
  const templateFields = templateContent ? generateTemplateFields(templateContent) : [];
  const resolvedTemplateBaseContent = hasUploadedDocument
    ? ""
    : isOfferLetterTemplate
      ? OFFER_LETTER_TEMPLATE
      : "Template Document Content";
  const detectedPlaceholders = useMemo(() => getTemplatePlaceholders(template), [template]);

  // Demo values for placeholders
  const DEMO_VALUES: Record<string, string> = {
    CURRENT_DATE: todayISO,
    CANDIDATE_NAME: "John Smith",
    DESIGNATION: "Senior Software Engineer",
    ANNUAL_COST: "1,200,000",
    COST_IN_WORDS: "Twelve Lakhs Only",
    JOINING_DATE: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    WORK_LOCATION: "Bangalore, India",
    SENDER_NAME: "Emily Davis",
    SENDER_DESIGNATION: "HR Director",
    SENDER_COMPANY: "Digimabble",
  };

  // Initialize form values with demo placeholders
  const getInitialFormValues = () => {
    const initial: Record<string, string> = {};
    const isDateKey = (key: string) => key.endsWith("_DATE") || key === "START_DATE";

    templateFields.forEach(field => {
      if (isDateKey(field.key)) {
        initial[field.key] = DEMO_VALUES[field.key] || todayISO;
      } else {
        initial[field.key] = DEMO_VALUES[field.key] || "";
      }
    });
    return initial;
  };

  // Form values for template fields
  const [formValues, setFormValues] = useState<Record<string, string>>(getInitialFormValues);
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [documentType, setDocumentType] = useState<"internal" | "external" | null>(null);

  // Signature Pad State
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [signatureMode, setSignatureMode] = useState<"draw" | "type" | "upload">("draw");
  const [typedSignature, setTypedSignature] = useState("");
  const [uploadedSignature, setUploadedSignature] = useState<string | null>(null);
  const [isSavingSignature, setIsSavingSignature] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);
  const [pdfPreviewPages, setPdfPreviewPages] = useState<PdfPreviewPage[]>([]);
  const [isLoadingPdfPreview, setIsLoadingPdfPreview] = useState(false);
  
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedTemplateContent, setEditedTemplateContent] = useState<string | null>(null);

  const handleResetTemplate = () => {
    if (!confirm("Are you sure you want to discard all manual refinements?")) return;
    setEditedTemplateContent(null);
    setIsEditMode(false);
  };
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const documentCanvasRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);

  // Drawing Handlers
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    if ("touches" in e) {
      if (e.touches.length === 0) return null;
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    isDrawingRef.current = true;
    const coords = getCoordinates(e);
    if (!coords || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000000";
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current) return;
    const coords = getCoordinates(e);
    if (!coords || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const handleMouseUp = () => {
    isDrawingRef.current = false;
  };

  const clearCanvas = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const handleSignatureImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setUploadedSignature(event.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const saveNewSignature = async () => {
    let signatureDataUrl = "";

    if (signatureMode === "draw") {
      if (!canvasRef.current) return;
      // Check if canvas is empty
      canvasRef.current.getContext("2d");
      const blank = document.createElement('canvas');
      blank.width = canvasRef.current.width;
      blank.height = canvasRef.current.height;
      if (canvasRef.current.toDataURL() === blank.toDataURL()) {
        alert("Please draw your signature first.");
        return;
      }
      signatureDataUrl = canvasRef.current.toDataURL();
    } else if (signatureMode === "type") {
      if (!typedSignature.trim()) return;
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 200;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = "italic 40px 'Dancing Script', cursive, serif";
        ctx.fillStyle = "black";
        ctx.textAlign = "center";
        ctx.fillText(typedSignature, 200, 110);
        signatureDataUrl = canvas.toDataURL();
      }
    } else if (signatureMode === "upload") {
      if (!uploadedSignature) return;
      signatureDataUrl = uploadedSignature;
    }

    if (!signatureDataUrl || !currentUserId) return;

    setIsSavingSignature(true);
    try {
      const { error } = await supabase.from("signatures").insert({
        owner_id: currentUserId,
        data_url: signatureDataUrl,
      });

      if (error) throw error;
      setSavedSignature(signatureDataUrl);
      setStoredSignature(currentUserId, signatureDataUrl);
      setShowSignaturePad(false);
      setTypedSignature("");
      setUploadedSignature(null);
    } catch (error) {
      console.error("Failed to save signature:", error);
      alert("Failed to save signature. Please try again.");
    } finally {
      setIsSavingSignature(false);
    }
  };
  const liveUploadedPreviewText = useMemo(() => {
    if (!template.detectedText) return "";

    let output = template.detectedText;
    detectedPlaceholders.forEach((placeholder) => {
      const value = placeholderValues[placeholder]?.trim();
      if (!value) return;

      const escaped = escapeRegExp(placeholder);
      const patterns = [
        new RegExp(`\\[\\s*${escaped}\\s*\\]`, "gi"),
        new RegExp(`\\{\\s*${escaped}\\s*\\}`, "gi"),
        new RegExp(`\\(\\s*${escaped}\\s*\\)`, "gi"),
      ];

      patterns.forEach((pattern) => {
        output = output.replace(pattern, value);
      });
    });

    return output;
  }, [detectedPlaceholders, placeholderValues, template.detectedText]);
  const uploadedPreviewIsStructured = Boolean(template.detectedText && isStructuredDocumentHtml(template.detectedText));
  const uploadedDocumentIsPdf = Boolean(
    hasUploadedDocument && (
      template.mimeType === "application/pdf" ||
      template.sourceFileName?.toLowerCase().endsWith(".pdf")
    )
  );
  const uploadedPreviewHtml = useMemo(() => {
    if (uploadedDocumentIsPdf && pdfPreviewPages.length > 0) {
      return `
        <div class="pdf-document" style="display:flex;flex-direction:column;gap:24px;align-items:center;width:100%;margin:0;padding:0;">
          ${pdfPreviewPages.map((page) => `
            <div class="pdf-page" style="position:relative;width:${DOCUMENT_STAGE_WIDTH}px;max-width:100%;margin:0;background:#fff;border:1px solid #e2e8f0;box-shadow:0 20px 40px rgba(15,23,42,0.08);overflow:hidden;">
              <img src="${page.imageDataUrl}" style="width:100%;height:auto;display:block;margin:0;" alt="Page ${page.pageNumber}" />
              ${page.overlays.map((overlay) => {
                const value = placeholderValues[overlay.placeholder]?.trim();
                if (!value) return "";

                const useProjectNameFallback =
                  overlay.placeholder.toUpperCase() === "PROJECT NAME" &&
                  (overlay.leftPercent < 20 || overlay.topPercent > 70);
                const leftPercent = useProjectNameFallback ? 41.5 : overlay.leftPercent;
                const topPercent = useProjectNameFallback ? 54.6 : overlay.topPercent;
                const widthPercent = useProjectNameFallback ? 15.5 : overlay.widthPercent;
                const heightPercent = useProjectNameFallback ? 4.4 : overlay.heightPercent;
                const scaledFontSize = Math.max(10, overlay.fontSizePx * (DOCUMENT_STAGE_WIDTH / page.width) * 0.92);
                return `
                  <div
                    data-placeholder="${escapeHtml(overlay.placeholder)}"
                    style="
                      position:absolute;
                      left:${leftPercent}%;
                      top:${topPercent}%;
                      width:${widthPercent}%;
                      min-height:${heightPercent}%;
                      padding:0 2px;
                      background:rgba(255,255,255,0.96);
                      color:#0f172a;
                      font-size:${scaledFontSize}px;
                      font-weight:600;
                      line-height:1.2;
                      border-radius:2px;
                      box-shadow:none;
                      display:flex;
                      align-items:center;
                      justify-content:center;
                      white-space:nowrap;
                      overflow:hidden;
                      text-overflow:ellipsis;
                    "
                  >${escapeHtml(value)}</div>
                `;
              }).join("")}
            </div>
          `).join("")}
        </div>
      `;
    }

    if (template.detectedText?.trim()) {
      const rawContent = liveUploadedPreviewText || template.detectedText;
      // If content already contains HTML tags, use it directly without escaping
      const isHtml = /<[a-z][\s\S]*>/i.test(rawContent);
      if (isHtml) {
        return rawContent;
      }
      return `<div>${escapeHtml(rawContent).replace(/\n/g, "<br/>")}</div>`;
    }

    if (detectedPlaceholders.length > 0) {
      return detectedPlaceholders
        .map((placeholder) => {
          const value = placeholderValues[placeholder]?.trim() || placeholder;
          return `
            <div style="margin-bottom:16px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:16px;background:#f8fafc;">
              <div style="font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;">${escapeHtml(placeholder)}</div>
              <div style="margin-top:6px;font-size:15px;font-weight:600;color:#0f172a;">${escapeHtml(value)}</div>
            </div>
          `;
        })
        .join("");
    }

    return `<div>${escapeHtml(template.name)}</div>`;
  }, [detectedPlaceholders, liveUploadedPreviewText, pdfPreviewPages, placeholderValues, template.detectedText, template.name, uploadedDocumentIsPdf]);

  useEffect(() => {
    if (!uploadedDocumentIsPdf || !template.fileDataUrl) {
      setPdfPreviewPages([]);
      setIsLoadingPdfPreview(false);
      return;
    }

    let cancelled = false;
    setIsLoadingPdfPreview(true);

    void renderPdfPreviewPages(template.fileDataUrl, detectedPlaceholders)
      .then((pages) => {
        if (cancelled) return;
        setPdfPreviewPages(pages);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to build live PDF preview:", error);
        setPdfPreviewPages([]);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingPdfPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detectedPlaceholders, template.fileDataUrl, uploadedDocumentIsPdf]);

  useEffect(() => {
    if (!detectedPlaceholders.length) return;
    setPlaceholderValues((prev) => {
      const next = { ...prev };
      detectedPlaceholders.forEach((placeholder) => {
        if (!(placeholder in next)) {
          next[placeholder] = "";
        }
      });
      return next;
    });
  }, [detectedPlaceholders]);

  // Step 2: recipients
  const [internalSelectedRecipients, setInternalSelectedRecipients] = useState<Recipient[]>([]);
  const [externalSelectedRecipients, setExternalSelectedRecipients] = useState<Recipient[]>([]);
  const [internalManualEmail, setInternalManualEmail] = useState("");
  const [externalManualEmail, setExternalManualEmail] = useState("");
  const [internalActiveCategory, setInternalActiveCategory] = useState<string>("Employees");
  const [externalActiveCategory, setExternalActiveCategory] = useState<string>("Companies");

  const [internalCategoryNames, setInternalCategoryNames] = useState<string[]>(["Employees", "Reviewer"]);
  const [externalCategoryNames, setExternalCategoryNames] = useState<string[]>(["Companies", "Investors", "Clients"]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientsByCategory, setRecipientsByCategory] = useState<Record<string, Recipient[]>>(createEmptyRecipientGroups());
  const [newRecipientName, setNewRecipientName] = useState("");
  const [newRecipientEmail, setNewRecipientEmail] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [showSendChoice, setShowSendChoice] = useState(false);
  const [sendActionType, setSendActionType] = useState<"review" | "sign" | null>(null);
  const [manualSignaturePos, setManualSignaturePos] = useState<{ x: number; y: number } | null>(null);
  const [manualSignatureScale, setManualSignatureScale] = useState(1);
  const [isPlacingSignature, setIsPlacingSignature] = useState(false);
  const [isDraggingSignature, setIsDraggingSignature] = useState(false);

  const getDocumentRelativePosition = (clientX: number, clientY: number) => {
    const stage = documentCanvasRef.current;
    if (!stage) return null;

    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    return {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    };
  };

  // Dynamic state selectors
  const selectedRecipients = documentType === "internal" ? internalSelectedRecipients : externalSelectedRecipients;
  const setSelectedRecipients = documentType === "internal" ? setInternalSelectedRecipients : setExternalSelectedRecipients;
  const manualEmail = documentType === "internal" ? internalManualEmail : externalManualEmail;
  const setManualEmail = documentType === "internal" ? setInternalManualEmail : setExternalManualEmail;
  const activeCategory = documentType === "internal" ? internalActiveCategory : externalActiveCategory;
  const setActiveCategory = documentType === "internal" ? setInternalActiveCategory : setExternalActiveCategory;
  const categoryNames = documentType === "internal" ? internalCategoryNames : externalCategoryNames;
  const setCategoryNames = documentType === "internal" ? setInternalCategoryNames : setExternalCategoryNames;

  // Categories for the sidebar
  const categories = categoryNames;

  const activeRecipients = activeCategory === "Manual" ? [] : (recipientsByCategory[activeCategory] ?? []);
  const filteredRecipients = activeRecipients.filter(
    (r) =>
      recipientSearch === "" ||
      r.name.toLowerCase().includes(recipientSearch.toLowerCase()) ||
      r.email.toLowerCase().includes(recipientSearch.toLowerCase())
  );

  // Auto-fill name from settings on mount
  useEffect(() => {
    if (!currentUserId) return;

    const loadProfileAndSignature = async () => {
      const [userDataResponse, profileResponse, signatureResponse] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("profiles")
          .select("full_name, company, timezone")
          .eq("id", currentUserId)
          .maybeSingle(),
        supabase
          .from("signatures")
          .select("data_url")
          .eq("owner_id", currentUserId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const profileRow = profileResponse.data as ProfileRow | null;
      const signatureRow = signatureResponse.data as SignatureRow | null;
      const userData = userDataResponse.data;

      setFormValues((prev) => ({
        ...prev,
        SENDER_NAME: profileRow?.full_name || prev.SENDER_NAME,
        SENDER_COMPANY: profileRow?.company || prev.SENDER_COMPANY,
        SENDER_EMAIL: userData.user?.email || prev.SENDER_EMAIL,
      }));

      const localSig = getStoredSignature(currentUserId);
      setSavedSignature(localSig || signatureRow?.data_url || null);
    };

    void loadProfileAndSignature();
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId || !documentType) return;

    const storageKey = `${CATEGORY_STORAGE_KEY}.${documentType}`;
    const storedCategoryNames = getScopedStorageItem(storageKey, currentUserId);
    if (!storedCategoryNames) return;

    try {
      const parsed = JSON.parse(storedCategoryNames);
      if (Array.isArray(parsed) && parsed.every((item: unknown) => typeof item === "string" && item.trim())) {
        const uniqueNames = Array.from(new Set(parsed.map((item: string) => item.trim())));
        setCategoryNames(uniqueNames);
      }
    } catch {
      // Ignore malformed stored categories.
    }
  }, [currentUserId, documentType, setCategoryNames]);

  useEffect(() => {
    if (!currentUserId || !documentType) return;
    const storageKey = `${CATEGORY_STORAGE_KEY}.${documentType}`;
    setScopedStorageItem(storageKey, currentUserId, JSON.stringify(categoryNames));
  }, [categoryNames, currentUserId, documentType]);

  useEffect(() => {
    if (activeCategory === "Manual") return;
    if (!categoryNames.includes(activeCategory)) {
      setActiveCategory(documentType === "internal" ? "Employees" : (categoryNames[0] ?? "Manual"));
    }
  }, [activeCategory, categoryNames, documentType, setActiveCategory]);

  useEffect(() => {
    if (!currentUserId) return;

    const loadRecipientContacts = async () => {
      const { data: rows, error } = await supabase
        .from("recipient_contacts")
        .select("id, owner_id, category, name, email")
        .eq("owner_id", currentUserId)
        .order("category", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        console.warn("Failed to load recipient contacts:", error);
        return;
      }

      const grouped = ((rows ?? []) as RecipientContactRow[]).reduce<Record<string, Recipient[]>>((acc, row) => {
        acc[row.category] = [...(acc[row.category] ?? []), { 
          name: row.name, 
          email: row.email,
          role: row.category === "Reviewer" ? "reviewer" : "signer",
          company: row.category
        }];
        return acc;
      }, createEmptyRecipientGroups(categoryNames));

      setRecipientsByCategory(grouped);
    };

    void loadRecipientContacts();
  }, [categoryNames, currentUserId]);

  useEffect(() => {
    setNewRecipientName("");
    setNewRecipientEmail("");
  }, [activeCategory]);

  const addRecipientToCategory = async () => {
    if (activeCategory === "Manual") return;

    const name = newRecipientName.trim();
    const email = newRecipientEmail.trim().toLowerCase();

    if (!name || !email) {
      return;
    }

    const existing = recipientsByCategory[activeCategory] ?? [];
    if (existing.some((recipient) => recipient.email.toLowerCase() === email)) {
      return;
    }

    if (currentUserId) {
      const { error } = await supabase.from("recipient_contacts").insert({
        owner_id: currentUserId,
        category: activeCategory,
        name,
        email,
      });

      if (error) {
        alert(`Could not save recipient: ${error.message}`);
        return;
      }
    }

    setRecipientsByCategory((prev) => ({
      ...prev,
      [activeCategory]: [...(prev[activeCategory] ?? []), { 
        name, 
        email, 
        role: activeCategory === "Reviewer" ? "reviewer" : "signer",
        company: documentType === "internal" ? INTERNAL_COMPANY_NAME : activeCategory
      }],
    }));

    setNewRecipientName("");
    setNewRecipientEmail("");
  };

  const addCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    if (name.toLowerCase() === "manual") return;
    if (categoryNames.some((category) => category.toLowerCase() === name.toLowerCase())) {
      return;
    }

    setCategoryNames((prev) => [...prev, name]);
    setRecipientsByCategory((prev) => ({
      ...prev,
      [name]: prev[name] ?? [],
    }));
    setActiveCategory(name);
    setNewCategoryName("");
    setRecipientSearch("");
  };

  const deleteCategory = async (category: string) => {
    const recipientsToRemove = recipientsByCategory[category] ?? [];

    if (currentUserId) {
      const { error } = await supabase
        .from("recipient_contacts")
        .delete()
        .eq("owner_id", currentUserId)
        .eq("category", category);

      if (error) {
        alert(`Could not delete contact type: ${error.message}`);
        return;
      }
    }

    setCategoryNames((prev) => prev.filter((item) => item !== category));
    setRecipientsByCategory((prev) => {
      const next = { ...prev };
      delete next[category];
      return next;
    });
    setSelectedRecipients((prev) =>
      prev.filter((recipient) => !recipientsToRemove.some((item) => item.email === recipient.email))
    );
    if (activeCategory === category) {
      const remaining = categoryNames.filter((item) => item !== category);
      setActiveCategory(remaining[0] ?? "Manual");
    }
  };

  const deleteRecipientFromCategory = async (category: string, recipient: Recipient) => {
    if (currentUserId) {
      const { error } = await supabase
        .from("recipient_contacts")
        .delete()
        .eq("owner_id", currentUserId)
        .eq("category", category)
        .eq("email", recipient.email);

      if (error) {
        alert(`Could not delete recipient: ${error.message}`);
        return;
      }
    }

    setRecipientsByCategory((prev) => ({
      ...prev,
      [category]: (prev[category] ?? []).filter((item) => item.email !== recipient.email),
    }));

    setSelectedRecipients((prev) => prev.filter((item) => item.email !== recipient.email));
  };

  const { startUpload: uploadDoc, isUploading: isUploadingDoc } = useUploadThing("signedDocUploader", {
    onUploadError: (error) => {
      setIsPersisting(false);
      setSendError(`Cloud upload failed: ${error.message}`);
      alert(`Cloud storage failed: ${error.message}`);
    }
  });

  const finalizeSend = async (fileUrl: string | null, fileKey: string | null, actionOverride?: "sign" | "review") => {
    // Generate filled HTML content for viewing
    const isDateKeyLocal = (key: string) => key.endsWith("_DATE") || key === "START_DATE";
    // Use uploadedPreviewHtml when we have an uploaded file OR when we have detectedText (HTML content doc forwarding)
    const hasTextContent = Boolean(template.detectedText);
    let filledHtmlContent = (hasUploadedDocument || hasTextContent) ? uploadedPreviewHtml : resolvedTemplateBaseContent;
    if (!hasUploadedDocument && !hasTextContent && resolvedTemplateBaseContent) {
      Object.entries(formValues).forEach(([key, val]) => {
        const displayVal = isDateKeyLocal(key) ? formatDate(val) : val;
        filledHtmlContent = filledHtmlContent.replace(new RegExp(`\\[${key}\\]`, 'g'), displayVal);
      });
      // Add signature if available
      if (savedSignature) {
        filledHtmlContent = filledHtmlContent.replace(
          /\[SIGNATURE\]/g,
          `<div style="margin-top: 15px;">
            <img src="${savedSignature}" alt="Signature" style="height: 80px; display: block; margin-bottom: -15px;" />
            <div style="font-weight: 800; color: #1e293b; text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; border-top: 2px solid #f1f5f9; display: inline-block; padding-top: 8px;">Signature</div>
          </div>`
        );
      } else {
        filledHtmlContent = filledHtmlContent.replace(
          /\[SIGNATURE\]/g,
          `<div style="margin-top: 15px;">
            <div style="height: 80px; margin-bottom: -15px;"></div>
            <div style="font-weight: 800; color: #1e293b; text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; border-top: 2px solid #f1f5f9; display: inline-block; padding-top: 8px;">Signature</div>
          </div>`
        );
      }
    }

    const finalRecipients = [...selectedRecipients];
    const actionType = actionOverride || sendActionType;
    const isReviewMode = actionType === "review";

    if (manualEmail.trim()) {
      const normalizedManual = normalizeEmail(manualEmail);
      const alreadyExists = finalRecipients.some(r => normalizeEmail(r.email) === normalizedManual);
      if (!alreadyExists) {
        finalRecipients.push({ 
          name: "External Contact", 
          email: manualEmail.trim(), 
          role: isReviewMode ? "reviewer" : "signer",
          company: "External"
        });
      }
    }
    const docCategory = isReviewMode ? "Reviewer" : (activeCategory === "Reviewer" ? null : activeCategory);

    const newDoc = {
      id: continuingDocumentId || `tmp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: template.name,
      subject: isReviewMode ? `Please review: ${template.name}` : `Please sign: ${template.name}`,
      recipients: finalRecipients.map((r) => ({ 
        ...r, 
        company: documentType === "internal" ? INTERNAL_COMPANY_NAME : (r.company || "External"),
        role: isReviewMode ? "reviewer" : "signer",
        status: "pending" 
      })),
      sender: { 
        fullName: formValues.SENDER_NAME || "User", 
        workEmail: formValues.SENDER_EMAIL || "user@example.com",
        isExternal: documentType === "external"
      },
      sentAt: new Date().toISOString(),
      status: isReviewMode ? "reviewing" : (fileUrl ? "waiting" : "pending"),
      fileUrl: fileUrl, // Store the cloud URL
      fileKey: fileKey, // Store the unique key for deletion
      category: docCategory, // Store the category for reviewer tracking
      content: editedTemplateContent ? highlightHtmlEdits(filledHtmlContent, editedTemplateContent) : filledHtmlContent, 
      manualSignaturePos: manualSignaturePos, // Pass manual placement coordinates
      manualSignatureScale: manualSignatureScale, // Pass manual scale
    };

    try {
      setSendError(null);
      const savedDoc = await persistSharedDocument(newDoc);
      
      // Trigger real emails to recipients ONLY for external documents
      if (savedDoc?.id && documentType === "external") {
        console.log("Triggering emails for document:", savedDoc.id);
        const emailPromises = finalRecipients.map(recipient => 
          fetch('/api/send-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              documentId: savedDoc.id,
              recipientEmail: recipient.email,
              recipientName: recipient.name,
              senderName: newDoc.sender.fullName,
              documentName: newDoc.name,
              subject: newDoc.subject
            })
          }).then(res => res.json())
        );

        // We run this in the background, but wait for all to complete if we want to show a consolidated status
        Promise.all(emailPromises)
          .then(results => console.log("Email dispatch results:", results))
          .catch(err => console.error("Email dispatch failed:", err));
      }

      setIsSent(true);

      // Log send event
      if (savedDoc?.id) {
        await logDocumentEvent(savedDoc.id, "document_sent", {
          recipients: finalRecipients.map(r => r.email),
          message: continuingDocumentId 
            ? `Document continued and sent to ${finalRecipients.length} recipients by ${newDoc.sender.fullName}`
            : `Initial document sent by ${newDoc.sender.fullName}`
        });
      }
    } catch (error) {
      console.error("Failed to save uploaded template document:", error);
      setSendError(error instanceof Error ? error.message : "Failed to save the document to Shared Documents.");
    } finally {
      setIsPersisting(false);
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return today;
    try {
      return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return iso; }
  };

  const handleSend = async (actionOverride?: "sign" | "review") => {
    if (actionOverride) {
      setSendActionType(actionOverride);
    }
    setSendError(null);
    setIsPersisting(true);

    if (hasUploadedDocument && template.fileDataUrl) {
      try {
        const response = await fetch(template.fileDataUrl);
        const blob = await response.blob();
        const baseName = template.sourceFileName || template.name;
        const mimeType = template.mimeType || blob.type || "application/octet-stream";
        const extension = mimeType === "application/pdf"
          ? "pdf"
          : mimeType.startsWith("image/")
            ? mimeType.split("/")[1] || "png"
            : (baseName.split(".").pop() || "bin");
        const file = new File([blob], `${baseName.replace(/\.[^/.]+$/, "")}.${extension}`, { type: mimeType });
        const res = await uploadDoc([file]);
        if (res && res[0]) {
          await finalizeSend(res[0].url, res[0].key, actionOverride);
        } else {
          throw new Error("Upload failed without throwing an error");
        }
        return;
      } catch (error) {
        console.error("Failed to reuse uploaded document:", error);
        setSendError("Could not prepare the uploaded document for sending.");
      }
    }

    // For HTML content documents (no file, just detectedText), skip canvas and send directly
    if (!hasUploadedDocument && template.detectedText) {
      await finalizeSend(null, null, actionOverride);
      return;
    }

    // Generate a simple snapshot of the document content
    let htmlContent = resolvedTemplateBaseContent || "Template Document Content";

    if (resolvedTemplateBaseContent) {
      Object.entries(formValues).forEach(([key, val]) => {
        const displayVal = key.endsWith("_DATE") || key === "START_DATE" ? formatDate(val) : val;
        htmlContent = htmlContent.replace(new RegExp(`\\[${key}\\]`, 'g'), displayVal);
      });
    }

    try {
      // Small delay to ensure state is settled
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 1000;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context failed");

      // Draw background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Simple rendering logic (since we can't easily draw HTML to canvas without external libs)
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 24px sans-serif";
      ctx.fillText(template.name, 40, 60);

      ctx.fillStyle = "#334155";
      ctx.font = "16px sans-serif";

      const textOnly = htmlContent.replace(/<[^>]*>?/gm, " ").trim();
      const words = textOnly.split(/\s+/);
      let line = "";
      let y = 120;
      for (const word of words) {
        if (ctx.measureText(line + " " + word).width < 700) {
          line += " " + word;
        } else {
          ctx.fillText(line, 40, y);
          y += 28;
          line = word;
        }
        if (y > 900) break;
      }
      ctx.fillText(line, 40, y);

      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
      const file = new File([blob], `${template.name.replace(/\s+/g, "_")}_filled.png`, { type: "image/png" });

      const res = await uploadDoc([file]);
      if (res && res[0]) {
        await finalizeSend(res[0].url, res[0].key, actionOverride);
      } else {
        throw new Error("Upload failed to return a file");
      }
      return;
    } catch (e) {
      console.error("Template snapshot failed", e);
      // Fallback: send without file url if snapshot fails
      await finalizeSend(null, null, actionOverride);
      return;
    }

    setIsPersisting(false);
  };

  const stepIndex = step === "review" ? 1 : step === "type_selection" ? 2 : (step === "recipients" || step === "internal_recipients" || step === "external_recipients") ? 3 : 4;
  const stepLabel = step === "review" ? "Review Document" 
    : step === "type_selection" ? "Document Type" 
    : step === "internal_recipients" ? "Internal Recipients" 
    : step === "external_recipients" ? "External Recipients" 
    : step === "recipients" ? "Select Recipients" 
    : "Confirm & Send";

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col h-screen w-screen overflow-hidden text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-8 py-4 bg-white shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => 
              step === "review" ? onClose() 
              : step === "type_selection" ? setStep("review") 
              : (step === "recipients" || step === "internal_recipients" || step === "external_recipients") ? setStep("type_selection") 
              : setStep(documentType === "internal" ? "internal_recipients" : "external_recipients")
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 transition-all group"
          >
            <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            <span className="text-sm font-semibold">Back</span>
          </button>
          <div className={`flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold ${template.color}`}>
            {template.initial}
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 leading-tight">{template.name}</h2>
            <p className="text-xs text-slate-500 font-medium tracking-tight">Step {stepIndex}/4: {stepLabel}</p>
          </div>
        </div>
        {/* Step progress dots */}
        <div className="flex items-center gap-2 mx-auto">
          {["review", "type_selection", "recipients", "send"].map((s, i) => (
            <div key={s} className={`rounded-full transition-all ${stepIndex > i + 1 ? "w-6 h-2 bg-violet-600" : stepIndex === i + 1 ? "w-8 h-2 bg-violet-600" : "w-2 h-2 bg-slate-200"}`} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          {step !== "send" && step !== "type_selection" && (
            <button
              onClick={() => {
                if ((step === "recipients" || step === "internal_recipients" || step === "external_recipients") && selectedRecipients.length === 0 && !manualEmail) {
                  alert("Please select at least one recipient");
                  return;
                }
                if (step === "review") {
                  setStep("type_selection");
                } else {
                  setStep("send");
                }
              }}
              disabled={(step === "recipients" || step === "internal_recipients" || step === "external_recipients") && selectedRecipients.length === 0 && !manualEmail}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-sm font-bold transition-all shadow-md ${(step === "recipients" || step === "internal_recipients" || step === "external_recipients") && selectedRecipients.length === 0 && !manualEmail ? "bg-violet-300 cursor-not-allowed" : "bg-violet-600 hover:bg-violet-700"}`}
            >
              Continue →
            </button>
          )}
          <button 
            onClick={onClose} 
            className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-all shadow-sm group"
            aria-label="Close"
          >
            <X className="w-5 h-5 transition-transform group-hover:scale-110" />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className={`flex-1 ${step === "review" || step === "send" ? "overflow-hidden" : "overflow-y-auto"} bg-slate-50`}>

        {/* ── STEP 1: Review ── */}
        {step === "review" && (
          <div className="flex h-[calc(100vh-73px)] overflow-hidden bg-slate-50">
            {/* Left Sidebar: Edit Fields */}
            <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0">
              <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0 bg-white/50 backdrop-blur-sm sticky top-0 z-10">
                <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">Edit details</h3>
                <p className="text-xs text-slate-500 font-medium mt-1">Update placeholders</p>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar pb-24 text-left">
                {/* My Signature Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                       <span className="w-4 h-px bg-slate-200" /> My Signature
                    </h4>
                    <button 
                      onClick={() => setShowSignaturePad(true)}
                      className="text-[10px] font-bold text-violet-600 hover:text-violet-700 transition-colors"
                    >
                      {savedSignature ? "Change Signature" : "Add Signature"}
                    </button>
                  </div>
                  
                  <div className="relative group">
                    {savedSignature ? (
                      <div className="space-y-3">
                        <div className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm group-hover:border-violet-200 transition-all flex items-center justify-center min-h-[100px]">
                          <img src={savedSignature} alt="My Signature" className="max-h-20 w-auto object-contain" />
                        </div>
                        <button
                          onClick={() => {
                            if (manualSignaturePos) {
                              setManualSignaturePos(null);
                              setIsPlacingSignature(false);
                            } else {
                              setIsPlacingSignature(!isPlacingSignature);
                            }
                          }}
                          className={`w-full py-3 rounded-xl border-2 font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                            manualSignaturePos 
                              ? "border-red-100 bg-red-50 text-red-600 hover:bg-red-100" 
                              : isPlacingSignature 
                                ? "border-violet-200 bg-violet-50 text-violet-600 shadow-inner" 
                                : "border-slate-100 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-200"
                          }`}
                        >
                          {manualSignaturePos ? (
                            <>
                              <Trash2 className="w-3.5 h-3.5" /> Remove from Document
                            </>
                          ) : (
                            <>
                              <PenTool className="w-3.5 h-3.5" />
                              {isPlacingSignature ? "Click on document..." : "Place on document"}
                            </>
                          )}
                        </button>

                        {/* Resize Slider */}
                        {manualSignaturePos && (
                          <div className="pt-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                             <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Signature Size</span>
                                <span className="text-[10px] font-black text-violet-600 bg-violet-50 px-2 py-0.5 rounded-md">{Math.round(manualSignatureScale * 100)}%</span>
                             </div>
                             <input 
                               type="range"
                               min="0.5"
                               max="2.0"
                               step="0.1"
                               value={manualSignatureScale}
                               onChange={(e) => setManualSignatureScale(parseFloat(e.target.value))}
                               className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-violet-600"
                             />
                             <p className="text-[9px] text-slate-400 font-medium leading-relaxed italic text-center">Tip: Drag the signature on the document to reposition it.</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <button 
                        onClick={() => setShowSignaturePad(true)}
                        className="w-full flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed border-slate-100 bg-slate-50/50 hover:bg-white hover:border-violet-200 transition-all gap-3"
                      >
                        <div className="w-10 h-10 rounded-full bg-violet-50 flex items-center justify-center text-violet-600 shadow-sm ring-4 ring-violet-50/50">
                          <Plus className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sign Now</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                     <span className="w-4 h-px bg-slate-200" /> Edit placeholders
                  </h4>
                {hasUploadedDocument ? (
                  <div className="space-y-6">
                    {detectedPlaceholders.length > 0 ? (
                      detectedPlaceholders.map((placeholder, index) => (
                        <div key={`${placeholder}-${index}`} className="space-y-1.5 group">
                          <label className="text-[10px] font-black text-slate-600 uppercase tracking-wider group-focus-within:text-violet-500 transition-colors">
                            {placeholder}
                          </label>
                          <input
                            value={placeholderValues[placeholder] || ""}
                            onChange={(e) => setPlaceholderValues((prev) => ({ ...prev, [placeholder]: e.target.value }))}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-50 transition-all bg-slate-50/50 focus:bg-white placeholder:text-slate-300"
                            placeholder={`Edit ${placeholder.toLowerCase()}...`}
                          />
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                        We could not detect placeholders from this file yet.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {templateFields
                      .filter((f) => f.key !== "SIGNATURE" && f.key !== "CURRENT_DATE" && f.key !== "MANAGER_NAME_DESIGNATION" && f.key !== "OFFER_EXPIRY_DATE" && f.key !== "TEAM_NAME")
                      .map((field) => (
                        <div key={field.key} className="space-y-1.5 group">
                          <label className="text-[10px] font-black text-slate-600 uppercase tracking-wider group-focus-within:text-violet-500 transition-colors">{field.label}</label>
                          <input
                            type={field.type}
                            value={formValues[field.key] || ""}
                            onChange={e => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-semibold outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-50 transition-all bg-slate-50/50 focus:bg-white placeholder:text-slate-300"
                            placeholder={`Enter ${field.label.toLowerCase()}...`}
                          />
                        </div>
                      ))}
                  </div>
                )}
                </div>
              </div>
              <div className="p-6 border-t border-slate-100 bg-white/80 backdrop-blur-sm shrink-0 relative z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
              </div>
            </div>

            {/* Main Area: Document Preview */}
            <div className="flex-1 overflow-y-auto p-0 bg-slate-50/50 custom-scrollbar">
              <div 
                ref={previewContainerRef}
                onMouseMove={(e) => {
                  if (isDraggingSignature) {
                    const nextPos = getDocumentRelativePosition(e.clientX, e.clientY);
                    if (nextPos) {
                      setManualSignaturePos(nextPos);
                    }
                  }
                }}
                onMouseUp={() => setIsDraggingSignature(false)}
                onMouseLeave={() => setIsDraggingSignature(false)}
                onClick={(e) => {
                  if (isPlacingSignature) {
                    const nextPos = getDocumentRelativePosition(e.clientX, e.clientY);
                    if (nextPos) {
                      setManualSignaturePos(nextPos);
                      setIsPlacingSignature(false);
                    }
                  }
                }}
                className={`w-full max-w-[1200px] mx-auto h-fit transition-all relative ${isPlacingSignature ? "cursor-crosshair ring-4 ring-violet-400 ring-offset-4 ring-offset-slate-100" : ""}`}
              >
                <div className="relative">
                  {hasUploadedDocument && template.fileDataUrl ? (
                    <div className="bg-slate-100/50 p-6 md:p-8 overflow-y-auto custom-scrollbar flex justify-center">
                      <div ref={documentCanvasRef} className="relative w-fit max-w-full">
                        {uploadedDocumentIsPdf ? (
                          isLoadingPdfPreview ? (
                            <div
                              className="flex items-center justify-center bg-white shadow-2xl rounded-sm border border-slate-200 text-slate-500"
                              style={{ width: `${DOCUMENT_STAGE_WIDTH}px`, maxWidth: "100%", minHeight: `${DOCUMENT_STAGE_MIN_HEIGHT}px` }}
                            >
                              <div className="flex items-center gap-3 text-sm font-medium">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Rendering PDF preview...
                              </div>
                            </div>
                          ) : pdfPreviewPages.length > 0 ? (
                            <div
                              className="template-preview-content document-content"
                              style={{ width: `${DOCUMENT_STAGE_WIDTH}px`, maxWidth: "100%" }}
                              dangerouslySetInnerHTML={{
                                __html: uploadedPreviewHtml,
                              }}
                            />
                          ) : (
                            <div
                              className="bg-white shadow-2xl rounded-sm border border-slate-200 text-left overflow-hidden"
                              style={{ width: `${DOCUMENT_STAGE_WIDTH}px`, maxWidth: "100%", minHeight: `${DOCUMENT_STAGE_MIN_HEIGHT}px` }}
                            >
                              <iframe
                                src={`${template.fileDataUrl}#toolbar=0&navpanes=0&statusbar=0&view=FitH&page=1`}
                                title={template.name}
                                className="block h-[1056px] w-full bg-white"
                              />
                            </div>
                          )
                        ) : (template.mimeType?.startsWith("image/") && !template.detectedText) ? (
                          <div
                            className="bg-white shadow-2xl rounded-sm border border-slate-200 text-left overflow-hidden"
                            style={{ width: `${DOCUMENT_STAGE_WIDTH}px`, maxWidth: "100%" }}
                          >
                            <img
                              src={template.fileDataUrl}
                              alt={template.name}
                              className="block w-full h-auto"
                            />
                          </div>
                        ) : uploadedPreviewIsStructured && (template.detectedText || "").includes('class="pdf-document"') ? (
                          <div
                            className="template-preview-content document-content"
                            style={{ width: `${DOCUMENT_STAGE_WIDTH}px`, maxWidth: "100%" }}
                            dangerouslySetInnerHTML={{
                              __html: liveUploadedPreviewText || template.detectedText || "",
                            }}
                          />
                        ) : (
                          <div
                            className="bg-white shadow-2xl rounded-sm border border-slate-200 text-left overflow-hidden"
                            style={{ width: `${DOCUMENT_STAGE_WIDTH}px`, maxWidth: "100%", minHeight: `${DOCUMENT_STAGE_MIN_HEIGHT}px` }}
                          >
                            <div
                              className="template-preview-content document-content relative z-10 p-12 md:p-16 text-[15px] leading-[1.9] text-slate-900"
                              style={{ padding: `${DOCUMENT_STAGE_PADDING}px` }}
                              dangerouslySetInnerHTML={{
                                __html:
                                  uploadedPreviewHtml ||
                                  liveUploadedPreviewText ||
                                  template.detectedText ||
                                  "<div>No text content could be extracted from this document.</div>",
                              }}
                            />
                          </div>
                        )}

                        {manualSignaturePos && savedSignature && (
                          <div
                            className={`absolute z-50 group ${isDraggingSignature ? "cursor-grabbing" : "cursor-grab"}`}
                            style={{
                              left: `${manualSignaturePos.x}%`,
                              top: `${manualSignaturePos.y}%`,
                              transform: `translate(-50%, -50%) scale(${manualSignatureScale})`,
                              pointerEvents: isPlacingSignature ? "none" : "auto",
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setIsDraggingSignature(true);
                            }}
                          >
                            <div className={`relative ${isDraggingSignature ? "opacity-75" : ""}`}>
                              <img
                                src={savedSignature}
                                alt="Placed Signature"
                                className="h-16 w-auto object-contain select-none pointer-events-none"
                              />
                              <div className={`absolute -inset-2 border-2 border-dashed border-violet-400 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity ${isDraggingSignature ? "opacity-100" : ""}`} />
                              <div className="absolute -top-1 -right-1 w-4 h-4 bg-violet-600 rounded-full border-2 border-white shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="w-1.5 h-1.5 bg-white rounded-full" />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                      <div className="w-full max-w-[1200px] mx-auto bg-white shadow-lg p-6 md:p-10 min-h-[1056px] rounded-lg border border-slate-100 flex flex-col relative">
                        <div className="absolute top-6 left-6 flex items-center gap-3">
                          <button
                            onClick={() => onClose()}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all font-semibold"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            Back
                          </button>
                        </div>

                        <div className="absolute top-6 right-6 flex items-center gap-3">
                          {editedTemplateContent && (
                            <button
                              onClick={handleResetTemplate}
                              className="flex items-center justify-center w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-red-600 hover:bg-red-50 transition-all shadow-sm group"
                              title="Reset all edits"
                            >
                              <RotateCcw className="h-4 w-4 transition-transform group-hover:rotate-[-45deg]" />
                            </button>
                          )}

                          <button
                            onClick={() => {
                              if (isEditMode) {
                                const contentDiv = document.querySelector('.template-preview-content');
                                if (contentDiv) {
                                  setEditedTemplateContent(contentDiv.innerHTML);
                                }
                              }
                              setIsEditMode(!isEditMode);
                            }}
                            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-sm ${isEditMode ? 'bg-green-600 text-white shadow-green-200' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                          >
                            {isEditMode ? <><Save className="h-3.5 w-3.5" /> Stop Editing</> : <><Edit3 className="h-3.5 w-3.5" /> Edit Content</>}
                          </button>
                          
                          <button
                            onClick={() => onClose()}
                            className="h-10 w-10 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-slate-900 transition-all"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>


                        {/* Full letter content with replaced placeholders */}
                        <div 
                          contentEditable={isEditMode}
                          suppressContentEditableWarning
                          className={`text-slate-900 leading-relaxed text-[16px] font-serif antialiased tracking-tight relative z-10 outline-none transition-all duration-300 ${isEditMode ? 'ring-4 ring-amber-100 bg-amber-50/10 rounded-xl' : ''}`} 
                          style={{ fontFamily: 'inherit' }}
                        >
                        {(() => {
                          let filledContent = templateContent;

                          // First handle standard bold tags for safety
                          filledContent = filledContent.replace(/<strong>/g, '<span class="font-bold text-slate-900">').replace(/<\/strong>/g, '</span>');

                          Object.keys(formValues).forEach(key => {
                            const val = formValues[key] || `<span style="font-family: inherit;">[${key}]</span>`;
                            const isDateKey = (key: string) => key.endsWith("_DATE") || key === "START_DATE";
                            const displayVal = isDateKey(key) ? formatDate(val) : val;
                            filledContent = filledContent.replace(new RegExp(`\\[${escapeRegExp(key)}\\]`, 'g'), `<span style="font-family: inherit;">${displayVal}</span>`);
                          });

                          // Add signature logic
                          if (savedSignature && !manualSignaturePos) {
                            filledContent = filledContent.replace(
                              /\[SIGNATURE\]/g,
                              `<div style="margin-top: 15px;">
                                <img src="${savedSignature}" alt="Signature" class="h-20 w-auto object-contain" style="display: block; margin-bottom: -15px;" />
                                <div style="font-weight: 800; color: #1e293b; text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; border-top: 2px solid #f1f5f9; display: inline-block; padding-top: 8px;">Signature</div>
                              </div>`
                            );
                          }
                          if (editedTemplateContent) {
                            if (isEditMode) {
                               return <div className="template-preview-content" dangerouslySetInnerHTML={{ __html: editedTemplateContent.replace(/\n/g, "<br/>") }} />;
                            }
                            // Apply highlighting ONLY if manual edits exist to avoid false positives
                            const highlighted = highlightHtmlEdits(filledContent.replace(/\n/g, "<br/>"), editedTemplateContent);
                            return <div className="template-preview-content" dangerouslySetInnerHTML={{ __html: highlighted.replace(/\n/g, "<br/>") }} />;
                          }
                          return <div className="template-preview-content" dangerouslySetInnerHTML={{ __html: filledContent.replace(/\n/g, "<br/>") }} />;
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Select Document Type ── */}
        {step === "type_selection" && (
          <div className="flex h-[calc(100vh-73px)] items-center justify-center p-6 bg-slate-50 overflow-hidden">
            <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-100 p-12 text-center animate-in fade-in zoom-in-95 duration-300">
              <h2 className="text-3xl font-black text-slate-900 mb-4">Who is signing this document?</h2>
              <p className="text-slate-500 mb-10 text-lg">Choose the type of recipient for this document.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <button
                  onClick={() => {
                    setDocumentType("internal");
                    setStep("internal_recipients");
                  }}
                  className="flex flex-col items-center justify-center p-8 rounded-[2rem] border-2 border-slate-100 hover:border-violet-400 hover:bg-violet-50 transition-all group"
                >
                  <div className="w-20 h-20 rounded-full bg-slate-50 group-hover:bg-white flex items-center justify-center mb-6 shadow-sm border border-slate-100 group-hover:border-violet-100">
                    <Building2 className="w-10 h-10 text-slate-400 group-hover:text-violet-600 transition-colors" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Internal</h3>
                  <p className="text-sm text-slate-500 leading-relaxed font-medium">Send to employees, reviewers, or team members within the organization.</p>
                </button>
                
                <button
                  onClick={() => {
                    setDocumentType("external");
                    setStep("external_recipients");
                  }}
                  className="flex flex-col items-center justify-center p-8 rounded-[2rem] border-2 border-slate-100 hover:border-violet-400 hover:bg-violet-50 transition-all group"
                >
                  <div className="w-20 h-20 rounded-full bg-slate-50 group-hover:bg-white flex items-center justify-center mb-6 shadow-sm border border-slate-100 group-hover:border-violet-100">
                    <Globe className="w-10 h-10 text-slate-400 group-hover:text-violet-600 transition-colors" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">External</h3>
                  <p className="text-sm text-slate-500 leading-relaxed font-medium">Send to clients, investors, or partners outside the organization.</p>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: Select Recipients ── */}
        {(step === "recipients" || step === "internal_recipients" || step === "external_recipients") && (
          <>
          <div className="flex-1 flex min-h-[calc(100vh-73px)] bg-slate-50">
            {/* Left Sidebar: Categories */}
            <div className="w-80 bg-white border-r border-slate-200 flex flex-col">
              <div className="p-6 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">Add a recipient role</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setNewCategoryName("");
                      setShowCategoryDialog(true);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-600 transition-colors hover:bg-violet-200"
                    aria-label="Add recipient role"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Selected</span>
                  <span className="text-[10px] font-black text-violet-600 bg-violet-100 px-2 py-0.5 rounded-lg">{selectedRecipients.length}</span>
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                  {selectedRecipients.map(r => (
                    <div key={r.email} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white border border-slate-100 group">
                      <div className="truncate min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{r.name}</p>
                        <p className="text-[10px] text-slate-400 truncate">{r.email}</p>
                      </div>
                      <button
                        onClick={() => setSelectedRecipients(selectedRecipients.filter(item => item.email !== r.email))}
                        className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {selectedRecipients.length === 0 && (
                    <p className="text-xs text-slate-400 italic text-center py-3">No recipients selected</p>
                  )}
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <div className="space-y-1">
                  {categories.map(cat => {
                    const count = recipientsByCategory[cat]?.length ?? 0;
                    const isActive = activeCategory === cat;
                    return (
                      <div
                        key={cat}
                        className={`flex items-center gap-2 rounded-xl transition-all duration-200 group ${isActive ? "bg-violet-100 text-violet-700 shadow-sm" : "text-slate-500 hover:bg-violet-50 hover:text-violet-600"}`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveCategory(cat);
                            setRecipientSearch("");
                          }}
                          className="flex flex-1 items-center justify-between px-4 py-3 text-left"
                        >
                          <span className={`text-sm font-bold ${isActive ? "text-violet-700" : "text-slate-600 group-hover:text-violet-600"}`}>{cat}</span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${isActive ? "bg-violet-200 text-violet-800" : "bg-slate-100 text-slate-400 group-hover:bg-violet-100 group-hover:text-violet-600"}`}>
                            {count}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteCategory(cat)}
                          className={`mr-2 inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${isActive ? "text-violet-500 hover:bg-violet-200" : "text-slate-300 hover:bg-red-50 hover:text-red-500"}`}
                          aria-label={`Delete ${cat}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {/* Direct Invite Toggle */}
                  <button
                    onClick={() => setActiveCategory("Manual")}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group ${activeCategory === "Manual" ? "bg-violet-100 text-violet-700 shadow-sm" : "text-slate-500 hover:bg-violet-50 hover:text-violet-600"}`}
                  >
                    <span className={`text-sm font-bold ${activeCategory === "Manual" ? "text-violet-700" : "text-slate-600 group-hover:text-violet-600"}`}>Direct Invite</span>
                    <div className={`w-2 h-2 rounded-full ${activeCategory === "Manual" ? "bg-violet-500" : "bg-slate-300"}`} />
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 bg-white flex flex-col">
              {activeCategory === "Manual" ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center max-w-md mx-auto space-y-8">
                  <div className="w-20 h-20 rounded-3xl bg-violet-50 flex items-center justify-center text-3xl shadow-inner">✉️</div>
                  <div className="space-y-2">
                    <h4 className="text-lg font-extrabold text-slate-900 tracking-tight">Enter Email Manually</h4>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">Send this document to an external recipient not listed in our system.</p>
                  </div>
                  <div className="w-full relative">
                        <input
                          type="email"
                          placeholder="recipient@example.com"
                          className="w-full px-6 py-4 rounded-2xl border-2 border-slate-100 focus:outline-none focus:border-violet-400 text-sm font-semibold transition-all shadow-sm"
                          value={manualEmail}
                          onChange={(e) => setManualEmail(e.target.value)}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Search Header */}
                      <div className="px-10 py-8 border-b border-slate-50 shrink-0">
                        <div className="flex items-center justify-between mb-6">
                          <div>
                            <h4 className="text-lg font-extrabold text-slate-900 tracking-tight">{activeCategory}</h4>
                            <p className="text-xs text-slate-500 font-medium mt-1">Select one or more recipients to continue</p>
                          </div>
                        </div>
                        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                          <input
                            type="text"
                            placeholder={`Add new ${activeCategory.slice(0, -1).toLowerCase()} name`}
                            value={newRecipientName}
                            onChange={(e) => setNewRecipientName(e.target.value)}
                            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-semibold outline-none transition-all focus:border-violet-400"
                          />
                          <input
                            type="email"
                            placeholder="name@example.com"
                            value={newRecipientEmail}
                            onChange={(e) => setNewRecipientEmail(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addRecipientToCategory();
                              }
                            }}
                            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-semibold outline-none transition-all focus:border-violet-400"
                          />
                          <button
                            type="button"
                            onClick={addRecipientToCategory}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-violet-700"
                          >
                            <Plus className="h-4 w-4" />
                            Add
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder={`Search by name or email in ${activeCategory.toLowerCase()}...`}
                            value={recipientSearch}
                            onChange={(e) => setRecipientSearch(e.target.value)}
                            className="w-full pl-12 pr-4 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-violet-400 focus:bg-white text-sm font-semibold outline-none transition-all placeholder:text-slate-400"
                          />
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                        </div>
                      </div>

                      {/* Recipient Grid */}
                      <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
                        <div className="grid grid-cols-2 gap-4">
                          {filteredRecipients.map(r => {
                              const isSelected = selectedRecipients.some(item => item.email === r.email);
                              return (
                                <div
                                  key={r.email}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => {
                                    if (isSelected) {
                                      setSelectedRecipients(selectedRecipients.filter(item => item.email !== r.email));
                                    } else {
                                      setSelectedRecipients([...selectedRecipients, r]);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      if (isSelected) {
                                        setSelectedRecipients(selectedRecipients.filter(item => item.email !== r.email));
                                      } else {
                                        setSelectedRecipients([...selectedRecipients, r]);
                                      }
                                    }
                                  }}
                                  className={`flex cursor-pointer items-center text-left gap-4 p-4 rounded-[1.5rem] border-2 transition-all duration-300 group ${isSelected ? "border-violet-400 bg-violet-50/50 shadow-md shadow-violet-100/30" : "border-slate-50 bg-white hover:border-violet-200"}`}
                                >
                                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-semibold transition-colors ${isSelected ? "bg-violet-500 text-white" : "bg-slate-100 text-slate-400 group-hover:bg-violet-100 group-hover:text-violet-600 shadow-inner"}`}>
                                    {r.name.charAt(0)}
                                  </div>
                                  <div className="flex-1 truncate">
                                    <p className="text-sm font-bold text-slate-900 truncate leading-tight mb-0.5">{r.name}</p>
                                    <p className="text-[10px] text-slate-400 font-bold truncate tracking-tight">{r.email}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteRecipientFromCategory(activeCategory, r);
                                    }}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                                    aria-label={`Delete ${r.name}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${isSelected ? "bg-violet-500 scale-100" : "bg-slate-100 scale-75 opacity-0 group-hover:opacity-100"}`}>
                                    <svg className={`w-3.5 h-3.5 ${isSelected ? "text-white" : "text-slate-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                    </svg>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                        {filteredRecipients.length === 0 && (
                          <div className="flex h-40 items-center justify-center rounded-[1.75rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-medium text-slate-400">
                            No recipients in {activeCategory.toLowerCase()} yet. Add one above.
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Create Contact Dialog */}
              {showCategoryDialog && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                  <div className="w-full max-w-sm mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
                    <div className="px-6 pt-6 pb-4 border-b border-slate-100">
                      <h3 className="text-base font-bold text-slate-900">Select a recipient role</h3>
                      <p className="text-xs text-slate-500 mt-1">Add a new recipient role.</p>
                    </div>
                    <div className="px-6 py-5">
                      <input
                        type="text"
                        placeholder="Recipient role name"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addCategory();
                            setShowCategoryDialog(false);
                          }
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-50"
                        autoFocus
                      />
                    </div>
                    <div className="px-6 pb-6 flex gap-3">
                      <button
                        onClick={() => { setShowCategoryDialog(false); setNewCategoryName(""); }}
                        className="flex-1 py-2.5 rounded-2xl text-slate-600 font-bold text-sm border border-slate-200 hover:bg-slate-50 transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => { addCategory(); setShowCategoryDialog(false); }}
                        className="flex-[2] py-2.5 rounded-2xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-700 transition-all flex items-center justify-center gap-2"
                      >
                        Create Role
                      </button>
                    </div>
                  </div>
                </div>
              )}
          </>
        )}
        {/* ── STEP 4: Confirm & Send ── */}
        {step === "send" && (
          <div className="flex-1 flex h-[calc(100vh-73px)] bg-slate-50 overflow-hidden text-left">
            {isSent ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-white animate-in fade-in duration-500">
                <div className="w-24 h-24 rounded-[2.5rem] bg-violet-50 flex items-center justify-center mb-6 shadow-sm border border-violet-100">
                  <CheckCircle2 className="w-10 h-10 text-violet-600" />
                </div>
                <div className="max-w-md space-y-4">
                  <h3 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">
                    {(sendActionType === "review") ? "Sent for Review!" : "Document Sent Successfully!"}
                  </h3>
                  <p className="text-slate-500 font-medium leading-relaxed">
                    {(sendActionType === "review")
                      ? "Your document has been sent for review. You can track its progress in the Documents page." 
                      : "Everything looks great! Your document is on its way to the recipients for signing."}
                  </p>
                  <div className="pt-6">
                    <button 
                      onClick={() => router.push("/dashboard/documents")} 
                      className="py-4 px-10 rounded-2xl bg-violet-600 text-white font-bold text-sm shadow-xl shadow-violet-200 hover:bg-violet-700 transition-all hover:-translate-y-1 active:scale-95"
                    >
                      View Documents
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Left Panel: Template Preview */}
                <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden animate-in fade-in duration-1000">
                  <div className="flex-1 overflow-y-auto px-12 py-16 custom-scrollbar scroll-smooth">
                    <div className="max-w-4xl mx-auto bg-white rounded-[2.5rem] shadow-2xl border border-slate-200/60 overflow-hidden ring-8 ring-slate-100/30">
                      <div className="p-16 text-left">
                        {/* Full letter content with replaced placeholders */}
                        <div className="space-y-6 text-slate-600 leading-[2] text-[16px] font-sans antialiased tracking-tight relative z-10" style={{ fontFamily: '"Inter", sans-serif' }}>
                          {/* Manual Signature Overlay for Step 3 */}
                          {manualSignaturePos && savedSignature && (
                            <div 
                              className="absolute z-50 pointer-events-none"
                              style={{ 
                                left: `${manualSignaturePos.x}%`, 
                                top: `${manualSignaturePos.y}%`,
                                transform: `translate(-50%, -50%) scale(${manualSignatureScale})`
                              }}
                            >
                              <img 
                                src={savedSignature} 
                                alt="Manually Placed Signature" 
                                className="h-16 w-auto object-contain" 
                              />
                            </div>
                          )}
                          {(() => {
                            let filledContent = templateContent;

                            // Security & Style replacements
                            filledContent = filledContent.replace(/<strong>/g, '<span class="font-bold text-slate-900">').replace(/<\/strong>/g, '</span>');

                            Object.keys(formValues).forEach(key => {
                              const val = formValues[key] || `<span class="bg-violet-50 text-violet-400 px-1 rounded">[${key}]</span>`;
                              const isDateKey = (key: string) => key.endsWith("_DATE") || key === "START_DATE";
                              const displayVal = isDateKey(key) ? formatDate(val) : val;
                              filledContent = filledContent.replace(new RegExp(`\\[${escapeRegExp(key)}\\]`, 'g'), `<span class="font-bold text-slate-900">${displayVal}</span>`);
                            });

                            if (savedSignature && !manualSignaturePos) {
                              filledContent = filledContent.replace(
                                /\[SIGNATURE\]/g,
                                `<div style="margin-top: 30px;">
                                  <img src="${savedSignature}" alt="Signature" class="h-24 w-auto object-contain" />
                                  <div style="font-weight: 800; color: #1e293b; text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; border-top: 2px solid #f1f5f9; display: inline-block; padding-top: 12px; margin-top: 8px;">Authorized Signature</div>
                                </div>`
                              );
                            } else {
                              filledContent = filledContent.replace(
                                /\[SIGNATURE\]/g,
                                `<div style="margin-top: 30px;">
                                  <div style="height: 100px;"></div>
                                  <div style="font-weight: 800; color: #1e293b; text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; border-top: 2px solid #f1f5f9; display: inline-block; padding-top: 12px;">Authorized Signature</div>
                                </div>`
                              );
                            }
                            return <div dangerouslySetInnerHTML={{ __html: filledContent.replace(/\n/g, "<br/>") }} />;
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Sidebar: Confirmation Details */}
                <div className="w-[400px] bg-white border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-500 bg-white/80 backdrop-blur-md">
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="p-8 border-b border-slate-100">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center text-white text-xs font-black shadow-lg shadow-violet-200">4</div>
                        <h3 className="text-2xl font-black text-slate-900 tracking-tight">Confirm & Send</h3>
                      </div>
                      <p className="text-slate-500 text-xs font-medium">Finalize and dispatch your document.</p>
                    </div>

                    <div className="p-8 space-y-10">
                      {/* Sender Section */}
                      <div className="space-y-4">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                          <span className="w-4 h-px bg-slate-200" /> Sender Information
                        </h4>
                        <div className="bg-slate-50/50 rounded-2xl p-6 space-y-4 border border-slate-100/50">
                          <div className="flex flex-col gap-1 text-left">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Sender Name</span>
                            <span className="text-sm font-bold text-slate-700">{formValues.SENDER_NAME || "Digimabble Sender"}</span>
                          </div>
                          <div className="flex flex-col gap-1 text-left">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Company & Role</span>
                            <span className="text-sm font-bold text-slate-700">{formValues.SENDER_COMPANY || "Digimabble"} • {formValues.SENDER_DESIGNATION || "HR Director"}</span>
                          </div>
                          <div className="flex flex-col gap-1 text-left">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Date</span>
                            <span className="text-sm font-bold text-slate-700">{formatDate(formValues.CURRENT_DATE || todayISO)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Recipients Section */}
                      <div className="space-y-4 text-left">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                          <span className="w-4 h-px bg-slate-200" /> Recipients
                        </h4>
                        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                          {selectedRecipients.map(r => (
                            <div key={r.email} className="flex items-start gap-4 p-5 bg-white border border-slate-100 rounded-3xl shadow-sm hover:border-violet-200 transition-all hover:shadow-md group">
                              <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center text-violet-600 text-lg font-black shrink-0 group-hover:bg-violet-600 group-hover:text-white transition-colors uppercase">
                                {r.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-black text-slate-900 truncate">{r.name}</p>
                                  <span className="text-[9px] font-black text-violet-600 bg-violet-50 px-2 py-0.5 rounded-lg uppercase tracking-widest">{r.role || "Signer"}</span>
                                </div>
                                <p className="text-[11px] text-slate-500 font-bold truncate">ID: {r.email}</p>
                                <div className="pt-2 flex flex-wrap gap-2 text-[10px]">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-slate-400 font-bold uppercase tracking-tighter">Designation</span>
                                    <span className="text-slate-700 font-extrabold">{r.role === 'reviewer' ? 'Reviewer' : 'Signer'}</span>
                                  </div>
                                  <div className="w-px h-6 bg-slate-100 mx-1" />
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-slate-400 font-bold uppercase tracking-tighter">Company</span>
                                    <span className="text-slate-700 font-extrabold">{documentType === "internal" ? INTERNAL_COMPANY_NAME : (r.company || "General")}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                          {manualEmail.trim() && !selectedRecipients.some(r => normalizeEmail(r.email) === normalizeEmail(manualEmail)) && (
                            <div className="flex items-center gap-4 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm bg-slate-50/50">
                              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center text-violet-600 text-sm font-black shrink-0">✉</div>
                              <div className="flex-1 min-w-0 text-left">
                                <p className="text-sm font-bold text-slate-900 truncate">{manualEmail}</p>
                                <p className="text-[10px] text-slate-400 font-medium">External Contact</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions Sidebar Footer */}
                  <div className="p-8 border-t border-slate-100 bg-slate-50/30 space-y-4">
                    {sendError && (
                      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-xs font-bold text-red-600 animate-in shake duration-300">
                        ⚠️ {sendError}
                      </div>
                    )}
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => setShowSendChoice(true)}
                        disabled={isUploadingDoc || isPersisting}
                        className="w-full py-4 rounded-2xl bg-violet-600 text-white font-black text-sm shadow-xl shadow-violet-100 hover:bg-violet-700 hover:-translate-y-1 transition-all active:scale-95 disabled:bg-slate-200 disabled:shadow-none flex items-center justify-center gap-2"
                      >
                        {isUploadingDoc || isPersisting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          "Send Document Now"
                        )}
                      </button>
                      <button
                        onClick={() => setStep(documentType === "internal" ? "internal_recipients" : "external_recipients")}
                        className="w-full py-4 rounded-2xl text-slate-400 font-bold text-sm hover:bg-slate-100 hover:text-slate-600 transition-all active:scale-95"
                      >
                        Back to Recipients
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Signature Pad Modal Overlay */}
        {showSignaturePad && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="w-full max-w-lg mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-300">
              <div className="flex items-center justify-between border-b border-slate-100 px-8 py-6">
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Create Signature</h3>
                  <p className="text-xs text-slate-500 font-medium mt-1">This will be added to the document.</p>
                </div>
                <button
                  onClick={() => setShowSignaturePad(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-900 transition-all hover:rotate-90"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Interaction Modes */}
              <div className="flex border-b border-slate-100">
                {(["draw", "type", "upload"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSignatureMode(mode)}
                    className={`flex-1 py-4 text-xs font-black uppercase tracking-widest transition-all ${
                      signatureMode === mode
                        ? "text-violet-600 border-b-2 border-violet-600 bg-violet-50/30"
                        : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex items-center justify-center gap-2">
                       {mode === "draw" && <PenTool className="w-3 h-3" />}
                       {mode === "type" && <Type className="w-3 h-3" />}
                       {mode === "upload" && <CloudUpload className="w-3 h-3" />}
                       {mode}
                    </span>
                  </button>
                ))}
              </div>

              <div className="p-8">
                {signatureMode === "draw" && (
                  <div className="space-y-4">
                    <div className="relative rounded-2xl overflow-hidden border-2 border-slate-100 bg-slate-50/50 hover:border-violet-100 transition-all">
                      <canvas
                        ref={canvasRef}
                        width={400}
                        height={200}
                        className="w-full cursor-crosshair"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onTouchStart={handleMouseDown}
                        onTouchMove={handleMouseMove}
                        onTouchEnd={handleMouseUp}
                      />
                      <button
                        onClick={clearCanvas}
                        className="absolute bottom-4 right-4 px-3 py-1.5 rounded-lg bg-white/80 backdrop-blur-md border border-slate-200 text-[10px] font-black text-slate-400 hover:text-slate-900 shadow-sm transition-all"
                      >
                        Clear Canvas
                      </button>
                    </div>
                  </div>
                )}

                {signatureMode === "type" && (
                  <div className="space-y-6">
                    <input
                      type="text"
                      autoFocus
                      value={typedSignature}
                      onChange={(e) => setTypedSignature(e.target.value)}
                      placeholder="Type your name here..."
                      className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50/50 px-6 py-4 text-lg font-bold text-slate-800 outline-none placeholder:text-slate-300 focus:border-violet-200 focus:bg-white transition-all shadow-inner"
                    />
                    {typedSignature && (
                      <div className="rounded-3xl border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-12 text-center shadow-xl shadow-slate-100/50 border-t-8 border-violet-100">
                        <p className="text-5xl text-slate-900 antialiased" style={{ fontFamily: '"Great Vibes", cursive, cursive-serif, serif' }}>
                          {typedSignature}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {signatureMode === "upload" && (
                  <div className="space-y-6">
                    <label className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/30 p-12 cursor-pointer hover:bg-slate-100/50 hover:border-violet-200 transition-all group">
                      <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center text-slate-400 mb-4 shadow-sm group-hover:scale-110 group-hover:text-violet-500 transition-all ring-8 ring-slate-100/30">
                        <CloudUpload className="w-8 h-8" />
                      </div>
                      <span className="text-sm font-black text-slate-600">Select Signature Image</span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2 px-3 py-1 rounded-full bg-slate-100 group-hover:bg-violet-100 group-hover:text-violet-600 transition-all">PNG, JPG up to 2MB</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={handleSignatureImageUpload}
                        className="hidden"
                      />
                    </label>
                    {uploadedSignature && (
                      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-md shadow-slate-100">
                        <img src={uploadedSignature} alt="Uploaded" className="max-h-32 mx-auto object-contain" />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-3 bg-slate-50/50 px-8 py-6 border-t border-slate-100">
                <button
                  onClick={() => setShowSignaturePad(false)}
                  className="flex-1 py-4 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-400 hover:text-slate-600 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={saveNewSignature}
                  disabled={isSavingSignature}
                  className="flex-[2] py-4 rounded-2xl bg-violet-600 text-white font-black text-sm shadow-xl shadow-violet-100 hover:bg-violet-700 hover:-translate-y-1 transition-all active:scale-95 disabled:bg-slate-300 disabled:shadow-none flex items-center justify-center gap-2"
                >
                  {isSavingSignature ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save & Use Signature"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Send Choice Modal Overlay */}
        {showSendChoice && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center bg-violet-900/10 backdrop-blur-xl animate-in fade-in duration-300">
            <div className="relative w-full max-w-lg mx-4 bg-white rounded-3xl shadow-2xl border border-white overflow-hidden animate-in zoom-in-95 duration-300">
              <button
                onClick={() => setShowSendChoice(false)}
                className="absolute top-6 right-6 w-12 h-12 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all z-10"
                aria-label="Close"
              >
                <X className="w-6 h-6" />
              </button>
              <div className="px-8 py-8 text-center space-y-6">
                <div className="space-y-3">
                  <div className="mx-auto w-12 h-1 bg-slate-100 rounded-full mb-4" />
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">How to proceed?</h3>
                  <p className="text-slate-500 font-medium text-sm">Choose the next step for this document workflow to begin.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => {
                      setShowSendChoice(false);
                      handleSend("review");
                    }}
                    className="group relative flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-50 border-2 border-transparent hover:border-violet-400 hover:bg-violet-50/50 transition-all duration-300 shadow-sm hover:shadow-xl hover:shadow-violet-100/50"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 mb-4 shadow-sm group-hover:scale-110 group-hover:bg-violet-600 group-hover:text-white transition-all ring-8 ring-slate-100/30">
                      <Eye className="w-6 h-6" />
                    </div>
                    <span className="text-lg font-extrabold text-slate-900 mb-1">Send for Review</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowSendChoice(false);
                      handleSend("sign");
                    }}
                    className="group relative flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-50 border-2 border-transparent hover:border-violet-400 hover:bg-violet-50/50 transition-all duration-300 shadow-sm hover:shadow-xl hover:shadow-violet-100/50"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 mb-4 shadow-sm group-hover:scale-110 group-hover:bg-violet-600 group-hover:text-white transition-all ring-8 ring-slate-100/30">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <span className="text-lg font-extrabold text-slate-900 mb-1">Send for Sign</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

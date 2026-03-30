"use client";

import { Suspense, useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { Search, ChevronLeft, Loader2, List, LayoutGrid, Image as ImageIcon, FileImage, Plus, Trash2 } from "lucide-react";
import { OFFER_LETTER_TEMPLATE, type Template } from "./data";
import { useUploadThing } from "../../lib/uploadthing-client";
import { supabase } from "../../lib/supabase/browser";
import { analyzeDocumentFile, extractPlaceholdersFromText } from "../../lib/document-analysis";
import { normalizeEmail, normalizeRecipients } from "../../lib/documents";
import { getScopedStorageItem, setScopedStorageItem } from "../../lib/user-storage";

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

type Recipient = { name: string; email: string; role?: string };

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
    return Array.from(new Set((OFFER_LETTER_TEMPLATE.match(/\[([^\]]+)\]/g) || []).map((item) => item.replace(/[\[\]]/g, ""))));
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
  `Updated ${new Date(value ?? Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

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
  fileUrl?: string;
  fileKey?: string;
  category?: string;
  content?: string;
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
    .insert({
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
  const [favorites, setFavorites] = useState<Set<TemplateId>>(new Set());
  const [useStep, setUseStep] = useState<"review" | "recipients" | "send" | null>(null);
  const [selectedForUse, setSelectedForUse] = useState<TemplateId | null>(null);
  const [appTemplates, setAppTemplates] = useState<AppTemplate[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        let user = (session?.user ?? undefined) as any;
        
        if (!user) {
          const { data: { user: freshUser }, error: authError } = await supabase.auth.getUser();
          if (authError) {
            if (authError.message?.includes("stole it")) return;
            throw authError;
          }
          user = freshUser;
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
      setAppTemplates(remoteTemplates);
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
                  title: "Imported Content",
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
          file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      if (!files.length) {
        alert("Please add a PDF, Image, or Word document.");
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

  // Check for step=recipients parameter to open template flow at step 2
  useEffect(() => {
    if (currentUserId === undefined) return;

    const stepParam = searchParams.get("step");
    const documentId = searchParams.get("documentId");
    if (stepParam !== "recipients" || !documentId || !currentUserId) return;

    const loadReviewedDocument = async () => {
      const { data: docData, error } = await supabase
        .from("documents")
        .select("id, name, category, file_url")
        .eq("id", documentId)
        .eq("owner_id", currentUserId)
        .maybeSingle<ReviewedDocumentRow>();

      if (error || !docData) {
        console.warn("Failed to load reviewed document:", error);
        return;
      }

      const existingTemplate = appTemplates.find((template) => template.name === docData.name);
      if (existingTemplate) {
        setSelectedForUse(existingTemplate.id);
      } else {
        const tempTemplate: AppTemplate = {
          id: `review-${docData.id}`,
          initial: docData.name.charAt(0).toUpperCase(),
          name: docData.name,
          category: (docData.category as Template["category"]) || "Legal",
          updated: formatTemplateUpdatedLabel(),
          uses: "0 uses",
          color: "bg-violet-50 text-violet-600",
          fileDataUrl: docData.file_url ?? undefined,
          preview: {
            headline: docData.name,
            sections: [{ title: "Document", lines: ["Reviewed document ready to send"] }],
          },
        };
        setAppTemplates((prev) => [tempTemplate, ...prev]);
        setSelectedForUse(tempTemplate.id);
      }

      setUseStep("recipients");
    };

    void loadReviewedDocument();
  }, [searchParams, appTemplates, currentUserId]);

  const filteredTemplates = useMemo(() => {
    let filtered = appTemplates;

    // Filter by category
    if (selectedCategory === "Favourites") {
      filtered = filtered.filter(tpl => favorites.has(tpl.id));
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
  }, [searchQuery, selectedCategory, appTemplates, favorites]);

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
      <div className="flex h-full w-full flex-col justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4">
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
          <p className="line-clamp-3 text-xs font-semibold leading-5 text-slate-700">
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
    <div className="px-4 pb-8 pt-6 md:px-8 md:pb-10 md:pt-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Templates
          </h1>
        </div>
        <div className="relative">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="application/pdf,image/*,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="inline-flex items-center rounded-full border border-violet-600 bg-white px-4 py-2 text-xs font-semibold text-violet-600 shadow-sm hover:bg-violet-600 hover:text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              "+ Upload Template"
            )}
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {/* Search Bar */}
        <div className="relative w-full">
          <input
            type="text"
            placeholder="Search templates by name or category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-10 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
          />
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        </div>

        {/* Category Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          {["All", "Favourites", "Legal", "Sales", "HR"].map((label) => (
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
              <div className={viewMode === "grid" ? "px-4 pb-3 pt-4" : "min-w-0 flex-1"}>
                  <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
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
                        Last updated {tpl.updated}
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
                            setFavorites(prev => {
                              const newFavorites = new Set(prev);
                              if (newFavorites.has(tpl.id)) {
                                newFavorites.delete(tpl.id);
                              } else {
                                newFavorites.add(tpl.id);
                              }
                              return newFavorites;
                            });
                            setOpenMenuId(null);
                          }}
                        >
                          {favorites.has(tpl.id) ? "Remove Favourite" : "Add to Favourite"}
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
                  <div className="mt-4 h-40 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    {getTemplatePreview(tpl)}
                  </div>
                )}
              </div>
              <div className={viewMode === "grid" ? "border-t border-slate-200 bg-white/50 px-4 py-3" : "shrink-0"}>
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

const createEmptyRecipientGroups = (categories: readonly string[] = RECIPIENT_CATEGORIES): Record<string, Recipient[]> =>
  categories.reduce<Record<string, Recipient[]>>((acc, category) => {
    acc[category] = [];
    return acc;
  }, {});

// Generate template fields based on the template content
const generateTemplateFields = (templateContent: string) => {
  const regex = /\[([^\]]+)\]/g;
  const matches = Array.from(templateContent.matchAll(regex));
  const placeholders = Array.from(new Set(matches.map(m => m[1])));

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
  step: "review" | "recipients" | "send",
  setStep: (s: "review" | "recipients" | "send" | null) => void,
  onClose: () => void,
  router: ReturnType<typeof useRouter>,
  currentUserId: string | null | undefined
}) {
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const todayISO = new Date().toISOString().split("T")[0];

  const hasUploadedDocument = Boolean(template.fileDataUrl);
  const isOfferLetterTemplate = template.name.includes("Employment Offer") || template.name.includes("Offer Letter");
  const templateContent = isOfferLetterTemplate
    ? OFFER_LETTER_TEMPLATE
    : "";
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
  const liveUploadedPreviewText = useMemo(() => {
    if (!template.detectedText) return "";

    let output = template.detectedText;
    detectedPlaceholders.forEach((placeholder) => {
      const value = placeholderValues[placeholder]?.trim();
      if (!value) return;

      const escaped = escapeRegExp(placeholder);
      const patterns = [
        new RegExp(`\\[\\s*${escaped}\\s*\\]`, "gi"),
        new RegExp(`\\(\\s*${escaped}\\s*\\)`, "gi"),
      ];

      patterns.forEach((pattern) => {
        output = output.replace(pattern, value);
      });
    });

    return output;
  }, [detectedPlaceholders, placeholderValues, template.detectedText]);
  const uploadedPreviewHtml = useMemo(() => {
    if (template.detectedText?.trim()) {
      return `<div>${escapeHtml(liveUploadedPreviewText || template.detectedText).replace(/\n/g, "<br/>")}</div>`;
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
  }, [detectedPlaceholders, liveUploadedPreviewText, placeholderValues, template.detectedText, template.name]);

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
  const [selectedRecipients, setSelectedRecipients] = useState<Recipient[]>([]);
  const [isSent, setIsSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("Companies");
  const [categoryNames, setCategoryNames] = useState<string[]>([...RECIPIENT_CATEGORIES]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientsByCategory, setRecipientsByCategory] = useState<Record<string, Recipient[]>>(createEmptyRecipientGroups);
  const [newRecipientName, setNewRecipientName] = useState("");
  const [newRecipientEmail, setNewRecipientEmail] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savedSignature, setSavedSignature] = useState<string | null>(null);

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
      const [{ data: userData }, { data: profileRow }, { data: signatureRow }] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("profiles")
          .select("full_name, company, timezone")
          .eq("id", currentUserId)
          .maybeSingle<ProfileRow>(),
        supabase
          .from("signatures")
          .select("data_url")
          .eq("owner_id", currentUserId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<SignatureRow>(),
      ]);

      setFormValues((prev) => ({
        ...prev,
        SENDER_NAME: profileRow?.full_name || prev.SENDER_NAME,
        SENDER_COMPANY: profileRow?.company || prev.SENDER_COMPANY,
        SENDER_EMAIL: userData.user?.email || prev.SENDER_EMAIL,
      }));

      setSavedSignature(signatureRow?.data_url ?? null);
    };

    void loadProfileAndSignature();
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;

    const storedCategoryNames = getScopedStorageItem(CATEGORY_STORAGE_KEY, currentUserId);
    if (!storedCategoryNames) return;

    try {
      const parsed = JSON.parse(storedCategoryNames);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string" && item.trim())) {
        setCategoryNames(Array.from(new Set(parsed.map((item) => item.trim()))));
      }
    } catch {
      // Ignore malformed stored categories.
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    setScopedStorageItem(CATEGORY_STORAGE_KEY, currentUserId, JSON.stringify(categoryNames));
  }, [categoryNames, currentUserId]);

  useEffect(() => {
    if (activeCategory === "Manual") return;
    if (!categoryNames.includes(activeCategory)) {
      setActiveCategory(categoryNames[0] ?? "Manual");
    }
  }, [activeCategory, categoryNames]);

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
          role: row.category === "Reviewer" ? "reviewer" : "signer"
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
        role: activeCategory === "Reviewer" ? "reviewer" : "signer" 
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
        alert(`Could not delete category: ${error.message}`);
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
    onClientUploadComplete: async (res) => {
      if (res && res[0]) {
        const file = res[0];
        // Generate filled HTML content for viewing
        const isDateKeyLocal = (key: string) => key.endsWith("_DATE") || key === "START_DATE";
        let filledHtmlContent = hasUploadedDocument ? uploadedPreviewHtml : resolvedTemplateBaseContent;
        if (!hasUploadedDocument && resolvedTemplateBaseContent) {
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

        const newDoc = {
          id: `tmp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: template.name,
          subject: activeCategory === "Reviewer" ? `Please review: ${template.name}` : `Please sign: ${template.name}`,
          recipients: (selectedRecipients.length > 0
            ? selectedRecipients
            : [{ name: "Manual", email: manualEmail, role: activeCategory === "Reviewer" ? "reviewer" : "signer" }]
          ).map((r) => ({ ...r, role: r.role || (activeCategory === "Reviewer" ? "reviewer" : "signer"), status: "pending" })),
          sender: { fullName: formValues.SENDER_NAME || "User", workEmail: formValues.SENDER_EMAIL || "user@example.com" },
          sentAt: new Date().toISOString(),
          status: activeCategory === "Reviewer" ? "reviewing" : "waiting",
          fileUrl: file.url, // Store the cloud URL
          fileKey: file.key, // Store the unique key for deletion
          category: activeCategory, // Store the category for reviewer tracking
          content: filledHtmlContent, // Store the filled HTML content for viewing
        };
        try {
          setSendError(null);
          await persistSharedDocument(newDoc);
          setIsSent(true);
        } catch (error) {
          console.error("Failed to save uploaded template document:", error);
          setSendError(error instanceof Error ? error.message : "Failed to save the document to Shared Documents.");
        } finally {
          setIsPersisting(false);
        }
      }
    },
    onUploadError: (error) => {
      setIsPersisting(false);
      setSendError(`Cloud upload failed: ${error.message}`);
      alert(`Cloud storage failed: ${error.message}`);
    }
  });

  const formatDate = (iso: string) => {
    if (!iso) return today;
    try {
      return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return iso; }
  };

  const handleSend = async () => {
    const isDateKey = (key: string) => key.endsWith("_DATE") || key === "START_DATE";
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
        await uploadDoc([file]);
        return;
      } catch (error) {
        console.error("Failed to reuse uploaded document:", error);
        setSendError("Could not prepare the uploaded document for sending.");
      }
    }

    // Generate a simple snapshot of the document content
    let htmlContent = resolvedTemplateBaseContent || "Template Document Content";

    if (resolvedTemplateBaseContent) {
      Object.entries(formValues).forEach(([key, val]) => {
        const displayVal = isDateKey(key) ? formatDate(val) : val;
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

      await uploadDoc([file]);
      return;
    } catch (e) {
      console.error("Template snapshot failed", e);
      // Fallback: send without file url if snapshot fails
      const newDoc = {
        id: `tmp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: template.name,
        subject: activeCategory === "Reviewer" ? `Please review: ${template.name}` : `Please sign: ${template.name}`,
        recipients: (selectedRecipients.length > 0
          ? selectedRecipients
          : [{ name: "Manual", email: manualEmail, role: activeCategory === "Reviewer" ? "reviewer" : "signer" }]
        ).map((r) => ({ ...r, role: r.role || (activeCategory === "Reviewer" ? "reviewer" : "signer"), status: "pending" })),
        sender: { fullName: formValues.SENDER_NAME || "User", workEmail: formValues.SENDER_EMAIL || "user@example.com" },
        sentAt: new Date().toISOString(),
        status: activeCategory === "Reviewer" ? "reviewing" : "pending",
        category: activeCategory,
        content: htmlContent,
      };
      try {
        await persistSharedDocument(newDoc);
        setIsSent(true);
      } catch (error) {
        console.error("Failed to save fallback template document:", error);
        setSendError(error instanceof Error ? error.message : "Failed to save the document to Shared Documents.");
      } finally {
        setIsPersisting(false);
      }
      return;
    }

    setIsPersisting(false);
  };

  const stepIndex = step === "review" ? 1 : step === "recipients" ? 2 : 3;
  const stepLabel = step === "review" ? "Review Document" : step === "recipients" ? "Select Recipients" : "Confirm & Send";

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col h-screen w-screen overflow-hidden text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-8 py-4 bg-white shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => step === "review" ? onClose() : step === "recipients" ? setStep("review") : setStep("recipients")}
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
            <p className="text-xs text-slate-500 font-medium tracking-tight">Step {stepIndex}/3: {stepLabel}</p>
          </div>
        </div>
        {/* Step progress dots */}
        <div className="flex items-center gap-2 mx-auto">
          {["review", "recipients", "send"].map((s, i) => (
            <div key={s} className={`rounded-full transition-all ${stepIndex > i + 1 ? "w-6 h-2 bg-violet-600" : stepIndex === i + 1 ? "w-8 h-2 bg-violet-600" : "w-2 h-2 bg-slate-200"}`} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          {step !== "send" && (
            <button
              onClick={() => {
                if (step === "recipients" && selectedRecipients.length === 0 && !manualEmail) {
                  alert("Please select at least one recipient");
                  return;
                }
                if (step === "review") {
                  setStep("recipients");
                } else {
                  setStep("send");
                }
              }}
              disabled={step === "recipients" && selectedRecipients.length === 0 && !manualEmail}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-sm font-bold transition-all shadow-md ${step === "recipients" && selectedRecipients.length === 0 && !manualEmail ? "bg-violet-300 cursor-not-allowed" : "bg-violet-600 hover:bg-violet-700"}`}
            >
              Continue →
            </button>
          )}
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-900 transition-all shrink-0">
            <span className="text-2xl font-light">×</span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto bg-slate-50">

        {/* ── STEP 1: Review ── */}
        {step === "review" && (
          <div className="flex h-[calc(100vh-73px)] overflow-hidden bg-slate-50">
            {/* Left Sidebar: Edit Fields */}
            <div className="w-80 bg-white border-r border-slate-200 flex flex-col shrink-0">
              <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0 bg-white/50 backdrop-blur-sm sticky top-0 z-10">
                <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">Edit details</h3>
                <p className="text-xs text-slate-500 font-medium mt-1">Update placeholders</p>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar pb-24">
                {hasUploadedDocument ? (
                  <>
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
                  </>
                ) : (
                  templateFields
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
                    ))
                )}
              </div>
              <div className="p-6 border-t border-slate-100 bg-white/80 backdrop-blur-sm shrink-0 relative z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
              </div>
            </div>

            {/* Main Area: Document Preview */}
            <div className="flex-1 overflow-y-auto p-6 flex justify-center bg-slate-100/30 custom-scrollbar">
              <div className="w-full max-w-4xl h-fit">
                <p className="text-sm font-bold text-slate-700 mb-4">Live preview</p>
                <div className="bg-white rounded-2xl shadow-lg shadow-slate-200 border border-slate-200 overflow-hidden">
                  {hasUploadedDocument && template.fileDataUrl ? (
                    <div className="p-6">
                      {template.detectedText || detectedPlaceholders.length > 0 ? (
                        <div className="overflow-auto max-h-[75vh]">
                          {template.detectedText ? (
                            <div className="whitespace-pre-wrap break-words text-[15px] leading-8 text-slate-900">
                              {liveUploadedPreviewText || template.detectedText}
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {detectedPlaceholders.map((placeholder, index) => (
                                <div key={`${placeholder}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                    {placeholder}
                                  </div>
                                  <div className="mt-1 text-[15px] font-semibold text-slate-900">
                                    {placeholderValues[placeholder]?.trim() || placeholder}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : template.mimeType?.startsWith("image/") ? (
                        <img
                          src={template.fileDataUrl}
                          alt={template.name}
                          className="max-h-[75vh] w-auto max-w-full object-contain mx-auto"
                        />
                      ) : template.mimeType === "application/msword" || template.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || template.sourceFileName?.toLowerCase().endsWith(".doc") || template.sourceFileName?.toLowerCase().endsWith(".docx") ? (
                        <div className="overflow-auto max-h-[75vh]">
                          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
                            {liveUploadedPreviewText || template.detectedText || "No text content could be extracted from this Word document."}
                          </div>
                        </div>
                      ) : (
                        <iframe
                          src={template.fileDataUrl}
                          title={template.name}
                          className="h-[75vh] w-full"
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="p-6">
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-2">{template.name}</h1>
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">{template.category}</span>
                          <span className="w-1 h-1 rounded-full bg-slate-200" />
                          <span className="text-xs text-slate-400 font-bold tracking-tight">V2.1.0</span>
                        </div>
                      </div>

                      {/* Full letter content with replaced placeholders */}
                      <div className="space-y-6 text-slate-500 leading-[1.8] text-[15px] font-sans antialiased tracking-tight relative z-10 px-4 p-6" style={{ fontFamily: 'inherit' }}>
                        {(() => {
                          let filledContent = templateContent;

                          // First handle standard bold tags for safety
                          filledContent = filledContent.replace(/<strong>/g, '<span class="font-bold text-slate-500">').replace(/<\/strong>/g, '</span>');

                          Object.keys(formValues).forEach(key => {
                            const val = formValues[key] || `<span style="font-family: inherit;">[${key}]</span>`;
                            const isDateKey = (key: string) => key.endsWith("_DATE") || key === "START_DATE";
                            const displayVal = isDateKey(key) ? formatDate(val) : val;
                            filledContent = filledContent.replace(new RegExp(`\\[${key}\\]`, 'g'), `<span style="font-family: inherit;">${displayVal}</span>`);
                          });

                          // Add signature logic
                          if (savedSignature) {
                            filledContent = filledContent.replace(
                              /\[SIGNATURE\]/g,
                              `<div style="margin-top: 15px;">
                                <img src="${savedSignature}" alt="Signature" class="h-20 w-auto object-contain" style="display: block; margin-bottom: -15px;" />
                                <div style="font-weight: 800; color: #1e293b; text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; border-top: 2px solid #f1f5f9; display: inline-block; padding-top: 8px;">Signature</div>
                              </div>`
                            );
                          } else {
                            filledContent = filledContent.replace(
                              /\[SIGNATURE\]/g,
                              `<div style="margin-top: 15px;">
                                <div style="height: 80px; margin-bottom: -15px;"></div>
                                <div style="font-weight: 800; color: #1e293b; text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; border-top: 2px solid #f1f5f9; display: inline-block; padding-top: 8px;">Signature</div>
                              </div>`
                            );
                          }
                          return <div dangerouslySetInnerHTML={{ __html: filledContent.replace(/\n/g, "<br/>") }} />;
                        })()}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Select Recipients ── */}
        {step === "recipients" && (
          <div className="flex-1 flex min-h-[calc(100vh-73px)] bg-slate-50">
            {/* Left Sidebar: Categories */}
            <div className="w-80 bg-white border-r border-slate-200 flex flex-col">
              <div className="p-6 border-b border-slate-100">
                <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">Select Recipients</h3>
                <p className="text-xs text-slate-500 font-medium mt-1">Choose a category below</p>
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
                <div className="mb-4 flex gap-2">
                  <input
                    type="text"
                    placeholder="New category"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCategory();
                      }
                    }}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-violet-400 focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={addCategory}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 transition-colors hover:bg-violet-200"
                    aria-label="Add category"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
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
                  {/* Manual Entry Toggle */}
                  <button
                    onClick={() => setActiveCategory("Manual")}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group ${activeCategory === "Manual" ? "bg-violet-100 text-violet-700 shadow-sm" : "text-slate-500 hover:bg-violet-50 hover:text-violet-600"}`}
                  >
                    <span className={`text-sm font-bold ${activeCategory === "Manual" ? "text-violet-700" : "text-slate-600 group-hover:text-violet-600"}`}>Manual Entry</span>
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
        )}
        {step === "send" && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="w-full max-w-3xl mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-300">
              {isSent ? (
                <div className="px-10 py-8 text-center space-y-5">
                  <div className="flex items-center justify-center gap-4">
                    <div className="rounded-full bg-green-50 w-16 h-16 flex items-center justify-center shadow-inner shrink-0">
                      <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div className="text-left">
                      <h3 className="text-xl font-black text-green-600 tracking-tighter">{activeCategory === "Reviewer" ? "Sent for Review!" : "Sent Successfully!"}</h3>
                      <p className="text-slate-500 text-sm font-medium">{activeCategory === "Reviewer" ? "Track progress in shared document page." : "Your document has been sent. Check status in shared documents."}</p>
                    </div>
                  </div>
                  <button onClick={() => router.push("/dashboard/documents")} className="py-2.5 px-8 rounded-full bg-violet-600 text-white font-bold text-sm hover:bg-violet-800 transition-all">Go to Shared Documents</button>
                </div>
              ) : (
                <>
                  {/* Popup Header */}
                  <div className="px-8 pt-8 pb-2">
                    <h3 className="text-lg font-black text-slate-900 tracking-tight leading-tight">Confirm & Send</h3>
                    <p className="text-slate-400 text-xs font-medium mt-1">
                      Sending <span className="text-violet-600 font-bold">&ldquo;{template.name}&rdquo;</span> to {selectedRecipients.length || 1} recipient{(selectedRecipients.length > 1 || (!selectedRecipients.length && manualEmail)) ? "s" : ""}
                    </p>
                  </div>

                  {/* Popup Body — horizontal layout */}
                  <div className="px-8 py-5 flex gap-6">
                    {/* Sender Details */}
                    <div className="flex-1 space-y-2">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Sender Details</h4>
                      <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500 font-medium">Sender Name</span>
                          <span className="text-sm font-semibold text-slate-900">{formValues.SENDER_NAME || "Digimabble Sender"}</span>
                        </div>
                        <div className="border-t border-slate-100" />
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500 font-medium">Company</span>
                          <span className="text-sm font-semibold text-slate-900">{formValues.SENDER_COMPANY || "Digimabble"}</span>
                        </div>
                        <div className="border-t border-slate-100" />
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500 font-medium">Designation</span>
                          <span className="text-sm font-semibold text-slate-900">{formValues.SENDER_DESIGNATION || "HR Director"}</span>
                        </div>
                        <div className="border-t border-slate-100" />
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500 font-medium">Date</span>
                          <span className="text-sm font-semibold text-slate-900">{formatDate(formValues.CURRENT_DATE || todayISO)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Recipients */}
                    <div className="flex-1 space-y-2">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Recipients</h4>
                      <div className="space-y-2 max-h-44 overflow-y-auto custom-scrollbar">
                        {selectedRecipients.map(r => (
                          <div key={r.email} className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-xl">
                            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600 text-xs font-black shrink-0">
                              {r.name.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">{r.name}</p>
                              <p className="text-[10px] text-slate-500 font-medium truncate">{r.email}</p>
                            </div>
                          </div>
                        ))}
                        {selectedRecipients.length === 0 && manualEmail && (
                          <div className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-xl">
                            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-violet-600 text-xs font-black shrink-0">
                              ✉
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">External Contact</p>
                              <p className="text-[10px] text-slate-500 font-medium truncate">{manualEmail}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Popup Footer */}
                  <div className="px-8 pb-6 pt-1 flex gap-3">
                    <button
                      onClick={() => setStep("recipients")}
                      className="flex-1 py-3 rounded-2xl text-slate-600 font-bold text-sm hover:text-slate-900 transition-all active:scale-95"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleSend}
                      disabled={isUploadingDoc || isPersisting}
                      className="flex-[2] py-3 rounded-2xl bg-violet-600 text-white font-bold text-sm shadow-lg shadow-violet-200 hover:bg-violet-700 hover:-translate-y-0.5 transition-all active:scale-95 disabled:bg-slate-300 disabled:shadow-none flex items-center justify-center gap-2"
                    >
                      {isUploadingDoc || isPersisting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        activeCategory === "Reviewer" ? "Review" : "Send Now"
                      )}
                    </button>
                  </div>
                  {sendError && (
                    <div className="px-8 pb-6">
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                        {sendError}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div >
    </div >
  );
}

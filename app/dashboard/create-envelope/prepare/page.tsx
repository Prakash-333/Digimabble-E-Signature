/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { PenLine as Pen, Square, Calendar, User, Mail, Building2, Tag, Type, CheckSquare } from "lucide-react";
import { supabase } from "../../../lib/supabase/browser";
import { analyzeDocumentFile } from "../../../lib/document-analysis";
import { getScopedStorageItem, setScopedStorageItem } from "../../../lib/user-storage";

const DRAFT_STORAGE_KEY = "smartdocs.envelope_draft.v1";

type DraftRecipient = {
  name: string;
  email: string;
  role: "Signer" | "CC";
};

type DraftDocument = {
  id: string;
  name: string;
  source: string;
  mimeType?: string;
  sizeBytes?: number;
  dataUrl?: string;
  textContent?: string;
  placeholders?: string[];
};

type DetectedPlaceholder = {
  id: string;
  label: string;
};

type EnvelopeDraft = {
  templateId: number;
  templateName: string;
  subject: string;
  message: string;
  sender: { fullName: string; workEmail: string };
  recipients: DraftRecipient[];
  documents: DraftDocument[];
  createdAt: string;
  placeholderValues?: Record<string, string>;
};

type FieldType =
  | "signature"
  | "initial"
  | "stamp"
  | "date_signed"
  | "name"
  | "first_name"
  | "last_name"
  | "email"
  | "company"
  | "title"
  | "text"
  | "checkbox";

type FieldDef = {
  type: FieldType;
  label: string;
  icon: React.ReactNode;
};

type PlacedField = {
  id: string;
  type: FieldType;
  label: string;
  x: number;
  y: number;
  scale?: number;
  value?: string;
};

const fieldDefs: FieldDef[] = [
  { type: "signature", label: "Signature", icon: <Pen className="h-4 w-4 text-orange-500" /> },
  { type: "initial", label: "Initial", icon: <span className="font-bold text-[10px] text-blue-600">DS</span> },
  { type: "stamp", label: "Stamp", icon: <Square className="h-4 w-4 text-slate-700" /> },
  { type: "date_signed", label: "Date Signed", icon: <Calendar className="h-4 w-4 text-blue-500" /> },
  { type: "name", label: "Name", icon: <User className="h-4 w-4 text-blue-500" /> },
  { type: "first_name", label: "First Name", icon: <User className="h-4 w-4 text-blue-500" /> },
  { type: "last_name", label: "Last Name", icon: <User className="h-4 w-4 text-blue-500" /> },
  { type: "email", label: "Email Address", icon: <Mail className="h-4 w-4 text-blue-400" /> },
  { type: "company", label: "Company", icon: <Building2 className="h-4 w-4 text-slate-400" /> },
  { type: "title", label: "Title", icon: <Tag className="h-4 w-4 text-slate-400" /> },
  { type: "text", label: "Text", icon: <Type className="h-4 w-4 text-slate-400" /> },
  { type: "checkbox", label: "Checkbox", icon: <CheckSquare className="h-4 w-4 text-violet-600" /> },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizePlaceholderLabel = (raw: string, index: number) => {
  const cleaned = raw
    .replace(/[\[\]()]/g, "")
    .replace(/_{3,}/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return `Blank Field ${index + 1}`;
  }

  return cleaned;
};

const extractPlaceholdersFromText = (content: string): DetectedPlaceholder[] => {
  const matches = content.match(/\[([^\]]+)\]|\(([^)]+)\)|_{3,}/g);
  if (!matches) return [];

  const seen = new Set<string>();
  const results: DetectedPlaceholder[] = [];

  matches.forEach((item, index) => {
    const label = normalizePlaceholderLabel(item, index);
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      id: `${key}-${index}`,
      label,
    });
  });

  return results;
};

export default function PrepareEnvelopePage() {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  const [draft, setDraft] = useState<EnvelopeDraft | null>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [placedFields, setPlacedFields] = useState<PlacedField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [isSent, setIsSent] = useState(false);
  const [draggingFieldType, setDraggingFieldType] = useState<FieldType | null>(null);
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const reanalysisRequestedRef = useRef(false);

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    fieldId: string;
  } | null>(null);

  useEffect(() => {
    const loadDraft = async () => {
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user;
      if (!currentUser) {
        setUserId(null);
        return;
      }
      setUserId(currentUser.id);

      try {
        const raw = getScopedStorageItem(DRAFT_STORAGE_KEY, currentUser.id);
        if (!raw) {
          setDraft(null);
          return;
        }
        const parsed = JSON.parse(raw) as EnvelopeDraft;
        if (!parsed?.sender?.workEmail || !Array.isArray(parsed.documents)) {
          setDraft(null);
          return;
        }
        setDraft(parsed);
        if (parsed.placeholderValues && typeof parsed.placeholderValues === "object") {
          setPlaceholderValues(parsed.placeholderValues);
        }
      } catch {
        setDraft(null);
      }
    };

    loadDraft();
  }, []);

  useEffect(() => {
    if (!draft || userId === undefined) return;
    try {
      setScopedStorageItem(
        DRAFT_STORAGE_KEY,
        userId,
        JSON.stringify({
          ...draft,
          placeholderValues,
        })
      );
    } catch {
      // Ignore storage failures.
    }
  }, [draft, placeholderValues, userId]);

  useEffect(() => {
    const primary = draft?.documents[0];
    if (!primary?.dataUrl || primary.textContent || reanalysisRequestedRef.current) return;

    let cancelled = false;
    reanalysisRequestedRef.current = true;
    setIsReanalyzing(true);

    const run = async () => {
      try {
        const response = await fetch(primary.dataUrl as string);
        const blob = await response.blob();
        const mimeType = primary.mimeType || blob.type || "application/octet-stream";
        const extension = mimeType === "application/pdf"
          ? "pdf"
          : mimeType.startsWith("image/")
            ? mimeType.split("/")[1] || "png"
            : (primary.name.split(".").pop() || "bin");
        const file = new File([blob], primary.name || `document.${extension}`, { type: mimeType });
        const analysis = await analyzeDocumentFile(file);

        if (cancelled) return;

        setDraft((prev) => {
          if (!prev) return prev;
          const nextDocuments = prev.documents.map((doc, index) =>
            index === 0
              ? {
                  ...doc,
                  mimeType,
                  dataUrl: analysis.dataUrl || doc.dataUrl,
                  textContent: analysis.textContent,
                  placeholders: analysis.placeholders,
                }
              : doc
          );
          return {
            ...prev,
            documents: nextDocuments,
          };
        });
      } catch (error) {
        console.error("Failed to re-analyze document:", error);
      } finally {
        if (!cancelled) {
          setIsReanalyzing(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [draft]);

  useEffect(() => {
    const loadSignature = async () => {
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user;
      if (!currentUser) return;

      const { data: row } = await supabase
        .from("signatures")
        .select("data_url")
        .eq("owner_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (row?.data_url) {
        setSavedSignature(row.data_url);
      }
    };

    loadSignature();
  }, []);

  const docTitle = useMemo(() => {
    if (!draft) return "Document";
    const first = draft.documents[0];
    if (first?.name) return first.name;
    return `${draft.templateName} (draft)`;
  }, [draft]);

  const signer = useMemo(() => {
    if (!draft) return null;
    return (
      draft.recipients.find((r) => r.role === "Signer") ??
      draft.recipients[0] ??
      null
    );
  }, [draft]);

  const primaryDocument = draft?.documents[0] ?? null;
  const detectedPlaceholders = useMemo(() => {
    if (!primaryDocument) return [];
    if (primaryDocument.placeholders?.length) {
      return primaryDocument.placeholders.map((placeholder, index) => ({
        id: `${placeholder.toLowerCase()}-${index}`,
        label: placeholder,
      }));
    }
    if (primaryDocument.textContent) {
      return extractPlaceholdersFromText(primaryDocument.textContent);
    }
    return [];
  }, [primaryDocument]);
  useEffect(() => {
    setPlaceholderValues((prev) => {
      const next = { ...prev };
      detectedPlaceholders.forEach((placeholder) => {
        if (!(placeholder.id in next)) {
          next[placeholder.id] = "";
        }
      });
      return next;
    });
  }, [detectedPlaceholders]);

  const livePreviewText = useMemo(() => {
    if (!primaryDocument?.textContent) return "";

    let output = primaryDocument.textContent;
    detectedPlaceholders.forEach((placeholder) => {
      const value = placeholderValues[placeholder.id]?.trim();
      if (!value) return;

      const escaped = escapeRegExp(placeholder.label);
      const patterns = [
        new RegExp(`\\[\\s*${escaped}\\s*\\]`, "gi"),
        new RegExp(`\\(\\s*${escaped}\\s*\\)`, "gi"),
      ];

      patterns.forEach((pattern) => {
        output = output.replace(pattern, value);
      });
    });

    return output;
  }, [detectedPlaceholders, placeholderValues, primaryDocument?.textContent]);

  const isPdfDocument =
    primaryDocument?.mimeType === "application/pdf" ||
    primaryDocument?.name?.toLowerCase().endsWith(".pdf");
  const isImageDocument =
    typeof primaryDocument?.mimeType === "string" &&
    primaryDocument.mimeType.startsWith("image/");

  const signerName = signer?.name?.trim() || "";
  const signerEmail = signer?.email?.trim() || "";
  const firstName = signerName ? signerName.split(/\s+/)[0] : "";
  const lastName = signerName
    ? signerName.split(/\s+/).slice(1).join(" ")
    : "";
  const initials = signerName
    ? signerName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("")
    : "DS";

  const todayLabel = useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  }, []);

  const fieldSize = (type: FieldType) => {
    switch (type) {
      case "signature":
        return { w: 170, h: 56 };
      case "initial":
        return { w: 84, h: 40 };
      case "stamp":
        return { w: 120, h: 44 };
      case "date_signed":
        return { w: 120, h: 40 };
      case "checkbox":
        return { w: 44, h: 44 };
      default:
        return { w: 150, h: 40 };
    }
  };

  const renderFieldValue = (field: PlacedField) => {
    switch (field.type) {
      case "signature":
        return savedSignature ? (
          <img
            src={savedSignature}
            alt="Signature"
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <span className="text-[11px] font-semibold text-slate-700">
            (No signature)
          </span>
        );
      case "initial":
        return (
          <span className="text-sm font-semibold text-slate-800">
            {initials}
          </span>
        );
      case "stamp":
        return (
          <span className="text-[11px] font-semibold tracking-[0.18em] text-slate-700">
            STAMP
          </span>
        );
      case "date_signed":
        return (
          <span className="text-[11px] font-semibold text-slate-800">
            {todayLabel}
          </span>
        );
      case "name":
        return (
          <input
            className="w-full text-[11px] font-semibold text-slate-800 bg-transparent outline-none border-none text-center"
            value={field.value ?? signerName}
            onChange={(e) => {
              setPlacedFields((prev) =>
                prev.map((f) => f.id === field.id ? { ...f, value: e.target.value } : f)
              );
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="Signer name"
          />
        );
      case "first_name":
        return (
          <span className="text-[11px] font-semibold text-slate-800">
            {firstName || "First name"}
          </span>
        );
      case "last_name":
        return (
          <span className="text-[11px] font-semibold text-slate-800">
            {lastName || "Last name"}
          </span>
        );
      case "email":
        return (
          <span className="text-[11px] font-semibold text-slate-800">
            {signerEmail || "email@example.com"}
          </span>
        );
      case "company":
        return (
          <span className="text-[11px] font-semibold text-slate-800">
            SmartDocs
          </span>
        );
      case "title":
        return (
          <span className="text-[11px] font-semibold text-slate-800">
            Signer
          </span>
        );
      case "text":
        return (
          <span className="text-[11px] font-semibold text-slate-800">
            Text
          </span>
        );
      case "checkbox":
        return (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-slate-400 bg-white" />
        );
      default:
        return (
          <span className="text-[11px] font-semibold text-slate-800">
            {field.label}
          </span>
        );
    }
  };

  const onDragStartField = (event: React.DragEvent, def: FieldDef) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-smartdocs-field", JSON.stringify(def));
    event.dataTransfer.setData("text/plain", def.label);
    setDraggingFieldType(def.type);

    // Create transparent drag image
    const dragImage = document.createElement("div");
    dragImage.textContent = def.label;
    dragImage.style.position = "absolute";
    dragImage.style.top = "-1000px";
    dragImage.style.padding = "10px 16px";
    dragImage.style.background = "rgba(139, 92, 246, 0.2)";
    dragImage.style.border = "1px solid rgba(139, 92, 246, 0.5)";
    dragImage.style.borderRadius = "12px";
    dragImage.style.color = "#4c1d95";
    dragImage.style.fontSize = "14px";
    dragImage.style.fontWeight = "600";
    dragImage.style.whiteSpace = "nowrap";
    dragImage.style.pointerEvents = "none";
    dragImage.style.backdropFilter = "blur(4px)";
    document.body.appendChild(dragImage);
    event.dataTransfer.setDragImage(dragImage, 0, 0);

    // Clean up the drag image element after drag
    setTimeout(() => {
      document.body.removeChild(dragImage);
    }, 0);
  };

  const onDropOnPage = (event: React.DragEvent) => {
    event.preventDefault();
    const pageEl = pageRef.current;
    if (!pageEl) return;

    let def: FieldDef | null = null;
    try {
      const raw = event.dataTransfer.getData("application/x-smartdocs-field");
      def = raw ? (JSON.parse(raw) as FieldDef) : null;
    } catch {
      def = null;
    }
    if (!def) return;

    const rect = pageEl.getBoundingClientRect();
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
    const { w, h } = fieldSize(def.type);

    const next: PlacedField = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: def.type,
      label: def.label,
      x: clamp(Math.round(x), 0, Math.round(rect.width / zoom) - w),
      y: clamp(Math.round(y), 0, Math.round(rect.height / zoom) - h),
      scale: 1,
      value: def.type === "name" ? signerName : undefined,
    };

    setPlacedFields((prev) => [next, ...prev]);
    setSelectedFieldId(next.id);
  };

  const beginMoveField = (event: React.PointerEvent, fieldId: string) => {
    const pageEl = pageRef.current;
    if (!pageEl) return;
    const field = placedFields.find((f) => f.id === fieldId);
    if (!field) return;
    setSelectedFieldId(fieldId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: field.x,
      startY: field.y,
      fieldId,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveField = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.pointerId !== event.pointerId) return;
    const pageEl = pageRef.current;
    if (!pageEl) return;
    const rect = pageEl.getBoundingClientRect();
    const movedField = placedFields.find((f) => f.id === drag.fieldId);
    const { w, h } = fieldSize(movedField?.type ?? "text");
    const maxX = Math.max(0, Math.round(rect.width / zoom) - w);
    const maxY = Math.max(0, Math.round(rect.height / zoom) - h);

    const dx = (event.clientX - drag.startClientX) / zoom;
    const dy = (event.clientY - drag.startClientY) / zoom;

    const nextX = clamp(Math.round(drag.startX + dx), 0, maxX);
    const nextY = clamp(Math.round(drag.startY + dy), 0, maxY);

    setPlacedFields((prev) =>
      prev.map((f) => (f.id === drag.fieldId ? { ...f, x: nextX, y: nextY } : f))
    );
  };

  const endMoveField = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
  };

  const removeSelected = () => {
    if (!selectedFieldId) return;
    setPlacedFields((prev) => prev.filter((f) => f.id !== selectedFieldId));
    setSelectedFieldId(null);
  };

  const finish = async () => {
    if (!userId) {
      setBanner("Please sign in again before sending.");
      return;
    }

    try {
      const newDoc = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: draft?.documents[0]?.name || "Document.pdf",
        subject: draft?.subject || "Please review and sign",
        recipients: draft?.recipients || [],
        sender: draft?.sender || {},
        sentAt: new Date().toISOString(),
        status: "sent",
      };

      const { error } = await supabase.from("documents").insert({
        owner_id: userId,
        name: newDoc.name,
        subject: newDoc.subject,
        recipients: newDoc.recipients,
        sender: newDoc.sender,
        sent_at: newDoc.sentAt,
        status: newDoc.status,
        file_url: draft?.documents[0]?.dataUrl ?? null,
        file_key: null,
        category: null,
        content: null,
      });

      if (error) throw error;
      setIsSent(true);
      setBanner("Envelope sent successfully!");
    } catch (e) {
      console.error("Failed to save document:", e);
      setBanner("Failed to send envelope.");
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-57px)] flex-col">
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-[#1b083f] px-4 py-3 text-white md:px-6">
        <p className="text-sm font-medium">
          Drag and drop fields from the left panel onto the document
        </p>
        <div className="flex items-center gap-2">
          {isSent ? (
            <div className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white">
              <span className="text-lg">✓</span>
              <span className="text-sm font-semibold">Sent</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="rounded-lg border border-violet-400 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-600 transition-all active:scale-95 shadow-sm"
                onClick={finish}
              >
                Send
              </button>
              <button
                type="button"
                className="rounded-lg bg-white/10 px-2 py-1.5 text-sm font-semibold hover:bg-white/15"
                onClick={() => setBanner(null)}
                aria-label="Options"
              >
                ▾
              </button>
              <button
                type="button"
                className="rounded-lg bg-white/10 px-2 py-1.5 text-sm font-semibold hover:bg-white/15"
                aria-label="More"
                onClick={() => setBanner("More options (demo).")}
              >
                ⋮
              </button>
            </>
          )}
        </div>
      </div>

      {banner && (
        <div className="border-b border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 md:px-6">
          {banner}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden bg-slate-100" style={{ height: 'calc(100vh - 57px)' }}>
        {/* Left: Fields - Always visible sidebar */}
        <aside className="w-72 flex-shrink-0 border-r border-slate-200 bg-white overflow-y-auto h-full">
          <div className="px-6 py-5">
            <p className="text-xs font-semibold tracking-[0.18em] text-slate-700">
              FIELDS
            </p>
          </div>
          <div className="space-y-6 px-4 pb-6 text-sm">
            <div className="space-y-3 rounded-3xl border border-violet-100 bg-violet-50/50 p-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-700">
                  Detected placeholders
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  We pulled these from the uploaded file.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {detectedPlaceholders.length > 0 ? (
                  detectedPlaceholders.map((placeholder) => (
                    <div
                      key={placeholder.id}
                      className="space-y-1 rounded-2xl border border-violet-100 bg-white p-3 shadow-sm"
                    >
                      <label className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">
                        {placeholder.label}
                      </label>
                      <input
                        value={placeholderValues[placeholder.id] ?? ""}
                        onChange={(e) =>
                          setPlaceholderValues((prev) => ({
                            ...prev,
                            [placeholder.id]: e.target.value,
                          }))
                        }
                        placeholder={`Edit ${placeholder.label}`}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-900 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-50"
                      />
                    </div>
                  ))
                ) : (
                  <span className="text-[11px] font-medium text-slate-500">
                    No placeholders detected yet.
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-200 pt-4">
              {fieldDefs.slice(0, 4).map((def) => (
                <div
                  key={def.type}
                  draggable
                  onDragStart={(e) => onDragStartField(e, def)}
                  onDragEnd={() => setDraggingFieldType(null)}
                  className={`flex cursor-grab items-center gap-3 rounded-xl px-3 py-2 text-slate-700 hover:bg-slate-50 active:cursor-grabbing ${draggingFieldType === def.type ? "opacity-50 bg-transparent" : "bg-transparent"}`}
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-700">
                    {def.icon}
                  </span>
                  <span>{def.label}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t border-slate-200 pt-4">
              {fieldDefs.slice(4, 10).map((def) => (
                <div
                  key={def.type}
                  draggable
                  onDragStart={(e) => onDragStartField(e, def)}
                  onDragEnd={() => setDraggingFieldType(null)}
                  className={`flex cursor-grab items-center gap-3 rounded-xl px-3 py-2 text-slate-700 hover:bg-slate-50 active:cursor-grabbing ${draggingFieldType === def.type ? "opacity-50 bg-transparent" : "bg-transparent"}`}
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-700">
                    {def.icon}
                  </span>
                  <span>{def.label}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t border-slate-200 pt-4">
              {fieldDefs.slice(10).map((def) => (
                <div
                  key={def.type}
                  draggable
                  onDragStart={(e) => onDragStartField(e, def)}
                  onDragEnd={() => setDraggingFieldType(null)}
                  className={`flex cursor-grab items-center gap-3 rounded-xl px-3 py-2 text-slate-700 hover:bg-slate-50 active:cursor-grabbing ${draggingFieldType === def.type ? "opacity-50 bg-transparent" : "bg-transparent"}`}
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-50 border border-slate-100 shadow-sm transition-all group-hover:bg-white group-hover:border-slate-200">
                    {typeof def.icon === "string" ? (
                      <span className="text-xs font-semibold text-slate-700">{def.icon}</span>
                    ) : (
                      def.icon
                    )}
                  </span>
                  <span>{def.label}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Center: Document */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 text-xs md:px-6">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{docTitle}</p>
              <p className="truncate text-slate-500">
                {draft ? `${draft.sender.workEmail} · ${draft.recipients.length} recipient(s)` : "Draft not found"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setZoom((z) => clamp(Number((z - 0.1).toFixed(2)), 0.6, 1.6))}
              >
                −
              </button>
              <span className="min-w-[48px] text-center text-[11px] font-semibold text-slate-700">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setZoom((z) => clamp(Number((z + 0.1).toFixed(2)), 0.6, 1.6))}
              >
                +
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setPlacedFields([]);
                  setSelectedFieldId(null);
                  setBanner(null);
                }}
              >
                Clear fields
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 md:p-8">
            {!draft ? (
              <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
                <p className="text-base font-semibold text-slate-900">
                  No draft found
                </p>
                <p className="mt-2 text-slate-600">
                  Go back to Get Signature and click Send again.
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <Link
                    href="/dashboard/create-envelope"
                    className="rounded-full border border-violet-600 bg-white px-4 py-2 text-xs font-semibold text-violet-600 shadow-sm hover:bg-violet-600 hover:text-white transition-all active:scale-95"
                  >
                    Back
                  </Link>
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-4xl">
                <div
                  ref={pageRef}
                  className="relative mx-auto aspect-[8.5/11] w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={onDropOnPage}
                  onPointerMove={moveField}
                  onPointerUp={endMoveField}
                  onPointerCancel={endMoveField}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) setSelectedFieldId(null);
                  }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                      width: `${100 / zoom}%`,
                      height: `${100 / zoom}%`,
                    }}
                  >
                    {draft!.documents[0]?.dataUrl ? (
                      <div className="flex h-full w-full items-center justify-center bg-slate-50 p-4">
                        {primaryDocument?.textContent || detectedPlaceholders.length > 0 ? (
                          <div className="flex h-full w-full items-center justify-center rounded-lg border border-slate-200 bg-white p-6 shadow-md">
                            <div className="h-full w-full max-w-3xl overflow-auto rounded-2xl border border-slate-100 bg-white p-8">
                              <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-violet-600">
                                    Live Preview
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    Updates as you edit placeholders on the left.
                                  </p>
                                </div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                  {draft!.documents[0].name}
                                </p>
                              </div>
                              {primaryDocument?.textContent ? (
                                <div className="whitespace-pre-wrap break-words text-[15px] leading-8 text-slate-900">
                                  {livePreviewText || primaryDocument.textContent}
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  {detectedPlaceholders.map((placeholder) => (
                                    <div key={placeholder.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                        {placeholder.label}
                                      </div>
                                      <div className="mt-1 text-[15px] font-semibold text-slate-900">
                                        {placeholderValues[placeholder.id]?.trim() || placeholder.label}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : isReanalyzing ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-md">
                            Rebuilding live preview from the uploaded file...
                          </div>
                        ) : isPdfDocument ? (
                          <object
                            data={draft!.documents[0].dataUrl}
                            type="application/pdf"
                            className="h-full w-full rounded-lg border border-slate-200 bg-white shadow-md"
                            aria-label="Uploaded PDF"
                          >
                            <iframe
                              src={draft!.documents[0].dataUrl}
                              className="h-full w-full rounded-lg border border-slate-200 bg-white shadow-md"
                              title="Uploaded PDF"
                            />
                          </object>
                        ) : isImageDocument ? (
                          <img
                            src={draft!.documents[0].dataUrl}
                            alt="Uploaded document"
                            className="max-h-full max-w-full object-contain shadow-md"
                          />
                        ) : (
                          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
                            Preview not available for this file type.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-10">
                        <p className="text-xs font-semibold tracking-[0.18em] text-slate-400">
                          {draft!.templateName.toUpperCase()}
                        </p>
                        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                          {draft!.subject || "Please review and sign"}
                        </h2>
                        <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600">
                          {draft!.message || "Drag fields onto the document to prepare for signature."}
                        </p>
                        <div className="mt-8 h-px w-full bg-slate-200" />
                        <p className="mt-6 text-sm text-slate-600">
                          Recipients:{" "}
                          <span className="font-semibold text-slate-900">
                            {draft!.recipients
                              .filter((r) => r.role === "Signer")
                              .map((r) => r.name || r.email)
                              .join(", ") || "Signer"}
                          </span>
                        </p>
                        <p className="mt-2 text-xs text-slate-400">
                          (Demo page content)
                        </p>
                      </div>
                    )}

                    {placedFields.map((field) => {
                      const isSelected = field.id === selectedFieldId;
                      const { w, h } = fieldSize(field.type);
                      return (
                        <div
                          key={field.id}
                          className={
                            "absolute rounded border group " +
                            (isSelected
                              ? "ring-2 ring-violet-400/30 border-violet-500 bg-transparent"
                              : "border-dotted border-slate-400 bg-transparent hover:border-slate-500")
                          }
                          style={{ 
                            left: field.x, 
                            top: field.y, 
                            width: w, 
                            height: h,
                            transform: `scale(${field.scale || 1})`,
                            transformOrigin: "top left"
                          }}
                          onPointerDown={(e) => beginMoveField(e, field.id)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded px-2 py-1">
                            {renderFieldValue(field)}
                            {isSelected && (
                              <>
                                <button
                                  type="button"
                                  className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] text-white shadow-lg hover:bg-black transition-transform active:scale-90 z-40"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeSelected();
                                  }}
                                  aria-label="Remove field"
                                >
                                  ✕
                                </button>
                                
                                {/* Corner Resize Handle */}
                                <div 
                                  className="absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-full border-2 border-violet-600 bg-white shadow-sm z-40"
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    const startX = e.clientX;
                                    const startScale = field.scale || 1;
                                    
                                    const onPointerMove = (moveEvent: PointerEvent) => {
                                      const deltaX = moveEvent.clientX - startX;
                                      // Sensitivity: 150px movement = 1.0 scale change
                                      const newScale = clamp(startScale + deltaX / 150, 0.5, 3);
                                      setPlacedFields((prev) => 
                                        prev.map((f) => f.id === field.id ? { ...f, scale: newScale } : f)
                                      );
                                    };
                                    
                                    const onPointerUp = () => {
                                      window.removeEventListener("pointermove", onPointerMove);
                                      window.removeEventListener("pointerup", onPointerUp);
                                    };
                                    
                                    window.addEventListener("pointermove", onPointerMove);
                                    window.addEventListener("pointerup", onPointerUp);
                                  }}
                                />

                                {/* Resize slider for selected field (kept as alternative) */}
                                <div 
                                  className="absolute -bottom-10 left-0 w-32 bg-white rounded-lg border border-slate-200 p-2 shadow-xl flex items-center gap-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">Size</span>
                                  <input 
                                    type="range" 
                                    min="0.5" 
                                    max="3" 
                                    step="0.1" 
                                    value={field.scale || 1} 
                                    onChange={(e) => {
                                      const newScale = parseFloat(e.target.value);
                                      setPlacedFields((prev) => 
                                        prev.map((f) => f.id === field.id ? { ...f, scale: newScale } : f)
                                      );
                                    }}
                                    className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-violet-600"
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <p className="truncate">
                    {draft!.documents[0]?.name ?? "document"} ·{" "}
                    {draft!.documents.length} file(s)
                  </p>
                  <p>1 of {draft!.documents.length}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Toolbar */}
        <aside className="hidden w-16 shrink-0 border-l border-slate-200 bg-white md:block">
          <div className="flex h-full flex-col items-center gap-5 py-6 text-[11px] text-slate-600">
            {[
              { label: "Summarize", icon: "✦", onClick: () => setBanner("Summarize (demo).") },
              { label: "Search", icon: "🔎", onClick: () => setBanner("Search (demo).") },
              { label: "View Pages", icon: "▦", onClick: () => setBanner("Pages: 1 (demo).") },
              { label: "Comment", icon: "💬", onClick: () => setBanner("Comments (demo).") },
              { label: "Download", icon: "⬇", onClick: () => setBanner("Download (demo).") },
              { label: "Print", icon: "🖨", onClick: () => setBanner("Print (demo).") },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                className="flex w-12 flex-col items-center gap-2 rounded-xl px-1 py-2 hover:bg-slate-50"
                onClick={item.onClick}
              >
                <span className="text-base">{item.icon}</span>
                <span className="text-center leading-tight">{item.label}</span>
              </button>
            ))}
            <div className="mt-auto flex flex-col items-center gap-2 text-xs font-semibold text-slate-700">
              <span>{Math.round(zoom * 100)}%</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

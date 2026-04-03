"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { templates } from "../templates/data";
import { RotateCw, CloudUpload, Monitor, FileText, Cloud } from "lucide-react";
import {
  analyzeDocumentFile,
} from "../../lib/document-analysis";
import { supabase } from "../../lib/supabase/browser";
import { getScopedStorageItem } from "../../lib/user-storage";

type SignMethod = "template" | "photo";

type EnvelopeRecipient = {
  name: string;
  email: string;
  role: "Signer" | "CC";
};

type EnvelopeDocumentSource =
  | "Desktop"
  | "Template"
  | "Box"
  | "Dropbox"
  | "Google Drive"
  | "OneDrive";

type EnvelopeDocument = {
  id: string;
  name: string;
  source: EnvelopeDocumentSource;
  mimeType?: string;
  sizeBytes?: number;
  dataUrl?: string;
  textContent?: string;
  placeholders?: string[];
};

const emptyRecipient: EnvelopeRecipient = {
  name: "",
  email: "",
  role: "Signer",
};

const formatBytes = (bytes?: number) => {
  if (!bytes) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const PROFILE_STORAGE_KEY = "smartdocs.profile.v1";

type Profile = {
  fullName: string;
  workEmail: string;
};

function CreateEnvelopeContent() {
  const searchParams = useSearchParams();
  const requestedTemplateId = Number(searchParams.get("template"));
  const initialTemplateId =
    templates.some((tpl) => tpl.id === requestedTemplateId)
      ? requestedTemplateId
      : templates[0]?.id || 1;
  const [templateId, setTemplateId] = useState<number>(initialTemplateId);
  const [subject, setSubject] = useState("Please review and sign");
  const [message, setMessage] = useState(
    "Hi, please review the document and sign when ready. Thanks."
  );
  const [uploadedDocuments, setUploadedDocuments] = useState<EnvelopeDocument[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const [sender, setSender] = useState<Profile>({
    fullName: "Raj Kumar",
    workEmail: "raj@smartdocs.in",
  });
  const [recipients, setRecipients] = useState<EnvelopeRecipient[]>([
    { name: "Priya Sharma", email: "priya@nimbuscrm.demo", role: "Signer" },
    { name: "Raj Kumar", email: "raj@smartdocs.in", role: "CC" },
  ]);
  const [banner, setBanner] = useState<string | null>(null);
  const [signMethod, setSignMethod] = useState<SignMethod>("template");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => templates.find((tpl) => tpl.id === templateId) ?? templates[0],
    [templateId]
  );

  const documents = useMemo(() => {
    if (signMethod === "template" && selected) {
      return [
        {
          id: `template-${selected.id}`,
          name: `${selected.name}.pdf`,
          source: "Template" as EnvelopeDocumentSource,
        },
        ...uploadedDocuments,
      ];
    }
    return uploadedDocuments;
  }, [signMethod, selected, uploadedDocuments]);

  useEffect(() => {
    const loadProfile = async () => {
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user;

      try {
        const raw = getScopedStorageItem(PROFILE_STORAGE_KEY, currentUser?.id);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<Profile>;
        const workEmail =
          typeof parsed.workEmail === "string" && parsed.workEmail.trim()
            ? parsed.workEmail
            : null;
        if (workEmail) {
          setSender((prev) => ({
            fullName:
              typeof parsed.fullName === "string" && parsed.fullName.trim()
                ? parsed.fullName
                : prev.fullName,
            workEmail,
          }));
        }
      } catch {
        // Ignore invalid stored values.
      }
    };

    void loadProfile();
  }, []);

  useEffect(() => {
    if (!isUploadMenuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const el = uploadMenuRef.current;
      if (!el) return;
      if (event.target instanceof Node && !el.contains(event.target)) {
        setIsUploadMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [isUploadMenuOpen]);

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const addFiles = async (files: FileList, source: EnvelopeDocumentSource) => {
    await Promise.all(
      Array.from(files).map(async (file) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const newDoc: EnvelopeDocument = {
          id,
          name: file.name,
          source,
          mimeType: file.type,
          sizeBytes: file.size,
        };

        try {
          const analysis = await analyzeDocumentFile(file);
          newDoc.dataUrl = analysis.dataUrl;
          newDoc.textContent = analysis.textContent;
          newDoc.placeholders = analysis.placeholders;
        } catch (error) {
          console.error("Failed to prepare uploaded file:", error);
          newDoc.dataUrl = await readFileAsDataUrl(file);
        }

        setUploadedDocuments((prev) => [newDoc, ...prev]);
      })
    );
  };

  const addTemplateDocument = () => {
    if (!selected) return;
    setUploadedDocuments((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: `${selected.name}.pdf`,
        source: "Template",
      },
      ...prev,
    ]);
  };

  const addRecipient = () => setRecipients((prev) => [...prev, emptyRecipient]);

  const updateRecipient = (
    index: number,
    patch: Partial<EnvelopeRecipient>
  ) => {
    setRecipients((prev) =>
      prev.map((recipient, i) =>
        i === index ? { ...recipient, ...patch } : recipient
      )
    );
  };

  const removeRecipient = (index: number) =>
    setRecipients((prev) => prev.filter((_, i) => i !== index));

  return (
    <div className="px-4 pb-10 pt-2 md:px-8 md:pt-4">
      {banner && (
        <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 shadow-sm">
          {banner}
        </div>
      )}
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 md:flex-row md:items-start md:justify-between">
            <div className="flex w-full flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex-1">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Get Sign</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Choose how you want to sign a document.
                </p>
              </div>
              <Link
                href="/dashboard/templates"
                className="inline-flex shrink-0 items-center justify-center rounded-full border border-violet-600 bg-white px-5 py-2.5 text-xs font-semibold !text-violet-600 shadow-sm transition-all hover:bg-violet-600 hover:!text-white active:scale-95"
              >
                Browse template
              </Link>
            </div>
          </div>

          {/* Sign Method Selection */}
          <div className="grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setSignMethod("template")}
              className={`rounded-2xl border-2 p-6 text-left transition-all ${signMethod === "template"
                ? "border-violet-600 bg-violet-50"
                : "border-slate-200 bg-white hover:border-violet-300"
                }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-violet-600 mb-3">
                <CloudUpload className="h-6 w-6" />
              </div>
              <h3 className="font-semibold text-slate-900">Send with Template</h3>
              <p className="mt-1 text-sm text-slate-600">
                Use a pre-made template to send documents for signature.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setSignMethod("photo")}
              className={`rounded-2xl border-2 p-6 text-left transition-all ${signMethod === "photo"
                ? "border-violet-600 bg-violet-50"
                : "border-slate-200 bg-white hover:border-violet-300"
                }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-violet-600 mb-3">
                <RotateCw className="h-6 w-6" />
              </div>
              <h3 className="font-semibold text-slate-900">Upload PDF or Image</h3>
              <p className="mt-1 text-sm text-slate-600">
                Upload a PDF or image and send it for signature.
              </p>
            </button>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">From</label>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                <span className="font-semibold">{sender.fullName}</span>
                <span className="text-slate-600"> · {sender.workEmail}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Update from Settings.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                Envelope name
              </label>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[color:var(--color-brand-primary)] focus:ring-2 focus:ring-blue-100"
                defaultValue={selected ? `${selected.name} envelope` : "New envelope"}
              />
            </div>
          </div>

          {signMethod !== "template" && (
            <>
              <div className="flex items-center justify-between pt-4">
                <p className="text-xs font-semibold tracking-[0.18em] text-slate-700">
                  ADD DOCUMENTS
                </p>
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                  onClick={() => setUploadedDocuments([])}
                >
                  Clear
                </button>
              </div>
            </>
          )}

          {signMethod !== "template" && (
            <div
              className={
                "rounded-2xl border border-dashed bg-white px-6 py-10 text-center " +
                (isDragActive
                  ? "border-violet-500 bg-violet-50"
                  : "border-slate-300")
              }
              onDragEnter={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragActive(false);
                if (event.dataTransfer?.files?.length) {
                  addFiles(event.dataTransfer.files, "Desktop");
                }
              }}
            >
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 shadow-sm">
                <CloudUpload className="h-5 w-5 text-violet-600" />
              </div>
              <p className="mt-4 text-sm font-semibold text-slate-900">
                Drop your files here or
              </p>

              <div className="mt-4 flex items-center justify-center">
                <div className="relative" ref={uploadMenuRef}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2 text-xs font-semibold !text-white shadow-sm hover:bg-violet-700 transition-all active:scale-95 active:bg-violet-700"
                      onClick={() => setIsUploadMenuOpen((v) => !v)}
                    >
                      <span className="!text-white">Add files</span>
                      <span className="text-[10px] opacity-90 transition-transform group-hover:rotate-180">▼</span>
                    </button>

                  {isUploadMenuOpen && (
                    <div className="absolute left-1/2 z-10 mt-3 w-56 -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-800 hover:bg-slate-50"
                        onClick={() => {
                          setIsUploadMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                      >
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                        <Monitor className="h-4 w-4" />
                      </span>
                      PDF or images
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-800 hover:bg-slate-50"
                        onClick={() => {
                          setIsUploadMenuOpen(false);
                          addTemplateDocument();
                          setBanner("Added document from template (demo).");
                        }}
                      >
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                        <FileText className="h-4 w-4" />
                      </span>
                      Use a template
                      </button>

                      <div className="border-t border-slate-200" />

                      {(["Box", "Dropbox", "Google Drive", "OneDrive"] as const).map(
                        (label) => (
                          <button
                            key={label}
                            type="button"
                            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-800 hover:bg-slate-50"
                            onClick={() => {
                              setIsUploadMenuOpen(false);
                              setBanner(`${label} upload is not available in this demo.`);
                            }}
                          >
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                            <Cloud className="h-4 w-4" />
                          </span>
                            {label}
                          </button>
                        )
                      )}
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files?.length) {
                        addFiles(event.target.files, "Desktop");
                        event.target.value = "";
                        setBanner("Added PDF or image files from your device.");
                      }
                    }}
                  />
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                PDF and image files only. Demo only, files stay in your browser.
              </p>
            </div>
          )}

          {documents.length > 0 && (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {doc.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {doc.source} · {formatBytes(doc.sizeBytes)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    onClick={() =>
                      setUploadedDocuments((prev) => prev.filter((d) => d.id !== doc.id))
                    }
                    aria-label="Remove document"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {signMethod === "template" && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Template
                </label>
                <select
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[color:var(--color-brand-primary)] focus:ring-2 focus:ring-blue-100"
                  value={templateId}
                  onChange={(e) => setTemplateId(Number(e.target.value))}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={`space-y-1 ${signMethod === 'photo' ? 'col-span-2' : ''}`}>
              <label className="text-xs font-semibold text-slate-700">
                Subject
              </label>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[color:var(--color-brand-primary)] focus:ring-2 focus:ring-blue-100"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Message
            </label>
            <textarea
              className="min-h-[96px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[color:var(--color-brand-primary)] focus:ring-2 focus:ring-blue-100"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-[0.18em] text-slate-700">
              RECIPIENTS
            </p>
            <button
              type="button"
              className="rounded-full bg-white border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors active:bg-violet-600 active:text-white"
              onClick={addRecipient}
            >
              + Add recipient
            </button>
          </div>

          <div className="space-y-3">
            {recipients.map((recipient, idx) => (
              <div
                key={`${recipient.email}-${idx}`}
                className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_44px]"
              >
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">
                    Name
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[color:var(--color-brand-primary)] focus:ring-2 focus:ring-blue-100"
                    value={recipient.name}
                    onChange={(e) =>
                      updateRecipient(idx, { name: e.target.value })
                    }
                    placeholder="Full name"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">
                    Email
                  </label>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[color:var(--color-brand-primary)] focus:ring-2 focus:ring-blue-100"
                    value={recipient.email}
                    onChange={(e) =>
                      updateRecipient(idx, { email: e.target.value })
                    }
                    placeholder="name@company.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">
                    Role
                  </label>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[color:var(--color-brand-primary)] focus:ring-2 focus:ring-blue-100"
                    value={recipient.role}
                    onChange={(e) =>
                      updateRecipient(idx, {
                        role: e.target.value as EnvelopeRecipient["role"],
                      })
                    }
                  >
                    <option value="Signer">Signer</option>
                    <option value="CC">CC</option>
                  </select>
                </div>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    onClick={() => removeRecipient(idx)}
                    aria-label="Remove recipient"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-4">
                <Link
                  href={`/dashboard/create-envelope?template=${selected.id}`}
                  className="inline-flex min-w-[108px] shrink-0 items-center justify-center rounded-full bg-violet-600 px-5 py-2 text-xs font-semibold !text-white shadow-md hover:bg-violet-700 transition-all active:scale-95"
                >
                  <span className="!text-white">Use template</span>
                </Link>
          </div>
        </section>

        <aside className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between font-medium">
            <p className="text-xs font-semibold text-slate-500">
              Template preview
            </p>
          </div>

          {selected ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="rounded-2xl bg-white px-6 py-6 shadow-sm">
                <p className="text-[10px] font-semibold text-slate-500">
                  Preview
                </p>
                <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
                  {selected.preview.headline}
                </h2>
                <div className="mt-4 space-y-4 text-sm leading-6 text-slate-700">
                  {selected.preview.sections.slice(0, 2).map((section) => (
                    <section key={section.title}>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {section.title}
                      </h3>
                      <p className="mt-1 text-sm text-slate-700">
                        {section.lines[0]}
                      </p>
                    </section>
                  ))}
                </div>
                <p className="mt-6 text-xs text-slate-500">
                  Use full preview from Templates to review complete content.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">No template selected.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function CreateEnvelopePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading editor...</div>}>
      <CreateEnvelopeContent />
    </Suspense>
  );
}

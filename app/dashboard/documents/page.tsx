"use client";

import { useEffect, useState, useRef } from "react";
import { FileText, CheckCircle2, ArrowUpRight, Trash2, X, MoreVertical, Download, Edit2, Loader2, UploadCloud, ChevronLeft, List, LayoutGrid, Image as ImageIcon, FileImage } from "lucide-react";
import { deleteCloudFiles } from "../../actions/uploadthing";
import { useUploadThing } from "../../lib/uploadthing-client";
import { supabase } from "../../lib/supabase/browser";

type SentDocument = {
  id: string;
  name: string;
  subject: string;
  recipients: { name: string; email: string; role: string }[];
  sender: { fullName: string; workEmail: string };
  sentAt: string;
  status: string;
  fileUrl?: string;
  fileKey?: string; // Added fileKey to SentDocument type
  category?: string; // Added category to track if it's a reviewer document
  content?: string; // Added content to store filled HTML content
};

type DocumentRow = {
  id: string;
  owner_id: string;
  name: string;
  subject: string;
  recipients: SentDocument["recipients"];
  sender: SentDocument["sender"];
  sent_at: string;
  status: string;
  file_url: string | null;
  file_key: string | null;
  category: string | null;
  content: string | null;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<SentDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [viewingDoc, setViewingDoc] = useState<SentDocument | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { startUpload, isUploading } = useUploadThing("documentUploader", {
    onClientUploadComplete: async (res) => {
      if (res) {
        if (!userId) return;
        const newDocs: SentDocument[] = res.map(file => ({
          id: file.key,
          name: file.name,
          subject: "Direct Upload",
          recipients: [{ name: "Self", email: "raj@smartdocs.in", role: "Owner" }],
          sender: { fullName: "Raj Kumar", workEmail: "raj@smartdocs.in" },
          sentAt: new Date().toISOString(),
          status: "completed",
          fileUrl: file.url,
          fileKey: file.key
        }));
        const { error } = await supabase.from("documents").insert(
          newDocs.map((doc) => ({
            owner_id: userId,
            name: doc.name,
            subject: doc.subject,
            recipients: doc.recipients,
            sender: doc.sender,
            sent_at: doc.sentAt,
            status: doc.status,
            file_url: doc.fileUrl,
            file_key: doc.fileKey,
            category: doc.category ?? null,
            content: doc.content ?? null,
          }))
        );
        if (error) {
          console.error("Failed to save documents:", error);
          return;
        }
        setDocuments((prev) => [...newDocs, ...prev]);
      }
    }
  });

  useEffect(() => {
    const loadDocuments = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user;
      if (currentUser) {
        setUserId(currentUser.id);
      }

      const loadLocalDocuments = () => {
        try {
          const raw = localStorage.getItem("smartdocs.sent_documents.v1");
          if (!raw) return [];
          const parsed = JSON.parse(raw) as Partial<SentDocument>[];
          return Array.isArray(parsed)
            ? parsed.map((doc) => ({
                id: doc.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                name: doc.name || "Document",
                subject: doc.subject || "Document",
                recipients: Array.isArray(doc.recipients)
                  ? doc.recipients.map((recipient) => ({
                      name: recipient.name || "",
                      email: recipient.email || "",
                      role: recipient.role || "Signer",
                    }))
                  : [],
                sender: doc.sender || { fullName: "", workEmail: "" },
                sentAt: doc.sentAt || new Date().toISOString(),
                status: doc.status || "pending",
                fileUrl: doc.fileUrl,
                fileKey: doc.fileKey,
                category: doc.category,
                content: doc.content,
              }))
            : [];
        } catch {
          return [];
        }
      };

      if (urlParams.get("clear") === "true") {
        if (currentUser) {
          await supabase.from("documents").delete().eq("owner_id", currentUser.id);
        }
        localStorage.removeItem("smartdocs.sent_documents.v1");
        window.location.href = "/dashboard/documents";
        return;
      }

      if (!currentUser) {
        setDocuments(loadLocalDocuments());
        setLoading(false);
        return;
      }

      const { data: rows, error } = await supabase
        .from("documents")
        .select("id, owner_id, name, subject, recipients, sender, sent_at, status, file_url, file_key, category, content")
        .eq("owner_id", currentUser.id)
        .order("sent_at", { ascending: false });

      if (error) {
        console.warn("Failed to load documents from Supabase, using local fallback:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        setDocuments(loadLocalDocuments());
        setLoading(false);
        return;
      }

      const remoteDocs: SentDocument[] = (rows ?? []).map((row: DocumentRow) => ({
        id: row.id,
        name: row.name,
        subject: row.subject,
        recipients: Array.isArray(row.recipients)
          ? row.recipients.map((recipient) => ({
              name: recipient.name || "",
              email: recipient.email || "",
              role: recipient.role || "Signer",
            }))
          : [],
        sender: row.sender ?? { fullName: "", workEmail: "" },
        sentAt: row.sent_at,
        status: row.status,
        fileUrl: row.file_url ?? undefined,
        fileKey: row.file_key ?? undefined,
        category: row.category ?? undefined,
        content: row.content ?? undefined,
      }));

      const localDocs = loadLocalDocuments();
      const mergedDocs: SentDocument[] = [...remoteDocs];
      localDocs.forEach((doc) => {
        if (!mergedDocs.some((item) => item.id === doc.id)) {
          mergedDocs.push(doc);
        }
      });
      setDocuments(mergedDocs);
      setLoading(false);
    };

    loadDocuments();
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const markAsSigned = (docId: string) => {
    const update = async () => {
      const updatedDocs = documents.map((doc) =>
        doc.id === docId ? { ...doc, status: "signed" } : doc
      );
      setDocuments(updatedDocs);
      await supabase.from("documents").update({ status: "signed", signed_at: new Date().toISOString() }).eq("id", docId);
    };
    void update();
  };

  const markAsReviewed = (docId: string) => {
    const update = async () => {
      const updatedDocs = documents.map((doc) =>
        doc.id === docId ? { ...doc, status: "reviewed" } : doc
      );
      setDocuments(updatedDocs);
      await supabase.from("documents").update({ status: "reviewed", reviewed_at: new Date().toISOString() }).eq("id", docId);
    };
    void update();
  };

  const markAsApproved = (docId: string) => {
    const update = async () => {
      const updatedDocs = documents.map((doc) =>
        doc.id === docId ? { ...doc, status: "approved" } : doc
      );
      setDocuments(updatedDocs);
      await supabase.from("documents").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", docId);
    };
    void update();
  };

  const deleteDocument = async (id: string, fileKey?: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;

    if (fileKey) {
      await deleteCloudFiles(fileKey);
    }

    const updatedDocs = documents.filter(doc => doc.id !== id);
    setDocuments(updatedDocs);
    await supabase.from("documents").delete().eq("id", id);
    setOpenMenuId(null);
  };

  const handleRename = (id: string) => {
    const rename = async () => {
      const updatedDocs = documents.map(doc =>
        doc.id === id ? { ...doc, name: newName } : doc
      );
      setDocuments(updatedDocs);
      await supabase.from("documents").update({ name: newName }).eq("id", id);
      setIsRenaming(null);
      setOpenMenuId(null);
    };
    void rename();
  };

  const handleDownload = (url: string, name: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setOpenMenuId(null);
  };

  const getDocKind = (doc: SentDocument) => {
    const lower = doc.name.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "image";
    if (lower.endsWith(".pdf")) return "pdf";
    if (/\.(doc|docx|txt|rtf)$/.test(lower)) return "doc";
    return "file";
  };

  const getPreview = (doc: SentDocument) => {
    const kind = getDocKind(doc);
    if (kind === "image" && doc.fileUrl) {
      return <img src={doc.fileUrl} alt={doc.name} className="h-full w-full object-cover" />;
    }

    return (
      <div className="flex h-full w-full flex-col justify-between bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4">
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${kind === "pdf" ? "bg-red-100 text-red-600" : kind === "doc" ? "bg-blue-100 text-blue-600" : "bg-slate-200 text-slate-600"}`}>
            {kind}
          </span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
          <p className="line-clamp-3 text-xs font-semibold leading-5 text-slate-700">
            {doc.subject || doc.name}
          </p>
        </div>
      </div>
    );
  };

  const getStatusBadge = (status: string, docName: string, category?: string) => {
    if (status === "signed" || status === "completed") {
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Signed
        </span>
      );
    }
    if (status === "reviewed") {
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Reviewed
        </span>
      );
    }
    if (status === "approved") {
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Approved
        </span>
      );
    }
    if (status === "reviewing" || category === "Reviewer") {
      return (
        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-[10px] font-semibold text-yellow-700">
          Reviewing
        </span>
      );
    }
    if (status === "waiting" || (category && category !== "Reviewer")) {
      return (
        <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-[10px] font-semibold text-orange-700">
          Waiting for Approval
        </span>
      );
    }
    // Show "Sent" for offer letters, "Sent for Review" for other documents
    const isOfferLetter = docName.toLowerCase().includes("offer") || docName.toLowerCase().includes("employment");
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-semibold text-blue-700">
        <ArrowUpRight className="mr-1 h-3 w-3" />
        {isOfferLetter ? "Sent" : "Sent for Review"}
      </span>
    );
  };

  const filteredDocuments = documents.filter((doc) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "pending") return doc.status !== "approved" && doc.status !== "reviewed" && doc.status !== "signed" && doc.status !== "completed";
    if (activeFilter === "approved") return doc.status === "approved" || doc.status === "reviewed" || doc.status === "signed" || doc.status === "completed";
    if (activeFilter === "rejected") return doc.status === "rejected";
    return true;
  });

  if (loading) {
    return (
      <div className="px-4 py-6 md:px-10 md:py-10">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          My documents
        </h1>
        <p className="mt-2 text-sm text-slate-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 md:px-10 md:py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Shared Documents
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Documents sent and received will appear here.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="inline-flex items-center rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 transition-all active:scale-95 disabled:opacity-50"
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <UploadCloud className="mr-2 h-3.5 w-3.5" />
                Upload
              </>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                startUpload(Array.from(e.target.files));
                e.target.value = "";
              }
            }}
          />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        {["all", "pending", "approved", "rejected"].map((tag) => (
          <button
            key={tag}
            onClick={() => setActiveFilter(tag)}
            className={`rounded-full px-5 py-1.5 text-xs font-semibold capitalize transition-all ${activeFilter === tag
              ? "bg-violet-600 text-white shadow-md shadow-violet-200"
              : "bg-white border border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600 shadow-sm"
              }`}
          >
            {tag}
          </button>
        ))}
        <div className="ml-auto inline-flex items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-all ${viewMode === "list" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-all ${viewMode === "grid" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {filteredDocuments.length === 0 ? (
        <div className="mt-10 rounded-3xl border border-slate-200 bg-white px-6 py-20 text-center shadow-sm">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 shadow-sm">
            <FileText className="h-5 w-5 text-slate-600" />
          </div>
          <p className="mt-6 text-sm font-semibold text-slate-900">
            No documents yet
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Documents sent and received will appear here.
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {filteredDocuments.map((doc, index) => (
            <div
              key={`${doc.id}-${index}`}
              className="group flex flex-col justify-between overflow-hidden rounded-[1.6rem] border border-slate-200 bg-[#eef2f7] shadow-sm hover:border-slate-300 hover:shadow-md transition-all relative"
            >
              <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${getDocKind(doc) === "pdf" ? "bg-red-100 text-red-600" : getDocKind(doc) === "image" ? "bg-emerald-100 text-emerald-600" : "bg-blue-100 text-blue-600"}`}>
                    {getDocKind(doc) === "image" ? <ImageIcon className="h-4 w-4" /> : getDocKind(doc) === "pdf" ? "PDF" : <FileImage className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 pr-10 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900" title={doc.name}>
                      {doc.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {doc.subject}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0 mt-0.5 relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === doc.id ? null : doc.id);
                    }}
                    className="p-1.5 rounded-lg bg-slate-50 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>

                  {openMenuId === doc.id && (
                    <div className="absolute top-10 right-0 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-xl z-20 animate-in fade-in zoom-in duration-200">
                      <button
                        onClick={() => handleDownload(doc.fileUrl || "", doc.name)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </button>
                      <button
                        onClick={() => {
                          setOpenMenuId(null);
                          setIsRenaming(doc.id);
                          setNewName(doc.name);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        <Edit2 className="h-3 w-3" />
                        Rename
                      </button>
                      <div className="h-px bg-slate-100 my-1" />
                      <button
                        onClick={() => deleteDocument(doc.id, doc.fileKey)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mx-4 h-40 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {getPreview(doc)}
              </div>

              {isRenaming === doc.id && (
                <div className="mt-3 flex gap-2 px-4">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="flex-1 px-2 py-1 text-xs border border-violet-200 rounded-md outline-none focus:ring-2 focus:ring-violet-50"
                    autoFocus
                  />
                  <button
                    onClick={() => handleRename(doc.id)}
                    className="px-2 py-1 bg-violet-600 text-white text-[10px] font-bold rounded-md"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setIsRenaming(null)}
                    className="px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md"
                  >
                    ×
                  </button>
                </div>
              )}

              <div className="mt-4 flex items-center gap-2 px-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-500 text-xs font-semibold text-white">
                  {(doc.sender.fullName || "P").charAt(0).toUpperCase()}
                </div>
                <p className="truncate text-xs text-slate-600">
                  {doc.status === "completed" ? "You uploaded" : "You sent"} • {formatDate(doc.sentAt)}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-200 bg-white/50 px-4 py-3">
                <div>{getStatusBadge(doc.status, doc.name, doc.category)}</div>
                <div className="flex items-center gap-2">
                  {doc.content ? (
                    <button
                      onClick={() => setViewingDoc(doc)}
                      className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 transition-all flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-md"
                    >
                      <ArrowUpRight className="h-3 w-3" />
                      View
                    </button>
                  ) : doc.fileUrl ? (
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 transition-all flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-md"
                    >
                      <ArrowUpRight className="h-3 w-3" />
                      View
                    </a>
                  ) : null}

                  {(doc.status === "reviewing" || doc.category === "Reviewer") && doc.status !== "reviewed" && (
                    <button
                      onClick={() => markAsReviewed(doc.id)}
                      className="text-[11px] font-semibold text-yellow-600 hover:text-yellow-700 transition-colors"
                    >
                      Mark Reviewed
                    </button>
                  )}
                  {doc.status === "reviewed" && (
                    <button
                      onClick={() => {
                        // Store document info for template flow
                        localStorage.setItem("smartdocs.send_reviewed_doc", JSON.stringify({
                          id: doc.id,
                          name: doc.name,
                          fileUrl: doc.fileUrl,
                          category: doc.category
                        }));
                        // Navigate to templates page with step 2 parameter
                        window.location.href = "/dashboard/templates?step=recipients";
                      }}
                      className="text-[11px] font-semibold text-green-600 hover:text-green-700 transition-colors"
                    >
                      Send
                    </button>
                  )}
                  {(doc.status === "waiting" || (doc.category && doc.category !== "Reviewer")) && doc.status !== "approved" && doc.status !== "signed" && doc.status !== "completed" && (
                    <button
                      onClick={() => markAsApproved(doc.id)}
                      className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 transition-colors"
                    >
                      Approve
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {filteredDocuments.map((doc, index) => (
            <div key={`${doc.id}-${index}`} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                {getPreview(doc)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{doc.name}</p>
                  {getStatusBadge(doc.status, doc.name, doc.category)}
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">{doc.subject}</p>
                <p className="mt-2 truncate text-xs text-slate-400">
                  {doc.recipients.map((r) => r.email).join(", ")} • {formatDate(doc.sentAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {doc.content ? (
                  <button onClick={() => setViewingDoc(doc)} className="rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-100">
                    View
                  </button>
                ) : doc.fileUrl ? (
                  <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-100">
                    View
                  </a>
                ) : null}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === doc.id ? null : doc.id);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {openMenuId === doc.id && (
                  <div className="absolute right-4 mt-40 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-xl z-20">
                    <button onClick={() => handleDownload(doc.fileUrl || "", doc.name)} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50">Download</button>
                    <button onClick={() => { setOpenMenuId(null); setIsRenaming(doc.id); setNewName(doc.name); }} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50">Rename</button>
                    <button onClick={() => deleteDocument(doc.id, doc.fileKey)} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-red-600 hover:bg-red-50">Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full-Page Document Viewer Modal */}
      {viewingDoc && viewingDoc.content && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col h-screen w-screen overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-white shrink-0 shadow-sm">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setViewingDoc(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all group"
              >
                <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                <span className="text-sm font-semibold">Back</span>
              </button>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-sm font-semibold text-red-600">
                PDF
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 leading-tight">{viewingDoc.name}</h2>
                <p className="text-[11px] text-slate-500 font-medium">{viewingDoc.subject}</p>
              </div>
            </div>
            <button
              onClick={() => setViewingDoc(null)}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Document Content */}
          <div className="flex-1 overflow-y-auto bg-slate-100/50">
            <div className="max-w-4xl mx-auto my-8 bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 p-10 md:p-16 lg:p-20">
              <div
                className="document-content text-[15px] text-slate-800 leading-[1.9] tracking-tight"
                style={{
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                }}
                dangerouslySetInnerHTML={{
                  __html: viewingDoc.content
                    .replace(/\n/g, "<br/>")
                    .replace(/<strong>/g, '<strong style="font-weight:700; color:#0f172a;">')
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

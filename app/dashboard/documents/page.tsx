"use client";

import { useEffect, useState } from "react";
import { FileText, CheckCircle2, ArrowUpRight, Trash2, X, MoreVertical, Download, Edit2, ChevronLeft, List, LayoutGrid, Image as ImageIcon, FileImage, Info, Clock, Eye } from "lucide-react";
import { deleteCloudFiles } from "../../actions/uploadthing";
import { supabase } from "../../lib/supabase/browser";
import { getMatchingRecipient, normalizeEmail } from "../../lib/documents";

type SentDocument = {
  id: string;
  name: string;
  subject: string;
  recipients: { name: string; email: string; role: string; status?: string }[];
  sender: { fullName: string; workEmail: string };
  sentAt: string;
  status: string;
  fileUrl?: string;
  fileKey?: string; // Added fileKey to SentDocument type
  category?: string; // Added category to track if it's a reviewer document
  content?: string; // Added content to store filled HTML content
  direction?: "sent" | "received";
  recipientRole?: string;
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

const mapRowToSentDocument = (row: DocumentRow, currentUserId: string, currentUserEmail: string): SentDocument[] => {
  const recipients = Array.isArray(row.recipients)
    ? row.recipients.map((recipient) => ({
        name: recipient.name || "",
        email: recipient.email || "",
        role: recipient.role || "Signer",
        status: recipient.status || "pending",
      }))
    : [];

  const isOwner = row.owner_id === currentUserId;
  const matchingRecipient = getMatchingRecipient(recipients, currentUserEmail);

  if (!isOwner && !matchingRecipient) {
    return [];
  }

  return [{
    id: row.id,
    name: row.name,
    subject: row.subject,
    recipients,
    sender: row.sender ?? { fullName: "", workEmail: "" },
    sentAt: row.sent_at,
    status: row.status,
    fileUrl: row.file_url ?? undefined,
    fileKey: row.file_key ?? undefined,
    category: row.category ?? undefined,
    content: row.content ?? undefined,
    direction: isOwner ? "sent" : "received",
    recipientRole: matchingRecipient?.role || undefined,
  }];
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
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [detailDoc, setDetailDoc] = useState<SentDocument | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadDocuments = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        
        // Use getSession first to avoid lock contention
        const { data: { session } } = await supabase.auth.getSession();
        let user = (session?.user ?? undefined) as any;
        
        if (!user) {
          const { data: { user: freshUser }, error: authError } = await supabase.auth.getUser();
          if (authError) {
            // Ignore stolen lock errors, we'll try again on next mount or via session changes
            if (authError.message?.includes("stole it")) return;
            throw authError;
          }
          user = freshUser;
        }

        if (urlParams.get("clear") === "true") {
          if (user) {
            await supabase.from("documents").delete().eq("owner_id", user.id);
          }
          window.location.href = "/dashboard/documents";
          return;
        }

        if (!user) {
          if (isMounted) {
            setDocuments([]);
            setLoading(false);
          }
          return;
        }

        if (isMounted) {
          setUserId(user.id);
          setCurrentUserEmail(normalizeEmail(user.email));
        }

        const { data: rows, error } = await supabase
          .from("documents")
          .select("id, owner_id, name, subject, recipients, sender, sent_at, status, file_url, file_key, category, content")
          .order("sent_at", { ascending: false });

        if (error) {
          console.warn("DEBUG: documents fetch error:", JSON.stringify(error, null, 2));
          if (isMounted) {
            setDocuments([]);
            setLoading(false);
          }
          return;
        }

        const remoteDocsRaw: SentDocument[] = (rows ?? []).flatMap((row: DocumentRow) =>
          mapRowToSentDocument(row, user!.id, normalizeEmail(user!.email))
        );

        // Consolidation logic - only merge rows from the same owner with the same fileKey
        const consolidated = remoteDocsRaw.reduce((acc, doc) => {
          const timeKey = doc.sentAt ? doc.sentAt.substring(0, 16) : "no-time";
          // Include direction in groupKey to prevent merging sent with received docs
          const groupKey = `${doc.direction}-${doc.fileKey || `${doc.name}-${doc.subject}-${timeKey}`}`;

          if (!acc[groupKey]) {
            acc[groupKey] = { ...doc };
          } else {
            doc.recipients.forEach(newR => {
              const existingRIndex = acc[groupKey].recipients.findIndex(existingR => 
                normalizeEmail(existingR.email) === normalizeEmail(newR.email)
              );
              if (existingRIndex === -1) {
                acc[groupKey].recipients.push({ ...newR });
              } else {
                const existingR = acc[groupKey].recipients[existingRIndex];
                const newStatus = newR.status || "pending";
                const oldStatus = existingR.status || "pending";
                const statusPriority = ["pending", "reviewing", "waiting", "signed", "reviewed", "approved", "completed"];
                if (statusPriority.indexOf(newStatus) > statusPriority.indexOf(oldStatus)) {
                  acc[groupKey].recipients[existingRIndex].status = newStatus;
                }
              }
            });
            const advancedStatuses = ["pending", "signed", "reviewed", "approved", "completed"];
            const currentStatusIndex = advancedStatuses.indexOf(acc[groupKey].status || "pending");
            const newStatusIndex = advancedStatuses.indexOf(doc.status || "pending");
            
            if (newStatusIndex > currentStatusIndex) {
              acc[groupKey].status = doc.status || "pending";
              if (doc.content) acc[groupKey].content = doc.content;
              if (doc.fileUrl) acc[groupKey].fileUrl = doc.fileUrl;
            }
          }
          return acc;
        }, {} as Record<string, SentDocument>);

        const remoteDocs = Object.values(consolidated);

        if (isMounted) {
          setDocuments(remoteDocs);
          setLoading(false);
        }
      } catch (err) {
        console.error("Auth or load error:", err);
        if (isMounted) setLoading(false);
      }
    };

    void loadDocuments();

    const documentsChannel = supabase
      .channel(`documents-page-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "documents" },
        () => {
          void loadDocuments();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      void supabase.removeChannel(documentsChannel);
    };
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

    if (kind === "pdf" && doc.fileUrl) {
      return <iframe src={doc.fileUrl} title={doc.name} className="h-full w-full" />;
    }

    return (
      <div className="flex h-full w-full flex-col justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4">
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
          <p className="line-clamp-3 text-xs font-semibold leading-5 text-slate-700">
            {doc.subject || doc.name}
          </p>
        </div>
      </div>
    );
  };

  const getStatusBadge = (doc: SentDocument) => {
    const { status, recipients, category, direction } = doc;
    const isSender = direction === "sent";

    if (isSender) {
      // Sender sees overall status across all recipients
      const totalCount = recipients.length;
      const completedCount = recipients.filter(
        (r) => ["signed", "reviewed", "approved"].includes((r as { status?: string }).status || "")
      ).length;

      if (totalCount > 0) {
        if (completedCount === totalCount) {
          const label = totalCount === 1
            ? (recipients[0]?.status === "reviewed" ? "Reviewed" : "Signed")
            : "Finished";
          return (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {label}
            </span>
          );
        }
        return (
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-semibold text-blue-700">
            <Clock className="mr-1 h-3 w-3" />
            Pending
          </span>
        );
      }
    } else {
      // Recipient sees only their own status
      const myRecipient = doc.recipientRole
        ? recipients.find(r => r.role?.toLowerCase() === doc.recipientRole?.toLowerCase())
        : null;
      const myStatus = myRecipient?.status || recipients.find(r => r.email)?.status;

      if (myStatus === "signed") {
        return (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Signed
          </span>
        );
      }
      if (myStatus === "reviewed") {
        return (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Reviewed
          </span>
        );
      }
      if (myStatus === "approved") {
        return (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Approved
          </span>
        );
      }
    }

    // Check document-level status for documents with no recipients
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
    if (status === "signed" || status === "completed") {
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Signed
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
    return (
      <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-[10px] font-semibold text-orange-700">
        Awaiting Recipient
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

  const markAsReceivedAction = async (doc: SentDocument) => {
    const { data: authData } = await supabase.auth.getUser();
    const currentEmail = normalizeEmail(authData.user?.email);
    const myRecipient = doc.recipients.find(r => normalizeEmail(r.email) === currentEmail);

    // Determine if the current user is a reviewer or signer
    const isReviewer = myRecipient
      ? myRecipient.role?.toLowerCase() === "reviewer"
      : doc.category === "Reviewer" || doc.recipientRole === "reviewer" || doc.status === "reviewing";

    const nextStatus = isReviewer ? "reviewed" : "signed";
    const patch = nextStatus === "reviewed"
      ? { status: "reviewed", reviewed_at: new Date().toISOString() }
      : { status: "signed", signed_at: new Date().toISOString() };

    // Update per-recipient status in the JSONB array
    if (doc.recipients.length > 0) {
      let updated = false;
      const updatedRecipients = doc.recipients.map((r) => {
        const isMatch = currentEmail && normalizeEmail(r.email) === currentEmail;
        if (isMatch || (doc.recipients.length === 1 && !updated)) {
          updated = true;
          return { ...r, status: nextStatus };
        }
        return r;
      });

      // Update only the current document row in local state
      setDocuments((prev) => prev.map((item) =>
        item.id === doc.id ? { ...item, status: nextStatus, recipients: updatedRecipients } : item
      ));

      // Database sync: update only the specific document row by id
      await supabase.from("documents").update({ ...patch, recipients: updatedRecipients }).eq("id", doc.id);
    } else {
      // Update only the current document row in local state
      setDocuments((prev) => prev.map((item) =>
        item.id === doc.id ? { ...item, status: nextStatus } : item
      ));

      // Database sync: update only the specific document row by id
      await supabase.from("documents").update(patch).eq("id", doc.id);
    }
  };

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
                      {(() => {
                        const hasSigned = doc.recipients.some(r => r.status === "signed" || r.status === "reviewed");
                        if (hasSigned && doc.fileUrl) {
                          return (
                            <a
                              href={doc.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setOpenMenuId(null)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                            >
                              <Eye className="h-3 w-3" />
                              View
                            </a>
                          );
                        }
                        if (doc.content) {
                          return (
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                setViewingDoc(doc);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                            >
                              <Eye className="h-3 w-3" />
                              View
                            </button>
                          );
                        }
                        if (doc.fileUrl) {
                          return (
                            <a
                              href={doc.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setOpenMenuId(null)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                            >
                              <Eye className="h-3 w-3" />
                              View
                            </a>
                          );
                        }
                        return null;
                      })()}
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
                      <button
                        onClick={() => {
                          setOpenMenuId(null);
                          setDetailDoc(doc);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        <Info className="h-3 w-3" />
                        More
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
                  {doc.direction === "received"
                    ? `Received from ${doc.sender.fullName || doc.sender.workEmail}`
                    : doc.status === "completed"
                      ? "You uploaded"
                      : "You sent"} • {formatDate(doc.sentAt)}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-200 bg-white/50 px-4 py-3">
                <div>{getStatusBadge(doc)}</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDetailDoc(doc)}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 transition-all flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-md"
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    View More
                  </button>

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
                  {getStatusBadge(doc)}
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">{doc.subject}</p>
                <p className="mt-2 truncate text-xs text-slate-400">
                  {doc.recipients.map((r) => r.email).join(", ")} • {formatDate(doc.sentAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setDetailDoc(doc)} className="rounded-full bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-100">
                  View More
                </button>
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
                    {(() => {
                      const hasSigned = doc.recipients.some(r => r.status === "signed" || r.status === "reviewed");
                      if (hasSigned && doc.fileUrl) {
                        return (
                          <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpenMenuId(null)} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                            <Eye className="h-3 w-3" />View
                          </a>
                        );
                      }
                      if (doc.content) {
                        return (
                          <button onClick={() => { setOpenMenuId(null); setViewingDoc(doc); }} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                            <Eye className="h-3 w-3" />View
                          </button>
                        );
                      }
                      if (doc.fileUrl) {
                        return (
                          <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpenMenuId(null)} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                            <Eye className="h-3 w-3" />View
                          </a>
                        );
                      }
                      return null;
                    })()}
                    <button onClick={() => handleDownload(doc.fileUrl || "", doc.name)} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50">Download</button>
                    <button onClick={() => { setOpenMenuId(null); setIsRenaming(doc.id); setNewName(doc.name); }} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50">Rename</button>
                    <button onClick={() => { setOpenMenuId(null); setDetailDoc(doc); }} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50">More</button>
                    <div className="h-px bg-slate-100 my-1" />
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
          <div className="flex-1 overflow-y-auto bg-slate-100/50 py-8 px-4 flex">
            <div className="w-[800px] min-h-[1056px] mx-auto bg-white rounded-lg shadow-xl shadow-slate-200/50 border border-slate-200 p-12 md:p-16 shrink-0 relative">
              <div
                className="document-content text-[15px] text-slate-800 leading-[1.9] tracking-tight"
                style={{
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                }}
                dangerouslySetInnerHTML={{
                  __html: viewingDoc.content.includes("<") 
                    ? viewingDoc.content.replace(/<strong>/g, '<strong style="font-weight:700; color:#0f172a;">')
                    : viewingDoc.content.replace(/\n/g, "<br/>")
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Document Detail / Status Modal */}
      {detailDoc && (
        <DocumentDetailModal
          doc={detailDoc}
          onClose={() => setDetailDoc(null)}
          formatDate={formatDate}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   Document Detail Modal – shows per-recipient status
   ────────────────────────────────────────────────────────── */

function DocumentDetailModal({
  doc,
  onClose,
  formatDate,
}: {
  doc: SentDocument;
  onClose: () => void;
  formatDate: (d: string) => string;
}) {
  const [viewingRecipient, setViewingRecipient] = useState<string | null>(null);
  const [refreshedDoc, setRefreshedDoc] = useState<SentDocument>(doc);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Fetch current user email
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserEmail(normalizeEmail(data.user?.email));
    });
  }, []);

  // Fetch fresh document data when modal opens
  useEffect(() => {
    const fetchDocument = async () => {
      try {
        const { data: freshDoc, error } = await supabase
          .from("documents")
          .select("id, owner_id, name, subject, recipients, sender, sent_at, status, file_url, file_key, category, content")
          .eq("id", doc.id)
          .maybeSingle();

        if (error) throw error;

        if (freshDoc) {
          const typedSender = (freshDoc.sender ?? {}) as { fullName?: string; workEmail?: string };
          const rawRecipients = freshDoc.recipients as Array<{ name: string; email: string; role: string; status?: string }> | null;
          const mappedRecipients = (rawRecipients ?? []).map((r) => ({
            name: r.name || "",
            email: r.email || "",
            role: r.role || "",
            status: r.status,
          }));

          setRefreshedDoc({
            id: freshDoc.id,
            name: freshDoc.name,
            subject: freshDoc.subject || "",
            recipients: mappedRecipients,
            sender: {
              fullName: typedSender.fullName || "",
              workEmail: typedSender.workEmail || "",
            },
            sentAt: freshDoc.sent_at || "",
            status: freshDoc.status,
            fileUrl: freshDoc.file_url || "",
            fileKey: freshDoc.file_key || "",
            category: freshDoc.category,
            content: freshDoc.content,
          });
        }
      } catch (err) {
        console.error("Failed to refresh document:", err);
      }
    };

    fetchDocument();
  }, [doc.id]);

  const currentDoc = refreshedDoc;
  const isSender = doc.direction === "sent";
  const isSingleRecipient = currentDoc.recipients.length <= 1;

  const getRoleLabel = (r: { role: string }) => {
    const role = r.role?.toLowerCase();
    if (role === "reviewer") return "Reviewer";
    return "Signer";
  };

  const getRecipientStatusLabel = (r: { name: string; email: string; role: string; status?: string }) => {
    const s = (r as { status?: string }).status;
    const role = r.role?.toLowerCase();
    if (s === "signed") return "Signed";
    if (s === "reviewed") return "Reviewed";
    if (s === "approved") return "Approved";
    if (role === "reviewer") return "Yet to Review";
    return "Yet to Sign";
  };

  const getRecipientStatusColor = (r: { name: string; email: string; role: string; status?: string }) => {
    const s = (r as { status?: string }).status;
    if (s === "signed" || s === "reviewed" || s === "approved") return "bg-green-100 text-green-700";
    return "bg-amber-100 text-amber-700";
  };

  const getRecipientIcon = (r: { name: string; email: string; role: string; status?: string }) => {
    const s = (r as { status?: string }).status;
    if (s === "signed" || s === "reviewed" || s === "approved") return <CheckCircle2 className="h-3.5 w-3.5" />;
    return <Clock className="h-3.5 w-3.5" />;
  };

  // For sender: show overall status across all recipients
  // For recipient: show only their own status
  const getOverallStatusLabel = () => {
    if (!isSender && currentDoc.recipients.length > 0) {
      // Find the current user's recipient entry by matching their email
      const myRecipient = currentUserEmail
        ? currentDoc.recipients.find(r => normalizeEmail(r.email) === currentUserEmail)
        : currentDoc.recipients[0];
      const s = myRecipient?.status;
      if (s === "signed") return "Signed";
      if (s === "reviewed") return "Reviewed";
      if (s === "approved") return "Approved";
      return myRecipient?.role?.toLowerCase() === "reviewer" ? "Yet to Review" : "Yet to Sign";
    }

    const totalCount = currentDoc.recipients.length;
    const completedCount = currentDoc.recipients.filter(
      (r) => ["signed", "reviewed", "approved"].includes((r as { status?: string }).status || "")
    ).length;

    // Multi-recipient logic: only show "Reviewed" when ALL recipients have reviewed
    if (totalCount > 0) {
      if (completedCount === totalCount) {
        return totalCount === 1 
          ? (currentDoc.recipients[0]?.status === "reviewed" ? "Reviewed" : "Signed")
          : "Finished";
      }
      return "Pending";
    }

    // Check document-level status for documents with no recipients
    if (currentDoc.status === "reviewed") return "Reviewed";
    if (currentDoc.status === "approved") return "Approved";
    if (currentDoc.status === "signed" || currentDoc.status === "completed") return "Signed";
    if (currentDoc.status === "reviewing") return "Under Review";
    if (currentDoc.status === "waiting") return "Awaiting Signer";
    return currentDoc.category === "Reviewer" ? "Yet to Review" : "Yet to Sign";
  };

  const getOverallStatusColor = () => {
    if (!isSender && currentDoc.recipients.length > 0) {
      const myRecipient = currentUserEmail
        ? currentDoc.recipients.find(r => normalizeEmail(r.email) === currentUserEmail)
        : currentDoc.recipients[0];
      const s = myRecipient?.status;
      if (s === "signed" || s === "reviewed" || s === "approved") return "bg-green-100 text-green-700 border-green-200";
      return "bg-amber-100 text-amber-700 border-amber-200";
    }

    const totalCount = currentDoc.recipients.length;
    const completedCount = currentDoc.recipients.filter(
      (r) => ["signed", "reviewed", "approved"].includes((r as { status?: string }).status || "")
    ).length;

    // Multi-recipient logic first
    if (totalCount > 0) {
      if (completedCount === totalCount) return "bg-green-100 text-green-700 border-green-200";
      return "bg-blue-100 text-blue-700 border-blue-200";
    }

    // Check document-level status for documents with no recipients
    if (["signed", "completed", "reviewed", "approved"].includes(currentDoc.status)) return "bg-green-100 text-green-700 border-green-200";
    if (currentDoc.status === "reviewing") return "bg-yellow-100 text-yellow-700 border-yellow-200";
    if (currentDoc.status === "waiting") return "bg-orange-100 text-orange-700 border-orange-200";
    return "bg-slate-100 text-slate-600 border-slate-200";
  };

  const getOverallIcon = () => {
    if (!isSender && currentDoc.recipients.length > 0) {
      const myRecipient = currentUserEmail
        ? currentDoc.recipients.find(r => normalizeEmail(r.email) === currentUserEmail)
        : currentDoc.recipients[0];
      const s = myRecipient?.status;
      if (s === "signed" || s === "reviewed" || s === "approved") return <CheckCircle2 className="h-5 w-5" />;
      return <Clock className="h-5 w-5" />;
    }

    const totalCount = currentDoc.recipients.length;
    const completedCount = currentDoc.recipients.filter(
      (r) => ["signed", "reviewed", "approved"].includes((r as { status?: string }).status || "")
    ).length;

    // Multi-recipient logic first
    if (totalCount > 0) {
      if (completedCount === totalCount) return <CheckCircle2 className="h-5 w-5" />;
      return <Clock className="h-5 w-5" />;
    }

    // Check document-level status for documents with no recipients
    if (["signed", "completed", "reviewed", "approved"].includes(currentDoc.status)) return <CheckCircle2 className="h-5 w-5" />;
    return <Clock className="h-5 w-5" />;
  };

  // Counts for multi-recipient summary
  const completedCount = currentDoc.recipients.filter(
    (r) => ["signed", "reviewed", "approved"].includes((r as { status?: string }).status || "")
  ).length;
  const pendingCount = currentDoc.recipients.length - completedCount;

  const handleDownload = (recipientName: string) => {
    if (!currentDoc.fileUrl) return;
    const link = document.createElement("a");
    link.href = currentDoc.fileUrl;
    link.download = `${currentDoc.name}_${recipientName || "document"}`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col h-screen w-screen overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-white shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all group"
          >
            <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            <span className="text-sm font-semibold">Back</span>
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">{currentDoc.name}</h2>
            <p className="text-[11px] text-slate-500 font-medium">{currentDoc.subject}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-slate-50">
        <div className="max-w-4xl mx-auto py-8 px-4 md:px-8 space-y-6">

          {/* Document Info Card */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Document Information</h3>
            </div>
            <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Sent By</p>
                <p className="mt-1 text-sm font-medium text-slate-800">{currentDoc.sender.fullName || currentDoc.sender.workEmail}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Sent On</p>
                <p className="mt-1 text-sm font-medium text-slate-800">{formatDate(currentDoc.sentAt)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Recipients</p>
                <p className="mt-1 text-sm font-medium text-slate-800">{currentDoc.recipients.length}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Category</p>
                <p className="mt-1 text-sm font-medium text-slate-800 capitalize">{currentDoc.category || "General"}</p>
              </div>
            </div>
          </div>

          {/* Overall Status Card (single recipient - sender view) */}
          {isSingleRecipient && isSender && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">Status</h3>
              </div>
              <div className="px-6 py-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${getOverallStatusColor()}`}>
                    {getOverallIcon()}
                  </div>
                  <div>
                    <p className="text-lg font-bold text-slate-900">{getOverallStatusLabel()}</p>
                    {currentDoc.recipients[0] && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Recipient: {currentDoc.recipients[0].name || currentDoc.recipients[0].email}
                        <span className="capitalize"> ({getRoleLabel(currentDoc.recipients[0])})</span>
                      </p>
                    )}
                  </div>
                </div>
                {/* Single recipient actions */}
                <div className="flex items-center gap-2">
                  {(currentDoc.content || currentDoc.fileUrl) && (
                    <button
                      onClick={() => setViewingRecipient(currentDoc.recipients[0]?.email || "__single__")}
                      className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      <Eye className="h-3 w-3" />
                      View
                    </button>
                  )}
                  {currentDoc.fileUrl && (
                    <button
                      onClick={() => handleDownload(currentDoc.recipients[0]?.name || "document")}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </button>
                  )}
                  {isSender && currentDoc.category === "Reviewer" && (getOverallStatusLabel() === "Reviewed" || getOverallStatusLabel() === "Finished") && (
                    <button
                      onClick={() => {
                        window.location.href = `/dashboard/templates?step=recipients&documentId=${currentDoc.id}`;
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-green-600 border border-green-700 px-4 py-1.5 text-[11px] font-bold text-white hover:bg-green-700 transition-colors shadow-sm"
                    >
                      <ArrowUpRight className="h-3 w-3" />
                      Send
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Recipient's Own Status Card (single recipient - recipient view) */}
          {isSingleRecipient && !isSender && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900">Your Status</h3>
              </div>
              <div className="px-6 py-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${getOverallStatusColor()}`}>
                    {getOverallIcon()}
                  </div>
                  <div>
                    <p className="text-lg font-bold text-slate-900">{getOverallStatusLabel()}</p>
                    {currentDoc.recipients[0] && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Role: <span className="capitalize">{getRoleLabel(currentDoc.recipients[0])}</span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(currentDoc.content || currentDoc.fileUrl) && (
                    <button
                      onClick={() => setViewingRecipient(currentDoc.recipients[0]?.email || "__single__")}
                      className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-100 transition-colors"
                    >
                      <Eye className="h-3 w-3" />
                      View
                    </button>
                  )}
                  {currentDoc.fileUrl && (
                    <button
                      onClick={() => handleDownload(currentDoc.recipients[0]?.name || "document")}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Multi-Recipient Status Table (sender view - all recipients) */}
          {!isSingleRecipient && isSender && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Recipient Status</h3>
                <div className="flex items-center gap-3 text-xs">
                  {isSender && currentDoc.category === "Reviewer" && (getOverallStatusLabel() === "Reviewed" || getOverallStatusLabel() === "Finished") && (
                    <button
                      onClick={() => {
                        window.location.href = `/dashboard/templates?step=recipients&documentId=${currentDoc.id}`;
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full bg-green-600 border border-green-700 px-3 py-1.5 font-bold text-white hover:bg-green-700 transition-colors shadow-sm mr-2"
                    >
                      <ArrowUpRight className="h-3 w-3" />
                      Send document
                    </button>
                  )}
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-1 font-semibold text-green-700">
                    <CheckCircle2 className="h-3 w-3" />
                    {completedCount} Completed
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 font-semibold text-amber-700">
                    <Clock className="h-3 w-3" />
                    {pendingCount} Pending
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="px-6 pt-4 pb-2">
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-500"
                    style={{ width: `${currentDoc.recipients.length > 0 ? (completedCount / currentDoc.recipients.length) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">
                  {completedCount} of {currentDoc.recipients.length} completed
                </p>
              </div>

              {/* Table */}
              <div className="px-6 pb-4">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="py-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Recipient</th>
                      <th className="py-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Email</th>
                      <th className="py-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Role</th>
                      <th className="py-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</th>
                      <th className="py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentDoc.recipients.map((r, i) => (
                      <tr key={`${r.email}-${i}`} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-600">
                              {(r.name || r.email || "?").charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm font-semibold text-slate-800">{r.name || "—"}</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-xs text-slate-500">{r.email}</td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${getRoleLabel(r) === "Reviewer" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                            {getRoleLabel(r)}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${getRecipientStatusColor(r)}`}>
                            {getRecipientIcon(r)}
                            {getRecipientStatusLabel(r)}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-1.5">
                            {(doc.content || doc.fileUrl) && (
                              <button
                                onClick={() => setViewingRecipient(r.email)}
                                className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-600 hover:bg-blue-100 transition-colors"
                              >
                                <Eye className="h-3 w-3" />
                                View
                              </button>
                            )}
                            {isSender && getRoleLabel(r) === "Reviewer" && r.status === "reviewed" && (
                              <button
                                onClick={() => {
                                  window.location.href = `/dashboard/templates?step=recipients&documentId=${currentDoc.id}`;
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-[10px] font-bold text-green-600 hover:bg-green-100 transition-colors"
                              >
                                <ArrowUpRight className="h-3 w-3" />
                                Send
                              </button>
                            )}
                            {currentDoc.fileUrl && (
                              <button
                                onClick={() => handleDownload(r.name)}
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                              >
                                <Download className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Multi-Recipient Status Card (recipient view - only own status) */}
          {!isSingleRecipient && !isSender && (() => {
            const myRecipient = currentUserEmail
              ? currentDoc.recipients.find(r => normalizeEmail(r.email) === currentUserEmail)
              : currentDoc.recipients[0];
            const matchedRecipient = myRecipient || currentDoc.recipients[0];
            return (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900">Your Status</h3>
                </div>
                <div className="px-6 py-6 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${getRecipientStatusColor(matchedRecipient)}`}>
                      {getRecipientIcon(matchedRecipient)}
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900">{getRecipientStatusLabel(matchedRecipient)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Role: <span className="capitalize">{getRoleLabel(matchedRecipient)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(currentDoc.content || currentDoc.fileUrl) && (
                      <button
                        onClick={() => setViewingRecipient(matchedRecipient.email)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-100 transition-colors"
                      >
                        <Eye className="h-3 w-3" />
                        View
                      </button>
                    )}
                    {currentDoc.fileUrl && (
                      <button
                        onClick={() => handleDownload(matchedRecipient.name || "document")}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

        </div>
      </div>

      {/* View Document Sub-Modal */}
      {viewingRecipient && (
        <div className="fixed inset-0 z-[110] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Sub-modal header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-xs font-bold text-violet-600">
                  {(currentDoc.recipients.find(r => r.email === viewingRecipient)?.name || viewingRecipient || "?").charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {currentDoc.recipients.find(r => r.email === viewingRecipient)?.name || "Recipient"} — {currentDoc.name}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {(() => {
                      const r = currentDoc.recipients.find(r => r.email === viewingRecipient);
                      if (!r) return "";
                      const s = (r as { status?: string }).status;
                      if (s === "signed") return "✅ Signed";
                      if (s === "reviewed") return "✅ Reviewed";
                      return r.role?.toLowerCase() === "reviewer" ? "⏳ Yet to Review" : "⏳ Yet to Sign";
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {currentDoc.fileUrl && (
                  <a
                    href={currentDoc.name?.toLowerCase().endsWith(".doc") || currentDoc.name?.toLowerCase().endsWith(".docx")
                      ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(currentDoc.fileUrl)}`
                      : currentDoc.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-100 transition-colors"
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    Open
                  </a>
                )}
                {currentDoc.fileUrl && (
                  <button
                    onClick={() => handleDownload(currentDoc.recipients.find(r => r.email === viewingRecipient)?.name || "document")}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    Download
                  </button>
                )}
                <button
                  onClick={() => setViewingRecipient(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sub-modal content */}
            <div className="flex-1 overflow-y-auto bg-slate-50/50 p-6">
              {(() => {
                // Check if the recipient has signed - show the signed file instead of template
                const viewingR = currentDoc.recipients.find(r => r.email === viewingRecipient);
                const isSigned = viewingR?.status === "signed" || viewingR?.status === "reviewed";

                // 1. Prefer individual signed content, then global template content (HTML/Text)
                const displayContent = (viewingR as any)?.signed_content || currentDoc.content;

                if (displayContent) {
                  return (
                    <div className="w-[800px] min-h-[1056px] mx-auto bg-white rounded-xl border border-slate-200 shadow-sm p-12 md:p-16 relative origin-top max-w-full">
                      <div
                        className="document-content text-[14px] text-slate-800 leading-[1.8] tracking-tight"
                        style={{
                          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                        }}
                        dangerouslySetInnerHTML={{
                          __html: displayContent
                            .replace(/\n/g, "<br/>")
                            .replace(/<strong>/g, '<strong style="font-weight:700; color:#0f172a;">')
                        }}
                      />
                    </div>
                  );
                }

                // 2. Fallback to fileUrl (Iframe or Image)
                const displayFileUrl = (viewingR as any)?.signed_file_url || currentDoc.fileUrl;
                if (displayFileUrl) {
                  const isWordDoc = /\.(doc|docx)$/i.test(currentDoc.name || "");
                  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(currentDoc.name || "");

                  if (isImage) {
                    return (
                      <div className="flex justify-center">
                        <img src={displayFileUrl} alt={currentDoc.name} className="max-h-[60vh] rounded-xl border border-slate-200 shadow-sm object-contain" />
                      </div>
                    );
                  }

                  const iframeSrc = isWordDoc
                    ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(displayFileUrl)}`
                    : displayFileUrl;

                  return (
                    <div className="flex justify-center flex-col items-center w-full">
                      <iframe src={iframeSrc} title={currentDoc.name} className="w-full max-w-4xl h-[70vh] rounded-xl border border-slate-200 shadow-sm" />
                      {displayFileUrl !== currentDoc.fileUrl && (
                        <p className="mt-4 text-xs font-semibold text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-200">
                          Viewing {viewingR?.name || viewingRecipient}'s signed version
                        </p>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <FileText className="h-16 w-16 text-slate-300" />
                    <p className="text-sm font-medium text-slate-500">No document preview available.</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

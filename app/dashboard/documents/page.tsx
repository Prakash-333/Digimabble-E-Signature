"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { FileText, CheckCircle2, ArrowUpRight, Trash2, X, XCircle, MoreVertical, Download, Edit2, ChevronLeft, List, LayoutGrid, Image as ImageIcon, FileImage, Info, Clock, Eye, Search, PenLine, Copy, CloudUpload, History, UserCheck, Send as SendIcon } from "lucide-react";
import { deleteCloudFiles } from "../../actions/uploadthing";
import { supabase } from "../../lib/supabase/browser";
import { hasPositionedDocumentStage, isStructuredDocumentHtml, renderDocumentStageBodyHtml } from "../../lib/document-stage";
import { getMatchingRecipient, normalizeEmail, logDocumentEvent } from "../../lib/documents";

import { Edit3, Save, ShieldCheck, Loader2, RotateCcw } from "lucide-react";
import { useUploadThing } from "../../lib/uploadthing-client";
import { analyzeDocumentFile } from "../../lib/document-analysis";
import { highlightHtmlEdits, stripHighlights } from "../../../app/lib/diff";

type Recipient = { 
  name: string; 
  email: string; 
  role: string; 
  status?: string; 
  signed_file_url?: string; 
  signed_content?: string; 
  reject_reason?: string | null; 
  sign_message?: string | null 
};

type SentDocument = {
  id: string;
  name: string;
  subject: string;
  recipients: Recipient[];
  sender: { fullName: string; workEmail: string };
  sentAt: string;
  status: string;
  fileUrl?: string;
  fileKey?: string; // Added fileKey to SentDocument type
  category?: string; // Added category to track if it's a reviewer document
  content?: string; // Added content to store filled HTML content
  direction?: "sent" | "received";
  recipientRole?: string;
  updatedAt?: string;
  signedAt?: string;
  reviewedAt?: string;
  approvedAt?: string;
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
  signed_file_url?: string | null;
  signed_content?: string | null;
  updated_at: string;
  signed_at?: string | null;
  reviewed_at?: string | null;
  approved_at?: string | null;
};

const mapRowToSentDocument = (row: DocumentRow, currentUserId: string, currentUserEmail: string): SentDocument[] => {
  const recipients = Array.isArray(row.recipients)
    ? row.recipients.map((recipient: Recipient) => {
        const mapped: Recipient = {
          name: recipient.name || "",
          email: recipient.email || "",
          role: recipient.role || "Signer",
          status: recipient.status || "pending",
        };
        
        const isBuggedContent = recipient.signed_content?.startsWith("data:image");
        
        if (recipient.signed_file_url) mapped.signed_file_url = recipient.signed_file_url;
        if (recipient.signed_content) {
          mapped.signed_content = isBuggedContent ? (row.content || "") : recipient.signed_content;
        }
        if (typeof recipient.reject_reason === "string") mapped.reject_reason = recipient.reject_reason;
        if (typeof recipient.sign_message === "string") mapped.sign_message = recipient.sign_message;
        return mapped;
      })
    : [];

  const isOwner = row.owner_id === currentUserId;
  const matchingRecipient = getMatchingRecipient(recipients, currentUserEmail);

  // External documents are hidden for recipients unless they are signed/completed.
  // But the OWNER (sender) must always see their sent external documents.
  const isExternal = (row.sender as any)?.isExternal;
  const isCompleted = ["signed", "reviewed", "approved", "completed"].includes(row.status);
  
  if (!isOwner && isExternal && !isCompleted) {
    return [];
  }

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
    updatedAt: row.updated_at,
    signedAt: row.signed_at || undefined,
    reviewedAt: row.reviewed_at || undefined,
    approvedAt: row.approved_at || undefined,
  }];
};

const getDocKind = (doc: SentDocument | { name: string }) => {
  const lower = doc.name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "image";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(doc|docx|txt|rtf)$/.test(lower)) return "doc";
  return "file";
};

export default function DocumentsPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<SentDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [viewingDoc, setViewingDoc] = useState<SentDocument | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [detailDoc, setDetailDoc] = useState<SentDocument | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [initialContent, setInitialContent] = useState("");
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pendingFileUrl, setPendingFileUrl] = useState<string | null>(null);
  const [pendingFileKey, setPendingFileKey] = useState<string | null>(null);

  const { startUpload, isUploading } = useUploadThing("documentUploader", {
    onClientUploadComplete: (res) => {
      if (res?.[0]) {
        setPendingFileUrl(res[0].url);
        setPendingFileKey(res[0].key);
      }
    },
    onUploadError: (err) => {
      alert("Upload failed: " + err.message);
    }
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && viewingDoc) {
      const file = e.target.files[0];
      setIsAnalyzing(true);
      try {
        const analysis = await analyzeDocumentFile(file);
        setEditedContent(analysis.textContent);
        setViewingDoc(prev => prev ? { ...prev, name: file.name.replace(/\.[^/.]+$/, "") } : null);
        // Start upload
        await startUpload([file]);
      } catch (error) {
        console.error("Analysis failed:", error);
        alert("Failed to analyze document.");
      } finally {
        setIsAnalyzing(false);
      }
    }
  };

  const handleSendToExistingRecipients = async (doc: SentDocument, highlightedContent: string) => {
    if (!doc.recipients || doc.recipients.length === 0) {
      alert("No recipients found for this document.");
      return;
    }

    setIsPersisting(true);
    try {
      // 1. Save changes to DB first
      const updatePayload: any = { content: highlightedContent };
      if (pendingFileUrl) updatePayload.file_url = pendingFileUrl;
      if (pendingFileKey) updatePayload.file_key = pendingFileKey;
      if (viewingDoc?.name) updatePayload.name = viewingDoc.name;

      const { error: updateError } = await supabase
        .from("documents")
        .update(updatePayload)
        .eq("id", doc.id);
      
      if (updateError) throw updateError;

      // 2. Trigger emails to all recipients
      const emailPromises = doc.recipients.map(recipient => 
        fetch('/api/send-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentId: doc.id,
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            senderName: doc.sender.fullName || "User",
            documentName: viewingDoc?.name || doc.name,
            subject: doc.subject || `Document Update: ${doc.name}`
          })
        }).then(res => res.json())
      );

      const results = await Promise.all(emailPromises);
      console.log("Direct send results:", results);

      // Check for any major failures
      const failures = results.filter(r => r.error);
      if (failures.length > 0) {
        console.warn("Some emails failed to send:", failures);
      }

      // Update local state and close
      setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, ...updatePayload, status: "waiting" } : d));
      setViewingDoc(null);
      setIsEditMode(false);
      setEditedContent(null);
      setPendingFileUrl(null);
      setPendingFileKey(null);
      
      // 3. Log event
      await logDocumentEvent(doc.id, "document_updated", { 
        recipients: doc.recipients.map(r => r.email),
        message: "Document edited and resent to all recipients" 
      });

      alert("Document updated and sent successfully to all recipients!");
    } catch (err) {
      console.error("Direct send failed:", err);
      alert("Failed to send: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsPersisting(false);
    }
  };


  useEffect(() => {
    let isMounted = true;

    const loadDocuments = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        
        // Use getSession first to avoid lock contention
        const { data: { session } } = await supabase.auth.getSession();
        let user = session?.user;
        
        if (!user) {
          const { data: { user: freshUser }, error: authError } = await supabase.auth.getUser();
          if (authError) {
            // Ignore stolen lock errors, we'll try again on next mount or via session changes
            if (authError.message?.includes("stole it")) return;
            throw authError;
          }
          user = freshUser ?? undefined;
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
          .select("id, owner_id, name, subject, recipients, sender, sent_at, status, file_url, file_key, category, content, updated_at, signed_at, reviewed_at, approved_at")
          .or(`owner_id.eq.${user.id},recipients.cs.[{"email":"${normalizeEmail(user.email)}"}]`)
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
          const timeKey = doc.sentAt ? doc.sentAt.substring(0, 16) : `no-time-${doc.id}`;
          // Include direction and unique ID in groupKey to prevent merging
          const groupKey = `${doc.direction}-${doc.id}`;

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
                const statusPriority = ["pending", "reviewing", "waiting", "signed", "reviewed", "approved", "completed", "rejected"];
                if (statusPriority.indexOf(newStatus) > statusPriority.indexOf(oldStatus)) {
                  acc[groupKey].recipients[existingRIndex] = {
                    ...existingR,
                    status: newStatus,
                    ...(newR.signed_file_url ? { signed_file_url: newR.signed_file_url } : {}),
                    ...(newR.signed_content ? { signed_content: newR.signed_content } : {}),
                    reject_reason: typeof newR.reject_reason === "string"
                      ? newR.reject_reason
                      : existingR.reject_reason,
                    sign_message: typeof newR.sign_message === "string"
                      ? newR.sign_message
                      : existingR.sign_message,
                  };
                } else if (newStatus === oldStatus || newR.signed_file_url || newR.signed_content || typeof newR.reject_reason === "string" || typeof newR.sign_message === "string") {
                  // Preserve signed/rejected fields even if status didn't advance or stayed the same
                  acc[groupKey].recipients[existingRIndex] = {
                    ...existingR,
                    ...(newR.signed_file_url ? { signed_file_url: newR.signed_file_url } : {}),
                    ...(newR.signed_content ? { signed_content: newR.signed_content } : {}),
                    reject_reason: typeof newR.reject_reason === "string"
                      ? newR.reject_reason
                      : existingR.reject_reason,
                    sign_message: typeof newR.sign_message === "string"
                      ? newR.sign_message
                      : existingR.sign_message,
                  };
                }
              }
            });
            const statusOrder: Record<string, number> = {
              "pending": 0,
              "reviewing": 1,
              "waiting": 2,
              "changes_requested": 3,
              "signed": 4,
              "reviewed": 5,
              "approved": 6,
              "completed": 7,
              "rejected": 8
            };
            const currentStatusIndex = statusOrder[acc[groupKey].status || "pending"] || 0;
            const newStatusIndex = statusOrder[doc.status || "pending"] || 0;
            // Update overall document status and content/fileUrl if new status is higher OR equal priority
            // Equal priority is important for capturing subsequent edits once a document is already 'rejected'
            if (newStatusIndex >= currentStatusIndex) {
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

  const handleDuplicate = async (doc: SentDocument) => {
    if (!userId) return;

    try {
      const { data, error } = await supabase
        .from("documents")
        .insert({
          owner_id: userId,
          name: `Copy of ${doc.name}`,
          subject: doc.subject,
          recipients: [], // Clear recipients for the duplicate
          sender: doc.sender,
          sent_at: doc.sentAt ? new Date(new Date(doc.sentAt).getTime() - 1000).toISOString() : new Date().toISOString(),
          status: "draft",
          file_url: doc.fileUrl || null,
          file_key: doc.fileKey || null,
          category: doc.category || null,
          content: doc.content || null,
        })
        .select()
        .single();

      if (error) throw error;
      
      // The real-time channel will handle the list update
      alert("Document duplicated successfully!");
      setOpenMenuId(null);
    } catch (err) {
      console.error("Failed to duplicate document:", err);
      alert("Failed to duplicate document. Please try again.");
    }
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

  const handleReset = () => {
    if (!confirm("Are you sure you want to discard all manual edits? This cannot be undone.")) return;
    setEditedContent(null);
    setIsEditMode(false);
  };

  const handleDownload = (doc: SentDocument) => {
    let targetUrl = doc.fileUrl;
    let targetContent = doc.content;
    let nameSuffix = "";
    
    if (doc.recipients.length === 1) {
       const r = doc.recipients[0];
       if (r.signed_file_url) targetUrl = r.signed_file_url;
       if (r.signed_content) targetContent = r.signed_content;
       nameSuffix = `_${r.name}`;
    }
    
    if (targetContent) {
      const blob = new Blob([targetContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${doc.name}${nameSuffix}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else if (targetUrl) {
      const link = document.createElement('a');
      link.href = targetUrl;
      link.download = `${doc.name}${nameSuffix}`;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setOpenMenuId(null);
  };



  const getPreview = (doc: SentDocument) => {
    const kind = getDocKind(doc);
    const preferFilePreview = Boolean(doc.fileUrl && (kind === "pdf" || kind === "doc"));

    if (preferFilePreview && doc.fileUrl) {
      if (kind === "pdf") {
        return <iframe src={`${doc.fileUrl}#toolbar=0&navpanes=0&scrollbar=0`} title={doc.name} className="h-full w-full border-0" />;
      }
      const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(doc.fileUrl)}&embedded=true`;
      return <iframe src={viewerUrl} title={doc.name} className="h-full w-full border-0" />;
    }

    // HTML content preview (scaled down)
    if (doc.content) {
      return (
        <div className="relative h-full w-full overflow-hidden bg-white">
          <div
            style={{
              transform: "scale(0.35)",
              transformOrigin: "top left",
              width: "286%",
              height: "286%",
              pointerEvents: "none",
            }}
            dangerouslySetInnerHTML={{ __html: doc.content }}
          />
        </div>
      );
    }

    if (kind === "image" && doc.fileUrl) {
      return <img src={doc.fileUrl} alt={doc.name} className="h-full w-full object-cover" />;
    }

    // Fallback: clean document icon placeholder (no subject/sign text)
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-50 via-white to-slate-100">
        <div className="flex h-12 w-10 flex-col items-end justify-start rounded-sm border border-slate-200 bg-white shadow-sm">
          <div className="mt-1.5 mr-1 h-1 w-5 rounded-full bg-slate-200" />
          <div className="mt-1 mr-1 h-1 w-6 rounded-full bg-slate-200" />
          <div className="mt-1 mr-1 h-1 w-4 rounded-full bg-slate-200" />
          <div className="mt-1 mr-1 h-1 w-6 rounded-full bg-slate-200" />
          <div className="mt-1 mr-1 h-1 w-3 rounded-full bg-slate-200" />
        </div>
        <p className="text-[10px] font-medium text-slate-400 truncate max-w-[80%]">{doc.name}</p>
      </div>
    );
  };

  const getStatusBadge = (doc: SentDocument) => {
    const { status, recipients, category, direction } = doc;
    const isSender = direction === "sent";

    if (isSender) {
      // Sender sees overall status across all recipients
      const totalCount = recipients.length;
      const rejectedCount = recipients.filter(
        (r) => (r as { status?: string }).status === "rejected"
      ).length;
      const completedCount = recipients.filter(
        (r) => ["signed", "reviewed", "approved", "completed"].includes((r as { status?: string }).status || "")
      ).length;

      if (totalCount > 0) {
        const rejectedRecipients = recipients.filter(r => (r as { status?: string }).status === "rejected");
        const changesRecipients = recipients.filter(r => (r as { status?: string }).status === "changes_requested");
        const rejectedNum = rejectedRecipients.length;
        const changesNum = changesRecipients.length;

        if (rejectedNum > 0) {
          const names = rejectedRecipients.map(r => r.name).join(", ");
          return (
            <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-semibold text-red-700">
              <XCircle className="mr-1 h-3 w-3" />
              {rejectedNum === 1 ? `Rejected by ${names}` : `${rejectedNum} Rejected (${names})`}
            </span>
          );
        }
        if (changesNum > 0) {
          const names = changesRecipients.map(r => r.name).join(", ");
          return (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700">
              <Clock className="mr-1 h-3 w-3" />
              {changesNum === 1 ? `Changes requested by ${names}` : `${changesNum} Changes Required (${names})`}
            </span>
          );
        }
        if (completedCount === totalCount) {
          const names = recipients.map(r => r.name).join(", ");
          const label = category === "Reviewer" 
            ? (totalCount === 1 ? `Approved by ${names}` : "Approved by All")
            : (totalCount === 1 ? (recipients[0]?.status === "reviewed" ? `Approved by ${names}` : `Signed by ${names}`) : "Signed by All");
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

      if (myStatus === "rejected") {
        return (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-semibold text-red-700">
            <XCircle className="mr-1 h-3 w-3" />
            Rejected
          </span>
        );
      }
      if (myStatus === "changes_requested") {
        return (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700">
            <Clock className="mr-1 h-3 w-3" />
            Changes Required
          </span>
        );
      }
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
            Approved
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
          Approved
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
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-semibold text-blue-700">
        <Clock className="mr-1 h-3 w-3" />
        Pending
      </span>
    );
  };

  const filteredDocuments = documents.filter((doc) => {
    if (activeFilter === "all") {/* noop */}
    else if (activeFilter === "pending") {
      if (doc.direction === "sent") {
        const hasRejection = doc.recipients.some(r => ["rejected", "changes_requested"].includes(r.status || ""));
        if (hasRejection || ["rejected", "changes_requested"].includes(doc.status)) return false;
        const allCompleted = doc.recipients.length > 0 && doc.recipients.every(r => ["signed", "reviewed", "approved", "completed"].includes(r.status || ""));
        if (allCompleted) return false;
      } else {
        const myRecipient = doc.recipientRole ? doc.recipients.find(r => r.role?.toLowerCase() === doc.recipientRole?.toLowerCase()) : doc.recipients.find(r => r.email === currentUserEmail);
        const myStatus = myRecipient?.status || doc.status;
        if (["rejected", "changes_requested"].includes(myStatus || "") || ["signed", "reviewed", "approved", "completed"].includes(myStatus || "")) return false;
      }
    }
    else if (activeFilter === "approved") {
      if (doc.direction === "sent") {
        const hasRejection = doc.recipients.some(r => ["rejected", "changes_requested"].includes(r.status || ""));
        if (hasRejection || ["rejected", "changes_requested"].includes(doc.status)) return false;
        const allSigned = doc.recipients.length > 0 && doc.recipients.every(r => ["signed", "completed"].includes(r.status || ""));
        if (!allSigned) return false;
      } else {
        const myRecipient = doc.recipientRole ? doc.recipients.find(r => r.role?.toLowerCase() === doc.recipientRole?.toLowerCase()) : doc.recipients.find(r => r.email === currentUserEmail);
        const myStatus = myRecipient?.status || doc.status;
        if (!["signed", "completed"].includes(myStatus || "")) return false;
      }
    }
    else if (activeFilter === "rejected") {
      if (doc.direction === "sent") {
        const hasRejection = doc.recipients.some(r => r.status === "rejected");
        if (!hasRejection) return false;
      } else {
        const myRecipient = doc.recipientRole ? doc.recipients.find(r => r.role?.toLowerCase() === doc.recipientRole?.toLowerCase()) : doc.recipients.find(r => r.email === currentUserEmail);
        const myStatus = myRecipient?.status || doc.status;
        if (myStatus !== "rejected") return false;
      }
    }
    else if (activeFilter === "changes") {
      if (doc.direction === "sent") {
        const hasChanges = doc.recipients.some(r => r.status === "changes_requested");
        const hasRejection = doc.recipients.some(r => r.status === "rejected");
        // Only show in "Changes Required" if there are changes but NO actual rejections
        if (!hasChanges || hasRejection) return false;
      } else {
        const myRecipient = doc.recipientRole ? doc.recipients.find(r => r.role?.toLowerCase() === doc.recipientRole?.toLowerCase()) : doc.recipients.find(r => r.email === currentUserEmail);
        const myStatus = myRecipient?.status || doc.status;
        if (myStatus !== "changes_requested") return false;
      }
    }
    else if (activeFilter === "received") {
      if (doc.direction === "sent") {
        const hasApprovedReview = doc.recipients.some(r => ["reviewed", "approved"].includes(r.status || ""));
        if (!hasApprovedReview && !["reviewed", "approved"].includes(doc.status)) return false;
      } else {
        const myRecipient = doc.recipientRole ? doc.recipients.find(r => r.role?.toLowerCase() === doc.recipientRole?.toLowerCase()) : doc.recipients.find(r => r.email === currentUserEmail);
        const myStatus = myRecipient?.status || doc.status;
        if (!["reviewed", "approved"].includes(myStatus)) return false;
      }
    }

    if (dateFilter !== "all") {
      const docDate = new Date(doc.sentAt);
      const now = new Date();
      const days = dateFilter === "7" ? 7 : dateFilter === "14" ? 14 : dateFilter === "30" ? 30 : 90;
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      if (docDate < cutoff) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchesName = doc.name.toLowerCase().includes(q);
      const matchesSubject = doc.subject.toLowerCase().includes(q);
      const matchesSender = doc.sender.fullName.toLowerCase().includes(q) || doc.sender.workEmail.toLowerCase().includes(q);
      const matchesRecipient = doc.recipients.some(r => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
      if (!matchesName && !matchesSubject && !matchesSender && !matchesRecipient) return false;
    }

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
          Shared documents
        </h1>
        <p className="mt-2 text-sm text-slate-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="px-2 pb-8 pt-0 md:px-4 md:pb-10 md:pt-0">
      <div className="flex flex-wrap items-center gap-4 mt-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, company, email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-slate-400 text-slate-800 placeholder:text-slate-400"
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {[{ value: "all", label: "All" }, { value: "pending", label: "Pending" }, { value: "approved", label: "Signed" }, { value: "rejected", label: "Rejected" }, { value: "changes", label: "Changes Required" }, { value: "received", label: "Approved" }].map((tag) => (
          <button
            key={tag.value}
            onClick={() => setActiveFilter(tag.value)}
            className={`rounded-full px-5 py-1.5 text-xs font-semibold transition-all ${activeFilter === tag.value
              ? "bg-violet-600 text-white shadow-md shadow-violet-200"
              : "bg-white border border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600 shadow-sm"
              }`}
          >
            {tag.label}
          </button>
        ))}

        <div className="ml-auto inline-flex items-center gap-2">
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-full px-4 py-2 text-xs font-semibold bg-white border border-slate-200 text-slate-600 shadow-sm hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 cursor-pointer"
          >
            <option value="all">All Time</option>
            <option value="7">Last 7 Days</option>
            <option value="14">Last 14 Days</option>
            <option value="30">Last 30 Days</option>
            <option value="90">Last 90 Days</option>
          </select>

          <div className="inline-flex items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm">
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
              <div className="flex items-start justify-between gap-3 px-2 pb-3 pt-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${getDocKind(doc) === "pdf" ? "bg-red-100 text-red-600" : getDocKind(doc) === "image" ? "bg-emerald-100 text-emerald-600" : "bg-blue-100 text-blue-600"}`}>
                    {getDocKind(doc) === "image" ? <ImageIcon className="h-4 w-4" /> : getDocKind(doc) === "pdf" ? "PDF" : <FileImage className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 pr-10 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900" title={doc.name}>
                      {doc.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {doc.subject?.replace(/^Please\s+/i, "")}
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
                        const myRecipient = currentUserEmail ? doc.recipients.find(r => normalizeEmail(r.email) === currentUserEmail) : null;
                        const myStatus = myRecipient?.status || "pending";
                        const showSignButton = doc.direction === "received" && !["signed", "reviewed", "approved", "completed"].includes(myStatus);

                        const isReviewer = myRecipient?.role === "reviewer" || doc.category === "Reviewer" || doc.status === "reviewing";
                        const buttonLabel = isReviewer ? "Review Document" : "Sign Document";
                        const ButtonIcon = isReviewer ? Eye : PenLine;

                        if (showSignButton) {
                          return (
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                router.push(`/sign/${doc.id}`);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                            >
                              <ButtonIcon className="h-3 w-3" />
                              {buttonLabel}
                            </button>
                          );
                        }

                        const signedFileUrl = myRecipient?.signed_file_url;
                        const signedContent = myRecipient?.signed_content;
                        const displayFileUrl = signedFileUrl || doc.fileUrl;
                        const displayContent = signedContent || doc.content;

                        const hasSigned = doc.recipients.some(r => r.status === "signed" || r.status === "reviewed");
                        if (hasSigned && displayFileUrl) {
                          return (
                            <a
                              href={displayFileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setOpenMenuId(null)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                            >
                              <Eye className="h-3 w-3" />
                              View Signed
                            </a>
                          );
                        }
                        if (displayContent) {
                          return (
                            <>
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setViewingDoc({ ...doc, content: displayContent });
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                              >
                                <Eye className="h-3 w-3" />
                                View
                              </button>
                              {doc.direction === "sent" && (() => {
                                const totalCount = doc.recipients.length;
                                const anyChangesRequired = doc.recipients.some(
                                  (r) => ["rejected", "changes_requested"].includes(r.status || "")
                                );
                                const completedCount = doc.recipients.filter(
                                  (r) => ["signed", "reviewed", "approved", "completed"].includes(r.status || "")
                                ).length;

                                const isPending = totalCount > 0 
                                    ? (!anyChangesRequired && completedCount !== totalCount)
                                    : (!["reviewed", "approved", "signed", "completed", "reviewing", "rejected", "changes_requested"].includes(doc.status) && doc.category !== "Reviewer");

                                if (!isPending) return null;

                                return (
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      const currentHtml = displayContent || "";
                                      const cleanHtml = stripHighlights(currentHtml);
                                      setInitialContent(cleanHtml);
                                      setViewingDoc({ ...doc, content: cleanHtml });
                                      setIsEditMode(true);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                                  >
                                    <Edit3 className="h-3 w-3" />
                                    Edit Document
                                  </button>
                                );
                              })()}
                            </>
                          );
                        }
                        if (displayFileUrl) {
                          return (
                            <a
                              href={displayFileUrl}
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
                        onClick={() => handleDownload(doc)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </button>
                      {(() => {
                        const isSender = doc.direction === "sent";
                        const totalCount = doc.recipients.length;
                        const anyChangesRequired = doc.recipients.some(
                          (r) => ["rejected", "changes_requested"].includes(r.status || "")
                        );
                        const completedCount = doc.recipients.filter(
                          (r) => ["signed", "reviewed", "approved", "completed"].includes(r.status || "")
                        ).length;

                        const isPending = isSender && (
                          totalCount > 0 
                            ? (!anyChangesRequired && completedCount !== totalCount)
                            : (!["reviewed", "approved", "signed", "completed", "reviewing", "rejected", "changes_requested"].includes(doc.status) && doc.category !== "Reviewer")
                        );

                        if (!isPending) return null;

                        return (
                          <button
                            onClick={() => handleDuplicate(doc)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                          >
                            <Copy className="h-3 w-3" />
                            Duplicate
                          </button>
                        );
                      })()}
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

              <div className="mx-2 h-40 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {getPreview(doc)}
              </div>

              {isRenaming === doc.id && (
                <div className="mt-3 flex gap-2 px-2">
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

              <div className="mt-4 flex items-center gap-2 px-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-500 text-xs font-semibold text-white">
                  {(doc.sender.fullName || "P").charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col min-w-0">
                  <p className="truncate text-xs text-slate-600">
                    {doc.direction === "received"
                      ? `Received from ${doc.sender.fullName || doc.sender.workEmail}`
                      : doc.status === "completed"
                        ? "Uploaded"
                        : "Sent"} • {formatDate(doc.sentAt)}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-slate-500 font-medium">
                    Received , {formatDate(doc.signedAt || doc.reviewedAt || doc.approvedAt || doc.updatedAt || doc.sentAt)}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-200 bg-white/50 px-2 py-3">
                <div>{getStatusBadge(doc)}</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (doc.status === "draft") {
                        setViewingDoc(doc);
                      } else {
                        setDetailDoc(doc);
                      }
                    }}
                    className="text-[11px] font-semibold text-slate-700 hover:text-violet-600 transition-all flex items-center gap-1 border border-slate-300 px-2.5 py-1 rounded-full hover:border-violet-300"
                  >
                    <ArrowUpRight className="h-3 w-3" />
                    {doc.status === "draft" ? "View" : "View More"}
                  </button>

                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {filteredDocuments.map((doc, index) => (
            <div key={`${doc.id}-${index}`} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-2 py-4 shadow-sm">
              <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                {getPreview(doc)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{doc.name}</p>
                  {getStatusBadge(doc)}
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">{doc.subject?.replace(/^Please\s+/i, "")}</p>
                <p className="mt-2 truncate text-xs text-slate-400">
                  {doc.recipients.map((r) => r.email).join(", ")} • {formatDate(doc.sentAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => {
                    if (doc.status === "draft") {
                      setViewingDoc(doc);
                    } else {
                      setDetailDoc(doc);
                    }
                  }} 
                  className="rounded-full border border-slate-300 px-3.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-violet-300 hover:text-violet-600"
                >
                  {doc.status === "draft" ? "View" : "View More"}
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
                      const myRecipient = currentUserEmail ? doc.recipients.find(r => normalizeEmail(r.email) === currentUserEmail) : null;
                      const signedFileUrl = myRecipient?.signed_file_url;
                      const signedContent = myRecipient?.signed_content;
                      const displayFileUrl = signedFileUrl || doc.fileUrl;
                      const displayContent = signedContent || doc.content;

                      const hasSigned = doc.recipients.some(r => r.status === "signed" || r.status === "reviewed");
                      if (hasSigned && displayFileUrl) {
                        return (
                          <a href={displayFileUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpenMenuId(null)} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                            <Eye className="h-3 w-3" />View Signed
                          </a>
                        );
                      }
                      if (displayContent) {
                        return (
                          <>
                            <button onClick={() => { setOpenMenuId(null); setViewingDoc({ ...doc, content: displayContent }); }} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                              <Eye className="h-3 w-3" />View
                            </button>
                            {doc.direction === "sent" && (() => {
                              const totalCount = doc.recipients.length;
                              const anyChangesRequired = doc.recipients.some(
                                (r) => ["rejected", "changes_requested"].includes(r.status || "")
                              );
                              const completedCount = doc.recipients.filter(
                                (r) => ["signed", "reviewed", "approved", "completed"].includes(r.status || "")
                              ).length;

                              const isPending = totalCount > 0 
                                  ? (!anyChangesRequired && completedCount !== totalCount)
                                  : (!["reviewed", "approved", "signed", "completed", "reviewing", "rejected", "changes_requested"].includes(doc.status) && doc.category !== "Reviewer");

                              if (!isPending) return null;

                              return (
                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    const currentHtml = displayContent || "";
                                    const cleanHtml = stripHighlights(currentHtml);
                                    setInitialContent(cleanHtml);
                                    setViewingDoc({ ...doc, content: cleanHtml });
                                    setIsEditMode(true);
                                  }}
                                  className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-violet-600 hover:bg-violet-50 flex items-center gap-2"
                                >
                                  <Edit3 className="h-3 w-3" />
                                  Edit Document
                                </button>
                              );
                            })()}
                          </>
                        );
                      }
                      if (displayFileUrl) {
                        return (
                          <a href={displayFileUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpenMenuId(null)} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                            <Eye className="h-3 w-3" />View
                          </a>
                        );
                      }
                      return null;
                    })()}
                    <button onClick={() => handleDownload(doc)} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50">Download</button>
                    {(() => {
                      const isSender = doc.direction === "sent";
                      const totalCount = doc.recipients.length;
                      const anyChangesRequired = doc.recipients.some(
                        (r) => ["rejected", "changes_requested"].includes(r.status || "")
                      );
                      const completedCount = doc.recipients.filter(
                        (r) => ["signed", "reviewed", "approved", "completed"].includes(r.status || "")
                      ).length;

                      const isPending = isSender && (
                        totalCount > 0 
                          ? (!anyChangesRequired && completedCount !== totalCount)
                          : (!["reviewed", "approved", "signed", "completed", "reviewing", "rejected", "changes_requested"].includes(doc.status) && doc.category !== "Reviewer")
                      );

                      if (!isPending) return null;

                      return (
                        <button onClick={() => handleDuplicate(doc)} className="w-full rounded-lg px-3 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50">Duplicate</button>
                      );
                    })()}
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
            <div className="flex items-center gap-3">
              {(() => {
                 const isReviewer = viewingDoc.category?.toLowerCase() === "reviewer" || viewingDoc.recipientRole?.toLowerCase() === "reviewer";
                 const isSender = viewingDoc.direction === "sent";
                 const canEdit = !["signed", "reviewed", "approved", "completed"].includes(viewingDoc.status);
                 
                 // Both senders and reviewers with pending documents can edit
                 if ((isSender || (isReviewer && canEdit))) {
                   return (
                      <div className="flex items-center gap-2">
                        {viewingDoc.direction === "sent" && (
                          <button
                            onClick={() => {
                              if (!isEditMode) setIsEditMode(true);
                              fileInputRef.current?.click();
                            }}
                            disabled={isUploading || isAnalyzing}
                            className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-sm bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {isUploading || isAnalyzing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CloudUpload className="h-3.5 w-3.5 text-violet-600" />
                            )}
                            Upload Other Document
                          </button>
                        )}
                        {viewingDoc.direction === "sent" && viewingDoc.recipients.length > 0 && (
                          <button
                            onClick={() => {
                              const contentDiv = document.querySelector('.editable-content');
                              let currentContent = contentDiv ? contentDiv.innerHTML : (editedContent || initialContent || viewingDoc.content || "");
                              
                              // If still in edit mode, ensure highlighting is applied before sending
                              if (isEditMode && contentDiv) {
                                currentContent = highlightHtmlEdits(initialContent, contentDiv.innerHTML);
                              }
                              
                              handleSendToExistingRecipients(viewingDoc, currentContent);
                            }}
                            disabled={isUploading || isAnalyzing || isPersisting}
                            className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                          >
                            {isPersisting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            )}
                            Send Edited Document
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (isEditMode) {
                               const contentDiv = document.querySelector('.editable-content');
                               if (contentDiv) {
                                 const newHtml = contentDiv.innerHTML;
                                 const highlighted = highlightHtmlEdits(initialContent, newHtml);
                                 setEditedContent(highlighted);
                               }
                            } else {
                               if (!initialContent) {
                                 setInitialContent(viewingDoc.content || "");
                               }
                            }
                            setIsEditMode(!isEditMode);
                          }}
                          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-sm ${isEditMode ? 'bg-green-600 text-white shadow-green-200' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                          {isEditMode ? <><Save className="h-3.5 w-3.5" /> Stop Editing</> : <><Edit3 className="h-3.5 w-3.5" /> Edit Document</>}
                        </button>
                      </div>
                   );
                 }
                 return null;
              })()}

              {editedContent && (
                <button
                  onClick={handleReset}
                  className="flex items-center justify-center w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-red-600 hover:bg-red-50 transition-all shadow-sm group"
                  title="Reset all edits"
                >
                  <RotateCcw className="h-4 w-4 transition-transform group-hover:rotate-[-45deg]" />
                </button>
              )}

              {viewingDoc && (
                <button
                  onClick={async () => {
                    const isSender = viewingDoc.direction === "sent";
                    if (isEditMode) {
                      const contentDiv = document.querySelector('.editable-content');
                      const cleanHtml = contentDiv ? contentDiv.innerHTML : (editedContent || initialContent || viewingDoc.content || "");
                      const highlighted = cleanHtml;

                      
                      setIsPersisting(true);
                      try {
                        const updatePayload: any = { content: highlighted };
                        if (pendingFileUrl) updatePayload.file_url = pendingFileUrl;
                        if (pendingFileKey) updatePayload.file_key = pendingFileKey;
                        if (viewingDoc.name) updatePayload.name = viewingDoc.name;

                        if (isSender) {
                          const { error } = await supabase
                            .from("documents")
                            .update(updatePayload)
                            .eq("id", viewingDoc.id);
                          if (error) throw error;
                          setDocuments(prev => prev.map(d => d.id === viewingDoc.id ? { ...d, ...updatePayload } : d));
                        } else {
                          const { error } = await supabase
                            .from("documents")
                            .update({ ...updatePayload, status: "reviewed" })
                            .eq("id", viewingDoc.id);
                          if (error) throw error;
                          setDocuments(prev => prev.map(d => d.id === viewingDoc.id ? { ...d, ...updatePayload, status: "reviewed" } : d));
                        }
                        setIsEditMode(false);
                        setEditedContent(null);
                        setPendingFileUrl(null);
                        setPendingFileKey(null);
                      } catch (err) {
                        alert("Failed to save changes before sending: " + (err instanceof Error ? err.message : String(err)));
                        setIsPersisting(false);
                        return; // Stop if save fails
                      } finally {
                        setIsPersisting(false);
                      }
                    }
                    router.push(`/dashboard/templates?step=type_selection&documentId=${encodeURIComponent(viewingDoc.id)}`);
                  }}
                  disabled={isPersisting}
                  className="flex items-center gap-2 rounded-xl bg-green-600 px-6 py-2 text-xs font-bold text-white shadow-lg shadow-green-200 hover:bg-green-700 transition-all ml-2 disabled:opacity-50"
                >
                  {isPersisting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  )}
                  {viewingDoc.status === "draft" ? "Send to others" : "Send"}
                </button>
              )}

              {isEditMode && !viewingDoc.direction?.includes("sent") && (() => {
                const isSender = viewingDoc.direction === "sent";
                return (
                  <button
                    onClick={async () => {
                      const contentDiv = document.querySelector('.editable-content');
                      const cleanHtml = contentDiv ? contentDiv.innerHTML : (editedContent || initialContent || viewingDoc.content || "");
                      const highlighted = cleanHtml;

                      
                      setIsPersisting(true);
                      try {
                        if (isSender) {
                          // Sender: update content only, keep original status so recipients can still sign/review
                          const updatePayload: any = { content: highlighted };
                          if (pendingFileUrl) updatePayload.file_url = pendingFileUrl;
                          if (pendingFileKey) updatePayload.file_key = pendingFileKey;
                          if (viewingDoc.name) updatePayload.name = viewingDoc.name;

                          const { error } = await supabase
                            .from("documents")
                            .update(updatePayload)
                            .eq("id", viewingDoc.id);
                          if (error) throw error;
                          setDocuments(prev => prev.map(d => d.id === viewingDoc.id ? { ...d, ...updatePayload } : d));
                        } else {
                          // Reviewer: update content and mark as reviewed
                          const updatePayload: any = { content: highlighted, status: "reviewed" };
                          if (pendingFileUrl) updatePayload.file_url = pendingFileUrl;
                          if (pendingFileKey) updatePayload.file_key = pendingFileKey;
                          if (viewingDoc.name) updatePayload.name = viewingDoc.name;

                          const { error } = await supabase
                            .from("documents")
                            .update(updatePayload)
                            .eq("id", viewingDoc.id);
                          if (error) throw error;
                          setDocuments(prev => prev.map(d => d.id === viewingDoc.id ? { ...d, ...updatePayload } : d));
                        }
                        setViewingDoc(null);
                        setIsEditMode(false);
                        setEditedContent(null);
                        setPendingFileUrl(null);
                        setPendingFileKey(null);
                      } catch (err) {
                        alert("Failed to save edits: " + (err instanceof Error ? err.message : String(err)));
                      } finally {
                        setIsPersisting(false);
                      }
                    }}
                    disabled={isPersisting}
                    className="flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-2 text-xs font-bold text-white shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all disabled:opacity-50"
                  >
                    {isPersisting 
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : isSender
                        ? <><ArrowUpRight className="h-3.5 w-3.5" /> Send Edited Document</>
                        : <><ShieldCheck className="h-3.5 w-3.5" /> Finalize Review</>
                    }
                  </button>
                );
              })()}

              <button
                onClick={() => setViewingDoc(null)}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Document Content */}
          <div className="flex-1 overflow-y-auto bg-slate-100/50 py-8 px-4 flex">
            <div className="w-[800px] min-h-[1056px] mx-auto shrink-0 relative">
              <div className="relative w-full min-h-[1056px] bg-white rounded-lg shadow-xl shadow-slate-200/50 border border-slate-200">
                <div
                  contentEditable={isEditMode}
                  suppressContentEditableWarning
                  className={`editable-content document-content min-h-[1056px] p-12 md:p-16 text-[15px] text-slate-800 leading-[1.9] tracking-tight outline-none transition-all duration-300 ${isEditMode ? 'ring-4 ring-amber-100 bg-amber-50/10 rounded-xl' : ''}`}
                  style={{
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  }}
                  dangerouslySetInnerHTML={{
                    __html: (() => {
                      const baseHtml = editedContent || viewingDoc.content || "";
                      if (isEditMode) return baseHtml.replace(/\n/g, "<br/>");
                      
                      // Apply highlighting ONLY if local edits exist and it's not a draft
                      const highlighted = baseHtml;


                      return highlighted
                        .replace(/\n/g, "<br/>")
                        .replace(/<strong>/g, '<strong style="font-weight:700; color:#0f172a;">');
                    })()
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden File Input for Uploading Replacement */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        accept="application/pdf,image/*,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv,.txt,.csv"
      />

      {/* Document Detail / Status Modal */}

      {detailDoc && (
        <DocumentDetailModal
          doc={detailDoc}
          onClose={() => setDetailDoc(null)}
          formatDate={formatDate}
          router={router}
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
  router,
}: {
  doc: SentDocument;
  onClose: () => void;
  formatDate: (d: string) => string;
  router: any;
}) {
  const [viewingRecipient, setViewingRecipient] = useState<string | null>(null);
  const [refreshedDoc, setRefreshedDoc] = useState<SentDocument>(doc);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  
  const [isEditMode, setIsEditMode] = useState(false);
  const [initialContent, setInitialContent] = useState("");
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);

  const isSender = doc.direction === "sent";

  // Fetch events
  useEffect(() => {
    const fetchEvents = async () => {
      const { data, error } = await supabase
        .from("document_events")
        .select("*")
        .eq("document_id", doc.id)
        .order("created_at", { ascending: true });
      if (!error && data) setEvents(data);
    };
    fetchEvents();
  }, [doc.id]);

  // Fetch current user email
  useEffect(() => {
    supabase.auth.getUser().then(({ data }: { data: any }) => {
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
          const rawRecipients = freshDoc.recipients as Array<{ name: string; email: string; role: string; status?: string; signed_file_url?: string; signed_content?: string; reject_reason?: string | null; sign_message?: string | null }> | null;
          const mappedRecipients = (rawRecipients ?? []).map((r) => {
            const isBuggedContent = r.signed_content?.startsWith("data:image");
            return {
              name: r.name || "",
              email: r.email || "",
              role: r.role || "",
              status: r.status,
              signed_file_url: r.signed_file_url,
              signed_content: isBuggedContent ? (freshDoc.content || "") : r.signed_content,
              reject_reason: r.reject_reason,
              sign_message: r.sign_message,
            };
          });

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
  const isSingleRecipient = currentDoc.recipients.length <= 1;

  const getRoleLabel = (r: { role: string }) => {
    // If the whole document is in review category, the recipient is a reviewer
    if (currentDoc.category === "Reviewer" || currentDoc.status === "reviewing") return "Reviewer";
    
    const role = r.role?.toLowerCase();
    if (role === "reviewer") return "Reviewer";
    return "Signer";
  };

  const getRecipientStatusLabel = (r: { name: string; email: string; role: string; status?: string }) => {
    const s = (r as { status?: string }).status;
    const name = r.name || "Recipient";
    if (s === "rejected") return `Rejected by ${name}`;
    if (s === "changes_requested") return `Changes requested by ${name}`;
    if (s === "signed") return `Signed by ${name}`;
    if (s === "reviewed") return `Approved by ${name}`;
    if (s === "approved") return `Approved by ${name}`;
    return "Pending";
  };

  const getRecipientStatusColor = (r: { name: string; email: string; role: string; status?: string }) => {
    const s = (r as { status?: string }).status;
    if (s === "rejected") return "bg-red-100 text-red-700";
    if (s === "changes_requested") return "bg-amber-100 text-amber-700";
    if (s === "signed" || s === "reviewed" || s === "approved") return "bg-green-100 text-green-700";
    return "bg-amber-100 text-amber-700";
  };

  const getRecipientIcon = (r: { name: string; email: string; role: string; status?: string }) => {
    const s = (r as { status?: string }).status;
    if (s === "rejected") return <XCircle className="h-3.5 w-3.5" />;
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
      const name = myRecipient?.name || "You";
      if (s === "rejected") return `Rejected by ${name}`;
      if (s === "changes_requested") return `Changes requested by ${name}`;
      if (s === "signed") return `Signed by ${name}`;
      if (s === "reviewed") return `Approved by ${name}`;
      if (s === "approved") return `Approved by ${name}`;
      return "Pending";
    }

    const totalCount = currentDoc.recipients.length;
    const rejectedRecipients = currentDoc.recipients.filter(r => (r as { status?: string }).status === "rejected");
    const changesRecipients = currentDoc.recipients.filter(r => (r as { status?: string }).status === "changes_requested");
    const completedCount = currentDoc.recipients.filter(
      (r) => ["signed", "reviewed", "approved", "completed"].includes((r as { status?: string }).status || "")
    ).length;

    const rejectedCount = rejectedRecipients.length;
    const changesCount = changesRecipients.length;

    // Multi-recipient logic: prioritize Rejected > Changes Required
    if (totalCount > 0) {
      if (rejectedCount > 0) {
        const names = rejectedRecipients.map(r => r.name).join(", ");
        return rejectedCount === totalCount ? `Rejected by ${names}` : `${rejectedCount} Rejected (${names})`;
      }
      if (changesCount > 0) {
        const names = changesRecipients.map(r => r.name).join(", ");
        return changesCount === totalCount ? `Changes requested by ${names}` : `${changesCount} Changes Required (${names})`;
      }
      if (completedCount === totalCount) {
        const names = currentDoc.recipients.map(r => r.name).join(", ");
        return totalCount === 1 
          ? (currentDoc.recipients[0]?.status === "reviewed" ? `Approved by ${names}` : `Signed by ${names}`)
          : "Finished by All";
      }
      return "Pending";
    }

    // Check document-level status for documents with no recipients
    if (currentDoc.status === "rejected") return "Rejected";
    if (currentDoc.status === "changes_requested") return "Changes Required";
    if (currentDoc.status === "reviewed") return "Approved";
    if (currentDoc.status === "approved") return "Approved";
    if (currentDoc.status === "signed" || currentDoc.status === "completed") return "Signed";
    if (currentDoc.status === "reviewing") return "Under Review";
    if (currentDoc.status === "waiting") return "Awaiting Signer";
    return "Pending";
  };

  const getOverallStatusColor = () => {
    if (!isSender && currentDoc.recipients.length > 0) {
      const myRecipient = currentUserEmail
        ? currentDoc.recipients.find(r => normalizeEmail(r.email) === currentUserEmail)
        : currentDoc.recipients[0];
      const s = myRecipient?.status;
      if (s === "rejected") return "bg-red-100 text-red-700 border-red-200";
      if (s === "changes_requested") return "bg-amber-100 text-amber-700 border-amber-200";
      if (s === "signed" || s === "reviewed" || s === "approved") return "bg-green-100 text-green-700 border-green-200";
      return "bg-amber-100 text-amber-700 border-amber-200";
    }

    const totalCount = currentDoc.recipients.length;
    const rejectedCount = currentDoc.recipients.filter(
      (r) => ["rejected", "changes_requested"].includes((r as { status?: string }).status || "")
    ).length;
    const completedCount = currentDoc.recipients.filter(
      (r) => ["signed", "reviewed", "approved", "completed"].includes((r as { status?: string }).status || "")
    ).length;

    // Multi-recipient logic first
    if (totalCount > 0) {
      const rejectedCount = currentDoc.recipients.filter(r => (r as { status?: string }).status === "rejected").length;
      if (rejectedCount > 0) return "bg-red-100 text-red-700 border-red-200";
      const changesCount = currentDoc.recipients.filter(r => (r as { status?: string }).status === "changes_requested").length;
      if (changesCount > 0) return "bg-amber-100 text-amber-700 border-amber-200";
      if (completedCount === totalCount) return "bg-green-100 text-green-700 border-green-200";
      return "bg-blue-100 text-blue-700 border-blue-200";
    }

    // Check document-level status for documents with no recipients
    if (currentDoc.status === "rejected" || currentDoc.status === "changes_requested") return "bg-amber-100 text-amber-700 border-amber-200";
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
      if (s === "rejected") return <XCircle className="h-5 w-5" />;
      if (s === "signed" || s === "reviewed" || s === "approved") return <CheckCircle2 className="h-5 w-5" />;
      return <Clock className="h-5 w-5" />;
    }

    const totalCount = currentDoc.recipients.length;
    const rejectedCount = currentDoc.recipients.filter(
      (r) => ["rejected", "changes_requested"].includes((r as { status?: string }).status || "")
    ).length;
    const completedCount = currentDoc.recipients.filter(
      (r) => ["signed", "reviewed", "approved"].includes((r as { status?: string }).status || "")
    ).length;

    // Multi-recipient logic first
    if (totalCount > 0) {
      if (rejectedCount > 0) return <XCircle className="h-5 w-5" />;
      if (completedCount === totalCount) return <CheckCircle2 className="h-5 w-5" />;
      return <Clock className="h-5 w-5" />;
    }

    // Check document-level status for documents with no recipients
    if (currentDoc.status === "rejected") return <XCircle className="h-5 w-5" />;
    if (["signed", "completed", "reviewed", "approved"].includes(currentDoc.status)) return <CheckCircle2 className="h-5 w-5" />;
    return <Clock className="h-5 w-5" />;
  };

  // Counts for multi-recipient summary
  const completedCount = currentDoc.recipients.filter(
    (r) => ["signed", "reviewed", "approved"].includes((r as { status?: string }).status || "")
  ).length;
  const pendingCount = currentDoc.recipients.length - completedCount;

  const handleDownload = (recipientEmail?: string) => {
    let targetFileUrl = currentDoc.fileUrl;
    let targetContent = currentDoc.content;
    let recipientName = "document";

    if (recipientEmail) {
      const normalizedEmail = normalizeEmail(recipientEmail);
      const recipient = currentDoc.recipients.find(r => normalizeEmail(r.email) === normalizedEmail);
      if (recipient) {
        recipientName = recipient.name;
        if (recipient.signed_file_url) targetFileUrl = recipient.signed_file_url;
        if (recipient.signed_content) targetContent = recipient.signed_content;
      }
    } else if (currentDoc.recipients.length === 1) {
      const recipient = currentDoc.recipients[0];
      recipientName = recipient.name;
      if (recipient.signed_file_url) targetFileUrl = recipient.signed_file_url;
      if (recipient.signed_content) targetContent = recipient.signed_content;
    }

    if (targetContent) {
      const blob = new Blob([targetContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${currentDoc.name}_${recipientName}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else if (targetFileUrl) {
      const link = document.createElement("a");
      link.href = targetFileUrl;
      link.download = `${currentDoc.name}_${recipientName}`;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
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
        <div className="flex items-center gap-3">
          {isSender && (getOverallStatusLabel().includes("Approved") || refreshedDoc.status === "approved" || refreshedDoc.status === "reviewed") && (
            <button
              onClick={() => router.push(`/dashboard/templates?step=type_selection&documentId=${encodeURIComponent(refreshedDoc.id)}`)}
              className="inline-flex items-center gap-1.5 rounded-full bg-green-600 border border-green-700 px-4 py-1.5 text-[11px] font-bold text-white hover:bg-green-700 transition-colors shadow-sm"
            >
              <ArrowUpRight className="h-3 w-3" />
              Send
            </button>
          )}
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
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

          {/* Status Card - always same table layout */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Status</h3>
              {isSender && (["Reviewed", "Finished", "Approved"].includes(getOverallStatusLabel())) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    console.log("Redirecting to templates with doc ID:", refreshedDoc.id);
                    router.push(`/dashboard/templates?step=type_selection&documentId=${encodeURIComponent(refreshedDoc.id)}`);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-green-600 border border-green-700 px-4 py-1.5 text-[11px] font-bold text-white hover:bg-green-700 transition-colors shadow-sm"
                >
                  <ArrowUpRight className="h-3 w-3" />
                  Send
                </button>
              )}
            </div>
            <div className="px-6 pb-4">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="py-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Recipient</th>
                    <th className="py-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Email</th>
                    <th className="py-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Role</th>
                    <th className="py-3 pr-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</th>
                    <th className="py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Action</th>
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
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${getRecipientStatusColor(r)}`}>
                            {getRecipientIcon(r)}
                            {getRecipientStatusLabel(r)}
                          </span>
                          {(r.status === "rejected" || r.status === "changes_requested") && (
                            <p className="text-[10px] text-slate-500 pl-1">
                              <span className="font-semibold text-amber-500">Msg: </span>
                              {r.reject_reason?.trim() || "No message"}
                            </p>
                          )}
                          {["signed", "reviewed", "approved"].includes(r.status || "") && r.sign_message?.trim() && (
                            <p className="text-[10px] text-slate-500 pl-1">
                              <span className="font-semibold text-green-500">Msg: </span>
                              {r.sign_message?.trim()}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-1.5">
                          {(currentDoc.content || currentDoc.fileUrl) && (
                            <button
                              onClick={() => setViewingRecipient(r.email)}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:border-violet-300 hover:text-violet-600 transition-all"
                            >
                              <Eye className="h-3 w-3" />
                              View
                            </button>
                          )}
                          {(currentDoc.fileUrl || currentDoc.content) && (
                            <button
                              onClick={() => handleDownload(r.email)}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:border-violet-300 hover:text-violet-600 transition-all"
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

          {/* Reject Message Card */}
          {(() => {
            const rejectRecipient = currentDoc.recipients.find(r => ["rejected", "changes_requested"].includes(r.status || ""));
            if (!rejectRecipient) return null;
            return (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 shadow-sm overflow-hidden">
                <div className="px-6 py-4 flex items-start gap-3">
                  <Clock className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-amber-700">Changes Required</p>
                    <p className="text-sm text-amber-600 mt-1 whitespace-pre-wrap">
                      {rejectRecipient.reject_reason?.trim() || "No message provided"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Sign Message Card */}
          {(() => {
            const signRecipient = currentDoc.recipients.find(r => ["signed", "reviewed", "approved"].includes(r.status || ""));
            if (!signRecipient || !signRecipient.sign_message?.trim()) return null;
            return (
              <div className="rounded-2xl border border-green-200 bg-green-50 shadow-sm overflow-hidden">
                <div className="px-6 py-4 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-green-700">Message from Signer</p>
                    <p className="text-sm text-green-600 mt-1 whitespace-pre-wrap">
                      {signRecipient.sign_message?.trim()}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Progress Tracking Timeline */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-2">
              <History className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-bold text-slate-900">Progress Tracking</h3>
            </div>
            <div className="px-6 py-6">
              <div className="relative space-y-6">
                {/* Vertical line */}
                <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-slate-100" />

                {/* Initial Send (System Event) */}
                <div className="relative flex gap-4">
                  <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 ring-4 ring-white">
                    <SendIcon className="h-3 w-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-900">Document Sent</p>
                      <time className="text-[10px] text-slate-400">{formatDate(currentDoc.sentAt)}</time>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Sent by {currentDoc.sender.fullName || currentDoc.sender.workEmail} to {currentDoc.recipients.length} {currentDoc.recipients.length === 1 ? 'recipient' : 'recipients'}.
                    </p>
                  </div>
                </div>

                {/* Dynamic Events from document_events table */}
                {events.map((event, idx) => {
                  const isUpdate = event.event_type === 'document_updated';
                  const isSigned = event.event_type === 'document_signed';
                  const isReviewed = event.event_type === 'document_reviewed';
                  const isRejected = event.event_type === 'document_rejected';
                  
                  let icon = <Clock className="h-3 w-3" />;
                  let bgColor = "bg-slate-100 text-slate-600";
                  let title = event.event_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

                  if (isUpdate) { icon = <Edit2 className="h-3 w-3" />; bgColor = "bg-amber-100 text-amber-600"; title = "Document Edited & Resent"; }
                  if (isSigned) { icon = <PenLine className="h-3 w-3" />; bgColor = "bg-green-100 text-green-600"; title = "Signed"; }
                  if (isReviewed) { icon = <UserCheck className="h-3 w-3" />; bgColor = "bg-violet-100 text-violet-600"; title = "Reviewed & Approved"; }
                  if (isRejected) { icon = <XCircle className="h-3 w-3" />; bgColor = "bg-red-100 text-red-600"; title = "Changes Requested"; }

                  return (
                    <div key={event.id} className="relative flex gap-4">
                      <div className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${bgColor} ring-4 ring-white`}>
                        {icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-slate-900">{title}</p>
                          <time className="text-[10px] text-slate-400">{formatDate(event.created_at)}</time>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {event.payload?.message || event.payload?.recipient_name || "Activity recorded"}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Current Status (Derived from recipients if no specific events yet) */}
                {events.length === 0 && currentDoc.recipients.map((r, idx) => {
                  if (!["signed", "reviewed", "approved", "completed", "rejected", "changes_requested"].includes(r.status || "")) return null;
                  
                  const isDone = ["signed", "reviewed", "approved", "completed"].includes(r.status || "");
                  const isRejected = ["rejected", "changes_requested"].includes(r.status || "");
                  
                  return (
                    <div key={`rec-status-${idx}`} className="relative flex gap-4">
                      <div className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${isDone ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'} ring-4 ring-white`}>
                        {isDone ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-slate-900">
                            {r.status === 'signed' ? 'Signed' : r.status === 'reviewed' || r.status === 'approved' ? 'Reviewed' : 'Action Taken'}
                          </p>
                          <time className="text-[10px] text-slate-400">Latest</time>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Activity by {r.name} ({r.email})
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Final Completion if all finished */}
                {completedCount === currentDoc.recipients.length && currentDoc.recipients.length > 0 && (
                  <div className="relative flex gap-4">
                    <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-600 text-white ring-4 ring-white">
                      <CheckCircle2 className="h-3 w-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-900">Process Completed</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">All recipients have completed their actions.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* View Document Sub-Modal */}
      {viewingRecipient && (
        <div className="fixed inset-0 z-[110] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Sub-modal header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setViewingRecipient(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-xs font-bold text-violet-600">
                  {(currentDoc.recipients.find(r => r.email === viewingRecipient)?.name || viewingRecipient || "?").charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {currentDoc.recipients.find(r => r.email === viewingRecipient)?.name || "Recipient"} — {currentDoc.name}
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium tracking-wide">
                    {(() => {
                      const r = currentDoc.recipients.find(r => r.email === viewingRecipient);
                      if (!r) return "";
                      const s = (r as { status?: string }).status;
                      if (s === "signed") return "Signed";
                      if (s === "reviewed") return "Reviewed";
                      return r.role?.toLowerCase() === "reviewer" ? "Yet to Review" : "Yet to Sign";
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {(currentDoc.fileUrl || currentDoc.content) && (
                  <button
                    onClick={() => handleDownload(viewingRecipient || "")}
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

                // 1. Prefer individual signed content, then global template content (HTML/Text)
                const displayContent = viewingR?.signed_content || currentDoc.content;
                const contentIsStructured = displayContent ? isStructuredDocumentHtml(displayContent) : false;
                const displayFileUrl = viewingR?.signed_file_url || currentDoc.fileUrl;
                const fileKind = getDocKind(currentDoc);
                const preferFilePreview = Boolean(displayFileUrl && (fileKind === "pdf" || fileKind === "doc"));

                if (displayContent && !preferFilePreview) {
                  const isPositionedDocument = hasPositionedDocumentStage(displayContent);
                  return (
                    <div className="w-[800px] min-h-[1056px] mx-auto relative origin-top max-w-full">
                      <div className="relative w-full min-h-[1056px] bg-white rounded-xl border border-slate-200 shadow-sm">
                        <div
                          contentEditable={isEditMode}
                          suppressContentEditableWarning
                          className={`modal-document-content document-content min-h-[1056px] text-[14px] text-slate-800 leading-[1.8] tracking-tight outline-none transition-all duration-300 ${(isPositionedDocument || contentIsStructured) ? '' : 'p-12 md:p-16'} ${isEditMode ? 'ring-4 ring-amber-100 bg-amber-50/10 rounded-xl' : ''}`}
                          style={{
                            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                          }}
                          dangerouslySetInnerHTML={{
                            __html: (() => {
                              const baseHtml = editedContent || displayContent || "";
                              if (isPositionedDocument) return baseHtml;
                              if (isEditMode) return baseHtml.replace(/\n/g, "<br/>");
                              
                              // If we have an initialContent and a baseHtml, we might want to diff.
                              // But if we're just viewing a document that was already reviewed,
                              // baseHtml already contains the highlights.
                              const highlighted = baseHtml;

                              
                              return renderDocumentStageBodyHtml(highlighted);
                            })()
                          }}
                        />
                      </div>
                    </div>
                  );
                }

                // 2. Fallback to fileUrl (Iframe or Image)
                if (displayFileUrl) {
                  const isWordDoc = /\.(doc|docx)$/i.test(currentDoc.name || "");
                  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(currentDoc.name || "");
                  const isPdf = /\.(pdf)$/i.test(currentDoc.name || "");

                  if (isImage) {
                    return (
                      <div className="flex justify-center">
                        <img src={displayFileUrl} alt={currentDoc.name} className="max-h-[60vh] rounded-xl border border-slate-200 shadow-sm object-contain" />
                      </div>
                    );
                  }

                  const iframeSrc = isWordDoc
                    ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(displayFileUrl)}`
                    : isPdf
                      ? `${displayFileUrl}#toolbar=0&navpanes=0&scrollbar=0`
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

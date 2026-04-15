"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCircle2, FileSignature, Eye, Loader2, MoreVertical, ChevronLeft, X, Trash2, Download, Edit3, Save, RotateCcw, MessageSquare, PenTool, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase/browser";
import { highlightHtmlEdits } from "../../lib/diff";
import { getStoredSignature } from "../../lib/signature-storage";
import {
  getMatchingRecipient,
  isCompletedForRecipient,
  isReviewRequest,
  normalizeEmail,
  type SharedDocumentRecord,
} from "../../lib/documents";
import {
  getHiddenNotificationIds,
  getSeenNotificationIds,
  hideNotificationForUser,
  markNotificationSeen,
} from "../../lib/notification-storage";

type NotificationItem = SharedDocumentRecord & {
  virtualId: string;
  type: "incoming_request" | "outgoing_update";
  recipientRole: string | null;
  recipientStatus: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
};

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [currentEmail, setCurrentEmail] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<NotificationItem | null>(null);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [rejectingItem, setRejectingItem] = useState<NotificationItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [requireChangesItem, setRequireChangesItem] = useState<NotificationItem | null>(null);
  const [requireChangesMessage, setRequireChangesMessage] = useState("");
  
  const [isEditMode, setIsEditMode] = useState(false);
  const [initialContent, setInitialContent] = useState("");
  const [localEditedContent, setLocalEditedContent] = useState<string | null>(null);

  // Signature state for signing requests
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [signaturePlaced, setSignaturePlaced] = useState(false);
  const [signatureX, setSignatureX] = useState(50);
  const [signatureY, setSignatureY] = useState(50);
  const [signatureScale, setSignatureScale] = useState(1);
  const [sigIsSelected, setSigIsSelected] = useState(false);
  const [showConfirmSend, setShowConfirmSend] = useState(false);
  const [signMessage, setSignMessage] = useState("");
  const [isSigning, setIsSigning] = useState(false);

  const previewStageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startClientX: number; startClientY: number; startSigX: number; startSigY: number } | null>(null);
  const sigResizeRef = useRef<{ startClientX: number; startClientY: number; startScale: number } | null>(null);

  const sigWidthBase = 180;
  const sigHeightBase = 64;
  const sigWidthPx = Math.round(sigWidthBase * signatureScale);
  const sigHeightPx = Math.round(sigHeightBase * signatureScale);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) {
        let maxX = Infinity;
        let maxY = Infinity;
        if (previewStageRef.current) {
          const rect = previewStageRef.current.getBoundingClientRect();
          maxX = rect.width - sigWidthPx;
          maxY = rect.height - sigHeightPx;
        }

        const dx = e.clientX - dragRef.current.startClientX;
        const dy = e.clientY - dragRef.current.startClientY;
        setSignatureX(Math.min(Math.max(0, Math.round(dragRef.current.startSigX + dx)), Math.max(0, maxX)));
        setSignatureY(Math.min(Math.max(0, Math.round(dragRef.current.startSigY + dy)), Math.max(0, maxY)));
      }
      if (sigResizeRef.current) {
        const dx = e.clientX - sigResizeRef.current.startClientX;
        setSignatureScale(Math.min(2.5, Math.max(0.4, sigResizeRef.current.startScale + dx / 180)));
      }
    };
    const onUp = () => { dragRef.current = null; sigResizeRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [sigWidthPx, sigHeightPx]);

  const resetSigningState = () => {
    // Don't clear savedSignature — it's the user's persistent saved signature
    setSignaturePlaced(false);
    setSignatureX(50);
    setSignatureY(50);
    setSignatureScale(1);
    setSigIsSelected(false);
    setShowConfirmSend(false);
    setSignMessage("");
    setIsSigning(false);
  };

  const handleFinalSign = async (item: NotificationItem) => {
    if (!savedSignature || !signaturePlaced) {
      alert("Please place your signature on the document first.");
      return;
    }
    setIsSigning(true);
    try {
      const sigHtml = `<div style="position:absolute;left:${signatureX}px;top:${signatureY}px;width:${sigWidthPx}px;height:${sigHeightPx}px;z-index:50;pointer-events:none;"><img src="${savedSignature}" alt="Signature" style="width:100%;height:100%;object-fit:contain;" /></div>`;
      const baseHtml = item.content || "";
      const finalContent = baseHtml + sigHtml;

      if (currentUserId) {
        markNotificationSeen(currentUserId, item.virtualId);
        setSeenIds(prev => new Set(prev).add(item.virtualId));
      }

      const { data: docRow } = await supabase.from("documents").select("recipients").eq("id", item.id).single();
      const patch: Record<string, unknown> = { status: "signed", signed_at: new Date().toISOString(), content: finalContent };
      if (docRow?.recipients && Array.isArray(docRow.recipients)) {
        patch.recipients = docRow.recipients.map((r: any) =>
          normalizeEmail(r.email) === currentEmail
            ? { ...r, status: "signed", signed_content: finalContent }
            : r
        );
      }

      const { error } = await supabase.from("documents").update(patch).eq("id", item.id);
      if (error) throw error;

      setItems(prev => prev.map(e => {
        if (e.virtualId === item.virtualId) {
          return {
            ...e,
            recipientStatus: "signed",
            content: finalContent,
            recipients: e.recipients?.map((r: any) => 
               normalizeEmail(r.email) === currentEmail ? { ...r, status: "signed", signed_content: finalContent } : r
            ) || []
          };
        }
        return e;
      }));
      setViewingItem(null);
      resetSigningState();
    } catch (err) {
      alert("Failed to submit signature. Please try again.");
    } finally {
      setIsSigning(false);
      setShowConfirmSend(false);
    }
  };

  useEffect(() => {
    const loadIncomingRequests = async () => {
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user;
      const email = normalizeEmail(currentUser?.email);

      if (!currentUser || !email) {
        setItems([]);
        setLoading(false);
        return;
      }

      setCurrentEmail(email);
      setCurrentUserId(currentUser.id);

      // Load the user's saved signature from localStorage
      const storedSig = getStoredSignature(currentUser.id);
      if (storedSig) setSavedSignature(storedSig);

      const { data: rows, error } = await supabase
        .from("documents")
        .select("id, owner_id, name, subject, recipients, sender, sent_at, status, file_url, file_key, category, content")
        .or(`owner_id.eq.${currentUser.id},recipients.cs.[{"email":"${email}"}]`)
        .order("sent_at", { ascending: false })
        .limit(200);

      if (error) {
        console.warn("Failed to load notifications:", error);
        setItems([]);
        setLoading(false);
        return;
      }

      const hiddenIds = getHiddenNotificationIds(currentUser.id);
      setSeenIds(getSeenNotificationIds(currentUser.id));

      const incoming: NotificationItem[] = [];
      const outgoing: NotificationItem[] = [];

      ((rows ?? []) as SharedDocumentRecord[]).forEach((row) => {
        // Skip external documents unless they are completed/signed
        const isCompleted = ["signed", "reviewed", "approved", "completed"].includes(row.status);
        if ((row.sender as any)?.isExternal && !isCompleted) return;

        if (row.owner_id !== currentUser.id) {
          const virtualId = row.id;
          if (hiddenIds.has(virtualId)) return;
          
          const recipient = getMatchingRecipient(row.recipients, email);
          if (!recipient) return;
          incoming.push({
            ...row,
            virtualId,
            type: "incoming_request",
            recipientRole: recipient.role ?? null,
            recipientStatus: recipient.status ?? null,
            recipientEmail: null,
            recipientName: null,
          });
        } else {
          row.recipients.forEach((r) => {
            if (["signed", "reviewed", "approved", "rejected"].includes(r.status || "")) {
              const virtualId = `${row.id}_${normalizeEmail(r.email)}_${r.status}`;
              if (hiddenIds.has(virtualId)) return;
              outgoing.push({
                ...row,
                virtualId,
                type: "outgoing_update",
                recipientRole: r.role ?? null,
                recipientStatus: r.status ?? null,
                recipientEmail: r.email ?? null,
                recipientName: r.name ?? null,
              });
            }
          });
        }
      });

      const allItems = [...incoming, ...outgoing].sort(
        (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
      );

      setItems(allItems);
      setLoading(false);
    };

    void loadIncomingRequests();
  }, []);

  const pendingCount = useMemo(
    () => items.filter((item) => {
      if (item.type === "incoming_request") {
         return !isCompletedForRecipient(item.recipientStatus || item.status) && !seenIds.has(item.virtualId);
      }
      return !seenIds.has(item.virtualId);
    }).length,
    [items, seenIds]
  );

  const handleUpdate = async (item: NotificationItem, editedHtml?: string) => {
    const reviewRequest = isReviewRequest(item, item.recipientRole);
    const nextStatus = reviewRequest ? "reviewed" : "signed";
    const patch = reviewRequest
      ? { status: "reviewed", reviewed_at: new Date().toISOString() }
      : { status: "signed", signed_at: new Date().toISOString() };

    if (currentUserId) {
      markNotificationSeen(currentUserId, item.virtualId);
      setSeenIds((prev) => new Set(prev).add(item.virtualId));
    }
    setProcessingId(item.virtualId);

    const { data: docRow } = await supabase
      .from("documents")
      .select("recipients")
      .eq("id", item.id)
      .single();

    let finalPatch: Record<string, unknown> = { ...patch };
    if (docRow?.recipients && Array.isArray(docRow.recipients)) {
      const updatedRecipients = docRow.recipients.map((r: any) => 
        normalizeEmail(r.email) === currentEmail ? { ...r, status: nextStatus } : r
      );
      finalPatch = { ...finalPatch, recipients: updatedRecipients };
    }

    if (editedHtml) {
      finalPatch.content = highlightHtmlEdits(initialContent, editedHtml);
    }

    const { error } = await supabase.from("documents").update(finalPatch).eq("id", item.id);
    setProcessingId(null);

    if (error) {
      console.warn("Failed to update document from notifications:", error);
      return;
    }

    setItems((prev) =>
      prev.map((entry) => (entry.id === item.id && entry.type === "incoming_request" ? { ...entry, recipientStatus: nextStatus } : entry))
    );
  };

  const hideNotification = (virtualId: string) => {
    if (!currentUserId) return;
    hideNotificationForUser(currentUserId, virtualId);
    setItems((prev) => prev.filter((item) => item.virtualId !== virtualId));
    setOpenMenuId(null);
  };

  const handleReject = async () => {
    if (!rejectingItem) return;
    setProcessingId(rejectingItem.virtualId);

    const { data: docRow } = await supabase
      .from("documents")
      .select("recipients")
      .eq("id", rejectingItem.id)
      .single();

    const recipientsPatch: Record<string, unknown> = { status: "rejected" };
    if (docRow?.recipients && Array.isArray(docRow.recipients)) {
      const updatedRecipients = docRow.recipients.map((r: any) =>
        normalizeEmail(r.email) === currentEmail
          ? { ...r, status: "rejected", reject_reason: rejectReason.trim() || null }
          : r
      );
      recipientsPatch.recipients = updatedRecipients;
    }

    if (currentUserId) {
      markNotificationSeen(currentUserId, rejectingItem.virtualId);
      setSeenIds((prev) => new Set(prev).add(rejectingItem.virtualId));
    }

    const { error } = await supabase.from("documents").update(recipientsPatch).eq("id", rejectingItem.id);
    setProcessingId(null);
    setRejectingItem(null);
    setRejectReason("");

    if (error) {
      console.warn("Failed to reject document:", error);
      return;
    }

    setItems((prev) =>
      prev.map((entry) =>
        entry.virtualId === rejectingItem.virtualId ? { ...entry, recipientStatus: "rejected" } : entry
      )
    );
  };

  const handleView = (item: NotificationItem) => {
    if (currentUserId) {
      markNotificationSeen(currentUserId, item.virtualId);
      setSeenIds((prev) => new Set(prev).add(item.virtualId));
    }
    
    let displayContent = item.content;
    let displayFileUrl = item.file_url;

    if (item.type === "outgoing_update" && item.recipientEmail) {
      const r = item.recipients.find(recp => normalizeEmail(recp.email) === normalizeEmail(item.recipientEmail!));
      if (r?.signed_content) displayContent = r.signed_content;
      if (r?.signed_file_url) displayFileUrl = r.signed_file_url;
    } else {
      const r = item.recipients.find(recp => normalizeEmail(recp.email) === currentEmail);
      if (r?.signed_content) displayContent = r.signed_content;
      if (r?.signed_file_url) displayFileUrl = r.signed_file_url;
    }
    
    if (displayContent) {
      setViewingItem({ ...item, content: displayContent });
      setInitialContent(displayContent);
      setLocalEditedContent(null);
      setIsEditMode(false);
    } else if (displayFileUrl) {
      window.open(displayFileUrl, "_blank");
    }
    setOpenMenuId(null);
  };

  const handleReset = () => {
    if (!confirm("Are you sure you want to discard all manual edits? This cannot be undone.")) return;
    setLocalEditedContent(null);
    setIsEditMode(false);
  };

  const handleDownload = (item: NotificationItem) => {
    let targetUrl = item.file_url;
    let targetContent = item.content;

    if (item.type === "outgoing_update" && item.recipientEmail) {
      const r = item.recipients.find(recp => normalizeEmail(recp.email) === normalizeEmail(item.recipientEmail!));
      if (r?.signed_content) targetContent = r.signed_content;
      if (r?.signed_file_url) targetUrl = r.signed_file_url;
    } else {
      const r = item.recipients.find(recp => normalizeEmail(recp.email) === currentEmail);
      if (r?.signed_content) targetContent = r.signed_content;
      if (r?.signed_file_url) targetUrl = r.signed_file_url;
    }
    
    if (targetContent) {
      const blob = new Blob([targetContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${item.name}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else if (targetUrl) {
      const link = document.createElement('a');
      link.href = targetUrl;
      link.download = item.name;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setOpenMenuId(null);
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {loading ? (
        <div className="flex items-center justify-center rounded-[2rem] border border-slate-200 bg-white p-10 text-sm text-slate-500 shadow-sm">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading notifications...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[2.5rem] border border-dashed border-slate-300 bg-white/50 p-20 text-center backdrop-blur-sm">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Bell className="h-10 w-10" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-slate-700">No notifications yet</h2>
          <p className="max-w-md text-slate-500 text-sm">
            When someone sends a document to the Gmail you used to log in, it will appear here for signing or review.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => {
            const reviewRequest = isReviewRequest(item, item.recipientRole);
            const completed = isCompletedForRecipient(item.recipientStatus || item.status);

            return (
              <div
                key={item.virtualId}
                className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex rounded-full bg-violet-50 px-3 py-1 text-[11px] font-bold text-violet-700">
                        {item.type === "outgoing_update" ? "Status Update" : reviewRequest ? "Review Request" : "Signing Request"}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-[11px] font-bold ${
                          completed || item.type === "outgoing_update"
                            ? item.recipientStatus === "rejected" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {item.type === "outgoing_update" ? item.recipientStatus : completed ? (item.recipientStatus || item.status) : "Pending"}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold text-slate-900">{item.name}</h2>
                    
                    {item.type === "incoming_request" ? (
                      <p className="text-sm text-slate-600">
                        <span className="font-semibold text-slate-900">{item.sender.fullName || item.sender.workEmail}</span>
                        {" "}
                        sent this document from
                        {" "}
                        <span className="font-semibold text-slate-900">{item.sender.workEmail}</span>.
                      </p>
                    ) : (
                      <p className="text-sm text-slate-600">
                        <span className="font-semibold text-slate-900">{item.recipientName || item.recipientEmail}</span>
                        {" "}
                        has {item.recipientStatus} this document.
                      </p>
                    )}
                    
                    <p className="text-xs text-slate-500">
                      {item.subject} • Sent {formatDateTime(item.sent_at)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* The action menu (View, Download, Delete) */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setOpenMenuId((prev) => (prev === item.virtualId ? null : item.virtualId))}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {openMenuId === item.virtualId && (
                        <div className="absolute right-0 top-12 z-20 w-48 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100">
                          <button
                            type="button"
                            onClick={() => handleView(item)}
                            className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <Eye className="h-4 w-4 text-violet-500" />
                            {item.type === "outgoing_update" ? "View Document" : (completed ? "View Signed" : "View Preview")}
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => handleDownload(item)}
                            className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <Download className="h-4 w-4 text-blue-500" />
                            Download
                          </button>

                          {item.type === "incoming_request" && !completed && (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (reviewRequest) {
                                    await handleUpdate(item);
                                  } else {
                                    router.push(`/dashboard/sign-document?documentId=${item.id}`);
                                  }
                                  setOpenMenuId(null);
                                }}
                                disabled={processingId === item.virtualId}
                                className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-green-700 hover:bg-green-50 transition-colors disabled:opacity-60"
                              >
                                {processingId === item.virtualId ? (
                                  <Loader2 className="h-4 w-4 text-slate-500 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                                )}
                                {processingId === item.virtualId ? "Saving..." : (reviewRequest ? "Approve" : "Sign Document")}
                              </button>

                              <button
                                type="button"
                                onClick={() => { setRequireChangesItem(item); setRequireChangesMessage(""); setOpenMenuId(null); }}
                                disabled={processingId === item.virtualId}
                                className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-60"
                              >
                                <MessageSquare className="h-4 w-4 text-amber-500" />
                                Require Changes
                              </button>

                              <button
                                type="button"
                                onClick={() => { setRejectingItem(item); setRejectReason(""); setOpenMenuId(null); }}
                                disabled={processingId === item.virtualId}
                                className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                              >
                                <X className="h-4 w-4 text-red-500" />
                                Reject
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => hideNotification(item.virtualId)}
                            className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Primary Action Button for Incoming Requests */}
                    {item.type === "incoming_request" && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleView(item)}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-violet-50 hover:text-violet-700 hover:border-violet-200 transition-all"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View Document
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rejection Reason Popup */}
      {rejectingItem && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Reject Document</h3>
              <p className="text-xs text-slate-500 mt-1">
                You are rejecting <span className="font-semibold text-slate-800">&ldquo;{rejectingItem.name}&rdquo;</span>.
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Reason for rejection <span className="text-slate-400 font-normal normal-case">(optional)</span>
              </label>
              <textarea
                className="w-full h-28 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 outline-none focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-50 transition-all resize-none placeholder:text-slate-400"
                placeholder="e.g. Content needs revision, incorrect terms..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                autoFocus
              />
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => { setRejectingItem(null); setRejectReason(""); }}
                className="flex-1 py-2.5 rounded-2xl text-slate-600 font-bold text-sm border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleReject()}
                disabled={processingId === rejectingItem.virtualId}
                className="flex-[2] py-2.5 rounded-2xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {processingId === rejectingItem.virtualId ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Rejecting...</>
                ) : (
                  <>Confirm Reject</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingItem?.content && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col h-screen w-screen overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-white shrink-0 shadow-sm">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setViewingItem(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all group"
              >
                <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                <span className="text-sm font-semibold">Back</span>
              </button>
              <div>
                <h2 className="text-base font-bold text-slate-900 leading-tight">{viewingItem.name}</h2>
                <p className="text-[11px] text-slate-500 font-medium">{viewingItem.subject}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {viewingItem.type === "incoming_request" && !isCompletedForRecipient(viewingItem.recipientStatus || viewingItem.status) && (
                <>
                  {/* Reject Button */}
                  <button
                    onClick={() => { setRejectingItem(viewingItem); setRejectReason(""); }}
                    disabled={processingId === viewingItem.virtualId || isSigning}
                    className="flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50 transition-all shadow-sm disabled:opacity-60"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>

                  {/* Require Changes Button */}
                  <button
                    onClick={() => { setRequireChangesItem(viewingItem); setRequireChangesMessage(""); }}
                    disabled={processingId === viewingItem.virtualId || isSigning}
                    className="flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2 text-xs font-bold text-amber-600 hover:bg-amber-50 transition-all shadow-sm disabled:opacity-60"
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> Require Changes
                  </button>

                  {isReviewRequest(viewingItem, viewingItem.recipientRole) ? (
                    /* Review request: Show Edit & Approve buttons */
                    <>
                      {isEditMode ? (
                        <>
                          <button
                            onClick={() => {
                              setIsEditMode(false);
                              const contentDiv = document.querySelector('.editable-content');
                              if (contentDiv) {
                                contentDiv.innerHTML = initialContent;
                                setLocalEditedContent(null);
                              }
                            }}
                            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
                          >
                            <X className="h-3.5 w-3.5" /> Cancel Edit
                          </button>
                          <button
                            onClick={() => {
                              setIsEditMode(false);
                              const contentDiv = document.querySelector('.editable-content');
                              if (contentDiv) {
                                setLocalEditedContent(contentDiv.innerHTML);
                              }
                            }}
                            className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all"
                          >
                            <Save className="h-3.5 w-3.5" /> Save Edits
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setIsEditMode(true)}
                          className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100 transition-all shadow-sm"
                        >
                          <Edit3 className="h-3.5 w-3.5" /> Edit Document
                        </button>
                      )}
                      
                      <button
                        onClick={async () => {
                          const contentDiv = document.querySelector('.editable-content');
                          const cleanHtml = isEditMode && contentDiv ? contentDiv.innerHTML : (localEditedContent || (contentDiv ? contentDiv.innerHTML : undefined));
                          const finalHtml = cleanHtml ? highlightHtmlEdits(initialContent, cleanHtml) : undefined;
                          await handleUpdate(viewingItem, finalHtml);
                          setViewingItem(null);
                        }}
                        disabled={processingId === viewingItem.virtualId}
                        className="flex items-center gap-2 rounded-xl bg-green-600 px-6 py-2 text-xs font-bold text-white shadow-lg shadow-green-200 hover:bg-green-700 transition-all disabled:opacity-60"
                      >
                        {processingId === viewingItem.virtualId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle2 className="h-3.5 w-3.5" /> Approve</>}
                      </button>
                    </>
                  ) : (
                    /* Signing request: Place saved signature on document */
                    <>
                      {!savedSignature ? (
                        <span className="text-xs text-slate-500 italic">
                          No saved signature. Go to <strong>Create Sign</strong> first.
                        </span>
                      ) : !signaturePlaced ? (
                        <button
                          onClick={() => { setSignaturePlaced(true); setSignatureX(80); setSignatureY(80); }}
                          className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all"
                        >
                          <PenTool className="h-3.5 w-3.5" /> Sign on Document
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => setSignaturePlaced(false)}
                            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all shadow-sm"
                            title="Remove placed signature"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Remove
                          </button>
                          <button
                            onClick={() => setShowConfirmSend(true)}
                            disabled={isSigning}
                            className="flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-green-200 hover:bg-green-700 transition-all disabled:opacity-50"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" /> Send
                          </button>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              <button
                onClick={() => { setViewingItem(null); resetSigningState(); }}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-100/50 p-8">
            <div className="max-w-4xl mx-auto flex justify-center">
              <div className="relative w-[800px]" ref={previewStageRef}>
                <div
                  className="relative editable-content w-full min-h-[1056px] bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 p-12 md:p-16 lg:p-20 text-[15px] text-slate-800 leading-[1.9] tracking-tight outline-none"
                  style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
                  onClick={() => setSigIsSelected(false)}
                  contentEditable={isEditMode}
                  suppressContentEditableWarning={true}
                  dangerouslySetInnerHTML={{
                    __html: (() => {
                      const baseHtml = localEditedContent || viewingItem.content || "";
                      const highlighted = (!isEditMode && localEditedContent)
                        ? highlightHtmlEdits(initialContent, localEditedContent)
                        : baseHtml;
                      return highlighted
                        .replace(/\n/g, "<br/>")
                        .replace(/<strong>/g, '<strong style="font-weight:700; color:#0f172a;">');
                    })()
                  }}
                />
                
                {/* Draggable Signature */}
                {signaturePlaced && savedSignature && (
                  <div
                    className={`absolute rounded border-2 border-dashed group cursor-grab active:cursor-grabbing select-none transition-all ${sigIsSelected ? 'border-violet-500 bg-violet-50/30' : 'border-slate-400 hover:border-violet-400'}`}
                    style={{ left: `${signatureX}px`, top: `${signatureY}px`, width: `${sigWidthPx}px`, height: `${sigHeightPx}px`, zIndex: 100 }}
                    onClick={e => { e.stopPropagation(); setSigIsSelected(true); }}
                    onPointerDown={e => {
                      e.preventDefault(); e.stopPropagation();
                      setSigIsSelected(true);
                      dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startSigX: signatureX, startSigY: signatureY };
                    }}
                  >
                    <img src={savedSignature} alt="Signature" className="w-full h-full object-contain pointer-events-none" />
                    {/* Delete */}
                    <button
                      type="button"
                      className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-red-500 border border-white text-white shadow flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all"
                      style={{ zIndex: 110 }}
                      onClick={e => { e.stopPropagation(); setSignaturePlaced(false); }}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                    {/* Resize handle */}
                    <div
                      className="absolute -right-2 -bottom-2 w-5 h-5 cursor-nwse-resize bg-violet-600 rounded-full shadow-md hover:bg-violet-500 border-2 border-white flex items-center justify-center"
                      style={{ zIndex: 110 }}
                      onPointerDown={e => {
                        e.stopPropagation(); e.preventDefault();
                        sigResizeRef.current = { startClientX: e.clientX, startClientY: e.clientY, startScale: signatureScale };
                      }}
                    >
                      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 22L12 22L22 12Z" fill="currentColor" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Require Changes Popup */}
      {requireChangesItem && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Require Changes</h3>
              <p className="text-xs text-slate-500 mt-1">
                You are requesting changes for <span className="font-semibold text-slate-800">&ldquo;{requireChangesItem.name}&rdquo;</span>.
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Message <span className="text-slate-400 font-normal normal-case">(optional)</span>
              </label>
              <textarea
                className="w-full h-28 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 outline-none focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-50 transition-all resize-none placeholder:text-slate-400"
                placeholder="e.g. Please update section 3, fix typos in clause 5..."
                value={requireChangesMessage}
                onChange={(e) => setRequireChangesMessage(e.target.value)}
                autoFocus
              />
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => { setRequireChangesItem(null); setRequireChangesMessage(""); }}
                className="flex-1 py-2.5 rounded-2xl text-slate-600 font-bold text-sm border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setProcessingId(requireChangesItem.virtualId);
                  const { data: docRow } = await supabase
                    .from("documents")
                    .select("recipients")
                    .eq("id", requireChangesItem.id)
                    .single();

                  const patchData: Record<string, unknown> = { status: "changes_requested" };
                  if (docRow?.recipients && Array.isArray(docRow.recipients)) {
                    const updatedRecipients = docRow.recipients.map((r: any) =>
                      normalizeEmail(r.email) === currentEmail
                        ? { ...r, status: "changes_requested", change_message: requireChangesMessage.trim() || null }
                        : r
                    );
                    patchData.recipients = updatedRecipients;
                  }

                  if (currentUserId) {
                    markNotificationSeen(currentUserId, requireChangesItem.virtualId);
                    setSeenIds((prev) => new Set(prev).add(requireChangesItem.virtualId));
                  }

                  const { error } = await supabase.from("documents").update(patchData).eq("id", requireChangesItem.id);
                  setProcessingId(null);
                  
                  if (!error) {
                    setItems((prev) =>
                      prev.map((entry) =>
                        entry.virtualId === requireChangesItem.virtualId ? { ...entry, recipientStatus: "changes_requested" } : entry
                      )
                    );
                  }
                  setRequireChangesItem(null);
                  setRequireChangesMessage("");
                  setViewingItem(null);
                }}
                disabled={processingId === requireChangesItem.virtualId}
                className="flex-[2] py-2.5 rounded-2xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {processingId === requireChangesItem.virtualId ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Sending...</>
                ) : (
                  <>Confirm</>  
                )}
              </button>
            </div>
          </div>
        </div>
      )}




      {/* Confirm Send Popup */}
      {showConfirmSend && viewingItem && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Confirm & Submit Signature</h3>
              <p className="text-xs text-slate-500 mt-1">
                You are signing <span className="font-semibold text-slate-800">&ldquo;{viewingItem.name}&rdquo;</span>. This action cannot be undone.
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Optional Message <span className="text-slate-400 font-normal normal-case">(to sender)</span>
              </label>
              <textarea
                className="w-full h-24 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 outline-none focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-50 transition-all resize-none placeholder:text-slate-400"
                placeholder="Any comments for the sender..."
                value={signMessage}
                onChange={(e) => setSignMessage(e.target.value)}
                autoFocus
              />
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowConfirmSend(false)}
                className="flex-1 py-2.5 rounded-2xl text-slate-600 font-bold text-sm border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleFinalSign(viewingItem)}
                disabled={isSigning}
                className="flex-[2] py-2.5 rounded-2xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-green-200"
              >
                {isSigning ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting...</>
                ) : (
                  <><ShieldCheck className="h-3.5 w-3.5" /> Confirm & Send</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

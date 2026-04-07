"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCircle2, FileSignature, Eye, Loader2, MoreVertical, ChevronLeft, X, Trash2, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase/browser";
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
                recipientStatus: r.status,
                recipientEmail: r.email,
                recipientName: r.name,
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

  const handleUpdate = async (item: NotificationItem) => {
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
    } else if (displayFileUrl) {
      window.open(displayFileUrl, "_blank");
    }
    setOpenMenuId(null);
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
      <div className="flex items-center gap-4">
        <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200">
          <Bell className="h-6 w-6" />
          {pendingCount > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-black text-white">
              {pendingCount}
            </span>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Notifications</h1>
          <p className="text-slate-500 text-sm">
            Incoming signing and review requests for {currentEmail || "your account"}
          </p>
        </div>
      </div>

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
                        {!completed && (
                          <button
                            type="button"
                            onClick={() => { setRejectingItem(item); setRejectReason(""); }}
                            disabled={processingId === item.virtualId}
                            className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <X className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (reviewRequest) {
                              void handleUpdate(item);
                              return;
                            }
                            if (currentUserId) {
                              markNotificationSeen(currentUserId, item.virtualId);
                              setSeenIds((prev) => new Set(prev).add(item.virtualId));
                            }
                            router.push(`/dashboard/sign-document?documentId=${item.id}`);
                          }}
                          disabled={completed || processingId === item.virtualId}
                          className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {processingId === item.virtualId ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Saving...
                            </>
                          ) : completed ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {item.recipientStatus === "rejected" ? "Rejected" : "Completed"}
                            </>
                          ) : (
                            <>
                              <FileSignature className="h-3.5 w-3.5" />
                              {reviewRequest ? "Mark Reviewed" : "Sign Document"}
                            </>
                          )}
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
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-sm font-semibold text-red-600">
                PDF
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 leading-tight">{viewingItem.name}</h2>
                <p className="text-[11px] text-slate-500 font-medium">{viewingItem.subject}</p>
              </div>
            </div>
            <button
              onClick={() => setViewingItem(null)}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-100/50">
            <div className="max-w-4xl mx-auto my-8">
              <div
                className="mx-auto w-[800px] min-h-[1056px] bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 p-12 md:p-16 lg:p-20 relative text-[15px] text-slate-800 leading-[1.9] tracking-tight"
                style={{
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                }}
                dangerouslySetInnerHTML={{
                  __html: (viewingItem.content || "")
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

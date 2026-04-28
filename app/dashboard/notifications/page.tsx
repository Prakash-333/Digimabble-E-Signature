"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCircle2, Eye, Loader2, MoreVertical, ChevronLeft, X, Trash2, Download, RotateCcw, MessageSquare, PenTool, ShieldCheck, User, Calendar, Building2, Type as TypeIcon, Square, CheckSquare, Mail, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase/browser";
import {
  buildPositionedDocumentHtml,
  DOCUMENT_STAGE_FONT_FAMILY,
  DOCUMENT_STAGE_MIN_HEIGHT,
  DOCUMENT_STAGE_PADDING,
  hasPositionedDocumentStage,
  renderDocumentStageBodyHtml,
} from "../../lib/document-stage";
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
import { highlightHtmlEdits, stripHighlights } from "../../../app/lib/diff";

type NotificationItem = SharedDocumentRecord & {
  virtualId: string;
  type: "incoming_request" | "outgoing_update";
  recipientRole: string | null;
  recipientStatus: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
};

const generateSigningReference = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
};

interface PlacedField {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  scale?: number;
  value?: string;
}

const DEFAULT_FIELD_SIZE: Record<string, { width: number; height: number }> = {
  stamp: { width: 210, height: 86 },
  initial: { width: 100, height: 36 },
  date: { width: 140, height: 36 },
  name: { width: 180, height: 40 },
  first_name: { width: 160, height: 40 },
  last_name: { width: 160, height: 40 },
  email: { width: 220, height: 40 },
  company: { width: 180, height: 40 },
  title: { width: 160, height: 40 },
  text: { width: 180, height: 44 },
  checkbox: { width: 24, height: 24 },
};

const MIN_FIELD_SIZE: Record<string, { width: number; height: number }> = {
  stamp: { width: 150, height: 62 },
  initial: { width: 72, height: 28 },
  date: { width: 100, height: 28 },
  name: { width: 110, height: 32 },
  first_name: { width: 110, height: 32 },
  last_name: { width: 110, height: 32 },
  email: { width: 150, height: 32 },
  company: { width: 110, height: 32 },
  title: { width: 100, height: 32 },
  text: { width: 110, height: 36 },
  checkbox: { width: 20, height: 20 },
};

const DRAGGABLE_FIELDS = [
  // Group 1
  { type: "initial", label: "Initial", icon: <span className="font-bold text-[10px] text-slate-700 max-w-5 border-b border-slate-700">DS</span>, group: 1 },
  { type: "stamp", label: "Stamp", icon: <Square className="h-4 w-4 text-slate-700" />, group: 1 },
  { type: "date", label: "Date Signed", icon: <Calendar className="h-4 w-4 text-slate-700" />, group: 1 },
  // Group 2
  { type: "name", label: "Name", icon: <User className="h-4 w-4 text-slate-700" />, group: 2 },
  { type: "first_name", label: "First Name", icon: <User className="h-4 w-4 text-slate-700" />, group: 2 },
  { type: "last_name", label: "Last Name", icon: <User className="h-4 w-4 text-slate-700" />, group: 2 },
  { type: "email", label: "Email Address", icon: <Mail className="h-4 w-4 text-slate-700" />, group: 2 },
  { type: "company", label: "Company", icon: <Building2 className="h-4 w-4 text-slate-700" />, group: 2 },
  { type: "title", label: "Title", icon: <Tag className="h-4 w-4 text-slate-700" />, group: 2 },
  // Group 3
  { type: "text", label: "Text", icon: <TypeIcon className="h-4 w-4 text-slate-700" />, group: 3 },
  { type: "checkbox", label: "Checkbox", icon: <CheckSquare className="h-4 w-4 text-slate-700" />, group: 3 },
] as const;

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatStatus = (s: string | null) => {
  if (!s) return "";
  const low = s.toLowerCase();
  if (low === "reviewed") return "Approved";
  if (low === "changes_requested") return "Changes Requested";
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
};

const getFieldSize = (field: Pick<PlacedField, "type" | "width" | "height">) => {
  const fallback = DEFAULT_FIELD_SIZE[field.type] || { width: 180, height: 40 };
  return {
    width: field.width ?? fallback.width,
    height: field.height ?? fallback.height,
  };
};

const getFieldFontSize = (field: Pick<PlacedField, "type" | "height">) => {
  if (field.type === "checkbox") return 16;
  if (field.type === "stamp") return 14;
  const baseHeight = DEFAULT_FIELD_SIZE[field.type]?.height || 40;
  const nextHeight = field.height ?? baseHeight;
  return Math.max(14, Math.min(28, Math.round(nextHeight * 0.42)));
};

const clampFieldPosition = (field: PlacedField, x: number, y: number, stage: HTMLDivElement | null) => {
  if (!stage) {
    return {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
    };
  }

  const rect = stage.getBoundingClientRect();
  const { width, height } = getFieldSize(field);

  return {
    x: Math.min(Math.max(0, Math.round(x)), Math.max(0, Math.floor(rect.width - width))),
    y: Math.min(Math.max(0, Math.round(y)), Math.max(0, Math.floor(rect.height - height))),
  };
};

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

  // Signing form state
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [activeSigningReference, setActiveSigningReference] = useState<string | null>(null);
  const [placedFields, setPlacedFields] = useState<PlacedField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [showConfirmSend, setShowConfirmSend] = useState(false);
  const [showConfirmApprove, setShowConfirmApprove] = useState(false);
  const [approveData, setApproveData] = useState<{ item: any; html?: string } | null>(null);
  const [signMessage, setSignMessage] = useState("");
  const [isSigning, setIsSigning] = useState(false);
  
  // Field editing state
  const [fieldToEdit, setFieldToEdit] = useState<PlacedField | null>(null);
  const [fieldEditValue, setFieldEditValue] = useState("");
  const [fieldEditLabel, setFieldEditLabel] = useState("");

  const previewStageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  const resizeRef = useRef<{ id: string; startClientX: number; startClientY: number; startWidth: number; startHeight: number } | null>(null);
  const movedFieldRef = useRef<string | null>(null);
  const skipFieldClickRef = useRef<string | null>(null);
  const textPressRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    timer: number | null;
  } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current && textPressRef.current) {
        const pending = textPressRef.current;
        const dx = e.clientX - pending.startClientX;
        const dy = e.clientY - pending.startClientY;

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          if (pending.timer) {
            window.clearTimeout(pending.timer);
          }
          dragRef.current = {
            id: pending.id,
            startClientX: pending.startClientX,
            startClientY: pending.startClientY,
            startX: pending.startX,
            startY: pending.startY,
          };
          textPressRef.current = null;
        }
      }

      if (dragRef.current) {
        const { id, startClientX, startClientY, startX, startY } = dragRef.current;
        const dx = e.clientX - startClientX;
        const dy = e.clientY - startClientY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          movedFieldRef.current = id;
        }
        
        setPlacedFields(prev => {
          const field = prev.find(f => f.id === id);
          if (!field) return prev;
          const nextPos = clampFieldPosition(field, startX + dx, startY + dy, previewStageRef.current);
          return prev.map(f => {
            if (f.id === id) {
              return {
                ...f,
                x: nextPos.x,
                y: nextPos.y
              };
            }
            return f;
          });
        });
      }
      if (resizeRef.current) {
        const { id, startClientX, startClientY, startHeight, startWidth } = resizeRef.current;
        const dx = e.clientX - startClientX;
        const dy = e.clientY - startClientY;
        movedFieldRef.current = id;
        
        setPlacedFields(prev => prev.map(f => {
          if (f.id !== id) return f;

          const minSize = MIN_FIELD_SIZE[f.type] || { width: 80, height: 28 };
          const width =
            f.type === "stamp"
              ? Math.max(minSize.width, Math.round(startWidth + Math.max(dx, dy) * 1.25))
              : Math.max(minSize.width, Math.round(startWidth + dx));
          const height = Math.max(
            minSize.height,
            Math.round(
              f.type === "checkbox"
                ? startHeight + Math.max(dx, dy)
                : f.type === "stamp"
                  ? startHeight + Math.max(dx, dy) * 0.52
                  : startHeight + dy
            )
          );
          const resizedField = {
            ...f,
            width,
            height,
          };
          const nextPos = clampFieldPosition(resizedField, resizedField.x, resizedField.y, previewStageRef.current);

          return {
            ...resizedField,
            x: nextPos.x,
            y: nextPos.y,
          };
        }));
      }
    };
    const onUp = () => {
      if (textPressRef.current?.timer) {
        window.clearTimeout(textPressRef.current.timer);
      }
      textPressRef.current = null;
      if (movedFieldRef.current) {
        skipFieldClickRef.current = movedFieldRef.current;
      }
      dragRef.current = null;
      resizeRef.current = null;
      movedFieldRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      if (textPressRef.current?.timer) {
        window.clearTimeout(textPressRef.current.timer);
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const addPlacedField = (type: string, value?: string, position?: { x: number; y: number }) => {
    const defaultSize = DEFAULT_FIELD_SIZE[type] || { width: 180, height: 40 };
    const fieldId = crypto.randomUUID();
    if (type === "stamp") {
      setActiveSigningReference((prev) => prev || generateSigningReference());
    }
    const baseField: PlacedField = {
      id: fieldId,
      type,
      x: position?.x ?? 50,
      y: position?.y ?? 50,
      width: defaultSize.width,
      height: defaultSize.height,
      scale: 1,
      value,
    };
    const nextPos = clampFieldPosition(baseField, baseField.x, baseField.y, previewStageRef.current);

    setPlacedFields(prev => [...prev, { ...baseField, x: nextPos.x, y: nextPos.y }]);
    setSelectedFieldId(fieldId);
  };

  const promptFieldValue = (field: PlacedField, label?: string) => {
    if (field.type === "initial" || field.type === "checkbox" || field.type === "stamp") return;
    const defaultVal = field.type === "date"
      ? new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
      : "";
    
    setFieldToEdit(field);
    setFieldEditValue(field.value || defaultVal);
    setFieldEditLabel(label || field.type.charAt(0).toUpperCase() + field.type.slice(1));
  };

  const resetSigningState = () => {
    setPlacedFields([]);
    setActiveSigningReference(null);
    setSelectedFieldId(null);
    setShowConfirmSend(false);
    setShowConfirmApprove(false);
    setApproveData(null);
    setFieldToEdit(null);
    setFieldEditValue("");
    setSignMessage("");
    setIsSigning(false);
  };

  const handleFinalSign = async (item: NotificationItem) => {
    // If they were using "Sign on Document" but just placed fields
    if (placedFields.length === 0) {
      alert("Please place required signing fields on the document first.");
      return;
    }
    setIsSigning(true);
    try {
      const signingReference = activeSigningReference || generateSigningReference();
      const fieldsHtml = placedFields.map(f => {
        const { width, height } = getFieldSize(f);
        const fontSize = getFieldFontSize(f);
        if (f.type === "stamp" && savedSignature) {
          const radius = Math.max(12, Math.round(height * 0.16));
          const accentThickness = Math.max(3, Math.round(height * 0.045));
          const accentLength = Math.max(18, Math.round(width * 0.11));
          const paddingTop = Math.max(6, Math.round(height * 0.08));
          const paddingX = Math.max(10, Math.round(width * 0.05));
          const paddingLeft = Math.max(18, Math.round(width * 0.085));
          const labelFontSize = Math.max(10, Math.round(height * 0.13));
          const refFontSize = Math.max(10, Math.round(height * 0.12));
          const sigMaxHeight = Math.max(34, Math.round(height * 0.38));
          return `<div style="position:absolute;left:${f.x}px;top:${f.y}px;width:${width}px;height:${height}px;z-index:50;pointer-events:none;overflow:visible;"><div style="position:relative;width:100%;height:100%;background:transparent;border-radius:${radius}px;padding:${paddingTop}px ${paddingX}px ${paddingTop}px ${paddingLeft}px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;"><div style="position:absolute;left:0;top:0;bottom:0;width:${accentThickness}px;background:#4f46e5;border-radius:${radius}px 0 0 ${radius}px;"></div><div style="position:absolute;left:0;top:0;width:${accentLength}px;height:${accentThickness}px;background:#4f46e5;border-radius:${radius}px ${accentThickness}px ${accentThickness}px ${accentThickness}px;"></div><div style="position:absolute;left:0;bottom:0;width:${accentLength}px;height:${accentThickness}px;background:#4f46e5;border-radius:${accentThickness}px ${accentThickness}px ${accentThickness}px ${radius}px;"></div><div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:${labelFontSize}px;font-weight:700;line-height:1;color:#111827;">Signed by:</div><div style="display:flex;align-items:center;min-height:${sigMaxHeight}px;"><img src="${savedSignature}" alt="Signature" style="width:100%;max-height:${sigMaxHeight}px;object-fit:contain;object-position:left center;filter:brightness(0.45) contrast(1.55);" /></div><div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:${refFontSize}px;line-height:1;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${signingReference}</div></div></div>`;
        }
        if (f.type === "checkbox") {
           return `<div style="position:absolute;left:${f.x}px;top:${f.y}px;width:${width}px;height:${height}px;z-index:50;pointer-events:none;display:flex;align-items:center;justify-content:center;background:transparent;font-weight:bold;font-size:${Math.max(14, Math.round(height * 0.8))}px;">✓</div>`;
        }
        return `<div style="position:absolute;left:${f.x}px;top:${f.y}px;width:${width}px;min-height:${height}px;z-index:50;pointer-events:none;display:flex;align-items:center;font-size:${fontSize}px;line-height:1.2;color:#0f172a;white-space:pre-wrap;font-family:inherit;overflow-wrap:anywhere;">${f.value || ""}</div>`;
      }).join("");

      const finalContent = buildPositionedDocumentHtml(item.content || "", fieldsHtml);

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
      const { data: { session } } = await supabase.auth.getSession();
      let currentUser = session?.user;

      if (!currentUser) {
        const { data: { user: freshUser }, error: authError } = await supabase.auth.getUser();
        if (authError) {
          if (authError.message?.includes("stole it")) return;
          throw authError;
        }
        currentUser = freshUser ?? undefined;
      }

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
        const isCompleted = ["signed", "reviewed", "approved", "completed", "rejected", "changes_requested"].includes(row.status);

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
            if (["waiting", "pending", "signed", "reviewed", "approved", "rejected", "changes_requested", "completed"].includes(r.status || "")) {
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
      finalPatch.content = editedHtml;

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
    setViewingItem(null);
    resetSigningState();
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
    setViewingItem(null);
    resetSigningState();
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
      // IMPORTANT: initialContent must be the ORIGINAL document content (stripped of any prior highlights),
      // NOT the signed_content or edited version. This ensures diff highlights correctly identify new edits.
      setInitialContent(stripHighlights(item.content || displayContent));
      setLocalEditedContent(null);
      setIsEditMode(false);
      resetSigningState();
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
                        {item.type === "outgoing_update" ? "Status Update" : reviewRequest ? "Review Request" : "Sign Request"}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-[11px] font-bold ${
                          completed || item.type === "outgoing_update"
                            ? item.recipientStatus === "rejected"
                              ? "bg-red-100 text-red-700"
                              : item.recipientStatus === "changes_requested"
                                ? "bg-amber-100 text-amber-700"
                                : (item.recipientStatus === "waiting" || item.recipientStatus === "pending")
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-green-50 text-green-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {item.type === "outgoing_update" ? formatStatus(item.recipientStatus) : completed ? formatStatus(item.recipientStatus || item.status) : "Pending"}
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
                        has {formatStatus(item.recipientStatus).toLowerCase()} this document.
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
                                Request for Change
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
                onClick={() => { setViewingItem(null); resetSigningState(); }}
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
                    <MessageSquare className="h-3.5 w-3.5" /> Request for Change
                  </button>

                  {isReviewRequest(viewingItem, viewingItem.recipientRole) ? (
                    /* Review request: Show Edit & Approve buttons */
                    <>
                      <button
                        onClick={async () => {
                          const contentDiv = document.querySelector('.editable-content');
                          let finalHtml = localEditedContent || (contentDiv ? (contentDiv as HTMLElement).innerHTML : viewingItem.content);
                          
                          // If we are currently in edit mode, apply highlighting before approving
                          if (isEditMode && contentDiv) {
                            finalHtml = highlightHtmlEdits(initialContent, (contentDiv as HTMLElement).innerHTML);
                          }
                          
                          setApproveData({ item: viewingItem, html: finalHtml || undefined });
                          setShowConfirmApprove(true);
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
                      ) : (
                        <>
                          <button
                            onClick={() => addPlacedField("stamp", "", { x: 80, y: 80 })}
                            className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all"
                          >
                            <PenTool className="h-3.5 w-3.5" /> Sign on Document
                          </button>
                          {placedFields.length > 0 && (
                            <>
                              <button
                                onClick={() => setPlacedFields([])}
                                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all shadow-sm"
                                title="Remove all placed fields"
                              >
                                <RotateCcw className="h-3.5 w-3.5" /> Clear All
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

          <div className="flex-1 flex overflow-hidden">
            {viewingItem.type === "incoming_request" && !isReviewRequest(viewingItem, viewingItem.recipientRole) && !isCompletedForRecipient(viewingItem.recipientStatus || viewingItem.status) && (
              <div className="w-64 border-r border-slate-200 bg-white p-6 overflow-y-auto shrink-0 flex flex-col gap-4 z-10 shadow-sm relative">
                <div className="text-sm font-bold text-slate-800 tracking-wide uppercase">Add Fields</div>
                <div className="text-xs text-slate-500 mb-2 leading-relaxed">Click or drag fields to place them on the document.</div>
                
                <div className="flex flex-col gap-6">
                  {/* Group 1 */}
                  <div className="flex flex-col gap-1">
                    {DRAGGABLE_FIELDS.filter(f => f.group === 1).map((f) => (
                      <div
                        key={f.type}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("fieldType", f.type)}
                        onClick={() => {
                          addPlacedField(f.type, "");
                        }}
                        className="flex items-center gap-3 rounded-xl border border-transparent hover:border-slate-200 bg-white p-2 hover:bg-slate-50 transition-colors cursor-grab active:cursor-grabbing select-none"
                      >
                        {f.icon}
                        <span className="text-sm font-medium text-slate-700">{f.label}</span>
                      </div>
                    ))}
                  </div>
                  
                  <div className="h-px bg-slate-200" />
                  
                  {/* Group 2 */}
                  <div className="flex flex-col gap-1">
                    {DRAGGABLE_FIELDS.filter(f => f.group === 2).map((f) => (
                      <div
                        key={f.type}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("fieldType", f.type)}
                        onClick={() => {
                          addPlacedField(f.type, "");
                        }}
                        className="flex items-center gap-3 rounded-xl border border-transparent hover:border-slate-200 bg-white p-2 hover:bg-slate-50 transition-colors cursor-grab active:cursor-grabbing select-none"
                      >
                        {f.icon}
                        <span className="text-sm font-medium text-slate-700">{f.label}</span>
                      </div>
                    ))}
                  </div>
                  
                  <div className="h-px bg-slate-200" />
                  
                  {/* Group 3 */}
                  <div className="flex flex-col gap-1">
                    {DRAGGABLE_FIELDS.filter(f => f.group === 3).map((f) => (
                      <div
                        key={f.type}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("fieldType", f.type)}
                        onClick={() => {
                          addPlacedField(f.type, "");
                        }}
                        className="flex items-center gap-3 rounded-xl border border-transparent hover:border-slate-200 bg-white p-2 hover:bg-slate-50 transition-colors cursor-grab active:cursor-grabbing select-none"
                      >
                        {f.icon}
                        <span className="text-sm font-medium text-slate-700">{f.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            <div 
              className="flex-1 overflow-y-auto bg-slate-100/50 p-8"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const type = e.dataTransfer.getData("fieldType");
                if (!type) return;
                if (!previewStageRef.current) return;
                const rect = previewStageRef.current.getBoundingClientRect();
                const x = Math.max(0, e.clientX - rect.left);
                const y = Math.max(0, e.clientY - rect.top);

                addPlacedField(type, "", { x, y });
              }}
            >
                <div className="max-w-4xl mx-auto flex justify-center">
                <div className="relative w-[800px]" ref={previewStageRef}>
                  <div
                    className="relative editable-content document-content w-full bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 text-[15px] text-slate-800 leading-[1.9] tracking-tight outline-none"
                    style={{
                      minHeight: `${DOCUMENT_STAGE_MIN_HEIGHT}px`,
                      padding: hasPositionedDocumentStage(localEditedContent || viewingItem.content || "") ? "0px" : `${DOCUMENT_STAGE_PADDING}px`,
                      fontFamily: DOCUMENT_STAGE_FONT_FAMILY,
                    }}
                    onClick={() => setSelectedFieldId(null)}
                    contentEditable={isEditMode}
                    suppressContentEditableWarning={true}
                    dangerouslySetInnerHTML={{
                      __html: (() => {
                        const baseHtml = localEditedContent || viewingItem.content || "";
                        if (hasPositionedDocumentStage(baseHtml)) return baseHtml;
                        const highlighted = baseHtml;

                        return renderDocumentStageBodyHtml(highlighted);
                      })()
                    }}
                  />
                  
                  {/* Draggable Placed Fields */}
                  {placedFields.map(field => {
                    const isSelected = selectedFieldId === field.id;
                    const { width: w, height: h } = getFieldSize(field);
                    const fontSize = getFieldFontSize(field);

                    if (field.type === "stamp") {
                      const radius = Math.max(12, Math.round(h * 0.16));
                      const accentThickness = Math.max(3, Math.round(h * 0.045));
                      const accentLength = Math.max(18, Math.round(w * 0.11));
                      const labelFontSize = Math.max(10, Math.round(h * 0.13));
                      const refFontSize = Math.max(10, Math.round(h * 0.12));
                      const sigMaxHeight = Math.max(34, Math.round(h * 0.38));
                      return (
                        <div
                          key={field.id}
                          className={`absolute rounded group cursor-grab active:cursor-grabbing select-none transition-all ${isSelected ? 'border-2 border-dashed border-violet-500 bg-violet-50/20' : 'border-2 border-dashed border-transparent'}`}
                          style={{ left: `${field.x}px`, top: `${field.y}px`, width: `${w}px`, height: `${h}px`, zIndex: 100 }}
                          onClick={e => {
                            e.stopPropagation();
                            if (skipFieldClickRef.current === field.id) {
                              skipFieldClickRef.current = null;
                              return;
                            }
                            setSelectedFieldId(field.id);
                          }}
                          onPointerDown={e => {
                            e.preventDefault(); e.stopPropagation();
                            setSelectedFieldId(field.id);
                            dragRef.current = { id: field.id, startClientX: e.clientX, startClientY: e.clientY, startX: field.x, startY: field.y };
                          }}
                        >
                          {savedSignature ? (
                            <div
                              className="pointer-events-none relative h-full w-full overflow-hidden bg-transparent"
                              style={{ borderRadius: `${radius}px` }}
                            >
                              <div className="absolute left-0 top-0 bottom-0 bg-indigo-600" style={{ width: `${accentThickness}px`, borderTopLeftRadius: `${radius}px`, borderBottomLeftRadius: `${radius}px` }} />
                              <div
                                className="absolute left-0 top-0 bg-indigo-600"
                                style={{ width: `${accentLength}px`, height: `${accentThickness}px`, borderRadius: `${radius}px ${accentThickness}px ${accentThickness}px ${accentThickness}px` }}
                              />
                              <div
                                className="absolute bottom-0 left-0 bg-indigo-600"
                                style={{ width: `${accentLength}px`, height: `${accentThickness}px`, borderRadius: `${accentThickness}px ${accentThickness}px ${accentThickness}px ${radius}px` }}
                              />
                              <div
                                className="flex h-full w-full flex-col justify-between"
                                style={{ padding: `${Math.max(6, Math.round(h * 0.08))}px ${Math.max(10, Math.round(w * 0.05))}px ${Math.max(6, Math.round(h * 0.08))}px ${Math.max(18, Math.round(w * 0.085))}px` }}
                              >
                                <div className="font-bold leading-none text-slate-900" style={{ fontSize: `${labelFontSize}px` }}>Signed by:</div>
                                <div className="flex items-center" style={{ minHeight: `${sigMaxHeight}px` }}>
                                  <img
                                    src={savedSignature}
                                    alt="Signature"
                                    className="w-full object-contain object-left"
                                    style={{ maxHeight: `${sigMaxHeight}px`, filter: "brightness(0.45) contrast(1.55)" }}
                                  />
                                </div>
                                {activeSigningReference ? (
                                  <div className="truncate leading-none text-slate-900" style={{ fontSize: `${refFontSize}px` }}>
                                    {activeSigningReference}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs text-center p-2">
                              No Signature Saved
                            </div>
                          )}
                          <button
                            type="button"
                            className={`absolute -right-2 -top-2 h-5 w-5 rounded-full bg-red-500 border border-white text-white shadow flex items-center justify-center hover:bg-red-600 transition-all ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                            style={{ zIndex: 110 }}
                            onClick={e => { e.stopPropagation(); setPlacedFields(prev => prev.filter(p => p.id !== field.id)); }}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                          <div
                            className="absolute -right-2 -bottom-2 w-5 h-5 cursor-nwse-resize bg-violet-600 rounded-full shadow-md hover:bg-violet-500 border-2 border-white flex items-center justify-center"
                            style={{ zIndex: 110, opacity: isSelected ? 1 : 0, pointerEvents: isSelected ? "auto" : "none" }}
                            onPointerDown={e => {
                              e.stopPropagation(); e.preventDefault();
                              resizeRef.current = { id: field.id, startClientX: e.clientX, startClientY: e.clientY, startWidth: w, startHeight: h };
                            }}
                          >
                            <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M22 22L12 22L22 12Z" fill="currentColor" />
                            </svg>
                          </div>
                        </div>
                      );
                    }

                    if (field.type === "checkbox") {
                      return (
                        <div
                          key={field.id}
                          className={`absolute rounded group cursor-grab active:cursor-grabbing select-none transition-all flex items-center justify-center ${isSelected ? 'border-2 border-dashed border-violet-500 bg-violet-50/10' : 'border-2 border-dashed border-transparent bg-transparent'}`}
                          style={{ left: `${field.x}px`, top: `${field.y}px`, zIndex: 100, width: `${w}px`, height: `${h}px` }}
                          onClick={e => {
                            e.stopPropagation();
                            if (skipFieldClickRef.current === field.id) {
                              skipFieldClickRef.current = null;
                              return;
                            }
                            setSelectedFieldId(field.id);
                          }}
                          onPointerDown={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedFieldId(field.id);
                            dragRef.current = { id: field.id, startClientX: e.clientX, startClientY: e.clientY, startX: field.x, startY: field.y };
                          }}
                        >
                          <span className="font-bold leading-none cursor-default" style={{ fontSize: `${Math.max(14, Math.round(h * 0.8))}px` }}>
                             ✓
                          </span>
                          <button
                            type="button"
                            className={`absolute -right-2 -top-2 h-5 w-5 rounded-full bg-red-500 border border-white text-white shadow flex items-center justify-center hover:bg-red-600 transition-all z-10 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                            onClick={e => { e.stopPropagation(); setPlacedFields(prev => prev.filter(p => p.id !== field.id)); }}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                          <div
                            className="absolute -right-2 -bottom-2 w-5 h-5 cursor-nwse-resize bg-violet-600 rounded-full shadow-md hover:bg-violet-500 border-2 border-white flex items-center justify-center"
                            style={{ zIndex: 110, opacity: isSelected ? 1 : 0, pointerEvents: isSelected ? "auto" : "none" }}
                            onPointerDown={e => {
                              e.stopPropagation();
                              e.preventDefault();
                              resizeRef.current = { id: field.id, startClientX: e.clientX, startClientY: e.clientY, startWidth: w, startHeight: h };
                            }}
                          >
                            <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M22 22L12 22L22 12Z" fill="currentColor" />
                            </svg>
                          </div>
                        </div>
                      );
                    }

                    const draggedDef = DRAGGABLE_FIELDS.find(f => f.type === field.type);
                    
                    // Text-based fields
                    return (
                      <div
                        key={field.id}
                        className={`absolute rounded group cursor-grab active:cursor-grabbing select-none transition-all whitespace-pre-wrap ${isSelected ? 'border-2 border-dashed border-violet-500 bg-violet-50/10' : 'border-2 border-dashed border-transparent bg-transparent'}`}
                        style={{ left: `${field.x}px`, top: `${field.y}px`, width: `${w}px`, height: `${h}px`, zIndex: 100 }}
                        onClick={e => { 
                          e.stopPropagation(); 
                          if (skipFieldClickRef.current === field.id) {
                            skipFieldClickRef.current = null;
                            return;
                          }
                          setSelectedFieldId(field.id);
                        }}
                        onPointerDown={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedFieldId(field.id);
                          const startClientX = e.clientX;
                          const startClientY = e.clientY;
                          const timer = window.setTimeout(() => {
                            dragRef.current = {
                              id: field.id,
                              startClientX,
                              startClientY,
                              startX: field.x,
                              startY: field.y,
                            };
                            textPressRef.current = null;
                          }, 180);
                          textPressRef.current = {
                            id: field.id,
                            startClientX,
                            startClientY,
                            startX: field.x,
                            startY: field.y,
                            timer,
                          };
                        }}
                      >
                        <div
                          className="flex h-full w-full items-center text-slate-800 font-medium px-2 py-1.5 cursor-grab active:cursor-grabbing"
                          style={{ fontSize: `${fontSize}px`, lineHeight: 1.2 }}
                          onClick={e => {
                            e.stopPropagation();
                            if (skipFieldClickRef.current === field.id) {
                              skipFieldClickRef.current = null;
                              return;
                            }
                            setSelectedFieldId(field.id);
                            promptFieldValue(field, draggedDef?.label || "Value");
                          }}
                        >
                          {field.value ? field.value : <span className="text-slate-400 font-normal italic">[{draggedDef?.label || "Empty"}]</span>}
                        </div>
                        <button
                          type="button"
                          className={`absolute -right-2 -top-2 h-5 w-5 rounded-full bg-red-500 border border-white text-white shadow flex items-center justify-center hover:bg-red-600 transition-all z-10 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                          onClick={e => { e.stopPropagation(); setPlacedFields(prev => prev.filter(p => p.id !== field.id)); }}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                        <div
                          className="absolute -right-2 -bottom-2 w-5 h-5 cursor-nwse-resize bg-violet-600 rounded-full shadow-md hover:bg-violet-500 border-2 border-white flex items-center justify-center"
                          style={{ zIndex: 110, opacity: isSelected ? 1 : 0, pointerEvents: isSelected ? "auto" : "none" }}
                          onPointerDown={e => {
                            e.stopPropagation();
                            e.preventDefault();
                            resizeRef.current = { id: field.id, startClientX: e.clientX, startClientY: e.clientY, startWidth: w, startHeight: h };
                          }}
                        >
                          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 22L12 22L22 12Z" fill="currentColor" />
                          </svg>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
              <h3 className="text-base font-bold text-slate-900">Request for Change</h3>
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
                  
                  // Capture current edits from the viewer if any
                  const contentDiv = document.querySelector('.editable-content');
                  const currentHtml = isEditMode && contentDiv 
                    ? (contentDiv as HTMLElement).innerHTML 
                    : (localEditedContent || (contentDiv ? (contentDiv as HTMLElement).innerHTML : undefined));

                  const { data: docRow } = await supabase
                    .from("documents")
                    .select("recipients, content")
                    .eq("id", requireChangesItem.id)
                    .single();

                  const patchData: Record<string, unknown> = { status: "rejected" };
                  
                  // Save edited content if it changed
                  if (currentHtml) {
                    // Always try to apply highlights if content changed from initial
                    if (currentHtml !== initialContent) {
                      patchData.content = highlightHtmlEdits(initialContent, currentHtml);
                    } else {
                      patchData.content = currentHtml;
                    }
                  }

                  if (docRow?.recipients && Array.isArray(docRow.recipients)) {
                    const updatedRecipients = docRow.recipients.map((r: any) =>
                      normalizeEmail(r.email) === currentEmail
                        ? { ...r, status: "changes_requested", reject_reason: requireChangesMessage.trim() || null }
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
                  
                  if (error) {
                    alert("Failed to send change request. Please try again.");
                    console.error("Error updating document:", error);
                    return;
                  }

                  setItems((prev) =>
                    prev.map((entry) =>
                      entry.virtualId === requireChangesItem.virtualId 
                        ? { 
                            ...entry, 
                            recipientStatus: "changes_requested",
                            content: patchData.content as string || entry.content
                          } 
                        : entry
                    )
                  );
                  
                  setRequireChangesItem(null);
                  setRequireChangesMessage("");
                  setViewingItem(null);
                  resetSigningState();
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
      {/* Confirm Approve Popup */}
      {showConfirmApprove && approveData && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3 mb-1">
                <div className="h-8 w-8 rounded-full bg-violet-100 flex items-center justify-center text-violet-600">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Confirm Approval</h3>
              </div>
              <p className="text-xs text-slate-500 ml-11">
                Are you sure you want to approve <span className="font-semibold text-slate-800">&ldquo;{approveData.item.name}&rdquo;</span>? This will notify the sender.
              </p>
            </div>
            <div className="px-6 py-6 flex gap-3">
              <button
                onClick={() => { setShowConfirmApprove(false); setApproveData(null); }}
                className="flex-1 py-2.5 rounded-2xl text-slate-600 font-bold text-sm border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const item = approveData.item;
                  const html = approveData.html;
                  setShowConfirmApprove(false);
                  setApproveData(null);
                  await handleUpdate(item, html);
                }}
                disabled={processingId === approveData.item.virtualId}
                className="flex-[2] py-2.5 rounded-2xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {processingId === approveData.item.virtualId ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Approving...</>
                ) : (
                  <>Confirm Approval</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Field Data Entry Modal */}
      {fieldToEdit && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 pt-6 pb-4">
               <div className="flex items-center gap-3 mb-2">
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <TypeIcon className="h-4 w-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Enter {fieldEditLabel}</h3>
              </div>
              <p className="text-xs text-slate-500 ml-11 mb-4">
                Please provide the information for this field.
              </p>
              
              <div className="ml-11">
                <input
                  type={fieldToEdit.type === "email" ? "email" : "text"}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50 transition-all font-mono"
                  value={fieldEditValue}
                  onChange={(e) => setFieldEditValue(e.target.value)}
                  placeholder={`Enter ${fieldEditLabel.toLowerCase()}...`}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                       setPlacedFields(prev => prev.map(p => p.id === fieldToEdit.id ? { ...p, value: fieldEditValue } : p));
                       setFieldToEdit(null);
                    }
                  }}
                />
              </div>
            </div>
            
            <div className="px-6 pb-6 pt-2 flex gap-3 ml-11">
              <button
                onClick={() => setFieldToEdit(null)}
                className="flex-1 py-2 rounded-xl text-slate-500 font-bold text-xs border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setPlacedFields(prev => prev.map(p => p.id === fieldToEdit.id ? { ...p, value: fieldEditValue } : p));
                  setFieldToEdit(null);
                }}
                className="flex-[1.5] py-2 rounded-xl bg-blue-600 text-white font-bold text-xs hover:bg-blue-700 transition-all shadow-md shadow-blue-100"
              >
                Apply Value
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

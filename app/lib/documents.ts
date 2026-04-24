import { supabase } from "./supabase/browser";

export type DocumentRecipient = {
  name: string;
  email: string;
  role?: string;
  status?: string;
  signed_file_url?: string;
  signed_content?: string;
  reject_reason?: string | null;
  sign_message?: string | null;
};

export type DocumentSender = {
  fullName: string;
  workEmail: string;
};

export type SharedDocumentRecord = {
  id: string;
  owner_id: string;
  name: string;
  subject: string;
  recipients: DocumentRecipient[];
  sender: DocumentSender;
  sent_at: string;
  status: string;
  file_url: string | null;
  file_key: string | null;
  category: string | null;
  content: string | null;
};

export const normalizeEmail = (value?: string | null) => value?.trim().toLowerCase() ?? "";

export const normalizeRecipients = (
  recipients: DocumentRecipient[] | null | undefined
): DocumentRecipient[] =>
  (recipients ?? [])
    .map((recipient) => ({
      ...recipient,
      name: recipient.name?.trim?.() ?? "",
      email: normalizeEmail(recipient.email),
      role: recipient.role?.trim?.(),
    }))
    .filter((recipient) => Boolean(recipient.email));

export const getMatchingRecipient = (
  recipients: DocumentRecipient[] | null | undefined,
  email: string
) => {
  const normalizedEmail = normalizeEmail(email);
  return (recipients ?? []).find((recipient) => normalizeEmail(recipient.email) === normalizedEmail) ?? null;
};

export const isReviewRequest = (record: Pick<SharedDocumentRecord, "category" | "status">, role?: string | null) =>
  record.category === "Reviewer" || record.status === "reviewing" || normalizeEmail(role) === "reviewer";

export const isCompletedForRecipient = (status: string) =>
  ["reviewed", "approved", "signed", "completed", "rejected", "changes_requested"].includes(status);

export const logDocumentEvent = async (documentId: string, eventType: string, payload: any = {}) => {
  try {
    const { error } = await supabase
      .from("document_events")
      .insert({
        document_id: documentId,
        event_type: eventType,
        payload: payload,
      });
    if (error) console.error("Event logging failed:", error);
  } catch (err) {
    console.error("Event logging error:", err);
  }
};

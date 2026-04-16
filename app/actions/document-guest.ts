"use server";

import { createSupabaseAdminClient } from "../lib/supabase/admin";
import { normalizeEmail, type DocumentRecipient } from "../lib/documents";

/**
 * Fetches basic metadata for a document given its ID.
 * Bypasses RLS to allow guest portal access.
 */
export async function getGuestDocumentMetaData(id: string) {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("documents")
      .select("id, name, status, access_id, access_password, access_first_login, content, file_url, recipients, category")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return { data, error: null };
  } catch (err: any) {
    console.error("getGuestDocumentMetaData error:", err);
    return { data: null, error: err.message || "Failed to fetch document" };
  }
}

/**
 * Updates the document with the first login timestamp if not already set.
 */
export async function markFirstLogin(id: string) {
  try {
    const supabase = createSupabaseAdminClient();
    const now = new Date().toISOString();
    
    // Check if already set
    const { data: current } = await supabase
      .from("documents")
      .select("access_first_login")
      .eq("id", id)
      .single();
      
    if (current?.access_first_login) return { data: current.access_first_login, error: null };

    const { error } = await supabase
      .from("documents")
      .update({ access_first_login: now })
      .eq("id", id);

    if (error) throw error;
    return { data: now, error: null };
  } catch (err: any) {
    return { data: null, error: err.message };
  }
}

/**
 * Submits a guest signature or review action.
 */
export async function submitGuestSignature(
  id: string, 
  signatureDataUrl: string, 
  message?: string, 
  editedContent?: string,
  statusOverride?: "reviewed" | "signed" | "rejected" | "changes_requested"
) {
  try {
    const supabase = createSupabaseAdminClient();
    
    // 1. Fetch current recipients
    const { data: doc, error: fetchError } = await supabase
      .from("documents")
      .select("recipients, category, content")
      .eq("id", id)
      .single();
      
    if (fetchError || !doc) throw new Error("Document not found");

    // 2. Identify the guest recipient
    let recipients = doc.recipients as DocumentRecipient[];
    const isReviewDoc = doc.category === "Reviewer";
    const status = statusOverride || (isReviewDoc ? "reviewed" : "signed");
    
    if (recipients.length > 0) {
      let updated = false;
      recipients = recipients.map((r) => {
        if (!updated && !["signed", "reviewed", "approved", "completed", "rejected", "changes_requested"].includes(r.status || "")) {
          updated = true;
          return {
            ...r,
            status: status,
            signed_content: editedContent || signatureDataUrl || r.signed_content,
            sign_message: message || r.sign_message,
            reject_reason: (status === "rejected" || status === "changes_requested") ? message : r.reject_reason
          };
        }
        return r;
      });
      
      if (!updated) {
        recipients[0] = {
          ...recipients[0],
          status: status,
          signed_content: editedContent || signatureDataUrl || recipients[0].signed_content,
          sign_message: message || recipients[0].sign_message,
          reject_reason: (status === "rejected" || status === "changes_requested") ? message : recipients[0].reject_reason
        };
      }
    }

    // 3. Update document status and content
    const updatePayload: any = {
      recipients,
      // The documents table constraint only allows 'rejected', not 'changes_requested'
      status: status === "changes_requested" ? "rejected" : status,
    };
    
    if (editedContent) {
      updatePayload.content = editedContent;
    }

    if (status === "reviewed" || status === "rejected" || status === "changes_requested") {
      updatePayload.reviewed_at = new Date().toISOString();
    } else {
      updatePayload.signed_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from("documents")
      .update(updatePayload)
      .eq("id", id);

    if (updateError) throw updateError;
    return { success: true };
  } catch (err: any) {
    console.error("submitGuestSignature error:", err);
    return { success: false, error: err.message };
  }
}

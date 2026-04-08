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
      .select("id, name, status, access_id, access_password, access_first_login, content, file_url")
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
 * Submits a guest signature.
 */
export async function submitGuestSignature(id: string, signatureDataUrl: string, message?: string) {
  try {
    const supabase = createSupabaseAdminClient();
    
    // 1. Fetch current recipients
    const { data: doc, error: fetchError } = await supabase
      .from("documents")
      .select("recipients, category")
      .eq("id", id)
      .single();
      
    if (fetchError || !doc) throw new Error("Document not found");

    // 2. Identify the guest recipient (for now assuming first recipient if not specified, 
    // but in a real app we'd match by email from the portal session)
    let recipients = doc.recipients as DocumentRecipient[];
    const isReviewDoc = doc.category === "Reviewer";
    const status = isReviewDoc ? "reviewed" : "completed";
    
    // Update the recipient status
    // Note: In this version We're updating the first recipient for simplicity, 
    // or we could match by a specific guest identifier if we had one.
    if (recipients.length > 0) {
      recipients = recipients.map((r, idx) => {
        if (idx === 0) { // For simplicity, update the first one
          return {
            ...r,
            status: status,
            signed_content: signatureDataUrl, // Or a more complex injection
            sign_message: message || r.sign_message
          };
        }
        return r;
      });
    }

    // 3. Update document status
    const updatePayload: any = {
      recipients,
      status: status,
    };
    
    if (isReviewDoc) {
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

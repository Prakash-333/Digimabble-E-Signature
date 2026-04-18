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

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

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
    
    // 1. Fetch current recipients and metadata
    const { data: doc, error: fetchError } = await supabase
      .from("documents")
      .select("recipients, category, content, name, sender")
      .eq("id", id)
      .single();
      
    if (fetchError || !doc) throw new Error("Document not found");

    // 2. Identify the guest recipient
    let recipients = (doc.recipients as DocumentRecipient[]) || [];
    const isReviewDoc = doc.category === "Reviewer";
    const status = statusOverride || (isReviewDoc ? "reviewed" : "signed");
    
    let guestRecipient = recipients[0]; // Fallback

    if (recipients.length > 0) {
      let updated = false;
      recipients = recipients.map((r) => {
        if (!updated && !["signed", "reviewed", "approved", "completed", "rejected", "changes_requested"].includes(r.status || "")) {
          updated = true;
          guestRecipient = {
            ...r,
            status: status,
            signed_content: editedContent || signatureDataUrl || r.signed_content,
            sign_message: message || r.sign_message,
            reject_reason: (status === "rejected" || status === "changes_requested") ? message : r.reject_reason
          };
          return guestRecipient;
        }
        return r;
      });
      
      if (!updated) {
        guestRecipient = {
          ...recipients[0],
          status: status,
          signed_content: editedContent || signatureDataUrl || recipients[0].signed_content,
          sign_message: message || recipients[0].sign_message,
          reject_reason: (status === "rejected" || status === "changes_requested") ? message : recipients[0].reject_reason
        };
        recipients[0] = guestRecipient;
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

    // 4. Trigger Notifications if External
    const sender = doc.sender as any;
    if (sender?.isExternal && sender?.workEmail) {
      try {
        const actionLabel = status === "reviewed" ? "approved" : status === "rejected" ? "rejected" : status === "changes_requested" ? "requested changes for" : "signed";
        
        await resend.emails.send({
          from: 'SMARTDOCS <onboarding@resend.dev>',
          to: [sender.workEmail],
          subject: `${guestRecipient?.name || "A recipient"} has ${actionLabel} your document`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #4f46e5;">Document Update</h1>
              <p>Hello ${sender.fullName || "Sender"},</p>
              <p><strong>${guestRecipient?.name || "A recipient"}</strong> has ${actionLabel} your document: <strong>${doc.name}</strong>.</p>
              <div style="margin: 20px 0; padding: 15px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                <p style="margin: 0; font-size: 14px; color: #475569;">Status: <span style="font-weight: bold; color: #1e293b;">${status.charAt(0).toUpperCase() + status.slice(1)}</span></p>
                ${message ? `<p style="margin: 10px 0 0 0; font-size: 14px; color: #475569;">Message: "${message}"</p>` : ""}
              </div>
              <p style="font-size: 14px; color: #64748b;">You can view the updated document in your SmartDocs dashboard.</p>
            </div>
          `
        });
      } catch (emailErr) {
        console.warn("Failed to send notification email to owner:", emailErr);
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error("submitGuestSignature error:", err);
    return { success: false, error: err.message };
  }
}

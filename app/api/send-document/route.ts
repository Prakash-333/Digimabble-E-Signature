import { Resend } from 'resend';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../lib/supabase/admin';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const { documentId, recipientEmail, recipientName, senderName, subject, documentName } = await request.json();

    if (!documentId || !recipientEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Generate Temporary Credentials
    // Format: DOC-XXXX (where XXXX is random numbers)
    const accessId = `DOC-${Math.floor(1000 + Math.random() * 9000)}`;
    const accessPassword = Math.floor(1000 + Math.random() * 9000).toString();

    // 2. Update Document in Supabase with credentials (using Admin client to bypass RLS)
    const supabaseAdmin = createSupabaseAdminClient();
    
    const { error: updateError } = await supabaseAdmin
      .from('documents')
      .update({
        access_id: accessId,
        access_password: accessPassword,
        status: 'waiting',
        sent_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('Database Admin Update Error:', updateError);
      return NextResponse.json({ error: 'Failed to save access credentials' }, { status: 500 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const signLink = `${appUrl}/sign/${documentId}`;

    // 3. Send modern email with credentials
    const { data, error } = await resend.emails.send({
      from: 'SMARTDOCS <onboarding@resend.dev>',
      to: [recipientEmail],
      subject: subject || `Portal Access: ${documentName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #fcfcfd;">
          <div style="text-align: center; margin-bottom: 32px;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; background-color: #4f46e5; border-radius: 12px; color: white; font-weight: bold; font-size: 20px; margin-bottom: 16px;">S</div>
            <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #1e293b; letter-spacing: -0.02em; text-transform: uppercase;">SMARTDOCS</h1>
          </div>

          <div style="background-color: white; border: 1px solid #e2e8f0; border-radius: 24px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            <p style="margin-top: 0; color: #475569; font-size: 16px; line-height: 24px;">Hello ${recipientName || 'Recipient'},</p>
            <p style="color: #475569; font-size: 16px; line-height: 24px;"><strong>${senderName || 'A sender'}</strong> has invited you to access a secure document portal for:</p>
            
            <div style="margin: 24px 0; padding: 20px; background-color: #f8fafc; border-radius: 16px; border: 1px solid #f1f5f9;">
              <p style="margin: 0; font-weight: 700; color: #1e293b; font-size: 18px;">${documentName}</p>
            </div>

            <p style="color: #475569; font-size: 14px; margin-bottom: 8px;">Please use the following temporary credentials to log in:</p>
            
            <div style="display: flex; gap: 12px; margin-bottom: 32px;">
              <div style="flex: 1; padding: 16px; background-color: #f1f5f9; border-radius: 12px; text-align: center;">
                <span style="display: block; font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Access ID</span>
                <span style="font-family: monospace; font-size: 18px; font-weight: 700; color: #4f46e5;">${accessId}</span>
              </div>
              <div style="flex: 1; padding: 16px; background-color: #f1f5f9; border-radius: 12px; text-align: center;">
                <span style="display: block; font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Password</span>
                <span style="font-family: monospace; font-size: 18px; font-weight: 700; color: #4f46e5;">${accessPassword}</span>
              </div>
            </div>

            <a href="${signLink}" style="display: block; background-color: #4f46e5; color: white; padding: 16px; border-radius: 14px; text-decoration: none; font-weight: 700; text-align: center; font-size: 16px; transition: background-color 0.2s;">Enter Secure Portal</a>
            
            <p style="margin-top: 24px; font-size: 12px; color: #94a3b8; text-align: center;">Note: For your security, the password will expire 10 minutes after your first login.</p>
          </div>

          <p style="margin-top: 32px; font-size: 12px; color: #94a3b8; text-align: center;">
            You are receiving this because you were invited to sign a document via SMARTDOCS.<br/>
            &copy; 2026 SMARTDOCS. All rights reserved.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Resend Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: 'Email sent successfully', id: data?.id });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

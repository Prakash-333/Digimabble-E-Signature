import { Resend } from 'resend';
import { NextResponse } from 'next/server';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const { documentId, recipientEmail, recipientName, senderName, subject, documentName } = await request.json();

    if (!documentId || !recipientEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const signLink = `${appUrl}/sign/${documentId}`;

    const { data, error } = await resend.emails.send({
      from: 'SMARTDOCS <onboarding@resend.dev>',
      to: [recipientEmail],
      subject: subject || `Signature Request: ${documentName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #4f46e5;">SMARTDOCS</h2>
          <p>Hello ${recipientName || 'there'},</p>
          <p><strong>${senderName || 'A user'}</strong> has sent you a document to review and sign.</p>
          <div style="margin: 30px 0; background-color: #f8fafc; padding: 20px; border-radius: 6px; border-left: 4px solid #4f46e5;">
            <p style="margin: 0; font-weight: bold; color: #1e293b;">${documentName}</p>
          </div>
          <p>Please click the button below to view the document and complete the requested action.</p>
          <a href="${signLink}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 10px;">View & Sign Document</a>
          <p style="margin-top: 30px; font-size: 12px; color: #64748b;">If the button above doesn't work, copy and paste this link into your browser:</p>
          <p style="font-size: 12px; color: #4f46e5; word-break: break-all;">${signLink}</p>
          <hr style="margin: 30px 0; border: 0; border-top: 1px solid #e2e8f0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center;">Powered by SMARTDOCS - Intelligent Agreement Management</p>
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

import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SmartDocs",
  description:
    "A modern agreement platform inspired by the DocuSign experience.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}

// Vercel Sync 1.0.8

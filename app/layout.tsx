import type { Metadata } from "next";
import "./globals.css";
import StyleFix from "./style-fix";

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
        <StyleFix />
      </body>
    </html>
  );
}

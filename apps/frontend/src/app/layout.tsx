import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "./globals.css";
import { ReactNode } from "react";
import { Toaster } from 'sonner';
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta-sans",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const inter = Inter({
  variable: "--font-inter-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Ehastakshar - India's Most Trusted Digital Signature Platform",
  description:
    "Upload documents, add recipients, and get them signed securely with Aadhaar eSign or Simple eSign. Streamline your legal and business workflows with absolute precision.",
  metadataBase: new URL("https://ehastakshar.com"),
  openGraph: {
    title: "Ehastakshar - India's Most Trusted Digital Signature Platform",
    description:
      "Secure, legally binding Aadhaar eSign and Simple eSign solutions.",
    type: "website",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ehastakshar - Digital Signature Platform",
  },
  keywords: ["eSign", "Aadhaar eSign", "Digital Signature", "India"],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${inter.variable} scroll-smooth antialiased h-full`}
    >
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <GlobalErrorBoundary>
          {children}
        </GlobalErrorBoundary>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}

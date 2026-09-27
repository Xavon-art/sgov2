import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const OG_IMAGE = {
  url: "/og-v2.jpg",
  width: 1200,
  height: 630,
  alt: "SmartGov — one system for every student council. Governance, academics, budgets, and verified public records for university student governments.",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://sgov.vercel.app"),
  title: {
    default: "SmartGov — One system. Every student council.",
    template: "%s · SmartGov",
  },
  description:
    "SmartGov is a centralized, intelligent governance management system for university student governments. Connect your USG and every local student council beneath it.",
  keywords: [
    "student government",
    "university governance",
    "student council",
    "USG",
    "LSG",
    "governance management system",
  ],
  openGraph: {
    title: "SmartGov — One system. Every student council.",
    description:
      "Centralized, intelligent governance management for university student governments. Resolutions, budgets, and feedback in one shared record.",
    url: "/",
    siteName: "SmartGov",
    locale: "en_US",
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "SmartGov — One system. Every student council.",
    description:
      "Connect your USG and every local student council beneath it — resolutions, budgets, and feedback in one shared record.",
    images: [OG_IMAGE.url],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

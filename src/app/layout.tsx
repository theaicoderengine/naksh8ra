import type { Metadata, Viewport } from "next";
import "./globals.css";
import { brand } from "@/lib/brand";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: `${brand().name} — ${brand().tagline}`, template: `%s · ${brand().name}` },
  description: "Multi-tenant AI recruitment platform: structured AI voice interviews, evidence-based assessment, student and campus hiring.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1d4ed8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

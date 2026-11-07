import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // Vercel sets this to the project's main domain, so link previews follow a domain change.
  metadataBase: new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "arda.vercel.app"}`),
  title: "Arda",
  description: "Raise a tiny civilisation on a pocket-sized planet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

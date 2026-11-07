import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
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

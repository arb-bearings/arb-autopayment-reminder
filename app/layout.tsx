import type { Metadata } from "next";
import "./globals.css";
import { GlobalLoader } from "@/components/global-loader";

export const metadata: Metadata = {
  title: "Auto Payment Reminder",
  description: "Upload dues, match contacts, and send payment reminders from one dashboard."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <GlobalLoader />
        {children}
      </body>
    </html>
  );
}

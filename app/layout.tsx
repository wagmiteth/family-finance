import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { EncryptionProvider } from "@/lib/crypto/encryption-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Family Finance",
  description: "Shared expense dashboard for households",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <EncryptionProvider>
          {children}
        </EncryptionProvider>
        <Toaster
          toastOptions={{
            className: "font-sans",
          }}
        />
      </body>
    </html>
  );
}

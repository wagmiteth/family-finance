import type { Metadata } from "next";
import { Agentation } from "agentation";
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
        {process.env.NODE_ENV === "development" && <Agentation />}
        <Toaster
          closeButton
          toastOptions={{
            className: "font-sans",
            classNames: {
              description: "!text-foreground !opacity-80",
            },
          }}
        />
      </body>
    </html>
  );
}

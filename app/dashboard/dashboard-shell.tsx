"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Upload,
  Calculator,
  Settings,
  Menu,
  LogOut,
  User,
} from "lucide-react";
import { useState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { decryptEntity } from "@/lib/crypto/entity-crypto";
import { getDEK } from "@/lib/crypto/key-store";
import { useEncryption } from "@/lib/crypto/encryption-context";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/upload", label: "Upload", icon: Upload },
  { href: "/dashboard/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/dashboard/settlements", label: "Settlements", icon: Calculator },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function NavLinks({
  pathname,
  direction = "horizontal",
  onNavigate,
}: {
  pathname: string;
  direction?: "horizontal" | "vertical";
  onNavigate?: () => void;
}) {
  return (
    <nav
      className={cn(
        "flex gap-1",
        direction === "vertical" ? "flex-col" : "items-center"
      )}
    >
      {navItems.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardShell({
  user: rawUser,
  householdEncryptedData,
  children,
}: {
  user: Record<string, unknown>;
  householdEncryptedData: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isUnlocked, lock } = useEncryption();
  const mobileMenuTriggerId = useId();
  const accountMenuTriggerId = useId();

  // Decrypted state
  const [userName, setUserName] = useState(rawUser.email as string || "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [householdName, setHouseholdName] = useState("Household");

  useEffect(() => {
    async function decrypt() {
      const dek = getDEK();
      if (!dek) return;

      // Decrypt user
      try {
        const decryptedUser = await decryptEntity(rawUser as Record<string, unknown> & { encrypted_data?: string | null }, dek);
        if (decryptedUser.name) setUserName(decryptedUser.name as string);
        if (decryptedUser.avatar_url) setAvatarUrl(decryptedUser.avatar_url as string);
      } catch { /* ignore */ }

      // Decrypt household
      if (householdEncryptedData) {
        try {
          const decryptedHousehold = await decryptEntity(
            { encrypted_data: householdEncryptedData } as Record<string, unknown> & { encrypted_data: string },
            dek
          );
          if (decryptedHousehold.name) setHouseholdName(decryptedHousehold.name as string);
        } catch { /* ignore */ }
      }
    }
    decrypt();
  }, [rawUser, householdEncryptedData, isUnlocked]);

  const initials = userName
    .split(" ")
    .map((s) => s[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top navigation bar */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center gap-4 px-4 md:px-6">
          {/* Mobile hamburger */}
          <Sheet
            open={mobileOpen}
            onOpenChange={setMobileOpen}
            triggerId={mobileMenuTriggerId}
          >
            <SheetTrigger
              id={mobileMenuTriggerId}
              render={
                <Button variant="ghost" size="icon" className="shrink-0 md:hidden">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Menu</span>
                </Button>
              }
            />
            <SheetContent side="left" className="w-[260px] p-0">
              <SheetHeader className="border-b px-5 py-4">
                <SheetTitle className="text-sm">{householdName}</SheetTitle>
              </SheetHeader>
              <div className="p-3">
                <NavLinks
                  pathname={pathname}
                  direction="vertical"
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 17a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5s-5 2.24-5 5Z"/>
                <path d="M12 17a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5s-5 2.24-5 5Z"/>
                <path d="M7 7a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5S7 4.24 7 7Z"/>
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight hidden sm:inline">
              {householdName}
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex flex-1">
            <NavLinks pathname={pathname} />
          </div>

          {/* Spacer for mobile */}
          <div className="flex-1 md:hidden" />

          {/* User menu */}
          <DropdownMenu triggerId={accountMenuTriggerId}>
            <DropdownMenuTrigger
              id={accountMenuTriggerId}
              className={cn(
                "flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-accent focus:outline-none",
                pathname === "/dashboard/account" && "ring-2 ring-primary ring-offset-2"
              )}
            >
              <Avatar className="h-8 w-8">
                {avatarUrl && <AvatarImage src={avatarUrl} />}
                <AvatarFallback className="text-[10px] font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => router.push("/dashboard/account")}>
                <User className="mr-2 h-4 w-4" />
                Account
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  lock();
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  router.push("/login");
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto p-5 md:p-8 lg:p-10">
        {children}
      </main>
    </div>
  );
}

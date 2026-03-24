"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEncryption } from "@/lib/crypto/encryption-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteParam = searchParams.get("invite");
  const supabase = createClient();
  const { unlock } = useEncryption();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSignUp, setIsSignUp] = useState(!!inviteParam);
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<{
    inviter_name: string;
    inviter_avatar_url: string | null;
    household_name: string;
  } | null>(null);

  useEffect(() => {
    if (!inviteParam) return;
    fetch(`/api/invite/${inviteParam}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setInviteInfo(data); })
      .catch(() => {});
  }, [inviteParam]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (signUpError) {
          toast.error(signUpError.message);
          return;
        }

        // Store password temporarily for onboarding key generation
        // Uses localStorage so it survives the email confirmation redirect
        localStorage.setItem("ff_onboarding_pw", password);
        localStorage.setItem("ff_onboarding_pw_ts", Date.now().toString());

        // Persist invite code if present so it survives the email confirmation redirect
        if (inviteParam) {
          localStorage.setItem("ff_invite_code", inviteParam);
        }

        if (!data.session) {
          setConfirmationSent(true);
          return;
        }

        toast.success("Account created successfully!");
        router.push(inviteParam ? `/onboarding?invite=${inviteParam}` : "/onboarding");
      } else {
        const { error: signInError } =
          await supabase.auth.signInWithPassword({ email, password });

        if (signInError) {
          toast.error(signInError.message);
          return;
        }

        // Try to unlock encryption with the password
        try {
          await unlock(password);
        } catch {
          // Key material may not exist yet (user hasn't completed onboarding)
          // or user is on legacy encryption. This is fine — the unlock modal
          // will handle it if needed.
        }

        toast.success("Welcome back!");
        router.push("/dashboard");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (confirmationSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="text-center mb-8">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary">
                <path d="M22 10.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12.5" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                <path d="m16 19 2 2 4-4" />
              </svg>
            </div>
            <h1 className="font-heading text-2xl font-bold tracking-tight mb-2">
              Check your email
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We sent a confirmation link to <strong className="text-foreground">{email}</strong>.
              Click the link to activate your account, then come back and sign in.
            </p>
          </div>
          <Button
            variant="ghost"
            className="w-full text-sm"
            onClick={() => {
              setConfirmationSent(false);
              setIsSignUp(false);
            }}
          >
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Left panel — decorative */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-[50%] relative overflow-hidden"
        style={{ background: "oklch(0.25 0.035 155)" }}
      >
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
            backgroundRepeat: "repeat",
            backgroundSize: "256px 256px",
          }}
        />
        {/* Decorative circles */}
        <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full border border-white/5" />
        <div className="absolute top-1/3 left-1/3 w-96 h-96 rounded-full border border-white/[0.03]" />
        <div className="absolute bottom-1/4 right-1/4 w-48 h-48 rounded-full bg-white/[0.03]" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/80">
                  <path d="M2 17a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5s-5 2.24-5 5Z"/>
                  <path d="M12 17a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5s-5 2.24-5 5Z"/>
                  <path d="M7 7a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5S7 4.24 7 7Z"/>
                </svg>
              </div>
              <span className="text-sm font-medium text-white/60 tracking-wide">Family Finance</span>
            </div>
          </div>

          <div>
            <blockquote className="font-heading text-3xl xl:text-4xl text-white/90 font-medium leading-snug tracking-tight">
              Shared expenses,
              <br />
              beautifully sorted.
            </blockquote>
            <p className="mt-4 text-sm text-white/40 max-w-sm leading-relaxed">
              Upload your transactions, categorize together, and settle up at the end of each month.
            </p>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-sm animate-fade-up">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                <path d="M2 17a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5s-5 2.24-5 5Z"/>
                <path d="M12 17a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5s-5 2.24-5 5Z"/>
                <path d="M7 7a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5S7 4.24 7 7Z"/>
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight">Family Finance</span>
          </div>

          {inviteInfo ? (
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <Avatar className="h-12 w-12">
                  {inviteInfo.inviter_avatar_url && (
                    <AvatarImage src={inviteInfo.inviter_avatar_url} />
                  )}
                  <AvatarFallback className="text-base font-semibold">
                    {inviteInfo.inviter_name[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-semibold">{inviteInfo.inviter_name}</p>
                  <p className="text-xs text-muted-foreground">invites you to join</p>
                </div>
              </div>
              <h1 className="font-heading text-2xl font-bold tracking-tight">
                Share household expenses
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Create an account to join <strong>{inviteInfo.household_name}</strong> and start tracking expenses together.
              </p>
            </div>
          ) : (
            <div className="mb-8">
              <h1 className="font-heading text-2xl font-bold tracking-tight">
                {isSignUp ? "Create your account" : "Welcome back"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {isSignUp
                  ? "Get started with your household"
                  : "Sign in to continue"}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Name
                </Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-11"
              />
            </div>

            {isSignUp && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                <strong>Important:</strong> Your password is your encryption key.
                All financial data is encrypted with it. If you forget your
                password, your data cannot be recovered.
              </div>
            )}

            <div className="pt-2 space-y-3">
              <Button type="submit" className="w-full h-11 font-semibold" disabled={loading}>
                {loading
                  ? "Loading..."
                  : isSignUp
                    ? "Create Account"
                    : "Sign In"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                onClick={() => setIsSignUp(!isSignUp)}
              >
                {isSignUp
                  ? "Already have an account? Sign in"
                  : "Don't have an account? Sign up"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

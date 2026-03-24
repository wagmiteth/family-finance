"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEncryption } from "@/lib/crypto/encryption-context";
import {
  generateDEK,
  generateSalt,
  deriveKEK,
  wrapDEK,
  unwrapDEK,
  toBase64,
  fromBase64,
  KDF_ITERATIONS,
} from "@/lib/crypto/client-crypto";
import { setDEK } from "@/lib/crypto/key-store";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Home, UserPlus } from "lucide-react";
import { InviteBanner } from "@/components/invite-banner";

type Step = "choose" | "create" | "join";

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isUnlocked } = useEncryption();

  const [step, setStep] = useState<Step>("choose");
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<{
    inviter_name: string;
    inviter_avatar_url: string | null;
    household_name: string;
  } | null>(null);

  useEffect(() => {
    async function checkHousehold() {
      const res = await fetch("/api/user");

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      if (res.ok) {
        const user = await res.json();
        if (user.name) setUserName(user.name);
        if (user.household_id) {
          router.push("/dashboard");
          return;
        }
      }

      setLoading(false);

      // Check if we need to ask for password
      // Stored in localStorage with a 10-minute TTL to survive email confirmation redirect
      const storedPw = localStorage.getItem("ff_onboarding_pw");
      const storedTs = localStorage.getItem("ff_onboarding_pw_ts");
      const isExpired = !storedTs || Date.now() - parseInt(storedTs) > 10 * 60 * 1000;
      if (!storedPw || isExpired) {
        localStorage.removeItem("ff_onboarding_pw");
        localStorage.removeItem("ff_onboarding_pw_ts");
        setNeedsPassword(true);
      }

      // Auto-fill invite code from URL or localStorage and go to join step
      const invite = searchParams.get("invite") || localStorage.getItem("ff_invite_code");
      if (invite) {
        const code = invite.trim().toUpperCase();
        setInviteCode(code);
        setStep("join");
        localStorage.removeItem("ff_invite_code");

        // Fetch inviter info for personalized UI
        fetch(`/api/invite/${code}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => { if (data) setInviteInfo(data); })
          .catch(() => {});
      }
    }

    checkHousehold();
  }, [router, searchParams]);

  /** Get the password from localStorage or from the form field */
  function getPassword(): string | null {
    const pw = localStorage.getItem("ff_onboarding_pw");
    if (pw) return pw;
    return password || null;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    try {
      const password = getPassword();
      if (!password) {
        toast.error("Password is required to set up encryption");
        return;
      }

      // 1. Create household via API
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdName }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to create household");
        return;
      }

      const data = await res.json();
      const code = data.household?.invite_code || "";

      // 2. Generate DEK for the household
      const dek = await generateDEK();

      // 3. Wrap DEK with user's password-derived KEK
      const userSalt = generateSalt();
      const userKEK = await deriveKEK(password, userSalt, KDF_ITERATIONS);
      const wrappedDEK = await wrapDEK(dek, userKEK);

      // 4. Store user key material
      await fetch("/api/user/key-material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salt: toBase64(userSalt),
          iterations: KDF_ITERATIONS,
          wrapped_dek: toBase64(wrappedDEK),
        }),
      });

      // 5. Wrap DEK with invite-code-derived KEK for key exchange
      const inviteCodeSalt = generateSalt();
      const inviteCodeKEK = await deriveKEK(
        code,
        inviteCodeSalt,
        KDF_ITERATIONS
      );
      const inviteWrappedDEK = await wrapDEK(dek, inviteCodeKEK);

      // 6. Store invite-code-wrapped DEK on the household
      await fetch("/api/household/encryption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encrypted_dek: toBase64(inviteWrappedDEK),
          invite_code_salt: toBase64(inviteCodeSalt),
        }),
      });

      // 7. Store DEK in session
      await setDEK(dek);

      // Clean up temporary password
      localStorage.removeItem("ff_onboarding_pw");
      localStorage.removeItem("ff_onboarding_pw_ts");

      setGeneratedCode(code);
      setStep("create");
      toast.success("Household created!");
    } catch (err) {
      console.error("[handleCreate]", err);
      toast.error("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    try {
      const password = getPassword();
      if (!password) {
        toast.error("Password is required to set up encryption");
        return;
      }

      const normalizedCode = inviteCode.trim().toUpperCase();

      // 1. Join household via API
      const res = await fetch("/api/household/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: normalizedCode }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to join household");
        return;
      }

      const joinData = await res.json();

      // 2. Get the invite-code-wrapped DEK from the household
      const encRes = await fetch("/api/household/encryption");
      if (!encRes.ok) {
        toast.error("Failed to retrieve encryption keys");
        return;
      }

      const { encrypted_dek, invite_code_salt } = await encRes.json();

      if (!encrypted_dek || !invite_code_salt) {
        toast.error("Household encryption not set up by the creator");
        return;
      }

      // 3. Derive KEK from invite code and unwrap DEK
      const inviteCodeSaltBytes = fromBase64(invite_code_salt);
      const inviteCodeKEK = await deriveKEK(
        normalizedCode,
        inviteCodeSaltBytes,
        KDF_ITERATIONS
      );
      const inviteWrappedBytes = fromBase64(encrypted_dek);
      const dek = await unwrapDEK(inviteWrappedBytes.buffer as ArrayBuffer, inviteCodeKEK);

      // 4. Wrap DEK with user's own password-derived KEK
      const userSalt = generateSalt();
      const userKEK = await deriveKEK(password, userSalt, KDF_ITERATIONS);
      const wrappedDEK = await wrapDEK(dek, userKEK);

      // 5. Store user key material
      await fetch("/api/user/key-material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salt: toBase64(userSalt),
          iterations: KDF_ITERATIONS,
          wrapped_dek: toBase64(wrappedDEK),
        }),
      });

      // 6. Clear the invite-code-wrapped DEK (no longer needed)
      await fetch("/api/household/encryption", {
        method: "DELETE",
      });

      // 7. Store DEK in session
      await setDEK(dek);

      // Clean up temporary password
      localStorage.removeItem("ff_onboarding_pw");
      localStorage.removeItem("ff_onboarding_pw_ts");

      toast.success("Joined household successfully!");
      router.push("/dashboard");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }


  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to Family Finance</h1>
          <p className="mt-2 text-muted-foreground">
            Set up your household to start tracking shared expenses
          </p>
        </div>

        {step === "choose" && (
          <div className="grid gap-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              <strong>End-to-end encryption:</strong> Your financial data is
              encrypted with your password before it leaves your device. Not
              even we can read it. If you and your partner both forget your
              passwords, all data is permanently lost.
            </div>

            <Card
              className="cursor-pointer transition-colors hover:bg-accent"
              onClick={() => setStep("create")}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Home className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">
                      Create a Household
                    </CardTitle>
                    <CardDescription>
                      Start a new household and invite your partner
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>

            <Card
              className="cursor-pointer transition-colors hover:bg-accent"
              onClick={() => setStep("join")}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <UserPlus className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">
                      Join a Household
                    </CardTitle>
                    <CardDescription>
                      Enter an invite code from your partner
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </div>
        )}

        {step === "create" && !generatedCode && (
          <Card>
            <CardHeader>
              <CardTitle>Create Household</CardTitle>
              <CardDescription>
                Give your household a name
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleCreate}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="householdName">Household Name</Label>
                  <Input
                    id="householdName"
                    placeholder="e.g. The Carlssons"
                    value={householdName}
                    onChange={(e) => setHouseholdName(e.target.value)}
                    required
                  />
                </div>
                {needsPassword && (
                  <div className="space-y-2">
                    <Label htmlFor="create-password">Password</Label>
                    <Input
                      id="create-password"
                      type="password"
                      placeholder="Enter your account password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter the same password you used when creating your account. It&apos;s used to encrypt your financial data.
                    </p>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep("choose")}
                  >
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" disabled={submitting}>
                    {submitting ? "Setting up encryption..." : "Create Household"}
                  </Button>
                </div>
              </CardContent>
            </form>
          </Card>
        )}

        {step === "create" && generatedCode && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Household Created!</CardTitle>
                <CardDescription>
                  Your household is ready. Invite your partner to start tracking expenses together.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full"
                  onClick={() => router.push("/dashboard")}
                >
                  Go to Dashboard
                </Button>
              </CardContent>
            </Card>
            <InviteBanner inviteCode={generatedCode} inviterName={userName} />
          </div>
        )}

        {step === "join" && (
          <Card>
            <CardHeader>
              {inviteInfo ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
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
                  <div>
                    <CardTitle>Join {inviteInfo.household_name}</CardTitle>
                    <CardDescription className="mt-1">
                      You&apos;ll share household expenses together with end-to-end encryption.
                    </CardDescription>
                  </div>
                </div>
              ) : (
                <>
                  <CardTitle>Join Household</CardTitle>
                  <CardDescription>
                    Enter the invite code you received
                  </CardDescription>
                </>
              )}
            </CardHeader>
            <form onSubmit={handleJoin}>
              <CardContent className="space-y-4">
                {!inviteInfo && (
                  <div className="space-y-2">
                    <Label htmlFor="inviteCode">Invite Code</Label>
                    <Input
                      id="inviteCode"
                      placeholder="Enter invite code"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      required
                      className="font-mono text-center text-lg"
                    />
                  </div>
                )}
                {needsPassword && (
                  <div className="space-y-2">
                    <Label htmlFor="join-password">Password</Label>
                    <Input
                      id="join-password"
                      type="password"
                      placeholder="Enter your account password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter the same password you used when creating your account. It&apos;s used to encrypt your financial data.
                    </p>
                  </div>
                )}
                <div className="flex gap-2">
                  {!inviteInfo && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep("choose")}
                    >
                      Back
                    </Button>
                  )}
                  <Button type="submit" className="flex-1" disabled={submitting}>
                    {submitting ? "Setting up encryption..." : inviteInfo ? `Join ${inviteInfo.household_name}` : "Join Household"}
                  </Button>
                </div>
              </CardContent>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

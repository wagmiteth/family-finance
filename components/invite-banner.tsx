"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, UserPlus, Share2 } from "lucide-react";
import { toast } from "sonner";

function getInviteLink(code: string) {
  return `${window.location.origin}/login?invite=${code}`;
}

export function InviteBanner({
  inviteCode,
  inviterName,
  compact = false,
}: {
  inviteCode: string;
  inviterName?: string;
  compact?: boolean;
}) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  function handleCopyCode() {
    navigator.clipboard.writeText(inviteCode);
    setCopiedCode(true);
    toast.success("Invite code copied!");
    setTimeout(() => setCopiedCode(false), 2000);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(getInviteLink(inviteCode));
    setCopiedLink(true);
    toast.success("Invite link copied!");
    setTimeout(() => setCopiedLink(false), 2000);
  }

  function handleShare() {
    handleCopyLink();
  }

  if (compact) {
    return (
      <Card className="border-dashed border-primary/30 bg-primary/5">
        <CardContent className="py-4 px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Invite your partner</p>
              <p className="text-xs text-muted-foreground">
                Share the link so they can join your household
              </p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={handleShare}>
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-dashed border-primary/30 bg-primary/5">
      <CardContent className="py-5 px-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <UserPlus className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Invite your partner</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Share this link with your partner so they can join your household and start tracking expenses together.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button className="w-full gap-2" onClick={handleShare}>
            <Share2 className="h-4 w-4" />
            Share invite link
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-md border bg-background px-3 py-2">
              <span className="text-xs text-muted-foreground">Code:</span>
              <Badge variant="secondary" className="font-mono text-xs px-2 py-0.5 tracking-widest">
                {inviteCode}
              </Badge>
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={handleCopyCode}>
              {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

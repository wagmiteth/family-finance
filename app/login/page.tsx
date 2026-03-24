import type { Metadata } from "next";
import { LoginForm } from "./login-form";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

async function getInviteInfo(code: string) {
  try {
    const res = await fetch(`${APP_URL}/api/invite/${code}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<{
      household_name: string;
      inviter_name: string;
      inviter_avatar_url: string | null;
    }>;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const inviteCode = params?.invite;

  if (!inviteCode) {
    return {
      title: "Family Finance",
      description:
        "Shared household expense tracker with end-to-end encryption",
    };
  }

  const info = await getInviteInfo(inviteCode);

  if (!info) {
    return {
      title: "Join a Household — Family Finance",
      description:
        "You've been invited to share household expenses on Family Finance.",
    };
  }

  const title = `${info.inviter_name} invited you — Family Finance`;
  const description = `${info.inviter_name} invites you to share household expenses in "${info.household_name}". Create an account to get started.`;

  const ogImageParams = new URLSearchParams({
    name: info.inviter_name,
    household: info.household_name,
    ...(info.inviter_avatar_url && { avatar: info.inviter_avatar_url }),
  });

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: `${APP_URL}/api/og/invite?${ogImageParams}`,
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${APP_URL}/api/og/invite?${ogImageParams}`],
    },
  };
}

export default function LoginPage() {
  return <LoginForm />;
}

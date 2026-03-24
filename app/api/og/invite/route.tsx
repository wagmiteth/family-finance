import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const inviterName = searchParams.get("name") || "";
  const inviterAvatarUrl = searchParams.get("avatar") || "";
  const householdName = searchParams.get("household") || "";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #1a2e1a 0%, #2d4a2d 50%, #1a2e1a 100%)",
          color: "white",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {inviterAvatarUrl ? (
          <img
            src={inviterAvatarUrl}
            width={96}
            height={96}
            style={{
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.2)",
              marginBottom: 24,
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 96,
              height: 96,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.1)",
              border: "3px solid rgba(255,255,255,0.2)",
              fontSize: 40,
              marginBottom: 24,
            }}
          >
            {inviterName ? inviterName[0].toUpperCase() : "?"}
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              textAlign: "center",
              lineHeight: 1.2,
            }}
          >
            {inviterName ? `${inviterName} invites you` : "You're invited"}
          </div>
          <div
            style={{
              fontSize: 24,
              opacity: 0.7,
              marginTop: 8,
            }}
          >
            to share household expenses
            {householdName ? ` in "${householdName}"` : ""}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 48,
            opacity: 0.5,
            fontSize: 18,
          }}
        >
          Family Finance
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "./dashboard-shell";
import { EncryptionGate } from "./encryption-gate";
import { DataProvider } from "@/lib/crypto/data-provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/login");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("*")
    .eq("auth_id", authUser.id)
    .single();

  if (!userData?.household_id) {
    redirect("/onboarding");
  }

  const { data: household } = await supabase
    .from("households")
    .select("*")
    .eq("id", userData.household_id)
    .single();

  return (
    <DashboardShell
      user={userData}
      householdEncryptedData={household?.encrypted_data || null}
    >
      <EncryptionGate>
        <DataProvider>
          {children}
        </DataProvider>
      </EncryptionGate>
    </DashboardShell>
  );
}

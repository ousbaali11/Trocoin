import type { Metadata } from "next";
import { RequireAuth } from "@/components/ui/RequireAuth";
import { AccountNav } from "@/components/account/AccountNav";
import { EmailVerificationBanner } from "@/components/account/EmailVerificationBanner";

export const metadata: Metadata = { title: "Mon compte", robots: { index: false, follow: false } };

export default function CompteLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="container page">
        <EmailVerificationBanner />
        <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", gap: 28, alignItems: "start" }} className="account-layout">
          <AccountNav />
          <div style={{ minWidth: 0 }}>{children}</div>
        </div>
        <style>{`@media (max-width: 860px){ .account-layout{ grid-template-columns: 1fr !important; } }`}</style>
      </div>
    </RequireAuth>
  );
}

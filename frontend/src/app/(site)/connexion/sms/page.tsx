import { Suspense } from "react";
import type { Metadata } from "next";
import { OtpLoginForm } from "@/components/auth/OtpLoginForm";

export const metadata: Metadata = { title: "Connexion par code SMS", robots: { index: false } };

/** Ancien parcours OTP, conservé pour les comptes créés par SMS avant la phase 5. */
export default function Page() {
  return (
    <div className="container page" style={{ maxWidth: 520 }}>
      <Suspense>
        <OtpLoginForm />
      </Suspense>
    </div>
  );
}

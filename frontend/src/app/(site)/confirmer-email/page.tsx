import { Suspense } from "react";
import type { Metadata } from "next";
import { ConfirmEmailPanel } from "@/components/auth/ConfirmEmailPanel";

export const metadata: Metadata = { title: "Confirmer mon adresse e-mail", description: "Confirmez l'adresse e-mail de votre compte Trocoin.", robots: { index: false } };

export default function Page() {
  return (
    <div className="container page" style={{ maxWidth: 520 }}>
      <Suspense>
        <ConfirmEmailPanel />
      </Suspense>
    </div>
  );
}

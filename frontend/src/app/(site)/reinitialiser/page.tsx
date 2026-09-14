import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Nouveau mot de passe", robots: { index: false } };

export default function Page() {
  return (
    <div className="container page" style={{ maxWidth: 520 }}>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}

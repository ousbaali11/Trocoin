import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Mot de passe oublié", robots: { index: false } };

export default function Page() {
  return (
    <div className="container page" style={{ maxWidth: 520 }}>
      <ForgotPasswordForm />
    </div>
  );
}

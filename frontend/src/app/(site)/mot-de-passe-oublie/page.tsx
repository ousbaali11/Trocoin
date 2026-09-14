import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Mot de passe oublié", description: "Recevez un lien pour réinitialiser le mot de passe de votre compte Trocoin.", robots: { index: false } };

export default function Page() {
  return (
    <div className="container page" style={{ maxWidth: 520 }}>
      <ForgotPasswordForm />
    </div>
  );
}

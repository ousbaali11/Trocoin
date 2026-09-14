import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Connexion", description: "Connectez-vous à votre compte Trocoin avec votre e-mail ou votre nom d'utilisateur.", robots: { index: false } };

export default function Page() {
  return (
    <div className="container page" style={{ maxWidth: 520 }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}

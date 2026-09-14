import { Suspense } from "react";
import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/RegisterForm";

export const metadata: Metadata = { title: "Créer un compte", description: "Inscription particulier ou professionnel : un compte par numéro de mobile français.", robots: { index: false } };

export default function Page() {
  return (
    <div className="container page" style={{ maxWidth: 640 }}>
      <Suspense>
        <RegisterForm />
      </Suspense>
    </div>
  );
}

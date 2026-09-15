import { redirect } from "next/navigation";

/**
 * Ancien parcours de connexion par code SMS (comptes créés avant l'inscription par formulaire).
 * La vérification par SMS est désactivée pendant la bêta : l'adresse est conservée pour ne pas
 * casser un ancien lien, mais elle renvoie à la connexion classique (le paramètre `next` est gardé).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "";
  redirect(next ? `/connexion?next=${encodeURIComponent(next)}` : "/connexion");
}

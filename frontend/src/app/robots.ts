import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/api";

/**
 * Exploration : tout le public (accueil, recherche et catégories, fiches, aide, pages légales) ;
 * bloqué : back-office, espace compte (messages, paramètres, achats), écrans de session (connexion,
 * inscription, mot de passe, confirmation d'e-mail) et le dépôt d'annonce. Trocoin n'a pas de panier.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/compte", "/connexion", "/deposer", "/mot-de-passe-oublie", "/reinitialiser", "/confirmer-email"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

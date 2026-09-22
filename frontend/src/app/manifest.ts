import type { MetadataRoute } from "next";

/** « Ajouter à l'écran d'accueil » (AUDIT §69) : nom, icône et couleur au lieu d'une icône générique avec barre d'adresse. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trocoin — petites annonces entre voisins",
    short_name: "Trocoin",
    description: "Achetez, vendez, donnez ou échangez près de chez vous, paiement sécurisé et messagerie intégrée.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f7b5f",
    lang: "fr",
    icons: [
      { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}

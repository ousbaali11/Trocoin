"use client";

import { useAuth } from "@/lib/auth-context";

/**
 * Bannière d'une annonce vendue (AUDIT §69) : la fiche est rendue côté serveur en anonyme, `isOwner` y est donc toujours faux
 * et le vendeur lisait le message destiné au public. La variante propriétaire est décidée ici, avec la session du navigateur.
 */
export function SoldBanner({ sellerId }: { sellerId: string }) {
  const { user } = useAuth();
  const owner = !!user && user.id === sellerId;
  return (
    <div className="alert alert-success" data-testid="sold-banner" data-owner={owner ? "true" : "false"}>
      {owner
        ? "Vendu : votre article a été acheté. L'annonce n'apparaît plus dans les résultats ; elle sera retirée automatiquement quand l'acheteur aura reçu l'article. Si la vente est annulée, vous pourrez la remettre en ligne depuis Mes annonces."
        : "Vendu : cet article a trouvé preneur et n'est plus disponible à l'achat. Découvrez des annonces similaires ci-dessous."}
    </div>
  );
}

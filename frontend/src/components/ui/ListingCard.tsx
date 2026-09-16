"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { mediaUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CONDITION_LABELS, formatPrice, LISTING_STATUS_LABELS, postedAt } from "@/lib/format";
import type { ListingCard as ListingCardType } from "@/lib/types";
import { useViewedIds } from "@/lib/viewed";
import { FavoriteButton } from "./FavoriteButton";
import { QuickPreview } from "./QuickPreview";
import styles from "./ListingCard.module.css";

const LONG_PRESS_MS = 500;

/**
 * Carte d'annonce « fiche » Trocoin (docs/design-system.md §5) : photo carrée encadrée, étiquettes
 * en haut à gauche (« À la une », « Urgent », « Déjà vu »), cœur à cheval sur le bas droit du cadre,
 * puis titre sur deux lignes, **prix sous la photo** dans le bloc de texte (plus d'incrustation sur
 * l'image depuis le 16 septembre 2026), ligne Pro / état / note du vendeur, et « lieu · date » en pied.
 * Clic long à la souris (500 ms) : aperçu rapide sans quitter la liste.
 */
export function ListingCard({ listing, showStatus = false }: { listing: ListingCardType; showStatus?: boolean }) {
  // Image introuvable (photo supprimée du stockage, lien périmé) : on revient au visuel « Pas de photo »
  const [broken, setBroken] = useState(false);
  const [preview, setPreview] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const { user } = useAuth();
  const viewed = useViewedIds(user?.id ?? null);
  const seen = viewed.has(listing.id) && listing.userId !== user?.id;
  const cover = broken ? undefined : mediaUrl(listing.coverUrl);
  const isPro = listing.seller?.accountType === "professionnel";
  const negotiable = listing.priceType === "negociable";
  const priceLabel = formatPrice(listing.price, negotiable ? "fixe" : listing.priceType);
  const place = [listing.city || "France", listing.postalCode].filter(Boolean).join(" ");
  // Note du vendeur (visible sans connexion, comme le reste de la carte) dès qu'il a reçu un avis
  const rating = listing.seller && listing.seller.ratingCount && listing.seller.ratingCount > 0 ? listing.seller : null;
  const hasMeta = isPro || !!listing.condition || !!listing.isComplete || !!rating;

  const pressStart = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setPreview(true);
    }, LONG_PRESS_MS);
  };
  const pressEnd = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const onClick = (e: React.MouseEvent) => {
    if (longPressed.current) {
      e.preventDefault();
      longPressed.current = false;
    }
  };

  return (
    <article className={`card card-hover ${styles.card} ${listing.isBoosted ? styles.boosted : ""}`} data-testid="listing-card" data-seen={seen ? "true" : undefined}>
      <div className={styles.frame}>
      <Link href={`/annonces/${listing.id}`} className={styles.media} aria-label={listing.title} onPointerDown={pressStart} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd} onClick={onClick}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={listing.title} loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : (
          <div className={styles.placeholder} aria-hidden="true">
            <CameraIcon size={28} />
            <span>Pas de photo</span>
          </div>
        )}
        {(listing.isUrgent || listing.isBoosted || seen) && (
          <div className={styles.tags}>
            {listing.isBoosted && <span className={`${styles.tag} ${styles.tagBoosted}`}>À la une</span>}
            {listing.isUrgent && <span className={`${styles.tag} ${styles.tagUrgent}`}>Urgent</span>}
            {seen && <span className={`${styles.tag} ${styles.tagSeen}`} data-testid="card-seen" title="Vous avez déjà consulté cette annonce">Déjà vu</span>}
          </div>
        )}
        {listing.photosCount > 1 && (
          <span className={styles.count}>
            <CameraIcon size={12} />
            {listing.photosCount}
            <span className="sr-only"> photos</span>
          </span>
        )}
      </Link>
      <div className={styles.fav}>
        <FavoriteButton listingId={listing.id} compact />
      </div>
      </div>
      <div className={styles.body}>
        <Link href={`/annonces/${listing.id}`} className={styles.title} onPointerDown={pressStart} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd} onClick={onClick}>
          {listing.title}
        </Link>
        <div className={styles.price} data-testid="card-price">
          {priceLabel}
          {negotiable && <span className={styles.negotiable}>à débattre</span>}
        </div>
        {hasMeta && (
          <div className={styles.meta}>
            {isPro && <span className={styles.pro}>Pro</span>}
            {rating && (
              <span className={styles.rating} title={`${rating.ratingCount} avis`} aria-label={`Vendeur noté ${(rating.ratingAvg ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} sur 5, ${rating.ratingCount} avis`}>
                ★ {(rating.ratingAvg ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ({rating.ratingCount})
              </span>
            )}
            {listing.condition && <span>{CONDITION_LABELS[listing.condition]}</span>}
            {listing.isComplete && (
              <span className={styles.complete} title="Photos, description et tous les critères renseignés">
                <CheckIcon />
                Fiche complète
              </span>
            )}
          </div>
        )}
        <div className={styles.foot}>
          <span className={styles.where}>
            <span className={styles.place}>
              {place}
              {listing.distanceKm !== undefined && ` · ${listing.distanceKm} km`}
            </span>
            <span className={styles.dot} aria-hidden="true">·</span>
            <span className={styles.date} suppressHydrationWarning>
              {postedAt(listing.publishedAt || listing.createdAt)}
            </span>
          </span>
          {listing.deliveryAvailable && (
            <span className={styles.delivery} title="Livraison possible">
              <ParcelIcon />
              <span className="sr-only">Livraison possible</span>
              <span aria-hidden="true">Livraison</span>
            </span>
          )}
        </div>
        {showStatus && <span className={`${LISTING_STATUS_LABELS[listing.status].pill} ${styles.status}`}>{LISTING_STATUS_LABELS[listing.status].label}</span>}
      </div>
      {preview && <QuickPreview listingId={listing.id} onClose={() => setPreview(false)} />}
    </article>
  );
}

function CameraIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function ParcelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

"use client";

import Link from "next/link";
import { mediaUrl } from "@/lib/api";
import { CONDITION_LABELS, formatPrice, LISTING_STATUS_LABELS, timeAgo } from "@/lib/format";
import type { ListingCard as ListingCardType } from "@/lib/types";
import { FavoriteButton } from "./FavoriteButton";
import styles from "./ListingCard.module.css";

export function ListingCard({ listing, showStatus = false }: { listing: ListingCardType; showStatus?: boolean }) {
  const cover = mediaUrl(listing.coverUrl);
  const isPro = listing.seller?.accountType === "professionnel";
  return (
    <article className={`card card-hover ${styles.card} ${listing.isBoosted ? styles.boosted : ""}`}>
      <Link href={`/annonces/${listing.id}`} className={styles.media} aria-label={listing.title}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" loading="lazy" />
        ) : (
          <div className={styles.placeholder} aria-hidden="true">
            <CameraIcon />
            <span>Pas de photo</span>
          </div>
        )}
        {listing.photosCount > 1 && <span className={styles.count}>{listing.photosCount} photos</span>}
        <div className={styles.tags}>
          {listing.isUrgent && <span className="pill pill-brick">Urgent</span>}
          {listing.isBoosted && <span className="pill pill-ochre">À la une</span>}
          {isPro && <span className="pill pill-dark">Pro</span>}
          {listing.isComplete && <span className="pill pill-green" title="Photos, description et tous les critères renseignés">Fiche complète</span>}
        </div>
      </Link>
      <div className={styles.fav}>
        <FavoriteButton listingId={listing.id} compact />
      </div>
      <div className={styles.body}>
        <Link href={`/annonces/${listing.id}`} className={styles.title}>
          {listing.title}
        </Link>
        <div className={styles.price}>{formatPrice(listing.price, listing.priceType)}</div>
        <div className={styles.meta}>
          {listing.condition && <span>{CONDITION_LABELS[listing.condition]}</span>}
          {listing.deliveryAvailable && <span className={styles.delivery}>Livraison possible</span>}
        </div>
        <div className={styles.foot}>
          <span>
            {listing.city || "France"}
            {listing.distanceKm !== undefined && ` · ${listing.distanceKm} km`}
          </span>
          <span>{timeAgo(listing.publishedAt || listing.createdAt)}</span>
        </div>
        {showStatus && <span className={`${LISTING_STATUS_LABELS[listing.status].pill} ${styles.status}`}>{LISTING_STATUS_LABELS[listing.status].label}</span>}
      </div>
    </article>
  );
}

function CameraIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

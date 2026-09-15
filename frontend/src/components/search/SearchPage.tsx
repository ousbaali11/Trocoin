"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { CONDITION_LABELS } from "@/lib/format";
import { fieldOptions, type CategoryNode, type FieldSchema, type SearchResult } from "@/lib/types";
import { LocationPicker, type LocationValue } from "@/components/ui/LocationPicker";
import { ListingsMapDynamic } from "@/components/ui/DynamicMap";
import { ListingCard } from "@/components/ui/ListingCard";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { DiscoverSections, type DiscoverData } from "./DiscoverSections";
import styles from "./SearchPage.module.css";

/** Tri : ordre et libellés du panneau « Tous les filtres » (choix unique). */
const SORTS = [
  { value: "relevance", label: "Pertinence" },
  { value: "recent", label: "Plus récentes" },
  { value: "oldest", label: "Plus anciennes" },
  { value: "price_asc", label: "Prix croissants" },
  { value: "price_desc", label: "Prix décroissants" },
  { value: "distance", label: "Distance" },
];

/** Paramètres comptés dans « Filtres (n) » et effacés par « Tout effacer » (le mot-clé reste). */
const FILTER_KEYS = ["category", "price_min", "price_max", "condition", "delivery", "delivery_anywhere", "seller_type", "with_photo", "urgent", "since_days", "lat", "lng", "radius", "city", "city_label", "postal_code", "price_type", "sort"];

interface Facets {
  total: number;
  particulier: number;
  professionnel: number;
}

export function SearchPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { requireAuth } = useAuth();
  const { toast } = useToast();

  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [schema, setSchema] = useState<FieldSchema[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [discover, setDiscover] = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const get = useCallback((k: string) => params.get(k) || "", [params]);
  const category = get("category");
  const lat = get("lat");
  const lng = get("lng");
  const radius = get("radius") || "5";
  const page = Number(get("page") || 1);

  const setParams = useCallback(
    (patch: Record<string, string | undefined>, resetPage = true) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "") p.delete(k);
        else p.set(k, v);
      }
      if (resetPage) p.delete("page");
      router.push(`${pathname}?${p.toString()}`);
    },
    [params, pathname, router],
  );

  // Sur mobile (≤ 900 px) le panneau devient un volet qui glisse depuis la droite
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!filtersOpen || !isMobile) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFiltersOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen, isMobile]);

  useEffect(() => {
    api<CategoryNode[]>("/categories/tree").then(setTree).catch(() => setTree([]));
  }, []);

  useEffect(() => {
    if (!category) {
      setSchema([]);
      setDiscover(null);
      return;
    }
    api<{ fields: FieldSchema[] }>(`/categories/${category}/schema`)
      .then((s) => setSchema(s.fields.filter((f) => f.filterable)))
      .catch(() => setSchema([]));
    api<DiscoverData>(`/listings/discover?category=${encodeURIComponent(category)}`)
      .then(setDiscover)
      .catch(() => setDiscover(null));
  }, [category]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const p = new URLSearchParams(params.toString());
    p.delete("city_label");
    if (!p.get("page_size")) p.set("page_size", "24");
    api<SearchResult>(`/listings?${p.toString()}`, { signal: ctrl.signal })
      .then(setResult)
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError((e as Error).message);
      })
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    // Compteurs par type de vendeur (mêmes critères, sans le filtre vendeur ni la page)
    const f = new URLSearchParams(params.toString());
    f.delete("city_label");
    f.delete("seller_type");
    f.delete("page");
    api<Facets>(`/listings/facets?${f.toString()}`, { signal: ctrl.signal }).then(setFacets).catch(() => undefined);
    return () => ctrl.abort();
  }, [params]);

  const currentCategory = useMemo(() => {
    for (const root of tree) {
      if (root.slug === category) return { root, child: null };
      const child = root.children.find((c) => c.slug === category);
      if (child) return { root, child };
    }
    return null;
  }, [tree, category]);

  // Localisation (modèle leboncoin) : « Toute la France » | « Autour de moi » | commune + rayon (0 km = la commune seule)
  const locValue: LocationValue = useMemo(() => {
    if (lat && lng && get("city_label") === "Autour de moi") return { mode: "around", latitude: Number(lat), longitude: Number(lng), radius: Number(radius) };
    if (lat && lng) return { mode: "city", city: get("city_label") || "Commune choisie", latitude: Number(lat), longitude: Number(lng), radius: Number(radius) };
    if (get("city") || get("postal_code")) return { mode: "city", city: get("city") || get("postal_code"), postalCode: get("postal_code") || undefined, radius: 0 };
    return { mode: "all" };
  }, [get, lat, lng, radius]);
  const hasPlace = locValue.mode !== "all";
  const placeLabel = get("city_label") || get("city") || get("postal_code");

  const onLocation = (v: LocationValue) => {
    if (v.mode === "all") {
      setParams({ lat: undefined, lng: undefined, radius: undefined, city_label: undefined, city: undefined, postal_code: undefined, delivery_anywhere: undefined });
    } else if (v.mode === "around") {
      setParams({ lat: String(v.latitude), lng: String(v.longitude), radius: String(v.radius), city_label: "Autour de moi", city: undefined, postal_code: undefined, sort: "distance" });
    } else if (v.radius > 0 && v.latitude !== undefined && v.longitude !== undefined) {
      setParams({ lat: String(v.latitude), lng: String(v.longitude), radius: String(v.radius), city_label: v.city, city: undefined, postal_code: undefined });
    } else {
      setParams({ city: v.city, postal_code: v.postalCode, lat: undefined, lng: undefined, radius: undefined, city_label: undefined });
    }
  };

  const conditions = get("condition") ? get("condition").split(",") : [];
  const toggleCondition = (c: string) => {
    const next = conditions.includes(c) ? conditions.filter((x) => x !== c) : [...conditions, c];
    setParams({ condition: next.join(",") || undefined });
  };

  const activeCount = FILTER_KEYS.filter((k) => !["lng", "radius", "city_label", "sort"].includes(k) && get(k)).length + [...params.keys()].filter((k) => k.startsWith("attr.") && get(k)).length;
  const clearAll = () => {
    const p = new URLSearchParams();
    if (get("q")) p.set("q", get("q"));
    router.push(`${pathname}${p.toString() ? `?${p.toString()}` : ""}`);
  };

  /** Type de vendeurs : deux cases ; les deux cochées (ou aucune) = pas de filtre. */
  const sellerType = get("seller_type");
  const toggleSeller = (type: "particulier" | "professionnel") => {
    if (!sellerType) return setParams({ seller_type: type === "particulier" ? "professionnel" : "particulier" }); // décocher l'un = garder l'autre
    if (sellerType === type) return setParams({ seller_type: undefined }); // recocher = les deux
    setParams({ seller_type: undefined });
  };
  const sellerChecked = (type: "particulier" | "professionnel") => !sellerType || sellerType === type;

  const saveSearch = async () => {
    if (!requireAuth()) return;
    const query: Record<string, unknown> = {};
    if (get("q")) query.q = get("q");
    if (category) query.category = category;
    if (get("postal_code")) query.postal_code = get("postal_code");
    if (get("price_min")) query.price_min = Number(get("price_min"));
    if (get("price_max")) query.price_max = Number(get("price_max"));
    if (conditions.length) query.condition = conditions;
    if (get("delivery") === "true") query.delivery = true;
    if (get("seller_type")) query.seller_type = get("seller_type");
    if (lat && lng) {
      query.lat = Number(lat);
      query.lng = Number(lng);
      query.radius = Number(radius);
    }
    try {
      await api("/users/me/saved-searches", { method: "POST", body: { name: saveName || defaultSaveName(), query } });
      toast("Recherche sauvegardée : vous serez alerté des nouvelles annonces.", "success");
      setSaveOpen(false);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const defaultSaveName = () => [get("q"), currentCategory?.child?.name || currentCategory?.root.name, get("city_label") || get("postal_code")].filter(Boolean).join(" · ") || "Ma recherche";

  const title = get("q")
    ? `« ${get("q")} »`
    : currentCategory?.child?.name || currentCategory?.root.name || "Toutes les annonces";
  const total = result?.total ?? 0;
  const currentSort = get("sort") || (lat ? "distance" : "recent");

  /** Contenu du panneau « Tous les filtres » : même ordre sur bureau (colonne) et mobile (volet). */
  const panel = (
    <>
      <div className="field">
        <label htmlFor="f-cat">Catégories</label>
        <select id="f-cat" className="select" value={category} onChange={(e) => setParams({ category: e.target.value || undefined })}>
          <option value="">Toutes les catégories</option>
          {tree.map((root) => (
            <optgroup key={root.slug} label={root.name}>
              <option value={root.slug}>Tout {root.name}</option>
              {root.children.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {currentCategory && (
          <span className="hint">
            Catégorie active : {currentCategory.child ? `${currentCategory.root.name} › ${currentCategory.child.name}` : currentCategory.root.name}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="f-city">Localisation</label>
        <LocationPicker id="f-city" value={locValue} onChange={onLocation} />
      </div>

      <div className="field">
        <span className="label">Étendre à la livraison</span>
        <label className="checkbox">
          <input type="checkbox" checked={get("delivery_anywhere") === "true"} onChange={(e) => setParams({ delivery_anywhere: e.target.checked ? "true" : undefined })} />
          Ajouter les annonces livrables partout en France
        </label>
        <span className="hint">{hasPlace ? `En plus des annonces autour de ${placeLabel}.` : "Utile quand une localisation est choisie : les annonces livrables s'ajoutent aux annonces proches."}</span>
      </div>

      <div className="field">
        <span className="label">Prix</span>
        <div className="form-row">
          <input className="input" type="number" min={0} placeholder="Minimum" defaultValue={get("price_min")} key={"min" + get("price_min")} onBlur={(e) => setParams({ price_min: e.target.value || undefined })} aria-label="Prix minimum" />
          <input className="input" type="number" min={0} placeholder="Maximum" defaultValue={get("price_max")} key={"max" + get("price_max")} onBlur={(e) => setParams({ price_max: e.target.value || undefined })} aria-label="Prix maximum" />
        </div>
        <label className="checkbox" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={get("price_type") === "gratuit"} onChange={(e) => setParams({ price_type: e.target.checked ? "gratuit" : undefined })} />
          Dons uniquement
        </label>
      </div>

      <fieldset className={styles.group}>
        <legend className="label">Tri</legend>
        {SORTS.filter((s) => s.value !== "distance" || (lat && lng)).map((s) => (
          <label key={s.value} className="checkbox">
            <input type="radio" name="tri" value={s.value} checked={currentSort === s.value} onChange={() => setParams({ sort: s.value }, false)} />
            {s.label}
          </label>
        ))}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="label">Type de vendeurs</legend>
        <label className="checkbox">
          <input type="checkbox" checked={sellerChecked("particulier")} onChange={() => toggleSeller("particulier")} />
          Particuliers {facets && <span className="muted">({facets.particulier})</span>}
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={sellerChecked("professionnel")} onChange={() => toggleSeller("professionnel")} />
          Professionnels {facets && <span className="muted">({facets.professionnel})</span>}
        </label>
      </fieldset>

      <div className="field">
        <span className="label">Annonces urgentes</span>
        <label className="checkbox"><input type="checkbox" checked={get("urgent") === "true"} onChange={(e) => setParams({ urgent: e.target.checked ? "true" : undefined })} /> Annonces urgentes uniquement</label>
      </div>

      <hr className="divider" />

      <div className="field">
        <span className="label">Options</span>
        <label className="checkbox"><input type="checkbox" checked={get("delivery") === "true"} onChange={(e) => setParams({ delivery: e.target.checked ? "true" : undefined, ...(e.target.checked ? {} : { delivery_anywhere: undefined }) })} /> Livraison possible</label>
        <label className="checkbox"><input type="checkbox" checked={get("with_photo") === "true"} onChange={(e) => setParams({ with_photo: e.target.checked ? "true" : undefined })} /> Avec photo uniquement</label>
      </div>

      <div className="field">
        <label htmlFor="f-price-type">Type d&apos;annonce</label>
        <select id="f-price-type" className="select" value={get("price_type")} onChange={(e) => setParams({ price_type: e.target.value || undefined })}>
          <option value="">Toutes</option>
          <option value="gratuit">Dons (gratuit)</option>
          <option value="echange">Échanges</option>
          <option value="fixe">Prix fixe</option>
          <option value="negociable">Prix négociable</option>
          <option value="sur_demande">Prix sur demande</option>
        </select>
      </div>

      <div className="field">
        <span className="label">État</span>
        {Object.entries(CONDITION_LABELS).map(([k, label]) => (
          <label key={k} className="checkbox">
            <input type="checkbox" checked={conditions.includes(k)} onChange={() => toggleCondition(k)} /> {label}
          </label>
        ))}
      </div>

      <div className="field">
        <label htmlFor="f-since">Publiée depuis</label>
        <select id="f-since" className="select" value={get("since_days")} onChange={(e) => setParams({ since_days: e.target.value || undefined })}>
          <option value="">Toujours</option>
          <option value="1">24 heures</option>
          <option value="7">7 jours</option>
          <option value="30">30 jours</option>
        </select>
      </div>

      {schema.length > 0 && (
        <>
          <hr className="divider" />
          <strong style={{ display: "block", marginBottom: 10 }}>Caractéristiques {currentCategory?.child?.name || currentCategory?.root.name}</strong>
          {schema.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`attr-${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ""}</label>
              {f.type === "select" ? (
                <select
                  id={`attr-${f.key}`}
                  className="select"
                  value={get(`attr.${f.key}`)}
                  disabled={!!f.dependsOn && !get(`attr.${f.dependsOn}`)}
                  onChange={(e) => {
                    // Liste dépendante : changer la marque efface le modèle choisi
                    const patch: Record<string, string | undefined> = { [`attr.${f.key}`]: e.target.value || undefined };
                    for (const child of schema) if (child.dependsOn === f.key) patch[`attr.${child.key}`] = undefined;
                    setParams(patch);
                  }}
                >
                  <option value="">{f.dependsOn && !get(`attr.${f.dependsOn}`) ? `Choisir d'abord : ${schema.find((s) => s.key === f.dependsOn)?.label.toLowerCase() ?? f.dependsOn}` : "Indifférent"}</option>
                  {fieldOptions(f, Object.fromEntries(schema.map((s) => [s.key, get(`attr.${s.key}`)]))).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.type === "number" ? (
                <div className="form-row">
                  <input className="input" type="number" placeholder="Min" defaultValue={get(`attr.${f.key}_min`)} key={`${f.key}min${get(`attr.${f.key}_min`)}`} onBlur={(e) => setParams({ [`attr.${f.key}_min`]: e.target.value || undefined })} aria-label={`${f.label} minimum`} />
                  <input className="input" type="number" placeholder="Max" defaultValue={get(`attr.${f.key}_max`)} key={`${f.key}max${get(`attr.${f.key}_max`)}`} onBlur={(e) => setParams({ [`attr.${f.key}_max`]: e.target.value || undefined })} aria-label={`${f.label} maximum`} />
                </div>
              ) : f.type === "boolean" ? (
                <select id={`attr-${f.key}`} className="select" value={get(`attr.${f.key}`)} onChange={(e) => setParams({ [`attr.${f.key}`]: e.target.value || undefined })}>
                  <option value="">Indifférent</option>
                  <option value="true">Oui</option>
                  <option value="false">Non</option>
                </select>
              ) : (
                <input id={`attr-${f.key}`} className="input" defaultValue={get(`attr.${f.key}`)} key={f.key + get(`attr.${f.key}`)} onBlur={(e) => setParams({ [`attr.${f.key}`]: e.target.value || undefined })} />
              )}
            </div>
          ))}
        </>
      )}
    </>
  );

  /** Barre fixe en bas du panneau : « Tout effacer » et « Rechercher (N) » (N suit les filtres en direct). */
  const panelFooter = (
    <div className={styles.panelFooter}>
      <button type="button" className="btn btn-ghost" onClick={clearAll} disabled={activeCount === 0}>Tout effacer</button>
      <button type="button" className="btn btn-primary" onClick={() => setFiltersOpen(false)} aria-live="polite">
        {loading ? "Rechercher…" : `Rechercher (${total})`}
      </button>
    </div>
  );

  return (
    <div className="container page" style={{ minHeight: "calc(100vh - var(--header-h))" }}>
      <nav className="small muted" aria-label="Fil d'Ariane" style={{ marginBottom: 8 }}>
        <Link href="/">Accueil</Link> › <Link href="/recherche">Annonces</Link>
        {currentCategory && (
          <>
            {" › "}
            <Link href={`/recherche?category=${currentCategory.root.slug}`}>{currentCategory.root.name}</Link>
            {currentCategory.child && <> › {currentCategory.child.name}</>}
          </>
        )}
      </nav>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="muted" style={{ margin: 0, minHeight: "1.55em" }} aria-live="polite" aria-atomic="true">
            {loading ? "Recherche…" : `${total} annonce${total > 1 ? "s" : ""}`}
            {get("city_label") && ` · ${get("city_label")} (${radius} km)`}
            {!get("city_label") && (get("city") || get("postal_code")) && ` · ${get("city") || get("postal_code")}`}
            {!get("city_label") && !get("city") && !get("postal_code") && " · Toute la France"}
            {get("delivery_anywhere") === "true" && hasPlace && " + livraison partout en France"}
          </p>
          <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }} aria-label="Filtres rapides">
            <button type="button" className={`btn btn-sm ${get("price_type") === "gratuit" ? "btn-primary" : "btn-outline"}`} aria-pressed={get("price_type") === "gratuit"} onClick={() => setParams({ price_type: get("price_type") === "gratuit" ? undefined : "gratuit" })}>🎁 Dons uniquement</button>
            <button type="button" className={`btn btn-sm ${get("price_type") === "echange" ? "btn-primary" : "btn-outline"}`} aria-pressed={get("price_type") === "echange"} onClick={() => setParams({ price_type: get("price_type") === "echange" ? undefined : "echange" })}>🔁 Échanges uniquement</button>
          </div>
        </div>
        <div className="row">
          <button className="btn btn-outline btn-sm" onClick={() => { setSaveName(defaultSaveName()); setSaveOpen(true); }}>
            🔔 Sauvegarder cette recherche
          </button>
          <div className={styles.viewToggle} role="tablist">
            <button role="tab" aria-selected={view === "list"} className={view === "list" ? styles.active : ""} onClick={() => setView("list")}>Liste</button>
            <button role="tab" aria-selected={view === "map"} className={view === "map" ? styles.active : ""} onClick={() => setView("map")}>Carte</button>
          </div>
          <button className={`btn btn-outline btn-sm ${styles.filtersBtn}`} onClick={() => setFiltersOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={filtersOpen}>
            Filtres {activeCount > 0 && `(${activeCount})`}
          </button>
        </div>
      </div>

      {get("delivery") === "true" && (
        <div className={`alert alert-info ${styles.deliveryBanner}`} role="status" data-testid="delivery-banner">
          <span className={styles.deliveryText}>
            <strong>Livraison :</strong> les annonces ci-dessous peuvent vous être envoyées par le vendeur, sans vous déplacer.
          </span>
          <span className={styles.deliveryTools}>
            <button type="button" className="pill" onClick={() => setParams({ delivery: undefined, delivery_anywhere: undefined })} aria-label="Retirer le filtre Livraison acceptée" style={{ cursor: "pointer", border: 0 }}>
              Livraison acceptée ✕
            </button>
            {hasPlace && (
              <span className={styles.scope} role="group" aria-label="Périmètre de la livraison">
                <button type="button" className={`btn btn-sm ${get("delivery_anywhere") === "true" ? "btn-outline" : "btn-primary"}`} aria-pressed={get("delivery_anywhere") !== "true"} onClick={() => setParams({ delivery_anywhere: undefined })}>Autour de {placeLabel}</button>
                <button type="button" className={`btn btn-sm ${get("delivery_anywhere") === "true" ? "btn-primary" : "btn-outline"}`} aria-pressed={get("delivery_anywhere") === "true"} onClick={() => setParams({ delivery_anywhere: "true" })}>France</button>
              </span>
            )}
          </span>
        </div>
      )}

      <div className={styles.layout}>
        {!isMobile && (
          <aside className={styles.filters} aria-label="Tous les filtres">
            <div className="row spread" style={{ marginBottom: 12 }}>
              <strong>Tous les filtres</strong>
            </div>
            {panel}
            {panelFooter}
          </aside>
        )}

        {isMobile && filtersOpen && (
          <div className={styles.drawerOverlay} onClick={() => setFiltersOpen(false)} role="presentation">
            <div className={styles.drawer} role="dialog" aria-modal="true" aria-label="Tous les filtres" onClick={(e) => e.stopPropagation()}>
              <div className={styles.drawerHead}>
                <strong>Tous les filtres</strong>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFiltersOpen(false)} aria-label="Fermer les filtres">✕</button>
              </div>
              <div className={styles.drawerBody}>{panel}</div>
              {panelFooter}
            </div>
          </div>
        )}

        <section className={styles.results} aria-label="Résultats">
          <div className="row spread" style={{ marginBottom: 14 }}>
            <label className="row small">
              Trier par
              <select className="select" style={{ width: "auto", padding: "7px 34px 7px 10px" }} value={currentSort} onChange={(e) => setParams({ sort: e.target.value })} aria-label="Tri">
                {SORTS.filter((s) => s.value !== "distance" || (lat && lng)).map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            {currentCategory?.root && !currentCategory.child && (
              <div className={styles.chips}>
                {currentCategory.root.children.map((c) => (
                  <button key={c.slug} className="pill" onClick={() => setParams({ category: c.slug })} style={{ cursor: "pointer", border: 0 }}>{c.name}</button>
                ))}
              </div>
            )}
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          {view === "map" ? (
            <ListingsMapDynamic listings={result?.items ?? []} center={lat && lng ? [Number(lat), Number(lng)] : undefined} radiusKm={lat && lng ? Number(radius) : undefined} />
          ) : loading && !result ? (
            <div className="grid-cards" aria-hidden="true">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ aspectRatio: "3 / 5" }} />)}</div>
          ) : result && result.items.length === 0 ? (
            <div className="panel" style={{ textAlign: "center" }}>
              <h2 className="h3">Aucune annonce ne correspond</h2>
              <p className="muted">Élargissez le rayon, retirez un filtre, ou sauvegardez cette recherche pour être prévenu.</p>
              <button className="btn btn-primary" onClick={() => { setSaveName(defaultSaveName()); setSaveOpen(true); }}>Créer une alerte</button>
            </div>
          ) : (
            <div className="grid-cards" style={{ opacity: loading ? 0.6 : 1 }}>
              {result?.items.map((l) => <ListingCard key={l.id} listing={l} />)}
            </div>
          )}

          {result && view === "list" && (
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} onChange={(p) => { setParams({ page: String(p) }, false); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          )}
        </section>
      </div>

      {discover && category && <DiscoverSections data={discover} categorySlug={category} />}

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Sauvegarder cette recherche">
        <p className="muted small">Vous recevrez une notification dès qu&apos;une nouvelle annonce correspond à ces critères (vérification toutes les 5 minutes).</p>
        <div className="field">
          <label htmlFor="save-name">Nom de l&apos;alerte</label>
          <input id="save-name" className="input" value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={80} />
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={() => setSaveOpen(false)}>Annuler</button>
          <button className="btn btn-primary" onClick={saveSearch}>Créer l&apos;alerte</button>
        </div>
      </Modal>
    </div>
  );
}

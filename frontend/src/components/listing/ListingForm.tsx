"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, mediaUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { CONDITION_LABELS, formatPrice, PRICE_TYPE_LABELS } from "@/lib/format";
import { fieldOptions, type CategoryNode, type Condition, type FieldSchema, type ListingDetail, type ListingPhoto, type ManagedShop, type PriceType } from "@/lib/types";
import { CityInput, type CityValue } from "@/components/ui/CityInput";
import { PhotoCropper } from "./PhotoCropper";
import { PriceEstimate } from "./PriceEstimate";
import { CompletenessHint } from "./CompletenessHint";
import { AutoTextarea } from "@/components/ui/AutoTextarea";
import { titleExample } from "@/lib/title-examples";

const NO_DELIVERY_ROOTS = ["immobilier", "vehicules", "emploi", "services", "vacances", "animaux"];
const NO_CONDITION_ROOTS = ["emploi", "services", "immobilier", "vacances"];
const MAX_PHOTOS = 10;

interface FormState {
  categorySlug: string;
  title: string;
  description: string;
  priceType: PriceType;
  price: string;
  condition: Condition | "";
  attributes: Record<string, string | number | boolean>;
  location: CityValue;
  deliveryAvailable: boolean;
  /** Colis pour l'envoi (facultatif) : grammes et centimètres, en chaînes de saisie */
  weightGrams: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  onBehalfOf: string;
}

const STEPS = ["Titre et catégorie", "Description", "Photos", "Localisation", "Aperçu"];

export function ListingForm({ existing }: { existing?: ListingDetail }) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [shops, setShops] = useState<ManagedShop[]>([]);
  const [schema, setSchema] = useState<FieldSchema[]>([]);
  const [step, setStep] = useState(0);
  // Changement d'étape : on remonte à la barre de progression pour que le nouvel écran commence en haut
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listingId, setListingId] = useState<string | null>(existing?.id ?? null);
  const [photos, setPhotos] = useState<ListingPhoto[]>(existing?.photos ?? []);
  const [pending, setPending] = useState<File[]>([]);
  const [cropping, setCropping] = useState<{ file: File; index: number } | null>(null);
  const [dragIndex, setDragIndex] = useState<{ list: "photos" | "pending"; index: number } | null>(null);
  const [form, setForm] = useState<FormState>({
    categorySlug: existing?.category?.slug ?? "",
    title: existing?.title ?? "",
    description: existing?.description ?? "",
    priceType: existing?.priceType ?? "fixe",
    price: existing?.price !== null && existing?.price !== undefined ? String(existing.price) : "",
    condition: existing?.condition ?? "",
    attributes: (existing?.attributes as Record<string, string | number | boolean>) ?? {},
    location: { city: existing?.city ?? undefined, postalCode: existing?.postalCode ?? undefined, latitude: existing?.latitude ?? undefined, longitude: existing?.longitude ?? undefined },
    deliveryAvailable: existing?.deliveryAvailable ?? false,
    weightGrams: existing?.weightGrams ? String(existing.weightGrams) : "",
    lengthCm: existing?.lengthCm ? String(existing.lengthCm) : "",
    widthCm: existing?.widthCm ? String(existing.widthCm) : "",
    heightCm: existing?.heightCm ? String(existing.heightCm) : "",
    onBehalfOf: "",
  });

  useEffect(() => {
    api<CategoryNode[]>("/categories/tree").then(setTree).catch(() => setTree([]));
    api<ManagedShop[]>("/users/me/shops").then(setShops).catch(() => setShops([]));
  }, []);

  useEffect(() => {
    if (!form.categorySlug) return setSchema([]);
    api<{ fields: FieldSchema[] }>(`/categories/${form.categorySlug}/schema`).then((s) => setSchema(s.fields)).catch(() => setSchema([]));
  }, [form.categorySlug]);

  // Catégorie suggérée d'après les mots du titre (300 ms après la dernière frappe)
  const [catSuggestions, setCatSuggestions] = useState<Array<{ slug: string; name: string; rootName?: string }>>([]);
  useEffect(() => {
    const q = form.title.trim();
    if (q.length < 3) {
      setCatSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<{ suggestions: Array<{ slug: string; name: string; rootName?: string }> }>(`/categories/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, token: null })
        .then((r) => !ctrl.signal.aborted && setCatSuggestions(r.suggestions))
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [form.title]);

  /** Actions de la checklist « Fiche complète » : aller directement au champ concerné. */
  const completenessAction = (action: "photos" | "description" | "prix" | "criteres") => {
    if (action === "photos") {
      (document.querySelector('input[aria-label="Choisir des photos"]') as HTMLInputElement | null)?.click();
      return;
    }
    setStep(1);
    const id = action === "description" ? "description" : action === "prix" ? "price" : `a-${schema.find((f) => f.type !== "boolean" && (form.attributes[f.key] === undefined || form.attributes[f.key] === ""))?.key ?? ""}`;
    window.setTimeout(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      (el as HTMLElement | null)?.focus?.();
    }, 80);
  };

  const root = useMemo(() => tree.find((r) => r.slug === form.categorySlug || r.children.some((c) => c.slug === form.categorySlug)), [tree, form.categorySlug]);
  const categoryName = useMemo(() => {
    for (const r of tree) {
      if (r.slug === form.categorySlug) return r.name;
      const c = r.children.find((x) => x.slug === form.categorySlug);
      if (c) return `${r.name} › ${c.name}`;
    }
    return "";
  }, [tree, form.categorySlug]);
  const deliveryAllowed = root ? !NO_DELIVERY_ROOTS.includes(root.slug) : true;
  const showCondition = root ? !NO_CONDITION_ROOTS.includes(root.slug) : true;
  const needsPrice = form.priceType === "fixe" || form.priceType === "negociable";

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setAttr = (k: string, v: string | number | boolean | undefined) =>
    setForm((f) => {
      const next = { ...f.attributes };
      if (v === undefined || v === "") delete next[k];
      else next[k] = v;
      return { ...f, attributes: next };
    });

  const validateStep = (): string | null => {
    if (step === 0 && !form.categorySlug) return "Choisissez une catégorie.";
    if (step === 0 && form.title.trim().length < 3) return "Le titre doit faire au moins 3 caractères.";
    if (step === 1) {
      if (form.title.trim().length < 3) return "Le titre doit faire au moins 3 caractères.";
      if (form.description.trim().length < 10) return "La description doit faire au moins 10 caractères.";
      if (needsPrice && (form.price === "" || Number(form.price) < 0)) return "Indiquez un prix.";
      for (const f of schema) {
        if (f.required && (form.attributes[f.key] === undefined || form.attributes[f.key] === "")) return `Le champ « ${f.label} » est obligatoire.`;
      }
    }
    if (step === 3 && !form.location.postalCode && !form.location.city) return "Indiquez une ville ou un code postal.";
    return null;
  };

  const next = () => {
    const err = validateStep();
    setError(err);
    if (!err) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const payload = (draft: boolean) => ({
    categorySlug: form.categorySlug,
    title: form.title.trim(),
    description: form.description.trim(),
    priceType: form.priceType,
    price: needsPrice && form.price !== "" ? Number(form.price) : undefined,
    condition: showCondition && form.condition ? form.condition : undefined,
    attributes: form.attributes,
    city: form.location.city,
    postalCode: form.location.postalCode,
    latitude: form.location.latitude,
    longitude: form.location.longitude,
    deliveryAvailable: deliveryAllowed && form.deliveryAvailable,
    weightGrams: deliveryAllowed && form.deliveryAvailable && form.weightGrams ? Number(form.weightGrams) : undefined,
    lengthCm: deliveryAllowed && form.deliveryAvailable && form.lengthCm ? Number(form.lengthCm) : undefined,
    widthCm: deliveryAllowed && form.deliveryAvailable && form.widthCm ? Number(form.widthCm) : undefined,
    heightCm: deliveryAllowed && form.deliveryAvailable && form.heightCm ? Number(form.heightCm) : undefined,
    ...(existing ? {} : { draft, onBehalfOf: form.onBehalfOf || undefined }),
  });

  const uploadPending = async (id: string) => {
    if (pending.length === 0) return;
    const fd = new FormData();
    pending.forEach((f) => fd.append("files", f));
    const uploaded = await api<ListingPhoto[]>(`/listings/${id}/photos`, { method: "POST", formData: fd });
    setPhotos((p) => [...p, ...uploaded]);
    setPending([]);
  };

  const submit = async (draft: boolean) => {
    setBusy(true);
    setError(null);
    try {
      let id = listingId;
      if (existing) {
        await api(`/listings/${existing.id}`, { method: "PATCH", body: payload(false) });
      } else if (!id) {
        const created = await api<{ id: string; status: string }>("/listings", { method: "POST", body: payload(draft) });
        id = created.id;
        setListingId(id);
      } else if (!draft) {
        await api(`/listings/${id}`, { method: "PATCH", body: { ...payload(false), status: "en_ligne" } });
      }
      await uploadPending(id!);
      if (draft && !existing) {
        toast("Brouillon enregistré.", "success");
        router.push("/compte/annonces");
        return;
      }
      const final = await api<ListingDetail>(`/listings/${id}`);
      if (final.status === "en_attente") toast("Annonce enregistrée : elle sera publiée après vérification par notre équipe.", "info");
      else toast(existing ? "Annonce mise à jour." : "Votre annonce est en ligne !", "success");
      router.push(`/annonces/${id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files).filter((f) => ["image/jpeg", "image/png", "image/webp"].includes(f.type) && f.size <= 8 * 1024 * 1024);
    if (incoming.length !== files.length) toast("Seules les images JPEG, PNG ou WEBP de moins de 8 Mo sont acceptées.", "error");
    const room = MAX_PHOTOS - photos.length - pending.length;
    const accepted = incoming.slice(0, Math.max(0, room));
    setPending((p) => [...p, ...accepted]);
    // Recadrage proposé pour la première photo ajoutée
    if (accepted[0]) setCropping({ file: accepted[0], index: pending.length });
  };

  const reorderPhotos = async (next: ListingPhoto[]) => {
    setPhotos(next);
    if (!listingId) return;
    try {
      await api(`/listings/${listingId}/photos/order`, { method: "PATCH", body: { photoIds: next.map((p) => p.id) } });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const moveInList = <T,>(list: T[], from: number, to: number): T[] => {
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };
  const dropOn = (list: "photos" | "pending", index: number) => {
    if (!dragIndex || dragIndex.list !== list || dragIndex.index === index) return setDragIndex(null);
    if (list === "photos") reorderPhotos(moveInList(photos, dragIndex.index, index));
    else setPending((p) => moveInList(p, dragIndex.index, index));
    setDragIndex(null);
  };
  const removePhoto = async (p: ListingPhoto) => {
    if (!listingId) return;
    try {
      await api(`/listings/${listingId}/photos/${p.id}`, { method: "DELETE" });
      setPhotos((ph) => ph.filter((x) => x.id !== p.id));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const moveTile = (list: "photos" | "pending", index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (list === "photos") { if (to < 0 || to >= photos.length) return; reorderPhotos(moveInList(photos, index, to)); }
    else { if (to < 0 || to >= pending.length) return; setPending((p) => moveInList(p, index, to)); }
  };

  const tileProps = (list: "photos" | "pending", index: number) => ({
    draggable: true,
    onDragStart: () => setDragIndex({ list, index }),
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: () => dropOn(list, index),
    onDragEnd: () => setDragIndex(null),
    dragging: dragIndex?.list === list && dragIndex.index === index,
  });

  return (
    <div className="panel">
      {/* Barre de progression : étape n/5 et pourcentage, pills cliquables pour revenir en arrière */}
      <div style={{ marginBottom: 20 }} data-testid="deposit-progress">
        <div className="row spread small" style={{ marginBottom: 6 }}>
          <strong>Étape {step + 1} sur {STEPS.length} : {STEPS[step]}</strong>
          <span className="muted">{Math.round(((step + 1) / STEPS.length) * 100)} %</span>
        </div>
        <div role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label={`Étape ${step + 1} sur ${STEPS.length}`} style={{ height: 6, borderRadius: 3, background: "var(--ivory-warm)", overflow: "hidden" }}>
          <div style={{ width: `${((step + 1) / STEPS.length) * 100}%`, height: "100%", background: "var(--accent)", transition: "width 0.25s ease-out" }} />
        </div>
        <ol className="row" style={{ listStyle: "none", padding: 0, margin: "10px 0 0", gap: 6, flexWrap: "wrap" }} aria-label="Étapes">
          {STEPS.map((s, i) => (
            <li key={s} className={`pill ${i === step ? "pill-accent" : i < step ? "pill-green" : ""}`} aria-current={i === step ? "step" : undefined} style={{ cursor: i < step ? "pointer" : "default" }} onClick={() => i < step && setStep(i)}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {step === 0 && (
        <div>
          <h2>Que proposez-vous ?</h2>
          <p className="muted">Commencez par un titre : nous vous proposons la bonne catégorie d&apos;après les mots que vous tapez.</p>
          <div className="field">
            <label htmlFor="title">Titre</label>
            <input id="title" className="input" value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={150} placeholder={titleExample(form.categorySlug, root?.slug)} autoFocus={!existing} />
            <span className="hint">{form.title.length}/150 — précis et sans coordonnées.</span>
          </div>
          {catSuggestions.length > 0 && (
            <div className="alert alert-info" role="status" data-testid="category-suggestions" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span>D&apos;après votre titre :</span>
              {catSuggestions.map((c) => (
                <button key={c.slug} type="button" className={`btn btn-sm ${form.categorySlug === c.slug ? "btn-primary" : "btn-outline"}`} aria-pressed={form.categorySlug === c.slug} onClick={() => { set("categorySlug", c.slug); set("attributes", {}); }}>
                  {c.rootName ? `${c.rootName} › ` : ""}{c.name}
                </button>
              ))}
            </div>
          )}
          <h3 className="h3" style={{ marginTop: 8 }}>Catégorie</h3>
          <p className="muted small">Choisissez la catégorie la plus précise : elle détermine les critères demandés et les filtres de recherche.</p>
          {!existing && shops.length > 0 && (
            <div className="field" style={{ maxWidth: 420 }}>
              <label htmlFor="obo">Publier au nom de</label>
              <select id="obo" className="select" value={form.onBehalfOf} onChange={(e) => set("onBehalfOf", e.target.value)}>
                <option value="">Moi-même ({user?.displayName})</option>
                {shops.map((s) => <option key={s.ownerId} value={s.ownerId}>Boutique {s.shopName}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {tree.map((r) => (
              <fieldset key={r.slug} className="card" style={{ padding: 12, margin: 0 }}>
                <legend style={{ fontWeight: 700, padding: "0 6px" }}>{r.name}</legend>
                {r.children.length === 0 ? (
                  <label className="checkbox" style={{ padding: "4px 0" }}>
                    <input type="radio" name="category" checked={form.categorySlug === r.slug} onChange={() => { set("categorySlug", r.slug); set("attributes", {}); }} /> {r.name}
                  </label>
                ) : r.children.map((c) => (
                  <label key={c.slug} className="checkbox" style={{ padding: "4px 0" }}>
                    <input type="radio" name="category" checked={form.categorySlug === c.slug} onChange={() => { set("categorySlug", c.slug); set("attributes", {}); }} /> {c.name}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <h2>Décrivez votre {root?.slug === "emploi" ? "offre" : root?.slug === "vacances" ? "hébergement" : "bien"}</h2>
          <p className="small muted">{categoryName} · <strong>{form.title || "sans titre"}</strong> <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 28, padding: "0 8px" }} onClick={() => setStep(0)}>modifier le titre</button></p>
          <div className="form-row">
            <div className="field">
              <label htmlFor="priceType">Type de prix</label>
              <select id="priceType" className="select" value={form.priceType} onChange={(e) => set("priceType", e.target.value as PriceType)}>
                {Object.entries(PRICE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {needsPrice && (
              <div className="field">
                <label htmlFor="price">Prix (€){root?.slug === "vacances" ? " par semaine" : ""}</label>
                <input id="price" className="input" type="number" min={0} step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="0" />
              </div>
            )}
          </div>
          <PriceEstimate categorySlug={form.categorySlug} title={form.title} price={form.price} enabled={needsPrice} />
          {showCondition && (
            <div className="field">
              <label htmlFor="condition">État</label>
              <select id="condition" className="select" value={form.condition} onChange={(e) => set("condition", e.target.value as Condition | "")}>
                <option value="">Non précisé</option>
                {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          )}
          {schema.length > 0 && (
            <fieldset style={{ border: "1px solid var(--line-soft)", borderRadius: "var(--radius)", padding: 16, marginBottom: 16 }}>
              <legend style={{ fontWeight: 700, padding: "0 6px" }}>Critères</legend>
              <div className="form-row">
                {schema.map((f) => (
                  <div className="field" key={f.key} style={{ marginBottom: 6 }}>
                    <label htmlFor={`a-${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ""}{f.required && " *"}</label>
                    {f.type === "select" ? (
                      <select
                        id={`a-${f.key}`}
                        className="select"
                        value={String(form.attributes[f.key] ?? "")}
                        disabled={!!f.dependsOn && !form.attributes[f.dependsOn]}
                        onChange={(e) => {
                          setAttr(f.key, e.target.value);
                          // Changer la marque remet le modèle à zéro : les listes sont dépendantes
                          for (const child of schema) if (child.dependsOn === f.key) setAttr(child.key, undefined);
                        }}
                      >
                        <option value="">{f.dependsOn && !form.attributes[f.dependsOn] ? `Choisir d'abord : ${schema.find((s) => s.key === f.dependsOn)?.label.toLowerCase() ?? f.dependsOn}` : "Choisir…"}</option>
                        {fieldOptions(f, form.attributes).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : f.type === "number" ? (
                      <input id={`a-${f.key}`} className="input" type="number" min={f.min} max={f.max} value={form.attributes[f.key] === undefined ? "" : String(form.attributes[f.key])} onChange={(e) => setAttr(f.key, e.target.value === "" ? undefined : Number(e.target.value))} />
                    ) : f.type === "boolean" ? (
                      <label className="checkbox"><input id={`a-${f.key}`} type="checkbox" checked={form.attributes[f.key] === true} onChange={(e) => setAttr(f.key, e.target.checked ? true : undefined)} /> Oui</label>
                    ) : (
                      <input id={`a-${f.key}`} className="input" maxLength={f.maxLength} value={String(form.attributes[f.key] ?? "")} onChange={(e) => setAttr(f.key, e.target.value)} />
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
          )}
          <div className="field">
            <label htmlFor="description">Description</label>
            <AutoTextarea id="description" value={form.description} onChange={(v) => set("description", v)} maxLength={5000} minRows={5} placeholder="Marque, dimensions, défauts éventuels, raison de la vente… Pas de numéro de téléphone ni de lien : la messagerie Trocoin s'en charge." />
            <span className="hint">{form.description.length}/5000</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2>Ajoutez des photos</h2>
          <CompletenessHint photosCount={photos.length + pending.length} description={form.description} price={form.price} priceType={form.priceType} attributes={form.attributes} schema={schema} onAction={completenessAction} />
          <p className="muted">Jusqu&apos;à {MAX_PHOTOS} photos (JPEG, PNG, WEBP, 8 Mo max). Un recadrage vous est proposé à l&apos;ajout. La première est la photo de couverture : <strong>glissez-déposez</strong> pour réorganiser.</p>
          <label className="card" style={{ display: "grid", placeItems: "center", padding: 32, borderStyle: "dashed", cursor: "pointer", marginBottom: 16 }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            {/* Le champ fichier reste accessible au clavier (rendu hors écran, pas masqué) */}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Choisir des photos" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <span><strong>Cliquez pour choisir des photos</strong> ou glissez-les ici</span>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }} role="list" aria-label="Photos de l'annonce">
            {photos.map((p, i) => (
              <PhotoTile key={p.id} src={mediaUrl(p.url)!} cover={i === 0} position={i + 1} onRemove={() => removePhoto(p)} onMove={(d) => moveTile("photos", i, d)} {...tileProps("photos", i)} />
            ))}
            {pending.map((f, i) => (
              <PhotoTile key={f.name + i + f.size} src={URL.createObjectURL(f)} cover={photos.length === 0 && i === 0} position={photos.length + i + 1} pendingLabel="À envoyer" onCrop={() => setCropping({ file: f, index: i })} onRemove={() => setPending((p) => p.filter((_, j) => j !== i))} onMove={(d) => moveTile("pending", i, d)} {...tileProps("pending", i)} />
            ))}
          </div>
          {photos.length + pending.length === 0 && <p className="hint" style={{ marginTop: 10 }}>Les annonces avec photo reçoivent beaucoup plus de contacts. Vous pourrez en ajouter plus tard.</p>}
          <PhotoCropper
            file={cropping?.file ?? null}
            onCancel={() => setCropping(null)}
            onDone={(cropped) => {
              setPending((p) => p.map((f, j) => (j === cropping!.index ? cropped : f)));
              setCropping(null);
            }}
          />
        </div>
      )}

      {step === 3 && (
        <div>
          <h2>Où se trouve {root?.slug === "emploi" ? "le poste" : root?.slug === "vacances" ? "l'hébergement" : "l'objet"} ?</h2>
          <p className="muted">Seule une position approximative (environ 1 km) est affichée publiquement. L&apos;adresse exacte se convient par messagerie.</p>
          <div className="field">
            <label htmlFor="loc">Ville ou code postal</label>
            <CityInput id="loc" value={form.location} onChange={(v) => set("location", v)} />
          </div>
          {deliveryAllowed && (
            <label className="checkbox" style={{ marginBottom: 16 }}>
              <input type="checkbox" checked={form.deliveryAvailable} onChange={(e) => set("deliveryAvailable", e.target.checked)} /> J&apos;accepte d&apos;expédier (Colissimo, Mondial Relay) — l&apos;annonce apparaît dans les recherches « livraison possible »
            </label>
          )}
          {deliveryAllowed && form.deliveryAvailable && (
            <div className="panel" style={{ padding: 14, marginBottom: 16 }} data-testid="parcel-fields">
              <p className="small" style={{ margin: "0 0 8px" }}><strong>Colis</strong> <span className="muted">(facultatif : sert à calculer le tarif de l&apos;étiquette ; 1 kg et petit colis si vide)</span></p>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <div className="field" style={{ marginBottom: 0, width: 140 }}><label htmlFor="weightGrams">Poids (g)</label><input id="weightGrams" className="input" inputMode="numeric" placeholder="1000" value={form.weightGrams} onChange={(e) => set("weightGrams", e.target.value.replace(/\D/g, ""))} /></div>
                <div className="field" style={{ marginBottom: 0, width: 110 }}><label htmlFor="lengthCm">Long. (cm)</label><input id="lengthCm" className="input" inputMode="numeric" placeholder="30" value={form.lengthCm} onChange={(e) => set("lengthCm", e.target.value.replace(/\D/g, ""))} /></div>
                <div className="field" style={{ marginBottom: 0, width: 110 }}><label htmlFor="widthCm">Larg. (cm)</label><input id="widthCm" className="input" inputMode="numeric" placeholder="20" value={form.widthCm} onChange={(e) => set("widthCm", e.target.value.replace(/\D/g, ""))} /></div>
                <div className="field" style={{ marginBottom: 0, width: 110 }}><label htmlFor="heightCm">Haut. (cm)</label><input id="heightCm" className="input" inputMode="numeric" placeholder="10" value={form.heightCm} onChange={(e) => set("heightCm", e.target.value.replace(/\D/g, ""))} /></div>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div>
          <h2>Aperçu avant publication</h2>
          <div className="card" style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16 }}>
            <div style={{ aspectRatio: "4/3", background: "var(--ivory-warm)", borderRadius: 8, overflow: "hidden" }}>
              {(photos[0] || pending[0]) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photos[0] ? mediaUrl(photos[0].url) : URL.createObjectURL(pending[0])} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              )}
            </div>
            <div>
              <span className="pill">{categoryName}</span>
              <h3 style={{ margin: "8px 0 4px" }}>{form.title}</h3>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", fontWeight: 700, color: "var(--accent)" }}>{formatPrice(needsPrice && form.price !== "" ? Number(form.price) : undefined, form.priceType)}</div>
              <p className="small muted" style={{ margin: "4px 0" }}>
                {form.location.city || form.location.postalCode}{showCondition && form.condition && ` · ${CONDITION_LABELS[form.condition]}`}{deliveryAllowed && form.deliveryAvailable && " · Livraison possible"}
              </p>
              <p style={{ whiteSpace: "pre-wrap", fontSize: ".92rem" }}>{form.description}</p>
              {Object.keys(form.attributes).length > 0 && (
                <ul className="small" style={{ paddingLeft: 18 }}>
                  {schema.filter((f) => form.attributes[f.key] !== undefined).map((f) => (
                    <li key={f.key}><span className="muted">{f.label} :</span> {typeof form.attributes[f.key] === "boolean" ? (form.attributes[f.key] ? "Oui" : "Non") : String(form.attributes[f.key])}{f.unit ? ` ${f.unit}` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>En publiant, vous confirmez que l&apos;annonce respecte les règles de diffusion (pas d&apos;objet interdit, pas de coordonnées, un objet par annonce).</p>
        </div>
      )}

      <hr className="divider" />
      <div className="row spread">
        <div className="row">
          {step > 0 && <button className="btn btn-outline" onClick={() => setStep((s) => s - 1)} disabled={busy}>Retour</button>}
          {!existing && step >= 1 && step < 4 && (
            <button className="btn btn-ghost" onClick={() => submit(true)} disabled={busy || !form.categorySlug || form.title.trim().length < 3 || form.description.trim().length < 10}>
              Enregistrer en brouillon
            </button>
          )}
        </div>
        {step < STEPS.length - 1 ? (
          <button className="btn btn-primary" onClick={next}>Continuer</button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={() => submit(false)} disabled={busy}>
            {busy ? "Publication…" : existing ? "Enregistrer les modifications" : "Publier l'annonce"}
          </button>
        )}
      </div>
    </div>
  );
}

function PhotoTile({ src, cover, pendingLabel, dragging, position, onCrop, onRemove, onMove, ...drag }: {
  src: string; cover: boolean; pendingLabel?: string; dragging?: boolean; position: number; onCrop?: () => void; onRemove: () => void; onMove: (delta: -1 | 1) => void;
  draggable: boolean; onDragStart: () => void; onDragOver: (e: React.DragEvent) => void; onDrop: () => void; onDragEnd: () => void;
}) {
  return (
    <div {...drag} role="listitem" style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: cover ? "2px solid var(--accent)" : "1px solid var(--line-soft)", background: "var(--ivory-warm)", opacity: dragging ? 0.5 : 1, cursor: "grab" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`Photo ${position}${cover ? " (couverture)" : ""}`} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", pointerEvents: "none" }} />
      {cover && <span className="pill pill-accent" style={{ position: "absolute", top: 6, left: 6 }}>Couverture</span>}
      {pendingLabel && <span className="pill" style={{ position: "absolute", top: 6, right: 6 }}>{pendingLabel}</span>}
      <div className="row" style={{ justifyContent: "space-between", padding: 4, background: "var(--white)" }}>
        <span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove(-1)} aria-label={`Avancer la photo ${position}`} title="Avancer" style={{ padding: "4px 6px" }}>◀</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMove(1)} aria-label={`Reculer la photo ${position}`} title="Reculer" style={{ padding: "4px 6px" }}>▶</button>
        </span>
        <span>
          {onCrop && <button type="button" className="btn btn-ghost btn-sm" onClick={onCrop} aria-label={`Recadrer la photo ${position}`}>✂ Recadrer</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`Supprimer la photo ${position}`} style={{ color: "var(--brick)" }}>✕</button>
        </span>
      </div>
    </div>
  );
}

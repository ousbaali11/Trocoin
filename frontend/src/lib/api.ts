/**
 * Client HTTP unique vers l'API NestJS.
 * - côté navigateur : ajoute l'access token (15 min), renouvelé d'avance s'il expire dans la minute ;
 *   sur 401, tente UNE rotation du refresh token (30 jours glissants) puis rejoue la requête ; la
 *   session locale n'est effacée que sur un refus définitif du serveur (jeton révoqué ou expiré),
 *   jamais sur une panne réseau ;
 * - côté serveur (rendu SSR des pages publiques) : appels anonymes.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
/**
 * Domaine canonique depuis le 15 septembre 2026. En production, une NEXT_PUBLIC_SITE_URL absente ou encore
 * sur l'ancien hébergeur (vercel.app) est ignorée : robots, sitemap, canoniques et Open Graph pointent vers trocoin.fr.
 */
const CANONICAL_SITE_URL = "https://www.trocoin.fr";
const configuredSite = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
export const SITE_URL =
  process.env.NODE_ENV === "production" && (!configuredSite || /\.(vercel\.app|onrender\.com)$/i.test(configuredSite))
    ? CANONICAL_SITE_URL
    : configuredSite || "http://localhost:3001";
const TOKEN_KEY = "trocoin_token";
const REFRESH_KEY = "trocoin_refresh";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* stockage indisponible (navigation privée) : session en mémoire uniquement */
  }
}

export function getToken(): string | null {
  return read(TOKEN_KEY);
}
export function getRefreshToken(): string | null {
  return read(REFRESH_KEY);
}
export function setSession(accessToken: string | null, refreshToken?: string | null) {
  write(TOKEN_KEY, accessToken);
  if (refreshToken !== undefined) write(REFRESH_KEY, refreshToken);
}
/** Compatibilité : anciens appels setToken(token). */
export function setToken(token: string | null) {
  setSession(token, token === null ? null : undefined);
}

/** Émission et expiration (ms) lues dans le JWT, sans vérifier la signature ; null si illisible. */
export function tokenTimes(token: string | null): { iat: number | null; exp: number } | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number; iat?: number };
    return typeof payload.exp === "number" ? { exp: payload.exp * 1000, iat: typeof payload.iat === "number" ? payload.iat * 1000 : null } : null;
  } catch {
    return null;
  }
}
/**
 * Jeton d'accès absent, illisible, expiré ou sur le point de l'être : à renouveler avant de l'utiliser.
 * Marge : une minute, plafonnée au quart de la durée de vie du jeton (un jeton de 15 min est renouvelé
 * d'avance dans sa dernière minute ; un jeton très court, comme en test, n'est pas renouvelé sans arrêt).
 */
export function tokenExpiresSoon(token: string | null, marginMs?: number): boolean {
  const t = tokenTimes(token);
  if (!t) return true;
  const lifetime = t.iat !== null ? t.exp - t.iat : 15 * 60_000;
  const margin = marginMs ?? Math.min(60_000, Math.max(1_000, lifetime / 4));
  return t.exp - Date.now() < margin;
}

let refreshing: Promise<string | null> | null = null;
/**
 * Rotation du refresh token, une seule à la fois : partagée entre les requêtes concurrentes de
 * l'onglet, et sérialisée entre onglets par un verrou navigateur (Web Locks) quand il existe. Une
 * fois le verrou pris, le stockage est relu : si un autre onglet vient de renouveler la session, on
 * réutilise son jeton au lieu de représenter l'ancien.
 */
export async function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const before = getRefreshToken();
      if (!before) return null;
      const run = async (): Promise<string | null> => {
        const rt = getRefreshToken();
        if (!rt) return null;
        if (rt !== before && !tokenExpiresSoon(getToken())) return getToken(); // renouvelé par un autre onglet
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (res.status === 401 || res.status === 403 || res.status === 400) {
          // Refus définitif (session révoquée, expirée ou jeton inconnu) : la session locale est effacée.
          // Sauf si un autre onglet vient de la renouveler entre-temps (jeton « déjà renouvelé »).
          if (getRefreshToken() !== rt) return getToken();
          setSession(null, null);
          return null;
        }
        if (!res.ok) return null; // panne passagère du serveur : on garde la session, nouvel essai plus tard
        const data = (await res.json()) as { accessToken: string; refreshToken: string };
        setSession(data.accessToken, data.refreshToken);
        return data.accessToken;
      };
      const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
      return locks ? await locks.request("trocoin-refresh", run) : await run();
    } catch {
      return null; // hors ligne : la session locale est conservée
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * Jeton d'accès prêt à l'emploi : renouvelé d'abord s'il est expiré ou sur le point de l'être
 * (retour sur le site après une longue absence, onglet resté ouvert). Null si aucune session.
 */
export async function ensureFreshToken(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  if (tokenExpiresSoon(token) && getRefreshToken()) return (await refreshSession()) ?? getToken();
  return token;
}

/** Déconnexion : révocation serveur puis effacement local. */
export async function logoutSession(): Promise<void> {
  const rt = getRefreshToken();
  // La session locale est effacée immédiatement : la révocation serveur suit, même hors ligne
  setSession(null, null);
  try {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt ?? undefined }) });
  } catch {
    /* hors ligne : on efface quand même localement */
  }
  setSession(null, null);
}

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    if (Array.isArray(m)) return m.join(" ");
    if (typeof m === "string") return m;
  }
  return fallback;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  formData?: FormData;
  token?: string | null;
  revalidate?: number | false;
  signal?: AbortSignal;
  /** interne : évite une boucle de refresh */
  _retried?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const explicitToken = opts.token !== undefined;
  let token = explicitToken ? opts.token : getToken();
  // Jeton de session expiré ou presque : renouvelé avant l'appel plutôt que d'attendre un 401
  if (!explicitToken && typeof window !== "undefined" && token && !opts._retried && tokenExpiresSoon(token) && getRefreshToken()) {
    token = (await refreshSession()) ?? getToken();
  }
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit & { next?: { revalidate?: number | false } } = {
    method: opts.method || "GET",
    headers,
    body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    signal: opts.signal,
  };
  if (typeof window === "undefined") {
    init.next = { revalidate: opts.revalidate ?? 0 };
    if (opts.revalidate === false || opts.revalidate === 0) init.cache = "no-store";
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch (err) {
    // Côté serveur (rendu), la cause technique est journalisée pour le diagnostic ; l'utilisateur voit un message neutre.
    if (typeof window === "undefined") console.error(`[api] ${init.method} ${API_URL}${path} injoignable :`, (err as Error & { cause?: { code?: string } }).cause?.code ?? (err as Error).message);
    throw new ApiError(0, "Impossible de joindre le serveur. Vérifiez votre connexion.");
  }

  // Access token expiré : rotation puis rejeu (une seule fois). Un jeton passé explicitement n'est rejoué
  // que s'il est celui de la session (les appels anonymes `token: null` restent anonymes).
  if (res.status === 401 && (!explicitToken || (token && token === getToken())) && !opts._retried && typeof window !== "undefined" && getRefreshToken()) {
    const fresh = await refreshSession();
    if (fresh) return api<T>(path, { ...opts, _retried: true });
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const fallback =
      res.status === 401 ? "Connectez-vous pour continuer." :
      res.status === 403 ? "Accès refusé." :
      res.status === 404 ? "Introuvable." :
      res.status === 429 ? "Trop de tentatives, réessayez dans quelques instants." :
      res.status === 503 ? "Service momentanément indisponible." :
      "Une erreur est survenue.";
    throw new ApiError(res.status, extractMessage(data, fallback), data);
  }
  return data as T;
}

/** URL absolue d'une image servie par l'API (/uploads/...). */
export function mediaUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  return `${API_URL}${path}`;
}

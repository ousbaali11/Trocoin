/**
 * Client HTTP unique vers l'API NestJS.
 * - côté navigateur : ajoute l'access token (15 min) ; sur 401, tente UNE
 *   rotation du refresh token puis rejoue la requête ; si la rotation échoue,
 *   la session locale est effacée ;
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

let refreshing: Promise<string | null> | null = null;
/** Rotation du refresh token (une seule à la fois, partagée entre requêtes concurrentes). */
export async function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const rt = getRefreshToken();
    if (!rt) return null;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) {
        setSession(null, null);
        return null;
      }
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      setSession(data.accessToken, data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
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
  const token = explicitToken ? opts.token : getToken();
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

  // Access token expiré : rotation puis rejeu (une seule fois, hors appels anonymes explicites)
  if (res.status === 401 && !explicitToken && !opts._retried && typeof window !== "undefined" && getRefreshToken()) {
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

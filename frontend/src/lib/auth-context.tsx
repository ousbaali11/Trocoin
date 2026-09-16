"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError, ensureFreshToken, getToken, logoutSession, setSession } from "./api";
import type { Me } from "./types";

interface AuthState {
  user: Me | null;
  token: string | null;
  loading: boolean;
  /** Vrai pendant la déconnexion : les pages protégées ne renvoient pas vers la connexion mais laissent revenir à l'accueil. */
  loggingOut: boolean;
  unreadMessages: number;
  unreadNotifications: number;
  login: (token: string, refreshToken?: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  refreshCounters: () => Promise<void>;
  /** Redirige vers la connexion en mémorisant l'action visée (pattern "intent redirect"). */
  requireAuth: (next?: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [token, setTok] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const router = useRouter();
  const pathname = usePathname();

  /**
   * Charge le compte à partir de la session stockée. Le jeton d'accès (15 min) est renouvelé
   * d'abord s'il a expiré pendant l'absence : c'est ce qui garde la connexion après la fermeture
   * du navigateur (le refresh token, 30 jours glissants, n'est effacé que par « Se déconnecter »).
   */
  const loadUser = useCallback(async (tok: string | null) => {
    if (!tok) {
      setUser(null);
      return;
    }
    try {
      const fresh = await ensureFreshToken();
      if (!fresh) {
        // Refus définitif du serveur (session révoquée ou expirée depuis plus de 30 jours)
        if (!getToken()) {
          setTok(null);
          setUser(null);
        }
        return;
      }
      setTok(fresh);
      const me = await api<Me>("/users/me");
      setUser(me);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setSession(null, null);
        setTok(null);
        setUser(null);
      }
    }
  }, []);

  const refreshCounters = useCallback(async () => {
    if (!getToken()) return;
    try {
      const [m, n] = await Promise.all([
        api<{ unread: number }>("/conversations/unread-count"),
        api<{ unread: number }>("/notifications/unread-count"),
      ]);
      setUnreadMessages(m.unread);
      setUnreadNotifications(n.unread);
    } catch {
      /* silencieux */
    }
  }, []);

  useEffect(() => {
    const tok = getToken();
    setTok(tok);
    loadUser(tok).finally(() => setLoading(false));
  }, [loadUser]);

  // Autres onglets : une déconnexion (ou une connexion) ailleurs se répercute ici sans rechargement
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "trocoin_token" && e.key !== null) return;
      const tok = getToken();
      if (!tok) {
        setTok(null);
        setUser(null);
      } else if (!user) {
        setTok(tok);
        void loadUser(tok);
      } else {
        setTok(tok);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loadUser, user]);

  useEffect(() => {
    if (!user) return;
    refreshCounters();
    const id = setInterval(refreshCounters, 30_000);
    return () => clearInterval(id);
  }, [user, refreshCounters, pathname]);

  const login = useCallback(
    async (tok: string, refreshToken?: string) => {
      setSession(tok, refreshToken);
      setTok(tok);
      await loadUser(tok);
    },
    [loadUser],
  );

  const logout = useCallback(() => {
    setLoggingOut(true);
    void logoutSession();
    setTok(null);
    setUser(null);
    setUnreadMessages(0);
    setUnreadNotifications(0);
    router.push("/");
  }, [router]);

  // Fin de la déconnexion une fois l'accueil atteint
  useEffect(() => {
    if (loggingOut && pathname === "/") setLoggingOut(false);
  }, [loggingOut, pathname]);

  const refresh = useCallback(() => loadUser(getToken()), [loadUser]);

  const requireAuth = useCallback(
    (next?: string) => {
      if (getToken()) return true;
      const target = next || (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/");
      router.push(`/connexion?next=${encodeURIComponent(target)}`);
      return false;
    },
    [router],
  );

  const value = useMemo(
    () => ({ user, token, loading, loggingOut, unreadMessages, unreadNotifications, login, logout, refresh, refreshCounters, requireAuth }),
    [user, token, loading, loggingOut, unreadMessages, unreadNotifications, login, logout, refresh, refreshCounters, requireAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans AuthProvider");
  return ctx;
}

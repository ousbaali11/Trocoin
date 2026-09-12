"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError, getToken, setToken } from "./api";
import type { Me } from "./types";

interface AuthState {
  user: Me | null;
  token: string | null;
  loading: boolean;
  unreadMessages: number;
  unreadNotifications: number;
  login: (token: string) => Promise<void>;
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
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const router = useRouter();
  const pathname = usePathname();

  const loadUser = useCallback(async (tok: string | null) => {
    if (!tok) {
      setUser(null);
      return;
    }
    try {
      const me = await api<Me>("/users/me", { token: tok });
      setUser(me);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setToken(null);
        setTok(null);
        setUser(null);
      }
    }
  }, []);

  const refreshCounters = useCallback(async () => {
    const tok = getToken();
    if (!tok) return;
    try {
      const [m, n] = await Promise.all([
        api<{ unread: number }>("/conversations/unread-count", { token: tok }),
        api<{ unread: number }>("/notifications/unread-count", { token: tok }),
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

  useEffect(() => {
    if (!user) return;
    refreshCounters();
    const id = setInterval(refreshCounters, 30_000);
    return () => clearInterval(id);
  }, [user, refreshCounters, pathname]);

  const login = useCallback(
    async (tok: string) => {
      setToken(tok);
      setTok(tok);
      await loadUser(tok);
    },
    [loadUser],
  );

  const logout = useCallback(() => {
    setToken(null);
    setTok(null);
    setUser(null);
    setUnreadMessages(0);
    setUnreadNotifications(0);
    router.push("/");
  }, [router]);

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
    () => ({ user, token, loading, unreadMessages, unreadNotifications, login, logout, refresh, refreshCounters, requireAuth }),
    [user, token, loading, unreadMessages, unreadNotifications, login, logout, refresh, refreshCounters, requireAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans AuthProvider");
  return ctx;
}

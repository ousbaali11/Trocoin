"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";

export function BlockButton({ userId }: { userId: string }) {
  const { user, requireAuth } = useAuth();
  const { toast } = useToast();
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user || user.id === userId) return;
    api<Array<{ id: string }>>("/users/me/blocks").then((list) => setBlocked(list.some((u) => u.id === userId))).catch(() => setBlocked(false));
  }, [user, userId]);

  if (!user || user.id === userId) return null;

  const toggle = async () => {
    if (!requireAuth()) return;
    try {
      await api(`/users/me/blocks/${userId}`, { method: blocked ? "DELETE" : "POST" });
      setBlocked(!blocked);
      toast(blocked ? "Utilisateur débloqué." : "Utilisateur bloqué : il ne pourra plus vous écrire.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <button className="btn btn-ghost btn-sm" onClick={toggle} style={{ color: blocked ? undefined : "var(--brick)" }}>
      {blocked ? "Débloquer" : "Bloquer cet utilisateur"}
    </button>
  );
}

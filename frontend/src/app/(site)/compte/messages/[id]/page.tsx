"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, API_URL, getToken, mediaUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { formatDateTime, formatEuros, formatPrice, REPORT_REASON_LABELS } from "@/lib/format";
import type { ConversationDetail, Message } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { user, refreshCounters } = useAuth();
  const { toast } = useToast();
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("harcelement");
  const [reportDetails, setReportDetails] = useState("");
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmount, setOfferAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const c = await api<ConversationDetail>(`/conversations/${id}`);
      setConv(c);
      setMessages(c.messages);
      refreshCounters();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, refreshCounters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = io(API_URL, { auth: { token }, transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("join", { conversationId: id }, (ack: { ok: boolean }) => {
        liveRef.current = !!ack?.ok;
        setLive(liveRef.current);
      });
    });
    socket.on("disconnect", () => {
      liveRef.current = false;
      setLive(false);
    });
    socket.on("message", (m: Message) => {
      if (m.conversationId !== id) return;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.senderId !== user?.id) api(`/conversations/${id}/messages`).then(() => refreshCounters()).catch(() => null);
    });
    // Photos et offres passent par REST : on se resynchronise à chaque réveil "inbox"
    socket.on("inbox", (p: { conversationId: string }) => {
      if (p.conversationId === id) load();
    });
    const poll = setInterval(() => {
      if (!socket.connected) load();
    }, 15_000);
    return () => {
      clearInterval(poll);
      socket.emit("leave", { conversationId: id });
      socket.close();
    };
  }, [id, user?.id, load, refreshCounters]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async (content?: string) => {
    const body = (content ?? text).trim();
    if (!body) return;
    setText("");
    const socket = socketRef.current;
    if (socket?.connected && liveRef.current) {
      socket.emit("message", { conversationId: id, content: body }, (ack: { ok: boolean; message?: string | Message }) => {
        if (!ack?.ok) return toast((typeof ack?.message === "string" && ack.message) || "Envoi impossible.", "error");
        const m = ack.message as Message | undefined;
        if (m && typeof m === "object") setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      });
      return;
    }
    try {
      const m = await api<Message>(`/conversations/${id}/messages`, { method: "POST", body: { content: body } });
      setMessages((prev) => [...prev, m]);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const sendImage = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const m = await api<Message>(`/conversations/${id}/images`, { method: "POST", formData: fd });
      setMessages((prev) => [...prev, m]);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const sendOffer = async () => {
    const amount = Number(offerAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return toast("Montant invalide.", "error");
    setBusy(true);
    try {
      const m = await api<Message>(`/conversations/${id}/offers`, { method: "POST", body: { amount } });
      setMessages((prev) => [...prev.map((x) => (x.type === "offer" && x.offerStatus === "en_attente" ? { ...x, offerStatus: "retiree" as const } : x)), m]);
      setOfferOpen(false);
      setOfferAmount("");
      toast("Proposition envoyée au vendeur.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const answerOffer = async (m: Message, decision: "acceptee" | "refusee" | "retiree") => {
    setBusy(true);
    try {
      const updated = await api<Message>(`/conversations/${id}/offers/${m.id}`, { method: "POST", body: { decision } });
      setMessages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      toast(decision === "acceptee" ? "Proposition acceptée." : decision === "refusee" ? "Proposition refusée." : "Proposition retirée.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleBlock = async () => {
    if (!conv?.other) return;
    try {
      await api(`/users/me/blocks/${conv.other.id}`, { method: conv.blocked ? "DELETE" : "POST" });
      toast(conv.blocked ? "Utilisateur débloqué." : "Utilisateur bloqué.", "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const report = async () => {
    try {
      await api("/reports", { method: "POST", body: { conversationId: id, reason: reportReason, details: reportDetails.trim() || undefined } });
      toast("Signalement transmis à notre équipe.", "success");
      setReportOpen(false);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (error) return <div className="alert alert-error">{error} <Link href="/compte/messages">Retour aux messages</Link></div>;
  if (!conv || !user) return <div className="skeleton" style={{ height: 400 }} />;
  const isBuyer = conv.role === "acheteur";

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - var(--header-h) - 100px)", minHeight: 520, padding: 0, overflow: "hidden" }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line-soft)" }}>
        <Link href="/compte/messages" className="btn btn-ghost btn-sm" aria-label="Retour">←</Link>
        {conv.listing && (
          <Link href={`/annonces/${conv.listing.id}`} style={{ width: 44, height: 44, borderRadius: 6, overflow: "hidden", background: "var(--ivory-warm)", flexShrink: 0 }}>
            {conv.listing.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl(conv.listing.coverUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            )}
          </Link>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8 }}>
            <strong>{conv.other?.displayName}</strong>
            {conv.other && !conv.other.deleted && <Link href={`/vendeurs/${conv.other.id}`} className="small">Profil</Link>}
            <span className="small muted" title={live ? "Connexion temps réel active" : "Mode différé"}>{live ? "● en direct" : "○ différé"}</span>
          </div>
          {conv.listing && (
            <Link href={`/annonces/${conv.listing.id}`} className="small muted" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {conv.listing.title} · {formatPrice(conv.listing.price, conv.listing.priceType)}
            </Link>
          )}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {isBuyer && conv.listing?.status === "en_ligne" && <Link href={`/annonces/${conv.listing.id}`} className="btn btn-dark btn-sm">Acheter</Link>}
          <button className="btn btn-ghost btn-sm" onClick={() => setReportOpen(true)} style={{ color: "var(--brick)" }}>Signaler</button>
          <button className="btn btn-ghost btn-sm" onClick={toggleBlock}>{conv.blocked ? "Débloquer" : "Bloquer"}</button>
        </div>
      </header>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8, background: "var(--bg)" }}>
        {messages.length === 0 && <p className="muted small" style={{ textAlign: "center" }}>Début de la conversation. Restez courtois et ne partagez pas vos coordonnées bancaires.</p>}
        {messages.map((m) => {
          const mine = m.senderId === user.id;
          const bubble: React.CSSProperties = { background: mine ? "var(--accent)" : "var(--white)", color: mine ? "#fff" : "var(--ink)", padding: "9px 13px", borderRadius: 14, borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4, whiteSpace: "pre-wrap", wordBreak: "break-word", border: mine ? 0 : "1px solid var(--line-soft)" };
          return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "75%" }}>
              {m.type === "image" ? (
                <div style={{ ...bubble, padding: 4 }}>
                  <button type="button" onClick={() => setLightbox(mediaUrl(m.attachmentUrl) ?? null)} style={{ padding: 0, border: 0, background: "none", cursor: "zoom-in" }} aria-label="Agrandir la photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl(m.attachmentUrl)} alt="Photo envoyée" style={{ maxWidth: 260, maxHeight: 220, borderRadius: 10, display: "block" }} />
                  </button>
                  {m.content && <div style={{ padding: "6px 8px 2px" }}>{m.content}</div>}
                </div>
              ) : m.type === "offer" ? (
                <div style={{ ...bubble, background: "var(--white)", color: "var(--ink)", border: "2px solid var(--accent)", minWidth: 220 }}>
                  <div className="small muted">{mine ? "Votre proposition" : "Proposition de prix"}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 700, color: "var(--accent)" }}>{formatEuros(m.offerAmount)}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className={`pill ${m.offerStatus === "acceptee" ? "pill-green" : m.offerStatus === "refusee" ? "pill-brick" : m.offerStatus === "retiree" ? "" : "pill-ochre"}`}>
                      {m.offerStatus === "acceptee" ? "Acceptée" : m.offerStatus === "refusee" ? "Refusée" : m.offerStatus === "retiree" ? "Retirée" : "En attente"}
                    </span>
                    {m.offerStatus === "en_attente" && !isBuyer && !mine && (
                      <>
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => answerOffer(m, "acceptee")}>Accepter</button>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => answerOffer(m, "refusee")}>Refuser</button>
                      </>
                    )}
                    {m.offerStatus === "en_attente" && isBuyer && mine && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => answerOffer(m, "retiree")}>Retirer</button>}
                  </div>
                  {m.offerStatus === "acceptee" && isBuyer && conv.listing?.status === "en_ligne" && <p className="small" style={{ margin: "8px 0 0" }}>Le vendeur a accepté : convenez du paiement (sécurisé ou en main propre) par messagerie.</p>}
                </div>
              ) : (
                <div style={bubble}>{m.content}</div>
              )}
              <div className="small muted" style={{ textAlign: mine ? "right" : "left", marginTop: 2, fontSize: ".72rem" }}>
                {formatDateTime(m.createdAt)}{mine && m.readAt ? " · lu" : ""}
              </div>
            </div>
          );
        })}
      </div>

      <footer style={{ padding: 12, borderTop: "1px solid var(--line-soft)", background: "var(--white)" }}>
        {conv.blocked ? (
          <p className="muted small" style={{ margin: 0, textAlign: "center" }}>Vous ne pouvez plus échanger avec cet utilisateur.</p>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 8, gap: 6 }}>
              {conv.quickReplies.map((q) => (
                <button key={q} type="button" className="pill" style={{ cursor: "pointer", border: 0, whiteSpace: "normal", textAlign: "left" }} onClick={() => send(q)}>{q}</button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="row" style={{ flexWrap: "nowrap" }}>
              <label className="btn btn-outline btn-sm" title="Envoyer une photo" style={{ flexShrink: 0 }}>
                📷
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { if (e.target.files?.[0]) sendImage(e.target.files[0]); e.target.value = ""; }} />
              </label>
              {isBuyer && conv.listing?.status === "en_ligne" && (
                <button type="button" className="btn btn-outline btn-sm" style={{ flexShrink: 0 }} onClick={() => setOfferOpen(true)} title="Proposer un prix">💶 Proposer un prix</button>
              )}
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Votre message…" maxLength={2000} aria-label="Message" />
              <button className="btn btn-primary" type="submit" disabled={!text.trim()}>Envoyer</button>
            </form>
          </>
        )}
      </footer>

      {lightbox && (
        <div role="dialog" aria-label="Photo" onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.9)", zIndex: 300, display: "grid", placeItems: "center", cursor: "zoom-out" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" style={{ maxWidth: "95vw", maxHeight: "92vh", objectFit: "contain" }} />
        </div>
      )}

      <Modal open={offerOpen} onClose={() => setOfferOpen(false)} title="Proposer un prix">
        <p className="small muted">Prix affiché : {conv.listing ? formatPrice(conv.listing.price, conv.listing.priceType) : "—"}. Une seule proposition en attente à la fois ; le vendeur peut accepter ou refuser.</p>
        <div className="field">
          <label htmlFor="offer">Votre proposition (€)</label>
          <input id="offer" className="input" type="number" min={1} step="0.01" value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} autoFocus />
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={() => setOfferOpen(false)}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !offerAmount} onClick={sendOffer}>Envoyer la proposition</button>
        </div>
      </Modal>

      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Signaler cette conversation">
        <div className="field">
          <label htmlFor="r-reason">Motif</label>
          <select id="r-reason" className="select" value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
            {["harcelement", "arnaque", "contenu_offensant", "coordonnees_dans_annonce", "autre"].map((k) => <option key={k} value={k}>{REPORT_REASON_LABELS[k]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-details">Précisions</label>
          <textarea id="r-details" className="textarea" value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} maxLength={2000} style={{ minHeight: 90 }} />
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={() => setReportOpen(false)}>Annuler</button>
          <button className="btn btn-danger" onClick={report}>Envoyer</button>
        </div>
      </Modal>
    </div>
  );
}

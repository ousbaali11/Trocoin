"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, API_URL, getToken, mediaUrl, refreshSession, tokenExpiresSoon } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { formatDateTime, formatEuros, formatPrice, REPORT_REASON_LABELS } from "@/lib/format";
import type { ConversationDetail, Message } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { SalePanel } from "@/components/messages/SalePanel";
import { saleEventText } from "@/lib/sale-events";
import { BackLink } from "@/components/ui/BackLink";
import { Disclosure } from "@/components/ui/Disclosure";

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { user, refreshCounters } = useAuth();
  const { toast } = useToast();
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  // Présence de l'autre membre : vert = connecté, orange = absent (jamais d'heure de dernière visite)
  const [peerOnline, setPeerOnline] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("harcelement");
  const [reportDetails, setReportDetails] = useState("");
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmount, setOfferAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [otherTyping, setOtherTyping] = useState(false);
  const typingHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(false);

  const loadedRef = useRef(false);
  const load = useCallback(async () => {
    try {
      const c = await api<ConversationDetail>(`/conversations/${id}`);
      loadedRef.current = true;
      setError(null);
      setConv(c);
      // Le serveur fait foi (statuts des propositions compris) ; un message reçu par le socket pendant la requête est gardé
      setMessages((prev) => {
        const known = new Set(c.messages.map((m) => m.id));
        const extra = prev.filter((m) => !known.has(m.id) && m.conversationId === id);
        return extra.length ? [...c.messages, ...extra].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : c.messages;
      });
      refreshCounters();
    } catch (e) {
      // Coupure passagère pendant une resynchronisation : on garde la conversation affichée, le prochain passage rattrapera
      if (!loadedRef.current) setError((e as Error).message);
    }
  }, [id, refreshCounters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!getToken()) return;
    // Jeton lu (et rafraîchi s'il expire) à CHAQUE tentative de connexion : un jeton figé à l'ouverture de la page
    // faisait refuser toute reconnexion après 15 minutes, et la conversation restait « différée » pour de bon
    const socket = io(API_URL, {
      transports: ["websocket", "polling"],
      auth: (cb) => {
        const current = getToken();
        if (current && !tokenExpiresSoon(current)) return cb({ token: current });
        refreshSession().then((fresh) => cb({ token: fresh || current || "" })).catch(() => cb({ token: current || "" }));
      },
    });
    socketRef.current = socket;
    let inboxTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const resync = () => {
      if (inboxTimer) clearTimeout(inboxTimer);
      inboxTimer = setTimeout(load, 250);
    };
    socket.on("connect", () => {
      socket.emit("join", { conversationId: id }, (ack: { ok: boolean; peerOnline?: boolean }) => {
        liveRef.current = !!ack?.ok;
        setPeerOnline(!!ack?.peerOnline);
        setLive(liveRef.current);
        // (Re)connexion : tout ce qui est arrivé pendant la coupure est relu d'un coup
        load();
      });
    });
    socket.on("disconnect", () => {
      liveRef.current = false;
      setLive(false);
    });
    // Connexion refusée (jeton expiré…) : socket.io ne réessaie pas seul après un refus du serveur
    socket.on("connect_error", () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { if (!socket.connected) socket.connect(); }, 4000);
    });
    socket.on("message", (m: Message) => {
      if (m.conversationId !== id) return;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.senderId !== user?.id) {
        setOtherTyping(false);
        // Affiché → lu, seulement si l'onglet est réellement à l'écran
        if (document.visibilityState === "visible") socket.emit("read", { conversationId: id }, () => refreshCounters());
      }
    });
    // Proposition acceptée, refusée ou retirée : le ticket change d'état chez les deux, sans recharger
    socket.on("message:update", (m: Message) => {
      if (m.conversationId !== id) return;
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
    });
    // Accusé de lecture du destinataire : mes messages passent « Vu »
    socket.on("presence", (e: { userId: string; online: boolean }) => {
      if (e.userId !== user?.id) setPeerOnline(e.online);
    });
    socket.on("read", (e: { conversationId: string; readerId: string; readAt: string }) => {
      if (e.conversationId !== id || e.readerId === user?.id) return;
      setMessages((prev) => prev.map((m) => (m.senderId === user?.id && !m.readAt ? { ...m, readAt: e.readAt } : m)));
    });
    // Indicateur de frappe de l'autre membre, effacé après 4 s sans nouvelle frappe
    socket.on("typing", (e: { conversationId: string; userId: string; typing: boolean }) => {
      if (e.conversationId !== id || e.userId === user?.id) return;
      if (typingHideTimer.current) clearTimeout(typingHideTimer.current);
      setOtherTyping(e.typing);
      if (e.typing) typingHideTimer.current = setTimeout(() => setOtherTyping(false), 4000);
    });
    // Réveil de la boîte : état de la vente, proposition payable, photos… relus (regroupé : plusieurs réveils, une lecture)
    socket.on("inbox", (p: { conversationId: string }) => {
      if (p.conversationId === id) resync();
    });
    // Retour sur l'onglet (mobile : l'onglet en arrière-plan est gelé, la connexion souvent coupée) : on relit et on reconnecte
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      load();
      if (!socket.connected) socket.connect();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener("pageshow", onVisible);
    // Filet de sécurité : toutes les 10 s sans temps réel, toutes les 30 s sinon — onglet visible seulement
    let ticks = 0;
    const poll = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      ticks += 1;
      if (!socket.connected || !liveRef.current || ticks % 3 === 0) load();
    }, 10_000);
    return () => {
      clearInterval(poll);
      if (inboxTimer) clearTimeout(inboxTimer);
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener("pageshow", onVisible);
      if (typingHideTimer.current) clearTimeout(typingHideTimer.current);
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      socket.emit("leave", { conversationId: id });
      socket.close();
    };
  }, [id, user?.id, load, refreshCounters]);

  /** Frappe : « en train d'écrire » envoyé au plus toutes les 1,5 s, « arrêt » après 2,5 s sans saisie ou à l'envoi. */
  const signalTyping = (typing: boolean) => {
    const socket = socketRef.current;
    if (!socket?.connected || !liveRef.current) return;
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    if (!typing) {
      if (lastTypingSent.current) socket.emit("typing", { conversationId: id, typing: false });
      lastTypingSent.current = 0;
      return;
    }
    const now = Date.now();
    if (now - lastTypingSent.current > 1500) {
      socket.emit("typing", { conversationId: id, typing: true });
      lastTypingSent.current = now;
    }
    typingStopTimer.current = setTimeout(() => signalTyping(false), 2500);
  };

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, otherTyping]);

  /** Ajoute ou met à jour un message par identifiant : la réponse d'une requête et la diffusion en direct peuvent se croiser. */
  const upsert = (m: Message) => setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)) : [...prev, m]));

  const send = async (content?: string) => {
    const body = (content ?? text).trim();
    if (!body) return;
    setText("");
    signalTyping(false);
    const socket = socketRef.current;
    if (socket?.connected && liveRef.current) {
      socket.emit("message", { conversationId: id, content: body }, (ack: { ok: boolean; message?: string | Message }) => {
        if (!ack?.ok) return toast((typeof ack?.message === "string" && ack.message) || "Envoi impossible.", "error");
        const m = ack.message as Message | undefined;
        if (m && typeof m === "object") upsert(m);
      });
      return;
    }
    try {
      upsert(await api<Message>(`/conversations/${id}/messages`, { method: "POST", body: { content: body } }));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const sendImage = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      upsert(await api<Message>(`/conversations/${id}/images`, { method: "POST", formData: fd }));
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
      setMessages((prev) => prev.map((x) => (x.type === "offer" && x.offerStatus === "en_attente" && x.id !== m.id ? { ...x, offerStatus: "retiree" as const } : x)));
      upsert(m);
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

  if (error && !conv) return <div className="alert alert-error">{error} <Link href="/compte/messages">Retour aux messages</Link></div>;
  if (!conv || !user) return <div className="skeleton" style={{ height: 400 }} />;
  const isBuyer = conv.role === "acheteur";
  // Vente en cours ou conclue entre les deux : plus d'« Acheter », de proposition de prix ni de questions d'avant-vente
  const saleOpen = !!conv.transaction && ["sequestre", "livree", "litige", "confirme"].includes(conv.transaction.status);
  // « Vu à … » uniquement sous mon dernier message (comme les messageries grand public)
  let lastMineIndex = -1;
  messages.forEach((m, i) => { if (m.senderId === user.id && m.type !== "system") lastMineIndex = i; });

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - var(--header-h) - 100px)", minHeight: conv.transaction ? 660 : 520, padding: 0, overflow: "hidden" }}>
      <h1 className="sr-only">Conversation avec {conv.other?.displayName ?? "un membre"}{conv.listing ? ` à propos de ${conv.listing.title}` : ""}</h1>
      <header className="conv-header" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line-soft)" }}>
        <BackLink href="/compte/messages" label="Retour aux messages" />
        <div className="conv-avatar" data-testid="conv-avatar" data-online={peerOnline ? "true" : "false"} title={peerOnline ? "En ligne" : "Absent"}>
          {conv.other?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(conv.other.avatarUrl)} alt="" />
          ) : (
            <span aria-hidden="true">{(conv.other?.displayName ?? "?").trim().charAt(0).toUpperCase()}</span>
          )}
          <span className="conv-presence" role="img" aria-label={peerOnline ? "En ligne" : "Absent"} />
        </div>
        <div style={{ minWidth: 160, flex: 1 }}>
          <div className="row" style={{ gap: 8 }}>
            <strong style={{ whiteSpace: "nowrap" }}>{conv.other?.displayName}</strong>
            {conv.other && !conv.other.deleted && <Link href={`/vendeurs/${conv.other.id}`} className="small">Profil</Link>}
            {!live && <span className="small muted" title="Connexion temps réel interrompue : relecture régulière">différé</span>}
          </div>
          {conv.listing ? (
            <Link href={`/annonces/${conv.listing.id}`} className="small muted" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {conv.listing.title} · {formatPrice(conv.listing.price, conv.listing.priceType)}
            </Link>
          ) : (
            <span className="small muted" style={{ display: "block" }} data-testid="listing-gone">Cette annonce n&apos;existe plus</span>
          )}
        </div>
        <div className="row conv-actions" style={{ gap: 4, marginLeft: "auto" }}>
          {isBuyer && !saleOpen && conv.listing?.status === "en_ligne" && <Link href={`/annonces/${conv.listing.id}?acheter=1`} className="btn btn-dark btn-sm" data-testid="conv-buy">{conv.acceptedOffer ? `Payer ${formatEuros(conv.acceptedOffer.amount)}` : "Acheter"}</Link>}
          <button className="btn btn-ghost btn-sm" onClick={() => setReportOpen(true)} style={{ color: "var(--brick)" }}>Signaler</button>
          {conv.blocked && !conv.blockedByMe ? <span className="small muted" title="Cette personne vous a bloqué">Bloqué</span> : <button className="btn btn-ghost btn-sm" onClick={toggleBlock}>{conv.blocked ? "Débloquer" : "Bloquer"}</button>}
        </div>
      </header>
      <p className="small muted" style={{ margin: 0, padding: "6px 16px", borderBottom: "1px solid var(--line-soft)", background: "var(--paper, #faf9f6)" }} data-testid="safety-reminder">
        🔒 Ne payez jamais en dehors de Trocoin (virement, lien, application de paiement) : seul le paiement sécurisé du site vous protège.
      </p>

      {conv.transaction && <SalePanel sale={conv.transaction} listing={conv.listing} onChanged={load} />}

      <div ref={listRef} role="log" aria-live="polite" aria-label="Messages de la conversation" style={{ flex: 1, minHeight: 200, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8, background: "var(--bg)" }}>
        {messages.length === 0 && <p className="muted small" style={{ textAlign: "center" }}>Début de la conversation. Restez courtois et ne partagez pas vos coordonnées bancaires.</p>}
        {messages.map((m, index) => {
          if (m.type === "system") {
            // Message automatique : centré, encadré en pointillés, étiqueté — jamais confondu avec un message écrit par une personne
            const t = saleEventText(m, isBuyer ? "acheteur" : "vendeur", conv.other?.displayName ?? "L'acheteur");
            return (
              <div key={m.id} data-testid="system-message" data-event={m.systemEvent ?? ""} style={{ alignSelf: "center", width: "100%", maxWidth: 440, margin: "4px 0", padding: "7px 12px", border: "1px dashed var(--accent)", borderRadius: 12, background: "var(--accent-tint)", color: "var(--ink)", textAlign: "center" }}>
                <div className="small" style={{ textTransform: "uppercase", letterSpacing: ".08em", fontSize: ".66rem", fontWeight: 700, color: "var(--accent-dark)" }}>Message automatique · Trocoin</div>
                <div style={{ fontWeight: 700, margin: "1px 0", fontSize: ".9rem" }}><span aria-hidden="true">{t.icon} </span>{t.title}</div>
                <div className="small" style={{ whiteSpace: "pre-wrap", fontSize: ".8rem", lineHeight: 1.35 }}>{t.body}</div>
                {t.trackingUrl && (
                  <a className="btn btn-outline btn-sm" style={{ marginTop: 6, padding: "5px 12px", fontSize: ".78rem" }} href={t.trackingUrl} target="_blank" rel="noopener noreferrer" data-testid="system-track">Suivre le colis</a>
                )}
                <div className="small muted" style={{ marginTop: 4, fontSize: ".72rem" }}><span suppressHydrationWarning>{formatDateTime(m.createdAt)}</span></div>
              </div>
            );
          }
          const mine = m.senderId === user.id;
          const bubble: React.CSSProperties = { background: mine ? "var(--accent)" : "var(--white)", color: mine ? "#fff" : "var(--ink)", padding: "9px 13px", borderRadius: 14, borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4, whiteSpace: "pre-wrap", wordBreak: "break-word", border: mine ? 0 : "1px solid var(--line-soft)" };
          return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "75%" }}>
              {m.type === "image" ? (
                <div style={{ ...bubble, padding: 4 }}>
                  <button type="button" onClick={() => setLightbox(mediaUrl(m.attachmentUrl) ?? null)} style={{ padding: 0, border: 0, background: "none", cursor: "zoom-in" }} aria-label="Agrandir la photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl(m.attachmentUrl)} alt="Photo envoyée" style={{ maxWidth: "min(260px, 100%)", maxHeight: 220, borderRadius: 10, display: "block" }} />
                  </button>
                  {m.content && <div style={{ padding: "6px 8px 2px" }}>{m.content}</div>}
                </div>
              ) : m.type === "offer" ? (
                <div data-testid="offer-card" data-status={m.offerStatus ?? ""} style={{ ...bubble, background: "var(--white)", color: "var(--ink)", border: "2px solid var(--accent)", minWidth: 200, padding: "8px 12px" }}>
                  <div className="row" style={{ gap: 8, alignItems: "baseline", justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <span className="small muted" style={{ fontSize: ".74rem" }}>{mine ? "Votre proposition" : "Proposition"}</span>
                    <span className={`pill ${m.offerStatus === "acceptee" ? "pill-green" : m.offerStatus === "refusee" ? "pill-brick" : m.offerStatus === "retiree" ? "" : "pill-ochre"}`}>
                      {m.offerStatus === "acceptee" ? "Acceptée" : m.offerStatus === "refusee" ? "Refusée" : m.offerStatus === "retiree" ? "Retirée" : "En attente"}
                    </span>
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", fontWeight: 700, color: "var(--accent)", lineHeight: 1.2 }}>{formatEuros(m.offerAmount)}</div>
                  {m.offerStatus === "en_attente" && !isBuyer && !mine && (
                    <div className="row" style={{ marginTop: 6, gap: 6 }}>
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => answerOffer(m, "acceptee")}>Accepter</button>
                      <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => answerOffer(m, "refusee")}>Refuser</button>
                    </div>
                  )}
                  {m.offerStatus === "en_attente" && isBuyer && mine && <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} disabled={busy} onClick={() => answerOffer(m, "retiree")}>Retirer</button>}
                  {/* Proposition acceptée encore valable (AUDIT §60) : l'acheteur paie CE prix, comme sur leboncoin */}
                  {m.offerStatus === "acceptee" && conv.acceptedOffer?.id === m.id && !saleOpen && (isBuyer ? (
                    <>
                      <Link href={`/annonces/${conv.listing?.id}?acheter=1`} className="btn btn-primary btn-sm btn-block" style={{ marginTop: 8 }} data-testid="offer-pay">Payer {formatEuros(m.offerAmount)}</Link>
                      <div className="small muted" style={{ marginTop: 4, fontSize: ".72rem" }}>Prix valable jusqu&apos;au {formatDateTime(conv.acceptedOffer.expiresAt)}</div>
                    </>
                  ) : (
                    <div className="small muted" style={{ marginTop: 4, fontSize: ".74rem" }} data-testid="offer-waiting">En attente du paiement de l&apos;acheteur</div>
                  ))}
                </div>
              ) : (
                <>
                  <div style={bubble}>{m.content}</div>
                  {!mine && m.meta?.warning && (
                    <div className="alert alert-warning small" role="alert" data-testid="scam-warning" style={{ margin: "6px 0 0", padding: "8px 10px" }}>
                      {m.meta.warning === "lien_externe" ? "Ce message contient un lien vers un autre site. Ne suivez pas de lien pour payer : le paiement se fait uniquement sur Trocoin." : m.meta.warning === "coordonnees_bancaires" ? "Ce message contient des coordonnées bancaires. Ne faites jamais de virement ni ne donnez vos coordonnées : payez uniquement via Trocoin." : "Ce message évoque un paiement en dehors de Trocoin. Refusez : seul le paiement sécurisé du site vous protège."}
                    </div>
                  )}
                </>
              )}
              <div className="small muted" style={{ textAlign: mine ? "right" : "left", marginTop: 2, fontSize: ".72rem" }}>
                <span suppressHydrationWarning>{formatDateTime(m.createdAt)}</span>
                {mine && index === lastMineIndex && (
                  <span data-testid="read-status" style={{ marginLeft: 6, fontWeight: 600, color: m.readAt ? "var(--accent-dark)" : undefined }}>
                    {m.readAt ? `· Vu à ${new Date(m.readAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "· Envoyé"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {otherTyping && (
          <div role="status" aria-live="polite" className="small muted" data-testid="typing-indicator" style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", padding: "6px 10px", background: "var(--white)", border: "1px solid var(--line-soft)", borderRadius: 14 }}>
            <span className="typing-dots" aria-hidden="true"><span /><span /><span /></span>
            {conv.other?.displayName ?? "Votre interlocuteur"} est en train d&apos;écrire…
          </div>
        )}
      </div>

      <footer style={{ padding: 12, borderTop: "1px solid var(--line-soft)", background: "var(--white)" }}>
        {conv.blocked ? (
          <p className="muted small" style={{ margin: 0, textAlign: "center" }}>Vous ne pouvez plus échanger avec cet utilisateur.</p>
        ) : (
          <>
            {!saleOpen && (
              <div style={{ marginBottom: 8 }}>
                <Disclosure testId="quick-replies" icon={<span>💬</span>} label="Réponses rapides" summary={`${conv.quickReplies.length} phrases prêtes à envoyer`}>
                  <div className="row" style={{ gap: 6 }}>
                    {conv.quickReplies.map((q) => (
                      <button key={q} type="button" className="pill pill-phrase" onClick={() => send(q)}>{q.replace(/ ([?!:;])/g, "\u00a0$1")}</button>
                    ))}
                  </div>
                </Disclosure>
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="row conv-composer" style={{ flexWrap: "nowrap" }}>
              <label className="btn btn-outline btn-sm" title="Envoyer une photo" style={{ flexShrink: 0 }}>
                <span aria-hidden="true">📷</span><span className="sr-only">Envoyer une photo</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { if (e.target.files?.[0]) sendImage(e.target.files[0]); e.target.value = ""; }} />
              </label>
              {isBuyer && !saleOpen && conv.listing?.status === "en_ligne" && (
                <button type="button" className="btn btn-outline btn-sm" style={{ flexShrink: 0 }} onClick={() => setOfferOpen(true)} title="Proposer un prix" aria-label="Proposer un prix"><span aria-hidden="true">💶</span><span className="conv-offer-label"> Proposer un prix</span></button>
              )}
              <input className="input" style={{ flex: 1, minWidth: 0 }} value={text} onChange={(e) => { setText(e.target.value); signalTyping(e.target.value.length > 0); }} placeholder="Votre message…" maxLength={2000} aria-label="Message" />
              <button className="btn btn-primary conv-send" type="submit" disabled={!text.trim()} aria-label="Envoyer"><span className="conv-send-label">Envoyer</span><svg className="conv-send-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg></button>
            </form>
          </>
        )}
      </footer>

      {lightbox && (
        <div role="dialog" aria-modal="true" aria-label="Photo agrandie" onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.9)", zIndex: 300, display: "grid", placeItems: "center", cursor: "zoom-out" }}>
          <button type="button" autoFocus className="btn btn-outline btn-sm" onClick={() => setLightbox(null)} onKeyDown={(e) => { if (e.key === "Escape") setLightbox(null); }} style={{ position: "fixed", top: 16, right: 16, background: "var(--white)" }}>Fermer ✕</button>
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

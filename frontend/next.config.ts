import type { NextConfig } from "next";

// Politique de sécurité du contenu (AUDIT §69) : scripts et styles du site seulement, connexions vers l'API (HTTP et
// WebSocket) et Sentry, images de partout en HTTPS (photos sur l'API ou le stockage objet, tuiles de carte), jamais de
// cadre tiers ni d'envoi de formulaire ailleurs. `unsafe-inline` reste nécessaire aux scripts d'hydratation de Next.js.
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const WS = API.replace(/^http/, "ws");
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http://localhost:*",
  "font-src 'self' data:",
  `connect-src 'self' ${API} ${WS} https://*.sentry.io https://*.ingest.sentry.io`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "3000", pathname: "/uploads/**" },
      { protocol: "https", hostname: "**", pathname: "/uploads/**" },
    ],
  },
  async redirects() {
    // L'ancienne adresse Vercel ne doit plus vivre à part : redirection permanente vers le domaine
    // (trocoin.fr → www.trocoin.fr est géré par Vercel au niveau du domaine)
    return [{ source: "/:path*", has: [{ type: "host", value: "trocoin.vercel.app" }], destination: "https://www.trocoin.fr/:path*", permanent: true }];
  },
  async headers() {
    return [
      {
        // Le back-office ne doit jamais être indexé
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

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
        ],
      },
    ];
  },
};

export default nextConfig;

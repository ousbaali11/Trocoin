# ---------- Étape 1 : build (dépendances complètes + compilation TypeScript) ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
# sqlite3 est compilé nativement mais n'est pas utilisé en production (Postgres) :
# on l'installe quand même pour satisfaire le lockfile, puis il est retiré de l'image finale.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --legacy-peer-deps --no-audit --no-fund \
  && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Étape 2 : dépendances de production uniquement ----------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund \
  && npm uninstall --no-save sqlite3 @electric-sql/pglite @electric-sql/pglite-socket 2>/dev/null || true \
  && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# ---------- Étape 3 : image finale minimale ----------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r trocoin && useradd -r -g trocoin -d /app trocoin \
  && mkdir -p /app/uploads /app/data && chown -R trocoin:trocoin /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER trocoin
EXPOSE 3000
# Le schéma est appliqué par les migrations au démarrage (migrationsRun en production).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

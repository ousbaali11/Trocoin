# Architecture technique
## Plateforme de petites annonces — France

---

## 1. Stack technique recommandée

| Couche | Choix | Pourquoi |
|---|---|---|
| Web front-end | Next.js (React) + TypeScript | SEO indispensable pour des pages d'annonces indexables, rendu hybride SSR/ISR |
| App mobile | React Native (ou Flutter) | Un seul code pour iOS + Android, cohérence avec le web si React Native |
| Backend API | NestJS (Node.js/TypeScript) | Structure modulaire, typé, bon écosystème pour API REST/GraphQL |
| Base de données | PostgreSQL + extension PostGIS | Relationnel robuste + requêtes géospatiales (recherche par rayon km) |
| Moteur de recherche | Elasticsearch ou Algolia | Filtres combinés, recherche full-text tolérante aux fautes, réponse < 300ms |
| Cache / files d'attente | Redis + BullMQ | Sessions, rate-limiting, jobs asynchrones (envoi SMS, notifications, indexation) |
| Stockage fichiers | S3 (ou OVH Object Storage, souverain) | Photos d'annonces, avatars, documents de vérification |
| Paiement | Stripe Connect | Paiement + séquestre + reversement vendeur, conforme PCI-DSS |
| SMS OTP | Vonage, Twilio ou OVH SMS | Vérification obligatoire des numéros +33 |
| Notifications push | Firebase Cloud Messaging | iOS + Android + web push |
| Hébergement | AWS ou OVHcloud (souveraineté des données françaises) | Conformité RGPD facilitée avec hébergeur français/européen |
| CDN | Cloudflare | Images, cache statique, protection DDoS |
| Observabilité | Grafana + Prometheus, Sentry | Monitoring, alerting, suivi d'erreurs |

---

## 2. Vue d'ensemble de l'architecture

```
┌─────────────┐     ┌──────────────┐
│   Web App   │     │  Mobile App  │
│  (Next.js)  │     │(React Native)│
└──────┬──────┘     └──────┬───────┘
       │                   │
       └─────────┬─────────┘
                  │ HTTPS/REST+GraphQL
          ┌───────▼────────┐
          │   API Gateway   │  (auth, rate-limit, routing)
          └───────┬────────┘
                  │
   ┌──────────────┼───────────────────────┬───────────────┐
   │              │                       │               │
┌──▼───┐   ┌──────▼──────┐        ┌───────▼──────┐  ┌─────▼─────┐
│ Auth │   │  Annonces   │        │  Messagerie  │  │  Paiement │
│ svc  │   │    svc      │        │  svc (WS)    │  │    svc    │
└──┬───┘   └──────┬──────┘        └───────┬──────┘  └─────┬─────┘
   │              │                       │               │
   │       ┌──────▼──────┐         ┌──────▼──────┐        │
   │       │Elasticsearch│         │    Redis    │        │
   │       └─────────────┘         │  (pub/sub)  │        │
   │                                └─────────────┘        │
   └──────────────┬───────────────────────────────────────┘
                  │
           ┌──────▼───────┐
           │  PostgreSQL  │ (+ PostGIS)
           └──────────────┘

Services externes : Vonage/Twilio (OTP SMS), Stripe Connect (paiement),
Mondial Relay/Colissimo API (livraison), Firebase (push), S3 (stockage photos)
```

Architecture en microservices découplés (ou "modulith" NestJS en V1 pour aller vite, avec extraction en microservices quand le trafic le justifie). Communication interne via API interne + files d'attente pour les tâches asynchrones (envoi SMS, indexation recherche, notifications).

---

## 3. Modèle de données (schéma relationnel simplifié)

```sql
-- Utilisateurs
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) NOT NULL UNIQUE,     -- doit matcher ^\+33[67]\d{8}$
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email VARCHAR(255) UNIQUE,
  password_hash TEXT,
  display_name VARCHAR(100) NOT NULL,
  avatar_url TEXT,
  account_type VARCHAR(20) NOT NULL DEFAULT 'particulier', -- particulier | professionnel | admin
  city VARCHAR(100),
  postal_code VARCHAR(10),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  rating_avg NUMERIC(2,1) DEFAULT 0,
  rating_count INT DEFAULT 0,
  identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  suspended_at TIMESTAMPTZ
);

-- Vérification téléphone (OTP)
CREATE TABLE phone_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) NOT NULL,
  otp_code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catégories (arborescence)
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  parent_id INT REFERENCES categories(id),
  slug VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(50),
  sort_order INT DEFAULT 0
);

-- Annonces
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  category_id INT NOT NULL REFERENCES categories(id),
  title VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(10,2),
  price_type VARCHAR(20) DEFAULT 'fixe',   -- fixe | negociable | gratuit | echange | sur_demande
  condition VARCHAR(30),                    -- neuf | tres_bon_etat | bon_etat | pour_pieces
  status VARCHAR(20) NOT NULL DEFAULT 'en_attente', -- en_attente | en_ligne | vendue | refusee | expiree | desactivee
  attributes JSONB,                          -- champs dynamiques par catégorie (kilométrage, surface...)
  city VARCHAR(100),
  postal_code VARCHAR(10),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  boosted_until TIMESTAMPTZ,
  views_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_listings_geo ON listings USING GIST (
  ll_to_earth(latitude, longitude)
);

-- Photos d'annonce
CREATE TABLE listing_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INT DEFAULT 0
);

-- Favoris
CREATE TABLE favorites (
  user_id UUID NOT NULL REFERENCES users(id),
  listing_id UUID NOT NULL REFERENCES listings(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

-- Conversations & messages
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  sender_id UUID NOT NULL REFERENCES users(id),
  content TEXT,
  attachment_url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactions / paiements
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(10,2) NOT NULL,
  commission NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'en_attente', -- en_attente | sequestre | livre | confirme | litige | rembourse
  stripe_payment_intent_id VARCHAR(100),
  delivery_tracking_number VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Avis
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  reviewer_id UUID NOT NULL REFERENCES users(id),
  reviewed_id UUID NOT NULL REFERENCES users(id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Signalements / modération
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id),
  listing_id UUID REFERENCES listings(id),
  reported_user_id UUID REFERENCES users(id),
  reason VARCHAR(50) NOT NULL,
  details TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ouvert', -- ouvert | traite | rejete
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recherches sauvegardées / alertes
CREATE TABLE saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  query JSONB NOT NULL,   -- filtres sérialisés
  notify_email BOOLEAN DEFAULT TRUE,
  notify_push BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 4. API — principaux endpoints (REST)

```
POST   /auth/register/phone            # démarre inscription, vérifie format +33
POST   /auth/otp/verify                # valide le code OTP reçu par SMS
POST   /auth/login
GET    /users/me
PATCH  /users/me

GET    /categories

POST   /listings                       # créer une annonce
GET    /listings?category=&q=&lat=&lng=&radius=&price_min=&price_max=&sort=
GET    /listings/:id
PATCH  /listings/:id
DELETE /listings/:id
POST   /listings/:id/boost

POST   /listings/:id/favorite
DELETE /listings/:id/favorite

GET    /conversations
POST   /conversations
GET    /conversations/:id/messages
POST   /conversations/:id/messages     # + WebSocket pour le temps réel

POST   /transactions                   # initier paiement séquestre
POST   /transactions/:id/confirm-delivery
POST   /transactions/:id/dispute

POST   /reviews
POST   /reports

GET    /admin/moderation/queue
POST   /admin/moderation/:listingId/approve
POST   /admin/moderation/:listingId/reject
```

---

## 5. Vérification téléphone français — flux détaillé

1. L'utilisateur saisit son numéro → validation regex côté client et serveur : `^\+33[67]\d{8}$` (tout autre indicatif est rejeté immédiatement, avec message explicite)
2. Le backend génère un OTP à 6 chiffres, le hash et le stocke avec expiration (5 min), puis appelle le provider SMS (Vonage/Twilio/OVH)
3. L'utilisateur saisit le code ; le backend compare le hash, limite les tentatives (5 max), invalide après succès
4. `phone_verified = true` ; seul un compte vérifié peut publier une annonce ou contacter un vendeur

---

## 6. Sécurité

- Authentification JWT (access court + refresh token), rotation des tokens
- Rate limiting par IP/utilisateur sur les endpoints sensibles (OTP, messagerie, dépôt d'annonce)
- Modération automatique : filtre de mots-clés + classification d'image (détection nudité/violence/contrefaçon) avant mise en ligne
- Chiffrement au repos (RDS/S3) et en transit (TLS 1.3)
- Journalisation et alerting sur activités suspectes (multi-comptes, faux OTP répétés)

---

## 7. Scalabilité & infrastructure

- Conteneurisation Docker + orchestration Kubernetes (ou ECS Fargate si AWS)
- Auto-scaling horizontal sur les services API et recherche
- Cache Redis pour les listes d'annonces populaires et sessions
- File de tâches asynchrones (BullMQ) pour : envoi SMS/email, indexation Elasticsearch, génération de miniatures photo, notifications push
- Réplication PostgreSQL (lecture/écriture séparées) à mesure que le trafic augmente

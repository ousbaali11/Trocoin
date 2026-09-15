# Audit bugs, erreurs et sécurité — 15 septembre 2026

Méthode : parcours de chaque page en mobile 375 px, connecté et non connecté, avec relevé des
erreurs de console, des exceptions et des requêtes en échec (script Playwright `audit-console`),
revue du code d'authentification, des variables exposées au navigateur, de la validation côté
serveur et de la protection des routes, puis relecture des boutons et liens visibles.

Gravité : **haute** (données, sécurité, fonction cassée) · **moyenne** (parcours dégradé) ·
**basse** (confort, cohérence).

## Bugs trouvés et corrigés dans ce tour

| # | Description | Gravité | Page(s) | Statut |
|---|---|---|---|---|
| 1 | La règle `.page { padding: 28px 0 64px }` écrasait le remplissage horizontal de `.container` : tout le contenu des pages « page » touchait les bords sur mobile (titres, cartes, champs, boutons). | haute | toutes les pages du compte, recherche, dépôt, pages légales | corrigé (variable `--page-padding-x`, `padding-block`) |
| 2 | Bandeau d'onglets du compte : premier et dernier onglets coupés par les bords, aucune marge de fin. | moyenne | espace compte (mobile) | corrigé (bandeau pleine largeur avec remplissage et espace de fin) |
| 3 | Tableau « Mes dernières annonces » (4 colonnes) débordait de sa carte sur mobile. | moyenne | tableau de bord | corrigé (liste empilable) |
| 4 | Matrice des préférences de notification (5 colonnes) provoquait un défilement horizontal de la page. | moyenne | paramètres | corrigé (liste d'évènements, canaux sur une ligne qui s'enroule) |
| 5 | « Toute la France » choisi dans le sélecteur de localisation n'apparaissait pas dans le champ (la recherche, elle, était correcte). | moyenne | accueil, filtres | corrigé |
| 6 | Réponse 429 du limiteur de débit renvoyée avec le libellé technique `ThrottlerException: Too Many Requests`, affiché tel quel à l'utilisateur. | basse | tout le site (API) | corrigé (message en français) |
| 7 | Notes de travail visibles dans les textes légaux (« Modèle à faire valider par un conseil juridique… », « Modèle à compléter… »). | basse | CGU, confidentialité | corrigé (retirées ; les mentions légales gardent des champs entre crochets à compléter par l'éditeur, voir « Reste à faire ») |
| 8 | Centre d'aide périmé : « l'envoi d'e-mails n'est pas encore activé », connexion sans le numéro de mobile, jargon « back-office ». | basse | centre d'aide | corrigé |
| 9 | Images d'annonce introuvables (photos d'avant le stockage R2) affichées comme image cassée avec le texte alternatif. | basse | cartes d'annonce | corrigé le 15 septembre matin (repli « Pas de photo ») |
| 10 | JSON-LD (données structurées) injecté par `JSON.stringify` sans neutraliser `<` : un titre d'annonce contenant `</script>` pouvait fermer la balise et injecter du code dans la page. | haute | fiche annonce, accueil | corrigé (`<` remplacé par la séquence JSON `\u003c` avant insertion) |
| 11 | Connexion : seuls l'e-mail et le nom d'utilisateur étaient acceptés alors que le compte est défini par le mobile ; aucun contrôle de format avant l'envoi. | moyenne | connexion | corrigé (mobile accepté, format vérifié) |
| 12 | Découvert en cascade : après la restauration des marges, la zone de résultats est passée de 1180 à 1140 px et la grille retombait à 4 colonnes de 200 px (cartes de 342 px de haut, seuil du test 340). | basse | recherche (bureau) | corrigé (grille `minmax(150px)`, 5 colonnes) |
| 13 | Découvert en cascade : le fondu d'ouverture des boîtes de dialogue (opacité 0 → 1) faisait mesurer par axe un contraste insuffisant pendant l'animation, en CI seulement. | basse | boîte « Sauvegarder cette recherche » | corrigé (animations en glissement seul, sans opacité) |
| 14 | Découvert en cascade : première version du durcissement JSON-LD écrite avec un seul antislash (`"<"`), soit le caractère `<` lui-même, donc sans effet ; corrigé pour émettre la séquence littérale. | haute | fiche annonce, accueil | corrigé (vérifié par lecture du source : `.replace(/</g, "\u003c")`) |
| 15 | Messages par défaut de NestJS et de class-validator en anglais (« Unauthorized », « Not Found », « identifier must be longer than… ») possibles si un client contourne le formulaire. | basse | API | corrigé (traduction globale dans le filtre d'exceptions et la validation) |

## Vérifications de sécurité (état constaté)

| Point | Constat | Statut |
|---|---|---|
| Mots de passe | scrypt (N = 2^15, sel 16 octets), colonne `passwordHash` jamais sélectionnée par défaut (`select: false`), comparaison en temps constant, message unique « Identifiant ou mot de passe incorrect » (pas d'énumération). | conforme |
| Secrets côté navigateur | Seules variables `NEXT_PUBLIC_*` : `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`. Aucune clé Stripe, Resend ou R2 dans le code du front. Le paiement passe par Stripe Checkout hébergé : aucune clé publiable nécessaire, la clé secrète et le secret de webhook ne sont lus que par l'API. | conforme |
| Validation côté serveur | `ValidationPipe({ whitelist: true, transform: true })` global, DTO class-validator sur chaque route, requêtes SQL paramétrées (TypeORM, `escapeLike` sur les motifs). | conforme |
| Injection HTML | Les pages légales et l'aide passent par `renderMarkdown`, qui échappe `& < > "` avant le rendu ; aucune autre utilisation de `dangerouslySetInnerHTML` avec du contenu utilisateur (JSON-LD durci, voir bug 10). | conforme |
| Routes privées | Toutes les routes mutatives portent `JwtAuthGuard` (et `ListingOwnerGuard` / `AdminGuard` selon le cas), sauf les neuf routes publiques attendues : inscription, OTP, connexion, mot de passe oublié / réinitialisation, refresh, logout, webhook Stripe (signé). Les pages `/compte/*` et `/admin` redirigent sans session (scénarios 03 et 06). | conforme |
| Messages d'erreur | Filtre global : 500 génériques (« Erreur interne. Réessayez plus tard. »), aucune trace ni requête SQL dans les réponses ; erreurs multer et CORS traduites. | conforme |
| En-têtes HTTP | Helmet (CSP en production, HSTS, nosniff, frame-options), CORS restreint à l'origine du front, `TRUST_PROXY` pour la vraie IP derrière Render. | conforme |
| Limite de débit | 100 req/min/IP globalement, limites plus strictes sur connexion, OTP, dépôt, upload, signalement. | conforme |

## Console et réseau, page par page (relevé du 15 septembre, mobile 375 px)

29 pages parcourues (15 publiques dont une inexistante et une annonce introuvable, 14 connectées
dont la console d'administration avec un compte non administrateur). Résultat :

- **0 exception JavaScript**, **0 erreur de console** sur les pages existantes ;
- les seules requêtes en échec sont les 404 attendues (page inexistante, annonce introuvable), qui
  affichent la page « Introuvable » du site et non une erreur brute ;
- aucune requête réseau ne reste sans réponse ni n'échoue silencieusement (les données absentes
  affichent un message : « Aucune annonce », « Aucun favori », « Aucune transaction »…) ;
- boutons et liens : chaque bouton visible est relié à une action (les filtres, onglets, tris et
  actions de compte sont couverts par les 56 scénarios navigateur) ; le relevé automatique ne
  signale que des boutons dont l'action est un gestionnaire React (donc invisible dans le DOM),
  tous vérifiés manuellement fonctionnels.

Le relevé est rejouable : script `audit-console` (Playwright) à lancer contre l'API et le front
locaux.

## Reste à faire (hors de portée de ce tour)

- **Mentions légales** : les champs entre crochets (raison sociale, RCS, siège, directeur de la
  publication, hébergeur, médiateur, contact) doivent être remplis par l'éditeur ; ils sont
  modifiables sans déploiement depuis la console d'administration → Pages.
- **Textes légaux** : relecture par un juriste avant ouverture publique (décision déjà actée).
- **Domaine Resend** : tant qu'aucun domaine n'est vérifié, seule l'adresse du compte Resend
  reçoit les e-mails.

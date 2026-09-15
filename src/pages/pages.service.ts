import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LegalPage } from './legal-page.entity';

export const DEFAULT_PAGES: Array<Pick<LegalPage, 'slug' | 'title' | 'content'>> = [
  {
    slug: 'cgu',
    title: "Conditions générales d'utilisation",
    content: `_Dernière mise à jour : septembre 2026._

## 1. Objet
Trocoin met à disposition une plateforme de mise en relation entre vendeurs et acheteurs de biens et services, à destination des personnes physiques et morales situées en France. Trocoin n'est pas partie aux transactions conclues entre membres, sauf dans le cadre du service de paiement sécurisé décrit à l'article 6.

## 2. Inscription
L'inscription requiert un numéro de téléphone mobile français (+33 6 ou +33 7), une adresse e-mail et un mot de passe. Un seul compte par numéro de mobile ; Trocoin peut demander à tout moment une vérification de ce numéro par code SMS. L'utilisateur doit être majeur ou disposer de l'autorisation de son représentant légal. Les professionnels doivent renseigner un SIRET valide.

## 3. Contenu des annonces
L'utilisateur est seul responsable du contenu publié. Les annonces doivent être rédigées en français, décrire fidèlement le bien, être classées dans la bonne catégorie et localisées au lieu réel du bien. Sont interdits : les armes, le tabac et les produits de vapotage, les médicaments et stupéfiants, les contrefaçons, les documents officiels, les espèces protégées, les contenus à caractère sexuel, les offres de crédit ou d'investissement, ainsi que tout bien ou service dont la vente est interdite par la loi française.

## 4. Modération
Trocoin peut, sans préavis, mettre en attente, refuser, retirer une annonce ou suspendre un compte en cas de manquement aux présentes conditions ou de signalement fondé. L'utilisateur est informé du motif et peut contester via le centre d'aide.

## 5. Messagerie
La messagerie est réservée aux échanges relatifs aux annonces. Tout démarchage, harcèlement ou tentative de fraude entraîne la suspension du compte.

## 6. Paiement sécurisé
Le service de paiement sécurisé est opéré par un prestataire de services de paiement agréé. Les fonds de l'acheteur sont bloqués jusqu'à confirmation de réception ou, à défaut, jusqu'à décision du service de médiation. Les frais applicables sont affichés avant validation du paiement.

## 7. Avis
Les avis ne peuvent être déposés qu'après une transaction sécurisée confirmée. Ils doivent rester factuels et courtois.

## 8. Données personnelles
Le traitement des données est décrit dans la politique de confidentialité. L'utilisateur dispose d'un droit d'accès, de rectification, de portabilité et de suppression exerçable depuis ses paramètres.

## 9. Responsabilité
Trocoin agit en qualité d'hébergeur et ne garantit ni la qualité des biens ni la bonne exécution des transactions conclues hors du service de paiement sécurisé.

## 10. Droit applicable
Les présentes conditions sont soumises au droit français. Le consommateur peut recourir gratuitement au médiateur de la consommation désigné dans les mentions légales.`,
  },
  {
    slug: 'confidentialite',
    title: 'Politique de confidentialité',
    content: `_Dernière mise à jour : septembre 2026._

## Données collectées
- **Compte** : numéro de mobile, adresse e-mail, nom d'utilisateur, prénom et nom, mot de passe (haché, jamais lisible), ville et code postal, photo de profil facultative, raison sociale et SIRET pour les professionnels.
- **Annonces** : textes, photos, prix, localisation approximative.
- **Échanges** : messages de la messagerie interne, signalements.
- **Transactions** : montants, statuts, identifiants de paiement (les données de carte ne transitent jamais par Trocoin).
- **Technique** : adresse IP et journaux de sécurité.

## Finalités et bases légales
Exécution du contrat, obligation légale (conservation des transactions, lutte contre la fraude), intérêt légitime (sécurité, modération), consentement (notifications).

## Durées de conservation
Données de compte : jusqu'à suppression du compte, puis anonymisation immédiate. Codes de vérification (SMS, réinitialisation de mot de passe) : de 5 minutes à 1 heure. Journaux de sécurité : 12 mois. Transactions : 10 ans.

## Vos droits
Accès, rectification, portabilité (export depuis vos paramètres), effacement (suppression de compte), opposition et limitation. Réclamation possible auprès de la CNIL.

## Cookies
Trocoin utilise uniquement un stockage local strictement nécessaire (jeton de session). Aucun cookie publicitaire ou de mesure d'audience tiers n'est déposé.`,
  },
  {
    slug: 'mentions-legales',
    title: 'Mentions légales',
    content: `## Éditeur
[Raison sociale] — [forme juridique, capital] — RCS [ville] [numéro] — Siège social : [adresse] — Directeur de la publication : [nom].

## Hébergement
[Hébergeur, adresse] — serveurs et base de données hébergés dans l'Union européenne.

## Médiation de la consommation
Conformément aux articles L.611-1 et suivants du Code de la consommation, le consommateur peut recourir gratuitement au médiateur suivant : [nom et coordonnées].

## Contact
Via le centre d'aide ou à l'adresse [contact@…].

## Propriété intellectuelle
La marque, le logo et l'interface Trocoin sont protégés. Les contenus des annonces restent la propriété de leurs auteurs.`,
  },
  {
    slug: 'a-propos',
    title: 'À propos',
    content: `## Des annonces entre voisins, sans complication
Trocoin est né d'un constat simple : vendre un objet devrait prendre deux minutes, et acheter devrait se faire sans crainte. Nous avons construit une plateforme d'annonces généraliste, réservée aux personnes joignables sur un numéro de mobile français, avec les outils qui comptent vraiment : une messagerie intégrée, un paiement sécurisé avec fonds bloqués, des avis après chaque vente et une modération humaine.

## Nos engagements
- **Gratuit pour les particuliers.** Déposer une annonce ne coûte rien.
- **Transparent.** Les frais éventuels sont affichés avant chaque paiement, jamais après.
- **Respectueux de vos données.** Conformité RGPD, export et suppression de compte en un clic, aucun traceur publicitaire.
- **Responsable.** Liste noire des objets interdits, vérification des annonces sensibles, signalement en un geste.`,
  },
];

@Injectable()
export class PagesService implements OnModuleInit {
  constructor(@InjectRepository(LegalPage) private repo: Repository<LegalPage>) {}

  /**
   * Amorce les pages manquantes et remet à jour celles qui n'ont jamais été
   * éditées depuis le back-office (updatedBy vide) : le texte par défaut du
   * code fait foi tant qu'un administrateur ne l'a pas repris.
   */
  async onModuleInit() {
    for (const p of DEFAULT_PAGES) {
      const existing = await this.repo.findOne({ where: { slug: p.slug } });
      if (!existing) {
        await this.repo.save(this.repo.create(p));
      } else if (!existing.updatedBy && (existing.title !== p.title || existing.content !== p.content)) {
        await this.repo.update(p.slug, { title: p.title, content: p.content });
      }
    }
  }

  list() {
    return this.repo.find({ order: { slug: 'ASC' } });
  }

  async get(slug: string, includeUnpublished = false) {
    const page = await this.repo.findOne({ where: { slug } });
    if (!page || (!page.published && !includeUnpublished)) throw new NotFoundException('Page introuvable.');
    return page;
  }

  async update(slug: string, patch: Partial<Pick<LegalPage, 'title' | 'content' | 'published'>>, updatedBy: string) {
    const page = await this.repo.findOne({ where: { slug } });
    if (!page) {
      if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new NotFoundException('Page introuvable.');
      return this.repo.save(this.repo.create({ slug, title: patch.title || slug, content: patch.content || '', published: patch.published ?? true, updatedBy }));
    }
    await this.repo.update(slug, { ...patch, updatedBy });
    return this.get(slug, true);
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldSchema, getSchemaForSlugs } from './category-schemas';
import { Category } from './category.entity';
import { Listing } from '../listings/listing.entity';

interface SeedNode {
  slug: string;
  name: string;
  icon?: string;
  /** Anciens slugs à renommer vers ce nœud (migration de données). */
  renameFrom?: string[];
  children?: Array<{ slug: string; name: string; renameFrom?: string[] }>;
}

/**
 * Arborescence de référence (brief phase 2, §4). Ordre = ordre d'affichage.
 * Les slugs existants sont conservés pour ne pas casser les URL et les
 * annonces ; seuls les libellés changent (ex. 'multimedia' → « Électronique »).
 */
export const SEED_TREE: SeedNode[] = [
  { slug: 'immobilier', name: 'Immobilier', icon: 'home', children: [
    { slug: 'ventes-immobilieres', name: 'Ventes immobilières' },
    { slug: 'locations', name: 'Locations' },
    { slug: 'colocations', name: 'Colocations' },
    { slug: 'bureaux-commerces', name: 'Bureaux & commerces' },
    { slug: 'terrains', name: 'Terrains' },
  ] },
  { slug: 'vehicules', name: 'Véhicules', icon: 'car', children: [
    { slug: 'voitures', name: 'Voitures' },
    { slug: 'motos', name: 'Motos' },
    { slug: 'caravaning', name: 'Caravaning' },
    { slug: 'utilitaires', name: 'Utilitaires' },
    { slug: 'nautisme', name: 'Nautisme' },
    { slug: 'pieces-auto', name: 'Équipement & pièces auto' },
  ] },
  { slug: 'materiel-professionnel', name: 'Matériel pro', icon: 'wrench', children: [
    { slug: 'btp', name: 'BTP & chantier' },
    { slug: 'agricole', name: 'Matériel agricole' },
    { slug: 'restauration-hotellerie', name: 'Restauration & hôtellerie' },
    { slug: 'fournitures-bureau', name: 'Fournitures de bureau' },
  ] },
  { slug: 'emploi', name: 'Emploi', icon: 'briefcase', children: [
    { slug: 'offres-emploi', name: "Offres d'emploi" },
    { slug: 'formations', name: 'Formations professionnelles' },
  ] },
  { slug: 'mode', name: 'Mode', icon: 'shirt', children: [
    { slug: 'vetements', name: 'Vêtements' },
    { slug: 'chaussures', name: 'Chaussures' },
    { slug: 'accessoires-bagagerie', name: 'Accessoires & bagagerie' },
    { slug: 'montres-bijoux', name: 'Montres & bijoux' },
  ] },
  { slug: 'maison-jardin', name: 'Maison & Jardin', icon: 'sofa', children: [
    { slug: 'ameublement', name: 'Ameublement' },
    { slug: 'electromenager', name: 'Électroménager' },
    { slug: 'decoration', name: 'Décoration & arts de la table' },
    { slug: 'bricolage', name: 'Bricolage' },
    { slug: 'jardinage', name: 'Jardin & plantes' },
  ] },
  { slug: 'famille', name: 'Famille', icon: 'baby', children: [
    { slug: 'puericulture', name: 'Puériculture' },
    { slug: 'mobilier-bebe', name: 'Mobilier bébé & enfant' },
    { slug: 'vetements-bebe', name: 'Vêtements bébé' },
  ] },
  { slug: 'multimedia', name: 'Électronique', icon: 'smartphone', children: [
    { slug: 'telephonie', name: 'Téléphonie' },
    { slug: 'informatique', name: 'Informatique' },
    { slug: 'consoles-jeux-video', name: 'Consoles & jeux vidéo' },
    { slug: 'image-son', name: 'Image & son' },
  ] },
  { slug: 'loisirs', name: 'Loisirs', icon: 'gamepad', children: [
    { slug: 'livres', name: 'Livres' },
    { slug: 'musique-instruments', name: 'Musique & instruments' },
    { slug: 'sports-hobbies', name: 'Sports & hobbies' },
    { slug: 'velos', name: 'Vélos' },
    { slug: 'jeux-jouets', name: 'Jeux & jouets' },
    { slug: 'collection', name: 'Collection & antiquités' },
  ] },
  // Pas de sous-catégorie : le type d'hébergement, les caractéristiques et le
  // nombre de voyageurs sont des champs dynamiques (voir category-schemas.ts).
  { slug: 'vacances', name: 'Locations de vacances', icon: 'sun', children: [] },
  { slug: 'services', name: 'Services', icon: 'handshake', children: [
    { slug: 'demenagement', name: 'Services de déménagement' },
    { slug: 'reparations-mecaniques', name: 'Services de réparations mécaniques' },
    { slug: 'jardinerie-bricolage', name: 'Services de jardinerie & bricolage', renameFrom: ['travaux-artisans'] },
    { slug: 'services-a-la-personne', name: 'Services à la personne' },
    { slug: 'services-animaux', name: 'Services aux animaux' },
    { slug: 'baby-sitting', name: 'Baby-Sitting' },
    { slug: 'artistes-musiciens', name: 'Artistes & Musiciens' },
    { slug: 'evenementiel', name: 'Services évènementiels' },
    { slug: 'reparations-electroniques', name: 'Services de réparations électroniques' },
    { slug: 'entraide-voisins', name: 'Entraide entre voisins' },
    { slug: 'billetterie', name: 'Billetterie' },
    { slug: 'evenements', name: 'Évènements' },
    { slug: 'covoiturage', name: 'Covoiturage' },
    { slug: 'cours-particuliers', name: 'Cours particuliers' },
    { slug: 'autres-services', name: 'Autres services' },
  ] },
  { slug: 'animaux', name: 'Animaux', icon: 'paw', children: [
    { slug: 'animaux-vente-don', name: 'Animaux' },
    { slug: 'accessoires-animaux', name: 'Accessoires animaux' },
    { slug: 'animaux-perdus', name: 'Animaux perdus' },
    { slug: 'animaux-dons', name: 'Dons' },
    { slug: 'animaux-autres', name: 'Autres' },
  ] },
];

export interface CategoryNode extends Category {
  children: Category[];
}

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger('Categories');
  private cache?: Category[];

  constructor(
    @InjectRepository(Category) private categoriesRepo: Repository<Category>,
  ) {}

  async findAll(): Promise<Category[]> {
    if (!this.cache) {
      this.cache = await this.categoriesRepo.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
    }
    return this.cache;
  }

  async findTree(): Promise<CategoryNode[]> {
    const all = await this.findAll();
    const roots = all.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
    return roots.map((root) => ({
      ...root,
      children: all.filter((c) => c.parentId === root.id).sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }

  async findBySlug(slug: string): Promise<Category | null> {
    const all = await this.findAll();
    return all.find((c) => c.slug === slug) || null;
  }

  async findById(id: number): Promise<Category | null> {
    const all = await this.findAll();
    return all.find((c) => c.id === id) || null;
  }

  /** IDs de la catégorie et de toutes ses sous-catégories (pour filtrer une famille). */
  async idsIncludingChildren(slug: string): Promise<number[] | null> {
    const cat = await this.findBySlug(slug);
    if (!cat) return null;
    const all = await this.findAll();
    return [cat.id, ...all.filter((c) => c.parentId === cat.id).map((c) => c.id)];
  }

  async schemaFor(slug: string): Promise<{ category: Category; parent: Category | null; fields: FieldSchema[] }> {
    const category = await this.findBySlug(slug);
    if (!category) throw new NotFoundException('Catégorie inconnue.');
    const parent = category.parentId ? await this.findById(category.parentId) : null;
    return { category, parent, fields: getSchemaForSlugs(category.slug, parent?.slug) };
  }

  /**
   * Seed idempotent + migration : crée les nœuds manquants, met à jour les
   * libellés / l'ordre / le parent, renomme les anciens slugs (renameFrom) en
   * conservant l'id (donc les annonces rattachées), et rattache à la racine
   * les annonces des sous-catégories supprimées de la référence
   * (« Locations saisonnières » → « Locations de vacances »).
   */
  async seedIfNeeded(): Promise<void> {
    const existing = await this.categoriesRepo.find();
    const bySlug = new Map(existing.map((c) => [c.slug, c]));

    const ensure = async (slug: string, name: string, parentId: number | null, sortOrder: number, icon?: string, renameFrom: string[] = []) => {
      let node = bySlug.get(slug);
      if (!node) {
        const old = renameFrom.map((s) => bySlug.get(s)).find(Boolean);
        if (old) {
          await this.categoriesRepo.update(old.id, { slug, name, parentId: parentId ?? undefined, sortOrder, icon });
          bySlug.delete(old.slug);
          node = { ...old, slug, name, parentId: parentId ?? undefined, sortOrder, icon };
          bySlug.set(slug, node);
          this.logger.log(`Catégorie renommée : ${old.slug} → ${slug}`);
          return node;
        }
        node = await this.categoriesRepo.save(this.categoriesRepo.create({ slug, name, parentId: parentId ?? undefined, sortOrder, icon }));
        bySlug.set(slug, node);
        return node;
      }
      if (node.name !== name || node.sortOrder !== sortOrder || (node.parentId ?? null) !== parentId || (icon && node.icon !== icon)) {
        await this.categoriesRepo.update(node.id, { name, sortOrder, parentId: parentId ?? undefined, ...(icon ? { icon } : {}) });
        Object.assign(node, { name, sortOrder, parentId: parentId ?? undefined, ...(icon ? { icon } : {}) });
      }
      return node;
    };

    let order = 1;
    for (const rootDef of SEED_TREE) {
      const root = await ensure(rootDef.slug, rootDef.name, null, order++, rootDef.icon, rootDef.renameFrom);
      let childOrder = 1;
      const wanted = new Set<string>();
      for (const child of rootDef.children || []) {
        await ensure(child.slug, child.name, root.id, childOrder++, undefined, child.renameFrom);
        wanted.add(child.slug);
      }
      // Sous-catégories retirées de la référence pour cette famille : les
      // annonces sont rattachées à la racine, puis la sous-catégorie est supprimée.
      // (Seulement pour les familles dont la référence est fermée : Locations de vacances.)
      if (rootDef.slug === 'vacances') {
        const orphans = existing.filter((c) => c.parentId === root.id && !wanted.has(c.slug));
        for (const o of orphans) {
          const moved = await this.categoriesRepo.manager
            .createQueryBuilder()
            .update(Listing)
            .set({ categoryId: root.id })
            .where({ categoryId: o.id })
            .execute();
          await this.categoriesRepo.delete(o.id);
          this.logger.log(`Sous-catégorie ${o.slug} fusionnée dans ${root.slug} (${moved.affected ?? 0} annonce(s) déplacée(s)).`);
        }
      }
    }
    this.cache = undefined;
  }
}

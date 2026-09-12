import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './plan.entity';
import { Subscription } from './subscription.entity';
import { SystemSetting } from './system-setting.entity';

export const SETTING_KEYS = {
  MONETIZATION_ENABLED: 'monetization_enabled',
  FREE_LISTINGS_PER_30_DAYS: 'free_listings_per_30_days',
  BOOST_PRICE: 'boost_price_eur',
  URGENT_PRICE: 'urgent_price_eur',
} as const;

/** Plans par défaut (cahier des charges §3.7). Modifiables ensuite depuis le back-office. */
export const DEFAULT_PLANS: Array<Partial<Plan>> = [
  { slug: 'gratuit', name: 'Gratuit', description: 'Pour vendre occasionnellement.', priceMonthly: 0, listingsIncluded: 20, boostsIncluded: 0, advancedStats: false, verifiedBadge: false, customShop: false, sortOrder: 1 },
  { slug: 'boutique', name: 'Boutique', description: 'Pour les professionnels qui vendent régulièrement.', priceMonthly: 29, listingsIncluded: 100, boostsIncluded: 5, advancedStats: true, verifiedBadge: true, customShop: true, sortOrder: 2 },
  { slug: 'boutique-premium', name: 'Boutique Premium', description: 'Annonces illimitées, mises en avant incluses, statistiques avancées.', priceMonthly: 79, listingsIncluded: null, boostsIncluded: 20, advancedStats: true, verifiedBadge: true, customShop: true, sortOrder: 3 },
];

export interface Entitlements {
  monetizationEnabled: boolean;
  plan: Plan | null;
  /** null = illimité */
  listingsLimit: number | null;
  boostsLimit: number | null;
  boostPrice: number;
  urgentPrice: number;
  advancedStats: boolean;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger('Settings');
  private cache = new Map<string, unknown>();

  constructor(
    @InjectRepository(SystemSetting) private settingsRepo: Repository<SystemSetting>,
    @InjectRepository(Plan) private plansRepo: Repository<Plan>,
    @InjectRepository(Subscription) private subsRepo: Repository<Subscription>,
  ) {}

  async onModuleInit() {
    await this.seedIfNeeded();
    await this.reload();
  }

  async seedIfNeeded() {
    const defaults: Record<string, unknown> = {
      [SETTING_KEYS.MONETIZATION_ENABLED]: false,
      [SETTING_KEYS.FREE_LISTINGS_PER_30_DAYS]: Number(process.env.FREE_LISTINGS_PER_30_DAYS || 20),
      [SETTING_KEYS.BOOST_PRICE]: 2.99,
      [SETTING_KEYS.URGENT_PRICE]: 1.99,
    };
    for (const [key, value] of Object.entries(defaults)) {
      const existing = await this.settingsRepo.findOne({ where: { key } });
      if (!existing) await this.settingsRepo.save(this.settingsRepo.create({ key, value }));
    }
    for (const p of DEFAULT_PLANS) {
      const existing = await this.plansRepo.findOne({ where: { slug: p.slug } });
      if (!existing) await this.plansRepo.save(this.plansRepo.create(p));
    }
  }

  async reload() {
    const all = await this.settingsRepo.find();
    this.cache = new Map(all.map((s) => [s.key, s.value]));
  }

  get<T>(key: string, fallback: T): T {
    return this.cache.has(key) ? (this.cache.get(key) as T) : fallback;
  }

  isMonetizationEnabled(): boolean {
    return this.get<boolean>(SETTING_KEYS.MONETIZATION_ENABLED, false) === true;
  }

  async set(key: string, value: unknown, updatedBy?: string) {
    if (!Object.values(SETTING_KEYS).includes(key as any)) throw new BadRequestException(`Réglage inconnu : ${key}`);
    await this.settingsRepo.save(this.settingsRepo.create({ key, value, updatedBy }));
    await this.reload();
    this.logger.log(`Réglage ${key} = ${JSON.stringify(value)} (par ${updatedBy ?? 'système'})`);
    return { key, value };
  }

  async all() {
    await this.reload();
    return Object.fromEntries(this.cache.entries());
  }

  /** Vue publique (front) : l'état de la monétisation et les prix affichables. */
  publicSettings() {
    return {
      monetizationEnabled: this.isMonetizationEnabled(),
      boostPrice: this.get<number>(SETTING_KEYS.BOOST_PRICE, 2.99),
      urgentPrice: this.get<number>(SETTING_KEYS.URGENT_PRICE, 1.99),
      freeListingsPer30Days: this.get<number>(SETTING_KEYS.FREE_LISTINGS_PER_30_DAYS, 20),
    };
  }

  // ---------------------------------------------------------------- plans

  listPlans(includeInactive = false) {
    return this.plansRepo.find({ where: includeInactive ? {} : { active: true }, order: { sortOrder: 'ASC' } });
  }

  async getPlan(id: string) {
    const p = await this.plansRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Formule introuvable.');
    return p;
  }

  async upsertPlan(data: Partial<Plan>, id?: string) {
    if (id) {
      await this.getPlan(id);
      await this.plansRepo.update(id, data);
      return this.getPlan(id);
    }
    if (!data.slug || !data.name) throw new BadRequestException('slug et name requis.');
    return this.plansRepo.save(this.plansRepo.create(data));
  }

  // ------------------------------------------------------------ abonnements

  async activeSubscription(userId: string): Promise<(Subscription & { plan: Plan }) | null> {
    const sub = await this.subsRepo.findOne({ where: { userId, status: 'active' }, order: { createdAt: 'DESC' } });
    if (!sub) return null;
    if (sub.endsAt && sub.endsAt.getTime() < Date.now()) {
      await this.subsRepo.update(sub.id, { status: 'expired' });
      return null;
    }
    const plan = await this.plansRepo.findOne({ where: { id: sub.planId } });
    return plan ? Object.assign(sub, { plan }) : null;
  }

  /**
   * Souscription. Tant que la monétisation est désactivée, l'abonnement est
   * enregistré gratuitement (aucun paiement demandé) : cela permet de tester
   * le parcours. Le prélèvement réel (Stripe/PayPal) sera branché en phase
   * ultérieure ; ici `provider` = 'gratuit'.
   */
  async subscribe(userId: string, planId: string) {
    const plan = await this.getPlan(planId);
    if (!plan.active) throw new BadRequestException('Cette formule n\'est plus proposée.');
    const current = await this.activeSubscription(userId);
    if (current) await this.subsRepo.update(current.id, { status: 'cancelled', endsAt: new Date() });
    const now = new Date();
    const sub = await this.subsRepo.save(
      this.subsRepo.create({
        userId,
        planId: plan.id,
        status: 'active',
        provider: this.isMonetizationEnabled() && plan.priceMonthly > 0 ? 'mock' : 'gratuit',
        startedAt: now,
        endsAt: new Date(now.getTime() + 30 * 86_400_000),
      }),
    );
    return { subscription: sub, plan, charged: this.isMonetizationEnabled() ? plan.priceMonthly : 0 };
  }

  async cancel(userId: string) {
    const current = await this.activeSubscription(userId);
    if (!current) throw new NotFoundException('Aucun abonnement actif.');
    await this.subsRepo.update(current.id, { status: 'cancelled', endsAt: new Date() });
    return { cancelled: true };
  }

  /**
   * Droits effectifs d'un utilisateur. RÈGLE CENTRALE : si la monétisation est
   * désactivée, aucune limite et aucun prix, pour tout le monde.
   */
  async entitlements(userId: string, accountType: string): Promise<Entitlements> {
    const monetizationEnabled = this.isMonetizationEnabled();
    const sub = await this.activeSubscription(userId);
    const plan = sub?.plan ?? null;
    if (!monetizationEnabled) {
      return { monetizationEnabled: false, plan, listingsLimit: null, boostsLimit: null, boostPrice: 0, urgentPrice: 0, advancedStats: true };
    }
    if (plan) {
      return {
        monetizationEnabled: true,
        plan,
        listingsLimit: plan.listingsIncluded ?? null,
        boostsLimit: plan.boostsIncluded ?? null,
        boostPrice: this.get<number>(SETTING_KEYS.BOOST_PRICE, 2.99),
        urgentPrice: this.get<number>(SETTING_KEYS.URGENT_PRICE, 1.99),
        advancedStats: plan.advancedStats,
      };
    }
    // Sans abonnement : quota particulier, boosts payants à l'unité
    return {
      monetizationEnabled: true,
      plan: null,
      listingsLimit: this.get<number>(SETTING_KEYS.FREE_LISTINGS_PER_30_DAYS, 20),
      boostsLimit: 0,
      boostPrice: this.get<number>(SETTING_KEYS.BOOST_PRICE, 2.99),
      urgentPrice: this.get<number>(SETTING_KEYS.URGENT_PRICE, 1.99),
      advancedStats: accountType === 'professionnel',
    };
  }
}

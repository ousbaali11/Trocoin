import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Vérification réelle d'un SIRET auprès du registre public des entreprises
 * (https://recherche-entreprises.api.gouv.fr — annuaire officiel, base Sirene
 * INSEE, sans clé). Au-delà de la clé de Luhn : l'établissement doit exister
 * et être actif (état administratif « A »).
 *
 *   SIRENE_PROVIDER=api  (défaut hors test) : appel HTTP, 6 s max.
 *   SIRENE_PROVIDER=mock (tests)            : réponses simulées (voir MOCK_SIRETS).
 *   SIRENE_PROVIDER=none                    : vérification désactivée (Luhn seulement).
 *
 * Politique en cas d'indisponibilité de l'API : le compte est accepté avec
 * siretVerified=false (jamais bloquer une inscription sur une panne tierce),
 * et le back-office affiche « SIRET non vérifié ». Un SIRET inconnu ou fermé
 * est en revanche refusé.
 */
export type SiretCheck =
  | { status: 'verified'; companyName: string; siren: string; city?: string }
  | { status: 'unknown' } // n'existe pas dans le registre
  | { status: 'closed'; companyName: string } // établissement fermé
  | { status: 'unavailable'; reason: string }; // API injoignable / réponse invalide

export const MOCK_SIRETS: Record<string, SiretCheck> = {
  '73282932000074': { status: 'verified', companyName: 'ENTREPRISE TEST MOCK', siren: '732829320', city: 'PARIS' },
  '44306184100047': { status: 'verified', companyName: 'GOOGLE FRANCE', siren: '443061841', city: 'PARIS' },
  '88800012300008': { status: 'unknown' },
  '55208131766522': { status: 'verified', companyName: 'ENTREPRISE TEST MOCK 2', siren: '552081317', city: 'LYON' },
  '99900012300003': { status: 'closed', companyName: 'ETABLISSEMENT FERME MOCK' },
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

@Injectable()
export class SiretVerificationService {
  private readonly logger = new Logger('Sirene');
  readonly mode: 'api' | 'mock' | 'none';
  static readonly ENDPOINT = 'https://recherche-entreprises.api.gouv.fr/search';

  /** Remplaçable dans les tests (Nest n'injecte que ConfigService). */
  fetchImpl: FetchLike = (input, init) => fetch(input, init);

  constructor(config: ConfigService) {
    const v = config.get<string>('SIRENE_PROVIDER');
    this.mode = v === 'api' || v === 'mock' || v === 'none' ? v : process.env.NODE_ENV === 'test' ? 'mock' : 'api';
  }

  async check(siret: string): Promise<SiretCheck> {
    if (this.mode === 'none') return { status: 'unavailable', reason: 'vérification désactivée (SIRENE_PROVIDER=none)' };
    if (this.mode === 'mock') {
      if (process.env.SIRENE_MOCK_FAIL === 'true') return { status: 'unavailable', reason: 'panne simulée' };
      return MOCK_SIRETS[siret] ?? { status: 'unknown' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    try {
      const res = await this.fetchImpl(`${SiretVerificationService.ENDPOINT}?q=${encodeURIComponent(siret)}&per_page=3`, {
        headers: { accept: 'application/json', 'user-agent': 'Trocoin/1.0 (verification SIRET)' },
        signal: controller.signal,
      });
      if (!res.ok) return { status: 'unavailable', reason: `HTTP ${res.status}` };
      const body = (await res.json()) as {
        results?: Array<{
          nom_complet?: string;
          siren?: string;
          etat_administratif?: string;
          siege?: { siret?: string; etat_administratif?: string; libelle_commune?: string };
          matching_etablissements?: Array<{ siret?: string; etat_administratif?: string; libelle_commune?: string }>;
        }>;
      };
      for (const r of body.results ?? []) {
        const candidates = [r.siege, ...(r.matching_etablissements ?? [])].filter(Boolean) as Array<{ siret?: string; etat_administratif?: string; libelle_commune?: string }>;
        const etab = candidates.find((e) => e.siret === siret);
        if (!etab) continue;
        const companyName = (r.nom_complet || '').trim() || 'Entreprise';
        if (etab.etat_administratif !== 'A' || r.etat_administratif === 'C') return { status: 'closed', companyName };
        return { status: 'verified', companyName, siren: r.siren || siret.slice(0, 9), city: etab.libelle_commune };
      }
      return { status: 'unknown' };
    } catch (err) {
      const e = err as Error;
      const reason = e.name === 'AbortError' ? 'aucune réponse en 6 s' : e.message;
      this.logger.warn(`Registre des entreprises indisponible : ${reason}`);
      return { status: 'unavailable', reason };
    } finally {
      clearTimeout(timer);
    }
  }
}

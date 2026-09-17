import { Body, Controller, Get, Header, Inject, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { isProduction } from '../config/env.validation';
import { MockPaymentProvider } from './mock-payment.provider';
import { IPaymentProvider } from './payment-provider.interface';
import { PAYMENT_PROVIDER } from './payments.constants';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * Page de paiement SIMULÉE (AUDIT §57), servie par l'API comme l'est celle de Stripe par Stripe : elle n'existe
 * qu'avec le fournisseur simulé, hors production (404 sinon). Elle sert à vérifier de bout en bout que l'acheteur
 * revient toujours sur Trocoin : après un paiement réussi (adresse de succès), après un refus (la page reste
 * affichée avec le motif, comme chez Stripe, puis « Retour » mène à l'adresse d'annulation).
 */
@SkipThrottle()
@Controller('dev/mock-checkout')
export class MockCheckoutController {
  constructor(@Inject(PAYMENT_PROVIDER) private readonly provider: IPaymentProvider) {}

  private mock(): MockPaymentProvider {
    if (isProduction() || !(this.provider instanceof MockPaymentProvider)) throw new NotFoundException();
    return this.provider;
  }

  /** Bascule du mode hébergé (tests de bout en bout) : { hosted: true | false }. */
  @Post('mode')
  mode(@Body() body: { hosted?: boolean }) {
    const mock = this.mock();
    mock.setHosted(body?.hosted === true);
    return { hosted: mock.isHosted };
  }

  @Get(':id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  page(@Param('id') id: string, @Query('refus') refus?: string) {
    const s = this.mock().getSession(id);
    if (!s) throw new NotFoundException('Session de paiement inconnue.');
    const amount = s.amountEuros.toFixed(2).replace('.', ',');
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Paiement simulé</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color:#1e1b16}a,button{display:block;width:100%;box-sizing:border-box;margin:10px 0;padding:12px;border-radius:8px;border:1px solid #bbb;background:#fff;font-size:1rem;text-align:center;text-decoration:none;color:inherit;cursor:pointer}.pay{background:#127a5c;color:#fff;border-color:#127a5c}.err{background:#fdecea;border:1px solid #d9534f;padding:10px;border-radius:8px}</style></head>
<body><p><a href="/dev/mock-checkout/${esc(id)}/cancel" data-testid="mock-back">← Retour à Trocoin</a></p>
<h1 style="font-size:1.2rem">Page de paiement simulée</h1><p>${esc(s.title)}</p><p><strong>${amount} €</strong></p>
${refus ? '<p class="err" role="alert" data-testid="mock-declined">Votre carte a été refusée. Essayez une autre carte.</p>' : ''}
<a class="pay" href="/dev/mock-checkout/${esc(id)}/pay" data-testid="mock-pay">Payer ${amount} € (carte acceptée)</a>
<a href="/dev/mock-checkout/${esc(id)}/decline" data-testid="mock-decline">Payer avec une carte refusée</a>
</body></html>`;
  }

  @Get(':id/pay')
  pay(@Param('id') id: string, @Res() res: Response) {
    const s = this.mock().getSession(id);
    if (!s || s.state === 'expiree') throw new NotFoundException('Session de paiement expirée.');
    s.state = 'payee';
    res.redirect(303, s.successUrl);
  }

  /** Carte refusée : comme chez Stripe, l'acheteur reste sur la page de paiement avec le motif et peut réessayer. */
  @Get(':id/decline')
  decline(@Param('id') id: string, @Res() res: Response) {
    const s = this.mock().getSession(id);
    if (!s) throw new NotFoundException('Session de paiement inconnue.');
    s.refusals += 1;
    res.redirect(303, `/dev/mock-checkout/${encodeURIComponent(id)}?refus=1`);
  }

  @Get(':id/cancel')
  cancel(@Param('id') id: string, @Res() res: Response) {
    const s = this.mock().getSession(id);
    if (!s) throw new NotFoundException('Session de paiement inconnue.');
    res.redirect(303, s.cancelUrl);
  }
}

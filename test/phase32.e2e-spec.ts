import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { describeBoxtalRefusal } from '../src/shipping/boxtal-shipping.provider';
import { normalizeFrenchPhone } from '../src/shipping/phone';
import { User } from '../src/users/user.entity';
import { buyShipped, createApp, createListing, login } from './utils';

/**
 * Phase 32 (AUDIT §55) : téléphones de l'étiquette réglés avant tout appel au transporteur (repli sur les comptes,
 * messages clairs), et refus du transporteur traduit en une phrase — plus jamais de JSON brut à l'écran.
 */
describe('Phase 32 : étiquette — téléphones exigés par le transporteur, refus lisible', () => {
  let app: INestApplication;
  let server: any;
  let users: Repository<User>;

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer();
    users = app.get(getRepositoryToken(User));
  });
  afterAll(() => app.close());

  const sender = { name: 'Camille Vendeur', line1: '12 rue de la République', postalCode: '69003', city: 'Lyon' };
  const recipient = { name: 'Alex Acheteur', line1: '5 avenue des Ternes', postalCode: '75017', city: 'Paris' };

  async function paidSale() {
    const seller = await login(app);
    const buyer = await login(app);
    const listing = await createListing(app, seller, { price: 120, deliveryAvailable: true, title: 'Enceinte Bluetooth JBL Flip 6' });
    const created = { body: await buyShipped(app, buyer, listing.id, 'colissimo', { legacy: true }) }; // vente antérieure à AUDIT §59 : le vendeur saisit les adresses
    return { seller, buyer, txId: (created.body.transaction ?? created.body).id as string };
  }

  it('numéros français : écritures courantes acceptées et normalisées, le reste refusé', () => {
    for (const ok of ['0612345678', '06 12 34 56 78', '06.12.34.56.78', '+33 6 12 34 56 78', '0033612345678', '01 42 86 82 00']) expect(normalizeFrenchPhone(ok)).toMatch(/^\+33[1-9]\d{8}$/);
    expect(normalizeFrenchPhone('06 12 34 56 78')).toBe('+33612345678');
    for (const bad of ['', '   ', '0612', '12345678901', 'abc', '0012345678', undefined, null]) expect(normalizeFrenchPhone(bad as string)).toBeNull();
  });

  it('refus du transporteur : le JSON de validation devient une phrase, sans détail technique', () => {
    // Corps réellement reçu en production (téléphones vides)
    const body = JSON.stringify({ timestamp: '2026-09-17T13:56:28.490397+02:00', status: 422, errors: [{ code: 'ValidationException', parameters: [
      { code: 'ValidationException.PhoneNumber', field: 'shipment.fromAddress.contact.phone', message: 'The string supplied did not seem to be a phone number.', value: '', parameters: [] },
      { code: 'ValidationException.PhoneNumber', field: 'shipment.toAddress.contact.phone', message: 'The string supplied did not seem to be a phone number.', value: '', parameters: [] },
    ] }] });
    const text = describeBoxtalRefusal(body);
    expect(text).toBe("le transporteur a refusé la demande : numéro de téléphone de l'expéditeur manquant ou invalide ; numéro de téléphone du destinataire manquant ou invalide. Corrigez puis réessayez.");
    expect(text).not.toMatch(/[{}"]|ValidationException|HTTP|timestamp/);
    expect(describeBoxtalRefusal(JSON.stringify({ errors: [{ code: 'ValidationException', parameters: [{ code: 'ValidationException.ZipCode', field: 'shipment.toAddress.location.postalCode' }] }] }))).toContain('code postal du destinataire non reconnu');
    expect(describeBoxtalRefusal('<html>502</html>')).toMatch(/^le transporteur a refusé la demande\. Vérifiez/);
  });

  it('étiquette sans téléphone saisi : repli sur les comptes ; celui de l\'acheteur va au transporteur mais n\'est ni enregistré ni montré au vendeur', async () => {
    const { seller, buyer, txId } = await paidSale();
    const res = await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 900 }, sender, recipient }).expect(201);
    expect(res.body.status).toBe('etiquette_prete');
    const sellerPhone = normalizeFrenchPhone((await users.findOne({ where: { id: seller.id } }))!.phoneNumber);
    expect(res.body.sender.phone).toBe(sellerPhone);
    expect(res.body.recipient.phone ?? null).toBeNull();
    const asSeller = await request(server).get(`/transactions/${txId}/shipment`).set(seller.auth).expect(200);
    const buyerPhone = normalizeFrenchPhone((await users.findOne({ where: { id: buyer.id } }))!.phoneNumber)!;
    expect(JSON.stringify(asSeller.body)).not.toContain(buyerPhone);
    expect(JSON.stringify(asSeller.body)).not.toContain(buyerPhone.replace('+33', '0'));
  });

  it('téléphone saisi mais invalide : refus clair (400) avant tout appel au transporteur ; aucun téléphone disponible : message qui dit quoi faire', async () => {
    const { seller, buyer, txId } = await paidSale();
    const badSender = await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 900 }, sender: { ...sender, phone: '0612' }, recipient }).expect(400);
    expect(badSender.body).toMatchObject({ code: 'telephone_invalide', field: 'sender.phone' });
    expect(badSender.body.message).toBe("Le numéro de téléphone de l'expéditeur n'est pas valide : 10 chiffres, par exemple 06 12 34 56 78.");
    const badRecipient = await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 900 }, sender, recipient: { ...recipient, phone: 'pas un numéro' } }).expect(400);
    expect(badRecipient.body).toMatchObject({ code: 'telephone_invalide', field: 'recipient.phone' });
    // Rien n'a été tenté auprès du transporteur : aucune expédition en échec n'est enregistrée
    expect((await request(server).get(`/transactions/${txId}/shipment`).set(seller.auth).expect(200)).body ?? null).toEqual(expect.not.objectContaining({ status: 'echec' }));

    // Comptes sans numéro exploitable (anciens comptes, numéro étranger)
    await users.update(seller.id, { phoneNumber: '+447700900123' });
    await users.update(buyer.id, { phoneNumber: '+447700900124' });
    const noSender = await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 900 }, sender, recipient }).expect(400);
    expect(noSender.body).toMatchObject({ code: 'telephone_requis', field: 'sender.phone' });
    expect(noSender.body.message).toMatch(/Indiquez votre numéro de téléphone \(expéditeur\)/);
    const noRecipient = await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 900 }, sender: { ...sender, phone: '06 12 34 56 78' }, recipient }).expect(400);
    expect(noRecipient.body).toMatchObject({ code: 'telephone_requis', field: 'recipient.phone' });
    // Avec les deux numéros saisis : l'étiquette part, les numéros sont normalisés
    const ok = await request(server).post(`/transactions/${txId}/shipment`).set(seller.auth).send({ mode: 'domicile', parcel: { weightGrams: 900 }, sender: { ...sender, phone: '06 12 34 56 78' }, recipient: { ...recipient, phone: '06.87.65.43.21' } }).expect(201);
    expect(ok.body.sender.phone).toBe('+33612345678');
    expect(ok.body.recipient.phone).toBe('+33687654321');
  });
});

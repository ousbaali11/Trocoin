import { SmsDeliveryError } from './sms-provider';
import { VonageSmsProvider } from './vonage-sms.provider';

/** Tests unitaires du fournisseur Vonage avec un fetch simulé (aucun appel réseau). */
function fakeFetch(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    if (capture) { capture.url = url; capture.init = init; }
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  };
}

describe('VonageSmsProvider', () => {
  it('envoie un POST form-encodé vers rest.nexmo.com avec le numéro sans « + »', async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    const p = new VonageSmsProvider('key', 'secret', 'Trocoin', fakeFetch(200, { messages: [{ status: '0', 'message-id': 'abc', network: '20810' }] }, cap));
    await expect(p.send('+33612345678', 'Votre code de vérification Trocoin est : 123456 (valable 5 minutes).')).resolves.toBeUndefined();
    expect(cap.url).toBe('https://rest.nexmo.com/sms/json');
    const params = new URLSearchParams(String(cap.init?.body));
    expect(params.get('to')).toBe('33612345678');
    expect(params.get('from')).toBe('Trocoin');
    expect(params.get('api_key')).toBe('key');
    expect(params.get('type')).toBeNull(); // é est dans l'alphabet GSM-7
  });

  it.each([
    ['4', /identifiants Vonage invalides/],
    ['9', /crédit Vonage insuffisant/],
    ['29', /compte d’essai/],
    ['3', /paramètres invalides/],
    ['77', /erreur inconnue|texte fournisseur/],
  ])('statut Vonage %s → SmsDeliveryError explicite', async (status, re) => {
    const p = new VonageSmsProvider('k', 's', 'Trocoin', fakeFetch(200, { messages: [{ status, 'error-text': 'texte fournisseur' }] }));
    await expect(p.send('+33612345678', 'x')).rejects.toBeInstanceOf(SmsDeliveryError);
    await expect(p.send('+33612345678', 'x')).rejects.toThrow(re);
  });

  it('refuse un numéro non français sans appeler le réseau', async () => {
    let called = false;
    const p = new VonageSmsProvider('k', 's', 'Trocoin', async () => { called = true; return {} as Response; });
    await expect(p.send('+15551234567', 'x')).rejects.toThrow(/mobile français/);
    expect(called).toBe(false);
  });

  it('HTTP 401 et erreur réseau → SmsDeliveryError', async () => {
    await expect(new VonageSmsProvider('k', 's', 'T', fakeFetch(401, {})).send('+33612345678', 'x')).rejects.toThrow(/HTTP 401/);
    const down = new VonageSmsProvider('k', 's', 'T', async () => { throw new Error('ECONNREFUSED'); });
    await expect(down.send('+33612345678', 'x')).rejects.toThrow(/réseau : ECONNREFUSED/);
  });

  it('délai dépassé → SmsDeliveryError timeout', async () => {
    const slow = new VonageSmsProvider('k', 's', 'T', (_u, init) => new Promise((_r, rej) => {
      init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }), 50);
    await expect(slow.send('+33612345678', 'x')).rejects.toThrow(/aucune réponse en 50 ms/);
  });

  it('refuse de se construire sans identifiants', () => {
    expect(() => new VonageSmsProvider('', 's', 'T')).toThrow(/requis/);
  });
});

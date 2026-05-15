import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activateLicenseCard,
  generateLicenseCards,
  getLicenseSession,
  hashLicenseValue,
  listLicenseCards,
  removeLicenseCard,
  resetLicenseBinding,
} from './license.js';

const secret = 'test-license-secret';
const now = new Date('2026-05-16T00:00:00.000Z');

describe('license cards', () => {
  it('generates card codes without storing plaintext codes', () => {
    const result = generateLicenseCards({
      count: 2,
      durationDays: 30,
      note: 'customer-a',
      secret,
      now,
    });

    assert.equal(result.cards.length, 2);
    assert.equal(result.plainCodes.length, 2);
    assert.match(result.plainCodes[0], /^MK6-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(result.cards[0].durationDays, 30);
    assert.equal(result.cards[0].note, 'customer-a');
    assert.equal(result.cards[0].status, 'active');
    assert.equal(result.cards[0].activatedAt, null);
    assert.equal(result.cards[0].expiresAt, null);
    assert.notEqual(result.cards[0].codeHash, result.plainCodes[0]);
    assert.ok(!JSON.stringify(result.cards).includes(result.plainCodes[0]));
  });

  it('can reveal generated card codes from encrypted storage', () => {
    const result = generateLicenseCards({
      count: 1,
      durationDays: 30,
      note: 'customer-a',
      secret,
      now,
      includeRecoverableCode: true,
    });
    const data = { cards: result.cards };

    assert.ok(result.cards[0].encryptedCode);
    assert.ok(!JSON.stringify(result.cards).includes(result.plainCodes[0]));

    const [card] = listLicenseCards(data, now, { secret, includeCode: true });
    assert.equal(card.code, result.plainCodes[0]);
  });

  it('activates an unused card and binds it to one browser', () => {
    const generated = generateLicenseCards({ count: 1, durationDays: 7, note: '', secret, now });
    const data = { cards: generated.cards };
    const activation = activateLicenseCard({
      data,
      code: generated.plainCodes[0],
      browserId: 'browser-a',
      secret,
      now,
    });

    assert.equal(activation.ok, true);
    assert.equal(activation.card.expiresAt, '2026-05-23T00:00:00.000Z');
    assert.equal(data.cards[0].browserIdHash, hashLicenseValue('browser-a', secret));
    assert.equal(data.cards[0].lastSeenAt, now.toISOString());

    const sameBrowser = getLicenseSession({
      data,
      cardId: activation.card.id,
      browserId: 'browser-a',
      secret,
      now: new Date('2026-05-17T00:00:00.000Z'),
    });
    assert.equal(sameBrowser.ok, true);

    const otherBrowser = getLicenseSession({
      data,
      cardId: activation.card.id,
      browserId: 'browser-b',
      secret,
      now: new Date('2026-05-17T00:00:00.000Z'),
    });
    assert.equal(otherBrowser.ok, false);
    assert.equal(otherBrowser.reason, 'browser_mismatch');
  });

  it('rejects expired and disabled cards', () => {
    const generated = generateLicenseCards({ count: 2, durationDays: 1, note: '', secret, now });
    const data = { cards: generated.cards };
    const activated = activateLicenseCard({
      data,
      code: generated.plainCodes[0],
      browserId: 'browser-a',
      secret,
      now,
    });
    data.cards[1].status = 'disabled';

    const expired = getLicenseSession({
      data,
      cardId: activated.card.id,
      browserId: 'browser-a',
      secret,
      now: new Date('2026-05-18T00:00:00.000Z'),
    });
    assert.equal(expired.ok, false);
    assert.equal(expired.reason, 'expired');

    const disabled = activateLicenseCard({
      data,
      code: generated.plainCodes[1],
      browserId: 'browser-b',
      secret,
      now,
    });
    assert.equal(disabled.ok, false);
    assert.equal(disabled.reason, 'disabled');
  });

  it('allows a reset card to bind to a new browser', () => {
    const generated = generateLicenseCards({ count: 1, durationDays: 7, note: '', secret, now });
    const data = { cards: generated.cards };
    const firstActivation = activateLicenseCard({
      data,
      code: generated.plainCodes[0],
      browserId: 'browser-a',
      secret,
      now,
    });

    const reset = resetLicenseBinding(data, firstActivation.card.id);
    assert.equal(reset.ok, true);
    assert.equal(data.cards[0].browserIdHash, null);
    assert.equal(data.cards[0].activatedAt, now.toISOString());
    assert.equal(data.cards[0].expiresAt, '2026-05-23T00:00:00.000Z');

    const secondActivation = activateLicenseCard({
      data,
      code: generated.plainCodes[0],
      browserId: 'browser-b',
      secret,
      now: new Date('2026-05-17T00:00:00.000Z'),
    });
    assert.equal(secondActivation.ok, true);
    assert.equal(secondActivation.card.expiresAt, '2026-05-23T00:00:00.000Z');
  });

  it('removes a card from the store so it no longer appears or validates', () => {
    const generated = generateLicenseCards({ count: 2, durationDays: 7, note: '', secret, now });
    const data = { cards: generated.cards };
    const remainingCardId = generated.cards[1].id;
    const activation = activateLicenseCard({
      data,
      code: generated.plainCodes[0],
      browserId: 'browser-a',
      secret,
      now,
    });

    const removed = removeLicenseCard(data, activation.card.id);
    assert.equal(removed.ok, true);
    assert.equal(data.cards.length, 1);
    assert.equal(data.cards[0].id, remainingCardId);

    const session = getLicenseSession({
      data,
      cardId: activation.card.id,
      browserId: 'browser-a',
      secret,
      now,
    });
    assert.equal(session.ok, false);
    assert.equal(session.reason, 'not_found');
  });
});

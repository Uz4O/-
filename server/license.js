import crypto from 'node:crypto';

const CARD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_STORE = { cards: [] };
const CODE_CIPHER = 'aes-256-gcm';

export function createEmptyLicenseStore() {
  return { ...DEFAULT_STORE, cards: [] };
}

export function hashLicenseValue(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function createCardCode() {
  const bytes = crypto.randomBytes(12);
  let body = '';

  for (let index = 0; index < 12; index += 1) {
    body += CARD_ALPHABET[bytes[index] % CARD_ALPHABET.length];
  }

  return `MK6-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getCodeEncryptionKey(secret) {
  return crypto.createHash('sha256').update(`license-code:${secret}`).digest();
}

function encryptCardCode(code, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CODE_CIPHER, getCodeEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

function decryptCardCode(encryptedCode, secret) {
  if (!encryptedCode) return '';

  try {
    const [ivText, tagText, ciphertextText] = String(encryptedCode).split('.');
    if (!ivText || !tagText || !ciphertextText) return '';

    const decipher = crypto.createDecipheriv(CODE_CIPHER, getCodeEncryptionKey(secret), Buffer.from(ivText, 'base64'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

function publicCard(card, now = new Date(), options = {}) {
  const isExpired = card.expiresAt ? new Date(card.expiresAt).getTime() <= now.getTime() : false;
  const result = {
    id: card.id,
    durationDays: card.durationDays,
    status: isExpired && card.status === 'active' ? 'expired' : card.status,
    note: card.note,
    createdAt: card.createdAt,
    activatedAt: card.activatedAt,
    expiresAt: card.expiresAt,
    lastSeenAt: card.lastSeenAt,
    isBound: Boolean(card.browserIdHash),
  };

  if (options.includeCode) {
    result.code = options.secret ? decryptCardCode(card.encryptedCode, options.secret) : '';
    result.hasStoredCode = Boolean(card.encryptedCode);
  }

  return result;
}

function findCardByCode(data, code, secret) {
  const codeHash = hashLicenseValue(normalizeCode(code), secret);
  return data.cards.find((card) => card.codeHash === codeHash) || null;
}

function findCardById(data, cardId) {
  return data.cards.find((card) => card.id === cardId) || null;
}

export function generateLicenseCards({ count, durationDays, note = '', secret, now = new Date(), includeRecoverableCode = false }) {
  const safeCount = Math.max(1, Math.min(200, Number(count) || 1));
  const safeDurationDays = Math.max(1, Math.min(3650, Number(durationDays) || 30));
  const cards = [];
  const plainCodes = [];
  const createdAt = now.toISOString();

  for (let index = 0; index < safeCount; index += 1) {
    const code = createCardCode();
    plainCodes.push(code);
    const card = {
      id: crypto.randomUUID(),
      codeHash: hashLicenseValue(code, secret),
      durationDays: safeDurationDays,
      status: 'active',
      note: String(note || '').trim(),
      createdAt,
      activatedAt: null,
      expiresAt: null,
      browserIdHash: null,
      lastSeenAt: null,
    };

    if (includeRecoverableCode) {
      card.encryptedCode = encryptCardCode(code, secret);
    }

    cards.push(card);
  }

  return { cards, plainCodes };
}

export function activateLicenseCard({ data, code, browserId, secret, now = new Date() }) {
  const card = findCardByCode(data, code, secret);

  if (!card) return { ok: false, reason: 'not_found' };
  if (card.status === 'disabled') return { ok: false, reason: 'disabled', card: publicCard(card, now) };

  if (card.expiresAt && new Date(card.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired', card: publicCard(card, now) };
  }

  const browserIdHash = hashLicenseValue(browserId, secret);
  if (card.browserIdHash && card.browserIdHash !== browserIdHash) {
    return { ok: false, reason: 'browser_mismatch', card: publicCard(card, now) };
  }

  if (!card.activatedAt) {
    card.activatedAt = now.toISOString();
    card.expiresAt = addDays(now, card.durationDays).toISOString();
  }

  card.browserIdHash = browserIdHash;
  card.lastSeenAt = now.toISOString();

  return { ok: true, card: publicCard(card, now) };
}

export function getLicenseSession({ data, cardId, browserId, secret, now = new Date() }) {
  const card = findCardById(data, cardId);

  if (!card) return { ok: false, reason: 'not_found' };
  if (card.status === 'disabled') return { ok: false, reason: 'disabled', card: publicCard(card, now) };
  if (!card.activatedAt || !card.browserIdHash) return { ok: false, reason: 'not_activated', card: publicCard(card, now) };
  if (card.expiresAt && new Date(card.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired', card: publicCard(card, now) };
  }

  const browserIdHash = hashLicenseValue(browserId, secret);
  if (card.browserIdHash !== browserIdHash) {
    return { ok: false, reason: 'browser_mismatch', card: publicCard(card, now) };
  }

  card.lastSeenAt = now.toISOString();
  return { ok: true, card: publicCard(card, now) };
}

export function disableLicenseCard(data, cardId) {
  const card = findCardById(data, cardId);
  if (!card) return { ok: false, reason: 'not_found' };

  card.status = 'disabled';
  return { ok: true, card: publicCard(card) };
}

export function resetLicenseBinding(data, cardId) {
  const card = findCardById(data, cardId);
  if (!card) return { ok: false, reason: 'not_found' };

  card.browserIdHash = null;
  card.lastSeenAt = null;
  return { ok: true, card: publicCard(card) };
}

export function removeLicenseCard(data, cardId) {
  const index = data.cards.findIndex((card) => card.id === cardId);
  if (index === -1) return { ok: false, reason: 'not_found' };

  const [card] = data.cards.splice(index, 1);
  return { ok: true, card: publicCard(card) };
}

export function listLicenseCards(data, now = new Date(), options = {}) {
  return data.cards.map((card) => publicCard(card, now, options));
}

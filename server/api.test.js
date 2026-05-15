import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createApp } from './index.js';

let tempDir;
let app;

async function request(method, pathname, { body, headers = {} } = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();

    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return {
        response,
        body: text ? JSON.parse(text) : null,
      };
    } catch (error) {
      if (!String(error?.cause?.message || error?.message || '').includes('bad port') || attempt === 4) {
        throw error;
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  throw new Error('request retry exhausted');
}

describe('license api', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mark-six-license-'));
    app = createApp({
      env: {
        ADMIN_PASSWORD: 'admin-pass',
        LICENSE_SECRET: 'license-secret',
        LICENSE_DATA_FILE: path.join(tempDir, 'license-cards.json'),
        LOTTERY_SYNC_DISABLED: '1',
      },
    });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it('blocks admin card generation before login', async () => {
    const { response, body } = await request('POST', '/api/admin/cards/generate', {
      body: { count: 1, durationDays: 7 },
    });

    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
  });

  it('logs in, generates a card, and activates a browser session', async () => {
    const login = await request('POST', '/api/admin/login', {
      body: { password: 'admin-pass' },
    });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get('set-cookie');
    assert.match(cookie, /adminSession=/);

    const generated = await request('POST', '/api/admin/cards/generate', {
      headers: { cookie },
      body: { count: 1, durationDays: 7, note: 'customer-a' },
    });
    assert.equal(generated.response.status, 200);
    assert.equal(generated.body.cards.length, 1);
    assert.match(generated.body.plainCodes[0], /^MK6-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.ok(!JSON.stringify(generated.body.cards).includes(generated.body.plainCodes[0]));

    const activated = await request('POST', '/api/license/activate', {
      body: { code: generated.body.plainCodes[0], browserId: 'browser-a' },
    });
    assert.equal(activated.response.status, 200);
    assert.equal(activated.body.ok, true);

    const session = await request(
      'GET',
      `/api/license/session?cardId=${encodeURIComponent(activated.body.card.id)}&browserId=browser-a`,
    );
    assert.equal(session.response.status, 200);
    assert.equal(session.body.ok, true);

    const otherBrowser = await request(
      'GET',
      `/api/license/session?cardId=${encodeURIComponent(activated.body.card.id)}&browserId=browser-b`,
    );
    assert.equal(otherBrowser.response.status, 401);
    assert.equal(otherBrowser.body.reason, 'browser_mismatch');
  });

  it('requires a license session for paid workbench APIs', async () => {
    const login = await request('POST', '/api/admin/login', {
      body: { password: 'admin-pass' },
    });
    const cookie = login.response.headers.get('set-cookie');
    const generated = await request('POST', '/api/admin/cards/generate', {
      headers: { cookie },
      body: { count: 1, durationDays: 7 },
    });
    const activated = await request('POST', '/api/license/activate', {
      body: { code: generated.body.plainCodes[0], browserId: 'browser-a' },
    });

    const blocked = await request('GET', '/api/latest-lottery-result');
    assert.equal(blocked.response.status, 401);
    assert.equal(blocked.body.reason, 'missing_session');

    const allowed = await request('GET', '/api/latest-lottery-result', {
      headers: {
        'x-license-card-id': activated.body.card.id,
        'x-license-browser-id': 'browser-a',
      },
    });
    assert.equal(allowed.response.status, 200);
  });

  it('deletes a card from the admin list', async () => {
    const login = await request('POST', '/api/admin/login', {
      body: { password: 'admin-pass' },
    });
    const cookie = login.response.headers.get('set-cookie');
    const generated = await request('POST', '/api/admin/cards/generate', {
      headers: { cookie },
      body: { count: 2, durationDays: 7 },
    });
    const removedCardId = generated.body.cards[0].id;

    const removed = await request('POST', `/api/admin/cards/${removedCardId}/delete`, {
      headers: { cookie },
    });
    assert.equal(removed.response.status, 200);
    assert.equal(removed.body.ok, true);

    const list = await request('GET', '/api/admin/cards', {
      headers: { cookie },
    });
    assert.equal(list.response.status, 200);
    assert.equal(list.body.cards.length, 1);
    assert.ok(!list.body.cards.some((card) => card.id === removedCardId));
  });

  it('returns the stored card code to the admin card list for newly generated cards', async () => {
    const login = await request('POST', '/api/admin/login', {
      body: { password: 'admin-pass' },
    });
    const cookie = login.response.headers.get('set-cookie');
    const generated = await request('POST', '/api/admin/cards/generate', {
      headers: { cookie },
      body: { count: 1, durationDays: 7 },
    });

    const list = await request('GET', '/api/admin/cards', {
      headers: { cookie },
    });

    assert.equal(list.response.status, 200);
    assert.equal(list.body.cards[0].code, generated.body.plainCodes[0]);
    assert.equal(list.body.cards[0].hasStoredCode, true);
  });
});

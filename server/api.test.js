import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createApp } from './index.js';
import { buildPrompt } from './deepseekBetAssistant.js';

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

describe('AI assisted bet parsing api', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mark-six-ai-'));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  async function createLicensedHeaders(env = {}, deepseekFetch) {
    app = createApp({
      env: {
        ADMIN_PASSWORD: 'admin-pass',
        LICENSE_SECRET: 'license-secret',
        LICENSE_DATA_FILE: path.join(tempDir, 'license-cards.json'),
        LOTTERY_SYNC_DISABLED: '1',
        ...env,
      },
      deepseekFetch,
    });

    const login = await request('POST', '/api/admin/login', {
      body: { password: 'admin-pass' },
    });
    const cookie = login.response.headers.get('set-cookie');
    const generated = await request('POST', '/api/admin/cards/generate', {
      headers: { cookie },
      body: { count: 1, durationDays: 7 },
    });
    const activated = await request('POST', '/api/license/activate', {
      body: { code: generated.body.plainCodes[0], browserId: 'browser-ai' },
    });

    return {
      'x-license-card-id': activated.body.card.id,
      'x-license-browser-id': 'browser-ai',
    };
  }

  it('requires a license session for AI assisted parsing', async () => {
    app = createApp({
      env: {
        ADMIN_PASSWORD: 'admin-pass',
        LICENSE_SECRET: 'license-secret',
        LICENSE_DATA_FILE: path.join(tempDir, 'license-cards.json'),
        LOTTERY_SYNC_DISABLED: '1',
        DEEPSEEK_API_KEY: 'test-key',
      },
    });

    const result = await request('POST', '/api/assist-bet-parsing', {
      body: { sourceTexts: ['平特一肖牛买1200'], modeTexts: {} },
    });

    assert.equal(result.response.status, 401);
    assert.equal(result.body.reason, 'missing_session');
  });

  it('returns a clear error when DeepSeek is not configured', async () => {
    const headers = await createLicensedHeaders();

    const result = await request('POST', '/api/assist-bet-parsing', {
      headers,
      body: { sourceTexts: ['平特一肖牛买1200'], modeTexts: {} },
    });

    assert.equal(result.response.status, 503);
    assert.match(result.body.error, /DEEPSEEK_API_KEY/);
  });

  it('returns validated candidates from deepseek-v4-flash', async () => {
    const calls = [];
    const deepseekFetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      sourceText: '平特一肖牛买1200',
                      candidates: [
                        {
                          mode: 'pingma',
                          normalizedText: '平特一肖牛买1200',
                          reason: '平特一肖生肖金额',
                          confidence: 0.94,
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const headers = await createLicensedHeaders({ DEEPSEEK_API_KEY: 'test-key' }, deepseekFetch);

    const result = await request('POST', '/api/assist-bet-parsing', {
      headers,
      body: { sourceTexts: ['平特一肖牛买1200'], modeTexts: {} },
    });

    assert.equal(result.response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.model, 'deepseek-v4-flash');
    assert.equal(result.body.items[0].status, 'needs_confirm');
    assert.equal(result.body.items[0].candidates[0].formula, '1项 × 1200 = 1200');
  });

  it('falls back to deepseek-v4-pro when flash asks for help', async () => {
    const models = [];
    const deepseekFetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      models.push(body.model);
      const payload =
        body.model === 'deepseek-v4-flash'
          ? {
              items: [
                {
                  sourceText: '鸡马虎龙猴蛇，一个号20',
                  needsPro: true,
                  candidates: [],
                },
              ],
            }
          : {
              items: [
                {
                  sourceText: '鸡马虎龙猴蛇，一个号20',
                  candidates: [
                    {
                      mode: 'zodiacFushi',
                      normalizedText: '鸡马虎龙猴蛇\n一个号20',
                      reason: '生肖复式三中三',
                      confidence: 0.91,
                    },
                  ],
                },
              ],
            };

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const headers = await createLicensedHeaders({ DEEPSEEK_API_KEY: 'test-key' }, deepseekFetch);

    const result = await request('POST', '/api/assist-bet-parsing', {
      headers,
      body: { sourceTexts: ['鸡马虎龙猴蛇，一个号20'], modeTexts: {} },
    });

    assert.deepEqual(models, ['deepseek-v4-flash', 'deepseek-v4-pro']);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.items[0].candidates[0].modelUsed, 'deepseek-v4-pro');
  });

  it('falls back to pro for unresolved items while keeping validated flash candidates', async () => {
    const models = [];
    const proBodyByModel = {};
    const deepseekFetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      models.push(body.model);
      proBodyByModel[body.model] = body;
      const payload =
        body.model === 'deepseek-v4-flash'
          ? {
              items: [
                {
                  sourceText: '11---8026--4--各30',
                  candidates: [
                    {
                      mode: 'pingma',
                      normalizedText: '11.08.02.04/30',
                      reason: '编号分隔符统一为 slash 格式',
                      confidence: 0.9,
                    },
                  ],
                },
                {
                  sourceText: '看不懂格式ABC',
                  needsPro: true,
                  candidates: [],
                },
              ],
            }
          : {
              items: [
                {
                  sourceText: '看不懂格式ABC',
                  candidates: [
                    {
                      mode: 'pingma',
                      normalizedText: '01.02/10',
                      reason: 'Pro 复核后给出可本地校验的候选',
                      confidence: 0.9,
                    },
                  ],
                },
              ],
            };

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const headers = await createLicensedHeaders({ DEEPSEEK_API_KEY: 'test-key' }, deepseekFetch);

    const result = await request('POST', '/api/assist-bet-parsing', {
      headers,
      body: {
        sourceTexts: ['11---8026--4--各30', '看不懂格式ABC'],
        modeTexts: {},
      },
    });

    assert.deepEqual(models, ['deepseek-v4-flash', 'deepseek-v4-pro']);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.items[0].sourceText, '11---8026--4--各30');
    assert.equal(result.body.items[0].status, 'needs_confirm');
    assert.equal(result.body.items[0].candidates[0].normalizedText, '11.08.02.04/30');
    assert.equal(result.body.items[1].sourceText, '看不懂格式ABC');
    assert.equal(result.body.items[1].status, 'needs_confirm');
    assert.equal(result.body.items[1].candidates[0].modelUsed, 'deepseek-v4-pro');
    assert.match(proBodyByModel['deepseek-v4-flash'].messages[1].content, /待处理原文：\["11---8026--4--各30","看不懂格式ABC"\]/);
    assert.match(proBodyByModel['deepseek-v4-pro'].messages[1].content, /待处理原文：\["看不懂格式ABC"\]/);
    assert.match(proBodyByModel['deepseek-v4-pro'].messages[1].content, /当前输入框文本：\{\}/);
  });

  it('does not send long unresolved OCR blobs to pro fallback', async () => {
    const longBlob = `${'澳门彩特码6号10号14号20号22号26号32号36号38号44号一个号各下10元'.repeat(8)}137澳=02,05,08,11,14,17,20,23,26`;
    const calls = [];
    const deepseekFetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      sourceText: longBlob,
                      needsPro: true,
                      candidates: [],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const headers = await createLicensedHeaders({ DEEPSEEK_API_KEY: 'test-key' }, deepseekFetch);

    const result = await request('POST', '/api/assist-bet-parsing', {
      headers,
      body: {
        sourceTexts: [longBlob],
        modeTexts: { pingma: longBlob },
      },
    });

    assert.equal(result.response.status, 200);
    assert.deepEqual(calls.map((call) => call.model), ['deepseek-v4-flash']);
    assert.equal(result.body.items[0].status, 'unresolved');
  });

  it('does not block bulk OCR formatting on pro fallback for many unresolved fragments', async () => {
    const fragments = Array.from({ length: 8 }, (_, index) => `碎片${index + 1}号各十`);
    const calls = [];
    const deepseekFetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: fragments.map((sourceText) => ({
                    sourceText,
                    needsPro: true,
                    candidates: [],
                  })),
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const headers = await createLicensedHeaders({ DEEPSEEK_API_KEY: 'test-key' }, deepseekFetch);

    const result = await request('POST', '/api/assist-bet-parsing', {
      headers,
      body: {
        sourceTexts: fragments,
        modeTexts: {},
      },
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.body.modelUsed, 'deepseek-v4-flash');
    assert.deepEqual(calls.map((call) => call.model), ['deepseek-v4-flash']);
    assert.equal(result.body.items.length, fragments.length);
    assert.equal(result.body.items.every((item) => item.status === 'unresolved'), true);
  });

  it('does not return trusted candidates when DeepSeek returns invalid JSON', async () => {
    const deepseekFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'not json' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const headers = await createLicensedHeaders({ DEEPSEEK_API_KEY: 'test-key' }, deepseekFetch);

    const result = await request('POST', '/api/assist-bet-parsing', {
      headers,
      body: { sourceTexts: ['平特一肖牛买1200'], modeTexts: {} },
    });

    assert.equal(result.response.status, 503);
    assert.match(result.body.error, /JSON/);
  });

  it('requires a license session for saving parsing samples', async () => {
    app = createApp({
      env: {
        ADMIN_PASSWORD: 'admin-pass',
        LICENSE_SECRET: 'license-secret',
        LICENSE_DATA_FILE: path.join(tempDir, 'license-cards.json'),
        LOTTERY_SYNC_DISABLED: '1',
      },
    });

    const result = await request('POST', '/api/parsing-samples', {
      body: {
        sourceText: '虎免龙蛇复四三各五十',
        mode: 'zodiacFushi',
        normalizedText: '虎兔龙蛇复四三各50',
        formula: 'C(4,3) × 50 = 200',
        createdFrom: 'manual_fix',
      },
    });

    assert.equal(result.response.status, 401);
    assert.equal(result.body.reason, 'missing_session');
  });

  it('saves valid parsing samples after backend validation', async () => {
    const samplesPath = path.join(tempDir, 'parsing-samples.json');
    const headers = await createLicensedHeaders({ PARSING_SAMPLES_FILE: samplesPath });

    const result = await request('POST', '/api/parsing-samples', {
      headers,
      body: {
        sourceText: '虎免龙蛇复四三各五十',
        mode: 'zodiacFushi',
        normalizedText: '虎兔龙蛇复四三各50',
        formula: 'C(4,3) × 50 = 200',
        createdFrom: 'manual_fix',
      },
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.sample.normalizedText, '虎兔龙蛇复四三各50');
  });

  it('rejects invalid parsing sample modes and normalized text', async () => {
    const samplesPath = path.join(tempDir, 'parsing-samples.json');
    const headers = await createLicensedHeaders({ PARSING_SAMPLES_FILE: samplesPath });

    const invalidMode = await request('POST', '/api/parsing-samples', {
      headers,
      body: {
        sourceText: '虎免龙蛇复四三各五十',
        mode: 'unknown',
        normalizedText: '虎兔龙蛇复四三各50',
        formula: '',
        createdFrom: 'manual_fix',
      },
    });
    const invalidText = await request('POST', '/api/parsing-samples', {
      headers,
      body: {
        sourceText: '看不懂',
        mode: 'pingma',
        normalizedText: '这句没有金额',
        formula: '',
        createdFrom: 'manual_fix',
      },
    });

    assert.equal(invalidMode.response.status, 400);
    assert.equal(invalidText.response.status, 400);
  });

  it('injects recent manual parsing samples into the DeepSeek prompt', async () => {
    const samplesPath = path.join(tempDir, 'parsing-samples.json');
    let prompt = '';
    const deepseekFetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      prompt = body.messages.find((message) => message.role === 'user')?.content || '';
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      sourceText: '虎免龙蛇复四三各五十',
                      candidates: [
                        {
                          mode: 'zodiacFushi',
                          normalizedText: '虎兔龙蛇复四三各50',
                          reason: '参考人工修正样本',
                          confidence: 0.94,
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const headers = await createLicensedHeaders({ DEEPSEEK_API_KEY: 'test-key', PARSING_SAMPLES_FILE: samplesPath }, deepseekFetch);

    await request('POST', '/api/parsing-samples', {
      headers,
      body: {
        sourceText: '虎免龙蛇复四三各五十',
        mode: 'zodiacFushi',
        normalizedText: '虎兔龙蛇复四三各50',
        formula: 'C(4,3) × 50 = 200',
        createdFrom: 'manual_fix',
      },
    });
    const result = await request('POST', '/api/assist-bet-parsing', {
      headers,
      body: { sourceTexts: ['虎免龙蛇复四三各五十'], modeTexts: {} },
    });

    assert.equal(result.response.status, 200);
    assert.match(prompt, /历史人工校正样本/);
    assert.match(prompt, /虎免龙蛇复四三各五十/);
    assert.match(prompt, /虎兔龙蛇复四三各50/);
  });

  it('instructs AI to normalize pingma separator formats without guessing missing amounts', async () => {
    let prompt = '';
    const deepseekFetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      prompt = body.messages.find((message) => message.role === 'user')?.content || '';
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      sourceText: '1，2....3各100',
                      candidates: [
                        {
                          mode: 'pingma',
                          normalizedText: '01.02.03/100',
                          reason: '平码多分隔符统一为 slash 金额格式',
                          confidence: 0.95,
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const headers = await createLicensedHeaders({ DEEPSEEK_API_KEY: 'test-key' }, deepseekFetch);

    const result = await request('POST', '/api/assist-bet-parsing', {
      headers,
      body: { sourceTexts: ['1，2....3各100'], modeTexts: {} },
    });

    assert.equal(result.response.status, 200);
    assert.match(prompt, /01\.02\.03\/100/);
    assert.match(prompt, /缺少对应数值，不猜测/);
    assert.equal(result.body.items[0].status, 'needs_confirm');
    assert.equal(result.body.items[0].candidates[0].normalizedText, '01.02.03/100');
    assert.equal(result.body.items[0].candidates[0].betAmount, 300);
  });

  it('keeps the static DeepSeek prompt neutral while preserving the JSON contract', () => {
    const prompt = buildPrompt([], {});
    const blockedTerms = [
      '六合彩',
      '彩票',
      '投注',
      '下注',
      '赌注',
      '赌博',
      '中奖',
      '派奖',
      '押',
      '买',
    ];

    for (const term of blockedTerms) {
      assert.equal(prompt.includes(term), false, `prompt should not include ${term}`);
    }
    assert.match(prompt, /JSON object/);
    assert.match(prompt, /mode/);
    assert.match(prompt, /normalizedText/);
    assert.match(prompt, /pingma\|lianma\|numberFushi\|zodiacFushi/);
    assert.match(prompt, /01\.02\.03\/100/);
    assert.match(prompt, /不猜测/);
  });

  it('instructs AI to normalize confirmed spoken formats into locally parseable text', async () => {
    let prompt = '';
    const deepseekFetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      prompt = body.messages.find((message) => message.role === 'user')?.content || '';
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      sourceText: '蛇一码10、兔一码5块',
                      candidates: [
                        {
                          mode: 'pingma',
                          normalizedText: '蛇10\n兔5',
                          reason: '生肖平码口语压金额转为单肖平码',
                          confidence: 0.95,
                        },
                      ],
                    },
                    {
                      sourceText: '42-43-44-45-46-47-48-49复试三中三每组各2块',
                      candidates: [
                        {
                          mode: 'numberFushi',
                          normalizedText: '复试三中三各2\n42.43.44.45.46.47.48.49',
                          reason: '数字复试标题加号码池',
                          confidence: 0.95,
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const headers = await createLicensedHeaders({ DEEPSEEK_API_KEY: 'test-key' }, deepseekFetch);

    const result = await request('POST', '/api/assist-bet-parsing', {
      headers,
      body: {
        sourceTexts: ['蛇一码10、兔一码5块', '42-43-44-45-46-47-48-49复试三中三每组各2块'],
        modeTexts: {},
      },
    });

    assert.equal(result.response.status, 200);
    assert.match(prompt, /蛇一码10、兔一码5块 => mode=pingma normalizedText=蛇10\\n兔5/);
    assert.match(prompt, /鸡猪猴号各二十兔蛇龙号码五十 => mode=pingma normalizedText=鸡20\\n猪20\\n猴20\\n兔50\\n蛇50\\n龙50/);
    assert.match(prompt, /11---8026--4--各30/);
    assert.match(prompt, /复试三中三各2\\n42\.43\.44\.45\.46\.47\.48\.49/);
    assert.match(prompt, /鼠猴狗一各了各十元 => mode=pingma normalizedText=鼠猴狗一个号10/);
    assert.match(prompt, /蛇号各五十 => mode=pingma normalizedText=蛇50/);
    assert.match(prompt, /三九尾一个各十元 => mode=pingma normalizedText=03\.13\.23\.33\.43\.09\.19\.29\.39\.49\/10/);
    assert.match(prompt, /21-47-32--13-42复式特碰每组100 => mode=numberFushi normalizedText=复式特碰每组100\\n21\.47\.32\.13\.42/);
    assert.match(prompt, /三连肖，鼠猴羊，100 => mode=lianma normalizedText=三连肖，鼠猴羊，100/);
    assert.equal(result.body.items[0].status, 'needs_confirm');
    assert.equal(result.body.items[0].candidates[0].betAmount, 60);
    assert.equal(result.body.items[1].status, 'needs_confirm');
    assert.equal(result.body.items[1].candidates[0].betAmount, 112);
  });
});

describe('Qwen chat OCR api', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mark-six-qwen-'));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  async function createLicensedHeaders(env = {}, qwenFetch) {
    app = createApp({
      env: {
        ADMIN_PASSWORD: 'admin-pass',
        LICENSE_SECRET: 'license-secret',
        LICENSE_DATA_FILE: path.join(tempDir, 'license-cards.json'),
        LOTTERY_SYNC_DISABLED: '1',
        ...env,
      },
      qwenFetch,
    });

    const login = await request('POST', '/api/admin/login', {
      body: { password: 'admin-pass' },
    });
    const cookie = login.response.headers.get('set-cookie');
    const generated = await request('POST', '/api/admin/cards/generate', {
      headers: { cookie },
      body: { count: 1, durationDays: 7 },
    });
    const activated = await request('POST', '/api/license/activate', {
      body: { code: generated.body.plainCodes[0], browserId: 'browser-qwen' },
    });

    return {
      'x-license-card-id': activated.body.card.id,
      'x-license-browser-id': 'browser-qwen',
    };
  }

  it('returns a clear error when Qwen OCR is not configured', async () => {
    const headers = await createLicensedHeaders();

    const result = await request('POST', '/api/recognize-chat-qwen', {
      headers,
      body: { imageBase64: 'abcd', mimeType: 'image/jpeg' },
    });

    assert.equal(result.response.status, 503);
    assert.match(result.body.error, /QWEN_API_KEY/);
  });

  it('transcribes chat screenshots through Qwen vision OCR', async () => {
    const calls = [];
    const qwenFetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '137澳=02,05,08,11,14,17,20,23,26\n计300',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const headers = await createLicensedHeaders({ QWEN_API_KEY: 'test-qwen-key' }, qwenFetch);

    const result = await request('POST', '/api/recognize-chat-qwen', {
      headers,
      body: { imageBase64: 'abcd', mimeType: 'image/jpeg' },
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.provider, 'qwen');
    assert.equal(result.body.text, '137澳=02,05,08,11,14,17,20,23,26\n计300');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.model, 'qwen-vl-ocr-latest');
    assert.equal(calls[0].body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,abcd');
    assert.equal(calls[0].headers.Authorization, 'Bearer test-qwen-key');
  });

  it('strips Qwen chat UI noise and restores line breaks before frontend classification', async () => {
    const rawText = '9:18 文件传输助手 4 21-47-32--13-42复式特碰每组 100 21..47+12..36/250...32....13..42,2 4.48.14..25..05..17..29..41..44/15 0 羊鸡猪牛复四三各五十平特羊又鸡 各一佰 澳门彩特码14号24号34号44号5 号15号25号35号一个号各下30 元4号45号一个号下10元 26买100 蛇一码10、兔一码5块';
    const qwenFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: rawText,
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const headers = await createLicensedHeaders({ QWEN_API_KEY: 'test-qwen-key' }, qwenFetch);

    const result = await request('POST', '/api/recognize-chat-qwen', {
      headers,
      body: { imageBase64: 'abcd', mimeType: 'image/jpeg' },
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.body.rawText, rawText);
    assert.equal(result.body.text.includes('文件传输助手'), false);
    assert.doesNotMatch(result.body.text, /9:18/);
    assert.match(result.body.text, /21-47-32--13-42复式特碰每组100/);
    assert.doesNotMatch(result.body.text, /每组10021/);
    assert.match(result.body.text, /每组100\n21\.\.47/);
    assert.match(result.body.text, /澳门彩特码14号24号34号44号5号15号25号35号一个号各下30元/);
    assert.match(result.body.text, /蛇一码10/);
    assert.match(result.body.text, /兔一码5块/);
    assert.ok(result.body.text.split(/\r?\n/).length >= 6);
  });
});

import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import express from 'express';

import {
  activateLicenseCard,
  createEmptyLicenseStore,
  disableLicenseCard,
  generateLicenseCards,
  getLicenseSession,
  hashLicenseValue,
  listLicenseCards,
  removeLicenseCard,
  resetLicenseBinding,
} from './license.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDistPath = path.resolve(__dirname, '../dist');
const defaultDataPath = path.resolve(__dirname, 'data');

function getClientKey(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || req.socket.remoteAddress || 'unknown';
}

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) return cookies;
      cookies[decodeURIComponent(part.slice(0, separatorIndex))] = decodeURIComponent(part.slice(separatorIndex + 1));
      return cookies;
    }, {});
}

function createAdminSessionToken(adminPassword, licenseSecret) {
  return hashLicenseValue(`admin:${adminPassword}`, licenseSecret);
}

function sanitizeAdminPassword(password) {
  return String(password || '').trim();
}

function jsonError(res, status, error, extra = {}) {
  res.status(status).json({ ok: false, error, ...extra });
}

export function createApp({ env = process.env } = {}) {
  const app = express();
  const port = Number(env.PORT || 8787);
  const ocrServiceUrl = env.OCR_SERVICE_URL || `http://127.0.0.1:${env.OCR_PORT || 8791}`;
  const ocrTimeoutMs = Number(env.OCR_TIMEOUT_MS || 90000);
  const maxImageMb = Number(env.MAX_IMAGE_MB || 12);
  const ocrAccessToken = env.OCR_ACCESS_TOKEN || '';
  const ocrRateLimitWindowMs = Number(env.OCR_RATE_LIMIT_WINDOW_MS || 60000);
  const ocrRateLimitMax = Number(env.OCR_RATE_LIMIT_MAX || 20);
  const dataPath = defaultDataPath;
  const lotteryCachePath = path.join(dataPath, 'latest-lottery-result.json');
  const lotterySourceApi = env.LOTTERY_SOURCE_API || 'https://kj.9bkj.com:1888/kj';
  const lotterySourceGroup = env.LOTTERY_SOURCE_GROUP || 'am';
  const lotterySyncIntervalMs = Number(env.LOTTERY_SYNC_INTERVAL_MS || 60000);
  const lotterySyncTimeoutMs = Number(env.LOTTERY_SYNC_TIMEOUT_MS || 25000);
  const lotterySyncDisabled = env.LOTTERY_SYNC_DISABLED === '1';
  const adminPassword = sanitizeAdminPassword(env.ADMIN_PASSWORD || '');
  const licenseSecret = env.LICENSE_SECRET || env.ADMIN_PASSWORD || 'mark-six-dev-license-secret';
  const licenseDataPath = path.resolve(env.LICENSE_DATA_FILE || path.join(dataPath, 'license-cards.json'));
  const adminSessionToken = createAdminSessionToken(adminPassword, licenseSecret);
  const ocrRequestLog = new Map();
  let latestLotteryResult = null;
  let lotteryTimer = null;
  let lotterySyncState = {
    running: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: '',
  };

  app.use(express.json({ limit: `${maxImageMb}mb` }));

  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  function validateImagePayload(body) {
    const { imageBase64, mimeType } = body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return '缺少图片数据';
    }

    if (imageBase64.length > maxImageMb * 1024 * 1024 * 1.4) {
      return `图片数据超过 ${maxImageMb}MB 限制`;
    }

    if (!/^[A-Za-z0-9+/=\s]+$/.test(imageBase64)) {
      return '图片数据不是有效的 base64';
    }

    if (mimeType && typeof mimeType !== 'string') {
      return '图片类型不正确';
    }

    if (mimeType && !/^image\/(jpeg|jpg|png|webp|bmp|gif)$/i.test(mimeType)) {
      return '只支持常见图片类型';
    }

    return '';
  }

  function requireOcrAccess(req, res, next) {
    if (!ocrAccessToken) {
      next();
      return;
    }

    const token = req.headers['x-ocr-token'] || req.query.ocrToken;
    if (token !== ocrAccessToken) {
      jsonError(res, 401, 'OCR 未授权');
      return;
    }

    next();
  }

  function limitOcrRequests(req, res, next) {
    const now = Date.now();
    const key = getClientKey(req);
    const current = ocrRequestLog.get(key) || [];
    const recent = current.filter((timestamp) => now - timestamp < ocrRateLimitWindowMs);

    if (recent.length >= ocrRateLimitMax) {
      jsonError(res, 429, 'OCR 请求过于频繁，请稍后再试');
      return;
    }

    recent.push(now);
    ocrRequestLog.set(key, recent);
    next();
  }

  function requireAdmin(req, res, next) {
    if (!adminPassword) {
      jsonError(res, 503, '未配置管理密码');
      return;
    }

    const cookies = parseCookies(req);
    if (cookies.adminSession !== adminSessionToken) {
      jsonError(res, 401, '管理员未登录');
      return;
    }

    next();
  }

  async function readLicenseData() {
    try {
      const text = await readFile(licenseDataPath, 'utf8');
      const data = JSON.parse(text);
      return { cards: Array.isArray(data.cards) ? data.cards : [] };
    } catch (error) {
      if (error?.code === 'ENOENT') return createEmptyLicenseStore();
      throw error;
    }
  }

  async function writeLicenseData(data) {
    await mkdir(path.dirname(licenseDataPath), { recursive: true });
    await writeFile(licenseDataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  async function mutateLicenseData(mutator) {
    const data = await readLicenseData();
    const result = await mutator(data);
    await writeLicenseData(data);
    return result;
  }

  async function requireLicenseSession(req, res, next) {
    const cardId = String(req.headers['x-license-card-id'] || req.query.licenseCardId || '').trim();
    const browserId = String(req.headers['x-license-browser-id'] || req.query.licenseBrowserId || '').trim();

    if (!cardId || !browserId) {
      jsonError(res, 401, '未激活卡密', { reason: 'missing_session' });
      return;
    }

    try {
      const data = await readLicenseData();
      const result = getLicenseSession({
        data,
        cardId,
        browserId,
        secret: licenseSecret,
      });

      if (!result.ok) {
        jsonError(res, 401, '卡密会话无效', { reason: result.reason, card: result.card });
        return;
      }

      await writeLicenseData(data);
      req.licenseCard = result.card;
      next();
    } catch (error) {
      jsonError(res, 500, error instanceof Error ? error.message : '校验卡密失败');
    }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = ocrTimeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function normalizeDrawItem(item) {
    const numbers = String(item?.num || '')
      .split(',')
      .map((number) => number.trim().padStart(2, '0'))
      .filter((number) => /^(0[1-9]|[1-4]\d)$/.test(number));
    const zodiacs = String(item?.shengxiao || '')
      .split(',')
      .map((value) => value.trim());
    const elements = String(item?.wuxing || '')
      .split(',')
      .map((value) => value.trim());

    if (numbers.length !== 7 || !item?.qishu || !item?.date) {
      throw new Error('源站返回的开奖数据不完整');
    }

    return {
      source: '9.48kk50.com',
      sourceApi: lotterySourceApi,
      lotteryType: lotterySourceGroup,
      id: item.id,
      year: Number(item.year),
      issue: String(item.qishu),
      date: String(item.date),
      numbers,
      zodiacs,
      elements,
      normalNumbers: numbers.slice(0, 6),
      specialNumber: numbers[6],
      specialZodiac: zodiacs[6] || '',
      specialElement: elements[6] || '',
      nextIssue: item.nqi ? String(item.nqi) : '',
      syncedAt: new Date().toISOString(),
    };
  }

  async function readCachedLotteryResult() {
    try {
      const text = await readFile(lotteryCachePath, 'utf8');
      latestLotteryResult = JSON.parse(text);
    } catch {
      latestLotteryResult = null;
    }
  }

  async function writeCachedLotteryResult(result) {
    await mkdir(dataPath, { recursive: true });
    await writeFile(lotteryCachePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  async function fetchLatestLotteryResult() {
    const response = await fetchWithTimeout(
      lotterySourceApi,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 MarkSixSync/1.0',
        },
        body: JSON.stringify({
          g: lotterySourceGroup,
          s: 5,
        }),
      },
      lotterySyncTimeoutMs,
    );
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`源站请求失败：HTTP ${response.status}`);
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`源站返回的不是 JSON：${text.slice(0, 120)}`);
    }

    const firstItem = Array.isArray(payload?.data) ? payload.data[0] : null;
    if (payload?.code !== 1 || !firstItem) {
      throw new Error(payload?.msg || '源站没有返回最新开奖数据');
    }

    return normalizeDrawItem(firstItem);
  }

  async function syncLatestLotteryResult(reason = 'timer') {
    if (lotterySyncState.running) return latestLotteryResult;

    lotterySyncState = {
      ...lotterySyncState,
      running: true,
      lastAttemptAt: new Date().toISOString(),
      lastError: '',
    };

    try {
      const result = await fetchLatestLotteryResult();
      const isNewIssue = !latestLotteryResult || latestLotteryResult.issue !== result.issue;
      latestLotteryResult = result;
      lotterySyncState.lastSuccessAt = result.syncedAt;
      await writeCachedLotteryResult(result);

      if (isNewIssue) {
        console.log(`[lottery-sync] ${reason}: synced issue ${result.issue}, special ${result.specialNumber}/${result.specialZodiac}`);
      }

      return result;
    } catch (error) {
      lotterySyncState.lastError = error instanceof Error ? error.message : '同步开奖数据失败';
      console.error(`[lottery-sync] ${reason}: ${lotterySyncState.lastError}`);
      throw error;
    } finally {
      lotterySyncState.running = false;
    }
  }

  async function readOcrJson(response) {
    const text = await response.text();

    if (!text.trim()) {
      throw new Error('OCR 服务没有返回内容');
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`OCR 服务返回的不是 JSON：${text.slice(0, 160)}`);
    }
  }

  async function forwardOcr(pathname, body) {
    const response = await fetchWithTimeout(`${ocrServiceUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await readOcrJson(response);

    if (!response.ok) {
      const detail = payload.detail || payload.error || 'OCR 服务识别失败';
      throw new Error(detail);
    }

    return payload;
  }

  app.post('/api/admin/login', (req, res) => {
    if (!adminPassword) {
      jsonError(res, 503, '未配置管理密码');
      return;
    }

    if (sanitizeAdminPassword(req.body?.password) !== adminPassword) {
      jsonError(res, 401, '管理密码错误');
      return;
    }

    res.set(
      'Set-Cookie',
      `adminSession=${encodeURIComponent(adminSessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    );
    res.json({ ok: true });
  });

  app.get('/api/admin/cards', requireAdmin, async (_req, res) => {
    try {
      const data = await readLicenseData();
      res.json({ ok: true, cards: listLicenseCards(data, new Date(), { secret: licenseSecret, includeCode: true }) });
    } catch (error) {
      jsonError(res, 500, error instanceof Error ? error.message : '读取卡密失败');
    }
  });

  app.post('/api/admin/cards/generate', requireAdmin, async (req, res) => {
    try {
      const generated = await mutateLicenseData((data) => {
        const next = generateLicenseCards({
          count: req.body?.count,
          durationDays: req.body?.durationDays,
          note: req.body?.note,
          secret: licenseSecret,
          includeRecoverableCode: true,
        });
        data.cards.push(...next.cards);
        return next;
      });

      res.json({
        ok: true,
        plainCodes: generated.plainCodes,
        cards: generated.cards.map((card) => listLicenseCards({ cards: [card] })[0]),
      });
    } catch (error) {
      jsonError(res, 500, error instanceof Error ? error.message : '生成卡密失败');
    }
  });

  app.post('/api/admin/cards/:id/disable', requireAdmin, async (req, res) => {
    try {
      const result = await mutateLicenseData((data) => disableLicenseCard(data, req.params.id));
      if (!result.ok) {
        jsonError(res, 404, '卡密不存在', { reason: result.reason });
        return;
      }

      res.json({ ok: true, card: result.card });
    } catch (error) {
      jsonError(res, 500, error instanceof Error ? error.message : '禁用卡密失败');
    }
  });

  app.post('/api/admin/cards/:id/reset-binding', requireAdmin, async (req, res) => {
    try {
      const result = await mutateLicenseData((data) => resetLicenseBinding(data, req.params.id));
      if (!result.ok) {
        jsonError(res, 404, '卡密不存在', { reason: result.reason });
        return;
      }

      res.json({ ok: true, card: result.card });
    } catch (error) {
      jsonError(res, 500, error instanceof Error ? error.message : '解绑卡密失败');
    }
  });

  app.post('/api/admin/cards/:id/delete', requireAdmin, async (req, res) => {
    try {
      const result = await mutateLicenseData((data) => removeLicenseCard(data, req.params.id));
      if (!result.ok) {
        jsonError(res, 404, '卡密不存在', { reason: result.reason });
        return;
      }

      res.json({ ok: true, card: result.card });
    } catch (error) {
      jsonError(res, 500, error instanceof Error ? error.message : '删除卡密失败');
    }
  });

  app.post('/api/license/activate', async (req, res) => {
    const code = String(req.body?.code || '').trim();
    const browserId = String(req.body?.browserId || '').trim();
    if (!code || !browserId) {
      jsonError(res, 400, '请输入卡密');
      return;
    }

    try {
      const result = await mutateLicenseData((data) => activateLicenseCard({
        data,
        code,
        browserId,
        secret: licenseSecret,
      }));

      if (!result.ok) {
        jsonError(res, result.reason === 'not_found' ? 404 : 401, '卡密无效或不可用', { reason: result.reason, card: result.card });
        return;
      }

      res.json({ ok: true, card: result.card });
    } catch (error) {
      jsonError(res, 500, error instanceof Error ? error.message : '激活卡密失败');
    }
  });

  app.get('/api/license/session', async (req, res) => {
    const cardId = String(req.query.cardId || '').trim();
    const browserId = String(req.query.browserId || '').trim();
    if (!cardId || !browserId) {
      jsonError(res, 401, '未激活卡密', { reason: 'missing_session' });
      return;
    }

    try {
      const data = await readLicenseData();
      const result = getLicenseSession({
        data,
        cardId,
        browserId,
        secret: licenseSecret,
      });

      if (result.ok) await writeLicenseData(data);

      if (!result.ok) {
        jsonError(res, 401, '卡密会话无效', { reason: result.reason, card: result.card });
        return;
      }

      res.json({ ok: true, card: result.card });
    } catch (error) {
      jsonError(res, 500, error instanceof Error ? error.message : '校验卡密失败');
    }
  });

  app.get('/api/health', async (_req, res) => {
    try {
      const response = await fetchWithTimeout(`${ocrServiceUrl}/health`, {
        method: 'GET',
      });
      const ocr = await readOcrJson(response);

      res.json({
        ok: response.ok && Boolean(ocr.ok),
        provider: 'rapidocr',
        api: 'ok',
        ocr: response.ok ? 'ok' : 'error',
        ocrServiceUrl,
      });
    } catch (error) {
      res.status(503).json({
        ok: false,
        provider: 'rapidocr',
        api: 'ok',
        ocr: 'unavailable',
        error: error instanceof Error ? error.message : 'OCR 服务不可用',
      });
    }
  });

  app.get('/api/latest-lottery-result', requireLicenseSession, async (req, res) => {
    const shouldRefresh = req.query.refresh === '1' || !latestLotteryResult;

    try {
      if (shouldRefresh && !lotterySyncDisabled) {
        await syncLatestLotteryResult(req.query.refresh === '1' ? 'manual' : 'api');
      }

      res.json({
        ok: Boolean(latestLotteryResult),
        data: latestLotteryResult,
        sync: {
          lastAttemptAt: lotterySyncState.lastAttemptAt,
          lastSuccessAt: lotterySyncState.lastSuccessAt,
          lastError: lotterySyncState.lastError,
          intervalMs: lotterySyncIntervalMs,
        },
      });
    } catch (error) {
      res.status(503).json({
        ok: false,
        data: latestLotteryResult,
        sync: {
          lastAttemptAt: lotterySyncState.lastAttemptAt,
          lastSuccessAt: lotterySyncState.lastSuccessAt,
          lastError: error instanceof Error ? error.message : '同步开奖数据失败',
          intervalMs: lotterySyncIntervalMs,
        },
      });
    }
  });

  app.post('/api/recognize-table', requireLicenseSession, requireOcrAccess, limitOcrRequests, async (req, res) => {
    try {
      const validationError = validateImagePayload(req.body);
      if (validationError) {
        jsonError(res, 400, validationError);
        return;
      }

      const payload = await forwardOcr('/recognize/table', req.body);
      res.json(payload);
    } catch (error) {
      jsonError(res, 503, error instanceof Error ? error.message : 'OCR 表格识别失败');
    }
  });

  app.post('/api/recognize-chat', requireLicenseSession, requireOcrAccess, limitOcrRequests, async (req, res) => {
    try {
      const validationError = validateImagePayload(req.body);
      if (validationError) {
        jsonError(res, 400, validationError);
        return;
      }

      const payload = await forwardOcr('/recognize/chat', req.body);
      res.json(payload);
    } catch (error) {
      jsonError(res, 503, error instanceof Error ? error.message : 'OCR 聊天识别失败');
    }
  });

  app.use(express.static(defaultDistPath));

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    res.sendFile(path.join(defaultDistPath, 'index.html'));
  });

  app.locals.startBackgroundTasks = async () => {
    await readCachedLotteryResult();
    if (lotterySyncDisabled) return;

    syncLatestLotteryResult('startup').catch(() => {});
    lotteryTimer = setInterval(() => {
      syncLatestLotteryResult('timer').catch(() => {});
    }, lotterySyncIntervalMs);
  };

  app.locals.stopBackgroundTasks = () => {
    if (lotteryTimer) clearInterval(lotteryTimer);
  };

  app.locals.config = {
    port,
    ocrServiceUrl,
    lotterySourceApi,
    lotterySourceGroup,
    lotterySyncIntervalMs,
  };

  return app;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const isPm2Run = process.env.pm_id !== undefined || process.env.PM2_HOME !== undefined;

if (isDirectRun || isPm2Run) {
  const app = createApp();
  const { port, ocrServiceUrl, lotterySourceApi, lotterySourceGroup, lotterySyncIntervalMs } = app.locals.config;

  app.listen(port, '0.0.0.0', () => {
    console.log(`Mark Six service running at http://0.0.0.0:${port}`);
    console.log(`OCR service: ${ocrServiceUrl}`);
    console.log(`Lottery sync source: ${lotterySourceApi} (${lotterySourceGroup}), every ${lotterySyncIntervalMs}ms`);
  });

  await app.locals.startBackgroundTasks();
}

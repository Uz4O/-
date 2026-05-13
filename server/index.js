import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 8787);
const ocrServiceUrl = process.env.OCR_SERVICE_URL || `http://127.0.0.1:${process.env.OCR_PORT || 8791}`;
const ocrTimeoutMs = Number(process.env.OCR_TIMEOUT_MS || 90000);
const maxImageMb = Number(process.env.MAX_IMAGE_MB || 12);
const ocrAccessToken = process.env.OCR_ACCESS_TOKEN || '';
const ocrRateLimitWindowMs = Number(process.env.OCR_RATE_LIMIT_WINDOW_MS || 60000);
const ocrRateLimitMax = Number(process.env.OCR_RATE_LIMIT_MAX || 20);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../dist');
const dataPath = path.resolve(__dirname, 'data');
const lotteryCachePath = path.join(dataPath, 'latest-lottery-result.json');
const lotterySourceApi = process.env.LOTTERY_SOURCE_API || 'https://kj.9bkj.com:1888/kj';
const lotterySourceGroup = process.env.LOTTERY_SOURCE_GROUP || 'am';
const lotterySyncIntervalMs = Number(process.env.LOTTERY_SYNC_INTERVAL_MS || 60000);
const lotterySyncTimeoutMs = Number(process.env.LOTTERY_SYNC_TIMEOUT_MS || 25000);
const ocrRequestLog = new Map();
let latestLotteryResult = null;
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

function getClientKey(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || req.socket.remoteAddress || 'unknown';
}

function requireOcrAccess(req, res, next) {
  if (!ocrAccessToken) {
    next();
    return;
  }

  const token = req.headers['x-ocr-token'] || req.query.ocrToken;
  if (token !== ocrAccessToken) {
    res.status(401).json({ ok: false, error: 'OCR 未授权' });
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
    res.status(429).json({ ok: false, error: 'OCR 请求过于频繁，请稍后再试' });
    return;
  }

  recent.push(now);
  ocrRequestLog.set(key, recent);
  next();
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

app.get('/api/latest-lottery-result', async (req, res) => {
  const shouldRefresh = req.query.refresh === '1' || !latestLotteryResult;

  try {
    if (shouldRefresh) {
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

app.post('/api/recognize-table', requireOcrAccess, limitOcrRequests, async (req, res) => {
  try {
    const validationError = validateImagePayload(req.body);
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const payload = await forwardOcr('/recognize/table', req.body);
    res.json(payload);
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'OCR 表格识别失败',
    });
  }
});

app.post('/api/recognize-chat', requireOcrAccess, limitOcrRequests, async (req, res) => {
  try {
    const validationError = validateImagePayload(req.body);
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const payload = await forwardOcr('/recognize/chat', req.body);
    res.json(payload);
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'OCR 聊天识别失败',
    });
  }
});

app.use(express.static(distPath));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Mark Six service running at http://0.0.0.0:${port}`);
  console.log(`OCR service: ${ocrServiceUrl}`);
  console.log(`Lottery sync source: ${lotterySourceApi} (${lotterySourceGroup}), every ${lotterySyncIntervalMs}ms`);
});

await readCachedLotteryResult();
syncLatestLotteryResult('startup').catch(() => {});
setInterval(() => {
  syncLatestLotteryResult('timer').catch(() => {});
}, lotterySyncIntervalMs);

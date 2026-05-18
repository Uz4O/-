import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import { validateAiBetCandidate } from '../src/lib/lottery.js';

const storeVersion = 1;
const allowedModes = new Set(['pingma', 'lianma', 'numberFushi', 'zodiacFushi']);

function emptyStore() {
  return { version: storeVersion, samples: [] };
}

function normalizeSampleText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function buildSampleKey(sample) {
  return [sample.mode, sample.normalizedText, sample.sourceText].map((value) => String(value || '').trim()).join('\u001f');
}

function createSampleId(now = new Date()) {
  const timestamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `sample_${timestamp}_${random}`;
}

function validateParsingSamplePayload(payload = {}) {
  const sourceText = normalizeSampleText(payload.sourceText);
  const mode = normalizeSampleText(payload.mode, 40);
  const normalizedText = normalizeSampleText(payload.normalizedText);
  const formula = normalizeSampleText(payload.formula, 300);
  const createdFrom = normalizeSampleText(payload.createdFrom || 'manual_fix', 40);

  if (!sourceText) return { ok: false, error: '缺少原文' };
  if (!allowedModes.has(mode)) return { ok: false, error: '非法投注模式' };
  if (!normalizedText) return { ok: false, error: '缺少规范文本' };

  const candidate = validateAiBetCandidate({
    mode,
    normalizedText,
    reason: 'manual sample',
    modelUsed: 'manual',
    warnings: [],
  });

  if (candidate.status !== 'needs_confirm') {
    return { ok: false, error: candidate.message || '规范文本无法被本地规则解析', candidate };
  }

  return {
    ok: true,
    sample: {
      sourceText,
      mode,
      normalizedText,
      formula: formula || candidate.formula,
      createdFrom,
    },
    candidate,
  };
}

async function readParsingSamples(samplesPath) {
  try {
    const text = await readFile(samplesPath, 'utf8');
    const data = JSON.parse(text);
    return {
      version: storeVersion,
      samples: Array.isArray(data.samples) ? data.samples : [],
    };
  } catch {
    return emptyStore();
  }
}

async function backupCorruptStore(samplesPath) {
  try {
    const text = await readFile(samplesPath, 'utf8');
    JSON.parse(text);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    const parsed = path.parse(samplesPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(parsed.dir, `${parsed.name}.corrupt.${timestamp}${parsed.ext || '.json'}`);
    await rename(samplesPath, backupPath);
  }
}

async function writeParsingSamples(samplesPath, data) {
  await mkdir(path.dirname(samplesPath), { recursive: true });
  await writeFile(samplesPath, `${JSON.stringify({ version: storeVersion, samples: data.samples || [] }, null, 2)}\n`, 'utf8');
}

async function saveParsingSample(samplesPath, payload, { now = new Date() } = {}) {
  const validation = validateParsingSamplePayload(payload);
  if (!validation.ok) return validation;

  await backupCorruptStore(samplesPath);
  const data = await readParsingSamples(samplesPath);
  const key = buildSampleKey(validation.sample);
  const existing = data.samples.find((sample) => buildSampleKey(sample) === key);
  const timestamp = now.toISOString();

  if (existing) {
    existing.usageCount = Number(existing.usageCount || 0) + 1;
    existing.lastUsedAt = timestamp;
    await writeParsingSamples(samplesPath, data);
    return { ok: true, sample: existing, duplicate: true, candidate: validation.candidate };
  }

  const sample = {
    id: createSampleId(now),
    ...validation.sample,
    createdAt: timestamp,
    usageCount: 0,
    lastUsedAt: null,
  };

  data.samples.push(sample);
  await writeParsingSamples(samplesPath, data);
  return { ok: true, sample, duplicate: false, candidate: validation.candidate };
}

async function getRecentParsingSamples(samplesPath, limit = 8) {
  const data = await readParsingSamples(samplesPath);
  return [...data.samples]
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .slice(0, Math.max(0, limit));
}

export {
  getRecentParsingSamples,
  readParsingSamples,
  saveParsingSample,
  validateParsingSamplePayload,
};

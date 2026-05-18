import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  getRecentParsingSamples,
  readParsingSamples,
  saveParsingSample,
  validateParsingSamplePayload,
} from './parsingSamples.js';

describe('parsing samples store', () => {
  async function createStorePath() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mark-six-samples-'));
    return {
      tempDir,
      samplesPath: path.join(tempDir, 'parsing-samples.json'),
    };
  }

  it('saves a valid manual correction sample', async () => {
    const { tempDir, samplesPath } = await createStorePath();
    try {
      const result = await saveParsingSample(samplesPath, {
        sourceText: '虎免龙蛇复四三各五十',
        mode: 'zodiacFushi',
        normalizedText: '虎兔龙蛇复四三各50',
        formula: 'C(4,3) × 50 = 200',
        createdFrom: 'manual_fix',
      });

      assert.equal(result.ok, true);
      assert.equal(result.sample.mode, 'zodiacFushi');
      assert.equal(result.sample.usageCount, 0);
      const stored = await readParsingSamples(samplesPath);
      assert.equal(stored.samples.length, 1);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('rejects samples whose normalized text fails local validation', () => {
    const result = validateParsingSamplePayload({
      sourceText: '看不懂',
      mode: 'pingma',
      normalizedText: '这句没有金额',
      formula: '',
      createdFrom: 'manual_fix',
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /无法被本地规则解析/);
  });

  it('deduplicates identical source mode and normalized text', async () => {
    const { tempDir, samplesPath } = await createStorePath();
    try {
      const payload = {
        sourceText: '虎免龙蛇复四三各五十',
        mode: 'zodiacFushi',
        normalizedText: '虎兔龙蛇复四三各50',
        formula: 'C(4,3) × 50 = 200',
        createdFrom: 'manual_fix',
      };

      await saveParsingSample(samplesPath, payload, { now: new Date('2026-05-18T04:00:00.000Z') });
      const duplicate = await saveParsingSample(samplesPath, payload, { now: new Date('2026-05-18T05:00:00.000Z') });
      const stored = await readParsingSamples(samplesPath);

      assert.equal(stored.samples.length, 1);
      assert.equal(duplicate.sample.usageCount, 1);
      assert.equal(duplicate.sample.lastUsedAt, '2026-05-18T05:00:00.000Z');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('returns recent samples newest first with a limit', async () => {
    const { tempDir, samplesPath } = await createStorePath();
    try {
      for (let index = 0; index < 10; index += 1) {
        await saveParsingSample(
          samplesPath,
          {
            sourceText: `原文${index}`,
            mode: 'pingma',
            normalizedText: '05号16号27号一个号各下40元',
            formula: '3项 × 40 = 120',
            createdFrom: 'manual_fix',
          },
          { now: new Date(Date.UTC(2026, 4, 18, index, 0, 0)) },
        );
      }

      const recent = await getRecentParsingSamples(samplesPath, 3);

      assert.deepEqual(
        recent.map((sample) => sample.sourceText),
        ['原文9', '原文8', '原文7'],
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('does not fail reads for corrupt JSON and backs it up on save', async () => {
    const { tempDir, samplesPath } = await createStorePath();
    try {
      await writeFile(samplesPath, '{broken', 'utf8');
      const stored = await readParsingSamples(samplesPath);
      assert.deepEqual(stored, { version: 1, samples: [] });

      await saveParsingSample(samplesPath, {
        sourceText: '虎免龙蛇复四三各五十',
        mode: 'zodiacFushi',
        normalizedText: '虎兔龙蛇复四三各50',
        formula: 'C(4,3) × 50 = 200',
        createdFrom: 'manual_fix',
      });

      const files = await readFile(samplesPath, 'utf8');
      assert.match(files, /虎兔龙蛇复四三各50/);
      const directoryEntries = await readdir(tempDir);
      assert.ok(directoryEntries.some((entry) => /^parsing-samples\.corrupt\..+\.json$/.test(entry)));
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

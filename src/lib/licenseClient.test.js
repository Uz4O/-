import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildLicenseHeaders, createBrowserId, toGeneratedCodeRows } from './licenseClient.js';

describe('createBrowserId', () => {
  it('uses crypto.randomUUID when it is available', () => {
    const id = createBrowserId({
      randomUUID: () => 'random-uuid',
      getRandomValues: () => {
        throw new Error('should not use fallback');
      },
    });

    assert.equal(id, 'random-uuid');
  });

  it('falls back when randomUUID is unavailable on an http page', () => {
    const values = [0x12345678, 0x9abcdef0, 0x13572468, 0xfedcba98];
    const id = createBrowserId({
      getRandomValues: (array) => {
        values.forEach((value, index) => {
          array[index] = value;
        });
        return array;
      },
    });

    assert.match(id, /^browser-[a-f0-9-]+$/);
    assert.equal(id, 'browser-12345678-9abcdef0-13572468-fedcba98');
  });
});

describe('toGeneratedCodeRows', () => {
  it('keeps generated card codes copyable with stable row ids', () => {
    const rows = toGeneratedCodeRows(['MK6-AAAA-BBBB-CCCC', 'MK6-DDDD-EEEE-FFFF']);

    assert.deepEqual(rows, [
      { id: 'MK6-AAAA-BBBB-CCCC-0', code: 'MK6-AAAA-BBBB-CCCC' },
      { id: 'MK6-DDDD-EEEE-FFFF-1', code: 'MK6-DDDD-EEEE-FFFF' },
    ]);
  });
});

describe('buildLicenseHeaders', () => {
  it('returns license session headers when both values exist', () => {
    assert.deepEqual(buildLicenseHeaders('card-1', 'browser-1'), {
      'x-license-card-id': 'card-1',
      'x-license-browser-id': 'browser-1',
    });
  });

  it('returns no headers when the session is incomplete', () => {
    assert.deepEqual(buildLicenseHeaders('card-1', ''), {});
    assert.deepEqual(buildLicenseHeaders('', 'browser-1'), {});
  });
});

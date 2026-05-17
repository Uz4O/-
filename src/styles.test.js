import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('result page styles', () => {
  it('does not hide the fourth-page amount summary inside the control column', () => {
    assert.equal(/\.control-column\s*>\s*\.quick-summary\s*\{\s*display:\s*none\s*;?\s*\}/.test(styles), false);
  });
});

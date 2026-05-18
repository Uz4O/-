import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function getRule(selector) {
  const escaped = selector.replaceAll('.', '\\.');
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] || '';
}

describe('result page styles', () => {
  it('does not hide the fourth-page amount summary inside the control column', () => {
    assert.equal(/\.control-column\s*>\s*\.quick-summary\s*\{\s*display:\s*none\s*;?\s*\}/.test(styles), false);
  });
});

describe('mobile-first workbench layout styles', () => {
  it('does not expose the old visible stepper layout', () => {
    assert.equal(/\.stepper\s*\{/.test(styles), false);
    assert.equal(/\.stepper-item\s*\{/.test(styles), false);
  });

  it('keeps screenshot upload in the normal mobile document flow', () => {
    const screenshotPanelRules = Array.from(styles.matchAll(/\.screenshot-panel\s*\{([\s\S]*?)\}/g)).map((match) => match[1]);

    assert.ok(screenshotPanelRules.length > 0);
    assert.equal(screenshotPanelRules.some((rules) => /position\s*:\s*absolute\s*;/.test(rules)), false);
  });

  it('places screenshot input before manual text input in the mobile flow', () => {
    assert.match(getRule('.screenshot-panel'), /order\s*:\s*1\s*;/);
    assert.match(getRule('.text-panel'), /order\s*:\s*2\s*;/);
  });

  it('uses a single-column mobile app surface as the primary layout', () => {
    assert.match(styles, /\.mobile-workspace\s*\{/);
    assert.match(styles, /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/);
  });

  it('promotes result totals as a metric grid before detailed output', () => {
    assert.match(styles, /\.result-metric-grid\s*\{/);
    assert.match(styles, /grid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });
});

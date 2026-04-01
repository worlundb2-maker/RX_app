import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cssPath = resolve(process.cwd(), 'styles.css');
const css = readFileSync(cssPath, 'utf8');

test('row-flagged style uses gradient plus left accent for fast recognition', () => {
  const match = css.match(/\.row-flagged\s*\{([\s\S]*?)\}/);
  assert.ok(match, 'Expected .row-flagged CSS rule to exist.');

  const block = match[1];
  assert.match(block, /background:\s*linear-gradient\(/, 'Expected row-flagged background to use a gradient.');
  assert.match(block, /box-shadow:\s*inset\s+4px\s+0\s+0\s+rgba\(251,\s*191,\s*36,\s*0\.9\)/, 'Expected row-flagged style to include the amber left accent.');
});

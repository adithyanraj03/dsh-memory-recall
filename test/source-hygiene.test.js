// No raw invisible or bidirectional-control characters in this plugin's own
// source. They make code read differently from what it runs ("Trojan Source"),
// and this plugin's job includes catching exactly these characters in memory —
// so its own files must spell every one of them as a visible \uXXXX escape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BAD = new Set([0x200B, 0x200C, 0x200D, 0x2060, 0x2062, 0x2063, 0x2064, 0xFEFF,
  0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069, 0xFDD0, 0xFDD1]);

test('source files spell invisible characters as escapes, never raw', () => {
  const offenders = [];
  for (const dir of ['src', 'lib', 'test']) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!/\.(m?js)$/.test(name)) continue;
      const text = readFileSync(join(ROOT, dir, name), 'utf8');
      const hits = [...new Set([...text].filter((c) => BAD.has(c.codePointAt(0))))];
      if (hits.length) offenders.push(`${dir}/${name}: ${hits.map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(', ')}`);
    }
  }
  assert.deepEqual(offenders, []);
});

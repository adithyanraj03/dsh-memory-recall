// Getting dsh's `defineTool`, however this plugin was installed.
//
// A plugin installed as a copy inside the profile's node_modules can import
// `@deepseek-ai/dsh-tools` by name: that is where dsh's loader makes its own
// packages resolvable. Installed as a LINK (`dsh plugin add /path`, which pnpm
// records as `link:`), Node resolves imports from the plugin's real folder
// instead — outside the profile — and the import fails. It failed silently
// here once: the plugin loaded, told the model about its memory tool, and
// registered none.
//
// So: the ordinary import first; failing that, the copy of dsh-tools inside
// dsh's own installation, found by walking up from dsh's launcher. That is the
// very file dsh loaded, so it is the same module instance, not a second copy.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE = ['node_modules', '@deepseek-ai', 'dsh-tools'];

/** The entry file a package.json names for a plain `import`. */
function entryOf(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const root = pkg.exports?.['.'] ?? pkg.exports;
  const entry = typeof root === 'string' ? root : root?.import ?? root?.default ?? pkg.main ?? 'index.js';
  return join(dir, entry);
}

/**
 * The dsh-tools entry file above `start` (a file or folder), or null.
 * @param {string} start  normally process.argv[1], dsh's bin.js
 */
export function findDshTools(start) {
  if (!start) return null;
  let dir;
  try {
    dir = dirname(realpathSync(start));
  } catch {
    return null;
  }
  for (;;) {
    const candidate = join(dir, ...PACKAGE);
    if (existsSync(join(candidate, 'package.json'))) {
      try {
        const entry = entryOf(candidate);
        if (existsSync(entry)) return entry;
      } catch { /* unreadable package.json: keep looking */ }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * dsh's defineTool. Throws the ORIGINAL import error when neither way works,
 * so the reason logged is the real one.
 * @param {object} [o]
 * @param {() => Promise<object>} [o.importByName]  the ordinary import (a hook for tests)
 * @param {string} [o.launcher]  where dsh was started from
 */
export async function loadDefineTool({ importByName = () => import('@deepseek-ai/dsh-tools'), launcher = process.argv[1] } = {}) {
  try {
    const mod = await importByName();
    if (typeof mod?.defineTool === 'function') return mod.defineTool;
    throw new Error('@deepseek-ai/dsh-tools has no defineTool export');
  } catch (first) {
    const entry = findDshTools(launcher);
    if (entry) {
      const mod = await import(pathToFileURL(entry).href);
      if (typeof mod?.defineTool === 'function') return mod.defineTool;
    }
    throw first;
  }
}

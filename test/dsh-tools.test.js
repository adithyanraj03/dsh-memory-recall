// The bug this guards: installed as a link, `import('@deepseek-ai/dsh-tools')`
// failed, the failure was swallowed, and the model was told about a memory
// tool that was never registered. It then wrote a notes file instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findDshTools, loadDefineTool } from '../src/dsh-tools.js';
import { apply } from '../src/index.js';
import { STATE_PATH } from '../src/routes.js';

/** A fake dsh install: <root>/dsh/lib/bin.js and its node_modules/@deepseek-ai/dsh-tools. */
function fakeDsh() {
  const root = mkdtempSync(join(tmpdir(), 'fake-dsh-'));
  const bin = join(root, 'dsh', 'lib', 'bin.js');
  const pkg = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools');
  mkdirSync(join(root, 'dsh', 'lib'), { recursive: true });
  mkdirSync(join(pkg, 'lib'), { recursive: true });
  writeFileSync(bin, '// dsh');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', type: 'module', exports: { '.': { default: './lib/index.js' } } }));
  writeFileSync(join(pkg, 'lib', 'index.js'), 'export function defineTool(d) { return { ...d, fromFake: true }; }\n');
  return { bin, entry: join(pkg, 'lib', 'index.js') };
}

const importFails = () => Promise.reject(Object.assign(new Error("Cannot find package '@deepseek-ai/dsh-tools'"), { code: 'ERR_MODULE_NOT_FOUND' }));

test('found by walking up from dsh\'s launcher, using the package\'s own export map', () => {
  const { bin, entry } = fakeDsh();
  assert.equal(findDshTools(bin), entry);
  assert.equal(findDshTools(join(tmpdir(), 'no-such-launcher.js')), null);
  assert.equal(findDshTools(undefined), null);
});

test('when the import by name fails, dsh\'s own copy is used', async () => {
  const { bin } = fakeDsh();
  const defineTool = await loadDefineTool({ importByName: importFails, launcher: bin });
  assert.equal(defineTool({ name: 'x' }).fromFake, true);
});

test('when neither works, the ORIGINAL import error is the one reported', async () => {
  await assert.rejects(loadDefineTool({ importByName: importFails, launcher: undefined }), /Cannot find package '@deepseek-ai\/dsh-tools'/);
});

test('the real dsh on this machine resolves, when it is installed', async (t) => {
  const launcher = 'C:/Users/me/AppData/Local/hermes/node/node_modules/@deepseek-ai/dsh/lib/bin.js';
  if (!existsSync(launcher)) return t.skip('dsh is not installed here');
  const defineTool = await loadDefineTool({ importByName: importFails, launcher });
  assert.equal(typeof defineTool, 'function');
});

/* ---- if the tools still fail, nobody is misled ---------------------------- */

async function bootWithoutTools() {
  const sections = [];
  const routes = new Map();
  const handlers = {};
  const ctx = {
    logger: { warn() {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.set(r.path, r); return () => {}; } },
    on: (e, fn) => { (handlers[e] ??= []).push(fn); },
    get: () => undefined,
  };
  const dir = mkdtempSync(join(tmpdir(), 'mem-notools-'));
  await apply(ctx, { dir }, { loadDefineTool: () => importFails() });
  const agentCtx = { inject: (deps, cb) => { if (deps.includes('systemPrompt')) cb({ systemPrompt: { section: (s) => sections.push(s) } }); return { dispose() {} }; } };
  handlers['agent/session-start'][0]({ agent: { id: 'c', session: { header: {} }, ctx: agentCtx } });
  return { sections, routes };
}

test('without tools, the prompt says memory cannot be saved — and names no tool to call', async () => {
  const { sections } = await bootWithoutTools();
  const text = sections[0].text;
  assert.match(text, /failed to load in this dsh/);
  assert.match(text, /Do not substitute a file/);
  assert.doesNotMatch(text, /Save with the `memory` tool/);
});

test('without tools, the Memory panel is told why', async () => {
  const { routes } = await bootWithoutTools();
  const res = { status: 0, body: null, writeHead(s) { this.status = s; }, end(t) { this.body = JSON.parse(t); } };
  await routes.get(STATE_PATH).handler({ method: 'GET', url: STATE_PATH }, res);
  assert.equal(res.body.tools.ok, false);
  assert.match(res.body.tools.error, /Cannot find package/);
});

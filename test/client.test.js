// The browser half, loaded the way dsh loads it: through window.__ModuleLoader__.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function loadClient() {
  let mod;
  const window = { __ModuleLoader__: { load: ({ id, factory }) => { mod = { id, exports: factory(require) }; } } };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: (v) => ({ current: v }),
  };
  function require(name) {
    if (name === 'react') return React;
    throw new Error(`unexpected require ${name}`);
  }
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  new Function('window', source)(window);
  return mod;
}

const settled = (args, text, isError = false) => ({ kind: 'result', call: { argsRaw: JSON.stringify(args) }, content: [{ type: 'text', text }], isError });

test('the module id is the package name (a mismatch mounts nothing)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(loadClient().id, pkg.name);
});

test('chip: running, saved, updated, removed, already, full, blocked', () => {
  const { memoryStatus } = loadClient().exports;
  const add = { target: 'user', action: 'add', content: 'x' };
  assert.equal(memoryStatus({ argsRaw: '{"target":"us' }, {}).label, 'Saving to memory…');
  assert.equal(memoryStatus(settled(add, 'Saved to memory (user profile): added 1.'), add).label, 'Saved to memory');
  const rep = { target: 'memory', action: 'replace', old_text: 'a', content: 'b' };
  assert.equal(memoryStatus(settled(rep, 'Saved to memory (memory): replaced 1.'), rep).label, 'Updated memory');
  const rem = { target: 'memory', action: 'remove', old_text: 'a' };
  assert.equal(memoryStatus(settled(rem, 'Saved to memory (memory): removed 1.'), rem).label, 'Removed from memory');
  assert.equal(memoryStatus(settled(add, 'Already in memory (user profile) — nothing changed.'), add).label, 'Already in memory');
  assert.equal(memoryStatus(settled(add, 'Not saved (memory): … over its budget …'), add).label, 'Memory full — making room');
  assert.equal(memoryStatus(settled(add, 'Blocked — not saved (memory): …'), add).label, 'Memory write blocked');
});

test('chip: the changes and the usage come from the call and its result', () => {
  const { changesOf, usageIn } = loadClient().exports;
  assert.deepEqual(changesOf({ operations: [{ action: 'remove', old_text: 'old' }, { action: 'add', content: 'new' }] }),
    [{ sign: '−', text: 'old' }, { sign: '+', text: 'new' }]);
  assert.deepEqual(changesOf({ action: 'replace', old_text: 'a', content: 'b' }), [{ sign: '~', text: 'b', from: 'a' }]);
  assert.deepEqual(usageIn('Now 42% — 578/1,375 chars, 3 entries.'), { percent: 42, chars: 578, limit: 1375 });
  assert.equal(usageIn('nothing here'), null);
});

test('recall card: follows the host record, and reads the result text after a restart', () => {
  const { recallStatus } = loadClient().exports;
  assert.equal(recallStatus({ status: 'awaiting-approval' }, { argsRaw: '{}' }).label, 'Waiting for your OK to read past chats');
  assert.equal(recallStatus({ status: 'searching' }, { argsRaw: '{}' }).label, 'Searching past chats…');
  assert.equal(recallStatus({ status: 'declined' }, settled({}, '')).label, 'Not allowed — nothing was read');
  assert.equal(recallStatus({ status: 'done' }, settled({}, '')).label, 'Recalled from past chats');
  // No record (dsh restarted since the call): the text decides.
  assert.equal(recallStatus(null, settled({}, 'The user declined reading their past chats.')).label, 'Not allowed — nothing was read');
  assert.equal(recallStatus(null, settled({}, 'Found 2 earlier chat(s) for "x"')).label, 'Recalled from past chats');
  assert.equal(recallStatus(null, settled({}, 'Recall failed: no chat')).label, 'Recall failed');
});

test('mounting: two tool cards, the sidebar entry, the memory context row and the composer chip', () => {
  const { exports } = loadClient();
  assert.deepEqual(exports.inject, ['slots']);
  const registered = [];
  const injected = [];
  const ctx = {
    get: () => undefined,
    slots: {
      inject: (name, make) => { injected.push(name); make(); },
      register: (opts, comp) => { registered.push({ ...opts, comp }); return () => {}; },
    },
  };
  exports.apply(ctx);
  assert.deepEqual(injected, ['tool.call.toolview', 'tool.call.toolview', 'sidebar.footer.action', 'conversation.chat.node', 'conversation.input.right']);
  assert.deepEqual(registered.map((r) => r.key ?? r.id), ['memory', 'session_search', 'dsh-memory-recall', 'context', 'dsh-memory-recall']);
  const node = registered[3];
  assert.equal(node.priority, -10, 'shadows dsh\'s context row without failing it (same priority is refused)');
  assert.equal(node.locale, 'chat', 'dsh\'s own locale namespace, so delegated rows keep their labels');
  const chip = registered[4];
  assert.equal(chip.name, 'conversation.input.right');
  assert.equal(chip.order, 30, 'next to graft (20), left of the model name');
  assert.deepEqual(chip.inject('sess-9'), { sessionId: 'sess-9' });
  assert.ok(registered.every((r) => typeof r.comp === 'function'));
});

test('components render without throwing', () => {
  const { exports } = loadClient();
  const registered = [];
  exports.apply({ get: () => undefined, slots: { inject: (_n, make) => make(), register: (o, c) => registered.push(c) } });
  const [MemoryCall, RecallCall, Sidebar] = registered;
  const add = { target: 'user', action: 'add', content: 'Name is Adithya.' };
  assert.ok(MemoryCall({ callId: 'c1', block: settled(add, 'Saved to memory (user profile): added 1. Now 1% — 16/1,375 chars, 1 entry.') }));
  assert.ok(RecallCall({ callId: 'c2', block: { argsRaw: '{"query":"graft"}' } }));
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  assert.ok(Sidebar());
});

/* ---- the Hermes Desktop look -------------------------------------------------- */

function renderChip(block) {
  const { exports } = loadClient();
  const comps = [];
  exports.apply({ get: () => undefined, slots: { inject: (_n, make) => make(), register: (_o, c) => comps.push(c) } });
  return comps[0]({ callId: 'c', block });
}
function all(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) all(n, pred, out); return out; }
  if (pred(node)) out.push(node);
  const kids = node.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) all(k, pred, out);
  return out;
}
const classed = (tree, name) => all(tree, (n) => String(n.props?.className ?? '').split(' ').includes(name));

test('look: a landed save gets Hermes\'s gold→purple title, tinted glyph and purple meta', () => {
  const tree = renderChip(settled({ target: 'user', action: 'add', content: 'x' }, 'Saved to memory (user profile): added 1.'));
  assert.equal(classed(tree, 'dmr-chip').length, 1);
  assert.equal(classed(tree, 'dmr-legendary-title').length, 1);
  assert.equal(classed(tree, 'dmr-legendary-glyph').length, 1);
  assert.equal(classed(tree, 'dmr-legendary-meta').length, 1);
  assert.equal(classed(tree, 'dmr-land').length, 0, 'a chip from history does not bloom');
});

test('look: while saving, the action word shimmers and nothing is gold yet', () => {
  const tree = renderChip({ argsRaw: '{"target":"user","action":"add"}' });
  const shimmer = classed(tree, 'dmr-shimmer');
  assert.equal(shimmer.length, 1);
  assert.deepEqual(shimmer[0].props.children, ['Saving']);
  assert.equal(classed(tree, 'dmr-legendary-title').length, 0);
});

test('look: failures keep their own colour, not the legendary one', () => {
  for (const text of ['Not saved (memory): over its budget', 'Blocked — not saved (memory): x']) {
    const tree = renderChip(settled({ target: 'memory', action: 'add', content: 'x' }, text));
    assert.equal(classed(tree, 'dmr-legendary-title').length, 0, text);
  }
});

test('look: the palette is Hermes Desktop\'s, verbatim', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  for (const token of ['#c08532', '#db704b', '#9e94d5', '#f5d08a', '#c4b5fd', 'linear-gradient(105deg']) {
    assert.ok(source.includes(token), token);
  }
});

/* ---- @ chats, grouped by workspace --------------------------------------------- */

const DATA = {
  currentWorkspaceId: 'aaaaaaaa-1111-4000-8000-000000000001',
  workspaces: [
    { id: 'aaaaaaaa-1111-4000-8000-000000000001', title: 'Web Search', path: 'C:\\Users\\me\\ws\\Web Search',
      chats: [{ sessionId: 's1', title: 'Drive a real Chrome browser', createdAt: Date.now() - 4 * 86400000 },
              { sessionId: 's2', title: 'This is a tool health check', createdAt: Date.now() - 4 * 86400000 }] },
    { id: 'bbbbbbbb-2222-4000-8000-000000000002', title: 'Flight Combact Simulation', path: 'B:\\Research\\Flight',
      chats: [{ sessionId: 's3', title: 'Flight combat sim', createdAt: Date.now() - 5 * 86400000 }] },
  ],
  ungrouped: [{ sessionId: 's4', title: 'Loose chat about chrome', createdAt: Date.now() - 86400000 }],
};

function chatSource() {
  const { exports } = loadClient();
  globalThis.fetch = async () => ({ ok: true, json: async () => DATA });
  return { exports, source: exports.createChatSource({ get: () => undefined }) };
}
const ask = (source, query) => source.candidates({ sessionId: 'now' }, { query, drilled: false, signal: new AbortController().signal });

test('@: a picked chat inserts exactly the mention dsh itself writes', () => {
  const { exports } = loadClient();
  const id = 'session-cebeb18a-7fea-446b-88f4-31755ef89e32';
  const b64 = Buffer.from(JSON.stringify(id), 'utf8').toString('base64url');
  // dsh escapes a backslash and a closing bracket in the label with a backslash.
  const label = 'A ] b' + String.fromCharCode(92) + ' c';
  const escaped = 'A ' + String.fromCharCode(92) + '] b' + String.fromCharCode(92, 92) + ' c';
  assert.equal(exports.sessionMention(id, label), '@[' + escaped + '](dsh-session:' + b64 + ')');
  const unicode = 'session-' + String.fromCharCode(241) + '-' + String.fromCharCode(0x65e5, 0x672c);
  assert.ok(exports.sessionMention(unicode, 'x').endsWith(Buffer.from(JSON.stringify(unicode), 'utf8').toString('base64url') + ')'));
});

test('@ alone: this workspace and its recent chats, then every other workspace, then loose chats', async () => {
  const { source } = chatSource();
  const rows = await ask(source, '');
  assert.deepEqual(rows.map((r) => [r.section, r.name]), [
    ['This workspace', 'Web Search'],
    ['This workspace', 'Drive a real Chrome browser'],
    ['This workspace', 'This is a tool health check'],
    ['Workspaces', 'Flight Combact Simulation'],
    ['No workspace', 'Loose chat about chrome'],
  ]);
  const ws = rows.find((r) => r.name === 'Flight Combact Simulation');
  assert.equal(ws.icon, 'folder');
  assert.equal(ws.drill, true);
  assert.equal(ws.description, '1 chat · B:\\Research\\Flight');
  assert.equal(rows[0].description, '2 chats · ~\\ws\\Web Search', 'the home folder is shortened');
  assert.equal(rows[1].description, '4d');
});

test('@ + text: matching workspaces first, then chats grouped under their workspace', async () => {
  const { source } = chatSource();
  const rows = await ask(source, 'chrome');
  assert.deepEqual(rows.map((r) => [r.section, r.name]), [
    ['Web Search', 'Drive a real Chrome browser'],
    ['No workspace', 'Loose chat about chrome'],
  ]);
  const byWorkspace = await ask(source, 'flight');
  assert.equal(byWorkspace[0].section, 'Workspaces');
  assert.equal(byWorkspace[0].name, 'Flight Combact Simulation');
});

test('@ drill: a workspace opens to all its chats, with a way back', async () => {
  const { source } = chatSource();
  const [row] = (await ask(source, 'flight')).filter((r) => r.icon === 'folder');
  const drill = source.onPick({ candidate: row, action: 'drill' });
  assert.deepEqual(drill, { text: '@ws:bbbbbbbb/', continue: true });
  const inside = await ask(source, 'ws:bbbbbbbb/');
  assert.deepEqual(inside.map((r) => [r.section, r.name]), [['Flight Combact Simulation', 'Flight combat sim']]);
  const crumbs = source.header({}, { query: 'ws:bbbbbbbb/' });
  assert.deepEqual(crumbs.map((c) => c.label), ['All workspaces', 'Flight Combact Simulation']);
  assert.deepEqual(source.onPick({ candidate: crumbs[0], action: 'drill' }), { text: '@', continue: true });
  assert.equal((await ask(source, 'ws:bbbbbbbb/zzz')).length, 0, 'typing inside a workspace filters its chats');
});

test('@ pick: a chat becomes a session chip; a workspace becomes a folder chip the model can read', async () => {
  const { source, exports } = chatSource();
  const rows = await ask(source, '');
  const chatPick = source.onPick({ candidate: rows[1], action: 'pick' }).insert;
  assert.equal(chatPick.appearance, 'session');
  assert.equal(chatPick.label, 'Drive a real Chrome browser');
  assert.match(chatPick.ref, /^@\[Drive a real Chrome browser\]\(dsh-session:[A-Za-z0-9_-]+\)$/);
  assert.equal(await source.codec.serialize(chatPick.ref), chatPick.ref, "dsh's own reference handling takes it from here");

  const wsPick = source.onPick({ candidate: rows[0], action: 'pick' }).insert;
  assert.equal(wsPick.appearance, 'folder');
  assert.equal(await source.codec.serialize(wsPick.ref), '[workspace "Web Search" — C:\\Users\\me\\ws\\Web Search]');
  assert.equal(exports.workspaceText(wsPick.ref), wsPick.clipboardText);
});

test('@: a quoted @"path" is left to the file list', async () => {
  const { source } = chatSource();
  assert.deepEqual(await source.candidates({ sessionId: 'now' }, { query: 'x', quoted: true, signal: new AbortController().signal }), []);
});

test("@: dsh's own chat rows are hidden, its file rows kept, and restored on unload", async () => {
  const { exports } = loadClient();
  const native = {
    trigger: '@', name: 'reference',
    candidates: async () => [
      { name: 'src/', value: JSON.stringify({ kind: 'file', fileKind: 'directory' }) },
      { name: '8c22434f', value: JSON.stringify({ kind: 'session' }) },
    ],
  };
  const original = native.candidates;
  const restore = exports.hideNativeChats({ live: { sources: [native] } });
  assert.deepEqual((await native.candidates()).map((r) => r.name), ['src/']);
  restore();
  assert.equal(native.candidates, original);
  assert.equal(exports.hideNativeChats({ live: { sources: [] } }), null, 'nothing to wrap: nothing touched');
});

/* ---- the sidebar footer ------------------------------------------------------- */

test('footer: the wrap rule targets the footer as the entry\'s grandparent, as measured live', () => {
  // Live structure (dsh 0.1.5): footerActions (flex row, nowrap) > div[display: contents] > each entry.
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(source.includes('div:has(> * > [data-plugin=\\"dsh-memory-recall-sidebar\\"])'), 'grandchild form');
  assert.ok(source.includes('{flex-wrap:wrap}'), 'wraps rather than turning into a column (a column made each row 114px tall)');
  assert.ok(!source.includes('stackFooter'), 'the one-off runtime stacking is gone');
});

test('footer: the Memory row has the Settings row\'s measurements', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(source.includes('height: 50, margin: 0'), '50px row, no extra margin');
  assert.ok(source.includes('height: 42'), '42px button');
  assert.ok(source.includes('padding: "0 10px 0 8px"'), "Settings' padding");
});

/* ---- the composer chip -------------------------------------------------------- */

test('chip: memory that changed since the chat started is flagged', () => {
  const { briefingView } = loadClient().exports;
  const v = briefingView({ briefed: true, at: Date.now(), source: 'startup', user: 2, memory: 5, changed: true, now: { user: 3, memory: 6 } });
  assert.equal(v.state, 'changed');
  assert.match(v.lines[3], /changed since \(now 3 profile entries · 6 notes\)\. A new chat uses the new version\./);
});

test('chip: a chat not briefed yet says how it will be', () => {
  const { briefingView } = loadClient().exports;
  const none = briefingView({ briefed: false, now: { user: 1, memory: 2 } });
  assert.equal(none.state, 'none');
  assert.equal(none.title, 'Not in this chat yet');
  assert.match(none.lines[1], /send a message and this chat gets them/);
  assert.match(briefingView({ briefed: false, now: { user: 0, memory: 0 } }).lines[1], /Nothing is saved yet/);
  assert.equal(briefingView(null).state, 'none', 'before the first answer');
});

test('chip: renders in each state without throwing', () => {
  const { exports } = loadClient();
  const comps = [];
  exports.apply({ get: () => undefined, slots: { inject: (_n, make) => make(), register: (o, c) => comps.push({ o, c }) } });
  const Chip = comps.find((x) => x.o.name === 'conversation.input.right').c;
  const tree = Chip({ sessionId: 's1' });
  assert.equal(tree.props['data-plugin'], 'dsh-memory-recall-chip-seat');
  const pill = tree.props.children.flat()[0];
  assert.equal(pill.type, 'button');
  assert.equal(pill.props['data-memory-state'], 'none', 'before the host answers');
  assert.equal(pill.props.title, undefined, 'no native tooltip');
});

/* ---- the read card -------------------------------------------------------------- */

test('read card: "Read memory" with what it loaded; busy while reading; no change rows', () => {
  const { memoryStatus, changesOf } = loadClient().exports;
  const args = { action: 'read' };
  assert.equal(memoryStatus({ argsRaw: '{"action":"read"}' }, args).label, 'Reading memory…');
  const text = 'Read memory: 2 profile entries, 5 notes (current version).\n\nUSER PROFILE:\n1. a\n2. b';
  assert.equal(memoryStatus(settled(args, text), args).label, 'Read memory');
  assert.equal(memoryStatus(settled(args, text), args).tone, 'ok', 'the legendary look, like a save');
  assert.equal(memoryStatus(settled(args, 'boom', true), args).label, 'Could not read memory');
  assert.deepEqual(changesOf(args), [], 'a read lists no + / ~ / − rows');
});

test('read card: renders its counts and, opened, the entries it read', () => {
  const { exports } = loadClient();
  const comps = [];
  exports.apply({ get: () => undefined, slots: { inject: (_n, make) => make(), register: (o, c) => comps.push({ o, c }) } });
  const MemoryCall = comps.find((x) => x.o.key === 'memory').c;
  const text = 'Read memory: 1 profile entry, 2 notes (current version).\n\nUSER PROFILE:\n1. Prefers short answers.\n\nNOTES:\n1. Uses pnpm.\n2. Deploys from release.';
  const flat = (node) => JSON.stringify(node);
  const tree = MemoryCall({ callId: 'r1', block: settled({ action: 'read' }, text) });
  assert.match(flat(tree), /Read memory/);
  assert.match(flat(tree), /1 profile · 2 notes/);
});

test('composer chip: the brain icon only, no text', () => {
  const { exports } = loadClient();
  const comps = [];
  exports.apply({ get: () => undefined, slots: { inject: (_n, make) => make(), register: (o, c) => comps.push({ o, c }) } });
  const Chip = comps.find((x) => x.o.name === 'conversation.input.right').c;
  const pill = Chip({ sessionId: 's1' }).props.children.flat()[0];
  const strings = JSON.stringify(pill.props.children).match(/"[A-Za-z][^"]*"/g) || [];
  assert.equal(strings.some((s) => /Memory/.test(s)), false, 'no "Memory" label in the pill');
  assert.equal(pill.props.style.width, 28);
  assert.match(pill.props['aria-label'], /Not in this chat yet|Memory is in this chat/, 'still named for screen readers');
});

test('chip: says how memory was given to this chat, and how much', () => {
  const { briefingView } = loadClient().exports;
  const at = new Date(2026, 8, 25, 10, 42).getTime();
  const v = briefingView({ briefed: true, at, source: 'start', user: 2, memory: 5, changed: false, now: { user: 2, memory: 5 } });
  assert.equal(v.state, 'loaded');
  assert.match(v.lines[0], /^Given to this chat at its start · /);
  assert.equal(v.lines[1], '2 profile entries · 5 notes');
  assert.match(v.lines[2], /Context injection · memory/);
  assert.match(briefingView({ briefed: true, at, source: 'compaction', user: 1, memory: 1, now: { user: 1, memory: 1 } }).lines[0], /^Given again after the chat was compacted/);
  assert.match(briefingView({ briefed: true, at, source: 'update', user: 1, memory: 1, now: { user: 1, memory: 1 } }).lines[0], /^Given again after memory changed/);
});

/* ---- the memory context row ------------------------------------------------------ */

const MEMORY_TEXT = [
  '<system-reminder>',
  'Your persistent memory, carried over from earlier chats.',
  'Use it without being asked: …',
  '',
  '\u2550'.repeat(46),
  'USER PROFILE (who the user is) [2% — 30/1,375 chars]',
  '\u2550'.repeat(46),
  'Prefers short answers.',
  '\u00a7',
  'Works in PowerShell.',
  '',
  '\u2550'.repeat(46),
  'MEMORY (your personal notes) [1% — 10/4,000 chars]',
  '\u2550'.repeat(46),
  'Uses pnpm.',
  '</system-reminder>',
].join('\n');

test('context row: reads the entries back out of a memory message', () => {
  const { parseMemoryText } = loadClient().exports;
  assert.deepEqual(parseMemoryText(MEMORY_TEXT), { user: ['Prefers short answers.', 'Works in PowerShell.'], memory: ['Uses pnpm.'] });
  assert.deepEqual(parseMemoryText('<system-reminder>\n(Nothing is saved yet.)\n</system-reminder>'), { user: [], memory: [] });
});

function contextNode(entries) {
  const { exports } = loadClient();
  const ctx = { get: () => undefined, slots: { entries: () => entries, inject: () => {}, register: () => () => {} } };
  return exports.makeContextNode(ctx);
}
const memoryNode = (reason) => ({ node: { data: { content: [{ type: 'text', text: MEMORY_TEXT }], source: { kind: 'plugin', plugin: 'memory', form: 'notice', reason } } }, t: (k) => k });

test('context row: memory gets its own card — brain, title by reason, counts', () => {
  const Node = contextNode([]);
  const flat = (tree) => JSON.stringify(tree);
  const start = Node(memoryNode('start'));
  const row = start.props ? start : null;
  assert.ok(row, 'rendered');
  // the component wraps MemoryInjectionRow; expand it one level like the renderer would
  const expanded = typeof row.type === 'function' ? row.type(row.props) : row;
  assert.equal(expanded.props['data-plugin'], 'dsh-memory-recall-context');
  assert.match(flat(expanded), /Memory loaded/);
  assert.match(flat(expanded), /2 profile · 1 note/);
  const comp = (reason) => { const r = Node(memoryNode(reason)); return flat(r.type(r.props)); };
  assert.match(comp('compaction'), /Memory reloaded/);
  assert.match(comp('compaction'), /after compaction · 2 profile · 1 note/);
  assert.match(comp('update'), /Memory updated/);
});

test('context row: every other context row is dsh\'s own component, with the same props', () => {
  const Shipped = (props) => ({ type: 'shipped', props });
  const Node = contextNode([{ key: 'user', component: () => null, priority: 0 }, { key: 'context', component: Shipped, priority: 0 }]);
  const props = { node: { data: { content: [], source: { kind: 'skill-catalog' } } }, t: (k) => k, extra: 1 };
  const out = Node(props);
  assert.equal(out.type, Shipped, 'dsh\'s renderer');
  assert.equal(out.props.node, props.node);
  assert.equal(out.props.t, props.t);
  assert.equal(out.props.extra, 1);
});

test('context row: without dsh\'s component, a plain row stands in rather than nothing', () => {
  const Node = contextNode([]);
  const out = Node({ node: { data: { content: [{ type: 'text', text: 'catalog text' }], source: { kind: 'skill-catalog' }, provenance: { label: 'skill-catalog' } } } });
  assert.equal(typeof out.type, 'function');
  assert.match(JSON.stringify(out.type(out.props)), /Context injection · skill-catalog/);
});

/* ---- display settings in the Memory panel ------------------------------------------ */

/** The client with a browser-ish window: localStorage and window events. */
function loadClientWithStorage() {
  const store = new Map();
  const listeners = {};
  let mod;
  const window = {
    __ModuleLoader__: { load: ({ id, factory }) => { mod = { id, exports: factory(require) }; } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    addEventListener: (t, fn) => { (listeners[t] ||= new Set()).add(fn); },
    removeEventListener: (t, fn) => { listeners[t]?.delete(fn); },
    dispatchEvent: (e) => { for (const fn of listeners[e.type] || []) fn(e); return true; },
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: (v) => ({ current: v }),
  };
  function require(name) {
    if (name === 'react') return React;
    throw new Error(`unexpected require ${name}`);
  }
  new Function('window', readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))(window);
  return { exports: mod.exports, store, listeners };
}

test('settings: everything is on by default; a switch is saved and announced', () => {
  const { exports, store, listeners } = loadClientWithStorage();
  assert.deepEqual(exports.readUi(), { composerButton: true, atMenu: true });
  assert.deepEqual(exports.UI_SWITCHES.map((s) => s.key), ['composerButton', 'atMenu']);
  let heard = 0;
  listeners['dsh-memory-recall:ui'] = new Set([() => { heard += 1; }]);
  exports.writeUi({ composerButton: false });
  assert.equal(heard, 1, 'open views are told at once');
  assert.deepEqual(JSON.parse(store.get('dsh-memory-recall:ui')), { composerButton: false, atMenu: true });
  assert.equal(exports.readUi().composerButton, false);
});

test('settings: a broken or missing store falls back to the defaults', () => {
  const { exports, store } = loadClientWithStorage();
  store.set('dsh-memory-recall:ui', '{not json');
  assert.deepEqual(exports.readUi(), { composerButton: true, atMenu: true });
  assert.deepEqual(loadClient().exports.readUi(), { composerButton: true, atMenu: true }, 'no localStorage at all');
});

test('settings: the brain button hides when switched off', () => {
  const { exports } = loadClientWithStorage();
  const comps = [];
  exports.apply({ get: () => undefined, slots: { inject: (_n, make) => make(), register: (o, c) => comps.push({ o, c }) } });
  const Chip = comps.find((x) => x.o.name === 'conversation.input.right').c;
  assert.ok(Chip({ sessionId: 's1' }), 'shown by default');
  exports.writeUi({ composerButton: false });
  assert.equal(Chip({ sessionId: 's1' }), null);
});

test('settings: the memory card has no switch — the memory row is always the card', () => {
  const { exports, store } = loadClientWithStorage();
  store.set('dsh-memory-recall:ui', JSON.stringify({ contextCard: false, composerButton: true }));
  assert.deepEqual(exports.readUi(), { composerButton: true, atMenu: true }, 'an old saved switch is ignored');
  const Shipped = (props) => ({ type: 'shipped', props });
  const Node = exports.makeContextNode({ slots: { entries: () => [{ key: 'context', component: Shipped, priority: 0 }] } });
  const props = { node: { data: { content: [{ type: 'text', text: '<system-reminder>\n</system-reminder>' }], source: { kind: 'plugin', plugin: 'memory', reason: 'start' } } } };
  assert.notEqual(Node(props).type, Shipped);
});

test('settings: with @ off, the plugin lists nothing and dsh\'s own chat rows come back', async () => {
  const { exports } = loadClientWithStorage();
  globalThis.fetch = async () => ({ ok: true, json: async () => DATA });
  const source = exports.createChatSource({ get: () => undefined });
  const native = {
    trigger: '@', name: 'reference',
    candidates: async () => [{ name: 'src/', value: JSON.stringify({ kind: 'file' }) }, { name: 'chat', value: JSON.stringify({ kind: 'session' }) }],
  };
  exports.hideNativeChats({ live: { sources: [native] } });
  assert.deepEqual((await native.candidates()).map((r) => r.name), ['src/'], 'on: dsh\'s chat rows hidden');
  exports.writeUi({ atMenu: false });
  assert.deepEqual((await native.candidates()).map((r) => r.name), ['src/', 'chat'], 'off: back');
  assert.deepEqual(await source.candidates({ sessionId: 'now' }, { query: 'chrome', drilled: false, signal: new AbortController().signal }), []);
});

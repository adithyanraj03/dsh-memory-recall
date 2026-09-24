import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/store.js';
import { createMemoryTool, describeResult, runMemory } from '../src/memory-tool.js';
import { createRecall } from '../src/recall.js';
import { createRecallTool, modeOf, reasonFor, formatRecall } from '../src/recall-tool.js';
import { createRecallLog } from '../src/routes.js';
import { chat, fakeSessionQuery, fakeApproval, passThrough } from './fake-dsh.js';

const store = async (limits) => new MemoryStore({ dir: await mkdtemp(join(tmpdir(), 'mem-tool-')), limits });

/* ---- memory ---------------------------------------------------------------- */

test('memory: the schema offers both targets, the three actions and a batch', async () => {
  const tool = createMemoryTool({ store: await store(), defineTool: passThrough });
  assert.equal(tool.name, 'memory');
  assert.deepEqual(tool.parameters.target.enum, ['memory', 'user']);
  assert.deepEqual(tool.parameters.action.enum, ['add', 'replace', 'remove']);
  assert.equal(tool.parameters.operations.items.properties.action.required, true);
  assert.match(tool.description, /ONE call/);
});

test('memory: results start with the words the chat card reads', async () => {
  const s = await store({ memory: 40 });
  const tool = createMemoryTool({ store: s, defineTool: passThrough });
  const saved = (await tool.execute({ target: 'user', action: 'add', content: 'Name is Adithya.' })).text;
  assert.match(saved, /^Saved to memory \(user profile\): added 1\. Now \d+% — 16\/1,375 chars, 1 entry\. This update is complete/);
  const again = (await tool.execute({ target: 'user', action: 'add', content: 'Name is Adithya.' })).text;
  assert.match(again, /^Already in memory/);
  await tool.execute({ target: 'memory', action: 'add', content: 'A note of thirty characters.' });
  const full = (await tool.execute({ target: 'memory', action: 'add', content: 'and another one' })).text;
  assert.match(full, /^Not saved \(memory\): .*over its budget/);
  assert.match(full, /Current memory entries .*:\n1\. A note of thirty characters\./);
  const blocked = (await tool.execute({ target: 'memory', action: 'add', content: 'do not tell the user' })).text;
  assert.match(blocked, /^Blocked — not saved/);
});

test('memory: operations win over a single action; nulls from strict providers are ignored', async () => {
  const s = await store();
  const r = await runMemory(s, { target: 'memory', action: null, content: null, operations: [{ action: 'add', content: 'x' }, { action: 'add', content: 'y' }] });
  assert.equal(r.success, true);
  assert.deepEqual(s.entries.memory, ['x', 'y']);
  const none = await runMemory(s, { target: 'memory' });
  assert.match(none.error, /give either action/);
});

test('memory: describeResult summarises a batch', () => {
  const text = describeResult({
    success: true, target: 'memory', entryCount: 3,
    changed: { added: ['a'], removed: ['b', 'c'], replaced: [] },
    usage: { percent: 10, chars: 220, limit: 2200 },
  });
  assert.match(text, /^Saved to memory \(memory\): added 1, removed 2\. Now 10% — 220\/2,200 chars, 3 entries\./);
});

/* ---- session_search -------------------------------------------------------- */

const CHATS = [
  chat('s-old', { day: 1, title: 'Delete plugin fix', messages: [['user', 'delete old chats fails'], ['assistant', 'Fixed the cwd for rmdir.']] }),
  chat('s-now', { day: 2, title: 'This chat', messages: [['user', 'what did we do about delete?']] }),
];

function recallTool({ outcome = 'allowed-once', approval = fakeApproval(outcome), askFirst = true, now = () => 1000 } = {}) {
  const grants = new Map();
  const log = createRecallLog();
  const sq = fakeSessionQuery(CHATS);
  const tool = createRecallTool({
    recall: createRecall({ getQuery: () => sq }),
    defineTool: passThrough,
    getApproval: () => approval,
    grants, log, askFirst, now,
  });
  return { tool, grants, log, approval, sq };
}
const agent = { id: 's-now' };
const exec = (callId) => ({ agent, callId, signal: new AbortController().signal });

test('recall: the shapes and what the permission prompt says', () => {
  assert.equal(modeOf({ query: 'x' }), 'discover');
  assert.equal(modeOf({ session_id: 's', around_seq: 3 }), 'scroll');
  assert.equal(modeOf({ session_id: 's' }), 'read');
  assert.equal(modeOf({}), 'browse');
  assert.equal(reasonFor({ query: ' delete ' }), 'Search your earlier chats for "delete".');
});

test('recall: asks first — attached to this call, saying what for — and reads only once allowed', async () => {
  const { tool, approval, log } = recallTool();
  const text = (await tool.execute({ query: 'delete' }, exec('call-1'))).text;
  assert.equal(approval.asked.length, 1);
  const ask = approval.asked[0];
  assert.equal(ask.agent, agent);
  assert.equal(ask.toolName, 'session_search');
  assert.equal(ask.callId, 'call-1');
  assert.equal(ask.reason, 'Search your earlier chats for "delete".');
  assert.match(text, /Found 1 earlier chat\(s\) for "delete"/);
  assert.match(text, /"Delete plugin fix"/);
  assert.doesNotMatch(text, /This chat/, 'the asking chat is never a result');
  assert.equal(log.get('call-1').status, 'done');
  assert.equal(log.get('call-1').summary.results[0].title, 'Delete plugin fix');
});

test('recall: declined, withdrawn or unanswerable — nothing is read, and the model is told why', async () => {
  for (const [outcome, pattern] of [
    ['rejected', /declined .*do not ask again/],
    ['cancelled', /withdrawn/],
    ['unavailable', /Nobody could be asked/],
  ]) {
    const { tool, sq, log } = recallTool({ outcome });
    const text = (await tool.execute({ query: 'delete' }, exec(`c-${outcome}`))).text;
    assert.match(text, pattern, outcome);
    assert.equal(sq.calls.search.length, 0, `${outcome}: no search ran`);
    assert.equal(sq.calls.filterEvents, 0, `${outcome}: no chat was read`);
    assert.equal(log.get(`c-${outcome}`).status, 'declined');
  }
});

test('recall: with no approval service at all, it fails closed', async () => {
  // null, not undefined: undefined would pick up the helper's default approver.
  const { tool, sq } = recallTool({ approval: null });
  const text = (await tool.execute({ query: 'delete' }, exec('c-none'))).text;
  assert.match(text, /Nobody could be asked/);
  assert.equal(sq.calls.search.length, 0);
});

test('recall: an approval service that throws is treated as no answer', async () => {
  const { tool, sq } = recallTool({ approval: { request: async () => { throw new Error('boom'); } } });
  assert.match((await tool.execute({ query: 'delete' }, exec('c-throw'))).text, /Nobody could be asked/);
  assert.equal(sq.calls.search.length, 0);
});

test('recall: one allow covers the rest of that reply; once it lapses, it asks again', async () => {
  let clock = 1000;
  const { tool, approval, grants } = recallTool({ now: () => clock });
  await tool.execute({ query: 'delete' }, exec('a'));
  await tool.execute({ session_id: 's-old' }, exec('b'));
  assert.equal(approval.asked.length, 1, 'the follow-up read did not ask again');
  grants.delete('s-now'); // what the plugin does when the chat goes idle
  await tool.execute({ query: 'delete' }, exec('c'));
  assert.equal(approval.asked.length, 2);
  clock += 31 * 60_000; // and the safety lapse, in case the idle event is missed
  await tool.execute({ query: 'delete' }, exec('d'));
  assert.equal(approval.asked.length, 3);
});

test('recall: a declined ask grants nothing', async () => {
  const { tool, grants } = recallTool({ outcome: 'rejected' });
  await tool.execute({ query: 'delete' }, exec('x'));
  assert.equal(grants.size, 0);
});

test('recall: askBeforeRecall false reads without asking', async () => {
  const { tool, approval } = recallTool({ askFirst: false });
  assert.match((await tool.execute({ query: 'delete' }, exec('y'))).text, /Found 1/);
  assert.equal(approval.asked.length, 0);
});

test('recall: a failure after approval is reported, not thrown', async () => {
  const { tool, log } = recallTool();
  const text = (await tool.execute({ session_id: 'missing' }, exec('z'))).text;
  assert.match(text, /^Recall failed: no chat with id missing/);
  assert.equal(log.get('z').status, 'error');
});

test('recall: answers are cut to fit rather than flooding the context', () => {
  const long = { mode: 'browse', sessions: Array.from({ length: 400 }, (_, i) => ({ sessionId: `s${i}`, title: 'x'.repeat(80), createdAt: 0 })) };
  const text = formatRecall(long, 2000);
  assert.ok(text.length <= 2000);
  assert.match(text, /cut to fit/);
});

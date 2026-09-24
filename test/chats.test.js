import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatIndex, samePath, labelFrom } from '../src/chats.js';
import { chatsFor } from '../src/routes.js';
import { createRecall } from '../src/recall.js';
import { createRecallTool } from '../src/recall-tool.js';
import { createRecallLog } from '../src/routes.js';
import { chat, fakeSessionQuery, fakeApproval, passThrough } from './fake-dsh.js';

const WEB = 'B:\\Research\\Dsh Plugins\\Web Search';
const FLIGHT = 'B:\\Research\\Local_LLmtest\\Flight Combact Simulation';

const CHATS = [
  chat('s-web-1', { day: 1, cwd: WEB, title: 'Drive a real Chrome browser', messages: [['user', 'drive chrome'], ['assistant', 'ok']] }),
  chat('s-web-2', { day: 2, cwd: WEB, messages: [['user', 'This is a tool health check for the delete plugin'], ['assistant', 'fine']] }),
  chat('s-flight', { day: 3, cwd: FLIGHT, title: 'Flight combat sim', messages: [['user', 'build the dogfight'], ['assistant', 'on it']] }),
  chat('s-worker', { day: 3, cwd: FLIGHT, parentSession: 's-flight', origin: 'subagent', messages: [['user', 'worker task']] }),
  chat('s-lost', { day: 4, cwd: 'C:\\elsewhere', title: 'No workspace chat', messages: [['user', 'hello']] }),
  chat('s-late', { day: 5, cwd: WEB.toLowerCase() + '\\', title: 'Registry has not caught up', messages: [['user', 'x']] }),
];

const REGISTRY = [
  { id: '3f2a9c1d-0000-4000-8000-000000000001', title: 'Web Search', path: WEB, sessionIds: ['s-web-2', 's-web-1'] },
  { id: '7b1e0000-0000-4000-8000-000000000002', title: 'Flight Combact Simulation', path: FLIGHT, sessionIds: ['s-flight', 's-worker'] },
  { id: '99990000-0000-4000-8000-000000000003', title: 'Empty', path: 'D:\\empty', sessionIds: [] },
];

const index = (chats = CHATS, registry = REGISTRY) =>
  createChatIndex({ getQuery: () => fakeSessionQuery(chats), getWorkspaces: () => ({ list: () => registry }) });

test('paths compare the way Windows does', () => {
  assert.equal(samePath('B:\\A\\b\\', 'b:/a/B', 'win32'), true);
  assert.equal(samePath('/a/b', '/a/B', 'linux'), false);
  assert.equal(labelFrom('  one\n two  '), 'one two');
});

test('index: grouped under the sidebar titles, sub-agents hidden, empty workspaces dropped', async () => {
  const { workspaces, ungrouped } = await index().list();
  assert.deepEqual(workspaces.map((w) => w.title), ['Web Search', 'Flight Combact Simulation']);
  const ids = workspaces.flatMap((w) => w.chats.map((c) => c.sessionId));
  assert.ok(!ids.includes('s-worker'), 'the sub-agent session is not a chat to mention');
  assert.deepEqual(ungrouped.map((c) => c.sessionId), ['s-lost']);
});

test('index: an untitled chat is named by its first message', async () => {
  const { workspaces } = await index().list();
  const web = workspaces[0].chats.find((c) => c.sessionId === 's-web-2');
  assert.equal(web.title, 'This is a tool health check for the delete plugin');
  assert.equal(web.fromMessage, true);
});

test('index: a chat whose folder matches joins its workspace before the registry records it', async () => {
  const { workspaces } = await index().list();
  assert.ok(workspaces[0].chats.some((c) => c.sessionId === 's-late'));
});

test('index: resolve a workspace by id, folder, title or part of a title', async () => {
  const idx = index();
  assert.equal((await idx.resolveWorkspace('Web Search')).path, WEB);
  assert.equal((await idx.resolveWorkspace('b:/research/dsh plugins/web search')).title, 'Web Search');
  assert.equal((await idx.resolveWorkspace('flight')).title, 'Flight Combact Simulation');
  assert.equal(await idx.resolveWorkspace('nope'), null);
});

test('route view: the asking chat is left out and its workspace is named', async () => {
  const view = await chatsFor(index(), 's-web-1');
  assert.equal(view.currentWorkspaceId, REGISTRY[0].id);
  assert.ok(!view.workspaces[0].chats.some((c) => c.sessionId === 's-web-1'));
  const fromCwd = await chatsFor(index(), 's-brand-new', async () => FLIGHT);
  assert.equal(fromCwd.currentWorkspaceId, REGISTRY[1].id, 'a new chat is placed by its folder');
});

test('index: without a workspace registry everything is ungrouped, nothing breaks', async () => {
  const idx = createChatIndex({ getQuery: () => fakeSessionQuery(CHATS), getWorkspaces: () => undefined });
  const { workspaces, ungrouped } = await idx.list();
  assert.equal(workspaces.length, 0);
  assert.equal(ungrouped.length, 5);
});

/* ---- session_search, scoped to a workspace -------------------------------- */

function scopedTool(approval = fakeApproval()) {
  const idx = index();
  const sq = fakeSessionQuery(CHATS);
  const log = createRecallLog();
  const tool = createRecallTool({
    recall: createRecall({ getQuery: () => sq }),
    defineTool: passThrough,
    getApproval: () => approval,
    grants: new Map(),
    log,
    resolveWorkspace: (n) => idx.resolveWorkspace(n),
    listWorkspaces: async () => (await idx.list()).workspaces,
  });
  return { tool, approval, sq, log };
}
const exec = (id) => ({ agent: { id: 's-now' }, callId: id, signal: new AbortController().signal });

test('recall: a workspace narrows the search and is named in the permission prompt', async () => {
  const everywhere = (await scopedTool().tool.execute({ query: 'o' }, exec('a'))).text;
  assert.match(everywhere, /Flight combat sim|Drive a real Chrome/);
  // A fresh reply: within one reply, the first allow would cover this call too.
  const { tool, approval } = scopedTool();
  const text = (await tool.execute({ query: 'chrome', workspace: 'Web Search' }, exec('b'))).text;
  assert.match(text, /in workspace "Web Search"/);
  assert.doesNotMatch(text, /Flight combat sim/);
  assert.equal(approval.asked.at(-1).reason, 'Search your earlier chats in "Web Search" for "chrome".');
});

test('recall: a workspace with no match says so, scoped', async () => {
  const { tool } = scopedTool();
  const text = (await tool.execute({ query: 'dogfight', workspace: 'Web Search' }, exec('c'))).text;
  assert.match(text, /No earlier chat in workspace "Web Search" matches "dogfight"/);
});

test('recall: listing a workspace lists only its chats', async () => {
  const { tool } = scopedTool();
  const text = (await tool.execute({ workspace: 'flight' }, exec('d'))).text;
  assert.match(text, /Most recent earlier chats in workspace "Flight Combact Simulation":/);
  assert.match(text, /Flight combat sim/);
  assert.doesNotMatch(text, /Chrome/);
});

test('recall: an unknown workspace names the real ones, asks nothing and reads nothing', async () => {
  const { tool, approval, sq } = scopedTool();
  const text = (await tool.execute({ query: 'x', workspace: 'Nope' }, exec('e'))).text;
  assert.match(text, /No workspace called "Nope"\. Workspaces: "Web Search", "Flight Combact Simulation"\. Nothing was read\./);
  assert.equal(approval.asked.length, 0);
  assert.equal(sq.calls.search.length, 0);
});

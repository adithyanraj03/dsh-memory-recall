// Host routes for the browser half, and the per-call record the recall card reads.
//
//   GET  /plugin-data/dsh-memory-recall/state            → both stores: entries, usage, limits, budgets
//   POST /plugin-data/dsh-memory-recall/entry            → an edit made in the Memory panel
//   GET  /plugin-data/dsh-memory-recall/settings         → the budgets, their defaults and the slider bounds
//   POST /plugin-data/dsh-memory-recall/settings         → a budget moved in the panel, or {reset:true}
//   GET  /plugin-data/dsh-memory-recall/recall?callId=…  → what one session_search call did
//   GET  /plugin-data/dsh-memory-recall/chats?session=…  → every chat, grouped by workspace, for the @ menu
//   GET  /plugin-data/dsh-memory-recall/briefing?session=… → whether that chat's prompt has memory, and which
//
// Edits from the panel are the user's own words, so they skip the injection
// scan the model's writes go through — but not the budget: an over-full store
// would be cut from nothing, silently, in the next prompt.

export const BASE = '/plugin-data/dsh-memory-recall';
export const STATE_PATH = `${BASE}/state`;
export const ENTRY_PATH = `${BASE}/entry`;
export const SETTINGS_PATH = `${BASE}/settings`;
export const RECALL_PATH = `${BASE}/recall`;
export const CHATS_PATH = `${BASE}/chats`;
export const BRIEFING_PATH = `${BASE}/briefing`;

/** A short fingerprint of both stores, to tell whether memory changed since a chat was briefed. */
export function digestOf(stores = {}) {
  const text = JSON.stringify([stores.user ?? [], stores.memory ?? []]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}

/**
 * What each chat's prompt was given, by session id: when, why (a new chat,
 * or one reopened after a restart), how many entries, and a fingerprint.
 * Held in memory only — after a dsh restart a chat is briefed again when it
 * is reopened, and recorded again then. Bounded, oldest out first.
 */
export function createBriefings(cap = 500, now = () => Date.now()) {
  const byId = new Map();
  return {
    record(sessionId, stores, source) {
      byId.delete(sessionId);
      byId.set(sessionId, {
        at: now(),
        source: ['start', 'compaction', 'update', 'resume'].includes(source) ? source : 'start',
        user: (stores.user ?? []).length,
        memory: (stores.memory ?? []).length,
        digest: digestOf(stores),
      });
      while (byId.size > cap) byId.delete(byId.keys().next().value);
    },
    get: (sessionId) => byId.get(sessionId) ?? null,
  };
}

/** The chip's view of one chat: briefed or not, and whether memory moved on since. */
export async function briefingOf(briefings, store, sessionId) {
  const current = await store.load();
  const now = { user: (current.user ?? []).length, memory: (current.memory ?? []).length };
  const rec = sessionId ? briefings?.get(sessionId) : null;
  if (!rec) return { briefed: false, now };
  return { briefed: true, ...rec, changed: digestOf(current) !== rec.digest, now };
}

/** What the recall card needs from a result — titles and snippets, not whole chats. */
export function summarize(result) {
  if (!result) return null;
  const brief = (s) => ({ sessionId: s.sessionId, title: s.title, createdAt: s.createdAt, cwd: s.cwd });
  switch (result.mode) {
    case 'discover':
      return {
        mode: 'discover', engine: result.engine, query: result.query, widened: result.widened,
        results: result.results.map((r) => ({ ...brief(r), snippet: r.match.snippet, matchedWords: r.matchedWords })),
      };
    case 'scroll': return { mode: 'scroll', session: brief(result.session), count: result.messages.length };
    case 'read': return { mode: 'read', session: brief(result.session), count: result.total };
    case 'browse': return { mode: 'browse', sessions: result.sessions.map(brief) };
    default: return null;
  }
}

/** A bounded map of recent session_search calls, by call id. */
export function createRecallLog(cap = 100, now = () => Date.now()) {
  const calls = new Map();
  return {
    start(callId, info) {
      if (!callId) return;
      calls.set(callId, { ...info, status: 'starting', startedAt: now() });
      while (calls.size > cap) calls.delete(calls.keys().next().value);
    },
    update(callId, patch) {
      const entry = callId ? calls.get(callId) : undefined;
      if (!entry) return;
      const { result, ...rest } = patch;
      Object.assign(entry, rest, result ? { summary: summarize(result) } : {}, { updatedAt: now() });
    },
    get: (callId) => calls.get(callId) ?? null,
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let text = '';
  for await (const chunk of req ?? []) text += chunk;
  if (!text) return {};
  try { return JSON.parse(text); } catch { return null; }
}

/** Both stores as the panel shows them. Re-read from disk, so a hand edit shows at once. */
export async function stateOf(store, tooling = null) {
  await store.load();
  const one = (target) => ({ entries: store.entries[target], usage: store.usage(target) });
  return { dir: store.dir, user: one('user'), memory: one('memory'), budgets: store.limitsState(), ...(tooling ? { tools: { ...tooling } } : {}) };
}

/**
 * The @ menu's view of the chat index: the asking chat left out (mentioning
 * the chat you are in is pointless), and its workspace named so the menu can
 * list that one first.
 */
export async function chatsFor(chatIndex, sessionId, cwdOf = async () => null) {
  const index = await chatIndex.list();
  const without = (chats) => chats.filter((c) => c.sessionId !== sessionId);
  let current = sessionId ? chatIndex.workspaceOf(index, sessionId, null) : null;
  if (!current && sessionId) current = chatIndex.workspaceOf(index, sessionId, await cwdOf(sessionId));
  return {
    currentWorkspaceId: current?.id ?? null,
    workspaces: index.workspaces
      .map((w) => ({ id: w.id, title: w.title, path: w.path, chats: without(w.chats) }))
      .filter((w) => w.chats.length),
    ungrouped: without(index.ungrouped),
  };
}

/**
 * @param {object} webServer ctx.webServer
 * @param {object} p {store, log, chatIndex?, cwdOf?}
 * @returns {() => void} disposer
 */
export function registerRoutes(webServer, { store, log, chatIndex, cwdOf, tooling, briefings = null }) {
  const off = [];
  off.push(webServer.register({
    kind: 'exact',
    path: STATE_PATH,
    handler: async (req = {}, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      try {
        sendJson(res, 200, await stateOf(store, tooling));
      } catch (error) {
        sendJson(res, 500, { error: `could not read memory: ${error?.message ?? error}` });
      }
    },
  }));
  off.push(webServer.register({
    kind: 'exact',
    path: ENTRY_PATH,
    handler: async (req = {}, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'the body must be a JSON object' });
      const { target, action, content, old_text: oldText } = body;
      let result;
      if (action === 'add') result = await store.add(target, content, { scan: false });
      else if (action === 'replace') result = await store.replace(target, oldText, content, { scan: false });
      else if (action === 'remove') result = await store.remove(target, oldText);
      else return sendJson(res, 400, { error: "action must be 'add', 'replace' or 'remove'" });
      sendJson(res, result.success ? 200 : 400, { result, state: await stateOf(store, tooling) });
    },
  }));
  off.push(webServer.register({
    kind: 'exact',
    path: SETTINGS_PATH,
    handler: async (req = {}, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method === 'GET') return sendJson(res, 200, store.limitsState());
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const body = await readBody(req);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'the body must be a JSON object' });
      if (body.reset === true) {
        const out = await store.resetLimits();
        return sendJson(res, out.success ? 200 : 400, { ...out, state: await stateOf(store, tooling) });
      }
      const limits = body.limits;
      if (!limits || typeof limits !== 'object') return sendJson(res, 400, { error: 'the body must be {limits:{memory?,user?}} or {reset:true}' });
      // Each target applies on its own; a later bad one does not undo an earlier good one.
      for (const [target, value] of Object.entries(limits)) {
        const out = await store.setLimit(target, value);
        if (!out.success) return sendJson(res, 400, { error: out.error });
      }
      sendJson(res, 200, { ...store.limitsState(), state: await stateOf(store, tooling) });
    },
  }));
  off.push(webServer.register({
    kind: 'exact',
    path: RECALL_PATH,
    handler: async (req = {}, res) => {
      const callId = new URL(req.url ?? '/', 'http://x').searchParams.get('callId');
      if (!callId) return sendJson(res, 400, { error: 'missing callId' });
      const entry = log.get(callId);
      sendJson(res, entry ? 200 : 404, entry ?? { error: 'no record of that call (dsh may have restarted since)' });
    },
  }));
  off.push(webServer.register({
    kind: 'exact',
    path: BRIEFING_PATH,
    handler: async (req = {}, res) => {
      if ((req.method || 'GET').toUpperCase() !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      const sessionId = new URL(req.url ?? '/', 'http://x').searchParams.get('session');
      sendJson(res, 200, await briefingOf(briefings, store, sessionId));
    },
  }));
  if (chatIndex) {
    off.push(webServer.register({
      kind: 'exact',
      path: CHATS_PATH,
      handler: async (req = {}, res) => {
        if ((req.method || 'GET').toUpperCase() !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const sessionId = new URL(req.url ?? '/', 'http://x').searchParams.get('session');
        try {
          sendJson(res, 200, await chatsFor(chatIndex, sessionId, cwdOf));
        } catch (error) {
          sendJson(res, 503, { error: String(error?.message ?? error) });
        }
      },
    }));
  }
  return () => { for (const dispose of off) dispose(); };
}

// Every chat the user can @-mention, grouped by the workspace it belongs to.
//
// dsh's own @ list shows at most 50 sessions and includes sub-agent sessions
// — the model's workers, which have no titles and show as raw ids — so real
// chats get pushed out by them. This index lists only the user's own
// top-level chats, all of them, under the workspace titles the sidebar shows,
// and gives every chat a readable name: its title, or failing that the start
// of its first message.
//
// Workspaces come from dsh's workspace registry (same titles and order as the
// sidebar); a chat in no workspace is listed under "No workspace". The whole
// index is cached briefly — the @ menu asks on every keystroke — and first
// messages are cached for good, since a chat's first message never changes.

const CACHE_MS = 15_000;
const LABEL_CHARS = 70;

const isRoot = (header) => header && !header.parentSession && header.origin !== 'subagent';

/** One line of text, cut to fit a menu row. */
export function labelFrom(text, max = LABEL_CHARS) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Case-insensitive path equality on Windows, exact elsewhere; trailing separators ignored. */
export function samePath(a, b, platform = process.platform) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const norm = (p) => p.replace(/[\\/]+$/, '').replace(/\//g, '\\');
  return platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

/**
 * @param {object} p
 * @param {() => object|undefined} p.getQuery       ctx.sessionQuery
 * @param {() => object|undefined} p.getWorkspaces  ctx.workspaceRegistry
 * @param {() => number} [p.now]
 */
export function createChatIndex({ getQuery, getWorkspaces, now = () => Date.now() }) {
  const firstMessages = new Map(); // sessionId → label (or '' when there is none)
  let cached = null;

  async function firstMessageOf(query, id) {
    if (firstMessages.has(id)) return firstMessages.get(id);
    let label = '';
    try {
      const docs = await query.filterEvents(id, [{ kind: 'type', values: ['user/message'] }, { kind: 'seq', from: 0, to: 200 }]);
      const first = [...(docs ?? [])].sort((a, b) => a.seq - b.seq).find((d) => String(d.text ?? '').trim());
      label = first ? labelFrom(first.text) : '';
    } catch { /* unreadable: stays untitled */ }
    firstMessages.set(id, label);
    return label;
  }

  async function titlesOf(query, ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 100) {
      try {
        const rows = await query.readTitleSnapshots(ids.slice(i, i + 100));
        for (const row of rows ?? []) {
          if (row?.status === 'fulfilled' && row.value?.title?.title) out.set(row.sessionId, row.value.title.title);
        }
      } catch { /* a failed batch leaves its chats to the fallback */ }
    }
    return out;
  }

  /** Run `fn` over `items`, at most `limit` at a time. */
  async function pooled(items, limit, fn) {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await fn(item);
      }
    });
    await Promise.all(workers);
  }

  async function build() {
    const query = getQuery();
    if (!query || typeof query.listSessions !== 'function') throw new Error("dsh's session query service is not available");
    const headers = (await query.listSessions()).map((r) => r.header).filter(isRoot);
    const byId = new Map(headers.map((h) => [h.id, h]));
    const titles = await titlesOf(query, headers.map((h) => h.id));
    const untitled = headers.filter((h) => !titles.has(h.id));
    const untitledIds = new Set(untitled.map((h) => h.id));
    await pooled(untitled, 4, async (h) => {
      const label = await firstMessageOf(query, h.id);
      if (label) titles.set(h.id, label);
    });

    const chat = (h) => ({
      sessionId: h.id,
      title: titles.get(h.id) ?? null,
      fromMessage: !!titles.get(h.id) && untitledIds.has(h.id),
      createdAt: h.createdAt,
      cwd: h.cwd ?? null,
    });

    let registry = [];
    try {
      registry = getWorkspaces()?.list?.() ?? [];
    } catch { /* no workspaces: everything is ungrouped */ }

    const placed = new Set();
    const workspaces = [];
    for (const ws of registry) {
      const chats = [];
      for (const id of ws.sessionIds ?? []) {
        const h = byId.get(id);
        if (!h || placed.has(id)) continue;
        placed.add(id);
        chats.push(chat(h));
      }
      // A chat whose folder matches but that the registry has not recorded yet.
      for (const h of headers) {
        if (!placed.has(h.id) && samePath(h.cwd, ws.path)) {
          placed.add(h.id);
          chats.push(chat(h));
        }
      }
      if (!chats.length) continue;
      chats.sort((a, b) => b.createdAt - a.createdAt);
      workspaces.push({ id: String(ws.id), title: ws.title || ws.path, path: ws.path, chats });
    }
    const ungrouped = headers.filter((h) => !placed.has(h.id)).map(chat).sort((a, b) => b.createdAt - a.createdAt);
    return { builtAt: now(), workspaces, ungrouped };
  }

  /** The grouped index, rebuilt at most every 15 seconds. */
  async function list({ fresh = false } = {}) {
    if (!fresh && cached && now() - cached.builtAt < CACHE_MS) return cached;
    cached = await build();
    return cached;
  }

  /** Which workspace a session belongs to, by membership or folder. */
  function workspaceOf(index, sessionId, cwd) {
    return index.workspaces.find((w) => w.chats.some((c) => c.sessionId === sessionId))
      ?? (cwd ? index.workspaces.find((w) => samePath(w.path, cwd)) : undefined)
      ?? null;
  }

  /**
   * Resolve what the user or model named — a workspace title, its folder, or
   * its id — to the workspace. Titles may repeat; an exact folder wins.
   */
  async function resolveWorkspace(name) {
    const wanted = String(name ?? '').trim();
    if (!wanted) return null;
    const index = await list();
    return index.workspaces.find((w) => w.id === wanted || samePath(w.path, wanted))
      ?? index.workspaces.find((w) => w.title.toLowerCase() === wanted.toLowerCase())
      ?? index.workspaces.find((w) => w.title.toLowerCase().includes(wanted.toLowerCase()))
      ?? null;
  }

  return { list, workspaceOf, resolveWorkspace, invalidate: () => { cached = null; } };
}

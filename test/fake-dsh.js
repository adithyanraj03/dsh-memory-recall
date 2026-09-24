// A stand-in for dsh's session query service, faithful to the parts recall
// relies on: FTS matches a query as a literal PHRASE; `filterEvents` text is a
// case-insensitive substring; titles come back as settled rows; search can be
// switched off, and then throws SESSION_QUERY_SEARCH_DISABLED.

const DAY = 86_400_000;

export function chat(id, { day = 0, title = null, cwd = null, parentSession, origin, messages = [] } = {}) {
  return {
    header: { id, createdAt: Date.UTC(2026, 8, 1) + day * DAY, cwd, ...(parentSession ? { parentSession } : {}), ...(origin ? { origin } : {}) },
    title,
    events: messages.map(([role, text], i) => ({
      seq: (i + 1) * 3,
      type: role === 'tool' ? 'tool/result' : `${role}/message`,
      time: Date.UTC(2026, 8, 1) + day * DAY + i * 1000,
      text,
    })),
  };
}

export function fakeSessionQuery(chats, { searchEnabled = true } = {}) {
  const byId = new Map(chats.map((c) => [c.header.id, c]));
  const calls = { search: [], filterEvents: 0 };
  const matchEvent = (e, filters) => filters.every((f) => {
    if (f.kind === 'type') return f.values.includes(e.type);
    if (f.kind === 'seq') return (f.from === undefined || e.seq >= f.from) && (f.to === undefined || e.seq <= f.to);
    if (f.kind === 'text') return e.text.toLowerCase().includes(f.text.toLowerCase());
    return true;
  });
  const matchSession = (c, filters) => filters.every((f) => {
    if (f.kind === 'id') return f.values.includes(c.header.id);
    if (f.kind === 'parent') return f.values.includes(c.header.parentSession ?? null);
    return true;
  });
  const record = (c) => ({ header: { ...c.header }, live: false, persisted: true });
  return {
    calls,
    async listSessions() { return chats.map(record); },
    async filterSessions(filters) { return chats.filter((c) => matchSession(c, filters)).map(record); },
    async filterEvents(id, filters) {
      calls.filterEvents += 1;
      const c = byId.get(id);
      if (!c) throw Object.assign(new Error('not found'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' });
      return c.events.filter((e) => matchEvent(e, filters)).map((e) => ({ sessionId: id, surface: 'current', ...e }));
    },
    async readTitleSnapshots(ids) {
      return ids.map((id) => {
        const c = byId.get(id);
        return { sessionId: id, status: 'fulfilled', value: { session: c.header, ...(c.title ? { title: { title: c.title } } : {}) } };
      });
    },
    async searchSessions({ query, sessionFilters = [], eventFilters = [], limit = 20 }) {
      calls.search.push(query);
      if (!searchEnabled) throw Object.assign(new Error('search disabled'), { code: 'SESSION_QUERY_SEARCH_DISABLED' });
      const phrase = query.trim().replace(/\s+/g, ' ').toLowerCase();
      const items = [];
      for (const c of chats) {
        if (!matchSession(c, sessionFilters)) continue;
        const hit = c.events.find((e) => matchEvent(e, eventFilters) && e.text.toLowerCase().includes(phrase));
        if (!hit) continue;
        const at = hit.text.toLowerCase().indexOf(phrase);
        const snippet = `${hit.text.slice(0, at)}\uFDD0${hit.text.slice(at, at + phrase.length)}\uFDD1${hit.text.slice(at + phrase.length)}`;
        items.push({ ...record(c), bestMatch: { sessionId: c.header.id, seq: hit.seq, type: hit.type, time: hit.time, surface: 'current', snippet } });
      }
      return { items: items.slice(0, limit) };
    },
  };
}

/** A dsh approval service that answers with `outcome` and records each ask. */
export function fakeApproval(outcome = 'allowed-once') {
  const asked = [];
  return { asked, async request(req) { asked.push(req); return typeof outcome === 'function' ? outcome(req) : outcome; } };
}

/** dsh-tools' defineTool is a typed identity at runtime for our purposes. */
export const passThrough = (def) => def;

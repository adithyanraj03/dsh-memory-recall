// Looking things up in earlier chats, through dsh's own session query service.
//
// Four shapes, as in Hermes Agent's session_search:
//   discover  a query            → the chats that match best, the top one with context
//   scroll    a chat + a message → the messages around it
//   read      a chat alone       → its opening and its end
//   browse    nothing            → the most recent chats
//
// Everything returned is the chats' actual messages — no model call, no
// summary that could be wrong. Only the user's own top-level chats are
// searched: sub-agent sessions are the model talking to itself, and the chat
// asking is left out (it already has its own history). Only user and assistant
// messages count; tool calls and results are noise for "what did we decide".
//
// dsh's full-text index (SQLite FTS5) matches a query as a LITERAL PHRASE, so
// "graft sidebar" finds only chats where those words are adjacent. When a
// multi-word search comes back short, each distinctive word is searched on its
// own and chats are ranked by how many of the words they contain. If the index
// is switched off, a slower literal scan of recent chats stands in for it.

export const MESSAGE_TYPES = ['user/message', 'assistant/message'];

export const DEFAULTS = {
  limit: 3,
  maxLimit: 10,
  browseLimit: 10,
  /** Messages shown either side of a match. */
  around: 3,
  /** A single message is cut to this many characters. */
  messageChars: 700,
  /** The whole answer is cut to this many characters. */
  totalChars: 9000,
  /** How many recent chats the fallback scan reads, newest first. */
  scanSessions: 150,
};

const STOPWORDS = new Set(('a an and are as at be but by did do does for from had has have how i if in into is it its '
  + 'last me my of on or our that the their them then there these this those to was we were what when where which '
  + 'who why will with you your about after again all also any can could just like more most not now only other '
  + 'over same should some such than too very would chat chats talked discussed decided said '
  // The words of the question itself ("what did we decide last time…"), which
  // match half of any history and say nothing about the topic.
  + 'decide decision time times remember recall conversation conversations earlier previous before ago '
  + 'thing things something stuff back leave left mentioned told asked').split(' '));

/** Distinctive words of a query, for the word-by-word pass. */
export function keywords(query) {
  const seen = new Set();
  const out = [];
  for (const word of String(query).toLowerCase().split(/[^\p{L}\p{N}_.\-]+/u)) {
    const w = word.replace(/^[.\-]+|[.\-]+$/g, '');
    if (w.length < 3 || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.slice(0, 5);
}

/** dsh marks FTS matches with two private-use characters; show them as **bold**. */
export function cleanSnippet(snippet) {
  return String(snippet ?? '').replace(/\uFDD0/g, '**').replace(/\uFDD1/g, '**').replace(/\s+/g, ' ').trim();
}

const roleOf = (type) => (type === 'user/message' ? 'user' : 'assistant');
const isRoot = (header) => header && !header.parentSession && header.origin !== 'subagent';

function cut(text, max) {
  const t = String(text ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A snippet around the first literal occurrence of `needle` in `text`. */
export function excerpt(text, needle, width = 120) {
  const t = String(text ?? '').replace(/\s+/g, ' ');
  const at = needle ? t.toLowerCase().indexOf(String(needle).toLowerCase()) : -1;
  if (at < 0) return cut(t, width * 2);
  const start = Math.max(0, at - width);
  const end = Math.min(t.length, at + needle.length + width);
  return `${start > 0 ? '…' : ''}${t.slice(start, at)}**${t.slice(at, at + needle.length)}**${t.slice(at + needle.length, end)}${end < t.length ? '…' : ''}`;
}

export class RecallError extends Error {}

/**
 * @param {object} p
 * @param {() => object|undefined} p.getQuery  resolves ctx.sessionQuery lazily
 * @param {object} [p.options]
 */
export function createRecall({ getQuery, options = {} }) {
  const o = { ...DEFAULTS, ...options };

  const query = () => {
    const q = getQuery();
    if (!q || typeof q.listSessions !== 'function') {
      throw new RecallError("dsh's session query service is not available in this deployment, so past chats cannot be read.");
    }
    return q;
  };

  async function titlesFor(ids) {
    const out = new Map();
    if (!ids.length) return out;
    try {
      const rows = await query().readTitleSnapshots(ids);
      for (const row of rows ?? []) {
        if (row?.status === 'fulfilled' && row.value?.title?.title) out.set(row.sessionId, row.value.title.title);
      }
    } catch { /* untitled is fine */ }
    return out;
  }

  async function messages(sessionId, filters = []) {
    const docs = await query().filterEvents(sessionId, [{ kind: 'type', values: MESSAGE_TYPES }, ...filters]);
    return [...(docs ?? [])]
      .filter((d) => String(d.text ?? '').trim() !== '')
      .sort((a, b) => a.seq - b.seq)
      .map((d) => ({ seq: d.seq, role: roleOf(d.type), time: d.time, text: cut(d.text, o.messageChars) }));
  }

  /** Up to `around` messages either side of `seq`. */
  async function windowAround(sessionId, seq) {
    const near = await messages(sessionId, [{ kind: 'seq', from: Math.max(0, seq - 60), to: seq + 60 }]);
    let at = near.findIndex((m) => m.seq >= seq);
    if (at < 0) at = near.length - 1;
    return near.slice(Math.max(0, at - o.around), at + o.around + 1);
  }

  function sessionInfo(header, titles) {
    return { sessionId: header.id, title: titles.get(header.id) ?? null, createdAt: header.createdAt, cwd: header.cwd ?? null };
  }

  /** FTS for one phrase → Map(sessionId → hit). Throws `disabled` when the index is off. */
  /** Session filters: top-level chats, and only the scope's when there is one. */
  const scopeFilters = (scope) => [
    { kind: 'parent', values: [null] },
    ...(scope ? [{ kind: 'id', values: [...scope] }] : []),
  ];

  async function ftsHits(phrase, excludeId, want, scope) {
    const q = query();
    if (typeof q.searchSessions !== 'function') throw Object.assign(new Error('no full-text search'), { disabled: true });
    let page;
    try {
      page = await q.searchSessions({
        query: phrase,
        sessionFilters: scopeFilters(scope),
        eventFilters: [{ kind: 'type', values: MESSAGE_TYPES }],
        limit: Math.min(100, want + 5),
      });
    } catch (error) {
      if (error?.code === 'SESSION_QUERY_SEARCH_DISABLED') throw Object.assign(new Error('search disabled'), { disabled: true });
      throw error;
    }
    const hits = new Map();
    for (const item of page?.items ?? []) {
      if (!isRoot(item.header) || item.header.id === excludeId) continue;
      hits.set(item.header.id, {
        header: item.header,
        match: { seq: item.bestMatch.seq, role: roleOf(item.bestMatch.type), time: item.bestMatch.time, snippet: cleanSnippet(item.bestMatch.snippet) },
      });
    }
    return hits;
  }

  /** The literal scan used when the index is off: newest chats first, one match each. */
  async function scanHits(phrase, excludeId, want, scope) {
    const q = query();
    const sessions = (await q.listSessions())
      .map((r) => r.header)
      .filter((h) => isRoot(h) && h.id !== excludeId && (!scope || scope.has(h.id)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, o.scanSessions);
    const hits = new Map();
    for (const header of sessions) {
      if (hits.size >= want) break;
      let docs;
      try {
        docs = await q.filterEvents(header.id, [{ kind: 'type', values: MESSAGE_TYPES }, { kind: 'text', text: phrase }]);
      } catch { continue; } // one unreadable chat must not stop the scan
      const first = [...(docs ?? [])].sort((a, b) => a.seq - b.seq)[0];
      if (!first) continue;
      hits.set(header.id, { header, match: { seq: first.seq, role: roleOf(first.type), time: first.time, snippet: excerpt(first.text, phrase) } });
    }
    return hits;
  }

  /**
   * @param {object} p
   * @param {Set<string>} [p.scope]  only these chats (a workspace's), when given
   */
  async function discover({ query: text, limit, sort, excludeId, scope }) {
    const phrase = String(text ?? '').trim();
    if (!phrase) throw new RecallError('query is empty');
    const want = Math.max(1, Math.min(o.maxLimit, Number.isFinite(limit) ? Math.floor(limit) : o.limit));
    let engine = 'fts';
    if (scope && scope.size === 0) return { mode: 'discover', engine: 'fts', query: phrase, widened: false, results: [] };
    let search = (p, n) => ftsHits(p, excludeId, n, scope);
    let hits;
    try {
      hits = await search(phrase, want * 3);
    } catch (error) {
      if (!error?.disabled) throw error;
      engine = 'scan';
      search = (p, n) => scanHits(p, excludeId, n, scope);
      hits = await search(phrase, want * 3);
    }
    // Phrase first; then, if that is thin, each distinctive word on its own.
    const scored = new Map([...hits].map(([id, hit]) => [id, { ...hit, score: 100, words: [phrase] }]));
    const words = keywords(phrase);
    let widened = false;
    if (scored.size < want && words.length > 1) {
      widened = true;
      for (const word of words) {
        for (const [id, hit] of await search(word, want * 3)) {
          const prior = scored.get(id);
          if (prior) {
            if (prior.score < 100) { prior.score += 1; prior.words.push(word); }
          } else {
            scored.set(id, { ...hit, score: 1, words: [word] });
          }
        }
      }
    }
    let ranked = [...scored.values()].sort((a, b) => b.score - a.score || b.header.createdAt - a.header.createdAt);
    ranked = ranked.slice(0, want);
    if (sort === 'newest') ranked.sort((a, b) => b.header.createdAt - a.header.createdAt);
    if (sort === 'oldest') ranked.sort((a, b) => a.header.createdAt - b.header.createdAt);
    const titles = await titlesFor(ranked.map((r) => r.header.id));
    const results = ranked.map((r) => ({
      ...sessionInfo(r.header, titles),
      match: r.match,
      matchedWords: r.score >= 100 ? null : r.words,
    }));
    if (results[0]) {
      try { results[0].context = await windowAround(results[0].sessionId, results[0].match.seq); } catch { /* the snippet still stands */ }
    }
    return { mode: 'discover', engine, query: phrase, widened, results };
  }

  async function headerOf(sessionId) {
    const q = query();
    const rows = await q.filterSessions([{ kind: 'id', values: [sessionId] }]);
    const header = rows?.[0]?.header;
    if (!header) throw new RecallError(`no chat with id ${sessionId}`);
    return header;
  }

  async function scroll({ sessionId, aroundSeq }) {
    const header = await headerOf(sessionId);
    const titles = await titlesFor([sessionId]);
    return { mode: 'scroll', session: sessionInfo(header, titles), aroundSeq, messages: await windowAround(sessionId, aroundSeq) };
  }

  async function read({ sessionId }) {
    const header = await headerOf(sessionId);
    const titles = await titlesFor([sessionId]);
    const all = await messages(sessionId);
    const head = all.slice(0, 4);
    const tail = all.length > 10 ? all.slice(-6) : all.slice(4);
    return {
      mode: 'read',
      session: sessionInfo(header, titles),
      total: all.length,
      head,
      tail,
      omitted: Math.max(0, all.length - head.length - tail.length),
    };
  }

  async function browse({ limit, excludeId, scope }) {
    const want = Math.max(1, Math.min(30, Number.isFinite(limit) ? Math.floor(limit) : o.browseLimit));
    const headers = (await query().listSessions())
      .map((r) => r.header)
      .filter((h) => isRoot(h) && h.id !== excludeId && (!scope || scope.has(h.id)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, want);
    const titles = await titlesFor(headers.map((h) => h.id));
    return { mode: 'browse', sessions: headers.map((h) => sessionInfo(h, titles)) };
  }

  return { discover, scroll, read, browse, options: o };
}

// The `session_search` tool: reading earlier chats, only with the user's say-so.
//
// Before anything is read, dsh's own approval prompt asks the user — attached
// to this tool call in the chat, with what the model wants to look for. One
// "allow" covers the rest of that reply (a search is usually followed by a
// read around the best hit, and asking twice for one question is noise); the
// grant is dropped the moment the chat goes idle, so the next question asks
// again. A decline, a withdrawn prompt, or no way to ask at all means nothing
// is read — the approval seam fails closed and so does this.

import { RecallError } from './recall.js';
import { TEXT_OUTPUT } from './memory-tool.js';

export const RECALL_TOOL = 'session_search';

export const RECALL_DESCRIPTION = [
  'Look things up in the user\'s earlier chats. Asks the user for permission first; if they decline, say so and carry on',
  'without it — do not call it again in the same reply. Results are the chats\' actual messages, not summaries.',
  '',
  'Shapes, picked by the arguments:',
  '- `query`: find the chats that match best (top result comes with the messages around the match).',
  '- `session_id` + `around_seq`: read the messages around one message of a chat found earlier.',
  '- `session_id` alone: read how a chat began and ended.',
  '- no arguments: list the most recent chats.',
  'Add `workspace` (its title, its folder, or the workspace a user picked with @) to search or list only that',
  "workspace's chats — a user message carrying [workspace \"Name\" — folder] means exactly that.",
  '',
  'The query is matched as an EXACT PHRASE, so use one or two distinctive keywords (a name, a file, an error) rather than',
  'a sentence; if a multi-word phrase finds too little, each word is also tried on its own.',
  'Use it when the user refers to an earlier conversation — "what did we decide about…", "like last time", "where did we',
  'leave…". Searches chat history only: when the user names a file, URL or system, look at that directly.',
].join('\n');

const OUTCOME_TEXT = {
  rejected: 'The user declined reading their past chats. Nothing was read. Tell them you cannot look it up without their permission, and do not ask again in this reply.',
  cancelled: 'The permission request was withdrawn before an answer (the reply was stopped). Nothing was read.',
  unavailable: 'Nobody could be asked for permission (no approval prompt is available in this dsh), so past chats were not read.',
};

const day = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : 'unknown date');

function titleOf(s) {
  return s.title ? `"${s.title}"` : '(untitled chat)';
}

function sessionLine(s) {
  return `${titleOf(s)} — ${day(s.createdAt)}${s.cwd ? ` — ${s.cwd}` : ''} — session_id ${s.sessionId}`;
}

function messageLines(list, mark) {
  return list.map((m) => `   [#${m.seq} ${m.role}]${m.seq === mark ? ' ◀' : ''} ${m.text.replace(/\n+/g, ' ')}`);
}

/** The model-facing text for a recall result, capped at `max` characters. */
export function formatRecall(result, max = 9000) {
  const out = [];
  if (result.mode === 'discover') {
    const engine = result.engine === 'fts' ? "dsh's full-text index" : 'a literal scan of recent chats (full-text search is off)';
    if (!result.results.length) {
      out.push(`No earlier chat${result.workspace ? ` in workspace "${result.workspace}"` : ''} matches "${result.query}" (searched with ${engine}). Try one distinctive keyword, or another word for it.`);
    } else {
      out.push(`Found ${result.results.length} earlier chat(s) for "${result.query}"${result.workspace ? ` in workspace "${result.workspace}"` : ''} (searched with ${engine}${result.widened ? '; also word by word' : ''}):`);
      result.results.forEach((r, i) => {
        out.push('', `${i + 1}. ${sessionLine(r)}`);
        if (r.matchedWords) out.push(`   Matched words: ${r.matchedWords.join(', ')}`);
        out.push(`   Best match (#${r.match.seq}, ${r.match.role}): ${r.match.snippet}`);
        if (r.context?.length) out.push('   Around it:', ...messageLines(r.context, r.match.seq));
      });
      out.push('', 'To read more of one: session_search with its session_id and around_seq set to a message number.');
    }
  } else if (result.mode === 'scroll') {
    out.push(`From ${sessionLine(result.session)}, around message #${result.aroundSeq}:`, ...messageLines(result.messages, result.aroundSeq));
  } else if (result.mode === 'read') {
    out.push(`${sessionLine(result.session)} — ${result.total} messages.`);
    if (result.head.length) out.push('How it began:', ...messageLines(result.head));
    if (result.omitted) out.push(`   … ${result.omitted} message(s) in between — use around_seq to read any part …`);
    if (result.tail.length) out.push(result.omitted ? 'How it ended:' : 'Then:', ...messageLines(result.tail));
  } else if (result.mode === 'browse') {
    const where = result.workspace ? ` in workspace "${result.workspace}"` : '';
    out.push(result.sessions.length ? `Most recent earlier chats${where}:` : `There are no earlier chats${where} yet.`);
    result.sessions.forEach((s, i) => out.push(`${i + 1}. ${sessionLine(s)}`));
  }
  const text = out.join('\n');
  return text.length > max ? `${text.slice(0, max - 60).trimEnd()}\n… (cut to fit — narrow the search to see more)` : text;
}

/** Which of the four shapes the arguments ask for. */
export function modeOf(args = {}) {
  const has = (v) => typeof v === 'string' && v.trim() !== '';
  if (has(args.session_id) && Number.isFinite(args.around_seq)) return 'scroll';
  if (has(args.session_id)) return 'read';
  if (has(args.query)) return 'discover';
  return 'browse';
}

/** What the permission prompt says the model wants. */
export function reasonFor(args = {}, workspace = null) {
  const where = workspace ? ` in "${workspace}"` : '';
  switch (modeOf(args)) {
    case 'discover': return `Search your earlier chats${where} for "${String(args.query).trim()}".`;
    case 'scroll': return `Read part of an earlier chat (${args.session_id}).`;
    case 'read': return `Read the beginning and end of an earlier chat (${args.session_id}).`;
    default: return workspace ? `List your chats in "${workspace}".` : 'List your most recent chats.';
  }
}

/**
 * @param {object} p
 * @param {ReturnType<import('./recall.js').createRecall>} p.recall
 * @param {Function} p.defineTool
 * @param {() => object|undefined} p.getApproval  resolves the dsh approval service lazily
 * @param {Map<string, number>} p.grants  chat id → time the grant lapses
 * @param {object} p.log  per-call record for the chat card: {start, update}
 * @param {boolean} [p.askFirst=true]
 * @param {() => number} [p.now]
 * @param {number} [p.grantMs]  a safety lapse, in case the idle event is missed
 */
export function createRecallTool({
  recall, defineTool, getApproval, grants, log, askFirst = true, now = () => Date.now(), grantMs = 30 * 60_000,
  resolveWorkspace = async () => null, listWorkspaces = async () => [],
}) {
  async function permission(exec, args, workspace) {
    if (!askFirst) return 'allowed-once';
    const chat = exec?.agent?.id;
    if (chat && (grants.get(chat) ?? 0) > now()) return 'allowed-once';
    const approval = getApproval();
    if (!approval || typeof approval.request !== 'function' || !exec?.agent) return 'unavailable';
    const outcome = await approval.request({
      agent: exec.agent,
      toolName: RECALL_TOOL,
      callId: exec.callId,
      reason: reasonFor(args, workspace),
      signal: exec.signal,
    });
    if (outcome === 'allowed-once' && chat) grants.set(chat, now() + grantMs);
    return outcome;
  }

  async function run(args, exec) {
    const mode = modeOf(args);
    const callId = exec?.callId;
    const wanted = typeof args.workspace === 'string' ? args.workspace.trim() : '';
    log.start(callId, { mode, query: args.query ?? null, sessionId: args.session_id ?? null, workspace: wanted || null });
    // Which chats a workspace holds is metadata, not chat content, so it is
    // resolved before asking — and the prompt can then say where it will look.
    let workspace = null;
    if (wanted && (mode === 'discover' || mode === 'browse')) {
      try { workspace = await resolveWorkspace(wanted); } catch { workspace = null; }
      if (!workspace) {
        let names = [];
        try { names = (await listWorkspaces()).map((w) => w.title); } catch { /* none to offer */ }
        const text = `No workspace called "${wanted}".${names.length ? ` Workspaces: ${names.map((n) => `"${n}"`).join(', ')}.` : ''} Nothing was read.`;
        log.update(callId, { status: 'error', error: text });
        return text;
      }
      log.update(callId, { workspace: workspace.title });
    }
    log.update(callId, { status: 'awaiting-approval' });
    let outcome;
    try {
      outcome = await permission(exec, args, workspace?.title ?? null);
    } catch (error) {
      outcome = 'unavailable';
      log.update(callId, { note: String(error?.message ?? error) });
    }
    if (outcome !== 'allowed-once') {
      log.update(callId, { status: 'declined', outcome });
      return OUTCOME_TEXT[outcome] ?? OUTCOME_TEXT.unavailable;
    }
    log.update(callId, { status: 'searching' });
    const excludeId = exec?.agent?.id;
    try {
      let result;
      const scope = workspace ? new Set(workspace.chats.map((c) => c.sessionId)) : undefined;
      if (mode === 'discover') result = await recall.discover({ query: args.query, limit: args.limit, sort: args.sort, excludeId, scope });
      else if (mode === 'scroll') result = await recall.scroll({ sessionId: args.session_id.trim(), aroundSeq: args.around_seq });
      else if (mode === 'read') result = await recall.read({ sessionId: args.session_id.trim() });
      else result = await recall.browse({ limit: args.limit, excludeId, scope });
      if (workspace) result.workspace = workspace.title;
      log.update(callId, { status: 'done', result });
      return formatRecall(result, recall.options.totalChars);
    } catch (error) {
      const message = error instanceof RecallError ? error.message : `could not read past chats: ${error?.message ?? error}`;
      log.update(callId, { status: 'error', error: message });
      return `Recall failed: ${message}`;
    }
  }

  return defineTool({
    name: RECALL_TOOL,
    description: RECALL_DESCRIPTION,
    parameters: {
      query: { type: 'string', description: 'One or two distinctive keywords, matched as an exact phrase. Omit to list recent chats.' },
      limit: { type: 'integer', description: 'How many chats to return (default 3, at most 10; for a listing, default 10).' },
      sort: { type: 'string', enum: ['newest', 'oldest'], description: "'newest' for where something was left, 'oldest' for how it started; omit for best match." },
      workspace: { type: 'string', description: "Only this workspace's chats: its title as the sidebar shows it, or its folder." },
      session_id: { type: 'string', description: 'A chat from an earlier result, to read inside it.' },
      around_seq: { type: 'integer', description: 'With session_id: the message number to read around (the #N shown in results).' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => ({ text: await run(args ?? {}, exec) }),
  });
}

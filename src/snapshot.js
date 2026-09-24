// What a new chat's system prompt says about memory.
//
// Rendered ONCE, when the chat's agent starts, and never again for that chat.
// dsh keeps the prompt prefix cacheable only while its text is unchanged —
// "any change may invalidate reuse from the first changed token" — so a
// memory saved mid-chat is written to disk at once but reaches the prompt in
// the next new chat. The guidance says so, so the model does not expect to
// see its own save reflected, and does not save twice.

import { TARGETS, joinEntries, sizeOf } from './store.js';

/** After prompt-notes (950) and every first-party instruction, before the environment suffix (10000). */
export const SECTION_ORDER = 9500;
export const SECTION_NAME = 'dsh-memory-recall:memory';

const RULE = '═'.repeat(46);

export const GUIDANCE = [
  '# Memory',
  '',
  'You have a persistent memory that carries across chats: the blocks below, when they hold anything. It is fixed for this chat —',
  'what you save now is on disk at once but appears here from the next new chat, so do not re-save something because you do not see it yet.',
  '',
  "- Save with the `memory` tool. Target 'user' is who the user is: name, role, preferences, how they like to work.",
  "  Target 'memory' is your own notes: environment facts, conventions, tool quirks, lessons that apply to every task.",
  '- Save durable facts, one short fact per entry, when you learn them — not task progress, one-off details, or anything easy to look up again.',
  '- The user sees each save as a "Saved to memory" note in the chat and can edit or delete entries in the Memory panel.',
  '  Never save secrets or credentials, or anything the user would not want written down.',
  '- When the user refers to an earlier conversation ("what did we decide about…", "like last time"), use `session_search`.',
  '  It asks the user for permission to read past chats first. If they decline, say so and carry on without it; do not ask again in the same reply.',
  '- A user message carrying [workspace "Name" — folder] means the user picked that workspace with @: pass it as `workspace` to',
  '  session_search. A chat the user @-mentions arrives as a "Referenced sessions" snapshot — use that directly, no search needed.',
].join('\n');

/**
 * The note when the tools failed to load: the memory below can be read, but
 * nothing can be saved or searched — and the model must say so rather than
 * improvise a substitute (it once wrote a notes file instead).
 */
export const GUIDANCE_NO_TOOLS = [
  '# Memory',
  '',
  'You have a persistent memory that carries across chats: the blocks below, when they hold anything.',
  'Its tools (`memory` and `session_search`) failed to load in this dsh, so right now you cannot save to memory or search',
  'earlier chats. If the user asks you to remember something, tell them memory saving is unavailable in this session and',
  'that they can add it themselves in the Memory panel in the sidebar. Do not substitute a file or anything else for it.',
].join('\n');

/** One store as a prompt block, or '' when it is empty. */
export function renderBlock(target, entries, limit) {
  if (!entries.length) return '';
  const chars = sizeOf(entries);
  const percent = limit > 0 ? Math.min(100, Math.floor((chars / limit) * 100)) : 0;
  const usage = `${percent}% — ${chars.toLocaleString('en-US')}/${limit.toLocaleString('en-US')} chars`;
  return `${RULE}\n${TARGETS[target].title} [${usage}]\n${RULE}\n${joinEntries(entries)}`;
}

/** The whole section: guidance, then the user profile, then the notes. */
export function renderSection({ user = [], memory = [] }, limits, { tools = true } = {}) {
  const guidance = tools ? GUIDANCE : GUIDANCE_NO_TOOLS;
  const blocks = [renderBlock('user', user, limits.user), renderBlock('memory', memory, limits.memory)].filter(Boolean);
  return blocks.length ? `${guidance}\n\n${blocks.join('\n\n')}` : `${guidance}\n\n(Nothing is saved yet.)`;
}

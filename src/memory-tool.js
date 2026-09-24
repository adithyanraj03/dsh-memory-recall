// The `memory` tool: how the model saves, corrects and forgets.
//
// Hermes Agent's tool, kept close to the original because its wording is the
// result of a lot of tuning: one tool, two targets, add/replace/remove, and a
// batch form whose budget is checked on the FINAL result — which is what lets
// a full store make room and add in a single call instead of failing forever.
//
// The first words of every result are fixed ("Saved to memory", "Already in
// memory", "Not saved", "Blocked"): the chat card reads them to label itself.

import { TARGETS } from './store.js';

export const MEMORY_TOOL = 'memory';

export const TEXT_OUTPUT = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false },
  render: (_args, value) => [{ type: 'text', text: value.text }],
};

const ACTIONS = ['add', 'replace', 'remove'];

export const MEMORY_DESCRIPTION = [
  'Save durable facts to persistent memory that carries across chats. Memory is placed in the system prompt of every new chat,',
  'so keep entries compact and high-signal. Changes are saved at once but show in the prompt from the next new chat.',
  '',
  'HOW: for several changes, make them ALL in ONE call with an `operations` list (each item {action, content?, old_text?}).',
  'The batch is applied all-or-nothing and the character budget is checked only on the FINAL result, so one call can remove',
  'or shorten stale entries to make room AND add new ones. For a single change, use action/content/old_text instead.',
  'The result confirms the update is complete; do not repeat it.',
  '',
  "TARGETS: 'user' = who the user is (name, role, preferences, working style). 'memory' = your own notes",
  '(environment facts, conventions, tool quirks, lessons that apply to every task).',
  '',
  'WHEN: facts that will matter in future chats regardless of the task. The user sees every save and can edit or delete it.',
  '',
  'IF FULL: an add is refused with the current entries listed. Reissue as ONE batch that merges or removes enough stale',
  'entries and adds the new one together.',
  '',
  'SKIP: trivial or easily re-discovered facts, raw data, task progress, logs of finished work, temporary to-dos, and',
  'anything secret. To look something up from an earlier chat instead of remembering it, use session_search.',
].join('\n');

const fmt = (n) => Number(n).toLocaleString('en-US');

/** "42% — 578/1,375 chars" */
export function usageText(usage) {
  return `${usage.percent}% — ${fmt(usage.chars)}/${fmt(usage.limit)} chars`;
}

function countChanges(changed = {}) {
  const parts = [];
  if (changed.added?.length) parts.push(`added ${changed.added.length}`);
  if (changed.replaced?.length) parts.push(`replaced ${changed.replaced.length}`);
  if (changed.removed?.length) parts.push(`removed ${changed.removed.length}`);
  return parts.join(', ');
}

/** The model-facing text for a store result. */
export function describeResult(result) {
  const label = TARGETS[result.target]?.label ?? result.target;
  if (result.success) {
    const what = countChanges(result.changed);
    if (!what) {
      return `Already in memory (${label}) — nothing changed. ${usageText(result.usage)}. This update is complete — do not repeat it.`;
    }
    return `Saved to memory (${label}): ${what}. Now ${usageText(result.usage)}, ${result.entryCount} entr${result.entryCount === 1 ? 'y' : 'ies'}. `
      + 'This update is complete — do not repeat it.';
  }
  const head = result.blocked ? `Blocked — not saved (${label}): ${result.error}` : `Not saved (${label}): ${result.error}`;
  if (!Array.isArray(result.currentEntries)) return head;
  const list = result.currentEntries.length
    ? result.currentEntries.map((entry, i) => `${i + 1}. ${entry}`).join('\n')
    : '(empty)';
  return `${head}\n\nCurrent ${label} entries (${usageText(result.usage)}):\n${list}`;
}

/**
 * @param {object} p
 * @param {import('./store.js').MemoryStore} p.store
 * @param {Function} p.defineTool  from @deepseek-ai/dsh-tools
 */
export function createMemoryTool({ store, defineTool }) {
  return defineTool({
    name: MEMORY_TOOL,
    description: MEMORY_DESCRIPTION,
    parameters: {
      target: {
        type: 'string', enum: ['memory', 'user'], required: true,
        description: "'user' for the user profile, 'memory' for your own notes.",
      },
      action: {
        type: 'string', enum: ACTIONS,
        description: 'A single change. Omit when using operations.',
      },
      content: {
        type: 'string',
        description: 'The entry text, for add and replace.',
      },
      old_text: {
        type: 'string',
        description: 'For replace and remove: a short piece of the existing entry, unique to it.',
      },
      operations: {
        type: 'array',
        description: 'Several changes applied all-or-nothing, the budget checked on the final result.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: ACTIONS, required: true },
            content: { type: 'string', description: 'Entry text for add and replace.' },
            old_text: { type: 'string', description: 'Piece of the entry to replace or remove.' },
          },
        },
      },
    },
    output: TEXT_OUTPUT,
    execute: async (args) => ({ text: describeResult(await runMemory(store, args)) }),
  });
}

/** Dispatch one call to the store. Kept apart from the tool so it can be tested alone. */
export async function runMemory(store, args = {}) {
  const target = args.target ?? 'memory';
  if (!Object.hasOwn(TARGETS, target)) return store.fail(target, `unknown target '${target}' — use 'memory' or 'user'`);
  // Some providers send JSON null for every omitted optional field.
  const operations = Array.isArray(args.operations) && args.operations.length ? args.operations : null;
  if (operations) return store.applyBatch(target, operations);
  switch (args.action) {
    case 'add': return store.add(target, args.content);
    case 'replace': return store.replace(target, args.old_text, args.content);
    case 'remove': return store.remove(target, args.old_text);
    default:
      return store.fail(target, `give either action (add, replace or remove) or an operations list — got action '${args.action ?? ''}'`);
  }
}

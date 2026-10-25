// Memory as a logged context message, the way dsh delivers its skill catalog.
//
// Before each model step (`agent/pre-step`), memory is appended to the step's
// new messages when the chat does not already SEE the current version:
//
//   start       the chat has never been given memory
//   compaction  it was given memory, but that message is no longer on the
//               visible surface — the conversation was compacted past it
//   update      the memory it can see is older than what is on disk
//
// dsh logs each one as a "Context injection · memory · <summary>" row the user
// can expand, and the model gets the current memory in the conversation itself,
// next to the work — no tool call, nothing the model has to remember to do.

import { randomUUID } from 'node:crypto';
import { digestOf } from './routes.js';
import { renderBlock } from './snapshot.js';

/** The producer label dsh shows on the row ("Context injection · memory"). */
export const INJECT_LABEL = 'memory';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "2 profile · 5 notes", the counts part of the row's summary. */
export function countsText(stores) {
  return `${(stores.user ?? []).length} profile · ${plural((stores.memory ?? []).length, 'note', 'notes')}`;
}

/**
 * Is this logged message one of ours? Both shapes count: the v3 wrapper
 * (`kind: 'plugin'` + a `plugin` field) that dsh 0.1.x logs, and the v4
 * producer kind `plugin:memory` — which is also what dsh's own v3→v4
 * converter left in chats that started on the wrapper.
 */
function isMemorySource(source) {
  return source?.kind === `plugin:${INJECT_LABEL}`
    || (source?.kind === 'plugin' && source?.plugin === INJECT_LABEL);
}

/**
 * Why the chat needs memory now, or null when it already sees the current one.
 * @param {object} session  agent.session: seq, eventAt(i), surface.nodes
 * @param {string} digest   digestOf(the stores on disk)
 */
export function injectionReason(session, digest) {
  const visible = new Set(session?.surface?.nodes ?? []);
  let seen = false;
  for (let index = (session?.seq ?? 0) - 1; index >= 0; index -= 1) {
    const event = session.eventAt(index);
    if (event?.type !== 'user/message' || !isMemorySource(event.data?.source)) continue;
    seen = true;
    if (!visible.has(event.seq)) continue; // compacted away; an older one may still be visible
    return event.data.source.digest === digest ? null : 'update';
  }
  return seen ? 'compaction' : 'start';
}

/** Our message among a step's pending messages, if one is already there. */
export function pendingMemory(messages = []) {
  return messages.find((m) => isMemorySource(m?.source)) ?? null;
}

const LEAD = {
  start: 'Your persistent memory, carried over from earlier chats.',
  compaction: 'Your persistent memory again — the conversation was compacted, so here it is in full.',
  update: 'Your persistent memory changed. This is the current version; it replaces any earlier memory message.',
};

/**
 * The context message: what the model reads, and the source dsh logs and labels.
 * Format v4 (dsh 0.2.x) refuses `kind: 'plugin'` — every source must carry a
 * producer-owned kind — so a v4 chat gets `kind: 'plugin:memory'`, exactly what
 * dsh's v3→v4 converter produced for chats that began on the old wrapper.
 * @param {{user: string[], memory: string[]}} stores
 * @param {{user: number, memory: number}} limits
 * @param {'start'|'compaction'|'update'} reason
 * @param {number} version  the chat's session format version (header.version)
 * @param {string} [id]
 */
export function memoryMessage(stores, limits, reason, version = 0, id = randomUUID()) {
  const blocks = [renderBlock('user', stores.user ?? [], limits.user), renderBlock('memory', stores.memory ?? [], limits.memory)].filter(Boolean);
  const text = [
    '<system-reminder>',
    LEAD[reason] ?? LEAD.start,
    'Use it without being asked: follow the preferences, rely on the facts and conventions instead of rediscovering them or asking',
    'again, and apply the lessons. Do not announce that you read it.',
    '',
    blocks.length ? blocks.join('\n\n') : '(Nothing is saved yet.)',
    '</system-reminder>',
  ].join('\n');
  const summary = (reason === 'compaction' ? 'after compaction · ' : reason === 'update' ? 'updated · ' : '') + countsText(stores);
  const fields = { form: 'notice', summary, reason, digest: digestOf(stores) };
  const source = version >= 4
    ? { kind: `plugin:${INJECT_LABEL}`, ...fields }
    : { kind: 'plugin', plugin: INJECT_LABEL, ...fields };
  return Object.freeze({
    id,
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze(source),
  });
}

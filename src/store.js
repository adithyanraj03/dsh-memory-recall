// The two memory files, and every change made to them.
//
//   USER.md    who the user is — name, role, preferences, how they like to work
//   MEMORY.md  the model's own notes — environment facts, conventions, lessons
//
// Each file is a list of short entries separated by a line holding only `§`,
// the format Hermes Agent uses, so the files stay readable and hand-editable.
// Each has a character budget: everything in them is pasted into the system
// prompt of every new chat, so they must stay small, and a full store makes
// the model consolidate (merge or drop stale entries) rather than grow.
//
// Every change re-reads the file first, so an edit made by hand or in the
// Memory panel is never overwritten by a stale copy; writes go to a temporary
// file and are renamed into place, so a crash never leaves half a file; and
// changes run one at a time.

import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { firstThreatMessage } from './threats.js';

export const ENTRY_DELIMITER = '\n§\n';
const SPLIT = /\r?\n§\r?\n/;

export const TARGETS = {
  user: { file: 'USER.md', label: 'user profile', title: 'USER PROFILE (who the user is)' },
  memory: { file: 'MEMORY.md', label: 'memory', title: 'MEMORY (your personal notes)' },
};

/** Hermes Agent's defaults: 2,200 characters of notes, 1,375 of user profile. */
export const DEFAULT_LIMITS = { memory: 2200, user: 1375 };

/** Entries in a file's text: trimmed, blanks dropped, exact duplicates dropped. */
export function parseEntries(raw) {
  if (typeof raw !== 'string') return [];
  const text = raw.replace(/^\uFEFF/, ''); // a BOM from Notepad would stick to the first entry
  const out = [];
  for (const part of text.split(SPLIT)) {
    const entry = part.trim();
    if (entry !== '' && !out.includes(entry)) out.push(entry);
  }
  return out;
}

export const joinEntries = (entries) => entries.join(ENTRY_DELIMITER);

/** Characters an entry list costs, as the prompt will carry it. */
export const sizeOf = (entries) => joinEntries(entries).length;

function isTarget(target) {
  return Object.hasOwn(TARGETS, target);
}

/** What makes an entry unusable as an entry, or null. */
function entryProblem(content) {
  if (typeof content !== 'string' || content.trim() === '') return 'the entry is empty';
  if (/(^|\r?\n)§(\r?\n|$)/.test(content.trim())) return 'an entry must not contain a line holding only §, which separates entries';
  return null;
}

export class MemoryStore {
  /**
   * @param {object} options
   * @param {string} options.dir     where USER.md and MEMORY.md live
   * @param {object} [options.limits] {memory, user} character budgets
   */
  constructor({ dir, limits = {} }) {
    this.dir = dir;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.entries = { user: [], memory: [] };
    this.queue = Promise.resolve();
  }

  pathFor(target) {
    return join(this.dir, TARGETS[target].file);
  }

  limit(target) {
    return this.limits[target];
  }

  /** `{chars, limit, percent}` for a target, or for a hypothetical entry list. */
  usage(target, entries = this.entries[target]) {
    const chars = sizeOf(entries);
    const limit = this.limit(target);
    return { chars, limit, percent: limit > 0 ? Math.min(100, Math.floor((chars / limit) * 100)) : 0 };
  }

  /** A copy of both lists. */
  snapshot() {
    return { user: [...this.entries.user], memory: [...this.entries.memory] };
  }

  async readTarget(target) {
    try {
      return parseEntries(await readFile(this.pathFor(target), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  /**
   * Read both files synchronously — two small files, read once when a chat
   * starts, so the snapshot is in place before that chat's first prompt is
   * assembled rather than racing it. A file that cannot be read keeps the last
   * good copy instead of briefing the chat with an empty memory.
   */
  loadSync() {
    for (const target of Object.keys(TARGETS)) {
      try {
        this.entries[target] = parseEntries(readFileSync(this.pathFor(target), 'utf8'));
      } catch (error) {
        if (error?.code === 'ENOENT') this.entries[target] = [];
      }
    }
    return this.snapshot();
  }

  /** Read both files from disk. */
  async load() {
    this.entries.user = await this.readTarget('user');
    this.entries.memory = await this.readTarget('memory');
    return this.snapshot();
  }

  async writeTarget(target, entries) {
    await mkdir(this.dir, { recursive: true });
    const path = this.pathFor(target);
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, entries.length ? `${joinEntries(entries)}\n` : '', 'utf8');
    await rename(temp, path);
  }

  /** Run `work` after every earlier change has finished, whatever its outcome. */
  serial(work) {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Re-read `target`, let `mutate(entries)` return `{entries, message, changed}`
   * or a failure, then save. The read is fresh every time so a hand edit made
   * since the last change is kept.
   */
  change(target, action, mutate) {
    return this.serial(async () => {
      if (!isTarget(target)) return this.fail(target, `unknown target '${target}' — use 'memory' or 'user'`);
      let current;
      try {
        current = await this.readTarget(target);
      } catch (error) {
        return this.fail(target, `could not read ${TARGETS[target].file} (${error?.code || error?.message || error}); nothing was changed`);
      }
      this.entries[target] = current;
      const result = mutate([...current]);
      if (result.success === false) return result;
      try {
        await this.writeTarget(target, result.entries);
      } catch (error) {
        return this.fail(target, `could not save ${TARGETS[target].file} (${error?.code || error?.message || error}); nothing was changed`);
      }
      this.entries[target] = result.entries;
      return {
        success: true,
        target,
        action,
        message: result.message,
        changed: result.changed,
        usage: this.usage(target),
        entryCount: result.entries.length,
      };
    });
  }

  fail(target, error, extra = {}) {
    const known = isTarget(target);
    return {
      success: false,
      target,
      error,
      ...(known ? { usage: this.usage(target) } : {}),
      ...extra,
    };
  }

  /** A failure that carries the live entries, so the model can consolidate. */
  failWithEntries(target, entries, error) {
    return this.fail(target, error, { currentEntries: entries, usage: this.usage(target, entries) });
  }

  /** The index of the one entry containing `oldText`, or a failure. */
  findOne(target, entries, oldText) {
    if (typeof oldText !== 'string' || oldText.trim() === '') {
      return this.failWithEntries(target, entries, 'old_text is required: a short piece of the entry to change, unique to it');
    }
    const needle = oldText.trim();
    const hits = entries.map((e, i) => (e.includes(needle) ? i : -1)).filter((i) => i >= 0);
    if (hits.length === 0) return this.failWithEntries(target, entries, `no ${TARGETS[target].label} entry contains "${needle}"`);
    if (hits.length > 1) {
      return this.failWithEntries(target, entries, `"${needle}" is in ${hits.length} entries — use a longer piece that is unique to one`);
    }
    return hits[0];
  }

  /** Apply one operation to an entry list in memory; no budget check, no save. */
  step(target, entries, op, { scan }) {
    const action = op?.action;
    const content = typeof op?.content === 'string' ? op.content : typeof op?.new_text === 'string' ? op.new_text : undefined;
    if (action === 'add' || action === 'replace') {
      const problem = entryProblem(content);
      if (problem) return this.failWithEntries(target, entries, `${action}: ${problem}`);
      if (scan) {
        const threat = firstThreatMessage(content);
        if (threat) return this.fail(target, threat, { blocked: true });
      }
    }
    if (action === 'add') {
      const entry = content.trim();
      if (entries.includes(entry)) return { entries, changed: { added: [] }, note: 'already saved' };
      return { entries: [...entries, entry], changed: { added: [entry] } };
    }
    if (action === 'replace' || action === 'remove') {
      const at = this.findOne(target, entries, op.old_text);
      if (typeof at !== 'number') return at;
      const before = entries[at];
      if (action === 'remove') {
        return { entries: entries.filter((_, i) => i !== at), changed: { removed: [before] } };
      }
      const after = content.trim();
      const next = [...entries];
      if (next.includes(after) && after !== before) next.splice(at, 1); // merging into an existing entry
      else next[at] = after;
      return { entries: next, changed: { replaced: [{ from: before, to: after }] } };
    }
    return this.failWithEntries(target, entries, `unknown action '${action}' — use add, replace or remove`);
  }

  overBudget(target, entries, what) {
    const { chars, limit } = this.usage(target, entries);
    return this.failWithEntries(target, this.entries[target],
      `${what} would bring the ${TARGETS[target].label} to ${chars.toLocaleString('en-US')}/${limit.toLocaleString('en-US')} characters — over its budget. `
      + 'Consolidate in ONE memory call: an operations batch that replaces overlapping entries with shorter merged ones or removes stale ones, '
      + 'and adds the new entry, all together. The budget is checked on the final result.');
  }

  /** @param {{scan?: boolean}} [options] scan=false for edits the user makes themselves */
  add(target, content, { scan = true } = {}) {
    return this.change(target, 'add', (entries) => {
      const r = this.step(target, entries, { action: 'add', content }, { scan });
      if (r.success === false) return r;
      if (r.note === 'already saved') return { entries, message: 'That entry is already saved — nothing changed.', changed: { added: [] } };
      if (sizeOf(r.entries) > this.limit(target)) return this.overBudget(target, r.entries, 'Adding this entry');
      return { entries: r.entries, message: 'Entry added.', changed: r.changed };
    });
  }

  replace(target, oldText, content, { scan = true } = {}) {
    return this.change(target, 'replace', (entries) => {
      const r = this.step(target, entries, { action: 'replace', old_text: oldText, content }, { scan });
      if (r.success === false) return r;
      if (sizeOf(r.entries) > this.limit(target)) return this.overBudget(target, r.entries, 'This replacement');
      return { entries: r.entries, message: 'Entry replaced.', changed: r.changed };
    });
  }

  remove(target, oldText) {
    return this.change(target, 'remove', (entries) => {
      const r = this.step(target, entries, { action: 'remove', old_text: oldText }, { scan: false });
      if (r.success === false) return r;
      return { entries: r.entries, message: 'Entry removed.', changed: r.changed };
    });
  }

  /**
   * Several operations as one change: applied in order to a copy, the budget
   * checked once on the final list, and nothing written unless every step
   * works. This is what lets a full store make room and add in one call.
   */
  applyBatch(target, operations, { scan = true } = {}) {
    return this.change(target, 'batch', (entries) => {
      if (!Array.isArray(operations) || operations.length === 0) {
        return this.failWithEntries(target, entries, 'operations must be a non-empty list of {action, content?, old_text?}');
      }
      let list = entries;
      const changed = { added: [], removed: [], replaced: [] };
      for (const [index, op] of operations.entries()) {
        const r = this.step(target, list, op, { scan });
        if (r.success === false) return { ...r, error: `operation ${index + 1} (${op?.action ?? '?'}): ${r.error} — nothing was changed` };
        list = r.entries;
        for (const key of Object.keys(changed)) if (r.changed?.[key]) changed[key].push(...r.changed[key]);
      }
      if (sizeOf(list) > this.limit(target)) return this.overBudget(target, list, 'This batch');
      return { entries: list, message: `${operations.length} change(s) applied.`, changed };
    });
  }
}

// dsh-memory-recall — Hermes Agent-style memory for dsh.
//
//   memory          the model saves, corrects and forgets facts in USER.md and
//                   MEMORY.md; every new chat starts with them in its prompt
//   session_search  the model looks things up in earlier chats — after the
//                   user allows it, through dsh's own approval prompt
//
// Data lives in ~/.dsh/dsh-memory-recall/. Nothing leaves the machine.
//
// Config (all optional, set on this plugin's row in cordis.patch.yml):
//   dir                   where USER.md and MEMORY.md live
//   limits: {memory, user} character budgets (default 2200 / 1375)
//   recall: false         drop session_search, keep memory
//   askBeforeRecall: false read earlier chats without asking (default: ask)

import { homedir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from './store.js';
import { SECTION_NAME, SECTION_ORDER, renderSection } from './snapshot.js';
import { createMemoryTool } from './memory-tool.js';
import { createRecall } from './recall.js';
import { createRecallTool } from './recall-tool.js';
import { createBriefings, createRecallLog, registerRoutes } from './routes.js';
import { createChatIndex } from './chats.js';
import { loadDefineTool } from './dsh-tools.js';
import { injectionReason, memoryMessage, pendingMemory } from './inject.js';
import { digestOf } from './routes.js';

export const name = 'dsh-memory-recall';

/**
 * Required services only. The session query, approval and system-prompt
 * services are resolved per use with `get`, so a composition without one
 * loses that feature rather than failing to load the plugin.
 */
export const inject = ['webServer', 'tools'];

/** Look a service up without throwing when it is absent. */
function service(ctx, id) {
  try {
    return ctx?.get?.(id);
  } catch {
    return undefined;
  }
}

/** A user's own chat — not a sub-agent the model started. */
function isTopLevel(agent) {
  const header = agent?.session?.header;
  return !header || (!header.parentSession && header.origin !== 'subagent');
}

/**
 * @param {object} ctx host plugin context
 * @param {object} [config]
 * @param {object} [deps] test hooks: defineTool, loadDefineTool
 */
export async function apply(ctx, config = {}, deps = {}) {
  const dir = config.dir || join(homedir(), '.dsh', 'dsh-memory-recall');
  const store = new MemoryStore({ dir, limits: config.limits });
  await store.load();

  const log = createRecallLog();
  const grants = new Map();
  // Every chat, grouped by workspace: the @ menu's list, and what a
  // `workspace` given to session_search resolves against.
  const chatIndex = createChatIndex({
    getQuery: () => service(ctx, 'sessionQuery'),
    getWorkspaces: () => service(ctx, 'workspaceRegistry'),
  });
  const cwdOf = async (sessionId) => {
    try {
      const rows = await service(ctx, 'sessionQuery')?.filterSessions?.([{ kind: 'id', values: [sessionId] }]);
      return rows?.[0]?.header?.cwd ?? null;
    } catch {
      return null;
    }
  };
  const disposers = [];
  // Whether the model actually got its tools. The prompt and the Memory
  // panel both read this, so neither can promise a tool that is not there.
  const tooling = { ok: false, error: null, tools: [] };

  // ---- the model's tools ----------------------------------------------
  if (ctx.tools?.register) {
    try {
      const defineTool = deps.defineTool ?? (await (deps.loadDefineTool ?? loadDefineTool)());
      const tools = [createMemoryTool({ store, defineTool })];
      if (config.recall !== false) {
        const recall = createRecall({ getQuery: () => service(ctx, 'sessionQuery'), options: config.recallOptions });
        tools.push(createRecallTool({
          recall,
          defineTool,
          getApproval: () => service(ctx, 'approval'),
          grants,
          log,
          askFirst: config.askBeforeRecall !== false,
          resolveWorkspace: (name) => chatIndex.resolveWorkspace(name),
          listWorkspaces: async () => (await chatIndex.list()).workspaces,
        }));
      }
      for (const tool of tools) {
        const dispose = ctx.tools.register(tool);
        if (typeof dispose === 'function') disposers.push(dispose);
        tooling.tools.push(tool.name);
      }
      tooling.ok = true;
    } catch (error) {
      tooling.error = String(error?.message ?? error);
      ctx.logger?.warn?.(`[dsh-memory-recall] tools not registered: ${tooling.error}`);
    }
  } else {
    tooling.error = 'this dsh has no tool registry';
  }

  // ---- each new chat: memory guidance in its prompt, frozen for its
  // lifetime. dsh 0.1.7 removed `agent/session-start`; `agent/created` and
  // `agent/disposed` exist on every dsh from 0.1.0-rc.7 through 0.2.x, so
  // they are the seam — session-start stays wired as a back-compat path,
  // deduped by the same map.
  /** Agent contexts already carrying the section -> the registering fiber. */
  const briefed = new WeakMap();
  // sessionId -> what that chat's prompt was given, for the composer chip.
  const briefings = createBriefings();

  const installGuidance = (agent) => {
    const agentCtx = agent?.ctx;
    if (!agentCtx || briefed.has(agentCtx) || !isTopLevel(agent)) return;
    try {
      // Read now, once: this text is what the chat keeps, so a save made later
      // in it never rewrites its prompt (which would cost the cached prefix).
      // The guidance only: fixed text, so the cached prompt prefix holds.
      const text = renderSection(null, store.limits, { tools: tooling.ok });
      // `inject` rather than `get`: at agent/created the prompt service may not
      // be resolvable yet; the callback runs once it is, and the fiber's
      // dispose() takes the section back out.
      const fiber = agentCtx.inject?.(['systemPrompt'], (scope) => {
        if (!isTopLevel(agent)) return; // the header may have attached since created
        try {
          scope.systemPrompt?.section?.({ name: SECTION_NAME, order: SECTION_ORDER, text });
        } catch {
          // Already registered (e.g. after a plugin reload): a duplicate name throws.
        }
      });
      if (fiber) briefed.set(agentCtx, fiber);
    } catch (error) {
      // Losing the guidance costs this chat its memory, never the chat.
      ctx.logger?.warn?.(`[dsh-memory-recall] no memory for this chat: ${error?.message ?? error}`);
    }
  };

  const uninstallGuidance = (agent) => {
    const agentCtx = agent?.ctx;
    const fiber = agentCtx && briefed.get(agentCtx);
    if (!fiber) return;
    briefed.delete(agentCtx);
    try {
      fiber.dispose?.();
    } catch {
      // Teardown must not throw.
    }
  };

  // Agents that already exist when this plugin mounts (a reload).
  ctx.inject?.(['agents'], (scope) => {
    for (const agent of scope.agents?.list?.() ?? []) installGuidance(agent);
  });
  ctx.on?.('agent/created', (payload) => installGuidance(payload?.agent));
  ctx.on?.('agent/disposed', (payload) => uninstallGuidance(payload?.agent));
  // Older hosts fire this instead of agent/created; the map dedupes.
  ctx.on?.('agent/session-start', (payload) => installGuidance(payload?.agent));

  // ---- the memory itself: a logged context message, whenever the chat
  // cannot see the current version (start, after compaction, after a change).
  ctx.on?.('agent/pre-step', async (payload, next) => {
    const decision = await next();
    const agent = payload?.agent;
    if (!decision || decision.kind === 'reject' || !agent?.session || !isTopLevel(agent)) return decision;
    try {
      const stores = await store.load();
      const reason = injectionReason(agent.session, digestOf(stores));
      const pending = pendingMemory(decision.messages);
      if (!reason) {
        return pending ? { ...decision, messages: decision.messages.filter((m) => m !== pending) } : decision;
      }
      const message = memoryMessage(stores, store.limits, reason);
      if (agent.id) briefings.record(agent.id, stores, reason);
      const messages = decision.messages ?? [];
      return { ...decision, messages: pending ? messages.map((m) => (m === pending ? message : m)) : [...messages, message] };
    } catch (error) {
      // Memory that cannot be read costs this step its memory, never the step.
      ctx.logger?.warn?.(`[dsh-memory-recall] memory not delivered: ${error?.message ?? error}`);
      return decision;
    }
  });

  // One "allow" lasts until the reply it was given in ends.
  ctx.on?.('agent/status', (payload) => {
    if (payload?.status === 'idle' && payload.agent?.id) grants.delete(payload.agent.id);
  });

  // ---- the browser half ----------------------------------------------
  if (ctx.webServer?.register) {
    disposers.push(registerRoutes(ctx.webServer, { store, log, chatIndex, cwdOf, tooling, briefings }));
  } else {
    ctx.logger?.warn?.('[dsh-memory-recall] webServer unavailable; the Memory panel and cards will be empty');
  }

  ctx.on?.('dispose', () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* keep disposing the rest */ }
    }
  });
  // cordis treats a returned value as an effect disposer; return nothing.
}

export default { apply, inject, name };

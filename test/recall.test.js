import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecall, keywords, cleanSnippet, excerpt } from '../src/recall.js';
import { chat, fakeSessionQuery } from './fake-dsh.js';

const CHATS = [
  chat('s-graft', {
    day: 1, title: 'Graft viz in the default sidebar', cwd: 'B:\\Research\\dsh-graft',
    messages: [
      ['user', 'make the graft viz open in the sidebar'],
      ['assistant', 'Registered a sidebar tab for the graft viz.'],
      ['tool', 'sidebar sidebar sidebar (tool noise)'],
      ['user', 'does it fall back when better-sidebar is missing?'],
      ['assistant', 'Yes: better-sidebar first, then the built-in right sidebar.'],
    ],
  }),
  chat('s-sched', {
    day: 3, title: 'Schedule later UI', messages: [
      ['user', 'the sidebar panel for scheduled messages'],
      ['assistant', 'Tinted rows by time of day.'],
    ],
  }),
  chat('s-sub', { day: 4, parentSession: 's-graft', origin: 'subagent', messages: [['user', 'graft viz sidebar internals']] }),
  chat('s-now', { day: 5, title: 'Current chat', messages: [['user', 'graft viz sidebar again']] }),
];

const recallOver = (chats = CHATS, opts) => createRecall({ getQuery: () => fakeSessionQuery(chats, opts) });

test('keywords: distinctive words only', () => {
  assert.deepEqual(keywords('What did we decide about the graft sidebar last time?'), ['graft', 'sidebar']);
  assert.deepEqual(keywords('dsh-send-later tasks.json'), ['dsh-send-later', 'tasks.json']);
});

test('snippets: dsh match markers become **bold**; excerpt marks a literal hit', () => {
  assert.equal(cleanSnippet('open \uFDD0graft\uFDD1 viz'), 'open **graft** viz');
  assert.match(excerpt('x'.repeat(300) + ' needle here', 'needle'), /^….*\*\*needle\*\* here$/);
});

test('discover: phrase hits, the asking chat and sub-agents left out, top result with context', async () => {
  const r = await recallOver().discover({ query: 'graft viz', excludeId: 's-now' });
  assert.equal(r.engine, 'fts');
  assert.deepEqual(r.results.map((x) => x.sessionId), ['s-graft']);
  const top = r.results[0];
  assert.equal(top.title, 'Graft viz in the default sidebar');
  assert.match(top.match.snippet, /\*\*graft viz\*\*/);
  assert.ok(top.context.length >= 2);
  assert.ok(top.context.every((m) => m.role === 'user' || m.role === 'assistant'), 'tool noise is not context');
});

test('discover: a sentence that matches nothing as a phrase is widened word by word', async () => {
  const r = await recallOver().discover({ query: 'graft sidebar fallback', excludeId: 's-now' });
  assert.equal(r.widened, true);
  assert.equal(r.results[0].sessionId, 's-graft', 'the chat with the most of the words ranks first');
  assert.deepEqual(r.results[0].matchedWords, ['graft', 'sidebar']);
  assert.ok(r.results.some((x) => x.sessionId === 's-sched'), 'a chat with one of the words is still offered');
});

test('discover: sort newest / oldest reorders by date', async () => {
  const newest = await recallOver().discover({ query: 'sidebar', sort: 'newest', excludeId: 's-now' });
  assert.deepEqual(newest.results.map((x) => x.sessionId), ['s-sched', 's-graft']);
  const oldest = await recallOver().discover({ query: 'sidebar', sort: 'oldest', excludeId: 's-now' });
  assert.deepEqual(oldest.results.map((x) => x.sessionId), ['s-graft', 's-sched']);
});

test('discover: with dsh search switched off, a literal scan stands in', async () => {
  const r = await recallOver(CHATS, { searchEnabled: false }).discover({ query: 'better-sidebar', excludeId: 's-now' });
  assert.equal(r.engine, 'scan');
  assert.equal(r.results[0].sessionId, 's-graft');
  assert.match(r.results[0].match.snippet, /\*\*better-sidebar\*\*/);
});

test('discover: an empty query is refused', async () => {
  await assert.rejects(recallOver().discover({ query: '  ' }), /query is empty/);
});

test('scroll and read: around a message, and how a chat began and ended', async () => {
  const recall = recallOver();
  const scroll = await recall.scroll({ sessionId: 's-graft', aroundSeq: 12 });
  assert.equal(scroll.session.title, 'Graft viz in the default sidebar');
  assert.ok(scroll.messages.some((m) => m.seq === 12));
  const read = await recall.read({ sessionId: 's-graft' });
  assert.equal(read.total, 4, 'user and assistant messages only');
  assert.equal(read.omitted, 0);
  await assert.rejects(recall.read({ sessionId: 'nope' }), /no chat with id nope/);
});

test('browse: newest top-level chats, the asking one left out', async () => {
  const r = await recallOver().browse({ excludeId: 's-now' });
  assert.deepEqual(r.sessions.map((s) => s.sessionId), ['s-sched', 's-graft']);
});

test('no session query service: a clear failure, not a crash', async () => {
  const recall = createRecall({ getQuery: () => undefined });
  await assert.rejects(recall.browse({}), /session query service is not available/);
});

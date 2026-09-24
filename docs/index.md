---
layout: default
title: dsh-memory-recall
---

# dsh-memory-recall

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that gives the model a memory, in the style of [Hermes Agent](https://github.com/NousResearch/hermes-agent). What it learns about you and your projects — how you like answers, where things run, what broke last time — is kept in two short files and carried into every new chat.

It can also look back: ask *"what did we decide last time?"* and it searches your earlier chats — but only after dsh's own approval prompt asks you, saying what it wants to look for.

[View on GitHub](https://github.com/adithyanraj03/dsh-memory-recall){: .btn }

![license](https://img.shields.io/badge/license-MIT-blue) ![dsh](https://img.shields.io/badge/dsh-web%20profile-orange) ![deps](https://img.shields.io/badge/runtime%20deps-none-brightgreen) ![runtime](https://img.shields.io/badge/runtime-offline_%C2%B7_100%25_local-brightgreen)

---

## Install

```sh
dsh plugin --profile web add dsh-memory-recall
dsh --profile web
```

Restart `dsh web` and hard-refresh the browser. **🧠 Memory** appears at the bottom of the sidebar.

For ranked search of earlier chats, switch on dsh's full-text index — the [README](https://github.com/adithyanraj03/dsh-memory-recall#turn-on-dshs-full-text-search-recommended) has the three lines.

---

## Memory you can see

![Saves in the chat: an added note and an updated profile entry](assets/saved-chip.png)

- **Nothing is remembered behind your back.** Every save shows in the chat as a 🧠 note; click it for exactly what changed and how full memory is.
- **Small on purpose.** 2,200 characters of notes and 1,375 of profile — Hermes's budgets — because memory is paid for in every chat. When it is full, the model merges and drops stale entries rather than growing.
- **Guarded.** Every write the model makes is scanned for prompt-injection and exfiltration phrasing and hidden Unicode, using Hermes Agent's patterns, and refused with the reason.

---

## The Memory panel

![The Memory panel with the model's notes](assets/memory-panel.png)

Notes and Profile tabs, each with a budget ring and bar. Edit or delete any entry in place, add your own, search once there are a few. With the sidebar collapsed it becomes a single icon.

![The Profile tab in the light theme](assets/memory-panel-light.png)

---

## Looking back, with permission

![A recall card: three earlier chats found for "deploy rollback"](assets/recall-card.png)

`session_search` returns your chats' actual messages — nothing summarised, nothing invented — with a link to open each one. One Allow covers the reply it was asked for; the next question asks again. Deny, and nothing is read.

Type `@` to pick a chat or a whole workspace from a list grouped by workspace: a chat is attached directly, and a workspace narrows the search to its chats.

---

## Privacy

No telemetry and no third-party requests. Memory is two plain-text files in `~/.dsh/dsh-memory-recall/`, readable and editable by hand; earlier chats are read from dsh's own session store on your machine.

---

Released under the MIT licence. Design after Hermes Agent by Nous Research (MIT).

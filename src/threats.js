// Refuse memory writes that read like a prompt injection or an exfiltration.
//
// Memory is pasted into the system prompt of every chat that starts after it
// is saved, so a poisoned entry is not a one-off: it keeps instructing the
// model in every future session until someone notices and deletes it. Every
// write the MODEL makes is scanned here first; a hit refuses the write and
// says why. (Edits you make yourself in the Memory panel are yours and are not
// scanned.)
//
// Ported from Hermes Agent's tools/threat_patterns.py — the scope it applies to
// memory writes, which is every pattern it has — with Hermes-specific paths
// swapped for dsh's. Hermes Agent is MIT licensed, (c) 2025 Nous Research.
// The rule it states for new patterns applies here too: anchor on attack
// vocabulary or unambiguous attack behaviour, not on bossy English ("you must"
// is common in legitimate notes).

/** Scanners are advisory: bound the worst case. */
export const MAX_SCAN_CHARS = 65_536;

// Bounded filler between key words; an unbounded `(?:\w+\s+)*` backtracks badly.
const F = String.raw`(?:\w+\s+){0,8}`;
// An env var whose name ENDS in a secret-ish word ($OPENAI_API_KEY, ${TOKEN}),
// so a benign $SOME_KEYBOARD_URL passes.
const SECRET_VAR = String.raw`\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b`;
const MODIFY = String.raw`(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}`;

/** [pattern source, id] — all matched case-insensitively. */
const PATTERNS = [
  // Classic prompt injection
  [String.raw`ignore\s+${F}(previous|all|above|prior)\s+${F}instructions`, 'prompt_injection'],
  [String.raw`system\s+prompt\s+override`, 'sys_prompt_override'],
  [String.raw`disregard\s+${F}(your|all|any)\s+${F}(instructions|rules|guidelines)`, 'disregard_rules'],
  [String.raw`act\s+as\s+(if|though)\s+${F}you\s+${F}(have\s+no|don't\s+have)\s+${F}(restrictions|limits|rules)`, 'bypass_restrictions'],
  [String.raw`<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->`, 'html_comment_injection'],
  [String.raw`<\s*div\s+style\s*=\s*["'][^>]{0,2048}display\s*:\s*none`, 'hidden_div'],
  [String.raw`translate\s+[^\n]{0,512}\s+into\s+\w+(?:[\s-]+\w+){0,2}\s+and\s+(execute|run|eval)\b`, 'translate_execute'],
  [String.raw`do\s+not\s+${F}tell\s+${F}the\s+user`, 'deception_hide'],

  // Role-play / identity hijack
  [String.raw`you\s+are\s+${F}now\s+(?:a|an|the)\s+`, 'role_hijack'],
  [String.raw`pretend\s+${F}(you\s+are|to\s+be)\s+`, 'role_pretend'],
  [String.raw`output\s+${F}(system|initial)\s+prompt`, 'leak_system_prompt'],
  [String.raw`(respond|answer|reply)\s+without\s+${F}(restrictions|limitations|filters|safety)`, 'remove_filters'],
  [String.raw`you\s+have\s+been\s+${F}(updated|upgraded|patched)\s+to`, 'fake_update'],
  [String.raw`\bname\s+yourself\s+\w+`, 'identity_override'],

  // Command-and-control style promptware
  [String.raw`register\s+(as\s+)?a?\s*node`, 'c2_node_registration'],
  [String.raw`(heartbeat|beacon|check[\s\-]?in)\s+(to|with)\s+`, 'c2_heartbeat'],
  [String.raw`pull\s+(down\s+)?(?:new\s+)?task(?:ing|s)?\b`, 'c2_task_pull'],
  [String.raw`connect\s+to\s+the\s+network\b`, 'c2_network_connect'],
  [String.raw`you\s+must\s+(?:\w+\s+){0,3}(register|connect|report|beacon)\b`, 'forced_action'],
  [String.raw`only\s+use\s+one[\s\-]?liners?\b`, 'anti_forensic_oneliner'],
  [String.raw`never\s+${F}(?:create|write)\s+${F}(?:script|file)\s+${F}disk`, 'anti_forensic_disk'],
  [String.raw`unset\s+\w*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC|DEEPSEEK|DSH)\w*`, 'env_var_unset_agent'],
  [String.raw`\b(?:cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b`, 'known_c2_framework'],
  [String.raw`\bc2\s+(?:server|channel|infrastructure|beacon)\b`, 'c2_explicit'],
  [String.raw`\bcommand\s+and\s+control\b`, 'c2_explicit_long'],

  // Exfiltration
  [String.raw`curl\s+[^\n]{0,2048}${SECRET_VAR}`, 'exfil_curl'],
  [String.raw`wget\s+[^\n]{0,2048}${SECRET_VAR}`, 'exfil_wget'],
  [String.raw`cat\s+[^\n]{0,2048}(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)`, 'read_secrets'],
  [String.raw`(send|post|upload|transmit)\s+[^\n]{0,2048}\s+(to|at)\s+https?://`, 'send_to_url'],
  [String.raw`(include|output|print|share)\s+${F}(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)`, 'context_exfil'],

  // Persistence / backdoors, and tampering with the agent's own configuration
  [String.raw`authorized_keys`, 'ssh_backdoor'],
  [String.raw`\$HOME/\.ssh|~/\.ssh`, 'ssh_access'],
  [String.raw`\$HOME/\.dsh/\.env|~/\.dsh/\.env`, 'dsh_env'],
  [String.raw`${MODIFY}(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)`, 'agent_config_mod'],
  [String.raw`${MODIFY}\.dsh/(settings\.yaml|cordis\.patch\.yml|cordis\.yml)`, 'dsh_config_mod'],

  // Hardcoded secrets
  [String.raw`(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}`, 'hardcoded_secret'],
].map(([source, id]) => [new RegExp(source, 'i'), id]);

/**
 * Zero-width and bidirectional-control characters: invisible in any editor,
 * used to hide instructions inside innocent-looking text.
 */
export const INVISIBLE_CHARS = new Set([
  '\u200B', '\u200C', '\u200D', '\u2060', '\u2062', '\u2063', '\u2064', '\uFEFF',
  '\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069',
]);

/** Every pattern id found in `content`; invisible characters as `invisible_unicode_U+XXXX`. */
export function scanForThreats(content) {
  if (typeof content !== 'string' || content === '') return [];
  const text = content.slice(0, MAX_SCAN_CHARS);
  const found = [];
  // On the raw text: NFKC below can remove some of these code points.
  for (const ch of new Set(text)) {
    if (INVISIBLE_CHARS.has(ch)) found.push(`invisible_unicode_U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  }
  // NFKC folds full-width and compatibility forms (ｃａｔ → cat), so a
  // homograph spelling does not slip past. Cross-script look-alikes
  // (Cyrillic а) are not folded — that needs a confusables table.
  const folded = text.normalize('NFKC');
  for (const [pattern, id] of PATTERNS) if (pattern.test(folded)) found.push(id);
  return found;
}

/** A user-facing refusal for the first threat found, or null. */
export function firstThreatMessage(content) {
  const [first] = scanForThreats(content);
  if (first === undefined) return null;
  if (first.startsWith('invisible_unicode_')) {
    return `Blocked: the entry contains an invisible unicode character ${first.slice('invisible_unicode_'.length)} (possible hidden instruction).`;
  }
  return `Blocked: the entry matches the threat pattern '${first}'. Memory is placed in the system prompt of every future chat, `
    + 'so it must not contain injection or exfiltration instructions.';
}

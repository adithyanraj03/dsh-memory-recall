// dsh-memory-recall — browser half. Hand-written: no build step.
//
//   tool.call.toolview[memory]          the "Saved to memory" chip in the chat
//   tool.call.toolview[session_search]  the recall card: waiting for OK → chats found
//   sidebar.footer.action               the Memory entry and its panel
//
// The Allow/Deny prompt itself is dsh's own (it takes over the message box
// and shows the reason the host sent), so nothing here draws it.
window.__ModuleLoader__.load({
  id: "dsh-memory-recall",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;

    const BASE = "/plugin-data/dsh-memory-recall";
    const TARGET_LABEL = { user: "User profile", memory: "Notes" };
    const TARGET_HINT = {
      user: "Who you are — name, role, preferences, how you like to work.",
      memory: "The model's own notes — environment, conventions, lessons.",
    };

    /* ---- look ------------------------------------------------------------ */

    const STYLE_ID = "dsh-memory-recall-style";
    const CSS = [
      "@keyframes dmr-pulse{0%,100%{opacity:.45}50%{opacity:1}}",
      "@keyframes dmr-pop{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}",
      ".dmr-pulse{animation:dmr-pulse 1.4s ease-in-out infinite}",
      ".dmr-pop{animation:dmr-pop .16s ease-out}",
      // Hermes Desktop's "legendary" memory row (apps/desktop/src/styles.css):
      // its palette and colour-mix recipe, verbatim, scoped to the chip.
      ".dmr-chip{--dmr-yellow:#c08532;--dmr-orange:#db704b;--dmr-purple:#9e94d5;"
        + "--dmr-tertiary:var(--dsw-alias-label-tertiary,rgba(128,128,128,.85));"
        + "--dmr-from:color-mix(in srgb,var(--dmr-yellow) 72%,#f5d08a);"
        + "--dmr-mid:color-mix(in srgb,var(--dmr-orange) 55%,var(--dmr-purple));"
        + "--dmr-to:color-mix(in srgb,var(--dmr-purple) 82%,#c4b5fd);"
        + "--dmr-icon:color-mix(in srgb,var(--dmr-yellow) 55%,var(--dmr-purple));"
        + "--dmr-meta:color-mix(in srgb,var(--dmr-purple) 58%,var(--dmr-tertiary));"
        + "--dmr-glow:color-mix(in srgb,var(--dmr-purple) 38%,transparent)}",
      ".dmr-legendary-title{background-image:linear-gradient(105deg,var(--dmr-from) 0%,var(--dmr-mid) 48%,var(--dmr-to) 100%);"
        + "-webkit-background-clip:text;background-clip:text;color:transparent!important;font-weight:600}",
      ".dmr-legendary-glyph{color:var(--dmr-icon);filter:drop-shadow(0 0 .28rem var(--dmr-glow))}",
      ".dmr-legendary-meta{color:var(--dmr-meta)}",
      // While saving: the action word shimmers, as Hermes's tw-shimmer does.
      "@keyframes dmr-shimmer{from{background-position:150% 0}to{background-position:-50% 0}}",
      ".dmr-shimmer{background-image:linear-gradient(90deg,var(--dmr-tertiary) 0%,var(--dmr-tertiary) 35%,"
        + "var(--dsw-alias-label-primary,#f5f5f5) 50%,var(--dmr-tertiary) 65%,var(--dmr-tertiary) 100%);"
        + "background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;"
        + "animation:dmr-shimmer 1.8s linear infinite}",
      // Not in Hermes: one soft bloom of the glow at the moment the save lands.
      "@keyframes dmr-land{0%{filter:drop-shadow(0 0 0 transparent)}40%{filter:drop-shadow(0 0 .7rem var(--dmr-glow)) drop-shadow(0 0 .25rem var(--dmr-from))}"
        + "100%{filter:drop-shadow(0 0 .28rem var(--dmr-glow))}}",
      ".dmr-land{animation:dmr-land .9s ease-out 1}",
      ".dmr-row:hover{background:var(--dsw-alias-interactive-bg-hover-solid, rgba(128,128,128,.12))}",
      ".dmr-link{cursor:pointer;background:none;border:none;padding:0;color:inherit;font:inherit;text-align:left}",
      ".dmr-link:hover{text-decoration:underline}",
      "@media (prefers-reduced-motion:reduce){.dmr-pulse,.dmr-pop,.dmr-land{animation:none!important}"
        + ".dmr-shimmer{animation:none!important;color:var(--dmr-tertiary);background:none}}",
    ].join("\n");

    function injectStyles() {
      try {
        if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
        const el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = CSS;
        document.head.appendChild(el);
      } catch { /* no DOM */ }
    }

    function isDark() {
      try {
        return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      } catch {
        return false;
      }
    }

    const MUTED = "var(--dsw-alias-label-secondary, rgba(128,128,128,1))";
    const FAINT = "var(--dsw-alias-label-tertiary, rgba(128,128,128,.8))";
    const ACCENT = "#a78bfa";

    /** Brain outline (Lucide "brain", ISC licence), in the text colour. */
    function BrainIcon(size, extra) {
      const paths = [
        "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",
        "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
        "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",
        "M17.599 6.5a3 3 0 0 0 .399-1.375",
        "M6.003 5.125A3 3 0 0 0 6.401 6.5",
        "M3.477 10.896a4 4 0 0 1 .585-.396",
        "M19.938 10.5a4 4 0 0 1 .585.396",
        "M6 18a4 4 0 0 1-1.967-.516",
        "M19.967 17.484A4 4 0 0 1 18 18",
      ];
      return h("svg", {
        width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
        style: { flex: "none", display: "block" }, className: extra || undefined,
      }, paths.map((d, i) => h("path", { key: i, d })));
    }

    /**
     * The solid brain Hermes Desktop draws in its tool rows — Phosphor Icons
     * "brain", fill weight (MIT), the same path its tool-icon.tsx inlines.
     */
    function SolidBrainIcon(size, extra) {
      return h("svg", {
        width: size, height: size, viewBox: "0 0 256 256", fill: "currentColor", "aria-hidden": "true",
        style: { flex: "none", display: "block" }, className: extra || undefined,
      }, h("path", {
        d: "M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.22V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.39A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,51.2,86.1a8,8,0,0,0,5.6-6.83A32,32,0,0,1,120,72v75.36A47.79,47.79,0,0,0,88,136a8,8,0,0,0,0,16,32,32,0,0,1,32,32A24,24,0,0,1,88,208Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,136,184a32,32,0,0,1,32-32,8,8,0,0,0,0-16,47.79,47.79,0,0,0-32,11.36V72a32,32,0,0,1,63.2-7.27,8,8,0,0,0,5.6,6.83A40,40,0,0,1,192,164Z",
      }));
    }

    /** A clock with a turn-back arrow: looking back through earlier chats. */
    function HistoryIcon(size, extra) {
      return h("svg", {
        width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
        style: { flex: "none", display: "block" }, className: extra || undefined,
      }, [
        h("path", { key: "a", d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }),
        h("path", { key: "b", d: "M3 3v5h5" }),
        h("path", { key: "c", d: "M12 7v5l4 2" }),
      ]);
    }

    /** A small on/off switch, the knob sliding over the memory gradient when on. */
    function Switch(key, on, onChange, label) {
      return h("button", {
        key: "sw-" + key, type: "button", role: "switch", "aria-checked": on, "aria-label": label, "data-switch": key,
        onClick: () => onChange(!on),
        style: {
          flex: "none", position: "relative", width: 34, height: 19, borderRadius: 999, border: "none", padding: 0, cursor: "pointer",
          background: on ? "linear-gradient(105deg,#c08532,#9e94d5)" : "rgba(128,128,128,.35)", transition: "background .2s",
        },
      }, h("span", {
        style: {
          position: "absolute", top: 2, left: on ? 17 : 2, width: 15, height: 15, borderRadius: 999, background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .18s",
        },
      }));
    }

    function GearIcon(size) {
      return h("svg", {
        width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2,
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
      }, [
        h("circle", { key: "c", cx: 12, cy: 12, r: 3 }),
        h("path", { key: "p", d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" }),
      ]);
    }

    function Chevron(open) {
      return h("span", { style: { fontSize: 10, opacity: 0.6, marginLeft: 2 } }, open ? "▾" : "▸");
    }

    /** "**x**" from a snippet becomes bold; nothing else is interpreted. */
    function withBold(text) {
      return String(text ?? "").split("**").map((part, i) => (i % 2 ? h("b", { key: i }, part) : part));
    }

    function UsageBar(usage, width) {
      if (!usage || !usage.limit) return null;
      const pct = Math.max(0, Math.min(100, usage.percent));
      const colour = pct >= 90 ? "#f59e0b" : ACCENT;
      return h("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: FAINT } }, [
        h("div", { key: "bar", style: { width: width || 120, height: 4, borderRadius: 999, background: "rgba(128,128,128,.25)", overflow: "hidden" } },
          h("div", { style: { width: pct + "%", height: "100%", background: colour, transition: "width .3s" } })),
        h("span", { key: "t", style: { fontVariantNumeric: "tabular-nums" } },
          pct + "% · " + Number(usage.chars).toLocaleString("en-US") + "/" + Number(usage.limit).toLocaleString("en-US")),
      ]);
    }

    /* ---- display settings ------------------------------------------------------ */
    //
    // What the plugin adds to dsh's own UI can be switched off from the Memory
    // panel. Per browser (localStorage), applied at once through a window event,
    // so nothing needs a reload. Memory itself keeps working either way.

    const UI_KEY = "dsh-memory-recall:ui";
    const UI_EVENT = "dsh-memory-recall:ui";
    const UI_DEFAULTS = { composerButton: true, atMenu: true };
    const UI_SWITCHES = [
      { key: "composerButton", label: "Brain button in the message box", note: "Shows whether this chat has memory, and when it got it." },
      { key: "atMenu", label: "Chats & workspaces in @", note: "Every chat, grouped by workspace. Off: dsh\u2019s own @ chat list." },
    ];

    function readUi() {
      try {
        const raw = window.localStorage && window.localStorage.getItem(UI_KEY);
        const saved = raw ? JSON.parse(raw) : {};
        const out = { ...UI_DEFAULTS };
        for (const k of Object.keys(UI_DEFAULTS)) if (typeof saved?.[k] === "boolean") out[k] = saved[k];
        return out;
      } catch {
        return { ...UI_DEFAULTS };
      }
    }

    function writeUi(patch) {
      const next = { ...readUi(), ...patch };
      try { if (window.localStorage) window.localStorage.setItem(UI_KEY, JSON.stringify(next)); } catch { /* private window: this tab only */ }
      try { if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(UI_EVENT)); } catch { /* no events: next render */ }
      return next;
    }

    /** The current display settings, re-read when they change (here or in another tab). */
    function useUi() {
      const [ui, setUi] = React.useState(readUi);
      React.useEffect(() => {
        if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
        const onChange = () => setUi(readUi());
        window.addEventListener(UI_EVENT, onChange);
        window.addEventListener("storage", onChange);
        return () => { window.removeEventListener(UI_EVENT, onChange); window.removeEventListener("storage", onChange); };
      }, []);
      return ui;
    }

    /* ---- budgets ------------------------------------------------------------- */
    //
    // The character budgets of the two stores. The sliders post to /settings,
    // which saves them in the plugin's settings.json; they take effect from the
    // chat's next delivery. The limits in cordis.patch.yml stay the startup
    // defaults — "reset" returns to them.

    const BUDGET_META = {
      memory: { label: "Notes budget", note: "Characters of notes carried into every chat. A full store asks the model to consolidate." },
      user: { label: "Profile budget", note: "Characters of the user profile carried into every chat." },
    };

    function BudgetRow({ target, budgets, onCommit }) {
      const bounds = budgets.bounds[target];
      const saved = budgets.limits[target];
      const [value, setValue] = React.useState(saved);
      React.useEffect(() => { setValue(saved); }, [saved]);
      const commit = () => { if (value !== saved) onCommit({ limits: { [target]: value } }); };
      const fmt = (n) => n.toLocaleString("en-US");
      return h("div", { style: { display: "flex", flexDirection: "column", gap: 3, padding: "6px 0 3px" } }, [
        h("div", { key: "t", style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 } }, [
          h("span", { key: "l", style: { fontWeight: 600 } }, BUDGET_META[target].label),
          h("span", { key: "v", style: { fontSize: 11, color: FAINT, fontVariantNumeric: "tabular-nums" } }, fmt(value) + " chars \u00b7 \u2248" + fmt(Math.round(value / 4)) + " tokens"),
        ]),
        h("input", {
          key: "r", type: "range", min: bounds.min, max: bounds.max, step: bounds.step, value,
          "aria-label": BUDGET_META[target].label,
          style: { width: "100%", margin: "2px 0 0", accentColor: "#a59adc" },
          onChange: (e) => setValue(Number(e.target.value)),
          onPointerUp: commit, onKeyUp: commit,
        }),
        h("span", { key: "n", style: { fontSize: 11, color: FAINT, lineHeight: "15px" } }, BUDGET_META[target].note),
      ]);
    }

    /* ---- reading a tool call ---------------------------------------------- */

    const isSettled = (block) => block !== undefined && block !== null && "kind" in block;

    function argsOf(block) {
      if (!block) return {};
      const raw = ("kind" in block ? block.call?.argsRaw : block.argsRaw) ?? "";
      try {
        const v = JSON.parse(raw);
        return v && typeof v === "object" ? v : {};
      } catch {
        return {}; // still streaming, or not JSON
      }
    }

    function textOf(block) {
      const parts = [];
      for (const c of (Array.isArray(block?.content) ? block.content : [])) {
        if (typeof c?.text === "string") parts.push(c.text);
        else if (Array.isArray(c?.content)) for (const inner of c.content) if (typeof inner?.text === "string") parts.push(inner.text);
      }
      return parts.join("\n");
    }

    function usageIn(text) {
      const m = /(\d+)% — ([\d,]+)\/([\d,]+) chars/.exec(text || "");
      if (!m) return null;
      const n = (s) => Number(s.replace(/,/g, ""));
      return { percent: Number(m[1]), chars: n(m[2]), limit: n(m[3]) };
    }

    /** The changes a memory call asked for, as rows: + added, ~ replaced, − removed. */
    function changesOf(args) {
      const ops = Array.isArray(args.operations) && args.operations.length ? args.operations
        : args.action ? [{ action: args.action, content: args.content, old_text: args.old_text }] : [];
      return ops.filter((op) => op && op.action !== "read").map((op) => {
        const content = op.content ?? op.new_text;
        if (op.action === "add") return { sign: "+", text: content };
        if (op.action === "remove") return { sign: "−", text: op.old_text };
        if (op.action === "replace") return { sign: "~", text: content, from: op.old_text };
        return { sign: "?", text: JSON.stringify(op) };
      });
    }

    /* ---- the "Saved to memory" chip --------------------------------------- */

    function memoryStatus(block, args) {
      if (args && args.action === "read") {
        if (!isSettled(block)) return { label: "Reading memory…", action: "Reading", rest: " memory", tone: "busy" };
        return /^Read memory/.test(textOf(block)) && !block.isError ? { label: "Read memory", tone: "ok" } : { label: "Could not read memory", tone: "bad" };
      }
      if (!isSettled(block)) return { label: "Saving to memory…", action: "Saving", rest: " to memory", tone: "busy" };
      const text = textOf(block);
      const ops = changesOf(args).map((c) => c.sign);
      // A successful call, even one that changed nothing, lands "legendary" — as in Hermes.
      if (/^Already in memory/.test(text)) return { label: "Already in memory", tone: "ok" };
      if (/^Blocked/.test(text)) return { label: "Memory write blocked", tone: "bad" };
      if (/^Not saved/.test(text)) {
        return /over its budget/.test(text) ? { label: "Memory full — making room", tone: "warn" } : { label: "Not saved to memory", tone: "bad" };
      }
      if (block.isError) return { label: "Not saved to memory", tone: "bad" };
      if (ops.length && ops.every((s) => s === "−")) return { label: "Removed from memory", tone: "ok" };
      if (ops.length && ops.every((s) => s === "+")) return { label: "Saved to memory", tone: "ok" };
      return { label: "Updated memory", tone: "ok" };
    }

    const TONE = { ok: ACCENT, quiet: MUTED, busy: MUTED, warn: "#f59e0b", bad: "#ef4444" };

    function MemoryCall(props) {
      const { block } = props;
      const [open, setOpen] = React.useState(false);
      // Drawn while still saving? Then this chip watched the save land, and
      // gets the one bloom. A chip from history just shows the settled look.
      const [watchedLand] = React.useState(() => !isSettled(block));
      React.useEffect(() => { injectStyles(); }, []);
      const args = argsOf(block);
      const status = memoryStatus(block, args);
      const legendary = status.tone === "ok";
      const text = isSettled(block) ? textOf(block) : "";
      const usage = usageIn(text);
      const changes = changesOf(args);
      // A read names what it loaded, from its result's first line.
      const readCounts = args.action === "read" ? /^Read memory: (\d+) profile entr(?:y|ies), (\d+) notes?/.exec(text) : null;
      const target = args.action === "read"
        ? (readCounts ? readCounts[1] + " profile · " + readCounts[2] + " notes" : null)
        : args.target === "user" ? "user profile" : args.target === "memory" ? "notes" : null;
      // What a read loaded: its entry lines, shown when the card is opened.
      const readLines = args.action === "read" && text
        ? text.split("\n").filter((l) => /^(USER PROFILE|NOTES):|^\d+\. /.test(l))
        : [];

      const glyphClass = legendary ? "dmr-legendary-glyph" + (watchedLand ? " dmr-land" : "")
        : status.tone === "busy" ? "dmr-pulse" : undefined;
      const title = status.tone === "busy"
        ? h("span", { key: "l", style: { color: FAINT } }, [h("span", { key: "a", className: "dmr-shimmer" }, status.action), status.rest])
        : h("span", {
            key: "l",
            className: legendary ? "dmr-legendary-title" : undefined,
            style: legendary ? undefined : { color: TONE[status.tone] },
          }, status.label);

      return h("div", { "data-plugin": "dsh-memory-recall-chip", className: "dmr-chip", style: { margin: "2px 0", fontSize: 13 } }, [
        h("button", {
          key: "head", type: "button", className: "dmr-link", onClick: () => setOpen(!open), "aria-expanded": open,
          style: { display: "inline-flex", alignItems: "center", gap: 7, color: MUTED, padding: "2px 0" },
        }, [
          h("span", {
            key: "i", className: glyphClass,
            style: { display: "inline-flex", color: legendary ? undefined : TONE[status.tone] },
          }, SolidBrainIcon(14)),
          title,
          target ? h("span", { key: "t", className: legendary ? "dmr-legendary-meta" : undefined, style: legendary ? { fontSize: 12 } : { color: FAINT, fontSize: 12 } }, "· " + target) : null,
          Chevron(open),
        ]),
        open
          ? h("div", {
              key: "body", className: "dmr-pop",
              style: { margin: "4px 0 6px 22px", display: "flex", flexDirection: "column", gap: 4, fontSize: 12 },
            }, [
              ...changes.map((c, i) => h("div", { key: "c" + i, style: { display: "flex", gap: 6, alignItems: "baseline" } }, [
                h("span", { key: "s", style: { color: c.sign === "−" ? "#ef4444" : c.sign === "+" ? "#22c55e" : ACCENT, fontWeight: 700, width: 10, flex: "none" } }, c.sign),
                h("span", { key: "x", style: { whiteSpace: "pre-wrap", wordBreak: "break-word" } },
                  c.from ? [h("span", { key: "f", style: { color: FAINT, textDecoration: "line-through" } }, c.from), " → ", c.text] : c.text),
              ])),
              usage ? h("div", { key: "u", style: { marginTop: 2 } }, UsageBar(usage)) : null,
              ...readLines.map((l, i) => /^\d+\. /.test(l)
                ? h("div", { key: "r" + i, style: { whiteSpace: "pre-wrap", wordBreak: "break-word", paddingLeft: 10 } }, l)
                : h("div", { key: "r" + i, style: { color: FAINT, fontSize: 10.5, fontWeight: 700, letterSpacing: ".4px", marginTop: i ? 6 : 0 } }, l.replace(/:.*/, ""))),
              isSettled(block) && !/^Saved|^Already|^Read memory/.test(text)
                ? h("div", { key: "why", style: { color: FAINT, whiteSpace: "pre-wrap" } }, text.split("\n\n")[0])
                : null,
            ])
          : null,
      ]);
    }

    /* ---- the recall card --------------------------------------------------- */

    const DONE = new Set(["done", "declined", "error"]);

    function useRecallRecord(callId, settled) {
      const [record, setRecord] = React.useState(null);
      React.useEffect(() => {
        if (!callId) return undefined;
        let alive = true;
        let timer = null;
        const pull = async () => {
          try {
            const res = await fetch(BASE + "/recall?callId=" + encodeURIComponent(callId), { headers: { accept: "application/json" } });
            const body = res.ok ? await res.json() : null;
            if (!alive) return;
            if (body) setRecord(body);
            if (settled && (!body || DONE.has(body.status))) return; // final read done
          } catch { /* keep polling */ }
          if (alive && !settled) timer = setTimeout(pull, 800);
        };
        pull();
        return () => { alive = false; clearTimeout(timer); };
      }, [callId, settled]);
      return record;
    }

    function recallStatus(record, block) {
      const settled = isSettled(block);
      const text = settled ? textOf(block) : "";
      const status = record?.status ?? (settled ? (/^Found|^From|^Most recent|messages\./.test(text) ? "done" : /declined|withdrawn|Nobody could be asked/.test(text) ? "declined" : /^Recall failed/.test(text) ? "error" : "done") : "awaiting-approval");
      switch (status) {
        case "awaiting-approval": return { label: "Waiting for your OK to read past chats", tone: "warn", busy: true };
        case "starting":
        case "searching": return { label: "Searching past chats…", tone: "busy", busy: true };
        case "declined": return { label: "Not allowed — nothing was read", tone: "quiet" };
        case "error": return { label: "Recall failed", tone: "bad" };
        default: return { label: "Recalled from past chats", tone: "ok" };
      }
    }

    function describeAsk(args) {
      if (typeof args.query === "string" && args.query.trim()) return "“" + args.query.trim() + "”";
      if (args.session_id) return "one earlier chat";
      return "recent chats";
    }

    const dayOf = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

    function makeRecallCall(openChat) {
      return function RecallCall(props) {
        const { callId, block } = props;
        const settled = isSettled(block);
        const record = useRecallRecord(callId, settled);
        const [open, setOpen] = React.useState(true);
        React.useEffect(() => { injectStyles(); }, []);
        const args = argsOf(block);
        const status = recallStatus(record, block);
        const summary = record?.summary ?? null;
        const results = summary?.mode === "discover" ? summary.results : summary?.mode === "browse" ? summary.sessions : null;
        const count = summary?.mode === "discover" ? summary.results.length : null;

        const chatRow = (r, i) => h("div", {
          key: r.sessionId + i, className: "dmr-row",
          style: { display: "flex", flexDirection: "column", gap: 2, padding: "5px 8px", borderRadius: 8 },
        }, [
          h("div", { key: "t", style: { display: "flex", alignItems: "baseline", gap: 8 } }, [
            h("button", {
              key: "o", type: "button", className: "dmr-link", title: "Open this chat",
              onClick: () => openChat(r.sessionId),
              style: { fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
            }, r.title || "Untitled chat"),
            h("span", { key: "d", style: { marginLeft: "auto", color: FAINT, fontSize: 11, flex: "none" } }, dayOf(r.createdAt)),
          ]),
          r.snippet ? h("div", { key: "s", style: { color: MUTED, fontSize: 12, lineHeight: "17px" } }, withBold(r.snippet)) : null,
          r.matchedWords ? h("div", { key: "w", style: { color: FAINT, fontSize: 11 } }, "matched: " + r.matchedWords.join(", ")) : null,
        ]);

        let body = null;
        if (open && results && results.length) {
          body = h("div", { key: "body", className: "dmr-pop", style: { marginTop: 4, display: "flex", flexDirection: "column", gap: 1 } }, [
            ...results.map(chatRow),
            summary.engine === "scan"
              ? h("div", { key: "scan", style: { color: FAINT, fontSize: 11, padding: "2px 8px" } }, "dsh's full-text search is off, so recent chats were scanned instead.")
              : null,
          ]);
        } else if (open && summary && (summary.mode === "read" || summary.mode === "scroll")) {
          body = h("div", { key: "body", style: { marginTop: 4 } }, chatRow({ ...summary.session, snippet: summary.mode === "read" ? summary.count + " messages read" : "read around one message" }, 0));
        } else if (open && status.label === "Recalled from past chats" && count === 0) {
          body = h("div", { key: "body", style: { color: FAINT, fontSize: 12, margin: "4px 0 0 22px" } }, "No earlier chat matched.");
        }

        return h("div", {
          "data-plugin": "dsh-memory-recall-card",
          style: {
            margin: "4px 0", padding: "7px 10px", borderRadius: 10, fontSize: 13,
            border: "1px solid " + (status.tone === "warn" ? "rgba(245,158,11,.45)" : "rgba(128,128,128,.22)"),
            background: status.tone === "warn" ? "rgba(245,158,11,.08)" : "rgba(128,128,128,.05)",
          },
        }, [
          h("button", {
            key: "head", type: "button", className: "dmr-link", onClick: () => setOpen(!open), "aria-expanded": open,
            style: { display: "flex", alignItems: "center", gap: 8, width: "100%" },
          }, [
            h("span", { key: "i", style: { color: TONE[status.tone], display: "inline-flex" } }, HistoryIcon(15, status.busy ? "dmr-pulse" : undefined)),
            h("span", { key: "l", style: { fontWeight: 600 } }, status.label),
            h("span", { key: "q", style: { color: FAINT, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "· " + describeAsk(args)),
            count !== null && count > 0 ? h("span", { key: "n", style: { marginLeft: "auto", color: FAINT, fontSize: 12, flex: "none" } }, count + " found") : null,
            results && results.length ? Chevron(open) : null,
          ]),
          status.label.startsWith("Waiting")
            ? h("div", { key: "hint", style: { color: MUTED, fontSize: 12, marginTop: 3, marginLeft: 23 } }, "Allow or deny it in the message box below.")
            : null,
          body,
        ]);
      };
    }

    /* ---- the Memory panel -------------------------------------------------- */

    async function api(path, init) {
      const res = await fetch(BASE + path, { headers: { accept: "application/json", "content-type": "application/json" }, ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.result?.error || body?.error || "HTTP " + res.status);
      return body;
    }

    const PANEL_CSS = [
      // dsh's sidebar footer is a flex ROW that does not wrap, and every entry
      // asks for 100% of it, so the second entry is pushed off its right edge.
      // Measured on the live page: footer row > (display: contents wrapper) >
      // each entry. So the footer is the element whose GRANDCHILD is this
      // entry; wrapping it puts each entry on its own line, like Settings.
      // A CSS rule, not a one-off style, so it holds when dsh re-renders.
      "div:has(> * > [data-plugin=\"dsh-memory-recall-sidebar\"]),div:has(> [data-plugin=\"dsh-memory-recall-sidebar\"]){flex-wrap:wrap}",
      ".dmr-panel{--dmr-yellow:#c08532;--dmr-orange:#db704b;--dmr-purple:#9e94d5;"
        + "--dmr-from:color-mix(in srgb,var(--dmr-yellow) 72%,#f5d08a);"
        + "--dmr-mid:color-mix(in srgb,var(--dmr-orange) 55%,var(--dmr-purple));"
        + "--dmr-to:color-mix(in srgb,var(--dmr-purple) 82%,#c4b5fd);"
        + "--dmr-glow:color-mix(in srgb,var(--dmr-purple) 38%,transparent)}",
      ".dmr-card{position:relative;border-radius:10px;padding:9px 10px 8px 12px;transition:background .15s,border-color .15s}",
      ".dmr-card::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:3px;"
        + "background:linear-gradient(180deg,var(--dmr-from),var(--dmr-to));opacity:.75}",
      ".dmr-card .dmr-actions{opacity:0;transition:opacity .15s}",
      ".dmr-card:hover .dmr-actions,.dmr-card:focus-within .dmr-actions{opacity:1}",
      ".dmr-clamp{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}",
      ".dmr-icon-btn{cursor:pointer;border:none;background:transparent;color:inherit;width:26px;height:26px;border-radius:7px;"
        + "display:inline-flex;align-items:center;justify-content:center;opacity:.7}",
      ".dmr-icon-btn:hover{opacity:1;background:rgba(128,128,128,.18)}",
      ".dmr-tab{cursor:pointer;border:none;background:transparent;color:inherit;font:inherit;display:inline-flex;align-items:center;"
        + "gap:7px;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;opacity:.6;transition:opacity .15s,background .15s}",
      ".dmr-tab:hover{opacity:.9}",
      ".dmr-tab[aria-selected=\"true\"]{opacity:1;background:rgba(128,128,128,.16)}",
      ".dmr-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--dmr-from),var(--dmr-mid),var(--dmr-to));transition:width .35s}",
      ".dmr-gradient-text{background-image:linear-gradient(105deg,var(--dmr-from) 0%,var(--dmr-mid) 48%,var(--dmr-to) 100%);"
        + "-webkit-background-clip:text;background-clip:text;color:transparent}",
      ".dmr-glyph-glow{color:color-mix(in srgb,var(--dmr-yellow) 55%,var(--dmr-purple));filter:drop-shadow(0 0 .3rem var(--dmr-glow))}",
      ".dmr-input:focus{outline:none;border-color:color-mix(in srgb,var(--dmr-purple) 70%,transparent)!important;"
        + "box-shadow:0 0 0 3px color-mix(in srgb,var(--dmr-purple) 22%,transparent)}",
    ].join("\n");
    const PANEL_STYLE_ID = "dsh-memory-recall-panel-style";

    function injectPanelStyles() {
      try {
        if (typeof document === "undefined" || document.getElementById(PANEL_STYLE_ID)) return;
        const el = document.createElement("style");
        el.id = PANEL_STYLE_ID;
        el.textContent = PANEL_CSS;
        document.head.appendChild(el);
      } catch { /* no DOM */ }
    }

    const fmt = (n) => Number(n || 0).toLocaleString("en-US");
    const DELIM_COST = 3; // the "\n§\n" between two entries

    /** A small usage ring, for the tabs. */
    function Ring(percent, size) {
      const r = 6.5;
      const c = 2 * Math.PI * r;
      const p = Math.max(0, Math.min(100, percent || 0));
      return h("svg", { width: size || 16, height: size || 16, viewBox: "0 0 16 16", "aria-hidden": "true", style: { flex: "none" } }, [
        h("circle", { key: "t", cx: 8, cy: 8, r, fill: "none", stroke: "rgba(128,128,128,.3)", strokeWidth: 2 }),
        h("circle", {
          key: "f", cx: 8, cy: 8, r, fill: "none", strokeWidth: 2, strokeLinecap: "round",
          stroke: p >= 90 ? "#f59e0b" : "#9e94d5", strokeDasharray: c, strokeDashoffset: c * (1 - p / 100),
          transform: "rotate(-90 8 8)",
        }),
      ]);
    }

    function PencilIcon() {
      return h("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, [
        h("path", { key: "a", d: "M12 20h9" }),
        h("path", { key: "b", d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" }),
      ]);
    }

    function TrashIcon() {
      return h("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, [
        h("path", { key: "a", d: "M3 6h18" }),
        h("path", { key: "b", d: "M8 6V4h8v2" }),
        h("path", { key: "c", d: "M19 6l-1 14H6L5 6" }),
      ]);
    }

    /** How the budget would look with `text` in place of `replacing` (or added). */
    function budgetAfter(data, text, replacing) {
      const used = data?.usage?.chars ?? 0;
      const limit = data?.usage?.limit ?? 0;
      const count = (data?.entries ?? []).length;
      const next = String(text || "").trim().length;
      let after;
      if (replacing !== undefined) after = used - replacing.length + next;
      else after = used + next + (count > 0 && next > 0 ? DELIM_COST : 0);
      return { after, limit, delta: after - used, over: limit > 0 && after > limit };
    }

    function BudgetLine(b) {
      const sign = b.delta > 0 ? "+" : b.delta < 0 ? "−" : "±";
      return h("span", { style: { fontSize: 11, color: b.over ? "#ef4444" : FAINT, fontVariantNumeric: "tabular-nums" } },
        sign + fmt(Math.abs(b.delta)) + " chars · " + fmt(b.after) + " / " + fmt(b.limit) + (b.over ? " — over the limit" : ""));
    }

    function EntryCard(props) {
      const { entry, data, dark, onSave, onDelete } = props;
      const [mode, setMode] = React.useState("view"); // view | edit | confirm
      const [draft, setDraft] = React.useState(entry);
      const [expanded, setExpanded] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const long = entry.length > 240;
      const run = async (fn) => {
        setBusy(true);
        setError(null);
        try {
          await fn();
          return true;
        } catch (e) {
          setError(String(e?.message || e));
          return false;
        } finally {
          setBusy(false);
        }
      };
      const surface = dark ? "rgba(255,255,255,.035)" : "rgba(0,0,0,.025)";
      const field = {
        width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", fontSize: 12.5, lineHeight: "18px",
        padding: "7px 9px", borderRadius: 8, border: "1px solid rgba(128,128,128,.35)",
        background: dark ? "rgba(0,0,0,.25)" : "#fff", color: "inherit", minHeight: 72,
      };
      const button = (label, onClick, primary) => h("button", {
        key: label, type: "button", disabled: busy, onClick,
        style: {
          cursor: busy ? "wait" : "pointer", borderRadius: 999, padding: "3px 12px", fontSize: 11.5, fontWeight: 600,
          border: primary ? "none" : "1px solid rgba(128,128,128,.35)",
          background: primary ? "linear-gradient(105deg,var(--dmr-from),var(--dmr-to))" : "transparent",
          color: primary ? "#1b1b1d" : "inherit",
        },
      }, label);

      if (mode === "edit") {
        const b = budgetAfter(data, draft, entry);
        return h("div", { className: "dmr-card", style: { background: surface, border: "1px solid rgba(158,148,213,.45)" } }, [
          h("textarea", {
            key: "t", className: "dmr-input", value: draft, autoFocus: true, style: field,
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: async (e) => {
              if (e.key === "Escape") { e.stopPropagation(); setMode("view"); setDraft(entry); }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !b.over) {
                if (await run(() => onSave(entry, draft))) setMode("view");
              }
            },
          }),
          h("div", { key: "b", style: { display: "flex", alignItems: "center", gap: 6, marginTop: 6 } }, [
            BudgetLine(b),
            h("span", { key: "s", style: { flex: 1 } }),
            button("Cancel", () => { setMode("view"); setDraft(entry); }),
            button("Save", async () => { if (!b.over && (await run(() => onSave(entry, draft)))) setMode("view"); }, true),
          ]),
          error ? h("div", { key: "e", style: { color: "#ef4444", fontSize: 11.5, marginTop: 4 } }, error) : null,
        ]);
      }

      return h("div", { className: "dmr-card", style: { background: surface, border: "1px solid transparent" } }, [
        h("div", { key: "row", style: { display: "flex", gap: 6, alignItems: "flex-start" } }, [
          h("div", {
            key: "x", className: long && !expanded ? "dmr-clamp" : undefined,
            style: { flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12.5, lineHeight: "18px" },
          }, entry),
          mode === "view"
            ? h("div", { key: "a", className: "dmr-actions", style: { display: "flex", gap: 2, flex: "none", marginTop: -3 } }, [
                h("button", { key: "e", type: "button", className: "dmr-icon-btn", title: "Edit", "aria-label": "Edit entry", onClick: () => { setDraft(entry); setMode("edit"); } }, PencilIcon()),
                h("button", { key: "d", type: "button", className: "dmr-icon-btn", title: "Delete", "aria-label": "Delete entry", onClick: () => setMode("confirm") }, TrashIcon()),
              ])
            : null,
        ]),
        h("div", { key: "meta", style: { display: "flex", alignItems: "center", gap: 10, marginTop: 5, fontSize: 11, color: FAINT } }, [
          h("span", { key: "n", style: { fontVariantNumeric: "tabular-nums" } }, fmt(entry.length) + " chars"),
          long ? h("button", { key: "m", type: "button", className: "dmr-link", onClick: () => setExpanded(!expanded), style: { fontSize: 11, color: "var(--dmr-purple)" } }, expanded ? "Show less" : "Show more") : null,
          mode === "confirm"
            ? h("span", { key: "c", style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, color: "inherit" } }, [
                h("span", { key: "q", style: { fontSize: 11.5 } }, "Delete this entry?"),
                button("Keep", () => setMode("view")),
                h("button", {
                  key: "y", type: "button", disabled: busy, onClick: () => run(() => onDelete(entry)),
                  style: { cursor: "pointer", borderRadius: 999, padding: "3px 12px", fontSize: 11.5, fontWeight: 600, border: "none", background: "#ef4444", color: "#fff" },
                }, "Delete"),
              ])
            : null,
        ]),
        error ? h("div", { key: "e", style: { color: "#ef4444", fontSize: 11.5, marginTop: 4 } }, error) : null,
      ]);
    }

    function MemoryTab(props) {
      const { target, data, dark, onEdit } = props;
      const [filter, setFilter] = React.useState("");
      const [adding, setAdding] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const entries = data?.entries ?? [];
      const shown = filter.trim() ? entries.filter((e) => e.toLowerCase().includes(filter.trim().toLowerCase())) : entries;
      const usage = data?.usage ?? { chars: 0, limit: 0, percent: 0 };
      const add = async () => {
        if (!adding.trim() || busy) return;
        setBusy(true);
        setError(null);
        try {
          await onEdit({ target, action: "add", content: adding });
          setAdding("");
        } catch (e) {
          setError(String(e?.message || e));
        } finally {
          setBusy(false);
        }
      };
      const b = budgetAfter(data, adding);
      const noun = target === "user" ? "profile entry" : "note";

      return h("div", { style: { display: "flex", flexDirection: "column", minHeight: 0, flex: 1 } }, [
        h("div", { key: "usage", style: { padding: "2px 16px 10px" } }, [
          h("div", { key: "bar", style: { height: 6, borderRadius: 999, background: "rgba(128,128,128,.2)", overflow: "hidden" } },
            h("div", { className: "dmr-bar-fill", style: { width: Math.min(100, usage.percent) + "%", ...(usage.percent >= 90 ? { background: "#f59e0b" } : {}) } })),
          h("div", { key: "t", style: { display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 11, color: FAINT, fontVariantNumeric: "tabular-nums" } }, [
            h("span", { key: "a" }, TARGET_HINT[target]),
            h("span", { key: "b", style: { flex: "none", marginLeft: 8 } }, fmt(usage.chars) + " / " + fmt(usage.limit)),
          ]),
        ]),
        entries.length > 3
          ? h("div", { key: "search", style: { padding: "0 16px 8px" } },
              h("input", {
                className: "dmr-input", value: filter, placeholder: "Search " + entries.length + " entries…",
                onChange: (e) => setFilter(e.target.value),
                style: { width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(128,128,128,.3)", background: dark ? "rgba(0,0,0,.2)" : "#fff", color: "inherit" },
              }))
          : null,
        h("div", { key: "list", style: { overflowY: "auto", padding: "0 10px 0 16px", display: "flex", flexDirection: "column", gap: 6, minHeight: 60, flex: 1 } },
          entries.length === 0
            ? [h("div", { key: "empty", style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "26px 10px", color: FAINT, textAlign: "center" } }, [
                h("span", { key: "i", className: "dmr-glyph-glow", style: { opacity: 0.7, display: "inline-flex" } }, SolidBrainIcon(30)),
                h("div", { key: "t", style: { fontSize: 12.5, fontWeight: 600, color: MUTED } }, "Nothing here yet"),
                h("div", { key: "s", style: { fontSize: 11.5, lineHeight: "16px", maxWidth: 260 } },
                  target === "user"
                    ? "Tell the model about yourself and it saves it here — or add something below."
                    : "The model saves what it learns as you work — or add a note below."),
              ])]
            : shown.length === 0
              ? [h("div", { key: "none", style: { color: FAINT, fontSize: 12, padding: "12px 4px" } }, "No entry matches “" + filter + "”.")]
              : shown.map((entry) => h(EntryCard, {
                  key: entry, entry, data, dark,
                  onSave: (from, to) => onEdit({ target, action: "replace", old_text: from, content: to }),
                  onDelete: (text) => onEdit({ target, action: "remove", old_text: text }),
                }))),
        h("div", { key: "add", style: { padding: "10px 16px 4px", borderTop: "1px solid rgba(128,128,128,.18)", marginTop: 8 } }, [
          h("div", { key: "row", style: { display: "flex", gap: 8, alignItems: "flex-end" } }, [
            h("textarea", {
              key: "t", className: "dmr-input", value: adding, rows: adding.includes("\n") || adding.length > 60 ? 3 : 1,
              placeholder: "Add a " + noun + "…",
              onChange: (e) => setAdding(e.target.value),
              onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!b.over) add(); } },
              style: { flex: 1, boxSizing: "border-box", resize: "none", fontFamily: "inherit", fontSize: 12.5, lineHeight: "18px", padding: "7px 10px", borderRadius: 10, border: "1px solid rgba(128,128,128,.35)", background: dark ? "rgba(0,0,0,.25)" : "#fff", color: "inherit" },
            }),
            h("button", {
              key: "b", type: "button", disabled: busy || !adding.trim() || b.over, onClick: add,
              style: {
                flex: "none", cursor: busy || !adding.trim() || b.over ? "default" : "pointer", borderRadius: 10, padding: "7px 14px", fontSize: 12, fontWeight: 700, border: "none",
                background: adding.trim() && !b.over ? "linear-gradient(105deg,var(--dmr-from),var(--dmr-to))" : "rgba(128,128,128,.2)",
                color: adding.trim() && !b.over ? "#1b1b1d" : "inherit", opacity: busy ? 0.6 : 1,
              },
            }, "Add"),
          ]),
          h("div", { key: "hint", style: { marginTop: 4, minHeight: 15 } },
            adding.trim() ? BudgetLine(b) : h("span", { style: { fontSize: 11, color: FAINT } }, fmt(Math.max(0, usage.limit - usage.chars)) + " characters free · Enter to add, Shift+Enter for a new line")),
          error ? h("div", { key: "e", style: { color: "#ef4444", fontSize: 11.5 } }, error) : null,
        ]),
      ]);
    }

    function MemoryPanel(props) {
      const wide = props?.wide !== false;
      const [open, setOpen] = React.useState(false);
      const [state, setState] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [tab, setTab] = React.useState(null);
      const [showSettings, setShowSettings] = React.useState(false);
      const ui = useUi();
      const rootRef = React.useRef(null);
      React.useEffect(() => { injectStyles(); injectPanelStyles(); }, []);

      const load = React.useCallback(async () => {
        try {
          setState(await api("/state"));
          setError(null);
        } catch (e) {
          setError(String(e?.message || e));
        }
      }, []);

      // Fresh when opened, and every few seconds while open — the model may
      // be saving in another chat at the same time.
      React.useEffect(() => {
        if (!open) return undefined;
        load();
        const t = setInterval(load, 5000);
        return () => clearInterval(t);
      }, [open, load]);
      // Once at start, for the count on the button.
      React.useEffect(() => { load(); }, [load]);
      // The composer chip's "Open Memory panel".
      React.useEffect(() => {
        if (typeof window === "undefined" || !window.addEventListener) return undefined;
        const onOpen = () => setOpen(true);
        window.addEventListener(OPEN_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_EVENT, onOpen);
      }, []);

      // Escape and a click outside close it.
      React.useEffect(() => {
        if (!open || typeof document === "undefined") return undefined;
        const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onDown);
        return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
      }, [open]);

      const edit = async (body) => {
        const out = await api("/entry", { method: "POST", body: JSON.stringify(body) });
        if (out?.state) setState(out.state);
      };

      const applyBudgets = async (body) => {
        const out = await api("/settings", { method: "POST", body: JSON.stringify(body) });
        if (out?.state) setState(out.state);
      };

      const dark = isDark();
      const counts = state ? { memory: state.memory.entries.length, user: state.user.entries.length } : { memory: 0, user: 0 };
      const total = counts.memory + counts.user;
      const current = tab ?? (counts.memory === 0 && counts.user > 0 ? "user" : "memory");

      const tabButton = (target, label) => h("button", {
        key: target, type: "button", role: "tab", className: "dmr-tab", "aria-selected": current === target,
        onClick: () => setTab(target),
      }, [
        Ring(state?.[target]?.usage?.percent ?? 0),
        h("span", { key: "l" }, label),
        h("span", { key: "n", style: { fontSize: 11, opacity: 0.6, fontVariantNumeric: "tabular-nums" } }, String(counts[target])),
      ]);

      const panel = open
        ? h("div", {
            key: "panel", "data-plugin": "dsh-memory-recall-panel", className: "dmr-pop dmr-panel", role: "dialog", "aria-label": "Memory",
            style: {
              position: "fixed", bottom: 60, left: wide ? 12 : 64, zIndex: 50, width: 440, maxWidth: "calc(100vw - 24px)", height: "min(640px, 78vh)",
              display: "flex", flexDirection: "column", boxSizing: "border-box", fontSize: 12, borderRadius: 16, overflow: "hidden",
              border: "1px solid " + (dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.10)"),
              background: dark ? "#19191b" : "#fff", color: dark ? "#ececec" : "#111",
              boxShadow: "0 18px 48px rgba(0,0,0,.35), 0 0 0 1px rgba(158,148,213,.08)",
            },
          }, [
            h("div", { key: "head", style: { display: "flex", alignItems: "center", gap: 10, padding: "14px 14px 10px 16px" } }, [
              h("span", { key: "i", className: "dmr-glyph-glow", style: { display: "inline-flex" } }, SolidBrainIcon(22)),
              h("div", { key: "t", style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 } }, [
                h("span", { key: "a", className: "dmr-gradient-text", style: { fontWeight: 700, fontSize: 16, lineHeight: "20px" } }, "Memory"),
                h("span", { key: "b", style: { fontSize: 11, color: FAINT } }, "Given to every chat \u00b7 a change reaches open chats on their next step"),
              ]),
              h("button", {
                key: "s", type: "button", className: "dmr-icon-btn", onClick: () => setShowSettings(!showSettings),
                "aria-label": "Display settings", "aria-expanded": showSettings,
                style: { marginLeft: "auto", opacity: showSettings ? 1 : undefined, background: showSettings ? "rgba(128,128,128,.18)" : undefined },
              }, GearIcon(15)),
              h("button", { key: "x", type: "button", className: "dmr-icon-btn", onClick: () => setOpen(false), "aria-label": "Close", style: { fontSize: 14 } }, "✕"),
            ]),
            showSettings
              ? h("div", {
                  key: "settings", "data-plugin": "dsh-memory-recall-settings", className: "dmr-pop",
                  style: {
                    margin: "0 12px 10px", padding: "8px 10px", borderRadius: 12, display: "flex", flexDirection: "column", gap: 2,
                    background: dark ? "rgba(255,255,255,.035)" : "rgba(0,0,0,.03)", border: "1px solid " + (dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.07)"),
                  },
                }, [
                  h("div", { key: "t", style: { fontSize: 10.5, fontWeight: 700, letterSpacing: ".4px", color: FAINT, margin: "0 0 4px" } }, "SHOW IN DSH"),
                  ...UI_SWITCHES.map((sw) => h("div", { key: sw.key, style: { display: "flex", alignItems: "center", gap: 10, padding: "5px 0" } }, [
                    h("div", { key: "t", style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 } }, [
                      h("span", { key: "l", style: { fontWeight: 600 } }, sw.label),
                      h("span", { key: "n", style: { fontSize: 11, color: FAINT, lineHeight: "15px" } }, sw.note),
                    ]),
                    Switch(sw.key, ui[sw.key] !== false, (on) => writeUi({ [sw.key]: on }), sw.label),
                  ])),
                  h("div", { key: "f", style: { fontSize: 10.5, color: FAINT, marginTop: 4 } }, "Saved in this browser. Memory itself keeps working either way."),
                  state?.budgets
                    ? [
                        h("div", { key: "bt", style: { fontSize: 10.5, fontWeight: 700, letterSpacing: ".4px", color: FAINT, margin: "8px 0 4px" } }, "BUDGETS"),
                        h(BudgetRow, { key: "bm", target: "memory", budgets: state.budgets, onCommit: applyBudgets }),
                        h(BudgetRow, { key: "bu", target: "user", budgets: state.budgets, onCommit: applyBudgets }),
                        state.budgets.overridden
                          ? h("button", {
                              key: "br", type: "button", onClick: () => applyBudgets({ reset: true }),
                              style: { alignSelf: "flex-start", fontSize: 11, color: FAINT, background: "none", border: "none", padding: "2px 0", cursor: "pointer", textDecoration: "underline" },
                            }, "Reset to the config file\u2019s limits")
                          : null,
                        h("div", { key: "bf", style: { fontSize: 10.5, color: FAINT, marginTop: 4 } }, "Saved with the memory files. Applies from the chat\u2019s next delivery."),
                      ]
                    : null,
                ])
              : null,
            h("div", { key: "tabs", role: "tablist", style: { display: "flex", gap: 4, padding: "0 12px 10px" } }, [
              tabButton("memory", "Notes"),
              tabButton("user", "Profile"),
            ]),
            error ? h("div", { key: "err", style: { color: "#ef4444", margin: "0 16px 8px" } }, "Could not load memory: " + error) : null,
            state && state.tools && !state.tools.ok
              ? h("div", {
                  key: "tools",
                  style: { color: "#ef4444", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.35)", borderRadius: 8, padding: "6px 8px", margin: "0 16px 10px", lineHeight: "16px" },
                }, "The model's memory tools did not load, so it can read this memory but cannot save to it or search earlier chats. "
                  + "Reason: " + (state.tools.error || "unknown") + ". Restart dsh after fixing; entries added here still work.")
              : null,
            state
              ? h(MemoryTab, { key: current, target: current, data: state[current], dark, onEdit: edit })
              : h("div", { key: "loading", style: { padding: 20, color: FAINT } }, "Loading…"),
            state
              ? h("div", { key: "dir", style: { padding: "4px 16px 10px", color: FAINT, fontSize: 10, wordBreak: "break-all" } }, "Stored in " + state.dir)
              : null,
          ])
        : null;

      const button = wide
        ? h("button", {
            key: "btn", type: "button", className: "dmr-row", onClick: () => setOpen(!open),
            title: "Memory", "aria-label": "Memory", "aria-expanded": open,
            style: {
              // Settings' own row, measured: 42px tall, 2px past the row each side.
              width: "calc(100% + 4px)", margin: "0 -2px", minWidth: 0, height: 42, boxSizing: "border-box",
              color: "var(--dsw-alias-label-primary, inherit)", cursor: "pointer",
              background: open ? "var(--dsw-alias-interactive-bg-hover-solid, rgba(128,128,128,.12))" : "0 0",
              border: "none", borderRadius: 12, alignItems: "center", gap: 8, padding: "0 10px 0 8px",
              fontFamily: "inherit", fontSize: 14, display: "inline-flex", overflow: "hidden",
            },
          }, [
            h("span", { key: "i", className: total ? "dmr-glyph-glow" : undefined, style: { display: "inline-flex", alignItems: "center", flex: "none" } }, SolidBrainIcon(16)),
            h("span", { key: "l", style: { textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, overflow: "hidden" } }, "Memory"),
            total ? h("span", {
              key: "n",
              style: {
                marginLeft: "auto", minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, boxSizing: "border-box",
                display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700,
                background: "linear-gradient(105deg,#e2b56d,#a58fd9)", color: "#1b1b1d", fontVariantNumeric: "tabular-nums",
              },
            }, String(total)) : null,
          ])
        : h("button", {
            key: "btn", type: "button", className: "dmr-icon-btn", onClick: () => setOpen(!open),
            title: total ? "Memory (" + total + ")" : "Memory", "aria-label": "Memory", "aria-expanded": open,
            style: { width: 36, height: 36, borderRadius: 10, opacity: 1, color: "var(--dsw-alias-label-primary, inherit)" },
          }, h("span", { className: total ? "dmr-glyph-glow" : undefined, style: { display: "inline-flex" } }, SolidBrainIcon(16)));

      return h("div", {
        ref: rootRef, "data-plugin": "dsh-memory-recall-sidebar", className: "dmr-panel",
        style: wide
          ? { flex: "0 0 100%", minWidth: 0, alignItems: "center", height: 50, margin: 0, display: "flex", position: "relative" }
          : { display: "flex", justifyContent: "center", alignItems: "center", position: "relative", width: "100%", height: 50 },
      }, [button, panel]);
    }

    /* ---- the memory context row -------------------------------------------------- */
    //
    // Memory reaches the model as a context message (src/inject.js), which dsh
    // logs and draws with its generic "Context injection" row. This draws that
    // one row the way the plugin's other cards look — the brain, the gradient
    // title, the counts, and the entries laid out when opened.
    //
    // `conversation.chat.node` is a KEYED slot and dsh's renderer owns key
    // "context" for EVERY context row (system prompt, skill catalog, …). So this
    // registers the same key at priority -10 (lower renders; the same priority
    // would make the slot host fail dsh's own entry) and, for every row that is
    // not ours, renders dsh's own component — found in the slot's entries — with
    // the very props it would have had. Same locale namespace ("chat"), so its
    // `t` is dsh's own. If dsh's component cannot be found, a plain row stands in.

    const NODE_PRIORITY = -10;
    const RULE_LINE = /^[\u2550=]{6,}\s*$/;

    /** The entries a memory context message carries, by store (pure, for tests). */
    function parseMemoryText(text) {
      const out = { user: [], memory: [] };
      let current = null;
      let buffer = [];
      const flush = () => {
        if (current && buffer.length) {
          out[current].push(...buffer.join("\n").split(/\n\u00a7\n/).map((e) => e.trim()).filter(Boolean));
        }
        buffer = [];
      };
      for (const line of String(text || "").split("\n")) {
        if (/^USER PROFILE \(/.test(line)) { flush(); current = "user"; continue; }
        if (/^MEMORY \(/.test(line)) { flush(); current = "memory"; continue; }
        if (RULE_LINE.test(line)) { if (buffer.length) flush(); continue; }
        if (/^<\/?system-reminder>$/.test(line)) { flush(); current = null; continue; }
        if (current) buffer.push(line);
      }
      flush();
      return out;
    }

    const isMemorySource = (source) => !!source && (source.kind === "plugin:memory" || (source.kind === "plugin" && source.plugin === "memory"));

    function MemoryInjectionRow({ data }) {
      const [open, setOpen] = React.useState(false);
      React.useEffect(() => { injectStyles(); }, []);
      const source = data?.source || {};
      const text = (Array.isArray(data?.content) ? data.content : []).map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n");
      const entries = parseMemoryText(text);
      const title = source.reason === "compaction" ? "Memory reloaded" : source.reason === "update" ? "Memory updated" : "Memory loaded";
      const counts = entries.user.length + " profile · " + entries.memory.length + (entries.memory.length === 1 ? " note" : " notes");
      const meta = (source.reason === "compaction" ? "after compaction · " : "") + counts;
      const section = (key, label, list) => list.length
        ? [
            h("div", { key: key + "h", style: { color: FAINT, fontSize: 10.5, fontWeight: 700, letterSpacing: ".4px", marginTop: key === "u" ? 0 : 6 } }, label),
            ...list.map((e, i) => h("div", { key: key + i, style: { whiteSpace: "pre-wrap", wordBreak: "break-word", paddingLeft: 10 } }, (i + 1) + ". " + e)),
          ]
        : [];
      return h("div", { "data-plugin": "dsh-memory-recall-context", className: "dmr-chip", style: { margin: "2px 0", fontSize: 13 } }, [
        h("button", {
          key: "head", type: "button", className: "dmr-link", onClick: () => setOpen(!open), "aria-expanded": open,
          style: { display: "inline-flex", alignItems: "center", gap: 7, color: MUTED, padding: "2px 0" },
        }, [
          h("span", { key: "i", className: "dmr-legendary-glyph", style: { display: "inline-flex" } }, SolidBrainIcon(14)),
          h("span", { key: "l", className: "dmr-legendary-title" }, title),
          h("span", { key: "t", className: "dmr-legendary-meta", style: { fontSize: 12 } }, "· " + meta),
          Chevron(open),
        ]),
        open
          ? h("div", { key: "body", className: "dmr-pop", style: { margin: "4px 0 6px 22px", display: "flex", flexDirection: "column", gap: 4, fontSize: 12 } },
              entries.user.length + entries.memory.length
                ? [...section("u", "USER PROFILE", entries.user), ...section("m", "NOTES", entries.memory)]
                : [h("div", { key: "none", style: { color: FAINT } }, "Nothing is saved yet.")])
          : null,
      ]);
    }

    /** Stand-in for dsh's own context row, used only if it cannot be found. */
    function PlainContextRow(props) {
      const [open, setOpen] = React.useState(false);
      const data = props?.node?.data || {};
      const label = data.provenance?.label || data.source?.kind || "context";
      const text = (Array.isArray(data.content) ? data.content : []).map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n");
      return h("div", { style: { margin: "2px 0", fontSize: 13 } }, [
        h("button", { key: "h", type: "button", className: "dmr-link", onClick: () => setOpen(!open), "aria-expanded": open, style: { color: MUTED } },
          "Context injection · " + label),
        open ? h("pre", { key: "b", style: { whiteSpace: "pre-wrap", fontSize: 11.5, color: MUTED, margin: "4px 0 0 12px", maxHeight: 240, overflow: "auto" } }, text) : null,
      ]);
    }

    function makeContextNode(ctx) {
      let shipped = null;
      const findShipped = () => {
        if (shipped) return shipped;
        try {
          const list = typeof ctx.slots?.entries === "function" ? ctx.slots.entries("conversation.chat.node") : [];
          shipped = (list || []).find((e) => e && e.key === "context" && e.component && e.component !== ContextNode && e.priority !== NODE_PRIORITY) || null;
        } catch { shipped = null; }
        return shipped;
      };
      function ContextNode(props) {
        const data = props?.node?.data;
        if (isMemorySource(data?.source)) return h(MemoryInjectionRow, { data });
        const own = findShipped();
        return own ? h(own.component, props) : h(PlainContextRow, props);
      }
      return ContextNode;
    }

    /* ---- the composer chip: is memory in this chat? --------------------------- */
    //
    // Memory reaches a chat through its system prompt, once, when the chat's
    // agent starts (a new chat, or one reopened after dsh restarts) — so there
    // is no "read" to watch for. What can be shown is the fact itself: this
    // chat's prompt holds memory, since when, how much, and whether memory
    // has changed since (a new chat picks that up). The host records each
    // briefing; the chip asks for this chat's.

    const OPEN_EVENT = "dsh-memory-recall:open";
    const at12 = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

    /** What the chip says for one briefing record (pure, for tests). */
    function briefingView(b) {
      if (!b || !b.briefed) {
        return {
          state: "none", label: "Memory",
          title: "Not in this chat yet",
          lines: [
            "Memory is given to a chat as a context message before its first answer, and again after compaction or a change.",
            b && b.now && (b.now.user + b.now.memory) > 0
              ? "It holds " + plural(b.now.user, "profile entry", "profile entries") + " and " + plural(b.now.memory, "note", "notes") + " — send a message and this chat gets them."
              : "Nothing is saved yet.",
          ],
        };
      }
      const count = b.user + b.memory;
      const lines = [
        ({ compaction: "Given again after the chat was compacted", update: "Given again after memory changed", resume: "Loaded when this chat was reopened" }[b.source]
          || "Given to this chat at its start") + " · " + at12(b.at),
        plural(b.user, "profile entry", "profile entries") + " · " + plural(b.memory, "note", "notes"),
        "It shows in the chat as \u201cContext injection · memory\u201d, and is given again after compaction or a change.",
      ];
      if (b.changed) {
        lines.push("Memory has changed since (now " + plural(b.now.user, "profile entry", "profile entries") + " · " + plural(b.now.memory, "note", "notes") + "). A new chat uses the new version.");
      }
      return { state: b.changed ? "changed" : "loaded", label: "Memory", count, title: count ? "Memory is in this chat" : "Memory is in this chat (empty)", lines };
    }

    function MemoryChip(props) {
      const sessionId = props?.sessionId || null;
      const [b, setB] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const [bloom, setBloom] = React.useState(false);
      const lastAt = React.useRef(null);
      const rootRef = React.useRef(null);
      React.useEffect(() => { injectStyles(); }, []);

      React.useEffect(() => {
        let alive = true;
        const pull = async () => {
          try {
            const next = await api("/briefing?session=" + encodeURIComponent(sessionId || ""));
            if (!alive) return;
            // A briefing this tab has not seen yet: one bloom, as memory lands.
            if (next && next.briefed && next.at !== lastAt.current) {
              if (lastAt.current !== null || Date.now() - next.at < 60_000) setBloom(true);
              lastAt.current = next.at;
            }
            setB(next);
          } catch { /* keep the last answer */ }
        };
        lastAt.current = null;
        pull();
        const t = setInterval(pull, 8000);
        const onFocus = () => pull();
        if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("focus", onFocus);
        return () => {
          alive = false;
          clearInterval(t);
          if (typeof window !== "undefined" && window.removeEventListener) window.removeEventListener("focus", onFocus);
        };
      }, [sessionId]);

      React.useEffect(() => {
        if (!bloom) return undefined;
        const t = setTimeout(() => setBloom(false), 1200);
        return () => clearTimeout(t);
      }, [bloom]);

      React.useEffect(() => {
        if (!open || typeof document === "undefined" || !document.addEventListener) return undefined;
        const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener("keydown", onKey);
        document.addEventListener("pointerdown", onDown, true);
        return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown, true); };
      }, [open]);

      const ui = useUi();
      const view = briefingView(b);
      const on = view.state !== "none";
      const dark = isDark();
      if (ui.composerButton === false) return null;

      const pill = h("button", {
        key: "pill", type: "button", className: "dmr-chip dmr-composer-chip", "aria-label": view.title, "aria-expanded": open,
        "data-memory-state": view.state,
        onClick: () => setOpen(!open),
        style: {
          display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, borderRadius: 999, cursor: "pointer", boxSizing: "border-box",
          fontFamily: "inherit", fontSize: 12, lineHeight: 1, color: "inherit", position: "relative",
          border: on ? "1px solid color-mix(in srgb,#9e94d5 45%,transparent)" : "1px dashed rgba(128,128,128,.45)",
          background: on ? "color-mix(in srgb,#9e94d5 10%,transparent)" : "transparent",
          opacity: on ? 1 : 0.7,
        },
      }, [
        h("span", {
          key: "i",
          className: on ? "dmr-legendary-glyph" + (bloom ? " dmr-land" : "") : undefined,
          style: { display: "inline-flex", color: on ? undefined : FAINT },
        }, SolidBrainIcon(15)),
        view.state === "changed"
          ? h("span", { key: "d", "aria-hidden": "true", style: { position: "absolute", top: -1, right: -1, width: 7, height: 7, borderRadius: 999, background: "#f59e0b", boxShadow: "0 0 0 2px " + (dark ? "#1b1b1d" : "#fff") } })
          : null,
      ]);

      const card = open
        ? h("div", {
            key: "card", role: "dialog", "aria-label": view.title, className: "dmr-pop dmr-chip", "data-plugin": "dsh-memory-recall-briefing",
            style: {
              position: "absolute", bottom: "calc(100% + 8px)", right: 0, zIndex: 40, width: 290, boxSizing: "border-box",
              padding: "11px 12px", borderRadius: 12, fontSize: 12, lineHeight: "17px", textAlign: "left",
              background: dark ? "#1c1c1e" : "#fff", color: dark ? "#eee" : "#111",
              border: "1px solid " + (dark ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.10)"), boxShadow: "0 10px 28px rgba(0,0,0,.28)",
            },
          }, [
            h("div", { key: "t", style: { display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 13, marginBottom: 6 } }, [
              h("span", { key: "i", className: on ? "dmr-legendary-glyph" : undefined, style: { display: "inline-flex", color: on ? undefined : FAINT } }, SolidBrainIcon(15)),
              h("span", { key: "l", className: on ? "dmr-legendary-title" : undefined }, view.title),
            ]),
            ...view.lines.map((line, i) => h("div", {
              key: "l" + i,
              style: /changed since/.test(line)
                ? { marginTop: 6, padding: "6px 8px", borderRadius: 8, background: "rgba(245,158,11,.12)", color: dark ? "#fcd34d" : "#b45309" }
                : { marginTop: i ? 3 : 0, color: i >= 2 ? MUTED : "inherit" },
            }, line)),
            h("button", {
              key: "open", type: "button",
              onClick: () => { setOpen(false); if (typeof window !== "undefined" && window.dispatchEvent) window.dispatchEvent(new Event(OPEN_EVENT)); },
              style: {
                marginTop: 9, cursor: "pointer", borderRadius: 999, padding: "3px 11px", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit",
                border: "1px solid rgba(128,128,128,.4)", background: "transparent", color: "inherit",
              },
            }, "Open Memory panel"),
          ])
        : null;

      return h("span", { ref: rootRef, "data-plugin": "dsh-memory-recall-chip-seat", style: { position: "relative", display: "inline-flex", alignItems: "center" } }, [pill, card]);
    }

    /* ---- @ chats, grouped by workspace --------------------------------------- */
    //
    // dsh's own @ list shows at most 50 sessions and includes sub-agent
    // sessions (untitled, shown as raw ids), so real chats fall off it. This
    // source lists every one of the user's own chats, under the workspace
    // titles the sidebar uses, and every chat with a readable name. Its rows
    // replace dsh's session rows in the menu; dsh's file rows stay.
    //
    // Picking a chat inserts dsh's own mention, so dsh attaches that chat
    // exactly as it does for its native rows. Picking a workspace inserts a
    // chip that reaches the model as [workspace "Name" — folder], which
    // session_search takes as its `workspace`.

    const SOURCE = "dsh-memory-recall";
    const DRILL = /^ws:([0-9a-zA-Z-]+)\/(.*)$/;
    const WS_REF = "dmr-workspace:";
    const RECENT_HERE = 6;
    const PER_GROUP = 8;

    /** base64url of the UTF-8 bytes, as Node's Buffer "base64url" writes it. */
    function base64url(text) {
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    /** dsh-session-reference's canonical mention: @[label](dsh-session:<base64url(JSON(id))>). */
    function sessionMention(sessionId, label) {
      const escaped = String(label).replace(/[\\\]]/g, (m) => "\\" + m);
      return "@[" + escaped + "](dsh-session:" + base64url(JSON.stringify(sessionId)) + ")";
    }

    function workspaceRef(ws) {
      return WS_REF + base64url(JSON.stringify({ title: ws.title, path: ws.path }));
    }

    function workspaceText(ref) {
      try {
        const b64 = ref.slice(WS_REF.length).replace(/-/g, "+").replace(/_/g, "/");
        const bytes = Uint8Array.from(atob(b64 + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
        const ws = JSON.parse(new TextDecoder().decode(bytes));
        return "[workspace \"" + ws.title + "\" — " + ws.path + "]";
      } catch {
        return ref;
      }
    }

    function ago(ms, now) {
      const s = Math.max(0, (now - ms) / 1000);
      if (s < 60) return "now";
      if (s < 3600) return Math.floor(s / 60) + "m";
      if (s < 86400) return Math.floor(s / 3600) + "h";
      if (s < 86400 * 30) return Math.floor(s / 86400) + "d";
      if (s < 86400 * 365) return Math.floor(s / (86400 * 30)) + "mo";
      return Math.floor(s / (86400 * 365)) + "y";
    }

    /** A folder with the home directory shortened, for a workspace row. */
    function shortPath(path) {
      return String(path || "").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~").replace(/^\/(?:home|Users)\/[^/]+/, "~");
    }

    function createChatSource(ctx) {
      const cache = new Map(); // chat id → {at, data}
      let last = null; // the latest data, for the synchronous breadcrumb

      async function load(sessionId, signal) {
        const hit = cache.get(sessionId);
        if (hit && Date.now() - hit.at < 10_000) return hit.data;
        const res = await fetch(BASE + "/chats?session=" + encodeURIComponent(sessionId || ""), { signal, headers: { accept: "application/json" } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        cache.set(sessionId, { at: Date.now(), data });
        last = data;
        return data;
      }

      function updatedAtOf(chat) {
        try {
          return ctx.get?.("sessions")?.list?.getSnapshot?.()?.byId?.[chat.sessionId]?.updatedAt ?? chat.createdAt;
        } catch {
          return chat.createdAt;
        }
      }

      const chatRow = (chat, section, now) => {
        const label = chat.title || "Untitled chat";
        return {
          name: label,
          description: ago(updatedAtOf(chat), now),
          icon: "session",
          section,
          value: JSON.stringify({ kind: "chat", id: chat.sessionId, label }),
        };
      };
      const workspaceRow = (ws, section) => ({
        name: ws.title,
        description: ws.chats.length + (ws.chats.length === 1 ? " chat" : " chats") + " · " + shortPath(ws.path),
        icon: "folder",
        section,
        drill: true,
        value: JSON.stringify({ kind: "workspace", id: ws.id, title: ws.title, path: ws.path }),
      });
      const matches = (text, q) => String(text || "").toLowerCase().includes(q);

      function listing(data, query, now) {
        const current = data.workspaces.find((w) => w.id === data.currentWorkspaceId) ?? null;
        const others = data.workspaces.filter((w) => w !== current);
        const drilled = DRILL.exec(query);
        if (drilled) {
          const ws = data.workspaces.find((w) => w.id.startsWith(drilled[1]));
          if (!ws) return [];
          const q = drilled[2].trim().toLowerCase();
          return ws.chats.filter((c) => !q || matches(c.title, q)).map((c) => chatRow(c, ws.title, now));
        }
        const q = query.trim().toLowerCase();
        if (!q) {
          const rows = [];
          if (current) {
            rows.push(workspaceRow(current, "This workspace"));
            rows.push(...current.chats.slice(0, RECENT_HERE).map((c) => chatRow(c, "This workspace", now)));
          }
          rows.push(...others.map((w) => workspaceRow(w, "Workspaces")));
          if (data.ungrouped.length) rows.push(...data.ungrouped.slice(0, PER_GROUP).map((c) => chatRow(c, "No workspace", now)));
          return rows;
        }
        const rows = data.workspaces.filter((w) => matches(w.title, q) || matches(w.path, q)).map((w) => workspaceRow(w, "Workspaces"));
        for (const ws of current ? [current, ...others] : others) {
          const hits = ws.chats.filter((c) => matches(c.title, q));
          rows.push(...hits.slice(0, PER_GROUP).map((c) => chatRow(c, ws.title, now)));
        }
        rows.push(...data.ungrouped.filter((c) => matches(c.title, q)).slice(0, PER_GROUP).map((c) => chatRow(c, "No workspace", now)));
        return rows;
      }

      return {
        trigger: "@",
        name: SOURCE,
        order: 10,
        showGroupTitle: false,
        warm(session) {
          load(session.sessionId).catch(() => {});
        },
        async candidates(session, req) {
          if (readUi().atMenu === false) return [];
          if (req.quoted === true) return []; // a quoted @"path" is a file
          let data;
          try {
            data = await load(session.sessionId, req.signal);
          } catch {
            return [];
          }
          if (req.signal?.aborted) return [];
          return listing(data, String(req.query || ""), Date.now());
        },
        header(_session, req) {
          const drilled = DRILL.exec(String(req.query || ""));
          if (!drilled || !last) return undefined;
          const ws = last.workspaces.find((w) => w.id.startsWith(drilled[1]));
          if (!ws) return undefined;
          return [
            { label: "All workspaces", value: JSON.stringify({ kind: "root" }) },
            { label: ws.title, value: JSON.stringify({ kind: "workspace", id: ws.id, title: ws.title, path: ws.path }), current: true },
          ];
        },
        onPick({ candidate, action }) {
          let v;
          try {
            v = JSON.parse(candidate.value);
          } catch {
            return undefined;
          }
          if (v.kind === "root") return { text: "@", continue: true };
          if (v.kind === "workspace" && action === "drill") return { text: "@ws:" + v.id.slice(0, 8) + "/", continue: true };
          if (v.kind === "workspace") {
            const ref = workspaceRef(v);
            return { insert: { source: SOURCE, ref, label: v.title, appearance: "folder", clipboardText: workspaceText(ref) } };
          }
          if (v.kind === "chat") {
            const mention = sessionMention(v.id, v.label);
            return { insert: { source: SOURCE, ref: mention, label: v.label, appearance: "session", clipboardText: mention } };
          }
          return undefined;
        },
        codec: {
          clipboardText: (ref) => (ref.startsWith(WS_REF) ? workspaceText(ref) : ref),
          serialize: (ref) => Promise.resolve(ref.startsWith(WS_REF) ? workspaceText(ref) : ref),
        },
      };
    }

    /**
     * Drop the session rows from dsh's own @ source, keeping its file rows —
     * this plugin's grouped chats replace them. The source registry offers no
     * way to disable one group, so the native source's `candidates` is wrapped,
     * and restored when this plugin unloads. If the native source is not
     * found (renamed, or not mounted), nothing is touched and both lists show.
     * @returns a disposer, or null when there was nothing to wrap yet.
     */
    function hideNativeChats(inputTriggers) {
      const sources = inputTriggers?.live?.sources;
      const native = Array.isArray(sources) ? sources.find((s) => s && s.trigger === "@" && s.name === "reference") : undefined;
      if (!native || typeof native.candidates !== "function") return null;
      if (native.__dmrOriginal) return () => {};
      const original = native.candidates;
      native.__dmrOriginal = original;
      native.candidates = async function (...args) {
        const rows = await original.apply(this, args);
        if (readUi().atMenu === false) return rows; // switched off: dsh's own chat rows stay
        return (rows || []).filter((row) => {
          try {
            return JSON.parse(row.value).kind !== "session";
          } catch {
            return true;
          }
        });
      };
      return () => {
        if (native.__dmrOriginal === original) {
          native.candidates = original;
          delete native.__dmrOriginal;
        }
      };
    }

    /* ---- mounting ----------------------------------------------------------- */

    const inject = ["slots"];

    function apply(ctx) {
      const openChat = (sessionId) => {
        try {
          const sessions = ctx.get?.("sessions");
          if (sessions && typeof sessions.open === "function" && sessionId) sessions.open(sessionId);
        } catch { /* an unknown chat: nothing to open */ }
      };

      // tool.call.toolview is a CHILD slot: it must go through slots.inject, or
      // registering before the parent's children table commits throws and takes
      // the whole plugin down. Keyed by tool name, each replaces dsh's own row.
      ctx.slots.inject("tool.call.toolview", () =>
        ctx.slots.register({ name: "tool.call.toolview", key: "memory" }, MemoryCall));
      const RecallCall = makeRecallCall(openChat);
      ctx.slots.inject("tool.call.toolview", () =>
        ctx.slots.register({ name: "tool.call.toolview", key: "session_search" }, RecallCall));

      // sidebar.footer.action is a LIST slot: id + order. Scheduled is 20;
      // Memory sits just above it. The slot passes {wide}: false when the
      // sidebar is collapsed to its icon rail.
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-memory-recall", order: 15 }, (slotProps) => h(MemoryPanel, slotProps || {})));

      // The memory context row, drawn like the other memory cards; every other
      // context row is handed to dsh's own renderer (see makeContextNode).
      const ContextNode = makeContextNode(ctx);
      ctx.slots.inject("conversation.chat.node", () =>
        ctx.slots.register({ name: "conversation.chat.node", key: "context", priority: NODE_PRIORITY, locale: "chat" }, ContextNode));

      // The composer chip: is memory in this chat's prompt? A list slot in the
      // composer's trailing row, just left of the model name (graft's chip is 20).
      ctx.slots.inject("conversation.input.right", () =>
        ctx.slots.register({ name: "conversation.input.right", id: "dsh-memory-recall", order: 30, inject: (sessionId) => ({ sessionId }) }, MemoryChip));

      // The @ source. Injected rather than required, so a composition without
      // the @ menu still loads the rest of the plugin.
      if (typeof ctx.inject === "function") {
        ctx.inject(["inputTriggers"], (scope) => {
          const triggers = scope.inputTriggers;
          const source = createChatSource(ctx);
          const warm = source.warm;
          let restore = hideNativeChats(triggers);
          // dsh's own source may register after this one: retry on first use.
          source.warm = (session) => {
            if (!restore) restore = hideNativeChats(triggers);
            warm(session);
          };
          scope.effect(() => triggers.registerSource(source), "dsh-memory-recall: @ chats by workspace");
          scope.effect(() => () => { if (restore) restore(); }, "dsh-memory-recall: restore dsh's @ chats");
        });
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.memoryStatus = memoryStatus;
    exports.changesOf = changesOf;
    exports.usageIn = usageIn;
    exports.recallStatus = recallStatus;
    exports.createChatSource = createChatSource;
    exports.sessionMention = sessionMention;
    exports.hideNativeChats = hideNativeChats;
    exports.workspaceText = workspaceText;
    exports.briefingView = briefingView;
    exports.parseMemoryText = parseMemoryText;
    exports.readUi = readUi;
    exports.writeUi = writeUi;
    exports.UI_SWITCHES = UI_SWITCHES;
    exports.makeContextNode = makeContextNode;
    return module.exports;
  },
});

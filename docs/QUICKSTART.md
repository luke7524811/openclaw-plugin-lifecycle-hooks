# Quickstart Guide — OpenClaw Lifecycle Hooks

> Get enforced pipeline gates running in your OpenClaw agent in under 10 minutes.

This guide walks you from zero to a working hook that blocks `rm` commands, verifies it
fires, and explains what to do next.

---

## Prerequisites

- **Node.js 18+**
- **An OpenClaw workspace** (default: `~/.openclaw/workspace/`)
- This plugin's source built, or installed via npm

---

## Step 1 — Install the Plugin

**From npm (when published):**

> **⚠️ Not yet published to npm.** The package is in local testing. Use the symlink install
> below until npm publish is confirmed. The npm command below will work once published.

```bash
npm install @fractal-ai/plugin-lifecycle-hooks
```

**From source (build only):**

```bash
cd /path/to/workspace/projects/openclaw-plugin-lifecycle-hooks
npm install
npm run build
```

Verify the build succeeded:

```bash
npm test
# Should print: Tests: 68 passed, 68 total
```

**Local / Development Install (Symlink) — Recommended for development:**

Symlink the project directory into OpenClaw's plugin directory so the gateway loads it
directly. No npm publish required.

```bash
ln -s /path/to/workspace/projects/openclaw-plugin-lifecycle-hooks \
      /path/to/openclaw/plugins/plugin-lifecycle-hooks
```

Ensure your gateway config has the plugin enabled (this is already set by default in our
workspace config):

```yaml
plugins:
  plugin-lifecycle-hooks:
    enabled: true
```

Then restart the gateway:

```bash
openclaw gateway restart
```

Any edits to the source directory are immediately live (after a build if needed). This is
how the plugin is currently deployed on our gateway.

---

## Step 2 — Create `HOOKS.yaml`

Place `HOOKS.yaml` in your workspace root. The engine searches for it here by default:

```
~/.openclaw/workspace/HOOKS.yaml
```

Start with the minimal config below. It does one thing: blocks any `exec` tool call
whose command starts with `rm`.

```yaml
version: "1"

hooks:
  - point: turn:tool:pre
    match:
      tool: exec
      commandPattern: "^rm\\s"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: "🚫 Use `trash` instead of `rm`."
```

**What each field means:**

| Field | Value | Meaning |
|-------|-------|---------|
| `version` | `"1"` | Config schema version (required) |
| `point` | `turn:tool:pre` | Fire before any tool call in the main agent |
| `match.tool` | `exec` | Only intercept calls to the `exec` tool |
| `match.commandPattern` | `"^rm\\s"` | Regex: command starts with `rm ` |
| `action` | `block` | Halt the pipeline with a message |
| `onFailure.action` | `block` | If the action itself fails, still block |
| `onFailure.notifyUser` | `true` | Surface the message to the user |
| `onFailure.message` | `"🚫 ..."` | The message shown when blocked |

To use the full example config as a starting point instead:

```bash
cp /path/to/workspace/projects/openclaw-plugin-lifecycle-hooks/hooks.example.yaml \
   ~/.openclaw/workspace/HOOKS.yaml
```

---

## Step 3 — Load the Engine

Import and initialize the engine at your agent's startup:

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();

// Load config once at startup
await engine.loadConfig('/path/to/workspace/HOOKS.yaml');

console.log(`Loaded ${engine.getConfig()?.hooks.length} hook(s).`);
// → Loaded 1 hook(s).
```

The engine validates the YAML on load. If there's a schema error you'll get a
`ConfigValidationError` with a descriptive message pointing to the offending field.

**Config resolution order** (if you don't pass a path):

When using the plugin object (not the raw engine), it auto-discovers `HOOKS.yaml`:

1. `OPENCLAW_HOOKS_CONFIG` environment variable (explicit override)
2. `<cwd>/HOOKS.yaml`
3. `<workspace>/HOOKS.yaml` (via `OPENCLAW_WORKSPACE` env var or `~/.openclaw/workspace`)

---

## Step 4 — Fire Hooks at Pipeline Boundaries

Call `engine.execute()` wherever the pipeline transitions. Pass in a `HookContext`
describing what's happening right now.

```typescript
import { LifecycleGateEngine, HookContext } from '@fractal-ai/plugin-lifecycle-hooks';

// Build a context for a tool call
const context: HookContext = {
  point: 'turn:tool:pre',
  sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
  topicId: 42,
  toolName: 'exec',
  toolArgs: { command: 'rm /important/file.txt' },
  timestamp: Date.now(),
};

const results = await engine.execute('turn:tool:pre', context);

// Check if any hook blocked the pipeline
if (results.some(r => !r.passed)) {
  const blocked = results.find(r => !r.passed)!;
  console.error('BLOCKED:', blocked.message);
  // ↑ Do NOT proceed with the tool call
} else {
  // All hooks passed — safe to proceed
  runTool(context.toolName!, context.toolArgs!);
}
```

**Shortcut:** Use the static builder instead of constructing `HookContext` manually:

```typescript
const context = LifecycleGateEngine.buildContext('turn:tool:pre', sessionKey, {
  toolName: 'exec',
  toolArgs: { command: 'rm /important/file.txt' },
  topicId: 42,
});
```

---

## Step 5 — Verify It Works

Run a quick smoke test. This script tests both a blocked command and a safe one:

```typescript
// smoke-test.ts
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();
await engine.loadConfig('/path/to/workspace/HOOKS.yaml');

const SESSION = 'agent:main:test:session';

// ── Should be BLOCKED ──────────────────────────────────────────────
const blocked = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: SESSION,
  toolName: 'exec',
  toolArgs: { command: 'rm /tmp/important.txt' },
  timestamp: Date.now(),
});

console.assert(!blocked[0].passed, 'rm should be blocked');
console.assert(blocked[0].message?.includes('trash'), 'Block message should mention trash');
console.log('✅ rm correctly blocked:', blocked[0].message);

// ── Should PASS (ls is harmless) ────────────────────────────────────
const passed = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: SESSION,
  toolName: 'exec',
  toolArgs: { command: 'ls /tmp' },
  timestamp: Date.now(),
});

console.assert(passed.every(r => r.passed), 'ls should pass');
console.log('✅ ls correctly allowed');

// ── Should PASS (wrong tool — not exec) ─────────────────────────────
const noMatch = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: SESSION,
  toolName: 'Read',
  toolArgs: { file_path: '/etc/passwd' },
  timestamp: Date.now(),
});

console.assert(noMatch.every(r => r.passed), 'Read should not trigger exec hook');
console.log('✅ Read tool correctly unaffected');
```

Run it:

```bash
npx ts-node smoke-test.ts
```

Expected output:

```
[lifecycle-hooks/engine] Loaded 1 hook(s) from ".../HOOKS.yaml"
[lifecycle-hooks] BLOCKED at turn:tool:pre (tool: exec)
✅ rm correctly blocked: 🚫 Use `trash` instead of `rm`.
✅ ls correctly allowed
✅ Read tool correctly unaffected
```

---

## Step 6 — Telegram Notifications on Block

When a hook blocks a tool call, the plugin can automatically send you a Telegram
notification so you know what happened — even when you're not actively watching
the terminal.

### How it works

Set `onFailure.notifyUser: true` on any hook. When that hook blocks a tool call
(returns `passed: false`), a fire-and-forget Telegram message is sent to the
session's Telegram chat (group, topic, or DM):

```yaml
hooks:
  - point: [turn:tool:pre, subagent:tool:pre]
    match:
      tool: exec
      commandPattern: "^rm\\s"
    action: block
    onFailure:
      action: block
      notifyUser: true                          # ← Enable notification
      message: "🚫 Use `trash` instead of `rm`."
```

### What triggers a notification

Two situations send a notification:

1. **Block action fires** — A hook's `action: block` returns `passed: false`.
   If `onFailure.notifyUser: true`, the block message is sent as a Telegram notification.

2. **onFailure action is `notify`** — When an action *fails* (throws an error) and
   `onFailure.action: notify`, the failure message is sent and the pipeline continues.

### How the target is resolved

The Telegram chat target is extracted from the session key automatically:

| Session key format | Target |
|-------------------|--------|
| `telegram:group:-100EXAMPLE456789:topic:42` | Group `-100EXAMPLE456789`, thread `42` |
| `telegram:group:-100EXAMPLE456789` | Group `-100EXAMPLE456789` (no thread) |
| `telegram:987654321` | DM with user `987654321` |

No configuration needed — the plugin reads the session key that's already in scope.

### Notes

- Notifications are **fire-and-forget** — a failure to send never affects the hook result.
- If `api.runtime` is not available (e.g. unit test context), notifications are silently skipped.
- The `notifyUser` flag is **separate** from `block` — you can block without notifying,
  or notify without blocking.

---

## Step 7 — Hot-Reload Config

You can reload `HOOKS.yaml` at runtime without restarting the engine:

```typescript
// Reload after editing HOOKS.yaml
await engine.reloadConfig();
console.log('Config reloaded.');
```

Call this from a file watcher or after your agent receives a "reload config" command.

---

## Step 8 — Add More Hooks

Now that you have one working hook, extend your config. Here's a complete starter
`HOOKS.yaml` with multiple hooks:

```yaml
version: "1"

defaults:
  model: anthropic/claude-haiku-4-5
  onFailure:
    action: continue
    notifyUser: false

hooks:
  # ── Safety ──────────────────────────────────────────────────────
  - point:
      - turn:tool:pre
      - subagent:tool:pre
    match:
      tool: exec
      commandPattern: "rm\\s+-[rRfFi]"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: "🚫 Blocked: Use `trash` instead of `rm`."

  # ── Observability ────────────────────────────────────────────────
  - point:
      - turn:pre
      - turn:post
    action: log
    target: "/path/to/workspace/memory/hooks-audit.jsonl"
    onFailure:
      action: continue

  # ── Sub-agent context injection ──────────────────────────────────
  - point: subagent:spawn:pre
    action: inject_context
    target: "/path/to/workspace/AGENTS.md"
    onFailure:
      action: continue
```

---

## What's Available

| Hook Point | Use Case |
|-----------|----------|
| `turn:pre` | Log/summarize incoming prompts |
| `turn:post` | Append turn summaries to topic memory files |
| `turn:tool:pre` | Block dangerous commands, validate tool calls |
| `turn:tool:post` | Log tool results, audit writes |
| `subagent:spawn:pre` | Inject context before sub-agents start |
| `subagent:pre` | Apply sub-agent-specific rules |
| `subagent:post` | Force-log sub-agent results |
| `subagent:tool:pre` | Same safety enforcement as main agent |
| `subagent:tool:post` | Log sub-agent tool results |
| `heartbeat:pre` / `heartbeat:post` | Dashboard push, monitoring |
| `cron:pre` / `cron:post` | Track job execution |

| Action | Blocks? | Use Case |
|--------|---------|----------|
| `block` | ✅ Yes | Safety gates, policy enforcement |
| `log` | ❌ No | JSONL audit trail |
| `summarize_and_log` | ❌ No | LLM-powered memory |
| `inject_context` | ❌ No | Sub-agent context loading |
| `exec_script` | ✅ Conditional | Custom shell/Python gate logic |
| custom module path | ✅ Conditional | Arbitrary TypeScript action |

---

## Next Steps

- **[CONFIGURATION.md](./CONFIGURATION.md)** — Full reference for every config field, hook point, action, and match filter
- **[WALKTHROUGHS.md](./WALKTHROUGHS.md)** — 5 practical use case walkthroughs with complete HOOKS.yaml configs
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — How the gate engine works internally (for contributors)
- **[examples/](../examples/)** — Ready-to-use HOOKS.yaml configs you can copy and customize

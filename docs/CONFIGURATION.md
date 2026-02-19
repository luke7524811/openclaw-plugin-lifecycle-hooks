# Configuration Reference — OpenClaw Lifecycle Hooks

> Complete reference for `HOOKS.yaml` — every field, hook point, action, match filter, and failure option.

---

## File Location

The engine searches for `HOOKS.yaml` in this order:

1. `OPENCLAW_HOOKS_CONFIG` environment variable (absolute path)
2. `<cwd>/HOOKS.yaml`
3. `<workspace>/HOOKS.yaml` (workspace = `OPENCLAW_WORKSPACE` env or `~/.openclaw/workspace`)

You can also pass the path explicitly when using the engine programmatically:

```typescript
await engine.loadConfig('/path/to/HOOKS.yaml');
```

---

## Top-Level Structure

```yaml
version: "1"           # Required. Must be the string "1".

defaults:              # Optional. Global defaults for all hooks.
  model: "..."         # Default LLM model (for summarize_and_log / inject_context).
  onFailure:           # Default failure behavior when no hook-level onFailure is set.
    action: continue   # block | retry | notify | continue

hooks:                 # Required. List of HookDefinition objects.
  - ...
```

### `version`

**Required.** Must be the string `"1"` (or number `1`). Currently the only supported version.

```yaml
version: "1"
```

### `defaults`

**Optional.** Applied to all hooks that don't override them.

```yaml
defaults:
  model: anthropic/claude-haiku-4-5   # Cheap model for inference hooks
  onFailure:
    action: continue                   # Soft-fail by default
    notifyUser: false
```

If no `defaults.onFailure` is set, hooks that throw an unexpected error will
use `action: continue` (soft-fail, log error, allow pipeline to proceed).

### `hooks`

**Required.** An array of `HookDefinition` objects. At least one entry is expected
(an empty array is valid but does nothing).

---

## Hook Definition

Each item in the `hooks` array is a `HookDefinition`:

```yaml
- point: turn:tool:pre        # Required. One HookPoint or array of HookPoints.
  match:                      # Optional. If omitted, hook fires for every event at this point.
    tool: exec
    commandPattern: "^rm\\s"
    topicId: 42
    isSubAgent: false
    sessionPattern: "telegram:"
    custom: ./matchers/my-matcher.js
  action: block               # Required. Built-in name or custom module path.
  model: anthropic/...        # Optional. Overrides defaults.model for this hook.
  target: "/path/to/file"     # Optional. Output file (log/summarize) or script path (exec_script).
  enabled: true               # Optional. Set false to disable without removing. Default: true.
  onFailure:                  # Optional. Overrides defaults.onFailure for this hook.
    action: block             # block | retry | notify | continue
    retries: 3                # How many retries (only used when action: retry)
    notifyUser: true          # Send user-facing notification on failure
    message: "Custom msg"     # Override default block/failure message
```

---

## Hook Points

Hook points are the gates in the agent pipeline. You configure which ones to intercept.

### Main Agent Points

| Point | When It Fires | Blocking? |
|-------|---------------|-----------|
| `turn:pre` | Before the agent processes a user prompt | ✅ Gate |
| `turn:post` | After the agent's response is finalized | ⚠️ Fire-and-forget* |
| `turn:tool:pre` | Before any tool call in the main agent | ✅ Gate |
| `turn:tool:post` | After any tool call in the main agent resolves | ⚠️ Fire-and-forget* |

### Sub-agent Points

| Point | When It Fires | Context |
|-------|---------------|---------|
| `subagent:spawn:pre` | Main agent side — before a sub-agent is spawned | Main agent session |
| `subagent:pre` | Sub-agent side — before it processes its first turn | Sub-agent session |
| `subagent:post` | Sub-agent side — after the sub-agent completes | Sub-agent session |
| `subagent:tool:pre` | Before any tool call inside a sub-agent | Sub-agent session |
| `subagent:tool:post` | After any tool call inside a sub-agent resolves | Sub-agent session |

> **`subagent:spawn:pre` vs `subagent:pre`:**
> - `subagent:spawn:pre` fires in the **main agent** session, before the spawn. Use it to modify
>   what context or task is sent to the sub-agent.
> - `subagent:pre` fires in the **sub-agent** session, as it begins. Use it to apply
>   sub-agent-specific constraints.

### Heartbeat and Cron Points

| Point | When It Fires |
|-------|---------------|
| `heartbeat:pre` | Before a heartbeat cycle executes |
| `heartbeat:post` | After a heartbeat cycle completes |
| `cron:pre` | Before a cron job fires |
| `cron:post` | After a cron job completes |

> *`turn:post`, `turn:tool:post` etc. are fire-and-forget in the current plugin-only
> implementation. Full blocking at post-points requires upstream pipeline changes (planned).

### Multi-Point Arrays

A single hook definition can register for multiple points at once:

```yaml
- point:
    - turn:tool:pre
    - subagent:tool:pre
  action: block
  match:
    tool: exec
    commandPattern: "^rm\\s"
```

---

## Match Filters

Match filters narrow when a hook fires. All fields are **optional** and use **AND logic** —
every field you specify must match for the hook to fire. If `match` is omitted entirely,
the hook fires for every event at the registered point.

### `tool`

**Type:** `string`  
**Match:** Exact tool name (case-sensitive).

```yaml
match:
  tool: exec         # Only fires when the exec tool is called
```

Common tool names: `exec`, `Read`, `Write`, `Edit`, `browser`, `web_search`, `web_fetch`,
`message`, `nodes`, `canvas`, `tts`.

### `commandPattern`

**Type:** `string` (JavaScript regex)  
**Match:** Regex tested against the "command subject" extracted from context.

```yaml
match:
  commandPattern: "^rm\\s"         # Matches: rm file.txt, rm -i foo
  commandPattern: "rm\\s+-[rRfF]"  # Matches: rm -rf, rm -fr, rm -f
  commandPattern: "^sudo\\s"       # Matches: sudo anything
```

**Extraction order** — the engine checks these fields in order and uses the first non-empty value:

1. `toolArgs.command` — exec tool command string
2. `toolArgs.path` — file tools (Read, Write, Edit)
3. `toolArgs.file_path` — alternate field name for file path
4. `toolArgs.url` — browser/web_fetch URL
5. `toolArgs.message` — message tool content
6. `context.prompt` — turn-level prompts (for `turn:pre`/`turn:post`)
7. Empty string (no match if all above are empty)

Test your regex before deploying: [regex101.com](https://regex101.com) (select JavaScript flavor).

### `topicId`

**Type:** `number | string`  
**Match:** Exact match against `context.topicId` (compared as strings).

```yaml
match:
  topicId: 42         # Only fires in Telegram forum topic 42
```

Useful for scoping hooks to a specific project or conversation thread.

### `isSubAgent`

**Type:** `boolean`  
**Match:** Whether the current session is a sub-agent session.

```yaml
match:
  isSubAgent: true    # Only fires in sub-agent sessions
  isSubAgent: false   # Only fires in the main agent session
```

Detection: the engine checks if `:subagent:` appears in `context.sessionKey`.
- Main agent: `agent:main:telegram:group:-100EXAMPLE:topic:42` → `isSubAgent: false`
- Sub-agent: `agent:main:subagent:63e06a06` → `isSubAgent: true`

### `sessionPattern`

**Type:** `string` (JavaScript regex)  
**Match:** Regex tested against the full session key.

```yaml
match:
  sessionPattern: "telegram:group"         # Any Telegram group session
  sessionPattern: "subagent:phase-12"      # Specific sub-agent label
  sessionPattern: "topic:42$"             # Exact topic 42 at end of key
```

### `custom`

**Type:** `string` (path to JS/TS module)  
**Match:** Calls your custom function and uses its return value.

```yaml
match:
  custom: ./matchers/my-custom-matcher.js
```

The module must export a default function:

```typescript
// my-custom-matcher.js (or .ts compiled to .js)
import type { HookContext } from '@fractal-ai/plugin-lifecycle-hooks';

export default async function(context: HookContext): Promise<boolean> {
  // Return true to fire the hook, false to skip it
  return context.toolArgs?.['command']?.toString().includes('sensitive-path') ?? false;
}
```

> **Fail-open:** If the custom module cannot be loaded or throws, the matcher logs a
> warning and returns `true` (hook fires). This prevents a broken matcher from
> silently disabling a safety hook.

---

## Actions

### `block`

Halts the pipeline. Returns `passed: false`. The caller must not proceed with the
tool call or pipeline step.

```yaml
action: block
onFailure:
  action: block
  notifyUser: true
  message: "🚫 This operation is not permitted."
```

**What gets blocked:** The pipeline stops at the current gate point. For `turn:tool:pre`,
the tool call never executes. For `subagent:spawn:pre`, the sub-agent never starts.

The block message comes from `onFailure.message` if set, otherwise a default message
including the tool name, command (truncated to 80 chars), and hook point.

### `log`

Writes a structured JSON line to `target` (a file path) or stdout if `target` is omitted.
**Always passes** — never blocks.

```yaml
action: log
target: "/path/to/workspace/memory/audit.jsonl"
```

**Log entry format:**

```json
{
  "timestamp": "2026-02-17T21:00:00.000Z",
  "point": "turn:tool:pre",
  "sessionKey": "agent:main:telegram:group:-100EXAMPLE:topic:42",
  "topicId": 42,
  "tool": "exec",
  "args": { "command": "ls /tmp" },
  "prompt": "...",
  "subagent": "my-subagent-label"
}
```

Fields are included only when present in the context. String values in `args` are
truncated to 100 characters. The `prompt` field is truncated to 200 characters.

The parent directory of `target` is created automatically if it doesn't exist.
On write failure, the entry falls back to stdout (non-fatal).

### `summarize_and_log`

Calls an LLM to produce a human-readable summary of the hook event, then appends
the result to `target`. **Always passes** — never blocks.

```yaml
action: summarize_and_log
model: anthropic/claude-haiku-4-5    # Override model for this hook
target: "/path/to/workspace/memory/topics/topic-42.md"
```

**Model resolution order:**

1. `hook.model` (this hook's `model` field)
2. `defaults.model` (global default)
3. `"default"` (fallback placeholder)

> **SDK stub:** The LLM call is currently a stub pending the OpenClaw plugin SDK.
> The action writes a structured JSON line with the extracted context instead of
> a true LLM summary. Wire up `generateSummary()` in `src/actions/summarize.ts`
> once the SDK is available.

**Output entry format:**

```json
{
  "timestamp": "2026-02-17T21:00:00.000Z",
  "point": "turn:post",
  "sessionKey": "...",
  "summary": "Agent completed turn. Tool exec was called with 'ls /tmp'. Response: ...",
  "model": "anthropic/claude-haiku-4-5"
}
```

### `inject_context`

Reads the file at `target` and injects its content into the current session's context
window. **Always passes** — never blocks.

```yaml
action: inject_context
target: "/path/to/workspace/AGENTS.md"
```

Best used at `subagent:spawn:pre` or `subagent:pre` to give sub-agents access to
workspace conventions, project state, or safety reminders.

> **SDK stub:** Context injection via the OpenClaw API is pending the plugin SDK.
> Currently logs what would be injected (length, target path). Wire up
> `openClawApi.context.inject()` in `src/actions/inject.ts` once the SDK is available.

**Failure behavior:** If the target file cannot be read, the action returns `passed: true`
with an error message — it never blocks even on failure (by design; missing context
shouldn't halt the pipeline).

### `exec_script`

Runs a shell script and uses its exit code to determine pass/fail. The script path
comes from `hook.target`.

```yaml
action: exec_script
target: "/path/to/workspace/hooks/my-check.sh"
onFailure:
  action: block
  message: "🚫 Pre-flight check failed."
```

**Pass/fail:**
- Exit code `0` → `passed: true`
- Exit code `≠ 0` → `passed: false` (stderr included in `result.message`)

**Timeout:** 30 seconds (hardcoded). Scripts that exceed this are killed and return
`passed: false`.

**Environment variables passed to the script:**

| Variable | Content |
|----------|---------|
| `HOOK_POINT` | Hook point name (e.g. `turn:tool:pre`) |
| `HOOK_SESSION` | Full session key |
| `HOOK_TOOL` | Tool name (empty string if not a tool hook) |
| `HOOK_ARGS` | JSON-encoded tool arguments (`{}` if none) |
| `HOOK_TOPIC` | Forum topic ID (empty string if none) |
| `HOOK_TIMESTAMP` | Unix timestamp in milliseconds |
| `HOOK_SUBAGENT` | `"true"` or `"false"` |
| `HOOK_SUBAGENT_LABEL` | Sub-agent label (empty if not a sub-agent hook) |
| `HOOK_CRON_JOB` | Cron job name (empty if not a cron hook) |
| `HOOK_PROMPT` | User prompt (empty if not a turn-level hook) |

All existing process environment variables are also inherited.

**Security denylist** — Scripts at these paths are rejected before execution:

| Denied prefix | Reason |
|--------------|--------|
| `/etc/` | System configuration |
| `/bin/rm`, `/usr/bin/rm` | Anti-bypass |
| `/usr/sbin/` | System admin commands |
| `/sbin/` | System binaries |

Store your scripts in `~/.openclaw/workspace/hooks/` for safe access.

**Example script:**

```bash
#!/usr/bin/env bash
# hooks/pre-exec-check.sh — block commands targeting /etc
set -euo pipefail

ARGS_COMMAND=$(echo "$HOOK_ARGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('command',''))")

if echo "$ARGS_COMMAND" | grep -q '/etc/'; then
  echo "Command targets /etc — blocked." >&2
  exit 1
fi

exit 0
```

### Custom Module Actions

Any `action` string that doesn't match a built-in name is treated as a path to a
TypeScript/JavaScript module (loaded via dynamic `import()`).

```yaml
action: ./hooks/actions/my-custom-action.js
```

The module must export a default function matching this signature:

```typescript
import type {
  HookDefinition,
  HookContext,
  HookResult,
  HooksConfig,
} from '@fractal-ai/plugin-lifecycle-hooks';

export default async function(
  hook: HookDefinition,
  context: HookContext,
  startTime: number,
  config: Pick<HooksConfig, 'defaults'>
): Promise<HookResult> {
  // Your logic here
  return {
    passed: true,
    action: 'my-custom-action',
    message: 'All checks passed.',
    duration: Date.now() - startTime,
  };
}
```

Return `passed: false` to block the pipeline. Return `passed: true` to allow it.

---

## Failure Handling (`onFailure`)

Every hook can define what happens when its **action throws an unexpected error**
(not when a `block` action returns `passed: false` — that's intentional).

```yaml
onFailure:
  action: continue       # Required within onFailure
  retries: 3             # Only used when action: retry
  notifyUser: true       # Surface a notification to the user
  message: "Custom msg"  # Override the default error/block message
```

### `onFailure.action`

| Value | Behavior |
|-------|----------|
| `block` | Return `passed: false`. Pipeline halts. |
| `retry` | Retry the action up to `retries` times with exponential backoff. If all retries fail, fall through to `continue`. |
| `notify` | Send a fire-and-forget Telegram notification to the user, then continue. |
| `continue` | Return `passed: true`. Log the error. Pipeline continues. |

**Default** (when no `onFailure` is set): `continue`.

### Retry Backoff

When `action: retry`, the engine waits before each attempt:

| Attempt | Wait |
|---------|------|
| 1st retry | 100ms |
| 2nd retry | 200ms |
| 3rd retry | 400ms |
| 4th retry | 800ms |
| … | doubles each time |

After `retries` exhausted, the engine falls through to `continue` (returns `passed: true`
with a failure message).

### `onFailure.notifyUser`

**Type:** `boolean` (default: `false`)

When `true`, a Telegram notification is sent to the user when a hook blocks or fails.
The notification is **fire-and-forget** — it never blocks the hook result and failures
to send are caught and logged silently.

```yaml
onFailure:
  action: block
  notifyUser: true
  message: "🚫 Blocked: Use trash instead of rm."
```

**When notifications fire:**

1. **On block** — When a hook's action returns `passed: false` (i.e. a `block` action fires),
   the block message is sent as a Telegram notification to the current session's chat.

2. **On `notify` action** — When an action fails (throws an error) and `onFailure.action: notify`,
   the failure message is sent and the pipeline continues.

**Target resolution** — The Telegram chat and optional thread are extracted automatically
from the session key:

| Session key format | Sends to |
|-------------------|----------|
| `telegram:group:-100EXAMPLE456789:topic:42` | Group chat, thread 42 |
| `telegram:group:-100EXAMPLE456789` | Group chat (no thread) |
| `telegram:987654321` | Direct message |

If the session key cannot be parsed (e.g. non-Telegram sessions), the notification is
silently skipped.

**Requirements:** The plugin must be loaded via the OpenClaw plugin system (not used
as a standalone library) so that `api.runtime` is captured at registration time.
In standalone/test usage, `notifyUser` is a no-op.

### `onFailure.message`

Custom string shown to the user (or included in log) when the hook blocks or fails.
If omitted, the engine generates a default message including the tool name, command
excerpt, and hook point.

### Precedence

Hook-level `onFailure` overrides `defaults.onFailure`:

```yaml
defaults:
  onFailure:
    action: continue        # All hooks default to soft-fail

hooks:
  - point: turn:tool:pre
    action: block
    # This hook has no onFailure — uses defaults.onFailure (continue)
    # But since action is block, passed=false is intentional (not an error)

  - point: heartbeat:post
    action: exec_script
    target: "/hooks/push-dashboard.sh"
    onFailure:
      action: retry         # Override: retry on transient failure
      retries: 3
      notifyUser: true
      message: "Dashboard push failed after 3 retries."
```

---

## Model Config

Used by `summarize_and_log` and (once wired) `inject_context` for LLM inference.

```yaml
defaults:
  model: anthropic/claude-haiku-4-5    # Global default

hooks:
  - action: summarize_and_log
    model: anthropic/claude-opus-4-6   # Override for high-value topics
```

Model strings are passed directly to the OpenClaw LLM API. Use any model supported
by your OpenClaw deployment (e.g. `anthropic/claude-haiku-4-5` for speed/cost,
`anthropic/claude-opus-4-6` for quality).

---

## `enabled` Flag

Disable a hook without removing it:

```yaml
hooks:
  - point: turn:pre
    action: inject_context
    target: "/path/to/workspace/memory/safety-reminder.md"
    enabled: false   # Disabled — won't fire until set to true
```

Disabled hooks are skipped during both `getHooksForPoint()` and `execute()`.
Default is `true` (you don't need to specify `enabled: true` explicitly).

---

## Complete Annotated Example

```yaml
version: "1"

defaults:
  model: anthropic/claude-haiku-4-5
  onFailure:
    action: continue
    notifyUser: false

hooks:
  # ── Safety gates ────────────────────────────────────────────────────────────

  # Block rm at both main and sub-agent levels
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

  # Block sudo
  - point: turn:tool:pre
    match:
      tool: exec
      commandPattern: "^sudo\\s"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: "🚫 sudo is not permitted in agent sessions."

  # ── Observability ───────────────────────────────────────────────────────────

  # Log all turns to a JSONL audit file
  - point:
      - turn:pre
      - turn:post
    action: log
    target: "/path/to/workspace/memory/audit.jsonl"
    onFailure:
      action: continue

  # Summarize turns in topic 42 for memory persistence
  - point: turn:post
    match:
      topicId: 42
    action: summarize_and_log
    model: anthropic/claude-haiku-4-5
    target: "/path/to/workspace/memory/topics/topic-42.md"
    onFailure:
      action: continue

  # ── Sub-agent management ─────────────────────────────────────────────────────

  # Inject AGENTS.md into every sub-agent before it runs
  - point: subagent:spawn:pre
    action: inject_context
    target: "/path/to/workspace/AGENTS.md"
    onFailure:
      action: continue

  # Log all sub-agent spawns
  - point: subagent:spawn:pre
    action: log
    target: "/path/to/workspace/memory/subagent-spawns.jsonl"
    onFailure:
      action: continue

  # ── Heartbeat dashboard ──────────────────────────────────────────────────────

  # Push state to dashboard after each heartbeat
  - point: heartbeat:post
    action: exec_script
    target: "/path/to/workspace/hooks/push-dashboard.sh"
    onFailure:
      action: retry
      retries: 3
      notifyUser: false

  # ── Custom validation (disabled by default) ───────────────────────────────────

  - point: turn:tool:pre
    match:
      tool: Write
    action: exec_script
    target: "/path/to/workspace/hooks/validate-write-path.sh"
    enabled: false
    onFailure:
      action: block
      message: "🚫 Write outside workspace is blocked."
```

---

## Validation Errors

The config loader throws `ConfigValidationError` for schema violations:

| Error | Cause |
|-------|-------|
| `Missing required field: version` | `version` field absent |
| `Missing required field: hooks` | `hooks` field absent |
| `hooks must be an array` | `hooks` is not a list |
| `hooks[N].point is required` | Hook missing `point` |
| `hooks[N].point "X" is not a valid hook point. Valid points: ...` | Invalid point string |
| `hooks[N].action is required` | Hook missing `action` |
| `hooks[N].action must be a non-empty string` | Empty action string |
| `hooks[N].onFailure.action must be one of: block, retry, notify, continue` | Invalid failure action |

All errors include the field path (e.g. `hooks[2].onFailure.action`) for easy location.

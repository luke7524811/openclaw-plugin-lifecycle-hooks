# Architecture — OpenClaw Lifecycle Hooks (Contributor Guide)

> How the gate engine works internally. For contributors, fork maintainers, and
> anyone integrating the engine into a custom pipeline.

---

## Overview

The plugin is structured around a **gate engine** — a single stateful object that
loads config, evaluates filters, dispatches actions, and returns pass/fail results
to the caller. The caller (the agent pipeline) decides whether to halt based on
those results.

```
HOOKS.yaml
    │
    ▼
LifecycleGateEngine.loadConfig()
    │  (validates schema, stores HooksConfig)
    │
    ▼
pipeline event fires
    │
    ▼
LifecycleGateEngine.execute(point, context)
    │
    ├─ for each HookDefinition:
    │    ├─ shouldFire(hook, context)     ← matcher.ts
    │    │    ├─ check hook.enabled
    │    │    ├─ check hook.point matches context.point
    │    │    └─ matchesFilter(hook.match, context)
    │    │
    │    └─ (if fires) dispatchAction(hook.action, hook, context)
    │         ├─ built-in: block | log | summarize_and_log | inject_context | exec_script
    │         └─ custom:  dynamic import(modulePath)
    │
    ├─ if result.passed === false → short-circuit (stop processing further hooks)
    │
    └─ return HookResult[]

caller checks: results.some(r => !r.passed) → block pipeline
```

---

## Source File Map

```
src/
├── types.ts          — All TypeScript interfaces and type aliases
├── config.ts         — HOOKS.yaml parser and schema validator
├── matcher.ts        — shouldFire() and matchesFilter() — filter evaluation
├── engine.ts         — LifecycleGateEngine class — orchestration
├── notify.ts         — Fire-and-forget Telegram user notifications
├── index.ts          — Plugin entry point, config resolution, named exports
└── actions/
    ├── index.ts      — BUILT_IN_ACTIONS registry and dispatchAction()
    ├── block.ts      — block action (pipeline halt)
    ├── log.ts        — log action (JSONL file write)
    ├── summarize.ts  — summarize_and_log action (LLM + file write)
    ├── inject.ts     — inject_context action (context injection)
    └── exec-script.ts — exec_script action (shell script execution)
```

---

## Core Data Types (`types.ts`)

### `HookContext`

The runtime context passed to every hook. Built by the pipeline caller and passed to
`engine.execute()`.

```typescript
interface HookContext {
  point: HookPoint;              // Which hook point fired
  sessionKey: string;            // Full session identifier
  topicId?: number | string;     // Forum topic (if applicable)
  prompt?: string;               // Incoming user prompt (turn hooks)
  toolName?: string;             // Tool being called (tool hooks)
  toolArgs?: Record<string, unknown>; // Tool arguments (tool hooks)
  response?: string;             // Agent response (post hooks)
  subagentLabel?: string;        // Sub-agent label (subagent hooks)
  cronJob?: string;              // Cron job name (cron hooks)
  heartbeatMeta?: Record<string, unknown>; // Heartbeat metadata
  raw?: Record<string, unknown>; // Raw event payload (extensibility)
  timestamp: number;             // Unix ms when hook triggered
}
```

Callers populate only the fields relevant to the current hook point. The engine
and matchers treat unset optional fields as absent (not as null or empty string).

### `HookResult`

Returned by every action executor.

```typescript
interface HookResult {
  passed: boolean;       // false = halt pipeline at this point
  action: HookAction;    // which action ran
  message?: string;      // human-readable result or block message
  duration: number;      // wall-clock ms for this hook
}
```

`passed: false` is the signal. The engine short-circuits and the caller halts.

### `HookDefinition`

One entry from the `hooks` array in HOOKS.yaml. Validated by `config.ts`.

```typescript
interface HookDefinition {
  point: HookPoint | HookPoint[];
  match?: MatchFilter;
  action: HookAction;
  model?: string;
  target?: string;
  onFailure?: OnFailure;
  enabled?: boolean;
}
```

---

## Config Loader (`config.ts`)

### Responsibilities

1. Read HOOKS.yaml from disk via `fs.readFile`
2. Parse YAML with `js-yaml`
3. Validate the parsed object against the schema
4. Return a typed `HooksConfig` object

### Validation

`validateConfig()` and `validateHookDefinition()` are plain functions that throw
`ConfigValidationError` on schema violations. No external schema library is used —
the validation is written inline to keep dependencies minimal.

**What's validated:**

- `version`: required, must be string or number
- `hooks`: required, must be an array
- Each hook's `point`: required, must be a string (or array of strings) from the
  `VALID_HOOK_POINTS` set
- Each hook's `action`: required, must be a non-empty string
- Each hook's `onFailure.action` (if present): must be in `VALID_FAILURE_ACTIONS`

**What's not validated:**

- `match` fields (validated implicitly at runtime by `matchesFilter`)
- `target` paths (checked at action execution time, not load time)
- `model` strings (passed to LLM API, which validates them)
- Custom action module paths (resolved at dispatch time)

This is intentional — strict validation at load time for structure, loose validation
at runtime for semantics.

### Adding New Hook Points

Add the new string to `VALID_HOOK_POINTS` in `config.ts` and to the `HookPoint`
union type in `types.ts`. Both must be in sync.

```typescript
// types.ts
export type HookPoint =
  | 'turn:pre'
  | 'your:new:point'   // ← add here
  | ...;

// config.ts
const VALID_HOOK_POINTS = new Set([
  'turn:pre',
  'your:new:point',    // ← add here
  ...
]);
```

---

## Matcher (`matcher.ts`)

### `shouldFire(hook, context): Promise<boolean>`

The top-level entry point. Returns `true` if the hook should fire for this context.

```
shouldFire(hook, context)
  │
  ├─ hook.enabled === false → return false
  ├─ context.point not in hook.point(s) → return false
  └─ matchesFilter(hook.match, context)
       │
       ├─ filter.tool? → context.toolName === filter.tool
       ├─ filter.commandPattern? → RegExp.test(extractCommandSubject(context))
       ├─ filter.topicId? → String(context.topicId) === String(filter.topicId)
       ├─ filter.isSubAgent? → context.sessionKey.includes(':subagent:') === filter.isSubAgent
       ├─ filter.sessionPattern? → RegExp.test(context.sessionKey)
       └─ filter.custom? → dynamic import + call default export
```

All filter fields are **AND logic** — every present field must match. If a field is
absent from the filter, it's skipped (not required to match).

### `extractCommandSubject(context): string`

The command subject for `commandPattern` matching is extracted from the context in
this priority order:

1. `toolArgs.command` — exec tool
2. `toolArgs.path` — Read/Write/Edit
3. `toolArgs.file_path` — alternate field name
4. `toolArgs.url` — browser/web_fetch
5. `toolArgs.message` — message tool
6. `context.prompt` — turn-level context
7. `""` — fallback (regex won't match empty string unless written to)

### Custom Matcher Behavior

Custom matchers (`filter.custom`) fail-open: if the module can't be imported or
the default export isn't a function, `matchesFilter` logs a warning and returns
`true` (hook fires). This prevents a broken custom matcher from silently disabling
a safety-critical hook.

### Adding a New Filter Field

1. Add the field to `MatchFilter` in `types.ts`
2. Add evaluation logic to `matchesFilter()` in `matcher.ts` (follow the pattern
   of existing fields — check `undefined` first, then evaluate and return `false`
   if not matched)
3. Add test cases to `src/__tests__/matcher.test.ts`

---

## Gate Engine (`engine.ts`)

### `LifecycleGateEngine` Class

The engine is a stateful class that holds the loaded config and orchestrates
hook execution. One engine instance per agent process (exported as a singleton
from `index.ts`).

### `loadConfig(filePath)`

Delegates to `loadHooksConfig()` from `config.ts`. Stores the result internally.
Logs the hook count on success.

### `getHooksForPoint(point)`

Returns enabled `HookDefinition[]` for the given point, **without** evaluating
match filters. This is a synchronous pre-filter. Match filters require `async`
evaluation (custom matchers can be async), so they're evaluated lazily in `execute()`.

### `execute(point, context)`

The core loop:

```typescript
for (const hook of this.config.hooks) {
  const fires = await shouldFire(hook, context);
  if (!fires) continue;

  let result: HookResult;
  try {
    result = await dispatchAction(hook.action, hook, context, startTime, { defaults });
  } catch (err) {
    result = await this.handleActionError(hook, context, startTime, err);
  }

  results.push(result);

  if (!result.passed) {
    // Short-circuit: stop processing further hooks
    break;
  }
}
```

**Key design choices:**

- **Sequential, not parallel.** Hooks run in order. A blocking hook halts the chain.
  Parallel execution would prevent short-circuit behavior.
- **Catch at the per-hook level.** Unhandled errors from action executors are caught
  by `handleActionError()` and routed through `onFailure` logic. The engine never
  throws to the caller.
- **Short-circuit on first block.** If any hook returns `passed: false`, subsequent
  hooks don't run. This is intentional — a blocked pipeline shouldn't continue
  auditing itself.

### `handleActionError(hook, context, startTime, err)`

Handles unexpected errors thrown by action executors. Routes through `onFailure`:

| `onFailure.action` | Behavior |
|--------------------|----------|
| `block` | Return `{ passed: false }` immediately |
| `retry` | Retry `onFailure.retries` times with exponential backoff (100ms × 2^attempt). On exhaustion, fall through to `continue`. |
| `notify` | Send fire-and-forget Telegram notification, then fall through to `continue` |
| `continue` (default) | Return `{ passed: true }` with error message |

Note: `handleActionError` handles **unexpected errors** (exceptions thrown during
action execution), not intentional `passed: false` returns from `block`. Those
are normal control flow, not errors.

### `buildContext(point, sessionKey, overrides)` (static)

Convenience factory for `HookContext`. Pre-fills `point`, `sessionKey`, and
`timestamp`. Callers only need to provide the relevant overrides.

---

## Notification System (`notify.ts`)

`notify.ts` provides fire-and-forget Telegram notifications for hook events. It is
completely decoupled from the gate engine — failures to send never propagate.

### Runtime Capture Pattern

OpenClaw's `api.runtime` object holds the live channel bindings (including Telegram).
Because `register()` must be **synchronous**, the runtime reference is captured at
registration time and stored in a module-level variable:

```typescript
// In index.ts — register():
setRuntime(api.runtime);  // ← called once, synchronously

// In notify.ts:
let _runtime: any = null;
export function setRuntime(runtime: any): void {
  _runtime = runtime;   // ← stored for later async use
}
```

All subsequent calls to `notifyUser()` use this stored reference. This avoids
the need to thread `api` through the engine and action layer.

### `parseTelegramTarget(sessionKey): TelegramTarget | null`

Parses the Telegram chat destination from a session key string. Returns `null`
if the session key doesn't match any Telegram format (e.g. non-Telegram sessions).

```
Session key formats:
  telegram:group:-100EXAMPLE456789:topic:42  → { chatId: "-100EXAMPLE456789", threadId: 42 }
  telegram:group:-100EXAMPLE456789           → { chatId: "-100EXAMPLE456789" }
  telegram:987654321                     → { chatId: "987654321" }
  anything-else                          → null (no notification sent)
```

The regex patterns are ordered from most-specific to least-specific (topic before
group, group before DM) to prevent the group pattern from matching topic keys.

### `notifyUser(sessionKey, message): void`

The public entry point. Called from:

- `engine.ts` — when a block action returns `passed: false` and `hook.onFailure.notifyUser === true`
- `engine.ts` — when `onFailure.action === 'notify'` after an action error
- `index.ts` — directly in the `before_tool_call` handler when a gate blocks

```typescript
// Fire-and-forget: kicks off async work without awaiting
export function notifyUser(sessionKey: string, message: string): void {
  void _sendNotification(sessionKey, message);
}
```

The `void` keyword discards the returned Promise intentionally. Any errors in
`_sendNotification` are caught internally — they never reach the caller.

### `_sendNotification(sessionKey, message): Promise<void>`

The internal async implementation:

```
_sendNotification()
  │
  ├─ _runtime not set? → warn + return
  ├─ parseTelegramTarget(sessionKey) returns null? → warn + return
  ├─ api.runtime.channel.telegram.sendMessageTelegram not available? → warn + return
  └─ sendMessageTelegram(chatId, message, { messageThreadId? }) → log success
     └─ any exception → catch, log error, return
```

### Design: Fire-and-Forget

Notifications are intentionally fire-and-forget for these reasons:

1. **Non-blocking** — The hook result has already been decided. Awaiting a network
   call would add latency to the tool block, which already completed.
2. **Non-critical** — If the Telegram API is unreachable, the block still happened.
   The user will see it in the agent's reply anyway.
3. **Safe fallback** — All error paths are caught. A misconfigured runtime, an
   unparseable session key, or a network failure all produce a console warning,
   never an exception.

### Where `notifyUser` Is Called

| Caller | Condition |
|--------|-----------|
| `engine.ts` → `execute()` | Block action fired + `hook.onFailure.notifyUser === true` |
| `engine.ts` → `handleActionError()` | `onFailure.action === 'notify'` |
| `index.ts` → `before_tool_call` handler | Any gate block (always notifies regardless of `notifyUser` flag) |

> **Note:** The `before_tool_call` handler in `index.ts` calls `notifyUser()` unconditionally
> on every block. The `onFailure.notifyUser` flag in `engine.ts` is an additional mechanism
> for notifying on hook-level failures (error path), not just on intentional blocks.

---

## Action Registry (`actions/index.ts`)

### `BUILT_IN_ACTIONS`

A plain object mapping action name strings to `ActionExecutor` functions:

```typescript
const BUILT_IN_ACTIONS: Record<string, ActionExecutor> = {
  block:              (hook, ctx, t, _cfg) => executeBlock(hook, ctx, t),
  log:                (hook, ctx, t, _cfg) => executeLog(hook, ctx, t),
  summarize_and_log:  (hook, ctx, t, cfg) => executeSummarize(hook, ctx, t, cfg),
  inject_context:     (hook, ctx, t, _cfg) => executeInject(hook, ctx, t),
  exec_script:        (hook, ctx, t, _cfg) => executeExecScript(hook, ctx, t),
};
```

### `dispatchAction(action, hook, context, startTime, config)`

1. Look up `action` in `BUILT_IN_ACTIONS`. If found, call it.
2. Otherwise, treat `action` as a module path and call `executeCustomAction()`.

### `executeCustomAction(modulePath, ...)`

Dynamically imports the module and calls its default export. On import failure or
missing default export, returns `{ passed: false }` with the error message. This
means a broken custom action always blocks — intentional (fail-safe default).

### `ActionExecutor` Signature

```typescript
type ActionExecutor = (
  hook: HookDefinition,
  context: HookContext,
  startTime: number,
  config: Pick<HooksConfig, 'defaults'>
) => Promise<HookResult>;
```

All built-in and custom action executors must match this signature.

### Adding a New Built-in Action

1. Create `src/actions/your-action.ts` with an exported `executeYourAction` function
   matching `ActionExecutor`.
2. Import it in `src/actions/index.ts`.
3. Add it to `BUILT_IN_ACTIONS`:
   ```typescript
   your_action: (hook, ctx, t, cfg) => executeYourAction(hook, ctx, t, cfg),
   ```
4. Add it to the `HookAction` type in `types.ts` (as a string literal) — optional
   but helps IDE tooling.
5. Update `CONFIGURATION.md` with the new action's description and fields.
6. Write tests in `src/__tests__/`.

---

## Action Implementations

### `block` (`actions/block.ts`)

The simplest action. Always returns `passed: false`. The message comes from
`hook.onFailure?.message` if set, otherwise a generated message with tool name,
command excerpt (max 80 chars), and hook point.

```
executeBlock → return { passed: false, message: ..., duration }
```

No side effects. No async operations. Deterministic.

### `log` (`actions/log.ts`)

Serializes context fields to a JSON object, then either appends to a file or
emits to stdout. Always returns `passed: true`.

**File write path:**
1. Resolve `hook.target` to an absolute path
2. `fs.mkdir` the parent directory (recursive, no-op if exists)
3. `fs.appendFile` the JSON entry + newline

On write failure: logs to stdout (non-fatal), returns `passed: true` anyway.

**Sanitization:** String values in `toolArgs` are truncated to 100 chars to avoid
log bloat. The `prompt` field is truncated to 200 chars.

### `summarize_and_log` (`actions/summarize.ts`)

Calls `generateSummary()` (LLM stub), then writes the result to `hook.target`
(or stdout). Always returns `passed: true`.

**Model resolution:** `hook.model ?? config.defaults?.model ?? 'default'`

**LLM stub:** `generateSummary()` currently builds a deterministic text summary
from context fields. To wire up a real LLM:

```typescript
// In src/actions/summarize.ts, replace the stub:
async function generateSummary(hook, context, model): Promise<string> {
  const response = await openClawApi.llm.complete({
    model,
    messages: [
      { role: 'system', content: 'Summarize this agent event in 1-2 sentences.' },
      { role: 'user', content: buildPrompt(hook, context) },
    ],
    max_tokens: 200,
  });
  return response.choices[0].message.content;
}
```

**Fallback:** If the LLM call throws, `buildFallbackSummary()` returns a plain
string with point, session, and timestamp. The write still happens.

### `inject_context` (`actions/inject.ts`)

Reads a file from `hook.target` and (once the SDK is available) injects its
content into the session's context window. Always returns `passed: true`.

**Current state:** Logs what would be injected. Wire up to the OpenClaw API:

```typescript
// In src/actions/inject.ts, after loading injectedContent:
await openClawApi.context.inject({
  sessionKey: context.sessionKey,
  content: injectedContent,
  position: 'prefix',  // or 'suffix'
});
```

**Special prefixes (planned):** `memory:` and `topic:` would resolve to OpenClaw
memory objects rather than file paths. Currently throws on these prefixes.

### `exec_script` (`actions/exec-script.ts`)

Runs a shell script via `child_process.execFile`. Context is passed as env vars.
Exit code 0 → `passed: true`. Non-zero → `passed: false`.

**Security denylist:**

The `isDeniedScript()` function checks the resolved path against `DENIED_SCRIPT_PREFIXES`:

```typescript
const DENIED_SCRIPT_PREFIXES = [
  '/etc/', '/usr/bin/rm', '/bin/rm', '/usr/sbin/', '/sbin/',
];
```

Paths are resolved with `path.resolve()` before checking, so relative paths like
`../../bin/rm` are blocked.

**Error codes handled:**

| Error code | Result |
|------------|--------|
| `ENOENT` | Script not found → `passed: false` |
| `EACCES` | Not executable → `passed: false` |
| `ETIMEDOUT` / `killed` | Timeout (30s) → `passed: false` |
| Non-zero exit | → `passed: false` with stderr in message |

**Env var construction:** `buildEnvVars()` merges `process.env` with the
`HOOK_*` variables. All hook env vars are strings (even booleans like `HOOK_SUBAGENT`).

---

## Plugin Entry Point (`index.ts`)

### Config Discovery

`resolveHooksConfigPath()` searches for `HOOKS.yaml` in this order:

1. `OPENCLAW_HOOKS_CONFIG` env var
2. `<cwd>/HOOKS.yaml`
3. `<workspace>/HOOKS.yaml` (workspace = `OPENCLAW_WORKSPACE` or `~/.openclaw/workspace`)

### Plugin Object

The `plugin` object conforms to the `OpenClawPlugin` interface. `setup(api)` is
called by OpenClaw on load. Currently it:

1. Calls `resolveHooksConfigPath()` to find `HOOKS.yaml`
2. Calls `engine.loadConfig()` to validate and load it
3. Logs the hook count

**Hook listener registration (stub):** The `setup` function currently logs what it
would do. Once the official OpenClaw plugin SDK is published, the registration looks
like (speculative):

```typescript
const openClaw = api as OpenClawAPI;

for (const point of ALL_HOOK_POINTS) {
  openClaw.hooks.on(point, async (ctx: HookContext) => {
    const results = await engine.execute(point, ctx);
    const blocked = results.find(r => !r.passed);
    if (blocked) {
      throw new HookBlockedError(blocked.message ?? 'Hook blocked pipeline');
    }
  });
}
```

### Engine Singleton

`export const engine = new LifecycleGateEngine()` is the shared instance used
by the plugin and available for programmatic use. Importers that want isolation
can instantiate their own `LifecycleGateEngine` instead.

---

## Test Suite

Tests live in `src/__tests__/`. Run with:

```bash
npm test
```

| File | Coverage |
|------|----------|
| `config.test.ts` | 16 tests — YAML parsing, validation errors, edge cases |
| `matcher.test.ts` | 31 tests — all filter types, AND logic, edge cases |
| `engine.test.ts` | 21 tests — execute(), onFailure, retry backoff, short-circuit |
| `notify.test.ts` | 12 tests — parseTelegramTarget(), notifyUser() integration |
| `integration.test.ts` | Many tests — full pipeline, notify path coverage |
| **Total** | **340+ tests** |

### Adding Tests

Tests are written with Jest. The pattern:

```typescript
import { LifecycleGateEngine } from '../../src/engine';
import { shouldFire } from '../../src/matcher';
import { loadHooksConfig, ConfigValidationError } from '../../src/config';
import type { HookContext, HookDefinition } from '../../src/types';

// Write YAML to a temp file for config tests
import * as tmp from 'tmp';
import * as fs from 'fs';
const tmpFile = tmp.fileSync({ postfix: '.yaml' });
fs.writeFileSync(tmpFile.name, `version: "1"\nhooks: []`);
```

---

## Extension Points

### Adding a Hook Point

1. Add to `HookPoint` union in `types.ts`
2. Add to `VALID_HOOK_POINTS` in `config.ts`
3. Document in `CONFIGURATION.md`
4. Add tests in `matcher.test.ts` for the new point
5. Wire up the OpenClaw pipeline intercept in `index.ts`'s `setup()` function

### Adding a Built-in Action

1. Create `src/actions/<name>.ts` with `execute<Name>()` matching `ActionExecutor`
2. Import and register in `src/actions/index.ts`
3. Optionally add to `HookAction` union in `types.ts`
4. Document in `CONFIGURATION.md`
5. Add tests

### Adding a Match Filter

1. Add field to `MatchFilter` in `types.ts`
2. Add evaluation in `matchesFilter()` in `matcher.ts`
3. Add tests in `matcher.test.ts`
4. Document in `CONFIGURATION.md`

---

## What's Not Yet Wired

| Feature | Status | Location |
|---------|--------|----------|
| `summarize_and_log` LLM call | Stub | `src/actions/summarize.ts` → `generateSummary()` |
| `inject_context` context API | Stub | `src/actions/inject.ts` → `executeInject()` |
| `notify` failure action | ✅ Done | `src/notify.ts` — fire-and-forget Telegram via `api.runtime` |
| Plugin hook registration | Stub | `src/index.ts` → `setup()` |
| Hot-reload file watcher | Not started | — |
| Custom matcher path resolution | Relative to workspace | `src/matcher.ts` → custom block |

All stubs have `TODO` comments in the source with notes on what to wire and where.
The stubs are non-breaking — the plugin loads and functions fully except for the
LLM-dependent and API-dependent features.

---

## Design Decisions

### Why gates, not events?

Most hook systems are fire-and-forget: the hook gets a notification but can't stop
the pipeline. This plugin maximizes gate coverage by routing through `before_tool_call`
(the most blockable pipeline point). True post-hooks (`turn:post`, etc.) are
fire-and-forget until upstream pipeline changes enable blocking there too.

### Why YAML over TypeScript config?

HOOKS.yaml configs are:
- Portable between deployments (no build step)
- Shareable on ClewHub without code
- Version-controllable with simple diffs
- Readable by non-TypeScript users

TypeScript config (like Vite or ESLint) would have been more powerful but
less portable. The tradeoff favors portability for a policy/config format.

### Why sequential execution?

Hooks run sequentially (not in parallel) for two reasons:
1. Short-circuit: the first blocking hook must stop all subsequent hooks
2. Ordering: users expect HOOKS.yaml order to be the execution order

Parallel execution would require all hooks to run even if one blocks, which
contradicts the gate model.

### Why fail-open on custom matchers?

Custom matcher modules (`filter.custom`) that can't be loaded return `true`
(hook fires). If they returned `false` (skip), a broken custom matcher would
silently disable a potentially critical safety hook. Failing open (the hook fires
anyway) is safer for security-oriented use cases.

### Why fail-closed on custom action modules?

Custom action modules that can't be loaded return `passed: false` (block). If the
pipeline expects a custom action to validate/allow a tool call and the action
module is broken, blocking is safer than silently passing.

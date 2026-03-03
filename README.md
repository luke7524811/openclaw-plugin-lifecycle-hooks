# @fractal-ai/plugin-lifecycle-hooks

> ⚠️ **IMPORTANT — READ BEFORE USE**
>
> This plugin **modifies how OpenClaw processes agent turns** and can enforce security-sensitive policies (blocking commands, gating execution, injecting context). Misconfiguration may block your agent pipeline entirely.
>
> **Written by AI.** While most hook actions and configurations have been live-tested in production, you should **validate all critical tasks and security rules yourself** before relying on them. Review your YAML config carefully — especially `block` actions — and test in a non-production environment first.

[![npm version](https://img.shields.io/npm/v/@fractal-ai/plugin-lifecycle-hooks.svg)](https://www.npmjs.com/package/@fractal-ai/plugin-lifecycle-hooks)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node ≥18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

**Enforced lifecycle hook gates for OpenClaw agent pipelines.**

Define safety policies, observability rules, and execution gates in a simple YAML file. Hooks fire at every major pipeline transition — and actually **block execution** until they complete.

---

## What It Does

OpenClaw's existing plugin hooks are fire-and-forget — the pipeline doesn't wait for them. This plugin replaces that with a **gate engine**: hooks block execution, complete their action, and only then allow the pipeline to continue.

This makes it possible to:
- ✅ **Enforce hard safety policies** (not just log them)
- ✅ **Inject context before sub-agents start**
- ✅ **Push structured data to external systems** at exactly the right moment
- ✅ **Block dangerous commands** before they execute
- ✅ **Auto-log turns to persistent memory** without manual intervention

---

## Quick Start

### 1. Install the Plugin

```bash
npm install @fractal-ai/plugin-lifecycle-hooks
```

### 2. Create `HOOKS.yaml` in Your Workspace Root

**Note:** Your production `HOOKS.yaml` lives in your OpenClaw workspace (`~/.openclaw/workspace/`), not this repo.

```yaml
version: "1"

hooks:
  # Block destructive rm commands (main agent + sub-agents)
  - point: [turn:tool:pre, subagent:tool:pre]
    match:
      tool: exec
      commandPattern: "^rm\\s"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: "🚫 Use `trash <path>` instead of `rm`."

  # Log all turns to per-topic JSONL files
  - point: turn:post
    match:
      topicId: "*"  # Match any topic
    action: log
    target: "memory/topics/topic-{topicId}.jsonl"
    onFailure:
      action: continue
```

### 3. Restart the OpenClaw Gateway

```bash
openclaw gateway restart
```

See [docs/QUICKSTART.md](./docs/QUICKSTART.md) for detailed setup instructions.

---

## CLI Management

The plugin includes a CLI tool for managing hooks without manually editing YAML files:

```bash
# List all hooks with their status
openclaw-hooks list

# Disable a hook by index or name
openclaw-hooks disable hook-2

# Enable a hook
openclaw-hooks enable hook-2

# Force hot-reload of HOOKS.yaml
openclaw-hooks reload
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `openclaw-hooks list` | List all hooks with their enabled/disabled status, hook points, and actions |
| `openclaw-hooks enable <name>` | Enable a hook by name or index (e.g. `hook-3`) |
| `openclaw-hooks disable <name>` | Disable a hook by name or index |
| `openclaw-hooks reload` | Touch HOOKS.yaml to trigger the fs.watch hot-reload |
| `openclaw-hooks help` | Show usage information |

### Hook Identification

Hooks are identified by:
1. **Index**: `hook-1`, `hook-2`, etc. (1-based, matches list output)
2. **Name field** (if your config includes `match.name`)

Example:
```bash
# List to see hook numbers
openclaw-hooks list

# Output:
# 1  hook-1 (block@turn:tool:pre)  turn:tool:pre  block  ✅ yes
# 2  hook-2 (log@turn:post)       turn:post      log    ✅ yes

# Disable by index
openclaw-hooks disable hook-1
```

### Hot Reload

Changes made via the CLI trigger the plugin's fs.watch hot-reload automatically — **no gateway restart needed**. The reload typically completes in < 300ms.

### Environment Variables

- `OPENCLAW_HOOKS_CONFIG` — Override path to HOOKS.yaml
- `OPENCLAW_WORKSPACE` — Workspace directory (default: `~/.openclaw/workspace`)

---

## Core Concepts

### Hook Points

Every major transition in the OpenClaw pipeline is hookable:

| Hook Point | When It Fires | Example Use |
|------------|---------------|-------------|
| `turn:pre` | Prompt received, before agent starts | Log incoming prompt, inject context |
| `turn:post` | Agent response finalized | Summarize turn to topic file |
| `turn:tool:pre` | Before a tool call (main agent) | Block `rm`, require confirmation |
| `turn:tool:post` | After a tool call resolves | Log results, validate output |
| `subagent:spawn:pre` | Main agent about to spawn sub-agent | Inject shared context, log spawn |
| `subagent:pre` | Sub-agent starting its session | Apply sub-agent-specific rules |
| `subagent:post` | Sub-agent completed | Force write to log, relay results |
| `subagent:tool:pre` | Before a tool call (sub-agent) | Same `rm` guard as main agent |
| `subagent:tool:post` | After a sub-agent tool call | Audit log |
| `heartbeat:pre` | Before a heartbeat cycle | Prepare health check data |
| `heartbeat:post` | After a heartbeat cycle | Push metrics to dashboard |
| `cron:pre` | Before a cron job fires | Log job start, validate conditions |
| `cron:post` | After a cron job completes | Track success rates, alert failures |

**Multiple points on one hook:**

```yaml
point: [turn:tool:pre, subagent:tool:pre]
```

---

## Actions Reference

### 🚫 `block` — Block Dangerous Operations

Immediately halt the pipeline with an optional message to the user.

**Example: Block `rm` commands**

```yaml
hooks:
  - point: [turn:tool:pre, subagent:tool:pre]
    match:
      tool: exec
      commandPattern: "^rm\\s"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: "🚫 Use `trash` instead of `rm`."
```

**When to use:**
- Prevent destructive commands (`rm -rf`, `dd`, `chmod 777`)
- Enforce delegation policies (e.g., "npm install must run in sub-agent")
- Block privileged operations (`sudo`, `docker run --privileged`)

**Key fields:**
- `action: block` — Action type
- `onFailure.notifyUser` — Send notification to user (optional)
- `onFailure.message` — Custom message (optional)

---

### 📝 `log` — Append Structured JSON to a Log File

Write structured JSON entries to a file or stdout. Supports variable interpolation in `target`.

**Example: Per-topic turn logging**

```yaml
hooks:
  - point: turn:post
    match:
      topicId: "*"  # Match any topic
    action: log
    target: "memory/topics/topic-{topicId}.jsonl"
    onFailure:
      action: continue
```

**When to use:**
- Auto-persist turns to per-topic memory files
- Audit log every exec call
- Track sub-agent spawns and completions
- Push structured data to external systems (parse JSONL with jq/Python)

**Key fields:**
- `action: log` — Action type
- `target` — File path (supports `{topicId}`, `{sessionKey}`, `{timestamp}`)
- If `target` is `"-"` or omitted, logs to stdout

**Output format:**
```json
{"point":"turn:post","sessionKey":"agent:main:telegram:group:-100EXAMPLE:topic:42","topicId":42,"timestamp":1735123456789,"prompt":"Fix the bug","response":"I'll investigate..."}
```

---

### 📥 `inject_context` — Load Context from File into Agent Prompt

Load a file and inject its content into the session context. Supports variable interpolation in `source`.

**Example: Inject topic context into every sub-agent**

```yaml
hooks:
  - point: subagent:pre
    match:
      topicId: "*"
    action: inject_context
    source: "memory/topics/topic-{topicId}.jsonl"
    onFailure:
      action: continue
```

**When to use:**
- Share workspace conventions (AGENTS.md, TOOLS.md) with every sub-agent
- Load per-topic context before each turn
- Inject security policies or style guides

**Key fields:**
- `action: inject_context` — Action type
- `source` — File path to load (supports variable interpolation)

**Note:** Currently a stub — will be wired to OpenClaw's context API in a future release.

---

### 🏷️ `inject_origin` — Inject Message Origin Metadata

Inject message origin metadata (chat ID, topic ID, sender) into the agent context.

**Example: Add origin metadata to every turn**

```yaml
hooks:
  - point: turn:pre
    match:
      topicId: "*"
    action: inject_origin
    onFailure:
      action: continue
```

**When to use:**
- Preserve origin context across sub-agent spawns
- Track which topic/chat/sender originated a request
- Survive context compaction

**Key fields:**
- `action: inject_origin` — Action type

**Injected metadata:**
```
Origin: chat={chatId} topic={topicId} from={sender}
```

---

### 🤖 `summarize_and_log` — LLM-Summarize Then Log

Use an LLM to summarize the event context, then append to a log file. Supports variable interpolation in `target`.

**Example: Context catcher for topic memory**

```yaml
hooks:
  - point: turn:post
    match:
      topicId: "*"
    action: summarize_and_log
    model: "anthropic/claude-haiku-4-5"
    target: "memory/topics/topic-{topicId}.md"
    onFailure:
      action: continue
```

**When to use:**
- Human-readable turn summaries for topic memory
- Condense long threads before context compaction
- Generate executive summaries for heartbeat/cron reports

**Key fields:**
- `action: summarize_and_log` — Action type
- `model` — LLM model to use for summarization
- `target` — File path (supports variable interpolation)

**Output format:** Appends markdown summary to the target file.

---

### 🔧 `exec_script` — Run a Shell Script with Optional Stdout Injection

Run a shell script; exit 0 = pass, non-zero = fail. Supports variable interpolation in `script`. Optionally captures stdout into agent context.

**Example: Security check before tool calls**

```yaml
hooks:
  - point: turn:tool:pre
    match:
      tool: exec
    action: exec_script
    script: "./scripts/security-check.sh {toolArgs.command}"
    injectOutput: false
    onFailure:
      action: block
      notifyUser: true
      message: "⛔ Security check failed."
```

**Example: Inject script output into context**

```yaml
hooks:
  - point: turn:pre
    action: exec_script
    script: "./scripts/load-env-vars.sh"
    injectOutput: true
    onFailure:
      action: continue
```

**When to use:**
- Run external validators (security scanners, linters)
- Push webhook notifications (Slack, Discord, PagerDuty)
- Dynamically load environment-specific config

**Key fields:**
- `action: exec_script` — Action type
- `script` — Path to shell script (supports variable interpolation)
- `injectOutput` — If `true`, capture stdout and inject into context (default: `false`)

---

### 📢 `notify_user` — Send Telegram Notification

Send a fire-and-forget Telegram notification to the user. Optionally generates an LLM summary before notifying.

**Example: Notify when sub-agent completes**

```yaml
hooks:
  - point: subagent:post
    action: notify_user
    model: "anthropic/claude-haiku-4-5"  # Optional: enables LLM summary
    onFailure:
      action: continue
```

**When to use:**
- Alert on critical events (sub-agent completion, dangerous command blocked)
- Push real-time status updates to Telegram
- Human-in-the-loop confirmations

**Key fields:**
- `action: notify_user` — Action type
- `model` — LLM model to use for summarization (optional)

**Note:** The notification target is automatically determined from the session context or `defaults.notificationTarget` in the config.

---

## Matching

Filters narrow when a hook fires. All specified fields must match (AND logic):

```yaml
match:
  action: "fs.*"                   # Semantic action category (glob supported)
  tool: exec                       # Exact tool name
  commandPattern: "^rm\\s"         # Regex: command, path, url, or prompt
  resourcePattern: "~/.ssh/**"     # Glob: file path, URL, or command with ~ expansion
  topicId: 42                      # Forum topic ID (or "*" for any topic)
  isSubAgent: false                # true = sub-agent only, false = main only
  sessionPattern: "telegram:"      # Regex against full session key
  custom: ./matchers/my.js         # Path to JS module returning boolean
```

### Semantic Action Matching

Instead of matching on raw tool names, you can match on **semantic action categories**:

```yaml
# Block all file system writes to sensitive paths
- point: turn:tool:pre
  match:
    action: "fs.write"
    resourcePattern: "~/.ssh/**"
  action: block

# Log all HTTP requests
- point: turn:tool:post
  match:
    action: "http.*"
  action: log
  target: "logs/http-audit.jsonl"
```

**Action Categories:**

| Action | Tools |
|--------|-------|
| `fs.read` | `read`, `glob` |
| `fs.write` | `write`, `edit` |
| `shell.exec` | `exec` |
| `http.request` | `web_search`, `web_fetch` |
| `browser.*` | `browser` |
| `document.read` | `pdf` |
| `image.analyze` | `image` |
| `agent.spawn` | `sessions_spawn` |
| `agent.message` | `sessions_send` |
| `messaging.send` | `message` |
| `system.schedule` | `cron` |
| `system.config` | `gateway` |

Glob patterns are supported: `fs.*` matches both `fs.read` and `fs.write`.

**Special matchers:**
- `topicId: "*"` — Matches any session with a `topicId` field (useful for "all topics" hooks)
- `topicId: 42` — Matches only topic 42

`commandPattern` inspects `toolArgs.command` → `toolArgs.path` → `toolArgs.url` → `toolArgs.message` → `context.prompt` in order.

`resourcePattern` uses the same extraction order but matches against a **glob pattern** (via `micromatch`) with automatic tilde (`~`) expansion for home directories. Example: `~/.ssh/**` matches any file under the user's `.ssh` directory.

---

## Variable Interpolation

All path-based actions (`log`, `summarize_and_log`, `inject_context`, `exec_script`) support variable interpolation:

| Variable | Example Value | Use Case |
|----------|---------------|----------|
| `{topicId}` | `42` | Per-topic log files: `memory/topics/topic-{topicId}.md` |
| `{sessionKey}` | `agent:main:telegram:group:-100EXAMPLE:topic:42` | Session-specific logs |
| `{timestamp}` | `1735123456789` | Timestamped snapshots |

**Example:**

```yaml
- point: turn:post
  match:
    topicId: "*"  # Match any topic
  action: log
  target: "memory/topics/topic-{topicId}.jsonl"
```

This creates `topic-42.jsonl`, `topic-43.jsonl`, etc. automatically based on the session's topic ID.

---

## Error Handling — `onFailure`

Configure per-hook what happens when an action fails or a gate doesn't pass:

```yaml
onFailure:
  action: block     # block | retry | notify | continue
  retries: 3        # (retry only) max attempts before giving up
  notifyUser: true  # surface message to the user
  message: "Custom failure message"
```

| `action` | Behavior |
|----------|----------|
| `block` | Return `passed: false`, halt pipeline |
| `retry` | Retry with exponential backoff (100ms → 200ms → 400ms...) |
| `notify` | Send a Telegram notification to the user and continue (fire-and-forget) |
| `continue` | Log error, return `passed: true`, pipeline continues |

**Default if `onFailure` is omitted:** `{ action: "continue" }`.

---

## Example Configurations

Ready-to-use configs in [`examples/`](./examples/):

| File | What it does |
|------|--------------|
| [`rm-guard.yaml`](./examples/rm-guard.yaml) | Block `rm`, `shred`, `rmdir` — main agent and sub-agents |
| [`security.hooks.yaml`](./examples/security.hooks.yaml) | Block rm, sudo, dd, chmod 777, curl-pipe-to-shell |
| [`logging.hooks.yaml`](./examples/logging.hooks.yaml) | Comprehensive turn/tool/subagent/cron logging |
| [`delegation.hooks.yaml`](./examples/delegation.hooks.yaml) | Enforce sub-agent delegation for npm, builds, Docker |

**To use an example:**

```bash
cp node_modules/@fractal-ai/plugin-lifecycle-hooks/examples/rm-guard.yaml HOOKS.yaml
# Edit paths and options to match your workspace
openclaw gateway restart
```

---

## Documentation

| Doc | What's in it |
|-----|-------------|
| [QUICKSTART.md](./docs/QUICKSTART.md) | Step-by-step: install → HOOKS.yaml → verify |
| [CONFIGURATION.md](./docs/CONFIGURATION.md) | Complete field reference for all options |
| [WALKTHROUGHS.md](./docs/WALKTHROUGHS.md) | 5 use-case walkthroughs with full configs |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Engine internals, data flow, extension points |

---

## Development

```bash
# Install dependencies
npm install

# Build TypeScript → dist/
npm run build

# Run all tests
npm test

# Watch mode
npm run test:watch

# Type-check only (no emit)
npm run lint
```

### Project Structure

```
src/
├── types.ts            All TypeScript types and interfaces
├── config.ts           HOOKS.yaml parser + schema validation
├── matcher.ts          Match filter evaluation
├── engine.ts           LifecycleGateEngine — orchestrates hook execution
├── notify.ts           Fire-and-forget Telegram user notifications
├── context-store.ts    Origin context storage for inject_origin
├── llm.ts              LLM completion wrapper
├── template.ts         Variable interpolation helpers
├── index.ts            Public exports
├── actions/
│   ├── block.ts        Block action
│   ├── log.ts          JSONL log action
│   ├── summarize.ts    LLM summarize + log action
│   ├── inject.ts       Context injection action
│   ├── inject-origin.ts Origin metadata injection
│   ├── exec-script.ts  Shell script action
│   ├── notify-action.ts User notification action
│   └── index.ts        Action registry and dispatcher
└── utils/
    └── interpolate.ts  Path variable interpolation
```

---

## TypeScript API

### `LifecycleGateEngine`

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');
```

**Key methods:**

```typescript
// Load (and validate) a HOOKS.yaml file
engine.loadConfig(path: string): Promise<HooksConfig>

// Hot-reload from the same path (no restart required)
engine.reloadConfig(): Promise<HooksConfig | null>

// Execute all matching hooks at a pipeline point
engine.execute(point: HookPoint, context: HookContext): Promise<HookResult[]>

// Get enabled hooks for a point (without match evaluation)
engine.getHooksForPoint(point: HookPoint): HookDefinition[]

// Build a HookContext with required fields pre-filled
LifecycleGateEngine.buildContext(point, sessionKey, overrides): HookContext
```

### Types

```typescript
// All valid hook points
type HookPoint =
  | 'turn:pre' | 'turn:post'
  | 'turn:tool:pre' | 'turn:tool:post'
  | 'subagent:spawn:pre' | 'subagent:pre' | 'subagent:post'
  | 'subagent:tool:pre' | 'subagent:tool:post'
  | 'heartbeat:pre' | 'heartbeat:post'
  | 'cron:pre' | 'cron:post';

// Context passed to every hook at runtime
interface HookContext {
  point: HookPoint;
  sessionKey: string;
  topicId?: number | string;
  prompt?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  response?: string;
  subagentLabel?: string;
  cronJob?: string;
  heartbeatMeta?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  timestamp: number;
}

// Result from a hook execution
interface HookResult {
  passed: boolean;    // false = block the pipeline
  action: HookAction;
  message?: string;
  duration: number;   // ms
}
```

All types are exported from the package root:

```typescript
import type { 
  HookPoint, 
  HookContext, 
  HookResult 
} from '@fractal-ai/plugin-lifecycle-hooks';
```

---

## Support

If this plugin has been useful to you, consider supporting its development.

---

## License

MIT © OpenClaw Contributors

See [LICENSE](./LICENSE) for full text.

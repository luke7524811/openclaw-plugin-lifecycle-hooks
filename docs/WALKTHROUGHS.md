# Walkthroughs — OpenClaw Lifecycle Hooks

> Five practical, copy-paste-ready examples covering the most common lifecycle hook use cases.

Each walkthrough includes a complete `HOOKS.yaml` config, an explanation of how it
works, any supporting scripts, and a snippet to verify it's firing correctly.

---

## Table of Contents

1. [Global `rm` Guard — Block Destructive Commands](#1-global-rm-guard--block-destructive-commands)
2. [Topic Context Auto-Logging — Summarize Turns to Topic Files](#2-topic-context-auto-logging--summarize-turns-to-topic-files)
3. [Sub-agent Context Injection — Inject Shared Context Before Spawn](#3-sub-agent-context-injection--inject-shared-context-before-spawn)
4. [Heartbeat Dashboard Push — Send State to External Dashboard](#4-heartbeat-dashboard-push--send-state-to-external-dashboard)
5. [Custom Script Action — Slack/Webhook Notification](#5-custom-script-action--slackwebhook-notification)

---

## 1. Global `rm` Guard — Block Destructive Commands

### The Problem

OpenClaw agents call the `exec` tool with arbitrary shell commands. Without a guard,
a hallucination or bad diff could issue `rm -rf /important/data` with no recovery path.
`rm` is permanent. `trash` is recoverable.

### Goal

Intercept every `exec` call (in both main agent and sub-agents) that matches a
destructive `rm` pattern and block it before it executes.

### HOOKS.yaml

```yaml
version: "1"

hooks:
  # Guard 1: Block plain rm (rm file.txt, rm -i, etc.)
  - point:
      - turn:tool:pre
      - subagent:tool:pre
    match:
      tool: exec
      commandPattern: "^rm\\s"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: |
        🚫 Blocked: `rm` is not allowed.
        Use `trash <path>` to safely move files to the trash bin.
        This policy is enforced by HOOKS.yaml (rm guard).

  # Guard 2: Block recursive/forced rm (rm -rf, rm -fr, rm -f, rm -r)
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
      message: |
        🚫 Blocked: Recursive or forced `rm` is not permitted.
        Use `trash` to move items to the trash instead.
```

### How It Works

1. The hook is registered at both `turn:tool:pre` (main agent) and `subagent:tool:pre`
   (any sub-agent) using a multi-point array.
2. The `match.tool: exec` filter ensures only `exec` tool calls are checked.
3. `commandPattern` is a JavaScript regex. The engine extracts `toolArgs.command`
   as the subject and tests the regex against it.
4. If the regex matches, the `block` action fires: it returns `passed: false` and
   the pipeline immediately halts — the `exec` tool never runs.
5. `onFailure.message` is the human-readable reason shown to the user (and logged).
6. **Telegram notification** — `onFailure.notifyUser: true` causes a fire-and-forget
   Telegram message to be sent to the session's chat (group topic, group, or DM).
   This notifies you of the block even when you're not watching the terminal. The
   notification is separate from the block message shown in the agent's reply.

**Why two hooks?** `^rm\\s` catches `rm file.txt` but not `rm\t` or `rm` with flags.
`rm\\s+-[rRfFi]` catches the most dangerous forms with flags. Both are needed for
complete coverage.

### Extending the Guard

Add more patterns to catch other destructive commands:

```yaml
hooks:
  # Block dd (disk overwriter)
  - point: [turn:tool:pre, subagent:tool:pre]
    match:
      tool: exec
      commandPattern: "^dd\\s"
    action: block
    onFailure:
      action: block
      message: "🚫 Blocked: dd is not permitted."

  # Block sudo (privilege escalation)
  - point: [turn:tool:pre, subagent:tool:pre]
    match:
      tool: exec
      commandPattern: "^sudo\\s"
    action: block
    onFailure:
      action: block
      message: "🚫 Blocked: sudo is not permitted in agent sessions."

  # Block chmod 777 (security risk)
  - point: [turn:tool:pre, subagent:tool:pre]
    match:
      tool: exec
      commandPattern: "chmod\\s+777"
    action: block
    onFailure:
      action: block
      message: "🚫 chmod 777 is a security risk. Use chmod 755 or 644."

  # Block curl-to-bash (common attack vector)
  - point: [turn:tool:pre, subagent:tool:pre]
    match:
      tool: exec
      commandPattern: "curl.*(\\||bash|sh)"
    action: block
    onFailure:
      action: block
      message: "🚫 Blocked: curl-to-shell piping is not permitted."
```

### Verify It Works

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');

const SESSION = 'agent:main:telegram:group:-100EXAMPLE:topic:42';

// ✅ Should be BLOCKED
const r1 = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: SESSION,
  toolName: 'exec',
  toolArgs: { command: 'rm /etc/passwd' },
  timestamp: Date.now(),
});
console.assert(!r1[0].passed, 'rm should be blocked');
console.log('Blocked message:', r1[0].message);

// ✅ Should be BLOCKED (recursive)
const r2 = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: SESSION,
  toolName: 'exec',
  toolArgs: { command: 'rm -rf /tmp/data' },
  timestamp: Date.now(),
});
console.assert(!r2[0].passed, 'rm -rf should be blocked');

// ✅ Should PASS (safe command)
const r3 = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: SESSION,
  toolName: 'exec',
  toolArgs: { command: 'ls /tmp' },
  timestamp: Date.now(),
});
console.assert(r3.every(r => r.passed), 'ls should pass');
console.log('✅ All rm guard tests pass.');
```

### Tips

- Use `^` anchors in `commandPattern` to avoid false positives (`grep 'rm'` shouldn't trigger).
- List guard hooks **first** in your `hooks` array — they short-circuit early.
- Enable both `turn:tool:pre` and `subagent:tool:pre` for full coverage across all
  agent contexts.
- Test your regex at [regex101.com](https://regex101.com) (JavaScript flavor).

---

## 2. Topic Context Auto-Logging — Summarize Turns to Topic Files

### The Problem

OpenClaw agent context windows compact over time. Without external memory, the agent
loses track of decisions, work in progress, and conversation history. The solution
is to hook each turn and write structured logs (and LLM summaries) to a topic-specific
file that the agent reads at the start of each session.

### Goal

- Log raw turn data (pre + post) to a JSONL audit file for each Telegram forum topic.
- Summarize completed turns using an LLM and append to the topic's `.md` memory file.

### HOOKS.yaml

```yaml
version: "1"

defaults:
  model: anthropic/claude-haiku-4-5    # Fast, cheap model for turn summarization
  onFailure:
    action: continue                   # Logging failures are non-fatal
    notifyUser: false

hooks:
  # Raw audit log — fires before and after every turn in topic 42
  - point:
      - turn:pre
      - turn:post
    match:
      topicId: 42
    action: log
    target: "/path/to/workspace/memory/topics/topic-42-raw.jsonl"
    onFailure:
      action: continue

  # LLM summary — fires after each completed turn
  - point: turn:post
    match:
      topicId: 42
    action: summarize_and_log
    model: anthropic/claude-haiku-4-5
    target: "/path/to/workspace/memory/topics/topic-42.md"
    onFailure:
      action: continue
```

### How It Works

**Raw log hook (`log` action):**

Fires at `turn:pre` (before the agent responds) and `turn:post` (after). Writes a
JSON line to the JSONL file with all available turn context:

```json
{"timestamp":"2026-02-17T21:00:00.000Z","point":"turn:post","sessionKey":"agent:main:telegram:group:-100EXAMPLE:topic:42","topicId":42,"prompt":"What is the status of Phase 12?"}
```

This gives you a machine-readable, append-only audit trail of every turn.

**Summarize hook (`summarize_and_log` action):**

Fires only at `turn:post`. Calls the LLM (Haiku for speed) to produce a human-readable
summary, then appends it to `topic-42.md`. This is the file the agent reads at the
start of each session to restore working context.

The output format:

```json
{"timestamp":"2026-02-17T21:00:00.000Z","point":"turn:post","sessionKey":"...","summary":"User asked for Phase 12 status. Agent reported docs in progress, walkthroughs being written.","model":"anthropic/claude-haiku-4-5"}
```

The agent reads `memory/topics/topic-42.md` at session start (per `AGENTS.md`
conventions), giving it immediate continuity.

### Multi-Topic Setup

To log multiple topics, add one block per topic or omit `topicId` to log all:

```yaml
hooks:
  # Log ALL topics to a global audit file (no topicId filter)
  - point:
      - turn:pre
      - turn:post
    action: log
    target: "/path/to/workspace/memory/all-turns.jsonl"
    onFailure:
      action: continue

  # Summarize high-value topics individually
  - point: turn:post
    match:
      topicId: 42
    action: summarize_and_log
    target: "/path/to/workspace/memory/topics/topic-42.md"

  - point: turn:post
    match:
      topicId: 42
    action: summarize_and_log
    target: "/path/to/workspace/memory/topics/topic-42.md"

  - point: turn:post
    match:
      topicId: 200
    action: summarize_and_log
    model: anthropic/claude-opus-4-6  # Premium model for high-value topic
    target: "/path/to/workspace/memory/topics/topic-200.md"
```

### Verify It Works

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';
import * as fs from 'fs/promises';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');

// Simulate a completed turn in topic 42
const results = await engine.execute('turn:post', {
  point: 'turn:post',
  sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
  topicId: 42,
  prompt: 'What is the current status of Phase 12?',
  response: 'Phase 12 is in progress. Walkthroughs are being written.',
  timestamp: Date.now(),
});

// Logging hooks always pass
console.assert(results.every(r => r.passed), 'Logging should not block');
console.log(`Fired ${results.length} hook(s). Actions: ${results.map(r => r.action).join(', ')}`);

// Check the JSONL file was written
const raw = await fs.readFile('./memory/topics/topic-42-raw.jsonl', 'utf-8');
const lastLine = raw.trim().split('\n').at(-1);
const entry = JSON.parse(lastLine!);
console.assert(entry.point === 'turn:post', 'Entry point should be turn:post');
console.assert(entry.topicId === 42, 'Topic ID should be 42');
console.log('✅ Raw log entry:', entry);
```

### Tips

- Keep `action: log` (JSONL) as the raw audit trail — machine-readable and fast.
- Keep `action: summarize_and_log` as the human/agent-readable `.md` file.
- Use Haiku (`anthropic/claude-haiku-4-5`) for speed and cost on per-turn summarization.
  Upgrade to Opus for richer summaries on high-value topics.
- The agent reads `memory/topics/topic-{N}.md` at session start — make sure the
  `summarize_and_log` hook writes there consistently.
- Both hooks are `onFailure: continue` — logging failures must never block conversation.

---

## 3. Sub-agent Context Injection — Inject Shared Context Before Spawn

### The Problem

When OpenClaw spawns a sub-agent, it starts with a fresh context window. Unless
explicitly provided, the sub-agent doesn't know:

- Workspace conventions (from `AGENTS.md`, `SOUL.md`)
- Current project state
- Recent decisions made in the parent session
- Which tools are available and how to use them

Without this, sub-agents hallucinate, ignore workspace conventions, or duplicate
work already done.

### Goal

Automatically inject shared context files into sub-agents at spawn time, so every
sub-agent starts with the same foundation as the main agent.

### HOOKS.yaml

```yaml
version: "1"

defaults:
  onFailure:
    action: continue   # Context injection failures must not block spawning

hooks:
  # Inject workspace conventions into every sub-agent
  - point: subagent:spawn:pre
    action: inject_context
    target: "/path/to/workspace/AGENTS.md"
    onFailure:
      action: continue

  # Inject today's memory log
  - point: subagent:spawn:pre
    action: inject_context
    target: "/path/to/workspace/memory/2026-02-17.md"
    onFailure:
      action: continue

  # Log every sub-agent spawn for audit
  - point: subagent:spawn:pre
    action: log
    target: "/path/to/workspace/memory/subagent-spawns.jsonl"
    onFailure:
      action: continue

  # Summarize sub-agent results after completion
  - point: subagent:post
    action: summarize_and_log
    model: anthropic/claude-haiku-4-5
    target: "/path/to/workspace/memory/subagent-results.jsonl"
    onFailure:
      action: continue
```

### How It Works

**`inject_context` at `subagent:spawn:pre`:**

This fires in the **main agent** session, before the sub-agent process starts.
The action reads the file at `target` and prepends its content to the sub-agent's
context window as a system message prefix.

The sub-agent receives the injected content before its task description — it has
immediate access to workspace conventions without needing to read files itself.

**Spawn audit log:**

The `log` hook at `subagent:spawn:pre` records each spawn event:

```json
{"timestamp":"2026-02-17T21:00:00.000Z","point":"subagent:spawn:pre","sessionKey":"agent:main:subagent:63e06a06","subagent":"phase-12-docs"}
```

**Result summary:**

The `summarize_and_log` hook at `subagent:post` fires after the sub-agent completes.
It appends a summary of what the sub-agent accomplished to `subagent-results.jsonl`.

### Selective Injection by Sub-agent Label

Inject different context files based on what the sub-agent is working on:

```yaml
hooks:
  # Inject general conventions into all sub-agents
  - point: subagent:spawn:pre
    action: inject_context
    target: "/path/to/workspace/AGENTS.md"

  # Inject budget context only for budget-related sub-agents
  - point: subagent:spawn:pre
    match:
      sessionPattern: "budget"
    action: inject_context
    target: "/path/to/workspace/skills/budget-management/SKILL.md"

  # Inject project context only for lifecycle-hooks sub-agents
  - point: subagent:spawn:pre
    match:
      sessionPattern: "lifecycle-hooks"
    action: inject_context
    target: "/path/to/workspace/projects/openclaw-plugin-lifecycle-hooks/README.md"

  # Inject current project plan for planning sub-agents
  - point: subagent:spawn:pre
    match:
      sessionPattern: "planner-"
    action: inject_context
    target: "/path/to/workspace/framework/plans/active/current-plan.md"
```

`sessionPattern` is a regex matched against the full session key
(e.g. `agent:main:subagent:phase-12-docs`). Use the sub-agent label as the pattern.

### Apply Rules Inside the Sub-agent

Use `subagent:pre` (fires inside the sub-agent session) to apply rules after it starts:

```yaml
hooks:
  # Apply safety rules inside all sub-agents
  - point: subagent:pre
    match:
      isSubAgent: true
    action: inject_context
    target: "/path/to/workspace/memory/safety-reminder.md"
```

Note: `subagent:pre` fires in the sub-agent's own session, not the parent session.
Use `isSubAgent: true` to make this explicit.

### Verify It Works

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');

// Simulate sub-agent spawn
const results = await engine.execute('subagent:spawn:pre', {
  point: 'subagent:spawn:pre',
  sessionKey: 'agent:main:subagent:63e06a06-phase-12-docs',
  subagentLabel: 'phase-12-docs',
  timestamp: Date.now(),
});

// inject_context always passes
console.assert(results.every(r => r.passed), 'Injection should not block');

const injectResults = results.filter(r => r.action === 'inject_context');
console.log(`Injected ${injectResults.length} context file(s).`);
injectResults.forEach(r => console.log(' -', r.message));

const logResults = results.filter(r => r.action === 'log');
console.log(`Logged ${logResults.length} spawn event(s).`);

console.log('✅ Sub-agent context injection working.');
```

### Tips

- Keep injected files **small** — they consume the sub-agent's context budget.
- Chain multiple `inject_context` hooks to layer context (conventions → project state → task).
- Use `enabled: false` to toggle injections without removing the hook definition.
- The injection order matters: hooks fire in array order, so put foundational context first.
- Always set `onFailure: { action: continue }` — a missing context file should never
  block a sub-agent spawn.

---

## 4. Heartbeat Dashboard Push — Send State to External Dashboard

### The Problem

When an OpenClaw agent is running a long-lived session (e.g. a multi-hour automated
pipeline), you want to monitor its progress without checking in manually. The agent
emits heartbeat events periodically — hook them to push state to an external
dashboard or monitoring endpoint.

### Goal

After each heartbeat, run a shell script that collects agent state (uptime, last action,
error count) and pushes it to a dashboard API endpoint via HTTP.

### Supporting Script

Create the push script in your workspace:

```bash
# hooks/push-dashboard.sh
#!/usr/bin/env bash
set -euo pipefail

# Configuration — set these in your environment or hardcode for local use
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000/api/agent-status}"
AGENT_ID="${OPENCLAW_AGENT_ID:-$(hostname)}"

# Collect state from context env vars
SESSION="$HOOK_SESSION"
TIMESTAMP="$HOOK_TIMESTAMP"

# Read some local state (example: count lines in today's log)
LOG_FILE="/path/to/workspace/memory/$(date +%Y-%m-%d).md"
LOG_LINES=0
if [ -f "$LOG_FILE" ]; then
  LOG_LINES=$(wc -l < "$LOG_FILE")
fi

# Count recent errors from audit log
AUDIT_LOG="/path/to/workspace/memory/audit.jsonl"
ERROR_COUNT=0
if [ -f "$AUDIT_LOG" ]; then
  # Count log entries from the last 5 minutes
  FIVE_MIN_AGO=$(( $(date +%s%3N) - 300000 ))
  ERROR_COUNT=$(python3 -c "
import sys, json
count = 0
try:
  for line in open('$AUDIT_LOG'):
    d = json.loads(line.strip())
    if d.get('timestamp', 0) > $FIVE_MIN_AGO:
      count += 1
except: pass
print(count)
" 2>/dev/null || echo 0)
fi

# Build the payload
PAYLOAD=$(python3 -c "
import json, sys
payload = {
  'agentId': '$AGENT_ID',
  'sessionKey': '$SESSION',
  'timestampMs': $TIMESTAMP,
  'logLines': $LOG_LINES,
  'recentEntries': $ERROR_COUNT,
  'status': 'alive',
  'hookPoint': '$HOOK_POINT',
}
print(json.dumps(payload))
")

# Push to dashboard
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$DASHBOARD_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${DASHBOARD_TOKEN:-}" \
  -d "$PAYLOAD" \
  --max-time 10)

if [ "$HTTP_STATUS" -ge 200 ] && [ "$HTTP_STATUS" -lt 300 ]; then
  echo "Dashboard push OK (HTTP $HTTP_STATUS)"
  exit 0
else
  echo "Dashboard push failed: HTTP $HTTP_STATUS" >&2
  exit 1
fi
```

Make it executable:

```bash
chmod +x /path/to/workspace/hooks/push-dashboard.sh
```

### HOOKS.yaml

```yaml
version: "1"

defaults:
  onFailure:
    action: continue   # Heartbeat hooks must never block the agent

hooks:
  # Push state to dashboard after each heartbeat
  - point: heartbeat:post
    action: exec_script
    target: "/path/to/workspace/hooks/push-dashboard.sh"
    onFailure:
      action: retry        # Retry on transient network failure
      retries: 3           # Up to 3 attempts (100ms → 200ms → 400ms backoff)
      notifyUser: false    # Silent — don't surface heartbeat failures to user
      message: "Dashboard push failed after 3 retries."

  # Log heartbeat events locally (always)
  - point:
      - heartbeat:pre
      - heartbeat:post
    action: log
    target: "/path/to/workspace/memory/heartbeat-log.jsonl"
    onFailure:
      action: continue
```

### How It Works

1. OpenClaw emits `heartbeat:post` after each heartbeat cycle.
2. The engine fires the `exec_script` action, running `push-dashboard.sh`.
3. The script collects local state (log file line count, recent entries, etc.)
   and posts a JSON payload to the configured `DASHBOARD_URL`.
4. On HTTP 2xx → exit 0 → `passed: true` → heartbeat continues normally.
5. On failure → exit 1 → `passed: false` → `onFailure: retry` kicks in with
   exponential backoff (100ms, 200ms, 400ms). After 3 retries, falls through
   to `continue` (non-blocking).

The `heartbeat:pre` `log` hook writes a JSONL entry before each heartbeat cycle,
giving you a timestamp-based record of heartbeat activity.

### Environment Variables Available in the Script

The script receives all standard hook env vars plus your own process environment:

```bash
HOOK_POINT       # "heartbeat:post"
HOOK_SESSION     # Full session key
HOOK_TIMESTAMP   # Unix ms timestamp
HOOK_SUBAGENT    # "false" (heartbeat is main agent)
# Your own env vars:
DASHBOARD_URL    # Set via export or .env file
DASHBOARD_TOKEN  # Auth token
```

Set your dashboard config before starting the agent:

```bash
export DASHBOARD_URL="https://my-dashboard.example.com/api/agent-status"
export DASHBOARD_TOKEN="my-secret-token"
openclaw start
```

### Simple Dashboard Server (for local testing)

```python
#!/usr/bin/env python3
# dashboard-server.py — minimal status dashboard
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

LATEST = {}

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            LATEST.update(json.loads(body))
            print(f"[dashboard] Status update: {json.dumps(LATEST, indent=2)}")
            self.send_response(200)
        except Exception as e:
            print(f"[dashboard] Error: {e}")
            self.send_response(400)
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(LATEST).encode())

    def log_message(self, *args): pass  # Silence access log

print("Dashboard listening on http://localhost:3000")
HTTPServer(('', 3000), Handler).serve_forever()
```

```bash
python3 dashboard-server.py &
# Then start your agent with DASHBOARD_URL=http://localhost:3000/api/agent-status
```

### Verify It Works

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');

// Simulate a heartbeat:post event
const results = await engine.execute('heartbeat:post', {
  point: 'heartbeat:post',
  sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
  heartbeatMeta: { cycle: 5, elapsedMs: 300000 },
  timestamp: Date.now(),
});

// Check results
results.forEach(r => {
  console.log(`[${r.action}] passed=${r.passed} duration=${r.duration}ms`);
  if (r.message) console.log(`  message: ${r.message}`);
});
```

### Tips

- Set `onFailure: { action: retry, retries: 3 }` for transient network issues.
- Never set `onFailure: { action: block }` for heartbeat hooks — a dashboard push
  failure should never block the agent.
- Use `heartbeat:pre` to snapshot state *before* the heartbeat runs, then
  `heartbeat:post` to push the result *after* — this way your dashboard shows
  post-heartbeat state.
- Keep the push script under 10 seconds to avoid timeout (30s hard limit).

---

## 5. Custom Script Action — Slack/Webhook Notification

### The Problem

You want to send a Slack message (or any webhook notification) when significant
agent events occur: a sub-agent completes, a blocked command is attempted, or a
cron job finishes. None of the built-in actions (log, block, inject, summarize)
send external notifications — that's exactly what `exec_script` is for.

### Goal

Run a bash script that POSTs to a Slack incoming webhook whenever a sub-agent
completes. The notification includes the sub-agent's label, session key, and
a brief status message.

### Supporting Script

```bash
# hooks/notify-slack.sh
#!/usr/bin/env bash
set -euo pipefail

# Required: set SLACK_WEBHOOK_URL in your environment
if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
  echo "SLACK_WEBHOOK_URL not set — skipping notification." >&2
  exit 0   # Soft skip: don't block if Slack isn't configured
fi

# Build the notification text from hook env vars
SUBAGENT_LABEL="${HOOK_SUBAGENT_LABEL:-unknown}"
SESSION="${HOOK_SESSION}"
POINT="${HOOK_POINT}"
TIMESTAMP_SEC=$(( HOOK_TIMESTAMP / 1000 ))
HUMAN_TIME=$(date -d "@${TIMESTAMP_SEC}" '+%Y-%m-%d %H:%M UTC' 2>/dev/null || date -r "${TIMESTAMP_SEC}" '+%Y-%m-%d %H:%M UTC' 2>/dev/null || echo "unknown time")

# Customize the message per hook point
case "$POINT" in
  subagent:post)
    EMOJI="✅"
    EVENT="Sub-agent *${SUBAGENT_LABEL}* completed"
    ;;
  subagent:spawn:pre)
    EMOJI="🚀"
    EVENT="Sub-agent *${SUBAGENT_LABEL}* spawning"
    ;;
  cron:post)
    EMOJI="🕐"
    EVENT="Cron job *${HOOK_CRON_JOB:-unknown}* completed"
    ;;
  *)
    EMOJI="ℹ️"
    EVENT="Hook fired at \`${POINT}\`"
    ;;
esac

# Build JSON payload for Slack
PAYLOAD=$(python3 -c "
import json
text = '$EMOJI $EVENT\n*Session:* \`$SESSION\`\n*Time:* $HUMAN_TIME'
print(json.dumps({'text': text}))
")

# Send to Slack
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$SLACK_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 10)

if [ "$HTTP_STATUS" -eq 200 ]; then
  echo "Slack notification sent (HTTP $HTTP_STATUS)"
  exit 0
else
  echo "Slack notification failed: HTTP $HTTP_STATUS" >&2
  exit 1
fi
```

```bash
chmod +x /path/to/workspace/hooks/notify-slack.sh
```

### HOOKS.yaml

```yaml
version: "1"

defaults:
  onFailure:
    action: continue   # Notification failures must never block the agent

hooks:
  # Notify Slack when a sub-agent completes
  - point: subagent:post
    action: exec_script
    target: "/path/to/workspace/hooks/notify-slack.sh"
    onFailure:
      action: retry        # Retry on transient Slack API issues
      retries: 2
      notifyUser: false
      message: "Slack notification failed."

  # Notify Slack when a sub-agent spawns
  - point: subagent:spawn:pre
    action: exec_script
    target: "/path/to/workspace/hooks/notify-slack.sh"
    onFailure:
      action: continue     # Non-critical — skip silently on failure

  # Notify Slack after cron jobs
  - point: cron:post
    action: exec_script
    target: "/path/to/workspace/hooks/notify-slack.sh"
    onFailure:
      action: continue
```

### Set Up Your Slack Webhook

1. Go to your Slack workspace → **Apps → Incoming Webhooks → Add new webhook**
2. Select the channel to post to → copy the webhook URL
3. Set it in your environment before starting the agent:

```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T.../B.../xxx"
openclaw start
```

Or add it to your `.env` file / secrets manager.

### Generic Webhook Version

To use any HTTP webhook instead of Slack (Discord, Telegram Bot API, PagerDuty, etc.):

```bash
# hooks/notify-webhook.sh
#!/usr/bin/env bash
set -euo pipefail

WEBHOOK_URL="${WEBHOOK_URL:-}"
if [ -z "$WEBHOOK_URL" ]; then
  echo "WEBHOOK_URL not set — skipping." >&2
  exit 0
fi

# Build a generic JSON payload with all available context
PAYLOAD=$(python3 -c "
import json, os
payload = {
  'hookPoint': os.environ.get('HOOK_POINT', ''),
  'sessionKey': os.environ.get('HOOK_SESSION', ''),
  'tool': os.environ.get('HOOK_TOOL', ''),
  'topicId': os.environ.get('HOOK_TOPIC', ''),
  'isSubAgent': os.environ.get('HOOK_SUBAGENT', 'false') == 'true',
  'subagentLabel': os.environ.get('HOOK_SUBAGENT_LABEL', ''),
  'cronJob': os.environ.get('HOOK_CRON_JOB', ''),
  'timestampMs': int(os.environ.get('HOOK_TIMESTAMP', '0') or '0'),
}
print(json.dumps(payload))
")

curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 15 \
  -o /dev/null \
  -w "%{http_code}" | grep -q "^2" && exit 0 || exit 1
```

**HOOKS.yaml for generic webhook:**

```yaml
version: "1"

hooks:
  # Notify on any blocked command attempt
  - point:
      - turn:tool:pre
      - subagent:tool:pre
    match:
      tool: exec
      commandPattern: "^rm\\s"
    action: exec_script
    target: "/path/to/workspace/hooks/notify-webhook.sh"
    onFailure:
      action: block          # Block AND notify — webhook failure doesn't skip the block
      notifyUser: true
      message: "🚫 rm blocked. Webhook notification attempted."

  # Note: add a separate block hook BEFORE this one if you want to ALSO block
  # rm in addition to notifying. Or handle blocking inside the webhook script itself.
```

### Notify + Block Pattern

To **both** block a command **and** send a notification, use two hooks: one to notify,
one to block. Order matters — the first `passed: false` short-circuits the chain.
Put the notification first (it logs but passes), then block:

```yaml
hooks:
  # 1. Notify (exec_script that always exits 0 = passes, then reports to Slack)
  - point: [turn:tool:pre, subagent:tool:pre]
    match:
      tool: exec
      commandPattern: "^rm\\s"
    action: exec_script
    target: "/path/to/workspace/hooks/notify-rm-blocked.sh"
    onFailure:
      action: continue    # If Slack fails, still run the block below

  # 2. Block (always blocks, runs after notification)
  - point: [turn:tool:pre, subagent:tool:pre]
    match:
      tool: exec
      commandPattern: "^rm\\s"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: "🚫 rm blocked. Use `trash` instead."
```

### Verify It Works

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');

// Simulate sub-agent completion
process.env['SLACK_WEBHOOK_URL'] = 'https://hooks.slack.com/services/...';

const results = await engine.execute('subagent:post', {
  point: 'subagent:post',
  sessionKey: 'agent:main:subagent:63e06a06-phase-12-docs',
  subagentLabel: 'phase-12-docs',
  timestamp: Date.now(),
});

results.forEach(r => {
  console.log(`[${r.action}] passed=${r.passed} duration=${r.duration}ms`);
  console.log(`  ${r.message}`);
});
// → [exec_script] passed=true duration=342ms
// →   Slack notification sent (HTTP 200)
```

### Tips

- Always exit 0 from notification scripts unless you intentionally want to block
  the pipeline on notification failure (usually you don't).
- Use `onFailure: { action: continue }` for non-critical notifications.
- Use `onFailure: { action: retry, retries: 2 }` for important notifications
  (e.g. "critical system alert") that need retry on transient HTTP failures.
- Scripts inherit your full process environment — set `SLACK_WEBHOOK_URL` via
  `export` before starting the agent, or use a `.env` loader.
- Test scripts directly before adding to HOOKS.yaml:
  ```bash
  HOOK_POINT=subagent:post \
  HOOK_SESSION=agent:main:subagent:test \
  HOOK_SUBAGENT_LABEL=test-agent \
  HOOK_TIMESTAMP=$(date +%s%3N) \
  HOOK_SUBAGENT=true \
  HOOK_TOOL="" \
  HOOK_ARGS="{}" \
  HOOK_TOPIC="" \
  HOOK_CRON_JOB="" \
  HOOK_PROMPT="" \
  SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..." \
  ./hooks/notify-slack.sh
  ```

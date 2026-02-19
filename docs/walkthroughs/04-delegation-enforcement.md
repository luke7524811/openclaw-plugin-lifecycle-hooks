# Walkthrough 4: Delegation Enforcement

Ensure that the main agent delegates long-running or complex `exec` operations to
sub-agents rather than running them inline. This keeps the main agent responsive
and prevents context window exhaustion.

---

## The Problem

The main OpenClaw agent (the one talking to the user) should stay lean and responsive.
When it runs heavy `exec` operations directly — building large projects, running tests,
installing packages — it:

- Consumes its context window with noisy output
- Blocks the user conversation
- Risks timeout or compaction mid-task

The policy: **heavy exec operations must be delegated to sub-agents**.

---

## Enforcement Strategy

We hook `turn:tool:pre` for `exec` calls **in the main agent only** (`isSubAgent: false`).
If the command looks like a heavy operation, we block it with instructions to delegate.

Sub-agents (`isSubAgent: true`) are allowed to run exec freely.

---

## HOOKS.yaml Config

```yaml
version: "1"

defaults:
  onFailure:
    action: continue

hooks:
  # Block heavy package installs in main agent — must delegate
  - point: turn:tool:pre
    match:
      tool: exec
      isSubAgent: false
      commandPattern: "npm (install|ci|run build|test)"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: |
        🚫 Delegation required: `npm install/build/test` must be run via a sub-agent.
        Spawn a sub-agent with this task. Main agent stays responsive.

  # Block long-running compilation in main agent
  - point: turn:tool:pre
    match:
      tool: exec
      isSubAgent: false
      commandPattern: "(tsc|webpack|rollup|vite build|cargo build|make)"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: |
        🚫 Delegation required: compilation commands must run in a sub-agent.
        Use the subagent spawner to handle this task.

  # Log when sub-agents run exec (audit, non-blocking)
  - point: subagent:tool:pre
    match:
      tool: exec
    action: log
    target: "/path/to/workspace/memory/subagent-exec-log.jsonl"
    onFailure:
      action: continue

  # Allow everything in sub-agents (no block hooks for isSubAgent: true)
  # Sub-agents are the designated execution environment.
```

---

## How `isSubAgent` Matching Works

The engine checks whether `:subagent:` appears in the session key:

- `agent:main:telegram:group:-100:topic:42` → `isSubAgent: false`
- `agent:main:subagent:abc123` → `isSubAgent: true`

This means:
- Main agent exec calls → checked against delegation rules
- Sub-agent exec calls → pass through (or logged only)

---

## More Granular Patterns

You can tune the patterns to your workflow:

```yaml
hooks:
  # Block any exec command over ~30 seconds (heuristic: grep for known-slow patterns)
  - point: turn:tool:pre
    match:
      tool: exec
      isSubAgent: false
      commandPattern: "(git clone|docker build|pip install|apt-get install)"
    action: block
    onFailure:
      action: block
      message: "🚫 Slow operation — please delegate to a sub-agent."

  # Warn (but don't block) on potentially slow operations
  - point: turn:tool:pre
    match:
      tool: exec
      isSubAgent: false
      commandPattern: "(find / |du -sh|rsync)"
    action: log
    target: "/path/to/workspace/memory/slow-exec-warnings.jsonl"
    onFailure:
      action: continue
```

---

## Testing Delegation Enforcement

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');

// Main agent trying to run npm install — should be BLOCKED
const mainResult = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42', // no :subagent:
  toolName: 'exec',
  toolArgs: { command: 'npm install' },
  timestamp: Date.now(),
});

console.log(mainResult[0].passed);   // false
console.log(mainResult[0].message);  // 🚫 Delegation required...

// Sub-agent running npm install — should PASS
const subResult = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: 'agent:main:subagent:abc123', // has :subagent:
  toolName: 'exec',
  toolArgs: { command: 'npm install' },
  timestamp: Date.now(),
});

// No delegation hooks fire for sub-agents
console.log(subResult.length === 0 || subResult.every(r => r.passed)); // true
```

---

## Tips

- Be explicit: tell the agent in `AGENTS.md` which operations require delegation.
- Don't over-block — main agent should still be able to run quick commands (`ls`, `cat`, `echo`).
- Use the exec log at `subagent:tool:pre` to audit what sub-agents actually ran.
- Consider adding a `summarize_and_log` hook at `subagent:post` to capture sub-agent results.

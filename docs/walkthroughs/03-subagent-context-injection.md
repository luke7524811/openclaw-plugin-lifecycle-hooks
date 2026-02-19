# Walkthrough 3: Sub-agent Context Injection

Automatically inject shared context files into every sub-agent session before it starts.
Ensures sub-agents have access to the same workspace conventions, memory, and state
as the main agent.

---

## The Problem

When OpenClaw spawns a sub-agent, it starts with its own context window. Unless explicitly
provided, the sub-agent doesn't know:

- The current project state
- Workspace conventions (SOUL.md, USER.md, AGENTS.md)
- Recent decisions made in the parent session

The sub-agent can hallucinate, ignore conventions, or duplicate work already done.

The solution: hook `subagent:spawn:pre` and inject key context files before the
sub-agent starts executing.

---

## HOOKS.yaml Config

```yaml
version: "1"

defaults:
  onFailure:
    action: continue

hooks:
  # Inject AGENTS.md into every sub-agent before it starts
  - point: subagent:spawn:pre
    action: inject_context
    target: "/path/to/workspace/AGENTS.md"
    onFailure:
      action: continue

  # Inject daily memory log
  - point: subagent:spawn:pre
    action: inject_context
    target: "/path/to/workspace/memory/2026-02-17.md"
    onFailure:
      action: continue

  # Log all sub-agent spawns for audit
  - point: subagent:spawn:pre
    action: log
    target: "/path/to/workspace/memory/subagent-spawns.jsonl"
    onFailure:
      action: continue

  # Summarize what each sub-agent was asked to do
  - point: subagent:post
    action: summarize_and_log
    model: anthropic/claude-haiku-4-5
    target: "/path/to/workspace/memory/subagent-results.jsonl"
    onFailure:
      action: continue
```

---

## How `inject_context` Works

The `inject_context` action:

1. Reads the file at `hook.target`
2. Prepends its content to the sub-agent's context window (as a system message prefix)
3. Returns `passed: true` — it never blocks

The injected content appears before the sub-agent's task description, giving it
immediate access to the workspace conventions.

---

## Selective Injection by Session

You can inject different context based on the sub-agent's session pattern:

```yaml
hooks:
  # Inject general conventions into all sub-agents
  - point: subagent:spawn:pre
    action: inject_context
    target: "/path/to/workspace/AGENTS.md"

  # Inject project-specific context only for hooks-related sub-agents
  - point: subagent:spawn:pre
    match:
      sessionPattern: "hooks-"
    action: inject_context
    target: "/path/to/workspace/projects/openclaw-plugin-lifecycle-hooks/README.md"

  # Inject budget context only for budget-related sub-agents
  - point: subagent:spawn:pre
    match:
      sessionPattern: "budget-"
    action: inject_context
    target: "/path/to/workspace/skills/budget-management/SKILL.md"
```

---

## Sub-agent Audit Log

The combination of `log` at `spawn:pre` and `summarize_and_log` at `subagent:post`
gives you a complete audit trail:

**Spawn log entry** (`subagent-spawns.jsonl`):
```json
{"timestamp":"2026-02-17T21:00:00.000Z","point":"subagent:spawn:pre","sessionKey":"agent:main:subagent:abc123","subagent":"hooks-final-phases"}
```

**Result summary** (`subagent-results.jsonl`):
```json
{"timestamp":"2026-02-17T22:00:00.000Z","summary":"Sub-agent hooks-final-phases completed Phases 12-15. All tests pass. Build output verified."}
```

---

## Testing Context Injection

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');

// Simulate a sub-agent spawn
const results = await engine.execute('subagent:spawn:pre', {
  point: 'subagent:spawn:pre',
  sessionKey: 'agent:main:subagent:abc123',
  subagentLabel: 'hooks-final-phases',
  timestamp: Date.now(),
});

// inject_context always passes
console.log(results.every(r => r.passed)); // true
console.log(results[0].action);            // 'inject_context'
console.log(results[0].message);           // 'Injected context from AGENTS.md'
```

---

## Tips

- Keep injected files small — they consume sub-agent context budget.
- Use `enabled: false` to toggle injections without deleting the hook definition.
- Chain multiple injection hooks to layer context (conventions → project state → task).
- Use `subagent:post` logging to verify sub-agents completed their tasks correctly.

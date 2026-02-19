# Walkthrough 1: rm Guard — Block Destructive Commands

Prevent the agent from running `rm` commands. Enforce the use of `trash` instead.

---

## The Problem

OpenClaw agents can call the `exec` tool with arbitrary shell commands. Without guardrails,
a bug or hallucination could issue `rm -rf /important/data` with no recovery path.

The rm guard hooks intercept `exec` calls before they execute and block any command
that matches destructive patterns.

---

## HOOKS.yaml Config

```yaml
version: "1"

hooks:
  # Block plain rm (rm file.txt, rm -i file.txt, etc.)
  - point: turn:tool:pre
    match:
      tool: exec
      commandPattern: "^rm\\s"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: |
        🚫 Blocked: `rm` is not allowed.
        Use `trash <path>` to safely move files to trash.
        This policy is enforced by HOOKS.yaml (rm guard).

  # Block recursive/forced rm (rm -rf, rm -fr, rm -r, rm -f)
  - point:
      - turn:tool:pre
      - subagent:tool:pre
    match:
      tool: exec
      commandPattern: "rm\\s+-[rRfF]"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: |
        🚫 Blocked: Recursive or forced `rm` is not permitted.
        This is a safety policy defined in HOOKS.yaml.
```

---

## How It Works

1. **Hook point** `turn:tool:pre` fires before the `exec` tool runs.
2. The **match filter** checks:
   - `tool: exec` — only intercepts exec calls
   - `commandPattern: "^rm\\s"` — regex matched against `toolArgs.command`
3. The **block action** returns `passed: false`, which halts the pipeline.
4. The agent receives the `onFailure.message` and should report it to the user.
5. **Telegram notification** — when `onFailure.notifyUser: true`, the block message
   is also sent as a separate fire-and-forget Telegram message to the session's chat
   (group topic, group, or DM). This ensures you're notified even if you're away from
   the terminal.

The second hook covers both main agent (`turn:tool:pre`) and sub-agent
(`subagent:tool:pre`) levels using a multi-point array.

---

## Testing the Guard

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');

// Should be BLOCKED
const blocked = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: 'agent:main:test',
  toolName: 'exec',
  toolArgs: { command: 'rm /tmp/important.txt' },
  timestamp: Date.now(),
});

console.log(blocked[0].passed);   // false
console.log(blocked[0].message);  // 🚫 Blocked: `rm` is not allowed...

// Should PASS (ls is fine)
const passed = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: 'agent:main:test',
  toolName: 'exec',
  toolArgs: { command: 'ls /tmp' },
  timestamp: Date.now(),
});

console.log(passed.every(r => r.passed)); // true (no hooks fired or all passed)
```

---

## Extending the Guard

Add more patterns to catch additional destructive commands:

```yaml
hooks:
  # Block dd (disk destroyer)
  - point: turn:tool:pre
    match:
      tool: exec
      commandPattern: "^dd\\s"
    action: block
    onFailure:
      action: block
      message: "🚫 Blocked: dd is not permitted."

  # Block chmod 777 (security risk)
  - point: turn:tool:pre
    match:
      tool: exec
      commandPattern: "chmod\\s+777"
    action: block
    onFailure:
      action: block
      message: "🚫 Blocked: chmod 777 is a security risk."

  # Block sudo (privilege escalation)
  - point: turn:tool:pre
    match:
      tool: exec
      commandPattern: "^sudo\\s"
    action: block
    onFailure:
      action: block
      message: "🚫 Blocked: sudo is not permitted in agent sessions."
```

---

## Tips

- Use `commandPattern` with anchors (`^`) to avoid false positives (e.g. `grep rm` should not trigger).
- List the rm guard hook **before** other exec hooks so it short-circuits early.
- Enable the guard at **both** `turn:tool:pre` and `subagent:tool:pre` for full coverage.
- Test your regex patterns at [regex101.com](https://regex101.com) before deploying.

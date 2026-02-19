# Walkthrough 5: exec_script Action — Run Shell Scripts as Hooks

Use the `exec_script` action to run custom shell scripts as hook gates.
The script receives full hook context via environment variables and controls
the pipeline via its exit code.

---

## When to Use exec_script

Use `exec_script` when:
- You need logic too complex for simple regex patterns
- You want to call external APIs, check file states, or query system resources
- You prefer writing hooks in bash/Python rather than TypeScript
- You need to integrate with existing shell-based validation tooling

---

## How It Works

1. The hook fires at the configured point
2. The engine runs your script via `execFile`
3. Hook context is passed as environment variables
4. **Exit code 0** → `passed: true` (pipeline continues)
5. **Exit code ≠ 0** → `passed: false` (pipeline blocked; stderr included in message)

The script has 30 seconds to run (configurable via the engine defaults).

---

## Environment Variables Available

| Variable | Content |
|----------|---------|
| `HOOK_POINT` | Hook point name (e.g. `turn:tool:pre`) |
| `HOOK_SESSION` | Full session key |
| `HOOK_TOOL` | Tool name (e.g. `exec`, `Read`) |
| `HOOK_ARGS` | JSON-encoded tool arguments |
| `HOOK_TOPIC` | Forum topic ID (if applicable) |
| `HOOK_TIMESTAMP` | Unix timestamp in milliseconds |
| `HOOK_SUBAGENT` | `"true"` or `"false"` |
| `HOOK_SUBAGENT_LABEL` | Sub-agent label (if in a sub-agent) |
| `HOOK_CRON_JOB` | Cron job name (for cron hooks) |
| `HOOK_PROMPT` | User prompt (for turn-level hooks) |

---

## Basic Example: Check Disk Space

Before allowing a large `exec` operation, verify there's enough disk space.

**`hooks/check-disk-space.sh`:**
```bash
#!/usr/bin/env bash
set -euo pipefail

# Require at least 1GB free on /root
REQUIRED_KB=1048576  # 1 GB
AVAILABLE_KB=$(df /root --output=avail | tail -1)

if [ "$AVAILABLE_KB" -lt "$REQUIRED_KB" ]; then
  echo "Insufficient disk space: ${AVAILABLE_KB}KB available, ${REQUIRED_KB}KB required." >&2
  exit 1
fi

echo "Disk space OK: ${AVAILABLE_KB}KB available."
exit 0
```

```bash
chmod +x hooks/check-disk-space.sh
```

**HOOKS.yaml:**
```yaml
version: "1"

hooks:
  - point: turn:tool:pre
    match:
      tool: exec
    action: exec_script
    target: "/path/to/workspace/hooks/check-disk-space.sh"
    onFailure:
      action: block
      message: "🚫 Not enough disk space to proceed."
```

---

## Advanced Example: Validate File Paths

Before allowing writes, verify the target path is inside the workspace
(prevent writes outside the sandbox).

**`hooks/validate-write-path.sh`:**
```bash
#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="/path/to/workspace"

# Parse the path from HOOK_ARGS JSON
TARGET_PATH=$(echo "$HOOK_ARGS" | python3 -c "
import sys, json
args = json.load(sys.stdin)
print(args.get('path') or args.get('file_path') or '')
")

if [ -z "$TARGET_PATH" ]; then
  # No path in args — nothing to validate
  exit 0
fi

# Resolve to absolute path
RESOLVED=$(realpath -m "$TARGET_PATH")

# Check it's within the workspace
if [[ "$RESOLVED" != "$WORKSPACE"* ]]; then
  echo "Write outside workspace blocked: $RESOLVED" >&2
  exit 1
fi

echo "Write path validated: $RESOLVED"
exit 0
```

**HOOKS.yaml:**
```yaml
version: "1"

hooks:
  - point:
      - turn:tool:pre
      - subagent:tool:pre
    match:
      tool: Write
    action: exec_script
    target: "/path/to/workspace/hooks/validate-write-path.sh"
    onFailure:
      action: block
      message: "🚫 Write outside workspace is not permitted."
```

---

## Python Example: Rate Limiter

Limit the agent to 10 exec calls per minute using a simple file-based counter.

**`hooks/rate-limit-exec.py`:**
```python
#!/usr/bin/env python3
import sys
import os
import json
import time

COUNTER_FILE = "/tmp/openclaw-exec-count.json"
MAX_CALLS = 10
WINDOW_SECONDS = 60

now = time.time()

try:
    with open(COUNTER_FILE) as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    data = {"window_start": now, "count": 0}

# Reset window if expired
if now - data["window_start"] > WINDOW_SECONDS:
    data = {"window_start": now, "count": 0}

data["count"] += 1

with open(COUNTER_FILE, "w") as f:
    json.dump(data, f)

if data["count"] > MAX_CALLS:
    remaining = WINDOW_SECONDS - (now - data["window_start"])
    print(f"Rate limit exceeded: {data['count']}/{MAX_CALLS} exec calls. "
          f"Resets in {remaining:.0f}s.", file=sys.stderr)
    sys.exit(1)

print(f"Exec call {data['count']}/{MAX_CALLS} in current window.")
sys.exit(0)
```

```bash
chmod +x hooks/rate-limit-exec.py
```

**HOOKS.yaml:**
```yaml
version: "1"

hooks:
  - point: turn:tool:pre
    match:
      tool: exec
    action: exec_script
    target: "/path/to/workspace/hooks/rate-limit-exec.py"
    onFailure:
      action: block
      message: "🚫 Rate limit exceeded. Please wait before running more exec commands."
```

---

## Security Notes

The `exec_script` action has a built-in security denylist that prevents scripts from
paths like `/etc/`, `/bin/rm`, `/usr/sbin/`, etc. Scripts must be:

- Located within your workspace or a trusted path
- Executable (`chmod +x`)
- Not in denied system directories

---

## Testing exec_script

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');

const results = await engine.execute('turn:tool:pre', {
  point: 'turn:tool:pre',
  sessionKey: 'agent:main:test',
  toolName: 'exec',
  toolArgs: { command: 'npm run build' },
  timestamp: Date.now(),
});

// Result depends on disk space / rate limit state
console.log(results[0].passed);   // true or false
console.log(results[0].message);  // script stdout or stderr
```

---

## Tips

- Scripts run synchronously in the hook chain — keep them fast (< 5 seconds ideally).
- Use `stderr` for failure messages and `stdout` for informational output.
- Exit code is the only gate signal — no need to print structured output.
- Chain `exec_script` with `onFailure: { action: retry }` for transient failures.
- Store scripts in `hooks/` inside your workspace for easy versioning.

# Walkthrough 2: Topic Context Logging — Summarize Turns to Topic Files

Automatically log and summarize each conversation turn in a Telegram forum topic to
a dedicated topic context file. This is how the agent survives compaction.

---

## The Problem

When an OpenClaw agent operates in a long-running Telegram forum topic, its context
window eventually compacts. Without external memory, the agent loses track of:

- What decisions were made
- What's in progress
- What the user last asked for

The solution: hook every turn in the topic and append structured logs (or LLM summaries)
to `memory/topics/topic-{N}.md`.

---

## HOOKS.yaml Config

```yaml
version: "1"

defaults:
  model: anthropic/claude-haiku-4-5
  onFailure:
    action: continue
    notifyUser: false

hooks:
  # Log raw turn data for topic 42
  - point:
      - turn:pre
      - turn:post
    match:
      topicId: 42
    action: log
    target: "/path/to/workspace/memory/topics/topic-42-raw.jsonl"
    onFailure:
      action: continue

  # Summarize each turn post-completion using LLM
  - point: turn:post
    match:
      topicId: 42
    action: summarize_and_log
    model: anthropic/claude-haiku-4-5
    target: "/path/to/workspace/memory/topics/topic-42.md"
    onFailure:
      action: continue
```

---

## How It Works

### Raw log hook (`log` action)

Fires at `turn:pre` (before the agent processes) and `turn:post` (after).
Writes a JSON line to the JSONL file:

```json
{"timestamp":"2026-02-17T21:00:00.000Z","point":"turn:post","sessionKey":"agent:main:telegram:group:-100EXAMPLE:topic:42","topicId":42,"prompt":"What's the status?"}
```

### Summarize hook (`summarize_and_log` action)

Fires at `turn:post` only. Calls the LLM to produce a human-readable summary of the turn
and appends it to `topic-42.md`. This file is what the agent reads at the start of each
session in that topic (per AGENTS.md conventions).

---

## Log File Structure

After several turns, `topic-42.md` might look like:

```markdown
## 2026-02-17 21:00 UTC
User asked for status on the lifecycle hooks project. Agent reported Phase 12 in progress.
Next steps: complete walkthroughs, then update README.

## 2026-02-17 21:30 UTC
User approved Phases 13-15. Agent began example configs and README update.
Decisions: include 3 example configs (security, logging, delegation).
```

---

## Multi-Topic Setup

To log multiple topics, add one hook block per topic (or omit the `topicId` filter to
log all topics):

```yaml
hooks:
  # Log ALL topics (no topicId filter)
  - point: turn:post
    action: log
    target: "/path/to/workspace/memory/hooks-all-turns.jsonl"
    onFailure:
      action: continue

  # Summarize only specific high-value topics
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
```

---

## Testing the Logger

```typescript
import { LifecycleGateEngine } from '@fractal-ai/plugin-lifecycle-hooks';
import * as fs from 'fs/promises';

const engine = new LifecycleGateEngine();
await engine.loadConfig('./HOOKS.yaml');

const results = await engine.execute('turn:post', {
  point: 'turn:post',
  sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
  topicId: 42,
  prompt: 'What is the status of the project?',
  response: 'Phase 12 is in progress. Walkthroughs are being written.',
  timestamp: Date.now(),
});

console.log(results.every(r => r.passed)); // true (logging is non-blocking)

// Check the log file was written
const log = await fs.readFile('./memory/topics/topic-42-raw.jsonl', 'utf-8');
console.log(log); // JSON line with turn data
```

---

## Tips

- Keep the raw `.jsonl` log as a machine-readable audit trail.
- Keep the `.md` summary as human/agent-readable working memory.
- The agent reads `memory/topics/topic-{N}.md` at session start — make sure the
  summary action writes there consistently.
- Use `model: anthropic/claude-haiku-4-5` for cheap, fast summarization. Upgrade to
  opus for richer summaries on high-value topics.

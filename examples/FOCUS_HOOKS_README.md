# Focus Tracking Hook Examples

This directory contains example hook scripts for integrating the lifecycle hooks plugin with your OpenClaw workspace focus tracking system.

## Scripts

### `focus-update-post.sh`
A `turn:post` hook that updates your workspace focus context after each turn.

**Features:**
- Updates `.focus/context.md` Progress section with latest activity
- Updates `PROJECT.md` Active Work table
- Extracts action/result/details from turn summary using heuristics

**Usage:**
Copy this script to your workspace hooks directory and reference it in your `HOOKS.yaml` configuration:

```yaml
hooks:
  turn:post:
    - name: "focus-update"
      action: "exec_script"
      path: "/path/to/focus-update-post.sh"
      notifyUser: false
      onFailure: "continue"
```

**Environment Variables:**
- `HOOK_SUMMARY`: The summarized turn response (set by hook engine)
- `HOOK_RESPONSE`: Alternative fallback for response content

### `log-action.sh`
A `turn:post` and `subagent:post` hook that maintains an append-only action log.

**Features:**
- Maintains `.focus/action-log.md` with automatic action tracking
- Captures timestamp, action type, result, and details
- Auto-trims to the last 50 entries to prevent unbounded growth

**Usage:**
Copy this script to your workspace hooks directory and reference it in your `HOOKS.yaml`:

```yaml
hooks:
  turn:post:
    - name: "action-log"
      action: "exec_script"
      path: "/path/to/log-action.sh"
      notifyUser: false
      onFailure: "continue"
  subagent:post:
    - name: "action-log"
      action: "exec_script"
      path: "/path/to/log-action.sh"
      notifyUser: false
      onFailure: "continue"
```

## Installation

1. Copy both scripts to a `scripts/hooks/` directory in your workspace (e.g., `/root/.openclaw/workspace/scripts/hooks/`)
2. Make them executable: `chmod +x focus-update-post.sh log-action.sh`
3. Update your `HOOKS.yaml` to reference these scripts
4. Reload the hook engine

## Dependencies

Both scripts require:
- Bash 4.0+
- Standard Unix utilities (`grep`, `sed`, `date`)
- Write access to your `.focus/` directory

## Configuration

These are **examples** designed for a specific workspace setup. You may need to adjust:
- Paths to match your workspace layout
- Extraction logic to match your summarization format
- Trigger conditions (hooks and lifecycle points)

## Notes

- Both scripts fail silently by default (exit 0) to avoid blocking work
- They are designed to complement existing focus context injection hooks
- Action log auto-trimming can be adjusted by modifying the `MAX_ENTRIES` variable

---

For more information about lifecycle hooks, see the main plugin documentation.

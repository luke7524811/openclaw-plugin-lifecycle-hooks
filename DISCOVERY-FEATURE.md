# Auto-Discovery Feature

## Overview

The lifecycle hooks plugin now supports **auto-discovery** of `HOOKS.yaml` files across your workspace. Instead of maintaining a single monolithic config, you can distribute hook definitions across multiple files and have them automatically discovered and merged at load time.

## Features

### 1. **Recursive Scanning**
- Scans workspace directory for all `HOOKS.yaml` files (up to depth 4)
- Automatically ignores `node_modules`, `.git`, and `dist` directories
- Configurable depth and ignore list

### 2. **Config Merging**
- Root config is always primary (its `version` and `defaults` win)
- Hooks from all discovered files are combined
- Execution order: root hooks first, then discovered hooks in the order found

### 3. **Source Tracking**
- Each hook is tagged with `_source` metadata field
- Points to the absolute path of the originating `HOOKS.yaml` file
- Useful for debugging and conflict resolution

### 4. **Conflict Detection**
- Detects duplicate hook names across files
- Identifies overlapping `point` + `match` combinations
- Logs warnings but doesn't crash — invalid files are skipped

## API

### `loadConfigWithDiscovery(rootConfigPath, workspaceRoot)`

```typescript
const engine = new LifecycleGateEngine();

const result = await engine.loadConfigWithDiscovery(
  '/path/to/root/HOOKS.yaml',   // Primary config
  '/path/to/workspace'           // Workspace root to scan
);

console.log(`Loaded ${result.totalHooks} hooks from ${result.configs.length} files`);
console.log(`Conflicts detected: ${result.conflicts.length}`);
```

### Return Value: `DiscoveryResult`

```typescript
interface DiscoveryResult {
  configs: Array<{ path: string; config: HooksConfig }>;
  conflicts: ConflictWarning[];
  totalHooks: number;
}
```

## Example

**Workspace structure:**
```
workspace/
├── HOOKS.yaml                    # Root config
├── project1/
│   └── HOOKS.yaml               # Project-specific hooks
└── project2/
    └── tools/
        └── HOOKS.yaml           # Tool-specific hooks
```

**Root HOOKS.yaml:**
```yaml
version: "1"
defaults:
  model: anthropic/claude-haiku-4-5
hooks:
  - point: turn:pre
    action: log
```

**project1/HOOKS.yaml:**
```yaml
version: "1"
hooks:
  - point: turn:tool:pre
    action: block
    match:
      tool: exec
      commandPattern: '^rm\s'
```

**project2/tools/HOOKS.yaml:**
```yaml
version: "1"
hooks:
  - point: subagent:pre
    action: inject_context
    source: context/subagent-primer.md
```

**Result:** All 3 hooks are loaded, root defaults apply globally, each hook knows its source file.

## Conflict Warnings

### Duplicate Names
```
⚠️  Duplicate hook name "security-check" found in 2 files
    Sources: /root/HOOKS.yaml, /project1/HOOKS.yaml
```

### Overlapping Matches
```
⚠️  Overlapping match at point "turn:tool:pre" from 2 files
    Sources: /root/HOOKS.yaml, /project2/tools/HOOKS.yaml
```

## Design Decisions

1. **Root config is always primary** — Its `defaults` and `version` take precedence
2. **Discovered hooks are appended** — Root hooks execute first, maintaining predictable order
3. **Invalid configs are skipped** — Bad YAML or validation errors log a warning but don't crash
4. **Scan depth limited to 4** — Prevents excessive recursion
5. **`_source` is always absolute path** — No ambiguity about hook origins

## Migration

Existing code using `loadConfig()` continues to work unchanged. Use `loadConfigWithDiscovery()` when you want workspace-wide auto-discovery.

```typescript
// Old way (still works)
await engine.loadConfig('/path/to/HOOKS.yaml');

// New way (with discovery)
await engine.loadConfigWithDiscovery('/path/to/HOOKS.yaml', '/workspace/root');
```

## Testing

All 436 tests pass, including 14 new discovery-specific tests:
- Recursive scanning with depth limits
- Ignore lists (node_modules, .git, dist)
- Config merging and _source stamping
- Conflict detection for duplicate names and overlapping matches

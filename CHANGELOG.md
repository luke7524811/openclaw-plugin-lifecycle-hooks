# Changelog

All notable changes to `@fractal-ai/plugin-lifecycle-hooks` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] - TBD

### Summary

Public launch-ready release with comprehensive documentation, cleaned PII, and full feature set.

### Added

- **9 action types** — Complete action system:
  - `block` — Halt pipeline with optional user notification
  - `log` — Append structured JSON to log files
  - `inject_context` — Load context from JSONL into agent prompt
  - `inject_origin` — Inject message origin metadata (chat ID, topic ID, sender)
  - `summarize_and_log` — LLM-summarize events then append to log
  - `exec_script` — Run shell scripts with optional stdout injection
  - `notify_user` — Send Telegram notifications (fire-and-forget)
  - `retry` — Retry failed hooks with exponential backoff
  - `continue` — Continue pipeline on failure (best-effort)

- **8 hook points** — Full lifecycle coverage:
  - `turn:pre`, `turn:post` — Turn lifecycle
  - `turn:tool:pre`, `turn:tool:post` — Main agent tool calls
  - `subagent:pre`, `subagent:post` — Sub-agent lifecycle
  - `subagent:tool:pre`, `subagent:tool:post` — Sub-agent tool calls
  - Plus: `subagent:spawn:pre`, `heartbeat:pre/post`, `cron:pre/post`

- **Variable interpolation** — Path templating with `{topicId}`, `{sessionKey}`, `{timestamp}`
  - Supported in: `log.target`, `summarize_and_log.target`, `inject_context.source`, `exec_script.script`
  - Enables per-topic logging: `memory/topics/topic-{topicId}.jsonl`

- **Wildcard topic matching** — `topicId: "*"` matches any session with a topic ID
  - Enables "all topics" hooks without hardcoding IDs

- **injectOutput for exec_script** — Capture stdout and inject into agent context
  - When `injectOutput: true`, script output is added to `prependContext`

- **Persistent notification routing** — `subagent:post` notifications use last main session key
  - Session key persistence across gateway restarts
  - Config fallback via `defaults.notificationTarget`

- **Hot-reload configuration** — `engine.reloadConfig()` picks up HOOKS.yaml changes without restart

### Changed

- **Documentation overhaul** — User-facing docs consolidated:
  - `README.md` — Complete reference with all actions and examples
  - `docs/QUICKSTART.md` — Step-by-step setup guide
  - `docs/CONFIGURATION.md` — Full schema reference
  - `docs/WALKTHROUGHS.md` — 5 use-case walkthroughs
  - `docs/ARCHITECTURE.md` — Engine internals and extension points
  - `docs/TESTING.md` — Test suite guide

- **Examples cleaned** — All example YAML files genericized (no PII)

### Removed

- **Internal docs deleted** — Development artifacts not user-facing:
  - `AUDIT-PII.md`, `T1-FIX-SUMMARY.md`, `T1-QUICK-REF.md`, `T1-VERIFICATION.md`
  - `IMPLEMENTATION_T5_T7.md`, `ORIGIN_CONTEXT_FEATURE.md`, `PROJECT-CONTEXT.md`, `TESTING-TRACKER.md`
  - `docs/quickstart.md` (duplicate, kept `QUICKSTART.md`)

### Security

- **PII removed** — All personal information scrubbed:
  - Telegram chat IDs genericized (real → `-100EXAMPLE456789`)
  - Email addresses replaced with `user@example.com`
  - Personal names replaced with "the user" or "your bot"
  - No API keys, tokens, or passwords in any file

---

## [0.2.0] - 2026-02-19

### Added

- **Variable interpolation** — `{topicId}`, `{sessionKey}`, and `{timestamp}` placeholders in path fields
  - Supported in: `inject_context.source`, `log.target`, `summarize_and_log.target`, `exec_script.script`
  - Shared utility: `src/utils/interpolate.ts`
  - Enables per-topic logging: `memory/topics/topic-{topicId}.md`
  - Example: `{sessionKey}_{timestamp}.log` → `telegram:group:-100EXAMPLE:topic:42_1735123456789.log`
- **`injectOutput` flag for exec_script** — Stdout injection into agent context
  - When `injectOutput: true`, script stdout is captured and returned in `result.injectedContent`
  - Engine collects `injectedContent` from all action results and merges into `prependContext`
  - Use case: generate context snippets via shell script and inject them before tool execution
- **Wildcard `topicId` matcher** — `topicId: "*"` matches any session with a `topicId` field
  - Enables "all topics in this group" hooks without hardcoding topic IDs
  - Example: auto-log all forum topics without listing each one

### Fixed

- **`isSubAgentSession()` detection** — Now checks `agentId`, `sessionKey`, AND `sessionId` for `:subagent:` pattern
  - Previous implementation only checked `sessionKey`, missing sub-agents with non-standard session keys
  - Now robust against all OpenClaw session key formats
- **`notifyUser` on block actions** — Notifications now fire when a tool call is blocked
  - Block action handler checks both `hook.notifyUser` and `hook.onFailure.notifyUser`
  - Previously only fired on `onFailure` error paths, not on successful blocks
  - Ensures users are informed when destructive commands are prevented
- **408 unit tests passing** — All acceptance tests (T1-T7) validated

---

## [Unreleased]

### Added

- **`notifyUser` feature** — Fire-and-forget Telegram notifications when a hook blocks a tool call.
  - New module `src/notify.ts` with three exports:
    - `setRuntime(api.runtime)` — captures the OpenClaw runtime reference at plugin registration time
    - `parseTelegramTarget(sessionKey)` — parses Telegram chat ID and optional thread ID from any session key format
    - `notifyUser(sessionKey, message)` — sends a Telegram message to the session's chat; never throws; failures are caught and logged
  - `src/index.ts` now calls `setRuntime(api.runtime)` during synchronous plugin registration
  - `src/index.ts` `before_tool_call` handler calls `notifyUser()` on every gate block
  - `src/engine.ts` calls `notifyUser()` in two paths:
    - When a block result fires and `hook.onFailure.notifyUser === true`
    - When `onFailure.action === 'notify'` is triggered by an action error
  - New test file `tests/notify.test.ts` with 12 tests covering:
    - `parseTelegramTarget()` for forum topic, group, DM, and invalid session key formats
    - `notifyUser()` fire-and-forget behavior (no runtime, missing send function, error recovery)
    - Integration with engine block path (`notifyUser: true` triggers send; `notifyUser: false` does not)
    - `onFailure.action: notify` path triggers send and returns `passed: true`
  - Session key formats supported:
    - `telegram:group:<chatId>:topic:<threadId>` → sends to group thread
    - `telegram:group:<chatId>` → sends to group (no thread)
    - `telegram:<chatId>` → sends to DM
    - Anything else → silently skipped

### Changed

- `README.md` — Added "User notifications" row to features table; updated roadmap to mark `notify` as done; added `notify.ts` to project structure
- `docs/QUICKSTART.md` — New Step 6 "Telegram Notifications on Block" with example config and target resolution table
- `docs/CONFIGURATION.md` — Expanded `onFailure.notifyUser` documentation with trigger conditions, target resolution table, and requirements; updated `notify` failure action description from stub to implemented
- `docs/ARCHITECTURE.md` — New "Notification System (notify.ts)" section covering runtime capture pattern, `parseTelegramTarget`, fire-and-forget design, and call sites; added `notify.ts` to source file map; updated "What's Not Yet Wired" table
- `docs/WALKTHROUGHS.md` — rm guard "How It Works" section updated with step 6 describing Telegram notification behavior
- `docs/walkthroughs/01-rm-guard.md` — Same update to the standalone walkthrough file
- `examples/rm-guard.yaml` — Added explanatory comment above `notifyUser: true` in defaults section
- `tests/integration.test.ts` — Updated `onFailure: notify` test comment to reflect it is now implemented; updated assertion to check `passed: true` and message contains `'user notified'`

---

## [0.1.0] — Initial Release

### Added

- `LifecycleGateEngine` — stateful gate engine class
- 13 hook points: `turn:pre/post`, `turn:tool:pre/post`, `subagent:spawn:pre`, `subagent:pre/post`, `subagent:tool:pre/post`, `heartbeat:pre/post`, `cron:pre/post`
- Match filters: `tool`, `commandPattern`, `topicId`, `isSubAgent`, `sessionPattern`, `custom`
- Built-in actions: `block`, `log`, `summarize_and_log`, `inject_context`, `exec_script`
- Custom action module support (dynamic `import()`)
- `onFailure` with `block`, `retry` (exponential backoff), `notify`, `continue` actions
- HOOKS.yaml schema validation with `ConfigValidationError`
- Hot-reload via `engine.reloadConfig()`
- OpenClaw plugin entry point (`register()`) — synchronous registration with background config load
- `fs.watch`-based hot-reload watcher with debouncing
- Full test suite: config, matcher, engine, actions, integration (329+ tests)
- Documentation: QUICKSTART.md, CONFIGURATION.md, WALKTHROUGHS.md, ARCHITECTURE.md
- Examples: rm-guard, topic-logging, subagent-context, heartbeat-dashboard, notification-webhook, kitchen-sink, security, logging, delegation

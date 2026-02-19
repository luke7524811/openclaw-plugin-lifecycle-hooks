/**
 * index.ts — Plugin entry point.
 *
 * Exports the OpenClaw plugin register function and the engine for programmatic use.
 *
 * ## Hook Point Mapping
 *
 * This plugin defines 13 conceptual hook points mapped to the real OpenClaw
 * plugin hook API (as of openclaw 2026.x). The mapping is:
 *
 * | Plugin HookPoint      | OpenClaw Hook           | Notes                                  |
 * |-----------------------|-------------------------|----------------------------------------|
 * | turn:pre              | before_agent_start      | Fires before agent processes any turn  |
 * | turn:post             | agent_end               | Fires after agent finishes a turn      |
 * | turn:tool:pre         | before_tool_call        | Exact match — can block tool calls     |
 * | turn:tool:post        | after_tool_call         | Fires after tool execution completes   |
 * | subagent:pre          | before_agent_start      | Sub-agents also trigger this hook;     |
 * |                       |                         | use match.isSubAgent=true to filter    |
 * | subagent:post         | agent_end               | Sub-agents also trigger this hook;     |
 * |                       |                         | use match.isSubAgent=true to filter    |
 * | subagent:tool:pre     | before_tool_call        | Use match.isSubAgent=true to filter    |
 * | subagent:tool:post    | after_tool_call         | Use match.isSubAgent=true to filter    |
 * | subagent:spawn:pre    | ❌ NOT SUPPORTED        | No pre-spawn hook exists in OpenClaw   |
 * | heartbeat:pre         | ❌ NOT SUPPORTED        | No heartbeat lifecycle hook in OpenClaw|
 * | heartbeat:post        | ❌ NOT SUPPORTED        | No heartbeat lifecycle hook in OpenClaw|
 * | cron:pre              | ❌ NOT SUPPORTED        | No cron job lifecycle hook in OpenClaw |
 * | cron:post             | ❌ NOT SUPPORTED        | No cron job lifecycle hook in OpenClaw |
 *
 * Unsupported hook points (subagent:spawn:pre, heartbeat:*, cron:*) are silently
 * skipped — any HOOKS.yaml rules targeting them will log a warning and never fire.
 *
 * ## Blocking Tool Calls
 *
 * When a `before_tool_call` hook fires and the gate engine returns `passed=false`,
 * the tool call is blocked by returning `{ block: true, blockReason: message }`.
 * This is the only hook that supports blocking — `before_agent_start` does not
 * currently support blocking in the OpenClaw plugin API.
 *
 * ## CRITICAL: Synchronous Register
 *
 * OpenClaw's plugin loader does NOT await async register() functions. If register()
 * returns a Promise, it is silently ignored with a "async registration is ignored"
 * warning, and no hooks are registered. Therefore register() MUST be synchronous.
 *
 * We work around this by:
 * 1. Starting config load as a background Promise (not awaited in register).
 * 2. Registering all hook handlers synchronously via api.on().
 * 3. Each handler checks engine.isReady before processing, waiting for init if needed.
 */

import * as path from 'path';
import * as fs from 'fs';
import { LifecycleGateEngine } from './engine';
import { setRuntime, notifyUser, recordMainSessionKey } from './notify';
import type { HookContext, HookPoint } from './types';
import {
  setOriginContext,
  clearOriginContext,
  extractTopicId as extractTopicIdFromKey,
  extractChatId,
  extractSenderFromKey,
} from './context-store';

// ─── Debug Logging ────────────────────────────────────────────────────────────

const DEBUG_LOG = '/tmp/hooks-debug.log';

function debugLog(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  try {
    fs.appendFileSync(DEBUG_LOG, line);
  } catch {
    // Ignore log write failures — don't break hook execution
  }
}

// ─── Engine Singleton ─────────────────────────────────────────────────────────

/** Shared engine instance. Use this for programmatic access. */
export const engine = new LifecycleGateEngine();

// ─── Config Resolution ────────────────────────────────────────────────────────

const HOOKS_FILENAME = 'HOOKS.yaml';

/**
 * Resolve the path to HOOKS.yaml.
 * Search order:
 *   1. OPENCLAW_HOOKS_CONFIG env var (explicit override)
 *   2. <cwd>/HOOKS.yaml
 *   3. <workspace>/HOOKS.yaml (OPENCLAW_WORKSPACE env var or ~/.openclaw/workspace)
 */
function resolveHooksConfigPath(): string | null {
  // 1. Explicit env override
  if (process.env['OPENCLAW_HOOKS_CONFIG']) {
    return process.env['OPENCLAW_HOOKS_CONFIG'];
  }

  // 2. CWD
  const cwdPath = path.join(process.cwd(), HOOKS_FILENAME);
  if (fs.existsSync(cwdPath)) return cwdPath;

  // 3. Workspace
  const workspace =
    process.env['OPENCLAW_WORKSPACE'] ??
    path.join(process.env['HOME'] ?? '/root', '.openclaw', 'workspace');
  const workspacePath = path.join(workspace, HOOKS_FILENAME);
  if (fs.existsSync(workspacePath)) return workspacePath;

  return null;
}

// ─── Hot Reload ───────────────────────────────────────────────────────────────

let hotReloadWatcher: fs.FSWatcher | null = null;
let hotReloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 300;

/**
 * Set up fs.watch on the HOOKS.yaml config file for hot reload.
 * Config changes are picked up without gateway restart.
 * Uses debouncing since fs.watch can fire multiple events per save.
 */
function setupHotReload(configPath: string, logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }): void {
  if (hotReloadWatcher) {
    try { hotReloadWatcher.close(); } catch { /* ignore */ }
    hotReloadWatcher = null;
  }

  try {
    hotReloadWatcher = fs.watch(configPath, (eventType) => {
      if (eventType !== 'change' && eventType !== 'rename') return;

      // Debounce: fs.watch often fires 2-3 times per save
      if (hotReloadDebounceTimer) {
        clearTimeout(hotReloadDebounceTimer);
      }
      hotReloadDebounceTimer = setTimeout(async () => {
        hotReloadDebounceTimer = null;
        const msg = `[lifecycle-hooks] Hot reload triggered for ${configPath}`;
        debugLog(msg);
        logger.info(msg);

        try {
          await engine.reloadConfig();
          const hookCount = engine.getConfig()?.hooks.length ?? 0;
          const doneMsg = `[lifecycle-hooks] Hot reload complete: ${hookCount} hook(s) active`;
          debugLog(doneMsg);
          logger.info(doneMsg);
        } catch (err: unknown) {
          const errMsg = `[lifecycle-hooks] Hot reload FAILED: ${err instanceof Error ? err.message : String(err)}`;
          debugLog(errMsg);
          logger.error(errMsg);
        }
      }, DEBOUNCE_MS);
    });

    const watchMsg = `[lifecycle-hooks] Watching ${configPath} for hot reload`;
    debugLog(watchMsg);
    logger.info(watchMsg);
  } catch (err: unknown) {
    const errMsg = `[lifecycle-hooks] Could not set up hot reload watcher: ${err instanceof Error ? err.message : String(err)}`;
    debugLog(errMsg);
    logger.warn(errMsg);
  }
}

// ─── Hook Point Mapping ───────────────────────────────────────────────────────

/**
 * OpenClaw hook names that are supported and mapped to our conceptual points.
 * Hook points that have no real OpenClaw equivalent are documented above.
 */
const UNSUPPORTED_HOOK_POINTS: HookPoint[] = [
  'subagent:spawn:pre',
  'heartbeat:pre',
  'heartbeat:post',
  'cron:pre',
  'cron:post',
];

/**
 * Build a HookContext from the OpenClaw before_agent_start event.
 * Maps to: turn:pre (for main agent) and subagent:pre (for sub-agents).
 */
function buildAgentStartContext(
  event: { prompt: string; messages?: unknown[] },
  ctx: { agentId?: string; sessionKey?: string; sessionId?: string },
  point: HookPoint
): HookContext {
  const sessionKey = ctx.sessionKey ?? ctx.sessionId ?? ctx.agentId ?? 'unknown';
  return LifecycleGateEngine.buildContext(point, sessionKey, {
    prompt: event.prompt,
    topicId: extractTopicId(sessionKey),
    raw: { agentId: ctx.agentId, sessionId: ctx.sessionId, messages: event.messages },
  });
}

/**
 * Build a HookContext from the OpenClaw agent_end event.
 * Maps to: turn:post (for main agent) and subagent:post (for sub-agents).
 */
function buildAgentEndContext(
  event: { messages: unknown[]; success: boolean; error?: string; durationMs?: number },
  ctx: { agentId?: string; sessionKey?: string; sessionId?: string },
  point: HookPoint
): HookContext {
  const sessionKey = ctx.sessionKey ?? ctx.sessionId ?? ctx.agentId ?? 'unknown';

  // Extract the last assistant message text for the summarizer (context.response)
  const lastAssistantMsg = [...(event.messages as any[])].reverse()
    .find((m) => m?.role === 'assistant');
  const responseText = lastAssistantMsg?.content
    ? (typeof lastAssistantMsg.content === 'string'
        ? lastAssistantMsg.content
        : Array.isArray(lastAssistantMsg.content)
          ? lastAssistantMsg.content
              .filter((b: any) => b?.type === 'text')
              .map((b: any) => b.text)
              .join('\n')
          : undefined)
    : undefined;

  // Extract the last user message text for the summarizer (context.prompt)
  const lastUserMsg = [...(event.messages as any[])].reverse()
    .find((m) => m?.role === 'user');
  const promptText = lastUserMsg?.content
    ? (typeof lastUserMsg.content === 'string'
        ? lastUserMsg.content
        : Array.isArray(lastUserMsg.content)
          ? lastUserMsg.content
              .filter((b: any) => b?.type === 'text')
              .map((b: any) => b.text)
              .join('\n')
          : undefined)
    : undefined;

  return LifecycleGateEngine.buildContext(point, sessionKey, {
    prompt: promptText,
    response: responseText,
    topicId: extractTopicId(sessionKey),
    raw: {
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      success: event.success,
      error: event.error,
      durationMs: event.durationMs,
    },
  });
}

/**
 * Build a HookContext from the OpenClaw before_tool_call event.
 * Maps to: turn:tool:pre (main agent) and subagent:tool:pre (sub-agent).
 */
function buildBeforeToolCallContext(
  event: { toolName: string; params: Record<string, unknown> },
  ctx: { agentId?: string; sessionKey?: string; toolName: string },
  point: HookPoint
): HookContext {
  const sessionKey = ctx.sessionKey ?? ctx.agentId ?? 'unknown';
  // Extract the canonical command string for commandPattern matching.
  // Heuristic: check common parameter names across tool types.
  return LifecycleGateEngine.buildContext(point, sessionKey, {
    toolName: event.toolName,
    toolArgs: event.params,
    topicId: extractTopicId(sessionKey),
    raw: { agentId: ctx.agentId },
  });
}

/**
 * Build a HookContext from the OpenClaw after_tool_call event.
 * Maps to: turn:tool:post (main agent) and subagent:tool:post (sub-agent).
 */
function buildAfterToolCallContext(
  event: {
    toolName: string;
    params: Record<string, unknown>;
    result?: unknown;
    error?: string;
    durationMs?: number;
  },
  ctx: { agentId?: string; sessionKey?: string; toolName: string },
  point: HookPoint
): HookContext {
  const sessionKey = ctx.sessionKey ?? ctx.agentId ?? 'unknown';
  const response =
    event.error
      ? `Error: ${event.error}`
      : typeof event.result === 'string'
        ? event.result
        : event.result != null
          ? JSON.stringify(event.result)
          : undefined;

  return LifecycleGateEngine.buildContext(point, sessionKey, {
    toolName: event.toolName,
    toolArgs: event.params,
    response,
    topicId: extractTopicId(sessionKey),
    raw: { agentId: ctx.agentId, durationMs: event.durationMs },
  });
}

/**
 * Extract the topic ID from a session key (if present).
 * E.g. "agent:main:telegram:group:-100EXAMPLE:topic:42" → 42
 * Note: We also import extractTopicIdFromKey from context-store (same impl).
 */
function extractTopicId(sessionKey: string): number | undefined {
  const match = /:topic:(\d+)/.exec(sessionKey);
  return match ? parseInt(match[1]!, 10) : undefined;
}

/**
 * Returns true if the context belongs to a sub-agent session.
 * Sub-agent keys look like 'agent:main:subagent:UUID'.
 * We check agentId first (most reliable), then fall back to sessionKey/sessionId.
 * Previously only checked the resolved sessionKey, which missed cases where
 * ctx.sessionKey was set to the main session key while ctx.agentId held the
 * sub-agent identifier.
 */
function isSubAgentSession(ctx: { agentId?: string; sessionKey?: string; sessionId?: string }): boolean {
  // Check agentId — this is where sub-agent identity is most reliably found
  if (ctx.agentId) {
    if (ctx.agentId.includes(':subagent:') || ctx.agentId.startsWith('subagent:')) {
      return true;
    }
  }
  // Fall back to sessionKey and sessionId
  if (ctx.sessionKey?.includes(':subagent:')) return true;
  if (ctx.sessionId?.includes(':subagent:')) return true;
  return false;
}

// ─── Plugin Register Function ─────────────────────────────────────────────────

/**
 * OpenClaw plugin register function.
 *
 * ⚠️  MUST BE SYNCHRONOUS — OpenClaw does not await async register() functions.
 * If this function is async (returns a Promise), OpenClaw will log:
 *   "plugin register returned a promise; async registration is ignored"
 * and NO hooks will be registered.
 *
 * Strategy:
 * 1. Register all hook handlers synchronously (they check engine.isReady at call time).
 * 2. Kick off async config loading in the background.
 * 3. Set up hot reload watcher after config loads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function register(api: any): void {
  debugLog('[lifecycle-hooks] register() called (synchronous entry)');
  api.logger.info('[lifecycle-hooks] Initializing plugin...');

  // Capture api.runtime for notification support (fire-and-forget Telegram messages)
  if (api.runtime) {
    setRuntime(api.runtime);
    debugLog('[lifecycle-hooks] api.runtime captured for notifyUser support');
  } else {
    debugLog('[lifecycle-hooks] api.runtime not available — notifyUser will be a no-op');
  }

  // Warn about unsupported hook points in the docs (nothing to register for them)
  if (UNSUPPORTED_HOOK_POINTS.length > 0) {
    api.logger.info(
      `[lifecycle-hooks] Note: The following conceptual hook points have no OpenClaw equivalent ` +
      `and will be silently skipped: ${UNSUPPORTED_HOOK_POINTS.join(', ')}`
    );
  }

  // ── 1. Start config loading asynchronously ───────────────────────────────
  // We can't await here (register must be sync), so we fire-and-forget.
  // All hook handlers check engine.isReady before processing.

  const configPath = resolveHooksConfigPath();
  if (!configPath) {
    const msg = '[lifecycle-hooks] No HOOKS.yaml found. Plugin loaded but no hooks active. ' +
      'Create HOOKS.yaml in workspace or set OPENCLAW_HOOKS_CONFIG.';
    api.logger.warn(msg);
    debugLog(msg);
    // Still register hooks — they'll silently pass-through until config loads.
  }

  if (configPath) {
    // Fire-and-forget: load config in background, then set up hot reload
    engine.loadConfig(configPath).then(() => {
      const hookCount = engine.getConfig()?.hooks.length ?? 0;
      const msg = `[lifecycle-hooks] Config loaded: ${hookCount} hook(s) from ${configPath}`;
      api.logger.info(msg);
      debugLog(msg);

      if (hookCount === 0) {
        api.logger.info('[lifecycle-hooks] No hooks defined. Plugin active but passthrough.');
        debugLog('[lifecycle-hooks] No hooks defined, passthrough mode.');
      }

      // Set up hot reload watcher
      setupHotReload(configPath, api.logger);
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const errMsg = `[lifecycle-hooks] Failed to load HOOKS.yaml: ${message}`;
      api.logger.error(errMsg);
      debugLog(errMsg);
    });
  }

  // ── 2. Register: before_agent_start → turn:pre / subagent:pre ──────────
  // NOTE: Registered synchronously. Handler checks engine.isReady at call time.

  api.on('before_agent_start', async (
    event: { prompt: string; messages?: unknown[] },
    ctx: { agentId?: string; sessionKey?: string; sessionId?: string }
  ) => {
    debugLog(`[lifecycle-hooks] before_agent_start fired, engineReady=${engine.isReady}`);
    if (!engine.isReady) return undefined; // Config not loaded yet — pass through

    const sessionKey = ctx.sessionKey ?? ctx.sessionId ?? ctx.agentId ?? 'unknown';
    const isSub = isSubAgentSession(ctx);

    // Track the main session key so sub-agent notifications can resolve the Telegram target
    if (!isSub) {
      recordMainSessionKey(sessionKey);
    }

    // Populate origin context store for this session (used by inject_origin action)
    // Only for main agent sessions (not sub-agents)
    if (!isSub) {
      const topicId = extractTopicId(sessionKey);
      const chatId = extractChatId(sessionKey);
      const sender = extractSenderFromKey(sessionKey); // Best-effort from key
      
      setOriginContext(sessionKey, {
        topicId,
        chatId,
        sender,
        parentSessionKey: sessionKey,
      });
      
      debugLog(`[lifecycle-hooks] Stored origin context for ${sessionKey}: topic=${topicId}, chat=${chatId}`);
    }

    const points: HookPoint[] = isSub ? ['subagent:pre'] : ['turn:pre'];

    // Collect injected content to return as prependContext
    const injectedParts: string[] = [];

    for (const point of points) {
      const hookCtx = buildAgentStartContext(event, ctx, point);
      try {
        const results = await engine.execute(point, hookCtx);
        // before_agent_start doesn't support blocking in the OpenClaw API
        const blocked = results.find((r) => !r.passed);
        if (blocked) {
          api.logger.warn(
            `[lifecycle-hooks] Hook at "${point}" returned block, but before_agent_start ` +
            `does not support blocking. Message: ${blocked.message ?? '(no message)'}`
          );
        }
        // Collect injected content — return via prependContext so OpenClaw actually uses it
        for (const result of results) {
          if (result.injectedContent) {
            injectedParts.push(result.injectedContent);
            debugLog(`[lifecycle-hooks] Collected ${result.injectedContent.length} chars for prependContext at ${point}`);
          }
        }
      } catch (err: unknown) {
        api.logger.error(
          `[lifecycle-hooks] Error in ${point} hook: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Return prependContext so OpenClaw prepends it to the agent's prompt
    if (injectedParts.length > 0) {
      const prependContext = injectedParts.join('\n\n');
      debugLog(`[lifecycle-hooks] Returning prependContext (${prependContext.length} chars)`);
      return { prependContext };
    }
    return undefined;
  });

  // ── 3. Register: agent_end → turn:post / subagent:post ──────────────────

  api.on('agent_end', async (
    event: { messages: unknown[]; success: boolean; error?: string; durationMs?: number },
    ctx: { agentId?: string; sessionKey?: string; sessionId?: string }
  ) => {
    debugLog(`[lifecycle-hooks] agent_end fired, engineReady=${engine.isReady} ctx=${JSON.stringify({ agentId: ctx.agentId, sessionKey: ctx.sessionKey, sessionId: ctx.sessionId })}`);
    if (!engine.isReady) return;

    const sessionKey = ctx.sessionKey ?? ctx.sessionId ?? ctx.agentId ?? 'unknown';
    const isSub = isSubAgentSession(ctx);

    // Track the main session key so sub-agent notifications can resolve the Telegram target
    if (!isSub) {
      recordMainSessionKey(sessionKey);
    }

    const points: HookPoint[] = isSub ? ['subagent:post'] : ['turn:post'];

    for (const point of points) {
      const hookCtx = buildAgentEndContext(event, ctx, point);
      try {
        await engine.execute(point, hookCtx);
      } catch (err: unknown) {
        api.logger.error(
          `[lifecycle-hooks] Error in ${point} hook: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Clear origin context for this session to prevent memory leaks
    if (!isSub) {
      clearOriginContext(sessionKey);
      debugLog(`[lifecycle-hooks] Cleared origin context for ${sessionKey}`);
    }
  });

  // ── 4. Register: before_tool_call → turn:tool:pre / subagent:tool:pre ──

  api.on('before_tool_call', async (
    event: { toolName: string; params: Record<string, unknown> },
    ctx: { agentId?: string; sessionKey?: string; toolName: string }
  ): Promise<{ block?: boolean; blockReason?: string } | void> => {
    const command = typeof event.params?.['command'] === 'string'
      ? event.params['command'].slice(0, 80)
      : '(no command)';
    debugLog(`[lifecycle-hooks] before_tool_call fired: tool=${event.toolName} cmd=${command} engineReady=${engine.isReady}`);

    if (!engine.isReady) return; // Config not loaded yet — pass through (fail-open)

    const sessionKey = ctx.sessionKey ?? ctx.agentId ?? 'unknown';
    const isSub = isSubAgentSession(ctx);
    const point: HookPoint = isSub ? 'subagent:tool:pre' : 'turn:tool:pre';

    const hookCtx = buildBeforeToolCallContext(event, ctx, point);
    try {
      const results = await engine.execute(point, hookCtx);
      require('fs').appendFileSync('/tmp/engine-debug.log',
        `[${new Date().toISOString()}] before_tool_call execute returned ${results.length} results: ${results.map(r => `${(r as any).action}:passed=${r.passed}`).join(', ')}\n`
      );
      const blocked = results.find((r) => !r.passed);
      if (blocked) {
        const blockMsg = `[lifecycle-hooks] BLOCKING tool "${event.toolName}" at "${point}": ${blocked.message ?? '(gate blocked)'}`;
        api.logger.warn(blockMsg);
        debugLog(blockMsg);
        // Notify user of the block (fire-and-forget)
        notifyUser(sessionKey, blocked.message ?? `Blocked by lifecycle-hooks gate at ${point}`);
        return {
          block: true,
          blockReason: blocked.message ?? `Blocked by lifecycle-hooks gate at ${point}`,
        };
      }

      // Check for modifiedParams from inject_origin action
      // Since OpenClaw doesn't support returning modified params, we modify event.params in-place
      const modifiedResult = results.find((r) => r.modifiedParams);
      if (modifiedResult?.modifiedParams) {
        debugLog(`[lifecycle-hooks] Applying modified params from ${modifiedResult.action}: ${JSON.stringify(modifiedResult.modifiedParams).slice(0, 200)}`);
        // Modify event.params in-place (mutation approach since return type doesn't support it)
        Object.assign(event.params, modifiedResult.modifiedParams);
      }
    } catch (err: unknown) {
      const errMsg = `[lifecycle-hooks] Error in ${point} hook: ${err instanceof Error ? err.message : String(err)}`;
      api.logger.error(errMsg);
      debugLog(errMsg);
    }
    // No return value = allow
  });

  // ── 5. Register: after_tool_call → turn:tool:post / subagent:tool:post ─

  api.on('after_tool_call', async (
    event: {
      toolName: string;
      params: Record<string, unknown>;
      result?: unknown;
      error?: string;
      durationMs?: number;
    },
    ctx: { agentId?: string; sessionKey?: string; toolName: string }
  ) => {
    debugLog(`[lifecycle-hooks] after_tool_call fired: tool=${event.toolName} engineReady=${engine.isReady}`);
    if (!engine.isReady) return;

    const sessionKey = ctx.sessionKey ?? ctx.agentId ?? 'unknown';
    const isSub = isSubAgentSession(ctx);
    const point: HookPoint = isSub ? 'subagent:tool:post' : 'turn:tool:post';

    const hookCtx = buildAfterToolCallContext(event, ctx, point);
    try {
      await engine.execute(point, hookCtx);
    } catch (err: unknown) {
      api.logger.error(
        `[lifecycle-hooks] Error in ${point} hook: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  debugLog('[lifecycle-hooks] register() complete — all hooks registered synchronously');
  api.logger.info('[lifecycle-hooks] Plugin ready. All supported hooks registered.');
}

// ─── Named Exports ────────────────────────────────────────────────────────────

export { LifecycleGateEngine } from './engine';
export { loadHooksConfig, ConfigValidationError } from './config';
export { shouldFire, matchesFilter } from './matcher';
export { dispatchAction, listBuiltInActions } from './actions/index';
export { executeExecScript } from './actions/exec-script';
export type {
  HookPoint,
  FailureAction,
  OnFailure,
  MatchFilter,
  HookAction,
  HookDefinition,
  HooksConfig,
  HookContext,
  HookResult,
  GateEngine,
} from './types';

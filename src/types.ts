/**
 * types.ts — All TypeScript types and interfaces for the lifecycle hooks plugin.
 */

// ─── Hook Points ─────────────────────────────────────────────────────────────

/** All valid hook interception points in the OpenClaw agent pipeline. */
export type HookPoint =
  | 'turn:pre'
  | 'turn:post'
  | 'turn:tool:pre'
  | 'turn:tool:post'
  | 'subagent:spawn:pre'
  | 'subagent:pre'
  | 'subagent:post'
  | 'subagent:tool:pre'
  | 'subagent:tool:post'
  | 'heartbeat:pre'
  | 'heartbeat:post'
  | 'cron:pre'
  | 'cron:post';

// ─── Failure Handling ─────────────────────────────────────────────────────────

/** What to do when a hook action fails or the gate does not pass. */
export type FailureAction = 'block' | 'retry' | 'notify' | 'continue';

/** Configuration for failure behavior on a hook definition. */
export interface OnFailure {
  /** Primary action to take on failure. */
  action: FailureAction;
  /** How many times to retry before giving up (used when action is 'retry'). */
  retries?: number;
  /** Whether to surface a notification to the user on failure. */
  notifyUser?: boolean;
  /** Custom message to include in the failure notification or block response. */
  message?: string;
}

// ─── Match Filters ────────────────────────────────────────────────────────────

/** Criteria for narrowing which events trigger a hook. All fields are optional (AND logic). */
export interface MatchFilter {
  /** Match a specific tool name (e.g. "exec", "Read", "browser"). */
  tool?: string;
  /**
   * Regex pattern matched against the command string or primary tool argument.
   * E.g. "^rm\\s" to catch rm calls.
   */
  commandPattern?: string;
  /** Restrict hook to a specific forum topic ID. */
  topicId?: number | string;
  /**
   * Match only if the session is (or is not) a sub-agent session.
   * Sub-agent sessions have `:subagent:` in their session key.
   * - true  → only fires in sub-agent sessions
   * - false → only fires in main agent sessions
   */
  isSubAgent?: boolean;
  /**
   * Regex pattern matched against the full session key.
   * E.g. "telegram:group:-100\\d+" to match Telegram group sessions.
   */
  sessionPattern?: string;
  /**
   * Path to a custom JS/TS module that exports a default match function:
   *   (context: HookContext) => boolean | Promise<boolean>
   */
  custom?: string;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Built-in action identifiers or a path to a custom action module.
 * Built-ins: "block", "log", "summarize_and_log", "inject_context"
 * Custom: any string ending in .js / .ts treated as a module path.
 */
export type HookAction =
  | 'block'
  | 'log'
  | 'summarize_and_log'
  | 'inject_context'
  | 'notify_user'
  | string; // custom module path

// ─── Hook Definition ──────────────────────────────────────────────────────────

/** A single hook rule as defined in HOOKS.yaml. */
export interface HookDefinition {
  /** One or more hook points this rule applies to. */
  point: HookPoint | HookPoint[];
  /** Optional filters to narrow when the hook fires. */
  match?: MatchFilter;
  /** Source file path (auto-populated by discovery). */
  _source?: string;
  /** The action to execute when the hook fires. */
  action: HookAction;
  /**
   * LLM model to use for actions that require inference (e.g. summarize_and_log).
   * Overrides the global default.
   */
  model?: string;
  /**
   * Target output for log/summarize/exec_script actions.
   * E.g. a file path, a topic ID, or "memory".
   * 
   * **Variable interpolation supported:**
   * - `{topicId}` → Extracted from context.topicId or sessionKey (fallback: 'unknown')
   * - `{sessionKey}` → Full session key string
   * - `{timestamp}` → ISO 8601 timestamp
   * 
   * @example
   * target: "logs/topic-{topicId}/events-{timestamp}.jsonl"
   * // → "logs/topic-42/events-2026-02-19T08:00:00.000Z.jsonl"
   */
  target?: string;
  /**
   * Source file/path to read from for inject_context actions.
   * Distinct from target (which is for log/summarize output).
   * 
   * **Variable interpolation supported:**
   * - `{topicId}` → Extracted from context.topicId or sessionKey (fallback: 'unknown')
   * - `{sessionKey}` → Full session key string
   * - `{timestamp}` → ISO 8601 timestamp
   * 
   * @example
   * source: "context/topic-{topicId}/history.jsonl"
   * // → "context/topic-42/history.jsonl"
   */
  source?: string;
  /**
   * For inject_context: how many recent entries to load from a JSONL source.
   * Default: 5
   */
  lastN?: number;
  /**
   * For exec_script: capture stdout and inject it into the agent context.
   * When true, the script's stdout is returned in the result's `injectContent` field,
   * which the engine will prepend to the agent prompt (same mechanism as inject_context).
   * 
   * @default false
   * 
   * @example
   * action: exec_script
   * target: /path/to/get-context.sh
   * injectOutput: true
   * # Script output will be automatically injected into agent context
   */
  injectOutput?: boolean;
  /** Behavior when this hook's action fails or the gate blocks. */
  onFailure?: OnFailure;
  /** Whether to send a user notification when this hook's action fires (e.g. on block). */
  notifyUser?: boolean;
  /** Set to false to disable this hook without removing it. Defaults to true. */
  enabled?: boolean;
}

// ─── Hooks Config ─────────────────────────────────────────────────────────────

/** Top-level structure of HOOKS.yaml. */
export interface HooksConfig {
  /** Config schema version. Currently "1". */
  version: string;
  /** List of hook definitions. */
  hooks: HookDefinition[];
  /** Global defaults applied to all hooks unless overridden. */
  defaults?: {
    /** Default LLM model for inference-based actions. */
    model?: string;
    /** Default failure behavior. */
    onFailure?: OnFailure;
    /** Default notification target (session key) when no tracked session is available. */
    notificationTarget?: string;
  };
}

// ─── Runtime Context ──────────────────────────────────────────────────────────

/** Runtime context passed to each hook at execution time. */
export interface HookContext {
  /** The hook point being fired. */
  point: HookPoint;
  /** Active session key (e.g. "agent:main:telegram:group:-100xxx:topic:42"). */
  sessionKey: string;
  /** Forum topic ID if applicable. */
  topicId?: number | string;
  /** The incoming user prompt (for turn:pre hooks). */
  prompt?: string;
  /** Tool name being called (for tool hooks). */
  toolName?: string;
  /** Arguments passed to the tool (for tool hooks). */
  toolArgs?: Record<string, unknown>;
  /** Tool or turn response content (for post hooks). */
  response?: string;
  /** Subagent label (for subagent hooks). */
  subagentLabel?: string;
  /** Cron job name (for cron hooks). */
  cronJob?: string;
  /** Heartbeat event metadata. */
  heartbeatMeta?: Record<string, unknown>;
  /** Full raw event payload for extensibility. */
  raw?: Record<string, unknown>;
  /** Timestamp when the hook was triggered (ms since epoch). */
  timestamp: number;
}

// ─── Hook Result ──────────────────────────────────────────────────────────────

/** Result returned by a hook action after execution. */
export interface HookResult {
  /** Whether the hook gate passed (true = allow pipeline to continue). */
  passed: boolean;
  /** The action that was executed. */
  action: HookAction;
  /** Optional human-readable message (included in block responses or logs). */
  message?: string;
  /** Wall-clock duration of the hook execution in milliseconds. */
  duration: number;
  /** Content injected by inject_context actions (used by the engine to modify pipeline context). */
  injectedContent?: string;
  /** Modified tool parameters (used by inject_origin to modify sessions_spawn task). */
  modifiedParams?: Record<string, unknown>;
}

// ─── Gate Engine Interface ────────────────────────────────────────────────────

/** Interface for the gate engine that orchestrates hook execution. */
export interface GateEngine {
  /**
   * Load and validate a HOOKS.yaml config file.
   * @param path Absolute or workspace-relative path to HOOKS.yaml
   */
  loadConfig(path: string): Promise<HooksConfig>;

  /**
   * Load root HOOKS.yaml and auto-discover additional configs in workspace.
   * @param rootConfigPath Path to the primary HOOKS.yaml
   * @param workspaceRoot Root directory to scan for additional HOOKS.yaml files
   */
  loadConfigWithDiscovery(rootConfigPath: string, workspaceRoot: string): Promise<DiscoveryResult>;

  /**
   * Execute all hooks registered for a given point.
   * Returns results for each hook that fired.
   * If any result has passed=false, the pipeline should be blocked.
   */
  execute(point: HookPoint, context: HookContext): Promise<HookResult[]>;

  /**
   * Return all enabled HookDefinitions that apply to the given point.
   */
  getHooksForPoint(point: HookPoint): HookDefinition[];
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/** Warning about conflicting hooks across discovered configs. */
export interface ConflictWarning {
  type: 'duplicate-name' | 'overlapping-match';
  hookName?: string;
  sources: string[];
  message: string;
}

/** Options for auto-discovery scanning. */
export interface DiscoveryOptions {
  maxDepth?: number;
  ignore?: string[];
}

/** Result of discovery + merge operation. */
export interface DiscoveryResult {
  configs: Array<{ path: string; config: HooksConfig }>;
  conflicts: ConflictWarning[];
  totalHooks: number;
}

// ─── Plugin Interface ─────────────────────────────────────────────────────────

/** OpenClaw plugin interface (minimal, pending official SDK). */
export interface OpenClawPlugin {
  /** Unique plugin identifier. */
  name: string;
  /** Semver version string. */
  version: string;
  /**
   * Called by OpenClaw on plugin load.
   * @param api The OpenClaw plugin API surface (typed as unknown until SDK is published).
   */
  setup(api: unknown): void | Promise<void>;
  /**
   * Called by OpenClaw on plugin unload / shutdown.
   */
  teardown?(): void | Promise<void>;
}

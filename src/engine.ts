/**
 * engine.ts — Gate engine.
 *
 * Orchestrates hook lifecycle: config loading, hook filtering,
 * action dispatch, and result aggregation.
 */

import type { GateEngine, HooksConfig, HookPoint, HookContext, HookResult, HookDefinition, DiscoveryResult } from './types';
import { loadHooksConfig } from './config';
import { shouldFire } from './matcher';
import { dispatchAction } from './actions/index';
import { notifyUser } from './notify';
import { resolveHookTemplateVars } from './template';
import { scanForHooksConfigs, mergeConfigs, detectConflicts } from './discovery';
import * as path from 'path';

export class LifecycleGateEngine implements GateEngine {
  private config: HooksConfig | null = null;
  private configPath: string | null = null;

  // ─── Config Loading ────────────────────────────────────────────────────────

  /**
   * Load and validate a HOOKS.yaml file.
   * Stores config internally for subsequent execute() calls.
   */
  async loadConfig(filePath: string): Promise<HooksConfig> {
    this.config = await loadHooksConfig(filePath);
    this.configPath = filePath;
    console.log(
      `[lifecycle-hooks/engine] Loaded ${this.config.hooks.length} hook(s) from "${filePath}"`
    );
    return this.config;
  }

  /**
   * Reload config from the original path (hot-reload support).
   * No-op if config has not been loaded yet.
   */
  async reloadConfig(): Promise<HooksConfig | null> {
    if (!this.configPath) return null;
    return this.loadConfig(this.configPath);
  }

  /**
   * Load root HOOKS.yaml and auto-discover additional configs in workspace.
   * Merges all configs, tags hooks with _source, detects conflicts.
   * 
   * @param rootConfigPath - Path to the primary HOOKS.yaml
   * @param workspaceRoot - Root directory to scan for additional HOOKS.yaml files
   * @returns Discovery result with merged config, conflicts, and metadata
   */
  async loadConfigWithDiscovery(
    rootConfigPath: string,
    workspaceRoot: string
  ): Promise<DiscoveryResult> {
    const absoluteRootPath = path.resolve(rootConfigPath);
    const absoluteWorkspaceRoot = path.resolve(workspaceRoot);

    // 1. Load the root config as primary
    const primaryConfig = await loadHooksConfig(absoluteRootPath, absoluteRootPath);

    // 2. Scan workspace for additional HOOKS.yaml files
    const allConfigPaths = await scanForHooksConfigs(absoluteWorkspaceRoot);

    // 3. Filter out the root config from discovered paths
    const secondaryPaths = allConfigPaths.filter(
      (p) => path.resolve(p) !== absoluteRootPath
    );

    console.log(
      `[lifecycle-hooks/engine] Auto-discovery found ${secondaryPaths.length} additional HOOKS.yaml file(s)`
    );

    // 4. Load and validate each discovered config
    const secondaryConfigs: Array<{ path: string; config: HooksConfig }> = [];
    for (const configPath of secondaryPaths) {
      try {
        const config = await loadHooksConfig(configPath, configPath);
        secondaryConfigs.push({ path: configPath, config });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[lifecycle-hooks/engine] Skipping invalid config at "${configPath}": ${message}`
        );
      }
    }

    // 5. Merge all configs (root is primary)
    const mergedConfig = mergeConfigs(
      primaryConfig,
      ...secondaryConfigs.map((sc) => sc.config)
    );

    // 6. Detect conflicts
    const allConfigs = [
      { path: absoluteRootPath, config: primaryConfig },
      ...secondaryConfigs,
    ];
    const conflicts = detectConflicts(allConfigs);

    // Log warnings for conflicts
    for (const conflict of conflicts) {
      console.warn(
        `[lifecycle-hooks/engine] ${conflict.type}: ${conflict.message} — sources: ${conflict.sources.join(', ')}`
      );
    }

    // 7. Store merged config internally
    this.config = mergedConfig;
    this.configPath = absoluteRootPath;

    console.log(
      `[lifecycle-hooks/engine] Loaded ${mergedConfig.hooks.length} total hook(s) from ${allConfigs.length} file(s)`
    );

    return {
      configs: allConfigs,
      conflicts,
      totalHooks: mergedConfig.hooks.length,
    };
  }

  // ─── Hook Filtering ────────────────────────────────────────────────────────

  /**
   * Return all enabled HookDefinitions that match the given hook point.
   * Note: Does NOT evaluate match filters (that requires async context evaluation).
   * For full filtering including match criteria, use execute().
   */
  getHooksForPoint(point: HookPoint): HookDefinition[] {
    if (!this.config) return [];
    return this.config.hooks.filter((hook) => {
      if (hook.enabled === false) return false;
      const points = Array.isArray(hook.point) ? hook.point : [hook.point];
      return points.includes(point);
    });
  }

  // ─── Execution ─────────────────────────────────────────────────────────────

  /**
   * Execute all hooks for the given point and context.
   *
   * Execution model:
   * 1. Find all hooks registered for the point.
   * 2. Evaluate each hook's match filter against the context.
   * 3. Dispatch the hook's action.
   * 4. If action returns passed=false, stop processing further hooks (short-circuit).
   * 5. Return all results.
   *
   * The caller is responsible for checking results and halting the pipeline
   * if any result has passed=false.
   */
  async execute(point: HookPoint, context: HookContext): Promise<HookResult[]> {
    if (!this.config) {
      console.warn('[lifecycle-hooks/engine] execute() called before loadConfig(). No hooks will run.');
      return [];
    }

    const candidates = this.config.hooks;
    const results: HookResult[] = [];

    for (const hook of candidates) {
      // Check point + match filter
      const fires = await shouldFire(hook, context);
      if (!fires) continue;

      const startTime = Date.now();

      // Resolve template variables in hook config fields before dispatching
      const resolvedHook = resolveHookTemplateVars(hook, context);

      let result: HookResult;
      try {
        result = await dispatchAction(resolvedHook.action, resolvedHook, context, startTime, {
          defaults: this.config.defaults,
        });
        require('fs').appendFileSync('/tmp/engine-debug.log',
          `[${new Date().toISOString()}] dispatchAction returned: passed=${result.passed} action="${result.action}" hook="${(resolvedHook as any).name ?? 'unnamed'}" msg="${result.message?.slice(0, 80)}"\n`
        );
      } catch (err: unknown) {
        require('fs').appendFileSync('/tmp/engine-debug.log',
          `[${new Date().toISOString()}] dispatchAction THREW for hook="${(resolvedHook as any).name ?? 'unnamed'}": ${err instanceof Error ? err.message : String(err)}\n`
        );
        // Unhandled error in action — apply onFailure logic
        result = await this.handleActionError(resolvedHook, context, startTime, err);
      }

      // If action failed (passed=false) and onFailure is set, run failure handler
      // This handles the case where dispatchAction returns failure without throwing
      if (!result.passed) {
        const failureAction = resolvedHook.onFailure?.action ?? 'block';
        require('fs').appendFileSync('/tmp/engine-debug.log',
          `[${new Date().toISOString()}] Action "${resolvedHook.action}" returned passed=false. onFailure.action="${failureAction}" hook="${(resolvedHook as any).name ?? 'unnamed'}"\n`
        );
        if (failureAction !== 'block') {
          // Re-route through handleActionError for retry/continue/notify logic
          result = await this.handleActionError(
            resolvedHook,
            context,
            startTime,
            new Error(result.message ?? 'Action returned passed=false')
          );
          require('fs').appendFileSync('/tmp/engine-debug.log',
            `[${new Date().toISOString()}] After handleActionError: passed=${result.passed} message="${result.message?.slice(0, 200)}"\n`
          );
        }
      }

      results.push(result);

      // Short-circuit: if a gate blocked, stop processing further hooks
      if (!result.passed) {
        console.warn(
          `[lifecycle-hooks/engine] Pipeline blocked at "${point}" by hook action "${hook.action}". Stopping hook chain.`
        );

        // Notification is handled by the action itself (e.g. block.ts checks
        // hook.notifyUser / hook.onFailure.notifyUser and calls notifyUser).

        break;
      }
    }

    return results;
  }

  // ─── Error Handling ────────────────────────────────────────────────────────

  private async handleActionError(
    hook: HookDefinition,
    context: HookContext,
    startTime: number,
    err: unknown
  ): Promise<HookResult> {
    const message = err instanceof Error ? err.message : String(err);
    const onFailure = hook.onFailure ?? this.config?.defaults?.onFailure;
    const failureAction = onFailure?.action ?? 'continue';

    console.error(
      `[lifecycle-hooks/engine] Error in hook action "${hook.action}" at "${context.point}": ${message}`
    );

    switch (failureAction) {
      case 'block':
        return {
          passed: false,
          action: hook.action,
          message: onFailure?.message ?? `Hook action failed: ${message}`,
          duration: Date.now() - startTime,
        };

      case 'retry': {
        const maxRetries = onFailure?.retries ?? 3;
        require('fs').appendFileSync('/tmp/engine-debug.log',
          `[${new Date().toISOString()}] RETRY path entered for "${hook.action}" (max ${maxRetries})\n`
        );

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          // Exponential backoff: 100ms, 200ms, 400ms, ...
          const delayMs = 100 * Math.pow(2, attempt - 1);
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

          require("fs").appendFileSync('/tmp/engine-debug.log',
            `[${new Date().toISOString()}] Retry attempt ${attempt}/${maxRetries} after ${delayMs}ms backoff\n`
          );

          try {
            const retryResult = await dispatchAction(
              hook.action,
              hook,
              context,
              Date.now(),
              { defaults: this.config?.defaults }
            );

            require("fs").appendFileSync('/tmp/engine-debug.log',
              `[${new Date().toISOString()}] Retry ${attempt} result: passed=${retryResult.passed} msg="${retryResult.message?.slice(0, 100)}"\n`
            );

            if (retryResult.passed) {
              console.log(
                `[lifecycle-hooks/engine] Hook action "${hook.action}" succeeded on retry ${attempt}`
              );
              return {
                ...retryResult,
                duration: Date.now() - startTime,
                message: `Succeeded on retry ${attempt}: ${retryResult.message ?? ''}`.trim(),
              };
            }

            console.warn(
              `[lifecycle-hooks/engine] Retry ${attempt}/${maxRetries} failed for "${hook.action}"`
            );
          } catch (retryErr: unknown) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            console.warn(
              `[lifecycle-hooks/engine] Retry ${attempt}/${maxRetries} threw: ${retryMsg}`
            );
          }
        }

        // All retries exhausted — fall through to continue
        console.error(
          `[lifecycle-hooks/engine] All ${maxRetries} retries exhausted for "${hook.action}". Continuing.`
        );
        return {
          passed: true,
          action: hook.action,
          message: `Action failed after ${maxRetries} retries: ${message}`,
          duration: Date.now() - startTime,
        };
      }

      case 'notify': {
        const notifyMsg = onFailure?.message ?? `Hook action "${hook.action}" failed: ${message}`;
        console.warn(`[lifecycle-hooks/engine] Notifying user of failure at "${context.point}": ${notifyMsg}`);
        notifyUser(context.sessionKey, notifyMsg);
        return {
          passed: true,
          action: hook.action,
          message: `Action failed (user notified): ${message}`,
          duration: Date.now() - startTime,
        };
      }

      case 'continue':
      default:
        return {
          passed: true,
          action: hook.action,
          message: `Action failed (continuing): ${message}`,
          duration: Date.now() - startTime,
        };
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  /** Returns true if the engine has a loaded config. */
  get isReady(): boolean {
    return this.config !== null;
  }

  /** Returns the current loaded config, or null if not yet loaded. */
  getConfig(): HooksConfig | null {
    return this.config;
  }

  /**
   * Build a HookContext with required fields pre-filled.
   * Convenience method for callers.
   */
  static buildContext(
    point: HookPoint,
    sessionKey: string,
    overrides: Partial<Omit<HookContext, 'point' | 'sessionKey' | 'timestamp'>> = {}
  ): HookContext {
    return {
      point,
      sessionKey,
      timestamp: Date.now(),
      ...overrides,
    };
  }
}

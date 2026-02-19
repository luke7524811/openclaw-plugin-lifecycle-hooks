/**
 * actions/index.ts — Action registry.
 *
 * Maps HookAction strings to their executor functions.
 * Custom actions (module paths) are loaded dynamically.
 */

import type { HookAction, HookContext, HookResult, HookDefinition, HooksConfig } from '../types';
import { executeBlock } from './block';
import { executeLog } from './log';
import { executeSummarize } from './summarize';
import { executeInject } from './inject';
import { executeExecScript } from './exec-script';
import { executeNotifyUser } from './notify-action';
import { executeInjectOrigin } from './inject-origin';

/** Signature for all action executor functions. */
export type ActionExecutor = (
  hook: HookDefinition,
  context: HookContext,
  startTime: number,
  config: Pick<HooksConfig, 'defaults'>
) => Promise<HookResult>;

/** Built-in action registry. */
const BUILT_IN_ACTIONS: Record<string, ActionExecutor> = {
  block: (hook, context, startTime, _config) => executeBlock(hook, context, startTime),
  log: (hook, context, startTime, _config) => executeLog(hook, context, startTime),
  summarize_and_log: (hook, context, startTime, config) => executeSummarize(hook, context, startTime, config),
  inject_context: (hook, context, startTime, _config) => executeInject(hook, context, startTime),
  inject_origin: (hook, context, startTime, _config) => executeInjectOrigin(hook, context, startTime),
  exec_script: (hook, context, startTime, _config) => executeExecScript(hook, context, startTime),
  notify_user: (hook, context, startTime, config) => executeNotifyUser(hook, context, startTime, config),
};

/**
 * Resolve and execute the action for a hook.
 * Built-in actions are looked up in the registry.
 * Unknown strings are treated as paths to custom action modules.
 */
export async function dispatchAction(
  action: HookAction,
  hook: HookDefinition,
  context: HookContext,
  startTime: number,
  config: Pick<HooksConfig, 'defaults'>
): Promise<HookResult> {
  // Built-in action
  const executor = BUILT_IN_ACTIONS[action];
  if (executor) {
    return executor(hook, context, startTime, config);
  }

  // Custom module action
  return executeCustomAction(action, hook, context, startTime, config);
}

/**
 * Dynamically load and execute a custom action module.
 * The module must export a default function matching ActionExecutor signature.
 *
 * Throws on load/execution failure so the engine's onFailure policy can apply.
 * The engine's handleActionError wraps this call and applies the hook's onFailure config.
 */
async function executeCustomAction(
  modulePath: string,
  hook: HookDefinition,
  context: HookContext,
  startTime: number,
  config: Pick<HooksConfig, 'defaults'>
): Promise<HookResult> {
  let mod: { default?: ActionExecutor };
  try {
    mod = await import(modulePath) as { default?: ActionExecutor };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[lifecycle-hooks/actions] Failed to load custom action module "${modulePath}": ${message}`);
    // Re-throw so the engine's handleActionError can apply hook.onFailure
    throw new Error(`Failed to load custom action "${modulePath}": ${message}`);
  }

  const fn = mod.default;
  if (typeof fn !== 'function') {
    throw new Error(`Custom action module "${modulePath}" has no default export function`);
  }

  try {
    return await fn(hook, context, startTime, config);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[lifecycle-hooks/actions] Custom action "${modulePath}" threw during execution: ${message}`);
    // Re-throw so the engine's handleActionError can apply hook.onFailure
    throw new Error(`Custom action "${modulePath}" execution failed: ${message}`);
  }
}

/** List all registered built-in action names. */
export function listBuiltInActions(): string[] {
  return Object.keys(BUILT_IN_ACTIONS);
}

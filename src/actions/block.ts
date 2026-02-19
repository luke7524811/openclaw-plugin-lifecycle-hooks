/**
 * actions/block.ts — Block action.
 *
 * Halts the pipeline and returns a blocked HookResult.
 * This is the primary safety gate action.
 */

import type { HookContext, HookResult, HookDefinition } from '../types';
import { notifyUser } from '../notify';

/**
 * Execute the block action.
 * Always returns passed=false, which signals the engine to halt the pipeline.
 */
export async function executeBlock(
  hook: HookDefinition,
  context: HookContext,
  startTime: number
): Promise<HookResult> {
  const failureMessage = hook.onFailure?.message;

  // Build a descriptive block message
  const defaultMessage = buildBlockMessage(hook, context);
  const blockMessage = failureMessage ?? defaultMessage;

  console.warn(`[lifecycle-hooks] BLOCKED at ${context.point}${context.toolName ? ` (tool: ${context.toolName})` : ''}`);

  // Notify user if requested via top-level notifyUser or onFailure.notifyUser
  if (hook.notifyUser || hook.onFailure?.notifyUser) {
    notifyUser(context.sessionKey, blockMessage);
  }

  return {
    passed: false,
    action: 'block',
    message: blockMessage,
    duration: Date.now() - startTime,
  };
}

function buildBlockMessage(hook: HookDefinition, context: HookContext): string {
  const parts: string[] = ['Action blocked by lifecycle hook.'];

  if (context.toolName) {
    parts.push(`Tool: ${context.toolName}`);
  }
  if (context.toolArgs?.['command']) {
    const cmd = String(context.toolArgs['command']);
    // Truncate long commands
    parts.push(`Command: ${cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd}`);
  }

  const points = Array.isArray(hook.point) ? hook.point.join(', ') : hook.point;
  parts.push(`Hook point: ${points}`);

  return parts.join(' | ');
}

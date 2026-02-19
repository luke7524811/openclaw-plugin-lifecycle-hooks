/**
 * actions/inject-origin.ts — Origin context injection action.
 *
 * Automatically injects origin context into sessions_spawn calls.
 * Reads origin context from the context-store and modifies the task parameter
 * to include an [origin: ...] tag.
 *
 * This action is designed to be used with before_tool_call hooks targeting
 * the sessions_spawn tool.
 *
 * Always returns passed=true (injection is non-blocking).
 * Returns modifiedParams when the tool is sessions_spawn and context is available.
 */

import type { HookContext, HookResult, HookDefinition } from '../types';
import { getOriginContext } from '../context-store';

/**
 * Execute the inject_origin action.
 * 
 * When toolName is "sessions_spawn" and origin context is available:
 * - Reads origin context from the context store
 * - Builds an [origin: ...] tag
 * - Appends it to the task parameter
 * - Returns modifiedParams so the spawn receives the injected context
 * 
 * Always returns passed=true (non-blocking).
 */
export async function executeInjectOrigin(
  hook: HookDefinition,
  context: HookContext,
  startTime: number
): Promise<HookResult> {
  // Only inject for sessions_spawn tool calls
  if (context.toolName !== 'sessions_spawn') {
    return {
      passed: true,
      action: 'inject_origin',
      message: 'Not a sessions_spawn call; injection skipped.',
      duration: Date.now() - startTime,
    };
  }

  // Get origin context from the store
  const originCtx = getOriginContext(context.sessionKey);
  
  if (!originCtx) {
    return {
      passed: true,
      action: 'inject_origin',
      message: 'No origin context available; injection skipped.',
      duration: Date.now() - startTime,
    };
  }

  // Build the origin tag
  const originTag = buildOriginTag(originCtx);

  // Get the current task parameter
  const currentTask = context.toolArgs?.['task'];
  const taskString = typeof currentTask === 'string' ? currentTask : '';

  // Append the origin tag to the task
  const modifiedTask = taskString
    ? `${taskString}\n\n${originTag}`
    : originTag;

  // Return the result with modified params
  // Note: The engine needs to support returning modifiedParams in HookResult
  // and applying them to the tool call. This is a proposed extension.
  return {
    passed: true,
    action: 'inject_origin',
    message: `Injected origin context: ${originTag}`,
    duration: Date.now() - startTime,
    // Store modified params so the engine can apply them
    modifiedParams: {
      ...context.toolArgs,
      task: modifiedTask,
    },
  };
}

/**
 * Build the origin context tag in the format:
 * [origin: topic={topicId}, chat={chatId}, sender={senderName}, parent={parentSessionKey}]
 * 
 * Only includes fields that are available.
 */
function buildOriginTag(origin: {
  topicId?: number | string;
  chatId?: string;
  sender?: string;
  parentSessionKey: string;
}): string {
  const parts: string[] = [];

  if (origin.topicId !== undefined) {
    parts.push(`topic=${origin.topicId}`);
  }

  if (origin.chatId) {
    parts.push(`chat=${origin.chatId}`);
  }

  if (origin.sender) {
    parts.push(`sender=${origin.sender}`);
  }

  // Always include parent session key
  parts.push(`parent=${origin.parentSessionKey}`);

  return `[origin: ${parts.join(', ')}]`;
}

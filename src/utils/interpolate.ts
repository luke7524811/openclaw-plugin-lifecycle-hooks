/**
 * utils/interpolate.ts — Variable interpolation for hook configuration paths.
 *
 * Replaces `{topicId}`, `{sessionKey}`, `{timestamp}` in path fields.
 * Provides a shared utility for consistent variable substitution across actions.
 */

import type { HookContext } from '../types';

/**
 * Extract topic ID from a session key.
 * 
 * Looks for the pattern `:topic:` followed by a number in the session key.
 * 
 * @param sessionKey - The session key string (e.g., "agent:main:telegram:group:-100xxx:topic:42")
 * @returns The topic ID as a string, or 'unknown' if not found
 * 
 * @example
 * extractTopicId("agent:main:telegram:group:-100EXAMPLE456789:topic:42") // "124"
 * extractTopicId("agent:main:telegram:user:12345") // "unknown"
 */
export function extractTopicId(sessionKey: string): string {
  const match = sessionKey.match(/:topic:(\d+)/);
  return match ? match[1] : 'unknown';
}

/**
 * Interpolate variables in a path string using values from HookContext.
 * 
 * Supported variables:
 * - `{topicId}` → context.topicId (if set) or extracted from sessionKey, or 'unknown'
 * - `{sessionKey}` → context.sessionKey
 * - `{timestamp}` → ISO 8601 timestamp from context.timestamp
 * 
 * @param path - The path string containing variable placeholders
 * @param ctx - The hook context with runtime values
 * @returns The path with all variables replaced
 * 
 * @example
 * interpolateVariables("logs/topic-{topicId}-{timestamp}.jsonl", ctx)
 * // → "logs/topic-42-2026-02-19T08:00:00.000Z.jsonl"
 * 
 * @example
 * interpolateVariables("context/{topicId}/memory.txt", ctx)
 * // → "context/unknown/memory.txt" (if no topic in session)
 */
export function interpolateVariables(path: string, ctx: HookContext): string {
  // Resolve topicId: use context.topicId if set, otherwise extract from sessionKey
  let topicId: string;
  if (ctx.topicId !== undefined) {
    topicId = String(ctx.topicId);
  } else {
    topicId = extractTopicId(ctx.sessionKey);
  }

  const timestamp = new Date(ctx.timestamp).toISOString();

  return path
    .replace(/\{topicId\}/g, topicId)
    .replace(/\{sessionKey\}/g, ctx.sessionKey)
    .replace(/\{timestamp\}/g, timestamp);
}

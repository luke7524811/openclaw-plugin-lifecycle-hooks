/**
 * template.ts — Template variable resolution for hook config strings.
 *
 * Replaces `{variable}` placeholders in hook config string fields
 * with values from the current HookContext before actions are dispatched.
 *
 * Supported variables:
 *   {topicId}    → context.topicId  (empty string if not in a topic)
 *   {sessionKey} → context.sessionKey
 *   {point}      → context.point
 *   {tool}       → context.toolName (empty string if not a tool hook)
 *   {timestamp}  → ISO 8601 timestamp derived from context.timestamp
 */

import type { HookContext, HookDefinition } from './types';

/**
 * Replace all known `{variable}` placeholders in a string using
 * values from the provided HookContext.
 *
 * Unknown placeholders are left as-is so they don't silently swallow typos.
 */
export function resolveTemplateVars(str: string, context: HookContext): string {
  const timestamp = new Date(context.timestamp).toISOString();

  return str
    .replace(/\{topicId\}/g, context.topicId !== undefined ? String(context.topicId) : '')
    .replace(/\{sessionKey\}/g, context.sessionKey)
    .replace(/\{point\}/g, context.point)
    .replace(/\{tool\}/g, context.toolName ?? '')
    .replace(/\{timestamp\}/g, timestamp);
}

/**
 * Return a shallow copy of `hook` with all resolvable string fields
 * having their template variables substituted.
 *
 * Fields resolved:
 *   hook.source
 *   hook.target
 *   hook.script  (future-proofing — not yet in HookDefinition but may be added)
 *   hook.onFailure.message
 *
 * This lets actions receive already-resolved values without needing to
 * know about template vars at all.
 */
export function resolveHookTemplateVars(hook: HookDefinition, context: HookContext): HookDefinition {
  const resolved: HookDefinition = { ...hook };

  if (resolved.source) {
    resolved.source = resolveTemplateVars(resolved.source, context);
  }

  if (resolved.target) {
    resolved.target = resolveTemplateVars(resolved.target, context);
  }

  // `script` is not in the type yet but guard defensively
  const anyHook = resolved as unknown as Record<string, unknown>;
  if (typeof anyHook['script'] === 'string') {
    anyHook['script'] = resolveTemplateVars(anyHook['script'] as string, context);
  }

  if (resolved.onFailure?.message) {
    resolved.onFailure = {
      ...resolved.onFailure,
      message: resolveTemplateVars(resolved.onFailure.message, context),
    };
  }

  return resolved;
}

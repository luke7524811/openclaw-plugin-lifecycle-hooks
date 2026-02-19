/**
 * matcher.ts — Hook match filter evaluation.
 *
 * Determines whether a HookDefinition should fire for a given HookContext.
 */

import type { HookDefinition, HookContext, MatchFilter } from './types';

/**
 * Evaluate whether a single MatchFilter criterion matches the given context.
 * All provided fields are evaluated with AND logic — all must match.
 *
 * @returns true if the context matches the filter (or if filter is undefined/empty)
 */
export async function matchesFilter(
  filter: MatchFilter | undefined,
  context: HookContext
): Promise<boolean> {
  // No filter = match everything
  if (!filter) return true;

  // Tool name match
  if (filter.tool !== undefined) {
    if (context.toolName !== filter.tool) return false;
  }

  // Command pattern match (regex against toolArgs command/first string arg)
  if (filter.commandPattern !== undefined) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(filter.commandPattern);
    } catch {
      console.warn(`[lifecycle-hooks/matcher] Invalid commandPattern regex "${filter.commandPattern}". Skipping filter.`);
      return false; // fail-closed: invalid pattern = no match
    }
    const subject = extractCommandSubject(context);
    if (!pattern.test(subject)) return false;
  }

  // Topic ID match — "*" means "any topic" (but topicId must exist)
  if (filter.topicId !== undefined) {
    const filterTopic = String(filter.topicId);
    const contextTopic = context.topicId !== undefined ? String(context.topicId) : undefined;
    if (filterTopic === '*') {
      // Wildcard: match any session that HAS a topicId
      if (contextTopic === undefined) return false;
    } else {
      if (contextTopic !== filterTopic) return false;
    }
  }

  // Sub-agent session match
  if (filter.isSubAgent !== undefined) {
    const sessionIsSubAgent = context.sessionKey.includes(':subagent:');
    if (filter.isSubAgent !== sessionIsSubAgent) return false;
  }

  // Session key pattern match
  if (filter.sessionPattern !== undefined) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(filter.sessionPattern);
    } catch {
      console.warn(`[lifecycle-hooks/matcher] Invalid sessionPattern regex "${filter.sessionPattern}". Skipping filter.`);
      return false; // fail-closed: invalid pattern = no match
    }
    if (!pattern.test(context.sessionKey)) return false;
  }

  // Custom matcher module
  if (filter.custom !== undefined) {
    try {
      // TODO: resolve path relative to workspace root
      const mod = await import(filter.custom) as { default?: (ctx: HookContext) => boolean | Promise<boolean> };
      const fn = mod.default;
      if (typeof fn !== 'function') {
        console.warn(`[lifecycle-hooks] Custom matcher at "${filter.custom}" has no default export function. Skipping.`);
        return true; // fail-open for custom matchers that can't be loaded
      }
      const result = await fn(context);
      if (!result) return false;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[lifecycle-hooks] Failed to load custom matcher "${filter.custom}": ${message}. Skipping.`);
      return true; // fail-open
    }
  }

  return true;
}

/**
 * Returns true if the given HookDefinition should fire for the given context.
 * Checks both the hook point and the match filter.
 */
export async function shouldFire(
  hook: HookDefinition,
  context: HookContext
): Promise<boolean> {
  // Disabled hooks never fire
  if (hook.enabled === false) return false;

  // Check point(s)
  const points = Array.isArray(hook.point) ? hook.point : [hook.point];
  if (!points.includes(context.point)) return false;

  // Check match filter
  return matchesFilter(hook.match, context);
}

/**
 * Extract the "command subject" from a HookContext for pattern matching.
 * Tries common tool argument shapes in order:
 *   - toolArgs.command (exec tool)
 *   - toolArgs.path / toolArgs.file_path (read/write/edit tools)
 *   - toolArgs.url (browser/fetch tools)
 *   - prompt (turn-level hooks)
 *   - empty string as fallback
 */
function extractCommandSubject(context: HookContext): string {
  const args = context.toolArgs;
  if (args) {
    if (typeof args['command'] === 'string') return args['command'];
    if (typeof args['path'] === 'string') return args['path'];
    if (typeof args['file_path'] === 'string') return args['file_path'];
    if (typeof args['url'] === 'string') return args['url'];
    if (typeof args['message'] === 'string') return args['message'];
  }
  if (context.prompt) return context.prompt;
  return '';
}

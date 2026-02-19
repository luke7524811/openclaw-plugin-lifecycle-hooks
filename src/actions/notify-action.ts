/**
 * actions/notify-action.ts — Notify user action.
 *
 * Sends a Telegram notification to the user when a hook fires.
 * Optionally generates an LLM summary of the agent result before notifying.
 * Always passes (non-blocking).
 *
 * Use case: Notify the user when a sub-agent finishes running.
 *
 * HOOKS.yaml example:
 *   - name: subagent-done-notify
 *     point: subagent:post
 *     action: notify_user
 *     model: "glm-45-flash"           # Optional: enables LLM summary
 *     onFailure:
 *       action: continue
 *
 * Context available:
 *   - context.response     — last assistant message (extracted from messages array)
 *   - context.prompt       — last user message
 *   - context.raw.success  — whether agent ended cleanly
 *   - context.raw.error    — error message if failed
 *   - context.raw.durationMs — how long the agent ran
 */

import type { HookContext, HookResult, HookDefinition } from '../types';
import { notifyUser, getLastMainSessionKey } from '../notify';
import { llmComplete } from '../llm';

// ─── Summary Generation ───────────────────────────────────────────────────────

const SUBAGENT_SUMMARY_SYSTEM_PROMPT =
  'You are summarizing a completed AI sub-agent task for its operator. ' +
  'Write a concise 1-3 sentence summary of what the sub-agent accomplished. ' +
  'Focus on: the task done, key results or findings, and any issues encountered. ' +
  'Be direct and informative. Do not start with "I" or repeat "sub-agent". ' +
  'If the agent failed, lead with that.';

/**
 * Build a user message for the LLM summarizer from hook context.
 */
function buildSummaryPrompt(context: HookContext): string {
  const parts: string[] = [];

  const raw = context.raw as Record<string, unknown> | undefined;
  const success = raw?.['success'] as boolean | undefined;
  const error = raw?.['error'] as string | undefined;
  const durationMs = raw?.['durationMs'] as number | undefined;

  if (success === false) {
    parts.push(`Status: FAILED${error ? ` — ${error}` : ''}.`);
  } else {
    parts.push('Status: Completed successfully.');
  }

  if (durationMs !== undefined) {
    const durationSec = Math.round(durationMs / 100) / 10;
    parts.push(`Duration: ${durationSec}s.`);
  }

  if (context.response) {
    // Last assistant message — most informative signal of what was accomplished
    parts.push(`Agent final output (excerpt): "${String(context.response).slice(0, 1200)}"`);
  } else if (context.prompt) {
    // Fallback: last user message (the task assignment)
    parts.push(`Task: "${String(context.prompt).slice(0, 400)}"`);
  }

  return parts.join(' ');
}

/**
 * Build a plain-text fallback notification (no LLM).
 */
function buildFallbackNotification(context: HookContext): string {
  const raw = context.raw as Record<string, unknown> | undefined;
  const success = raw?.['success'] as boolean | undefined;
  const error = raw?.['error'] as string | undefined;
  const durationMs = raw?.['durationMs'] as number | undefined;

  const statusEmoji = success === false ? '❌' : '✅';
  const durationStr = durationMs !== undefined
    ? ` (${Math.round(durationMs / 100) / 10}s)`
    : '';

  const headerLine = `${statusEmoji} Sub-agent finished${durationStr}`;

  if (success === false && error) {
    return `${headerLine}\n\n⚠️ Error: ${error.slice(0, 300)}`;
  }

  // Extract excerpt from last assistant response
  const responseExcerpt = context.response
    ? context.response.slice(0, 400).trim()
    : null;

  if (responseExcerpt) {
    return `${headerLine}\n\n${responseExcerpt}`;
  }

  return headerLine;
}

// ─── Action Executor ──────────────────────────────────────────────────────────

/**
 * Execute the notify_user action.
 *
 * If a model is configured (hook.model or config default), generates an LLM summary
 * and sends it as the notification. Otherwise sends a plain-text excerpt.
 *
 * Always returns passed=true (non-blocking).
 */
export async function executeNotifyUser(
  hook: HookDefinition,
  context: HookContext,
  startTime: number,
  config: { defaults?: { model?: string; notificationTarget?: string } }
): Promise<HookResult> {
  let notificationText: string;

  // Use LLM summary if a model is configured
  const model = hook.model ?? config.defaults?.model ?? null;

  if (model) {
    try {
      const summaryPrompt = buildSummaryPrompt(context);
      const summary = await llmComplete(model, SUBAGENT_SUMMARY_SYSTEM_PROMPT, summaryPrompt);

      const raw = context.raw as Record<string, unknown> | undefined;
      const success = raw?.['success'] as boolean | undefined;
      const durationMs = raw?.['durationMs'] as number | undefined;
      const durationStr = durationMs !== undefined
        ? ` (${Math.round(durationMs / 100) / 10}s)`
        : '';
      const statusEmoji = success === false ? '❌' : '✅';

      notificationText = `${statusEmoji} Sub-agent done${durationStr}\n\n${summary}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[lifecycle-hooks/notify-action] LLM summary failed: ${message}. Using fallback.`);
      notificationText = buildFallbackNotification(context);
    }
  } else {
    notificationText = buildFallbackNotification(context);
  }

  // Resolve session key: for subagent sessions, we need the PARENT session key
  // to send to the right Telegram chat. Sub-agent keys look like:
  //   agent:main:subagent:<uuid>
  // The parent key is stored in raw.parentSessionKey when available,
  // or we parse it from the messageProvider in context.raw.
  const sessionKey = resolveNotificationTarget(context, config);

  // Fire-and-forget notification
  notifyUser(sessionKey, notificationText);

  return {
    passed: true,
    action: 'notify_user',
    message: `Notification sent to session: ${sessionKey}`,
    duration: Date.now() - startTime,
  };
}

/**
 * Resolve the session key to use for Telegram notification routing.
 *
 * For sub-agent sessions (key contains `:subagent:`), the key itself has no
 * Telegram target. We try several fallback strategies to find the parent session:
 *
 * 1. If not a sub-agent session → sessionKey IS the Telegram target
 * 2. Check raw.messageProvider for a full "telegram:..." key
 * 3. Check the globally tracked last main-agent session key (recordMainSessionKey)
 * 4. Check config.defaults.notificationTarget as a fallback
 * 5. Last resort: use the sessionKey as-is (will fail gracefully)
 *
 * Sub-agent session key format:
 *   agent:main:subagent:<uuid>
 */
function resolveNotificationTarget(
  context: HookContext,
  config: { defaults?: { notificationTarget?: string } }
): string {
  const sessionKey = context.sessionKey;

  // If this is NOT a subagent session, the sessionKey IS the Telegram target
  if (!sessionKey.includes(':subagent:')) {
    return sessionKey;
  }

  // For subagent sessions, try to find the parent session key

  // 1. Check raw.messageProvider (only useful if it's a full "telegram:..." key)
  const raw = context.raw as Record<string, unknown> | undefined;
  const messageProvider = raw?.['messageProvider'] as string | undefined;
  if (messageProvider && messageProvider.startsWith('telegram:')) {
    return messageProvider;
  }

  // 2. Use the globally tracked last main-agent session key
  // This is set whenever a main agent turn fires a before_agent_start / agent_end hook.
  // Since sub-agents are spawned from main agents, this is the best proxy for the parent.
  const lastMainKey = getLastMainSessionKey();
  if (lastMainKey) {
    console.log(
      `[lifecycle-hooks/notify-action] Sub-agent session "${sessionKey}" resolved to ` +
      `parent session "${lastMainKey}" for notification routing.`
    );
    return lastMainKey;
  }

  // 3. Use config fallback notification target
  const configTarget = config.defaults?.notificationTarget;
  if (configTarget) {
    console.log(
      `[lifecycle-hooks/notify-action] Sub-agent session "${sessionKey}" using ` +
      `config fallback notification target "${configTarget}".`
    );
    return configTarget;
  }

  // 4. Last resort: use the sessionKey as-is. parseTelegramTarget() will return null
  // if it can't parse it, and no notification will be sent (with a warn log).
  console.warn(
    `[lifecycle-hooks/notify-action] Could not resolve Telegram target for sub-agent ` +
    `session "${sessionKey}" — no main session key tracked and no config fallback. Notification may fail.`
  );
  return sessionKey;
}

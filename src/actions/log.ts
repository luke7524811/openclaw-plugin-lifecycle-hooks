/**
 * actions/log.ts — Log action.
 *
 * Records hook event details to a target file or stdout.
 * Always passes (non-blocking).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { HookContext, HookResult, HookDefinition } from '../types';
import { interpolateVariables } from '../utils/interpolate';

/**
 * Execute the log action.
 * Writes a structured log entry to the target (file path) or stdout.
 * Always returns passed=true — this is a non-blocking observability action.
 */
export async function executeLog(
  hook: HookDefinition,
  context: HookContext,
  startTime: number
): Promise<HookResult> {
  const entry = buildLogEntry(hook, context);

  if (hook.target) {
    const resolvedTarget = interpolateVariables(hook.target, context);
    await writeToFile(resolvedTarget, entry);
  } else {
    // Default: emit to stdout
    console.log(`[lifecycle-hooks/log] ${entry}`);
  }

  return {
    passed: true,
    action: 'log',
    message: `Logged event at ${context.point}`,
    duration: Date.now() - startTime,
  };
}

function buildLogEntry(hook: HookDefinition, context: HookContext): string {
  const timestamp = new Date(context.timestamp).toISOString();
  const parts: Record<string, unknown> = {
    timestamp,
    point: context.point,
    sessionKey: context.sessionKey,
  };

  if (context.topicId !== undefined) parts['topicId'] = context.topicId;
  if (context.toolName) parts['tool'] = context.toolName;
  if (context.toolArgs) parts['args'] = sanitizeArgs(context.toolArgs);
  if (context.prompt) parts['prompt'] = truncate(context.prompt, 200);
  if (context.subagentLabel) parts['subagent'] = context.subagentLabel;
  if (context.cronJob) parts['cronJob'] = context.cronJob;

  try {
    return JSON.stringify(parts);
  } catch {
    // Fallback if parts contain non-serializable values
    return JSON.stringify({
      timestamp,
      point: context.point,
      sessionKey: context.sessionKey,
      error: 'Log entry contained non-serializable values',
    });
  }
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  // TODO: Redact sensitive fields (passwords, tokens, etc.)
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string') {
      safe[k] = truncate(v, 100);
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

async function writeToFile(target: string, entry: string): Promise<void> {
  try {
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(path.resolve(target)), { recursive: true });
    // Append with newline
    await fs.appendFile(path.resolve(target), entry + '\n', 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[lifecycle-hooks/log] Failed to write to "${target}": ${message}`);
    // Non-fatal: fall back to stdout
    console.log(`[lifecycle-hooks/log] ${entry}`);
  }
}

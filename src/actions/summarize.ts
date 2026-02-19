/**
 * actions/summarize.ts — Summarize and log action.
 *
 * Uses an LLM to produce a concise summary of the hook event,
 * then writes it to the target. Always passes (non-blocking).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { HookContext, HookResult, HookDefinition, HooksConfig } from '../types';
import { llmComplete } from '../llm';
import { interpolateVariables } from '../utils/interpolate';

export interface SummarizeOptions {
  /** Resolved model to use (hook-level overrides config default). */
  model: string;
}

/**
 * Execute the summarize_and_log action.
 * Generates an LLM summary of the event and writes it to the target.
 * Always returns passed=true.
 */
export async function executeSummarize(
  hook: HookDefinition,
  context: HookContext,
  startTime: number,
  config: Pick<HooksConfig, 'defaults'>
): Promise<HookResult> {
  const model = hook.model ?? config.defaults?.model ?? 'default';

  let summary: string;
  try {
    summary = await generateSummary(hook, context, model);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[lifecycle-hooks/summarize] LLM call failed: ${message}. Falling back to raw log.`);
    summary = buildFallbackSummary(context);
  }

  let entry: string;
  try {
    entry = JSON.stringify({
      timestamp: new Date(context.timestamp).toISOString(),
      point: context.point,
      sessionKey: context.sessionKey,
      summary,
      model,
    });
  } catch {
    // Fallback for non-serializable context values
    entry = JSON.stringify({
      timestamp: new Date(context.timestamp).toISOString(),
      point: context.point,
      sessionKey: context.sessionKey,
      summary,
      model,
      error: 'Entry contained non-serializable values',
    });
  }

  if (hook.target) {
    const resolvedTarget = interpolateVariables(hook.target, context);
    await writeToFile(resolvedTarget, entry);
  } else {
    console.log(`[lifecycle-hooks/summarize] ${entry}`);
  }

  return {
    passed: true,
    action: 'summarize_and_log',
    message: `Summarized and logged event at ${context.point}`,
    duration: Date.now() - startTime,
  };
}

const SYSTEM_PROMPT =
  'You are a working-state extractor for an AI agent. Your job is to capture ACTIONABLE context that will help the agent resume work after memory loss.\n\n' +
  'Extract and preserve:\n' +
  '- WHAT is being worked on (specific project/feature/task names)\n' +
  '- CURRENT STATUS (what just happened, what step we are on)\n' +
  '- DECISIONS MADE (any choices, approvals, or rejections)\n' +
  '- BLOCKERS or NEXT STEPS mentioned\n' +
  '- SPECIFIC NAMES, PATHS, COMMANDS, or VALUES referenced\n' +
  '- WHO asked for WHAT (user requests)\n\n' +
  'Format: 2-5 bullet points. Be specific — generic summaries are useless.\n' +
  'BAD: "The user is discussing a technical issue with the agent."\n' +
  'GOOD: "• User asked to fix the summarization prompt in lifecycle-hooks plugin\\n• Current file: src/actions/summarize.ts\\n• Problem: LLM produces vague summaries that lose project state\\n• Next: rewrite SYSTEM_PROMPT and increase input context"';

/**
 * Build the user message for the LLM from available context fields.
 */
function buildUserMessage(hook: HookDefinition, context: HookContext): string {
  const parts: string[] = [`Hook point: ${context.point}.`];

  if (context.sessionKey) {
    parts.push(`Session: ${context.sessionKey}.`);
  }
  if (context.prompt) {
    // Strip system metadata blocks to focus on actual user content
    const rawPrompt = String(context.prompt);
    // Find the actual user message — skip untrusted metadata JSON blocks
    const userMsgMatch = rawPrompt.match(/```\s*\n\n(.+)/s);
    const relevantPart = userMsgMatch ? userMsgMatch[1] : rawPrompt;
    parts.push(`User message: "${relevantPart.slice(0, 2000)}"`);
  }
  if (context.toolName) {
    parts.push(`Tool: ${context.toolName}.`);
  }
  if (context.toolArgs && Object.keys(context.toolArgs).length > 0) {
    try {
      const argsStr = JSON.stringify(context.toolArgs).slice(0, 400);
      parts.push(`Tool args: ${argsStr}`);
    } catch {
      // skip non-serializable args
    }
  }
  if (context.response) {
    parts.push(`Agent response: "${String(context.response).slice(0, 1500)}"`);
  }
  if (context.subagentLabel) {
    parts.push(`Subagent: ${context.subagentLabel}.`);
  }
  if (context.cronJob) {
    parts.push(`Cron job: ${context.cronJob}.`);
  }

  return parts.join(' ');
}

/**
 * Generate a concise LLM summary of the hook event.
 */
async function generateSummary(
  hook: HookDefinition,
  context: HookContext,
  model: string
): Promise<string> {
  const userMessage = buildUserMessage(hook, context);
  return await llmComplete(model, SYSTEM_PROMPT, userMessage);
}

function buildFallbackSummary(context: HookContext): string {
  return `Event at ${context.point} in session ${context.sessionKey} at ${new Date(context.timestamp).toISOString()}`;
}

async function writeToFile(target: string, entry: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(path.resolve(target)), { recursive: true });
    await fs.appendFile(path.resolve(target), entry + '\n', 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[lifecycle-hooks/summarize] Failed to write to "${target}": ${message}`);
    console.log(`[lifecycle-hooks/summarize] ${entry}`);
  }
}

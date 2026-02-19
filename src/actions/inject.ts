/**
 * actions/inject.ts — Context injection action.
 *
 * Reads context from a source file and returns it as injectedContent in the
 * HookResult, allowing the plugin's before_agent_start handler to prepend it
 * to the agent prompt.
 *
 * Supports:
 *   - Regular files: read entire file content
 *   - JSONL files: read last N entries, format as a readable context block
 *   - Template vars: {topicId} replaced from context.topicId
 *
 * Always returns passed=true (injection is non-blocking).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { HookContext, HookResult, HookDefinition } from '../types';
import { interpolateVariables } from '../utils/interpolate';

const DEFAULT_LAST_N = 5;

/**
 * Execute the inject_context action.
 * Reads content from hook.source (or falls back to hook.target for backwards compat)
 * and returns it as injectedContent in the result.
 *
 * Always returns passed=true.
 */
export async function executeInject(
  hook: HookDefinition,
  context: HookContext,
  startTime: number
): Promise<HookResult> {
  // Determine the source path: prefer hook.source, fall back to hook.target
  const rawSource = hook.source ?? hook.target;

  if (!rawSource) {
    return {
      passed: true,
      action: 'inject_context',
      message: 'No source configured; injection skipped.',
      duration: Date.now() - startTime,
    };
  }

  // Resolve template variables
  const resolvedSource = interpolateVariables(rawSource, context);

  // Check if source file exists and has content
  let content: string;
  try {
    content = await loadSourceContent(resolvedSource, hook.lastN ?? DEFAULT_LAST_N);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[lifecycle-hooks/inject] Failed to load injection content from "${resolvedSource}": ${message}`
    );
    return {
      passed: true,
      action: 'inject_context',
      message: `Injection failed: ${message}`,
      duration: Date.now() - startTime,
    };
  }

  if (!content || content.length === 0) {
    return {
      passed: true,
      action: 'inject_context',
      message: `Source "${resolvedSource}" is empty; injection skipped.`,
      duration: Date.now() - startTime,
    };
  }

  return {
    passed: true,
    action: 'inject_context',
    message: `Injected context from "${resolvedSource}" (${content.length} chars)`,
    duration: Date.now() - startTime,
    injectedContent: content,
  };
}

/**
 * Load content from a source file.
 * - .jsonl files: read last N entries, format as context block
 * - Other files: read entire file content as UTF-8
 */
async function loadSourceContent(sourcePath: string, lastN: number): Promise<string> {
  const resolved = path.resolve(sourcePath);
  const raw = await fs.readFile(resolved, 'utf-8');

  if (sourcePath.endsWith('.jsonl')) {
    return parseJsonlContent(raw, lastN, sourcePath);
  }

  return raw;
}

/**
 * Parse JSONL content and format the last N entries as a readable context block.
 * Each line should be a JSON object with timestamp, point, and summary fields.
 */
function parseJsonlContent(raw: string, lastN: number, sourcePath: string): string {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return '';
  }

  // Take the last N lines
  const recentLines = lines.slice(-lastN);

  const entries: string[] = [];
  for (const line of recentLines) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const timestamp = typeof entry['timestamp'] === 'string' ? entry['timestamp'] : String(entry['timestamp'] ?? '');
      const point = typeof entry['point'] === 'string' ? entry['point'] : '';
      const summary = typeof entry['summary'] === 'string' ? entry['summary'] : '';

      if (timestamp || point || summary) {
        const pointPart = point ? `${point}: ` : '';
        entries.push(`[${timestamp}] ${pointPart}${summary}`);
      }
    } catch {
      // Skip malformed lines silently
    }
  }

  if (entries.length === 0) {
    return '';
  }

  const actualN = entries.length;
  return [
    `── Recent Topic Context (last ${actualN} interactions) ──`,
    ...entries,
    `── End Topic Context ──`,
  ].join('\n');
}

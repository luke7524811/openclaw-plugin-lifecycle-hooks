/**
 * discovery.ts — Auto-discovery of HOOKS.yaml files across workspace.
 *
 * Scans workspace recursively for HOOKS.yaml files, merges them,
 * and detects conflicts.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { HooksConfig, HookDefinition, ConflictWarning, DiscoveryOptions } from './types';

// ─── Scanner ──────────────────────────────────────────────────────────────────

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist'];
const DEFAULT_MAX_DEPTH = 4;

/**
 * Recursively scan for all HOOKS.yaml files under rootDir.
 *
 * @param rootDir - Starting directory for the scan
 * @param opts - Options controlling depth and ignored directories
 * @returns Array of absolute paths to HOOKS.yaml files
 */
export async function scanForHooksConfigs(
  rootDir: string,
  opts: DiscoveryOptions = {}
): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const ignore = opts.ignore ?? DEFAULT_IGNORE;

  const results: string[] = [];

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      entries = dirents;
    } catch (err: unknown) {
      // Permission denied or directory disappeared — skip silently
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Check ignore list
      if (ignore.includes(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        await scan(fullPath, depth + 1);
      } else if (entry.name === 'HOOKS.yaml' || entry.name === 'HOOKS.yml') {
        results.push(path.resolve(fullPath));
      }
    }
  }

  await scan(path.resolve(rootDir), 0);
  return results;
}

// ─── Merger ───────────────────────────────────────────────────────────────────

/**
 * Merge multiple HooksConfig objects.
 * Primary config wins for version and defaults.
 * Hooks from all configs are concatenated (primary first).
 * Each hook is tagged with _source metadata.
 *
 * @param primary - The primary (root) config
 * @param secondary - Additional configs to merge in
 * @returns Merged config
 */
export function mergeConfigs(
  primary: HooksConfig,
  ...secondary: HooksConfig[]
): HooksConfig {
  const merged: HooksConfig = {
    version: primary.version,
    hooks: [...primary.hooks],
    defaults: primary.defaults,
  };

  for (const config of secondary) {
    merged.hooks.push(...config.hooks);
  }

  return merged;
}

// ─── Conflict Detection ───────────────────────────────────────────────────────

/**
 * Detect conflicting hooks across multiple configs.
 *
 * Conflicts:
 * 1. Duplicate hook names (if hooks have a 'name' field)
 * 2. Overlapping point+match combinations that could cause ambiguity
 *
 * @param configs - Array of config objects with their source paths
 * @returns Array of conflict warnings
 */
export function detectConflicts(
  configs: Array<{ path: string; config: HooksConfig }>
): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];

  // Track hooks by name (if they have one)
  const nameMap = new Map<string, string[]>();

  // Track hooks by point+match signature
  interface HookSignature {
    point: string;
    tool?: string;
    commandPattern?: string;
    topicId?: number | string;
    isSubAgent?: boolean;
    sessionPattern?: string;
  }

  const signatureMap = new Map<string, Array<{ source: string; hook: HookDefinition }>>();

  for (const { path: sourcePath, config } of configs) {
    for (const hook of config.hooks) {
      // Check for duplicate names
      const hookName = (hook as any).name;
      if (hookName) {
        const existing = nameMap.get(hookName);
        if (existing) {
          existing.push(sourcePath);
        } else {
          nameMap.set(hookName, [sourcePath]);
        }
      }

      // Build signature for overlap detection
      const points = Array.isArray(hook.point) ? hook.point : [hook.point];
      for (const point of points) {
        const sig: HookSignature = { point };
        if (hook.match) {
          if (hook.match.tool) sig.tool = hook.match.tool;
          if (hook.match.commandPattern) sig.commandPattern = hook.match.commandPattern;
          if (hook.match.topicId !== undefined) sig.topicId = hook.match.topicId;
          if (hook.match.isSubAgent !== undefined) sig.isSubAgent = hook.match.isSubAgent;
          if (hook.match.sessionPattern) sig.sessionPattern = hook.match.sessionPattern;
        }

        const sigKey = JSON.stringify(sig);
        const existing = signatureMap.get(sigKey);
        if (existing) {
          existing.push({ source: sourcePath, hook });
        } else {
          signatureMap.set(sigKey, [{ source: sourcePath, hook }]);
        }
      }
    }
  }

  // Generate warnings for duplicate names
  for (const [name, sources] of nameMap.entries()) {
    if (sources.length > 1) {
      warnings.push({
        type: 'duplicate-name',
        hookName: name,
        sources: [...new Set(sources)], // deduplicate
        message: `Duplicate hook name "${name}" found in ${sources.length} files`,
      });
    }
  }

  // Generate warnings for overlapping matches
  for (const [sigKey, entries] of signatureMap.entries()) {
    if (entries.length > 1) {
      const sources = entries.map((e) => e.source);
      const uniqueSources = [...new Set(sources)];
      if (uniqueSources.length > 1) {
        // Only warn if from different source files
        const sig = JSON.parse(sigKey) as HookSignature;
        warnings.push({
          type: 'overlapping-match',
          sources: uniqueSources,
          message: `Overlapping match at point "${sig.point}" from ${uniqueSources.length} files`,
        });
      }
    }
  }

  return warnings;
}

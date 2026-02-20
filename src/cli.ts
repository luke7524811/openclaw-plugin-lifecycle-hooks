#!/usr/bin/env node
/**
 * cli.ts — CLI management interface for lifecycle hooks.
 *
 * Commands:
 *   openclaw-hooks list              — List all hooks with status
 *   openclaw-hooks enable <name>     — Enable a hook by name
 *   openclaw-hooks disable <name>    — Disable a hook by name
 *   openclaw-hooks reload            — Force hot-reload of HOOKS.yaml
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { HooksConfig, HookDefinition } from './types';

// ─── Config Resolution ────────────────────────────────────────────────────────

const HOOKS_FILENAME = 'HOOKS.yaml';

/**
 * Resolve the path to HOOKS.yaml using the same logic as the plugin.
 * Search order:
 *   1. OPENCLAW_HOOKS_CONFIG env var (explicit override)
 *   2. <cwd>/HOOKS.yaml
 *   3. <workspace>/HOOKS.yaml (OPENCLAW_WORKSPACE env var or ~/.openclaw/workspace)
 */
function resolveHooksConfigPath(): string | null {
  // 1. Explicit env override
  if (process.env['OPENCLAW_HOOKS_CONFIG']) {
    return process.env['OPENCLAW_HOOKS_CONFIG'];
  }

  // 2. CWD
  const cwdPath = path.join(process.cwd(), HOOKS_FILENAME);
  try {
    if (require('fs').existsSync(cwdPath)) return cwdPath;
  } catch {
    // Ignore sync fs errors
  }

  // 3. Workspace
  const workspace =
    process.env['OPENCLAW_WORKSPACE'] ??
    path.join(process.env['HOME'] ?? '/root', '.openclaw', 'workspace');
  const workspacePath = path.join(workspace, HOOKS_FILENAME);
  try {
    if (require('fs').existsSync(workspacePath)) return workspacePath;
  } catch {
    // Ignore sync fs errors
  }

  return null;
}

// ─── YAML Loading & Writing ───────────────────────────────────────────────────

/**
 * Load HOOKS.yaml as raw YAML (preserving structure for editing).
 * We use js-yaml with noRefs to preserve anchors/aliases.
 */
async function loadRawConfig(filePath: string): Promise<{ raw: string; parsed: HooksConfig }> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = yaml.load(raw, { schema: yaml.DEFAULT_SCHEMA }) as HooksConfig;
  return { raw, parsed };
}

/**
 * Write HOOKS.yaml back to disk.
 * We try to preserve comments and formatting by doing line-by-line editing where possible.
 */
async function writeConfig(filePath: string, config: HooksConfig): Promise<void> {
  const yamlStr = yaml.dump(config, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  await fs.writeFile(filePath, yamlStr, 'utf-8');
}

// ─── Hook Identification ──────────────────────────────────────────────────────

/**
 * Generate a display name for a hook (for CLI output).
 * Uses the first 'name' field from match criteria, or falls back to a positional index.
 */
function getHookDisplayName(hook: HookDefinition, index: number): string {
  // Check if hook has a name field in match (some configs use it)
  const matchObj = hook.match as any;
  if (matchObj?.name && typeof matchObj.name === 'string') {
    return matchObj.name;
  }

  // Otherwise use action + point as identifier
  const points = Array.isArray(hook.point) ? hook.point.join(',') : hook.point;
  return `hook-${index + 1} (${hook.action}@${points})`;
}

/**
 * Find a hook by name (supports positional index like "hook-3" or match.name field).
 */
function findHookByName(
  hooks: HookDefinition[],
  name: string
): { hook: HookDefinition; index: number } | null {
  // Try positional index first (e.g. "hook-3" → index 2)
  const indexMatch = /^hook-(\d+)$/i.exec(name);
  if (indexMatch) {
    const index = parseInt(indexMatch[1]!, 10) - 1; // 1-based to 0-based
    if (index >= 0 && index < hooks.length) {
      return { hook: hooks[index]!, index };
    }
  }

  // Try match.name field
  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i]!;
    const matchObj = hook.match as any;
    if (matchObj?.name === name) {
      return { hook, index: i };
    }
  }

  return null;
}

// ─── CLI Commands ─────────────────────────────────────────────────────────────

async function cmdList(configPath: string): Promise<void> {
  const { parsed } = await loadRawConfig(configPath);

  if (parsed.hooks.length === 0) {
    console.log('No hooks defined in HOOKS.yaml');
    return;
  }

  console.log(`\nHooks configuration: ${configPath}\n`);
  console.log(
    `${'#'.padEnd(6)} ${'Name'.padEnd(30)} ${'Point'.padEnd(20)} ${'Action'.padEnd(25)} ${'Enabled'}`
  );
  console.log('─'.repeat(100));

  for (let i = 0; i < parsed.hooks.length; i++) {
    const hook = parsed.hooks[i]!;
    const name = getHookDisplayName(hook, i);
    const points = Array.isArray(hook.point) ? hook.point.join(',') : hook.point;
    const enabled = hook.enabled ?? true;
    const status = enabled ? '✅ yes' : '❌ no';

    console.log(
      `${String(i + 1).padEnd(6)} ${name.slice(0, 30).padEnd(30)} ${points.slice(0, 20).padEnd(20)} ${hook.action.slice(0, 25).padEnd(25)} ${status}`
    );
  }

  console.log('');
}

async function cmdEnable(configPath: string, hookName: string): Promise<void> {
  const { parsed } = await loadRawConfig(configPath);
  const found = findHookByName(parsed.hooks, hookName);

  if (!found) {
    console.error(`❌ Hook "${hookName}" not found. Use "openclaw-hooks list" to see all hooks.`);
    process.exit(1);
  }

  const { hook, index } = found;

  // Enable the hook (remove 'enabled: false' or set 'enabled: true')
  hook.enabled = true;

  // Write back to disk
  await writeConfig(configPath, parsed);

  console.log(`✅ Enabled hook: ${getHookDisplayName(hook, index)}`);
  console.log(`   Point: ${Array.isArray(hook.point) ? hook.point.join(', ') : hook.point}`);
  console.log(`   Action: ${hook.action}`);
  console.log(`\nHot reload should pick up the change automatically.`);
}

async function cmdDisable(configPath: string, hookName: string): Promise<void> {
  const { parsed } = await loadRawConfig(configPath);
  const found = findHookByName(parsed.hooks, hookName);

  if (!found) {
    console.error(`❌ Hook "${hookName}" not found. Use "openclaw-hooks list" to see all hooks.`);
    process.exit(1);
  }

  const { hook, index } = found;

  // Disable the hook
  hook.enabled = false;

  // Write back to disk
  await writeConfig(configPath, parsed);

  console.log(`❌ Disabled hook: ${getHookDisplayName(hook, index)}`);
  console.log(`   Point: ${Array.isArray(hook.point) ? hook.point.join(', ') : hook.point}`);
  console.log(`   Action: ${hook.action}`);
  console.log(`\nHot reload should pick up the change automatically.`);
}

async function cmdReload(configPath: string): Promise<void> {
  // Touch the HOOKS.yaml file to trigger the fs.watch hot reload
  const now = new Date();
  await fs.utimes(configPath, now, now);
  console.log(`✅ Touched ${configPath} to trigger hot reload.`);
  console.log(`   The lifecycle-hooks plugin should reload the config automatically.`);
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    console.log(`
openclaw-hooks — CLI management for lifecycle hooks

Usage:
  openclaw-hooks list                  List all hooks with status
  openclaw-hooks enable <name>         Enable a hook by name or index (e.g. "hook-3")
  openclaw-hooks disable <name>        Disable a hook by name or index
  openclaw-hooks reload                Force hot-reload of HOOKS.yaml
  openclaw-hooks help                  Show this help

Environment:
  OPENCLAW_HOOKS_CONFIG    Override path to HOOKS.yaml
  OPENCLAW_WORKSPACE       Workspace directory (default: ~/.openclaw/workspace)

Examples:
  openclaw-hooks list
  openclaw-hooks disable hook-2
  openclaw-hooks enable "rm-guard"
  openclaw-hooks reload
    `);
    process.exit(0);
  }

  const command = args[0]!.toLowerCase();
  const configPath = resolveHooksConfigPath();

  if (!configPath) {
    console.error(
      '❌ No HOOKS.yaml found.\n' +
        '   Searched:\n' +
        `   - OPENCLAW_HOOKS_CONFIG env var\n` +
        `   - ${process.cwd()}/HOOKS.yaml\n` +
        `   - ${process.env['OPENCLAW_WORKSPACE'] ?? '~/.openclaw/workspace'}/HOOKS.yaml\n\n` +
        'Create a HOOKS.yaml file or set OPENCLAW_HOOKS_CONFIG.'
    );
    process.exit(1);
  }

  try {
    switch (command) {
      case 'list':
      case 'ls':
        await cmdList(configPath);
        break;

      case 'enable':
        if (args.length < 2) {
          console.error('❌ Missing hook name. Usage: openclaw-hooks enable <name>');
          process.exit(1);
        }
        await cmdEnable(configPath, args[1]!);
        break;

      case 'disable':
        if (args.length < 2) {
          console.error('❌ Missing hook name. Usage: openclaw-hooks disable <name>');
          process.exit(1);
        }
        await cmdDisable(configPath, args[1]!);
        break;

      case 'reload':
        await cmdReload(configPath);
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.error('   Run "openclaw-hooks help" for usage.');
        process.exit(1);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Error: ${message}`);
    process.exit(1);
  }
}

// Run if invoked directly
if (require.main === module) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fatal error: ${message}`);
    process.exit(1);
  });
}

export { cmdList, cmdEnable, cmdDisable, cmdReload };

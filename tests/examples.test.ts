/**
 * tests/examples.test.ts — Example config validation tests.
 *
 * Loads every YAML file from examples/ directory and validates it through the
 * config loader. Verifies all hook points and action names are valid.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadHooksConfig } from '../src/config';
import type { HooksConfig } from '../src/types';

// ─── Valid hook points and actions ────────────────────────────────────────────

const VALID_HOOK_POINTS = new Set([
  'turn:pre',
  'turn:post',
  'turn:tool:pre',
  'turn:tool:post',
  'subagent:spawn:pre',
  'subagent:pre',
  'subagent:post',
  'subagent:tool:pre',
  'subagent:tool:post',
  'heartbeat:pre',
  'heartbeat:post',
  'cron:pre',
  'cron:post',
]);

const VALID_BUILTIN_ACTIONS = new Set([
  'block',
  'log',
  'summarize_and_log',
  'inject_context',
  'inject_origin',
  'exec_script',
  'notify_user',
]);

const VALID_FAILURE_ACTIONS = new Set(['block', 'retry', 'notify', 'continue']);

const EXAMPLES_DIR = path.resolve(__dirname, '../examples');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get all .yaml and .yml files from the examples directory.
 */
async function getExampleFiles(): Promise<string[]> {
  const entries = await fs.readdir(EXAMPLES_DIR);
  return entries
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => path.join(EXAMPLES_DIR, f))
    .sort();
}

/**
 * Collect all hook points used across all hooks in a config.
 */
function collectPoints(config: HooksConfig): string[] {
  const points: string[] = [];
  for (const hook of config.hooks) {
    const hookPoints = Array.isArray(hook.point) ? hook.point : [hook.point];
    points.push(...hookPoints);
  }
  return points;
}

/**
 * Collect all action names used across all hooks in a config.
 */
function collectActions(config: HooksConfig): string[] {
  return config.hooks.map(h => h.action);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Example config validation', () => {

  it('examples/ directory exists and contains YAML files', async () => {
    const files = await getExampleFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.every(f => f.endsWith('.yaml') || f.endsWith('.yml'))).toBe(true);
  });

  // Dynamically generate a test for each example file
  describe('each example file validates without errors', async () => {
    let exampleFiles: string[] = [];

    try {
      exampleFiles = await getExampleFiles();
    } catch {
      // Will be caught in the test
    }

    for (const filePath of exampleFiles) {
      const filename = path.basename(filePath);

      it(`${filename} — parses and validates successfully`, async () => {
        const config = await loadHooksConfig(filePath);

        // Basic structure
        expect(config).toHaveProperty('version');
        expect(config).toHaveProperty('hooks');
        expect(Array.isArray(config.hooks)).toBe(true);
        expect(typeof config.version).toBe('string');
      });

      it(`${filename} — all hook points are valid`, async () => {
        const config = await loadHooksConfig(filePath);
        const points = collectPoints(config);

        for (const point of points) {
          expect(VALID_HOOK_POINTS.has(point),
            `Invalid hook point "${point}" in ${filename}`
          ).toBe(true);
        }
      });

      it(`${filename} — all action names are recognized built-ins or custom paths`, async () => {
        const config = await loadHooksConfig(filePath);
        const actions = collectActions(config);

        for (const action of actions) {
          // Either a built-in action, or looks like a file path (custom action)
          const isBuiltIn = VALID_BUILTIN_ACTIONS.has(action);
          const isCustomPath = action.includes('/') || action.includes('.js') || action.includes('.ts');
          expect(isBuiltIn || isCustomPath,
            `Action "${action}" in ${filename} is neither a built-in nor a file path`
          ).toBe(true);
        }
      });

      it(`${filename} — all onFailure actions are valid`, async () => {
        const config = await loadHooksConfig(filePath);

        for (const hook of config.hooks) {
          if (hook.onFailure) {
            expect(VALID_FAILURE_ACTIONS.has(hook.onFailure.action),
              `Invalid onFailure.action "${hook.onFailure.action}" in ${filename}`
            ).toBe(true);
          }
        }

        if (config.defaults?.onFailure) {
          expect(VALID_FAILURE_ACTIONS.has(config.defaults.onFailure.action),
            `Invalid defaults.onFailure.action "${config.defaults.onFailure.action}" in ${filename}`
          ).toBe(true);
        }
      });

      it(`${filename} — version is "1" or equivalent`, async () => {
        const config = await loadHooksConfig(filePath);
        // All current examples should be version "1"
        expect(config.version).toBe('1');
      });
    }
  });

  describe('specific example files', () => {

    it('rm-guard.yaml — contains rm-blocking hooks', async () => {
      const config = await loadHooksConfig(path.join(EXAMPLES_DIR, 'rm-guard.yaml'));
      expect(config.hooks.length).toBeGreaterThan(0);

      // Should have at least one block action
      const blockHooks = config.hooks.filter(h => h.action === 'block');
      expect(blockHooks.length).toBeGreaterThan(0);

      // Should have commandPattern matching rm
      const rmHooks = blockHooks.filter(h => h.match?.commandPattern?.includes('rm'));
      expect(rmHooks.length).toBeGreaterThan(0);
    });

    it('kitchen-sink.yaml — covers multiple hook points', async () => {
      const config = await loadHooksConfig(path.join(EXAMPLES_DIR, 'kitchen-sink.yaml'));
      const points = new Set(collectPoints(config));
      // Kitchen sink should have at least 5 different hook points
      expect(points.size).toBeGreaterThanOrEqual(5);
    });

    it('topic-logging.yaml — uses summarize_and_log or log action', async () => {
      const config = await loadHooksConfig(path.join(EXAMPLES_DIR, 'topic-logging.yaml'));
      const actions = new Set(collectActions(config));
      const hasLoggingAction = actions.has('log') || actions.has('summarize_and_log');
      expect(hasLoggingAction).toBe(true);
    });

    it('subagent-context.yaml — has subagent hook points', async () => {
      const config = await loadHooksConfig(path.join(EXAMPLES_DIR, 'subagent-context.yaml'));
      const points = collectPoints(config);
      const subagentPoints = points.filter(p => p.startsWith('subagent:'));
      expect(subagentPoints.length).toBeGreaterThan(0);
    });

    it('heartbeat-dashboard.yaml — has heartbeat hook points', async () => {
      const config = await loadHooksConfig(path.join(EXAMPLES_DIR, 'heartbeat-dashboard.yaml'));
      const points = collectPoints(config);
      const heartbeatPoints = points.filter(p => p.startsWith('heartbeat:'));
      expect(heartbeatPoints.length).toBeGreaterThan(0);
    });

    it('notification-webhook.yaml — uses exec_script action', async () => {
      const config = await loadHooksConfig(path.join(EXAMPLES_DIR, 'notification-webhook.yaml'));
      const actions = collectActions(config);
      expect(actions).toContain('exec_script');
    });

  });

  describe('config structure invariants', () => {

    it('all example files have at least one hook defined', async () => {
      const files = await getExampleFiles();
      for (const filePath of files) {
        const config = await loadHooksConfig(filePath);
        expect(config.hooks.length,
          `${path.basename(filePath)} has no hooks defined`
        ).toBeGreaterThan(0);
      }
    });

    it('all example files use string version "1"', async () => {
      const files = await getExampleFiles();
      for (const filePath of files) {
        const config = await loadHooksConfig(filePath);
        expect(config.version,
          `${path.basename(filePath)} should use version "1"`
        ).toBe('1');
      }
    });

    it('all hooks have non-empty action strings', async () => {
      const files = await getExampleFiles();
      for (const filePath of files) {
        const config = await loadHooksConfig(filePath);
        for (const hook of config.hooks) {
          expect(typeof hook.action).toBe('string');
          expect(hook.action.trim().length,
            `Empty action in ${path.basename(filePath)}`
          ).toBeGreaterThan(0);
        }
      }
    });

    it('enabled field, when present, is a boolean', async () => {
      const files = await getExampleFiles();
      for (const filePath of files) {
        const config = await loadHooksConfig(filePath);
        for (const hook of config.hooks) {
          if (hook.enabled !== undefined) {
            expect(typeof hook.enabled,
              `enabled field should be boolean in ${path.basename(filePath)}`
            ).toBe('boolean');
          }
        }
      }
    });

    it('onFailure.retries, when present, is a positive number', async () => {
      const files = await getExampleFiles();
      for (const filePath of files) {
        const config = await loadHooksConfig(filePath);
        for (const hook of config.hooks) {
          if (hook.onFailure?.retries !== undefined) {
            expect(typeof hook.onFailure.retries).toBe('number');
            expect(hook.onFailure.retries).toBeGreaterThan(0);
          }
        }
      }
    });

  });

});

/**
 * discovery.test.ts — Tests for auto-discovery scanner and merger.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { scanForHooksConfigs, mergeConfigs, detectConflicts } from '../discovery';
import type { HooksConfig, ConflictWarning } from '../types';

// Test workspace directory
const TEST_ROOT = path.join(__dirname, '__test_workspace__');

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  // Clean slate for each test
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await fs.mkdir(TEST_ROOT, { recursive: true });
});

afterEach(async () => {
  // Cleanup
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

// ─── Helper Functions ─────────────────────────────────────────────────────────

async function createHooksFile(relativePath: string, content: string): Promise<string> {
  const fullPath = path.join(TEST_ROOT, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

// ─── Tests: scanForHooksConfigs ───────────────────────────────────────────────

describe('scanForHooksConfigs', () => {
  it('finds nested HOOKS.yaml files', async () => {
    await createHooksFile('HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('sub1/HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('sub1/sub2/HOOKS.yaml', 'version: "1"\nhooks: []');

    const results = await scanForHooksConfigs(TEST_ROOT);

    expect(results).toHaveLength(3);
    expect(results.map((p) => path.relative(TEST_ROOT, p)).sort()).toEqual([
      'HOOKS.yaml',
      'sub1/HOOKS.yaml',
      'sub1/sub2/HOOKS.yaml',
    ]);
  });

  it('respects maxDepth', async () => {
    await createHooksFile('HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('sub1/HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('sub1/sub2/HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('sub1/sub2/sub3/HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('sub1/sub2/sub3/sub4/HOOKS.yaml', 'version: "1"\nhooks: []');

    const results = await scanForHooksConfigs(TEST_ROOT, { maxDepth: 2 });

    expect(results).toHaveLength(3);
    expect(results.map((p) => path.relative(TEST_ROOT, p)).sort()).toEqual([
      'HOOKS.yaml',
      'sub1/HOOKS.yaml',
      'sub1/sub2/HOOKS.yaml',
    ]);
  });

  it('ignores node_modules, .git, and dist by default', async () => {
    await createHooksFile('HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('node_modules/HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('.git/HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('dist/HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('ok/HOOKS.yaml', 'version: "1"\nhooks: []');

    const results = await scanForHooksConfigs(TEST_ROOT);

    expect(results).toHaveLength(2);
    expect(results.map((p) => path.relative(TEST_ROOT, p)).sort()).toEqual([
      'HOOKS.yaml',
      'ok/HOOKS.yaml',
    ]);
  });

  it('respects custom ignore list', async () => {
    await createHooksFile('HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('build/HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('temp/HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('ok/HOOKS.yaml', 'version: "1"\nhooks: []');

    const results = await scanForHooksConfigs(TEST_ROOT, {
      ignore: ['build', 'temp'],
    });

    expect(results).toHaveLength(2);
    expect(results.map((p) => path.relative(TEST_ROOT, p)).sort()).toEqual([
      'HOOKS.yaml',
      'ok/HOOKS.yaml',
    ]);
  });

  it('finds both HOOKS.yaml and HOOKS.yml', async () => {
    await createHooksFile('a/HOOKS.yaml', 'version: "1"\nhooks: []');
    await createHooksFile('b/HOOKS.yml', 'version: "1"\nhooks: []');

    const results = await scanForHooksConfigs(TEST_ROOT);

    expect(results).toHaveLength(2);
  });

  it('handles empty directory gracefully', async () => {
    const results = await scanForHooksConfigs(TEST_ROOT);
    expect(results).toEqual([]);
  });
});

// ─── Tests: mergeConfigs ──────────────────────────────────────────────────────

describe('mergeConfigs', () => {
  it('combines hooks from multiple sources', () => {
    const primary: HooksConfig = {
      version: '1',
      hooks: [
        { point: 'turn:pre', action: 'log', _source: '/root/HOOKS.yaml' },
      ],
    };

    const secondary: HooksConfig = {
      version: '1',
      hooks: [
        { point: 'turn:post', action: 'log', _source: '/sub/HOOKS.yaml' },
      ],
    };

    const merged = mergeConfigs(primary, secondary);

    expect(merged.hooks).toHaveLength(2);
    expect(merged.hooks[0].point).toBe('turn:pre');
    expect(merged.hooks[1].point).toBe('turn:post');
  });

  it('preserves _source metadata', () => {
    const primary: HooksConfig = {
      version: '1',
      hooks: [
        { point: 'turn:pre', action: 'log', _source: '/root/HOOKS.yaml' },
      ],
    };

    const secondary: HooksConfig = {
      version: '1',
      hooks: [
        { point: 'turn:post', action: 'log', _source: '/sub/HOOKS.yaml' },
      ],
    };

    const merged = mergeConfigs(primary, secondary);

    expect(merged.hooks[0]._source).toBe('/root/HOOKS.yaml');
    expect(merged.hooks[1]._source).toBe('/sub/HOOKS.yaml');
  });

  it('primary defaults win', () => {
    const primary: HooksConfig = {
      version: '1',
      hooks: [],
      defaults: {
        model: 'gpt-4',
        onFailure: { action: 'block' },
      },
    };

    const secondary: HooksConfig = {
      version: '2',
      hooks: [],
      defaults: {
        model: 'gpt-3',
        onFailure: { action: 'continue' },
      },
    };

    const merged = mergeConfigs(primary, secondary);

    expect(merged.version).toBe('1');
    expect(merged.defaults?.model).toBe('gpt-4');
    expect(merged.defaults?.onFailure?.action).toBe('block');
  });

  it('handles multiple secondary configs', () => {
    const primary: HooksConfig = {
      version: '1',
      hooks: [{ point: 'turn:pre', action: 'log' }],
    };

    const sec1: HooksConfig = {
      version: '1',
      hooks: [{ point: 'turn:post', action: 'log' }],
    };

    const sec2: HooksConfig = {
      version: '1',
      hooks: [{ point: 'turn:tool:pre', action: 'log' }],
    };

    const merged = mergeConfigs(primary, sec1, sec2);

    expect(merged.hooks).toHaveLength(3);
    expect(merged.hooks[0].point).toBe('turn:pre');
    expect(merged.hooks[1].point).toBe('turn:post');
    expect(merged.hooks[2].point).toBe('turn:tool:pre');
  });
});

// ─── Tests: detectConflicts ───────────────────────────────────────────────────

describe('detectConflicts', () => {
  it('catches duplicate names', () => {
    const configs: Array<{ path: string; config: HooksConfig }> = [
      {
        path: '/root/HOOKS.yaml',
        config: {
          version: '1',
          hooks: [
            { point: 'turn:pre' as const, action: 'log', name: 'my-hook' } as any,
          ],
        },
      },
      {
        path: '/sub/HOOKS.yaml',
        config: {
          version: '1',
          hooks: [
            { point: 'turn:post' as const, action: 'log', name: 'my-hook' } as any,
          ],
        },
      },
    ];

    const conflicts = detectConflicts(configs);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe('duplicate-name');
    expect(conflicts[0].hookName).toBe('my-hook');
    expect(conflicts[0].sources).toEqual(['/root/HOOKS.yaml', '/sub/HOOKS.yaml']);
  });

  it('catches overlapping point+match combinations', () => {
    const configs: Array<{ path: string; config: HooksConfig }> = [
      {
        path: '/root/HOOKS.yaml',
        config: {
          version: '1',
          hooks: [
            {
              point: 'turn:pre' as const,
              action: 'log',
              match: { tool: 'exec' },
            },
          ],
        },
      },
      {
        path: '/sub/HOOKS.yaml',
        config: {
          version: '1',
          hooks: [
            {
              point: 'turn:pre' as const,
              action: 'block',
              match: { tool: 'exec' },
            },
          ],
        },
      },
    ];

    const conflicts = detectConflicts(configs);

    expect(conflicts.some((c) => c.type === 'overlapping-match')).toBe(true);
  });

  it('handles no conflicts gracefully', () => {
    const configs: Array<{ path: string; config: HooksConfig }> = [
      {
        path: '/root/HOOKS.yaml',
        config: {
          version: '1',
          hooks: [
            { point: 'turn:pre' as const, action: 'log' },
          ],
        },
      },
      {
        path: '/sub/HOOKS.yaml',
        config: {
          version: '1',
          hooks: [
            { point: 'turn:post' as const, action: 'log' },
          ],
        },
      },
    ];

    const conflicts = detectConflicts(configs);

    expect(conflicts).toHaveLength(0);
  });

  it('does not warn about duplicates within the same file', () => {
    const configs: Array<{ path: string; config: HooksConfig }> = [
      {
        path: '/root/HOOKS.yaml',
        config: {
          version: '1',
          hooks: [
            { point: 'turn:pre' as const, action: 'log', match: { tool: 'exec' } },
            { point: 'turn:pre' as const, action: 'log', match: { tool: 'exec' } },
          ],
        },
      },
    ];

    const conflicts = detectConflicts(configs);

    // Overlapping within same file is allowed (no cross-file conflict)
    expect(conflicts).toHaveLength(0);
  });
});

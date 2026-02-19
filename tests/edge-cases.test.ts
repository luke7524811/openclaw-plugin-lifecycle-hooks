/**
 * tests/edge-cases.test.ts — Edge case and resilience tests.
 *
 * Tests for: malformed config, action errors, recursion prevention,
 * large configs, concurrent execution, and filter logic edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LifecycleGateEngine } from '../src/engine';
import { loadHooksConfig, ConfigValidationError } from '../src/config';
import type { HookContext, HooksConfig } from '../src/types';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hooks-edge-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function writeYaml(content: string): Promise<string> {
  const filePath = path.join(tmpDir, `hooks-${Date.now()}-${Math.random()}.yaml`);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

function injectConfig(engine: LifecycleGateEngine, config: HooksConfig): void {
  (engine as unknown as { config: HooksConfig }).config = config;
}

function makeEngine(config: HooksConfig): LifecycleGateEngine {
  const engine = new LifecycleGateEngine();
  injectConfig(engine, config);
  return engine;
}

const baseContext: HookContext = {
  point: 'turn:pre',
  sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
  topicId: 42,
  timestamp: Date.now(),
};

// ─── Malformed HOOKS.yaml ────────────────────────────────────────────────────

describe('Malformed HOOKS.yaml', () => {

  it('missing required fields: version throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`
hooks:
  - point: turn:pre
    action: log
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
    await expect(loadHooksConfig(filePath)).rejects.toThrow('version');
  });

  it('missing required fields: hooks array throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`version: "1"`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
    await expect(loadHooksConfig(filePath)).rejects.toThrow('hooks');
  });

  it('missing required fields: hook.point throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - action: log
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
    await expect(loadHooksConfig(filePath)).rejects.toThrow('point');
  });

  it('missing required fields: hook.action throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - point: turn:pre
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
    await expect(loadHooksConfig(filePath)).rejects.toThrow('action');
  });

  it('unknown hook point throws ConfigValidationError with informative message', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - point: invalid:hook:point
    action: log
`);
    const err = await loadHooksConfig(filePath).catch(e => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.message).toContain('invalid:hook:point');
    // Error message should include valid options
    expect(err.message).toContain('turn:pre');
  });

  it('invalid onFailure.action throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - point: turn:pre
    action: log
    onFailure:
      action: explode
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
  });

  it('hooks as non-array throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks: "not-an-array"
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
    await expect(loadHooksConfig(filePath)).rejects.toThrow('array');
  });

  it('completely empty YAML throws an error', async () => {
    const filePath = await writeYaml('');
    await expect(loadHooksConfig(filePath)).rejects.toThrow();
  });

  it('null YAML document throws ConfigValidationError', async () => {
    const filePath = await writeYaml('~');
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
  });

  it('invalid YAML syntax throws a parse error', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - point: turn:pre
    action: : : invalid yaml :::
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow();
  });

  it('top-level non-object YAML throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`- just a list`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
  });

  it('empty action string throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - point: turn:pre
    action: ""
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
  });

  it('provides field path in ConfigValidationError.field', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - action: log
`);
    const err = await loadHooksConfig(filePath).catch(e => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.field).toContain('point');
  });

  it('invalid match.topicId (object) throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - point: turn:pre
    action: log
    match:
      topicId:
        nested: object
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
    await expect(loadHooksConfig(filePath)).rejects.toThrow('topicId');
  });

  it('invalid match.isSubAgent (non-boolean) throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - point: turn:pre
    action: log
    match:
      isSubAgent: "yes"
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
    await expect(loadHooksConfig(filePath)).rejects.toThrow('isSubAgent');
  });

  it('match filter as non-object (array) throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - point: turn:pre
    action: log
    match:
      - tool: exec
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
    await expect(loadHooksConfig(filePath)).rejects.toThrow('match');
  });

  it('onFailure.retries as non-integer throws ConfigValidationError', async () => {
    const filePath = await writeYaml(`
version: "1"
hooks:
  - point: turn:pre
    action: log
    onFailure:
      action: retry
      retries: 0
`);
    await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
    await expect(loadHooksConfig(filePath)).rejects.toThrow('retries');
  });

});

// ─── Hook action throws — verify onFailure kicks in ─────────────────────────

describe('Hook action throws an error', () => {

  it('custom action load failure → onFailure:block → pipeline blocked', async () => {
    const engine = makeEngine({
      version: '1',
      hooks: [{
        point: 'turn:pre',
        action: '/definitely/not/a/real/module.js',
        onFailure: { action: 'block', message: 'Hook system error' },
      }],
    });
    const results = await engine.execute('turn:pre', baseContext);
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.message).toContain('Hook system error');
  });

  it('custom action load failure → onFailure:continue → pipeline passes', async () => {
    const engine = makeEngine({
      version: '1',
      hooks: [{
        point: 'turn:pre',
        action: '/definitely/not/a/real/module.js',
        onFailure: { action: 'continue' },
      }],
    });
    const results = await engine.execute('turn:pre', baseContext);
    expect(results[0]!.passed).toBe(true);
    expect(results[0]!.message).toContain('continuing');
  });

  it('custom action load failure → no onFailure → engine default is continue → passed=true', async () => {
    // Default onFailure when none specified: engine defaults to 'continue'
    // (see handleActionError: const failureAction = onFailure?.action ?? 'continue')
    const engine = makeEngine({
      version: '1',
      hooks: [{
        point: 'turn:pre',
        action: '/definitely/not/a/real/module.js',
        // no onFailure — engine defaults to 'continue'
      }],
    });
    const results = await engine.execute('turn:pre', baseContext);
    expect(results).toHaveLength(1);
    // No onFailure = continue = passed=true
    expect(results[0]!.passed).toBe(true);
  });

  it('custom action load failure → onFailure:notify → pipeline passes', async () => {
    const engine = makeEngine({
      version: '1',
      hooks: [{
        point: 'turn:pre',
        action: '/not/real/action.js',
        onFailure: { action: 'notify' },
      }],
    });
    const results = await engine.execute('turn:pre', baseContext);
    expect(results[0]!.passed).toBe(true);
  });

});

// ─── Recursive hook prevention ───────────────────────────────────────────────

describe('Recursive hook prevention', () => {

  it('engine does not re-enter itself during hook execution', async () => {
    // The engine processes hooks sequentially. Even if a hook conceptually
    // triggers the same point, the engine itself doesn't recurse — it only
    // fires hooks for explicit execute() calls. Test that execute() is not
    // called recursively from within a hook action.
    let executeCallCount = 0;
    const engine = makeEngine({
      version: '1',
      hooks: [
        { point: 'turn:pre', action: 'log' },
        { point: 'turn:pre', action: 'log' },
      ],
    });

    // Spy to count execute calls
    const originalExecute = engine.execute.bind(engine);
    vi.spyOn(engine, 'execute').mockImplementation(async (point, context) => {
      executeCallCount++;
      return originalExecute(point, context);
    });

    await engine.execute('turn:pre', baseContext);
    // Only one explicit execute call — no recursion
    expect(executeCallCount).toBe(1);
  });

  it('hooks at different points do not cross-trigger each other', async () => {
    const engine = makeEngine({
      version: '1',
      hooks: [
        { point: 'turn:pre', action: 'log' },
        { point: 'turn:post', action: 'block' },
      ],
    });
    // Execute turn:pre — should only fire the log hook, not the turn:post block
    const results = await engine.execute('turn:pre', baseContext);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
  });

});

// ─── Very large hook config ──────────────────────────────────────────────────

describe('Very large hook config', () => {

  it('100+ hooks execute without performance degradation', async () => {
    const hooks = Array.from({ length: 150 }, (_, i) => ({
      point: 'turn:pre' as const,
      action: 'log',
    }));
    const engine = makeEngine({ version: '1', hooks });

    const startTime = Date.now();
    const results = await engine.execute('turn:pre', baseContext);
    const elapsed = Date.now() - startTime;

    expect(results).toHaveLength(150);
    expect(results.every(r => r.passed)).toBe(true);
    // 150 log hooks to stdout should complete well under 5 seconds
    expect(elapsed).toBeLessThan(5000);
  });

  it('100+ hooks with block in middle short-circuits correctly', async () => {
    const hooksBeforeBlock = Array.from({ length: 50 }, () => ({
      point: 'turn:pre' as const,
      action: 'log',
    }));
    const hooksAfterBlock = Array.from({ length: 50 }, () => ({
      point: 'turn:pre' as const,
      action: 'log',
    }));
    const engine = makeEngine({
      version: '1',
      hooks: [
        ...hooksBeforeBlock,
        { point: 'turn:pre', action: 'block' },
        ...hooksAfterBlock,
      ],
    });

    const results = await engine.execute('turn:pre', baseContext);
    expect(results).toHaveLength(51); // 50 logs + 1 block
    expect(results[50]!.passed).toBe(false);
  });

  it('getHooksForPoint filters correctly across 100+ hooks', () => {
    const turnPreHooks = Array.from({ length: 60 }, () => ({
      point: 'turn:pre' as const,
      action: 'log',
    }));
    const turnPostHooks = Array.from({ length: 40 }, () => ({
      point: 'turn:post' as const,
      action: 'log',
    }));
    const engine = makeEngine({
      version: '1',
      hooks: [...turnPreHooks, ...turnPostHooks],
    });

    expect(engine.getHooksForPoint('turn:pre')).toHaveLength(60);
    expect(engine.getHooksForPoint('turn:post')).toHaveLength(40);
    expect(engine.getHooksForPoint('turn:tool:pre')).toHaveLength(0);
  });

});

// ─── Hook with no match filters ──────────────────────────────────────────────

describe('Hook with no match filters', () => {

  it('hook with no match fires for every context (universal match)', async () => {
    const engine = makeEngine({
      version: '1',
      hooks: [{ point: 'turn:pre', action: 'log' }], // no match filter
    });

    // Different sessions, tools, topicIds — all should match
    const ctx1 = { ...baseContext, sessionKey: 'session:1', topicId: 1 };
    const ctx2 = { ...baseContext, sessionKey: 'session:2', topicId: 2 };
    const ctx3 = { ...baseContext, sessionKey: 'agent:main:subagent:xyz', topicId: undefined };

    expect((await engine.execute('turn:pre', ctx1))).toHaveLength(1);
    expect((await engine.execute('turn:pre', ctx2))).toHaveLength(1);
    expect((await engine.execute('turn:pre', ctx3))).toHaveLength(1);
  });

  it('undefined filter matches any toolName including undefined', async () => {
    const { matchesFilter } = await import('../src/matcher');
    const ctx = { ...baseContext, toolName: undefined };
    const result = await matchesFilter(undefined, ctx);
    expect(result).toBe(true);
  });

  it('empty filter object matches everything', async () => {
    const { matchesFilter } = await import('../src/matcher');
    const result = await matchesFilter({}, baseContext);
    expect(result).toBe(true);
  });

});

// ─── Hook with multiple match filters (AND logic) ────────────────────────────

describe('Hook with multiple match filters (AND logic)', () => {

  it('all filters must match — fails if any single filter does not match', async () => {
    const { matchesFilter } = await import('../src/matcher');

    const filter = {
      tool: 'exec',
      commandPattern: '^rm\\s',
      topicId: 42,
      isSubAgent: false,
    };

    // All match
    const allMatchCtx: HookContext = {
      ...baseContext,
      toolName: 'exec',
      toolArgs: { command: 'rm /file.txt' },
      topicId: 42,
      sessionKey: 'agent:main:telegram:topic:42',
    };
    expect(await matchesFilter(filter, allMatchCtx)).toBe(true);

    // Tool doesn't match
    const noToolMatch: HookContext = { ...allMatchCtx, toolName: 'Read' };
    expect(await matchesFilter(filter, noToolMatch)).toBe(false);

    // Pattern doesn't match
    const noPatternMatch: HookContext = { ...allMatchCtx, toolArgs: { command: 'ls /file.txt' } };
    expect(await matchesFilter(filter, noPatternMatch)).toBe(false);

    // TopicId doesn't match
    const noTopicMatch: HookContext = { ...allMatchCtx, topicId: 99 };
    expect(await matchesFilter(filter, noTopicMatch)).toBe(false);

    // isSubAgent doesn't match
    const subagentCtx: HookContext = { ...allMatchCtx, sessionKey: 'agent:main:subagent:xyz' };
    expect(await matchesFilter(filter, subagentCtx)).toBe(false);
  });

  it('sessionPattern + tool filter both must match', async () => {
    const { matchesFilter } = await import('../src/matcher');
    const filter = { tool: 'exec', sessionPattern: 'telegram:group' };

    const matchCtx: HookContext = {
      ...baseContext,
      toolName: 'exec',
      sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
    };
    const noSessionCtx: HookContext = {
      ...baseContext,
      toolName: 'exec',
      sessionKey: 'agent:main:other:session',
    };
    const noToolCtx: HookContext = {
      ...baseContext,
      toolName: 'Read',
      sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
    };

    expect(await matchesFilter(filter, matchCtx)).toBe(true);
    expect(await matchesFilter(filter, noSessionCtx)).toBe(false);
    expect(await matchesFilter(filter, noToolCtx)).toBe(false);
  });

});

// ─── Concurrent hook execution safety ───────────────────────────────────────

describe('Concurrent hook execution safety', () => {

  it('multiple concurrent execute() calls to same engine do not interfere', async () => {
    const engine = makeEngine({
      version: '1',
      hooks: [
        { point: 'turn:pre', action: 'log' },
        { point: 'turn:post', action: 'log' },
      ],
    });

    // Fire multiple concurrent execute calls
    const promises = [
      engine.execute('turn:pre', { ...baseContext, point: 'turn:pre', sessionKey: 'session:1' }),
      engine.execute('turn:post', { ...baseContext, point: 'turn:post', sessionKey: 'session:2' }),
      engine.execute('turn:pre', { ...baseContext, point: 'turn:pre', sessionKey: 'session:3' }),
      engine.execute('turn:post', { ...baseContext, point: 'turn:post', sessionKey: 'session:4' }),
    ];

    const allResults = await Promise.all(promises);
    expect(allResults).toHaveLength(4);
    expect(allResults.every(r => r.length === 1)).toBe(true);
    expect(allResults.every(r => r[0]!.passed === true)).toBe(true);
  });

  it('concurrent executions on different engines do not interfere', async () => {
    const engines = Array.from({ length: 5 }, () =>
      makeEngine({ version: '1', hooks: [{ point: 'turn:pre', action: 'log' }] })
    );

    const results = await Promise.all(
      engines.map(e => e.execute('turn:pre', baseContext))
    );

    expect(results).toHaveLength(5);
    expect(results.every(r => r.length === 1 && r[0]!.passed)).toBe(true);
  });

});

// ─── Config hot-reload ───────────────────────────────────────────────────────

describe('Config hot-reload', () => {

  it('reloadConfig re-reads file from disk and updates hooks', async () => {
    const filePath = path.join(tmpDir, 'HOOKS.yaml');
    await fs.writeFile(filePath, `
version: "1"
hooks:
  - point: turn:pre
    action: log
`, 'utf-8');

    const engine = new LifecycleGateEngine();
    await engine.loadConfig(filePath);
    expect(engine.getHooksForPoint('turn:pre')).toHaveLength(1);

    // Update file
    await fs.writeFile(filePath, `
version: "1"
hooks:
  - point: turn:pre
    action: log
  - point: turn:pre
    action: block
`, 'utf-8');

    await engine.reloadConfig();
    expect(engine.getHooksForPoint('turn:pre')).toHaveLength(2);
  });

  it('reloadConfig returns null before any config was loaded', async () => {
    const engine = new LifecycleGateEngine();
    const result = await engine.reloadConfig();
    expect(result).toBeNull();
  });

  it('reloadConfig returns the new HooksConfig', async () => {
    const filePath = path.join(tmpDir, 'HOOKS.yaml');
    await fs.writeFile(filePath, `
version: "1"
hooks: []
`, 'utf-8');

    const engine = new LifecycleGateEngine();
    await engine.loadConfig(filePath);

    await fs.writeFile(filePath, `
version: "2"
hooks:
  - point: turn:pre
    action: log
`, 'utf-8');

    const newConfig = await engine.reloadConfig();
    expect(newConfig).not.toBeNull();
    expect(newConfig!.version).toBe('2');
    expect(newConfig!.hooks).toHaveLength(1);
  });

});

// ─── Additional edge cases ────────────────────────────────────────────────────

describe('Additional edge cases', () => {

  it('hook point as array fires when any listed point matches', async () => {
    const engine = makeEngine({
      version: '1',
      hooks: [{
        point: ['turn:pre', 'turn:post', 'subagent:pre'],
        action: 'log',
      }],
    });

    const points = ['turn:pre', 'turn:post', 'subagent:pre'] as const;
    for (const point of points) {
      const ctx = { ...baseContext, point };
      const results = await engine.execute(point, ctx);
      expect(results).toHaveLength(1);
    }

    // Other points should not fire
    const ctx = { ...baseContext, point: 'turn:tool:pre' as const };
    const results = await engine.execute('turn:tool:pre', ctx);
    expect(results).toHaveLength(0);
  });

  it('getConfig returns null before load and the config after', async () => {
    const engine = new LifecycleGateEngine();
    expect(engine.getConfig()).toBeNull();

    injectConfig(engine, { version: '1', hooks: [] });
    const config = engine.getConfig();
    expect(config).not.toBeNull();
    expect(config!.version).toBe('1');
  });

  it('topicId filter handles string vs number comparison correctly', async () => {
    const { matchesFilter } = await import('../src/matcher');

    // Filter with number, context with string
    expect(await matchesFilter({ topicId: 42 }, { ...baseContext, topicId: '42' })).toBe(true);
    // Filter with string, context with number
    expect(await matchesFilter({ topicId: '42' }, { ...baseContext, topicId: 42 })).toBe(true);
    // Different values
    expect(await matchesFilter({ topicId: 42 }, { ...baseContext, topicId: '43' })).toBe(false);
  });

  it('commandPattern falls back to path when no command in toolArgs', async () => {
    const { matchesFilter } = await import('../src/matcher');
    const ctx: HookContext = {
      ...baseContext,
      toolName: 'Read',
      toolArgs: { path: '/etc/important.conf' },
    };
    expect(await matchesFilter({ commandPattern: '/etc/' }, ctx)).toBe(true);
  });

  it('commandPattern falls back to file_path when no command or path', async () => {
    const { matchesFilter } = await import('../src/matcher');
    const ctx: HookContext = {
      ...baseContext,
      toolName: 'Write',
      toolArgs: { file_path: '/tmp/output.txt', content: 'hello' },
    };
    expect(await matchesFilter({ commandPattern: '/tmp/' }, ctx)).toBe(true);
  });

  it('commandPattern falls back to prompt when no toolArgs', async () => {
    const { matchesFilter } = await import('../src/matcher');
    const ctx: HookContext = {
      ...baseContext,
      toolArgs: undefined,
      prompt: 'Please delete all old files',
    };
    expect(await matchesFilter({ commandPattern: 'delete' }, ctx)).toBe(true);
    expect(await matchesFilter({ commandPattern: 'create' }, ctx)).toBe(false);
  });

  it('commandPattern returns empty string fallback when no args and no prompt', async () => {
    const { matchesFilter } = await import('../src/matcher');
    const ctx: HookContext = {
      ...baseContext,
      toolArgs: undefined,
      prompt: undefined,
    };
    // Pattern that would never match empty string
    expect(await matchesFilter({ commandPattern: '^rm\\s' }, ctx)).toBe(false);
    // Pattern that matches empty string
    expect(await matchesFilter({ commandPattern: '.*' }, ctx)).toBe(true);
  });

  it('invalid commandPattern regex — fails closed (no match) with a warning', async () => {
    const { matchesFilter } = await import('../src/matcher');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Invalid regex — should not throw, should fail-closed (return false)
    const result = await matchesFilter({ commandPattern: '[invalid(regex' }, baseContext);
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid commandPattern'));
  });

  it('invalid sessionPattern regex — fails closed (no match) with a warning', async () => {
    const { matchesFilter } = await import('../src/matcher');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await matchesFilter({ sessionPattern: '[invalid(regex' }, baseContext);
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid sessionPattern'));
  });

  it('engine handles defaults.onFailure fallback correctly', async () => {
    const engine = makeEngine({
      version: '1',
      defaults: {
        onFailure: { action: 'continue' },
      },
      hooks: [{
        point: 'turn:pre',
        action: '/nonexistent/action.js',
        // no hook-level onFailure — should use defaults
      }],
    });
    // dispatchAction handles the error internally for custom modules
    const results = await engine.execute('turn:pre', baseContext);
    expect(results).toHaveLength(1);
  });

});

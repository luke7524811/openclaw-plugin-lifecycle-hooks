/**
 * tests/engine.test.ts — Gate engine tests.
 */

import { describe, it, expect } from 'vitest';
import { LifecycleGateEngine } from '../src/engine';
import type { HookContext, HooksConfig } from '../src/types';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const baseContext: HookContext = {
  point: 'turn:pre',
  sessionKey: 'agent:main:test:session',
  timestamp: Date.now(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Inject a config directly into engine internals (bypasses file I/O for tests).
 * Accesses the private `config` property via type assertion.
 */
function injectConfig(engine: LifecycleGateEngine, config: HooksConfig): void {
  (engine as unknown as { config: HooksConfig }).config = config;
}

function makeEngine(config?: HooksConfig): LifecycleGateEngine {
  const engine = new LifecycleGateEngine();
  if (config) injectConfig(engine, config);
  return engine;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('LifecycleGateEngine', () => {
  describe('initial state', () => {
    it('is not ready before loadConfig is called', () => {
      const engine = makeEngine();
      expect(engine.isReady).toBe(false);
    });

    it('getConfig() returns null before load', () => {
      const engine = makeEngine();
      expect(engine.getConfig()).toBeNull();
    });

    it('execute() returns empty array before config is loaded', async () => {
      const engine = makeEngine();
      const results = await engine.execute('turn:pre', baseContext);
      expect(results).toEqual([]);
    });

    it('getHooksForPoint() returns empty array before config is loaded', () => {
      const engine = makeEngine();
      expect(engine.getHooksForPoint('turn:pre')).toEqual([]);
    });
  });

  describe('isReady', () => {
    it('is true after config is injected', () => {
      const engine = makeEngine({ version: '1', hooks: [] });
      expect(engine.isReady).toBe(true);
    });
  });

  describe('getHooksForPoint()', () => {
    it('returns hooks matching the given point', () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:pre', action: 'log' },
          { point: 'turn:post', action: 'log' },
          { point: ['turn:pre', 'turn:tool:pre'], action: 'block' },
        ],
      });

      const hooks = engine.getHooksForPoint('turn:pre');
      expect(hooks).toHaveLength(2);
      expect(hooks.every(h => {
        const pts = Array.isArray(h.point) ? h.point : [h.point];
        return pts.includes('turn:pre');
      })).toBe(true);
    });

    it('excludes disabled hooks', () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:pre', action: 'log' },
          { point: 'turn:pre', action: 'block', enabled: false },
        ],
      });

      const hooks = engine.getHooksForPoint('turn:pre');
      expect(hooks).toHaveLength(1);
      expect(hooks[0]!.action).toBe('log');
    });

    it('returns empty array when no hooks match the point', () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{ point: 'turn:post', action: 'log' }],
      });
      expect(engine.getHooksForPoint('turn:pre')).toHaveLength(0);
    });
  });

  describe('execute()', () => {
    it('returns empty results when no hooks match', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{ point: 'turn:post', action: 'log' }],
      });

      const results = await engine.execute('turn:pre', baseContext);
      expect(results).toHaveLength(0);
    });

    it('executes a log hook and passes', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{ point: 'turn:pre', action: 'log' }],
      });

      const results = await engine.execute('turn:pre', baseContext);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.action).toBe('log');
      expect(typeof results[0]!.duration).toBe('number');
    });

    it('executes a block hook and returns passed=false', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{ point: 'turn:pre', action: 'block' }],
      });

      const results = await engine.execute('turn:pre', baseContext);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.action).toBe('block');
    });

    it('short-circuits after a block result', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:pre', action: 'block' },
          { point: 'turn:pre', action: 'log' }, // should NOT run
        ],
      });

      const results = await engine.execute('turn:pre', baseContext);
      // Only the block result should be present
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('skips disabled hooks during execute', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:pre', action: 'block', enabled: false },
          { point: 'turn:pre', action: 'log' },
        ],
      });

      const results = await engine.execute('turn:pre', baseContext);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('runs multiple non-blocking hooks and returns all results', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:pre', action: 'log' },
          { point: 'turn:pre', action: 'log' },
        ],
      });

      const results = await engine.execute('turn:pre', baseContext);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.passed)).toBe(true);
    });
  });

  describe('buildContext()', () => {
    it('builds a context with required fields', () => {
      const ctx = LifecycleGateEngine.buildContext('turn:tool:pre', 'test:session', {
        toolName: 'exec',
        toolArgs: { command: 'ls -la' },
      });

      expect(ctx.point).toBe('turn:tool:pre');
      expect(ctx.sessionKey).toBe('test:session');
      expect(ctx.toolName).toBe('exec');
      expect(ctx.toolArgs).toEqual({ command: 'ls -la' });
      expect(typeof ctx.timestamp).toBe('number');
    });

    it('sets timestamp close to now', () => {
      const before = Date.now();
      const ctx = LifecycleGateEngine.buildContext('turn:pre', 'test');
      const after = Date.now();
      expect(ctx.timestamp).toBeGreaterThanOrEqual(before);
      expect(ctx.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('match filters', () => {
    it('filters by tool name — matches', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{ point: 'turn:tool:pre', match: { tool: 'exec' }, action: 'log' }],
      });

      const ctx = LifecycleGateEngine.buildContext('turn:tool:pre', 'test', { toolName: 'exec' });
      const results = await engine.execute('turn:tool:pre', ctx);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    it('filters by tool name — no match', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{ point: 'turn:tool:pre', match: { tool: 'exec' }, action: 'log' }],
      });

      const ctx = LifecycleGateEngine.buildContext('turn:tool:pre', 'test', { toolName: 'Read' });
      const results = await engine.execute('turn:tool:pre', ctx);
      expect(results).toHaveLength(0);
    });

    it('blocks matching rm command pattern', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          {
            point: 'turn:tool:pre',
            match: { tool: 'exec', commandPattern: '^rm\\s' },
            action: 'block',
          },
        ],
      });

      const rmCtx = LifecycleGateEngine.buildContext('turn:tool:pre', 'test', {
        toolName: 'exec',
        toolArgs: { command: 'rm somefile.txt' },
      });
      const results = await engine.execute('turn:tool:pre', rmCtx);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('does not block non-matching command', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          {
            point: 'turn:tool:pre',
            match: { tool: 'exec', commandPattern: '^rm\\s' },
            action: 'block',
          },
        ],
      });

      const lsCtx = LifecycleGateEngine.buildContext('turn:tool:pre', 'test', {
        toolName: 'exec',
        toolArgs: { command: 'ls -la' },
      });
      const results = await engine.execute('turn:tool:pre', lsCtx);
      expect(results).toHaveLength(0);
    });

    it('filters by topicId', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{ point: 'turn:pre', match: { topicId: 42 }, action: 'log' }],
      });

      const matchCtx = LifecycleGateEngine.buildContext('turn:pre', 'test', { topicId: 42 });
      const noMatchCtx = LifecycleGateEngine.buildContext('turn:pre', 'test', { topicId: 99 });

      const matchResults = await engine.execute('turn:pre', matchCtx);
      const noMatchResults = await engine.execute('turn:pre', noMatchCtx);

      expect(matchResults).toHaveLength(1);
      expect(noMatchResults).toHaveLength(0);
    });
  });
});

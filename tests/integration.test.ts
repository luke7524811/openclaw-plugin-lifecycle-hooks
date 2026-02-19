/**
 * tests/integration.test.ts — Full pipeline integration tests.
 *
 * Tests the end-to-end flow: config load → engine init → hook fire → action execute → result.
 * Uses real file I/O for config loading (via temp files) and injects config directly
 * for speed when file I/O isn't the focus.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LifecycleGateEngine } from '../src/engine';
import type { HookContext, HooksConfig } from '../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hooks-integration-'));
  
  // Mock llmComplete to avoid actual HTTP calls in integration tests
  const llmModule = await import('../src/llm');
  vi.spyOn(llmModule, 'llmComplete').mockResolvedValue('Mocked summary for integration test');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function writeYaml(content: string): Promise<string> {
  const filePath = path.join(tmpDir, `hooks-${Date.now()}.yaml`);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

/** Build engine from real YAML on disk — tests actual config loading pipeline. */
async function loadEngine(yamlContent: string): Promise<LifecycleGateEngine> {
  const filePath = await writeYaml(yamlContent);
  const engine = new LifecycleGateEngine();
  await engine.loadConfig(filePath);
  return engine;
}

/** Inject config directly into engine (bypasses file I/O). */
function injectConfig(engine: LifecycleGateEngine, config: HooksConfig): void {
  (engine as unknown as { config: HooksConfig }).config = config;
}

function makeEngine(config: HooksConfig): LifecycleGateEngine {
  const engine = new LifecycleGateEngine();
  injectConfig(engine, config);
  return engine;
}

const baseContext: HookContext = {
  point: 'turn:tool:pre',
  sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
  topicId: 42,
  toolName: 'exec',
  toolArgs: { command: 'ls /tmp' },
  timestamp: Date.now(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Integration: full pipeline', () => {

  describe('config loaded → engine initialized → hook fires → action executes → result returned', () => {

    it('loads config from disk, engine is ready, block action returns passed=false', async () => {
      const engine = await loadEngine(`
version: "1"
hooks:
  - point: turn:tool:pre
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: "Destructive command blocked"
`);
      expect(engine.isReady).toBe(true);
      const results = await engine.execute('turn:tool:pre', baseContext);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.action).toBe('block');
      expect(results[0]!.message).toBe('Destructive command blocked');
      expect(typeof results[0]!.duration).toBe('number');
      expect(results[0]!.duration).toBeGreaterThanOrEqual(0);
    });

    it('log action returns passed=true with message', async () => {
      const engine = await loadEngine(`
version: "1"
hooks:
  - point: turn:pre
    action: log
`);
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.action).toBe('log');
      expect(results[0]!.message).toContain('turn:pre');
    });

    it('summarize_and_log action returns passed=true', async () => {
      const engine = await loadEngine(`
version: "1"
hooks:
  - point: turn:pre
    action: summarize_and_log
    model: anthropic/claude-haiku-4-5
`);
      const ctx = { ...baseContext, point: 'turn:pre' as const, prompt: 'What is the status?' };
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.action).toBe('summarize_and_log');
    });

    it('inject_context with missing source returns passed=true gracefully', async () => {
      const engine = await loadEngine(`
version: "1"
hooks:
  - point: subagent:pre
    action: inject_context
    target: /nonexistent/path/file.md
`);
      const ctx = {
        ...baseContext,
        point: 'subagent:pre' as const,
        sessionKey: 'agent:main:subagent:abc123',
      };
      const results = await engine.execute('subagent:pre', ctx);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true); // graceful failure
    });

    it('inject_context with existing file returns injectedContent', async () => {
      const contextFile = path.join(tmpDir, 'context.md');
      const contextContent = '# Injected Context\n\nThis is important.';
      await fs.writeFile(contextFile, contextContent, 'utf-8');

      const engine = await loadEngine(`
version: "1"
hooks:
  - point: turn:pre
    action: inject_context
    source: ${contextFile}
`);
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.action).toBe('inject_context');
      expect(results[0]!.injectedContent).toBe(contextContent);
    });

    it('inject_context with JSONL file returns formatted context block', async () => {
      const jsonlFile = path.join(tmpDir, 'context.jsonl');
      const entries = [
        { timestamp: '2026-01-01T00:00:00Z', point: 'turn:pre', summary: 'Entry one' },
        { timestamp: '2026-01-02T00:00:00Z', point: 'turn:pre', summary: 'Entry two' },
      ];
      await fs.writeFile(jsonlFile, entries.map((e) => JSON.stringify(e)).join('\n'), 'utf-8');

      const engine = await loadEngine(`
version: "1"
hooks:
  - point: turn:pre
    action: inject_context
    source: ${jsonlFile}
    lastN: 2
`);
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.injectedContent).toContain('Recent Topic Context');
      expect(results[0]!.injectedContent).toContain('Entry one');
      expect(results[0]!.injectedContent).toContain('Entry two');
      expect(results[0]!.injectedContent).toContain('End Topic Context');
    });

    it('engine pipeline preserves injectedContent through dispatchAction', async () => {
      const contextFile = path.join(tmpDir, 'ctx.md');
      await fs.writeFile(contextFile, 'Pipeline context content', 'utf-8');

      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:pre', action: 'inject_context', source: contextFile },
        ],
      });
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      expect(results[0]!.injectedContent).toBe('Pipeline context content');
    });

    it('exec_script with missing script returns passed=false', async () => {
      const engine = await loadEngine(`
version: "1"
hooks:
  - point: turn:tool:pre
    action: exec_script
    target: /nonexistent/script.sh
`);
      const results = await engine.execute('turn:tool:pre', baseContext);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain('not found');
    });

    it('exec_script with /bin/echo returns passed=true', async () => {
      const engine = await loadEngine(`
version: "1"
hooks:
  - point: turn:tool:pre
    action: exec_script
    target: /bin/echo
`);
      const results = await engine.execute('turn:tool:pre', baseContext);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.action).toBe('exec_script');
    });

  });

  describe('multiple hooks on same hook point (execution order)', () => {

    it('executes hooks in definition order and returns all results', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:pre', action: 'log' },
          { point: 'turn:pre', action: 'summarize_and_log' },
          { point: 'turn:pre', action: 'inject_context' }, // no target → graceful skip
        ],
      });
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(3);
      expect(results[0]!.action).toBe('log');
      expect(results[1]!.action).toBe('summarize_and_log');
      expect(results[2]!.action).toBe('inject_context');
    });

    it('two log hooks and then a block: returns 3 results', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:tool:pre', action: 'log' },
          { point: 'turn:tool:pre', action: 'log' },
          { point: 'turn:tool:pre', action: 'block' },
          { point: 'turn:tool:pre', action: 'log' }, // should NOT run
        ],
      });
      const results = await engine.execute('turn:tool:pre', baseContext);
      expect(results).toHaveLength(3);
      expect(results[0]!.passed).toBe(true);
      expect(results[1]!.passed).toBe(true);
      expect(results[2]!.passed).toBe(false);
    });

  });

  describe('hook chain halts on block action', () => {

    it('stops processing after first block — subsequent hooks do not fire', async () => {
      const executedActions: string[] = [];

      // We can track this by checking results length — only 1 result means chain halted
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:tool:pre', action: 'block' },
          { point: 'turn:tool:pre', action: 'log' },
          { point: 'turn:tool:pre', action: 'log' },
        ],
      });
      const results = await engine.execute('turn:tool:pre', baseContext);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('block in middle of chain halts remaining hooks', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:pre', action: 'log' },
          { point: 'turn:pre', action: 'block' },
          { point: 'turn:pre', action: 'log' }, // should not execute
          { point: 'turn:pre', action: 'log' }, // should not execute
        ],
      });
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(2); // log + block only
      expect(results[1]!.passed).toBe(false);
    });

  });

  describe('onFailure behaviors', () => {

    it('onFailure: block — pipeline remains blocked on error', async () => {
      // Trigger an error by using a custom action that will fail to load
      const engine = makeEngine({
        version: '1',
        hooks: [
          {
            point: 'turn:pre',
            action: '/nonexistent/custom-action.js',
            onFailure: { action: 'block', message: 'Hook failed, blocking pipeline' },
          },
        ],
      });
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
    });

    it('onFailure: continue — pipeline continues on error', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          {
            point: 'turn:pre',
            action: '/nonexistent/custom-action.js',
            onFailure: { action: 'continue' },
          },
        ],
      });
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true); // custom action fail → continue → passed
    });

    it('onFailure: notify — pipeline continues and notifyUser is called (fire-and-forget)', async () => {
      // notify action sends a Telegram notification and continues (passed=true)
      // notifyUser() is fire-and-forget — we verify it doesn't throw or block
      const engine = makeEngine({
        version: '1',
        hooks: [
          {
            point: 'turn:pre',
            action: '/nonexistent/custom-action.js',
            onFailure: { action: 'notify', message: 'Action failed, notifying' },
          },
        ],
      });
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      // notify → passed=true, pipeline continues
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain('user notified');
    });

    it('onFailure: retry — retries specified number of times then continues', async () => {
      // Use a script that doesn't exist — it will always fail, exhausting retries
      const engine = makeEngine({
        version: '1',
        hooks: [
          {
            point: 'turn:pre',
            action: '/nonexistent/custom-action.js',
            onFailure: { action: 'retry', retries: 2 },
          },
        ],
      });
      const ctx = { ...baseContext, point: 'turn:pre' as const };

      const startTime = Date.now();
      const results = await engine.execute('turn:pre', ctx);
      const elapsed = Date.now() - startTime;

      // After exhausting retries, should return passed=true and continue
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain('retries');
      // 2 retries with 100ms + 200ms backoff = at least 300ms
      // (generous lower bound to avoid flakiness)
      expect(elapsed).toBeGreaterThanOrEqual(200);
    }, 10000); // generous timeout for retry backoff

  });

  describe('match filters correctly filtering hooks', () => {

    it('tool name filter — matches exec, skips Read', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{ point: 'turn:tool:pre', match: { tool: 'exec' }, action: 'block' }],
      });

      const execCtx = { ...baseContext, toolName: 'exec' };
      const readCtx = { ...baseContext, toolName: 'Read' };

      const execResults = await engine.execute('turn:tool:pre', execCtx);
      const readResults = await engine.execute('turn:tool:pre', readCtx);

      expect(execResults[0]!.passed).toBe(false); // matched → blocked
      expect(readResults).toHaveLength(0); // not matched → skipped
    });

    it('commandPattern filter — blocks rm, passes ls', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{
          point: 'turn:tool:pre',
          match: { commandPattern: '^rm\\s' },
          action: 'block',
        }],
      });

      const rmCtx = { ...baseContext, toolArgs: { command: 'rm /important/file.txt' } };
      const lsCtx = { ...baseContext, toolArgs: { command: 'ls /tmp' } };

      const rmResults = await engine.execute('turn:tool:pre', rmCtx);
      const lsResults = await engine.execute('turn:tool:pre', lsCtx);

      expect(rmResults[0]!.passed).toBe(false);
      expect(lsResults).toHaveLength(0);
    });

    it('topicId filter — matches correct topic, skips others', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{ point: 'turn:pre', match: { topicId: 42 }, action: 'log' }],
      });

      const ctx42 = { ...baseContext, point: 'turn:pre' as const, topicId: 42 };
      const ctx99 = { ...baseContext, point: 'turn:pre' as const, topicId: 99 };

      expect((await engine.execute('turn:pre', ctx42))).toHaveLength(1);
      expect((await engine.execute('turn:pre', ctx99))).toHaveLength(0);
    });

    it('isSubAgent filter — matches subagent sessions, skips main', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{
          point: 'subagent:tool:pre',
          match: { isSubAgent: true },
          action: 'block',
        }],
      });

      const subCtx = {
        ...baseContext,
        point: 'subagent:tool:pre' as const,
        sessionKey: 'agent:main:subagent:abc123',
      };
      const mainCtx = {
        ...baseContext,
        point: 'subagent:tool:pre' as const,
        sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
      };

      expect((await engine.execute('subagent:tool:pre', subCtx))[0]!.passed).toBe(false);
      expect((await engine.execute('subagent:tool:pre', mainCtx))).toHaveLength(0);
    });

    it('sessionPattern filter — matches Telegram groups', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{
          point: 'turn:pre',
          match: { sessionPattern: 'telegram:group' },
          action: 'log',
        }],
      });

      const telegramCtx = {
        ...baseContext,
        point: 'turn:pre' as const,
        sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
      };
      const otherCtx = {
        ...baseContext,
        point: 'turn:pre' as const,
        sessionKey: 'agent:main:other:session',
      };

      expect((await engine.execute('turn:pre', telegramCtx))).toHaveLength(1);
      expect((await engine.execute('turn:pre', otherCtx))).toHaveLength(0);
    });

    it('multiple match filters use AND logic — all must match', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [{
          point: 'turn:tool:pre',
          match: { tool: 'exec', commandPattern: '^rm\\s' },
          action: 'block',
        }],
      });

      // Both match → fires
      const bothMatch = {
        ...baseContext,
        toolName: 'exec',
        toolArgs: { command: 'rm -rf /tmp/stuff' },
      };
      // Only tool matches, not pattern → does not fire
      const onlyTool = {
        ...baseContext,
        toolName: 'exec',
        toolArgs: { command: 'ls /tmp' },
      };
      // Only pattern matches, not tool → does not fire
      const onlyPattern = {
        ...baseContext,
        toolName: 'Read',
        toolArgs: { command: 'rm -rf /tmp/stuff' },
      };

      expect((await engine.execute('turn:tool:pre', bothMatch))).toHaveLength(1);
      expect((await engine.execute('turn:tool:pre', onlyTool))).toHaveLength(0);
      expect((await engine.execute('turn:tool:pre', onlyPattern))).toHaveLength(0);
    });

  });

  describe('custom match filter via function', () => {

    it('custom match filter — fail-open when module cannot be loaded', async () => {
      // When a custom matcher module fails to load, should fail-open (match = true)
      const engine = makeEngine({
        version: '1',
        hooks: [{
          point: 'turn:pre',
          match: { custom: '/nonexistent/matcher.js' },
          action: 'log',
        }],
      });
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      // fail-open: hook fires even when matcher can't be loaded
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(1); // fail-open → hook fired
      expect(results[0]!.passed).toBe(true);
    });

  });

  describe('hooks with enabled: false are skipped', () => {

    it('disabled hook is never executed', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:pre', action: 'block', enabled: false },
          { point: 'turn:pre', action: 'log', enabled: true },
        ],
      });
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(1);
      expect(results[0]!.action).toBe('log');
    });

    it('all disabled hooks = zero results', async () => {
      const engine = makeEngine({
        version: '1',
        hooks: [
          { point: 'turn:pre', action: 'log', enabled: false },
          { point: 'turn:pre', action: 'block', enabled: false },
        ],
      });
      const ctx = { ...baseContext, point: 'turn:pre' as const };
      const results = await engine.execute('turn:pre', ctx);
      expect(results).toHaveLength(0);
    });

  });

  describe('empty hooks config = passthrough (no errors)', () => {

    it('empty hooks array produces no results and does not throw', async () => {
      const engine = makeEngine({ version: '1', hooks: [] });
      const results = await engine.execute('turn:pre', baseContext);
      expect(results).toEqual([]);
    });

    it('no config loaded returns empty results', async () => {
      const engine = new LifecycleGateEngine();
      const results = await engine.execute('turn:pre', baseContext);
      expect(results).toEqual([]);
    });

    it('hooks config loaded from disk with zero hooks passes through', async () => {
      const engine = await loadEngine(`
version: "1"
hooks: []
`);
      const results = await engine.execute('turn:tool:pre', baseContext);
      expect(results).toEqual([]);
    });

  });

  describe('hot-reload support', () => {

    it('reloadConfig reloads from original path', async () => {
      const filePath = await writeYaml(`
version: "1"
hooks:
  - point: turn:pre
    action: log
`);
      const engine = new LifecycleGateEngine();
      await engine.loadConfig(filePath);
      expect(engine.getHooksForPoint('turn:pre')).toHaveLength(1);

      // Update the file
      await fs.writeFile(filePath, `
version: "1"
hooks:
  - point: turn:pre
    action: log
  - point: turn:pre
    action: block
`, 'utf-8');

      const reloaded = await engine.reloadConfig();
      expect(reloaded).not.toBeNull();
      expect(engine.getHooksForPoint('turn:pre')).toHaveLength(2);
    });

    it('reloadConfig returns null if no config was ever loaded', async () => {
      const engine = new LifecycleGateEngine();
      const result = await engine.reloadConfig();
      expect(result).toBeNull();
    });

  });

  describe('context building helper', () => {

    it('buildContext creates valid context with required fields', () => {
      const ctx = LifecycleGateEngine.buildContext('turn:tool:pre', 'agent:main:test', {
        toolName: 'exec',
        toolArgs: { command: 'ls /tmp' },
      });
      expect(ctx.point).toBe('turn:tool:pre');
      expect(ctx.sessionKey).toBe('agent:main:test');
      expect(typeof ctx.timestamp).toBe('number');
      expect(ctx.toolName).toBe('exec');
    });

    it('buildContext timestamp is close to now', () => {
      const before = Date.now();
      const ctx = LifecycleGateEngine.buildContext('turn:pre', 'test');
      const after = Date.now();
      expect(ctx.timestamp).toBeGreaterThanOrEqual(before);
      expect(ctx.timestamp).toBeLessThanOrEqual(after);
    });

  });

});

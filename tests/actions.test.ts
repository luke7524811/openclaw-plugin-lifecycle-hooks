/**
 * tests/actions.test.ts — Unit tests for each built-in action.
 *
 * Tests each action in isolation, mocking I/O where needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { HookContext, HookDefinition } from '../src/types';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const baseContext: HookContext = {
  point: 'turn:tool:pre',
  sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
  topicId: 42,
  toolName: 'exec',
  toolArgs: { command: 'ls /tmp' },
  timestamp: Date.now(),
};

const baseHook: HookDefinition = {
  point: 'turn:tool:pre',
  action: 'log',
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hooks-actions-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ─── block ────────────────────────────────────────────────────────────────────

describe('block action', () => {
  it('returns passed=false', async () => {
    const { executeBlock } = await import('../src/actions/block');
    const hook: HookDefinition = { ...baseHook, action: 'block' };
    const result = await executeBlock(hook, baseContext, Date.now());
    expect(result.passed).toBe(false);
  });

  it('action field is "block"', async () => {
    const { executeBlock } = await import('../src/actions/block');
    const hook: HookDefinition = { ...baseHook, action: 'block' };
    const result = await executeBlock(hook, baseContext, Date.now());
    expect(result.action).toBe('block');
  });

  it('includes a descriptive message by default', async () => {
    const { executeBlock } = await import('../src/actions/block');
    const hook: HookDefinition = { ...baseHook, action: 'block' };
    const result = await executeBlock(hook, baseContext, Date.now());
    expect(result.message).toBeTruthy();
    expect(typeof result.message).toBe('string');
    expect(result.message!.length).toBeGreaterThan(0);
  });

  it('uses onFailure.message when provided', async () => {
    const { executeBlock } = await import('../src/actions/block');
    const hook: HookDefinition = {
      ...baseHook,
      action: 'block',
      onFailure: { action: 'block', message: '⛔ Use trash instead of rm' },
    };
    const result = await executeBlock(hook, baseContext, Date.now());
    expect(result.message).toBe('⛔ Use trash instead of rm');
  });

  it('includes tool name in default message when toolName is set', async () => {
    const { executeBlock } = await import('../src/actions/block');
    const hook: HookDefinition = { ...baseHook, action: 'block' };
    const result = await executeBlock(hook, baseContext, Date.now());
    expect(result.message).toContain('exec');
  });

  it('includes truncated command in default message when toolArgs.command is set', async () => {
    const { executeBlock } = await import('../src/actions/block');
    const hook: HookDefinition = { ...baseHook, action: 'block' };
    const ctx = { ...baseContext, toolArgs: { command: 'rm -rf /important' } };
    const result = await executeBlock(hook, ctx, Date.now());
    expect(result.message).toContain('rm -rf /important');
  });

  it('truncates very long commands at 80 chars', async () => {
    const { executeBlock } = await import('../src/actions/block');
    const longCmd = 'rm ' + 'a'.repeat(200);
    const hook: HookDefinition = { ...baseHook, action: 'block' };
    const ctx = { ...baseContext, toolArgs: { command: longCmd } };
    const result = await executeBlock(hook, ctx, Date.now());
    expect(result.message).toContain('…');
  });

  it('duration is a non-negative number', async () => {
    const { executeBlock } = await import('../src/actions/block');
    const hook: HookDefinition = { ...baseHook, action: 'block' };
    const start = Date.now();
    const result = await executeBlock(hook, baseContext, start);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});

// ─── log ─────────────────────────────────────────────────────────────────────

describe('log action', () => {
  it('returns passed=true', async () => {
    const { executeLog } = await import('../src/actions/log');
    const result = await executeLog(baseHook, baseContext, Date.now());
    expect(result.passed).toBe(true);
  });

  it('action field is "log"', async () => {
    const { executeLog } = await import('../src/actions/log');
    const result = await executeLog(baseHook, baseContext, Date.now());
    expect(result.action).toBe('log');
  });

  it('writes to stdout when no target is specified', async () => {
    const { executeLog } = await import('../src/actions/log');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await executeLog(baseHook, baseContext, Date.now());
    expect(consoleSpy).toHaveBeenCalled();
    const callArg = consoleSpy.mock.calls[0]?.[0] as string;
    expect(callArg).toContain('[lifecycle-hooks/log]');
  });

  it('writes JSON to a file when target is specified', async () => {
    const { executeLog } = await import('../src/actions/log');
    const logFile = path.join(tmpDir, 'test.log');
    const hook = { ...baseHook, target: logFile };
    await executeLog(hook, baseContext, Date.now());

    const content = await fs.readFile(logFile, 'utf-8');
    expect(content).toContain('"point"');
    expect(content).toContain('"turn:tool:pre"');
    expect(content).toContain('"sessionKey"');
  });

  it('appends to file on multiple calls', async () => {
    const { executeLog } = await import('../src/actions/log');
    const logFile = path.join(tmpDir, 'append.log');
    const hook = { ...baseHook, target: logFile };
    await executeLog(hook, baseContext, Date.now());
    await executeLog(hook, baseContext, Date.now());

    const content = await fs.readFile(logFile, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    // Each line should be valid JSON
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
    expect(() => JSON.parse(lines[1]!)).not.toThrow();
  });

  it('creates parent directories if they do not exist', async () => {
    const { executeLog } = await import('../src/actions/log');
    const nestedLogFile = path.join(tmpDir, 'deep', 'nested', 'dir', 'test.log');
    const hook = { ...baseHook, target: nestedLogFile };
    await executeLog(hook, baseContext, Date.now());

    const content = await fs.readFile(nestedLogFile, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('log entry includes timestamp, point, and sessionKey', async () => {
    const { executeLog } = await import('../src/actions/log');
    const logFile = path.join(tmpDir, 'structured.log');
    const hook = { ...baseHook, target: logFile };
    await executeLog(hook, baseContext, Date.now());

    const content = await fs.readFile(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('point', 'turn:tool:pre');
    expect(entry).toHaveProperty('sessionKey');
  });

  it('includes tool name and args in log entry when present', async () => {
    const { executeLog } = await import('../src/actions/log');
    const logFile = path.join(tmpDir, 'tool.log');
    const hook = { ...baseHook, target: logFile };
    const ctx = {
      ...baseContext,
      toolName: 'exec',
      toolArgs: { command: 'echo hello' },
    };
    await executeLog(hook, ctx, Date.now());

    const content = await fs.readFile(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry).toHaveProperty('tool', 'exec');
    expect(entry.args).toHaveProperty('command', 'echo hello');
  });

  it('falls back to stdout when file write fails', async () => {
    const { executeLog } = await import('../src/actions/log');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Invalid path that should fail to write
    const hook = { ...baseHook, target: '/root/cannot-write-here/test.log' };

    // Should not throw, should fall back to stdout
    const result = await executeLog(hook, baseContext, Date.now());
    expect(result.passed).toBe(true); // non-fatal
  });

  it('message confirms which hook point was logged', async () => {
    const { executeLog } = await import('../src/actions/log');
    const result = await executeLog(baseHook, baseContext, Date.now());
    expect(result.message).toContain('turn:tool:pre');
  });
});

// ─── exec_script ─────────────────────────────────────────────────────────────

describe('exec_script action', () => {
  it('returns passed=true when script exits with code 0', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    // Create a simple script that exits 0
    const scriptPath = path.join(tmpDir, 'success.sh');
    await fs.writeFile(scriptPath, '#!/bin/sh\necho success\n');
    await fs.chmod(scriptPath, 0o755);

    const hook = { ...baseHook, action: 'exec_script', target: scriptPath };
    const result = await executeExecScript(hook, baseContext, Date.now());
    expect(result.passed).toBe(true);
    expect(result.action).toBe('exec_script');
  });

  it('returns passed=false when script exits with non-zero code', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    const scriptPath = path.join(tmpDir, 'fail.sh');
    await fs.writeFile(scriptPath, '#!/bin/sh\necho "error" >&2\nexit 1\n');
    await fs.chmod(scriptPath, 0o755);

    const hook = { ...baseHook, action: 'exec_script', target: scriptPath };
    const result = await executeExecScript(hook, baseContext, Date.now());
    expect(result.passed).toBe(false);
    expect(result.message).toContain('exit');
  });

  it('returns passed=false for nonexistent script', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    const hook = { ...baseHook, action: 'exec_script', target: '/nonexistent/script.sh' };
    const result = await executeExecScript(hook, baseContext, Date.now());
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('returns passed=false (error) when no target or script is specified', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    const hook = { ...baseHook, action: 'exec_script' }; // no target, no script
    const result = await executeExecScript(hook, baseContext, Date.now());
    expect(result.passed).toBe(false);
    expect(result.message).toContain('requires either "target"');
    expect(result.message).toContain('or "script"');
  });

  it('passes hook context as environment variables', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    const envFile = path.join(tmpDir, 'env-output.txt');
    const scriptPath = path.join(tmpDir, 'env-check.sh');
    await fs.writeFile(scriptPath, `#!/bin/sh\necho "POINT=$HOOK_POINT" > ${envFile}\necho "TOOL=$HOOK_TOOL" >> ${envFile}\n`);
    await fs.chmod(scriptPath, 0o755);

    const hook = { ...baseHook, action: 'exec_script', target: scriptPath };
    const ctx = { ...baseContext, toolName: 'exec', point: 'turn:tool:pre' as const };
    const result = await executeExecScript(hook, ctx, Date.now());
    expect(result.passed).toBe(true);

    const output = await fs.readFile(envFile, 'utf-8');
    expect(output).toContain('POINT=turn:tool:pre');
    expect(output).toContain('TOOL=exec');
  });

  it('blocks scripts on security deny list (/etc/ prefix)', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    const hook = { ...baseHook, action: 'exec_script', target: '/etc/passwd' };
    const result = await executeExecScript(hook, baseContext, Date.now());
    expect(result.passed).toBe(false);
    expect(result.message).toContain('blocked');
  });

  it('blocks /bin/rm from security deny list', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    const hook = { ...baseHook, action: 'exec_script', target: '/bin/rm' };
    const result = await executeExecScript(hook, baseContext, Date.now());
    expect(result.passed).toBe(false);
    expect(result.message).toContain('blocked');
  });

  it('timeout handling — result structure is correct when a script exits non-zero', async () => {
    // We don't run a 30s sleep (would hang the test suite) since DEFAULT_TIMEOUT_MS is 30s.
    // Instead, verify the exec_script contract: the result always has passed, action, duration fields.
    const { executeExecScript } = await import('../src/actions/exec-script');
    const scriptPath = path.join(tmpDir, 'quick-fail.sh');
    await fs.writeFile(scriptPath, '#!/bin/sh\nexit 2\n');
    await fs.chmod(scriptPath, 0o755);

    const hook = { ...baseHook, action: 'exec_script', target: scriptPath };
    const result = await executeExecScript(hook, baseContext, Date.now());
    // Non-zero exit → passed=false
    expect(result.passed).toBe(false);
    expect(result).toHaveProperty('action', 'exec_script');
    expect(result).toHaveProperty('duration');
    expect(result.duration).toBeGreaterThanOrEqual(0);
    // Message includes exit code
    expect(result.message).toContain('exit');
  });
});

// ─── summarize ────────────────────────────────────────────────────────────────

describe('summarize_and_log action', () => {
  beforeEach(async () => {
    // Mock the llmComplete function to avoid actual HTTP calls
    const llmModule = await import('../src/llm');
    vi.spyOn(llmModule, 'llmComplete').mockResolvedValue('Mocked summary of the event');
  });

  it('returns passed=true', async () => {
    const { executeSummarize } = await import('../src/actions/summarize');
    const hook = { ...baseHook, action: 'summarize_and_log' };
    const result = await executeSummarize(hook, baseContext, Date.now(), { defaults: {} });
    expect(result.passed).toBe(true);
  });

  it('action field is "summarize_and_log"', async () => {
    const { executeSummarize } = await import('../src/actions/summarize');
    const hook = { ...baseHook, action: 'summarize_and_log' };
    const result = await executeSummarize(hook, baseContext, Date.now(), { defaults: {} });
    expect(result.action).toBe('summarize_and_log');
  });

  it('writes JSONL entry to file when target is specified', async () => {
    const { executeSummarize } = await import('../src/actions/summarize');
    const logFile = path.join(tmpDir, 'summaries.jsonl');
    const hook = { ...baseHook, action: 'summarize_and_log', target: logFile };
    await executeSummarize(hook, baseContext, Date.now(), { defaults: {} });

    const content = await fs.readFile(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('point');
    expect(entry).toHaveProperty('summary');
    expect(entry).toHaveProperty('model');
  });

  it('uses hook.model over config default', async () => {
    const { executeSummarize } = await import('../src/actions/summarize');
    const logFile = path.join(tmpDir, 'model-test.jsonl');
    const hook = {
      ...baseHook,
      action: 'summarize_and_log',
      model: 'hook-level-model',
      target: logFile,
    };
    await executeSummarize(hook, baseContext, Date.now(), { defaults: { model: 'config-default-model' } });

    const content = await fs.readFile(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.model).toBe('hook-level-model');
  });

  it('uses config default model when hook has no model', async () => {
    const { executeSummarize } = await import('../src/actions/summarize');
    const logFile = path.join(tmpDir, 'model-default.jsonl');
    const hook = { ...baseHook, action: 'summarize_and_log', target: logFile };
    await executeSummarize(hook, baseContext, Date.now(), { defaults: { model: 'my-default-model' } });

    const content = await fs.readFile(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.model).toBe('my-default-model');
  });

  it('falls back to "default" model when none configured', async () => {
    const { executeSummarize } = await import('../src/actions/summarize');
    const logFile = path.join(tmpDir, 'no-model.jsonl');
    const hook = { ...baseHook, action: 'summarize_and_log', target: logFile };
    await executeSummarize(hook, baseContext, Date.now(), { defaults: {} });

    const content = await fs.readFile(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.model).toBe('default');
  });

  it('handles missing model gracefully (stub summary is returned)', async () => {
    const { executeSummarize } = await import('../src/actions/summarize');
    const logFile = path.join(tmpDir, 'stub.jsonl');
    const hook = { ...baseHook, action: 'summarize_and_log', target: logFile };
    // Even without an LLM model, should not throw
    const result = await executeSummarize(hook, baseContext, Date.now(), { defaults: {} });
    expect(result.passed).toBe(true);
    const content = await fs.readFile(logFile, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(typeof entry.summary).toBe('string');
    expect(entry.summary.length).toBeGreaterThan(0);
  });

  it('emits to stdout when no target is specified', async () => {
    const { executeSummarize } = await import('../src/actions/summarize');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hook = { ...baseHook, action: 'summarize_and_log' }; // no target
    await executeSummarize(hook, baseContext, Date.now(), { defaults: {} });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('message confirms which hook point was summarized', async () => {
    const { executeSummarize } = await import('../src/actions/summarize');
    const hook = { ...baseHook, action: 'summarize_and_log' };
    const result = await executeSummarize(hook, baseContext, Date.now(), { defaults: {} });
    expect(result.message).toContain('turn:tool:pre');
  });
});

// ─── inject ───────────────────────────────────────────────────────────────────

describe('inject_context action', () => {
  it('returns passed=true when no source or target is specified', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const hook = { ...baseHook, action: 'inject_context' }; // no source or target
    const result = await executeInject(hook, baseContext, Date.now());
    expect(result.passed).toBe(true);
    expect(result.message).toContain('skipped');
  });

  it('returns passed=true when source file exists (regular file)', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const contextFile = path.join(tmpDir, 'context.md');
    const content = '# Context\n\nSome important context here.';
    await fs.writeFile(contextFile, content, 'utf-8');

    const hook = { ...baseHook, action: 'inject_context', source: contextFile };
    const result = await executeInject(hook, baseContext, Date.now());
    expect(result.passed).toBe(true);
    expect(result.action).toBe('inject_context');
  });

  it('returns injectedContent for regular file', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const contextFile = path.join(tmpDir, 'context.md');
    const content = '# Context\n\nSome important context here.';
    await fs.writeFile(contextFile, content, 'utf-8');

    const hook = { ...baseHook, action: 'inject_context', source: contextFile };
    const result = await executeInject(hook, baseContext, Date.now());
    expect(result.injectedContent).toBe(content);
  });

  it('includes char count in message when file is loaded', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const contextFile = path.join(tmpDir, 'context.md');
    const content = '# Context\n\nSome important context here.';
    await fs.writeFile(contextFile, content, 'utf-8');

    const hook = { ...baseHook, action: 'inject_context', source: contextFile };
    const result = await executeInject(hook, baseContext, Date.now());
    expect(result.message).toContain(String(content.length));
  });

  it('falls back to hook.target when hook.source is not set (backwards compat)', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const contextFile = path.join(tmpDir, 'context.md');
    const content = '# Context from target';
    await fs.writeFile(contextFile, content, 'utf-8');

    const hook = { ...baseHook, action: 'inject_context', target: contextFile }; // no source
    const result = await executeInject(hook, baseContext, Date.now());
    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBe(content);
  });

  it('reads JSONL file and formats last N entries as context block', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const jsonlFile = path.join(tmpDir, 'context.jsonl');
    const entries = [
      { timestamp: '2026-01-01T00:00:00Z', point: 'turn:pre', summary: 'First interaction' },
      { timestamp: '2026-01-02T00:00:00Z', point: 'turn:pre', summary: 'Second interaction' },
      { timestamp: '2026-01-03T00:00:00Z', point: 'turn:pre', summary: 'Third interaction' },
    ];
    await fs.writeFile(jsonlFile, entries.map((e) => JSON.stringify(e)).join('\n'), 'utf-8');

    const hook = { ...baseHook, action: 'inject_context', source: jsonlFile, lastN: 2 };
    const result = await executeInject(hook, baseContext, Date.now());

    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBeDefined();
    expect(result.injectedContent).toContain('Recent Topic Context (last 2 interactions)');
    expect(result.injectedContent).toContain('Second interaction');
    expect(result.injectedContent).toContain('Third interaction');
    // Should NOT include the first entry (only last 2)
    expect(result.injectedContent).not.toContain('First interaction');
    expect(result.injectedContent).toContain('── End Topic Context ──');
  });

  it('JSONL: uses default lastN=5 when not specified', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const jsonlFile = path.join(tmpDir, 'context.jsonl');
    // Write 7 entries
    const entries = Array.from({ length: 7 }, (_, i) => ({
      timestamp: `2026-01-0${i + 1}T00:00:00Z`,
      point: 'turn:pre',
      summary: `Interaction ${i + 1}`,
    }));
    await fs.writeFile(jsonlFile, entries.map((e) => JSON.stringify(e)).join('\n'), 'utf-8');

    const hook = { ...baseHook, action: 'inject_context', source: jsonlFile }; // no lastN
    const result = await executeInject(hook, baseContext, Date.now());

    expect(result.injectedContent).toBeDefined();
    expect(result.injectedContent).toContain('last 5 interactions');
    expect(result.injectedContent).toContain('Interaction 3');
    expect(result.injectedContent).toContain('Interaction 7');
    // Should NOT include entries 1 and 2 (only last 5)
    expect(result.injectedContent).not.toContain('Interaction 1');
    expect(result.injectedContent).not.toContain('Interaction 2');
  });

  it('JSONL: formats entries with timestamp and point prefix', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const jsonlFile = path.join(tmpDir, 'context.jsonl');
    const entry = { timestamp: '2026-02-18T06:00:00Z', point: 'turn:pre', summary: 'Test summary' };
    await fs.writeFile(jsonlFile, JSON.stringify(entry), 'utf-8');

    const hook = { ...baseHook, action: 'inject_context', source: jsonlFile };
    const result = await executeInject(hook, baseContext, Date.now());

    expect(result.injectedContent).toContain('[2026-02-18T06:00:00Z] turn:pre: Test summary');
  });

  it('JSONL: skips malformed lines gracefully', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const jsonlFile = path.join(tmpDir, 'context.jsonl');
    const content = [
      JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', point: 'turn:pre', summary: 'Good entry' }),
      'not valid json {{{',
      JSON.stringify({ timestamp: '2026-01-02T00:00:00Z', point: 'turn:pre', summary: 'Another good entry' }),
    ].join('\n');
    await fs.writeFile(jsonlFile, content, 'utf-8');

    const hook = { ...baseHook, action: 'inject_context', source: jsonlFile };
    const result = await executeInject(hook, baseContext, Date.now());

    expect(result.passed).toBe(true);
    expect(result.injectedContent).toContain('Good entry');
    expect(result.injectedContent).toContain('Another good entry');
  });

  it('replaces {topicId} template variable in source path', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const topicDir = path.join(tmpDir, 'topic-42');
    await fs.mkdir(topicDir, { recursive: true });
    const contextFile = path.join(topicDir, 'context.md');
    await fs.writeFile(contextFile, 'Topic 42 context', 'utf-8');

    const hook = {
      ...baseHook,
      action: 'inject_context',
      source: path.join(tmpDir, 'topic-{topicId}', 'context.md'),
    };
    const ctx = { ...baseContext, topicId: 42 };
    const result = await executeInject(hook, ctx, Date.now());

    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBe('Topic 42 context');
  });

  it('replaces {topicId} in JSONL source path', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const topicDir = path.join(tmpDir, 'topic-99');
    await fs.mkdir(topicDir, { recursive: true });
    const jsonlFile = path.join(topicDir, 'context.jsonl');
    const entry = { timestamp: '2026-02-18T00:00:00Z', point: 'turn:pre', summary: 'Topic 99 entry' };
    await fs.writeFile(jsonlFile, JSON.stringify(entry), 'utf-8');

    const hook = {
      ...baseHook,
      action: 'inject_context',
      source: path.join(tmpDir, 'topic-{topicId}', 'context.jsonl'),
    };
    const ctx = { ...baseContext, topicId: 99 };
    const result = await executeInject(hook, ctx, Date.now());

    expect(result.passed).toBe(true);
    expect(result.injectedContent).toContain('Topic 99 entry');
  });

  it('returns passed=true gracefully when source file is missing', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const hook = {
      ...baseHook,
      action: 'inject_context',
      source: '/nonexistent/path/context.md',
    };
    const result = await executeInject(hook, baseContext, Date.now());
    expect(result.passed).toBe(true); // graceful failure — non-blocking
    expect(result.message).toContain('Injection failed');
    expect(result.injectedContent).toBeUndefined();
  });

  it('returns passed=true with no injectedContent when JSONL file is empty', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const jsonlFile = path.join(tmpDir, 'empty.jsonl');
    await fs.writeFile(jsonlFile, '', 'utf-8');

    const hook = { ...baseHook, action: 'inject_context', source: jsonlFile };
    const result = await executeInject(hook, baseContext, Date.now());
    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBeUndefined();
  });

  it('duration is a non-negative number', async () => {
    const { executeInject } = await import('../src/actions/inject');
    const hook = { ...baseHook, action: 'inject_context' };
    const start = Date.now();
    const result = await executeInject(hook, baseContext, start);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});

// ─── dispatchAction (action registry) ────────────────────────────────────────

describe('dispatchAction (action registry)', () => {
  it('dispatches "block" to the block executor', async () => {
    const { dispatchAction } = await import('../src/actions/index');
    const hook = { ...baseHook, action: 'block' };
    const result = await dispatchAction('block', hook, baseContext, Date.now(), { defaults: {} });
    expect(result.passed).toBe(false);
    expect(result.action).toBe('block');
  });

  it('dispatches "log" to the log executor', async () => {
    const { dispatchAction } = await import('../src/actions/index');
    const hook = { ...baseHook, action: 'log' };
    const result = await dispatchAction('log', hook, baseContext, Date.now(), { defaults: {} });
    expect(result.passed).toBe(true);
    expect(result.action).toBe('log');
  });

  it('dispatches "exec_script" to the exec-script executor', async () => {
    const { dispatchAction } = await import('../src/actions/index');
    const hook = { ...baseHook, action: 'exec_script' }; // no target → skips
    const result = await dispatchAction('exec_script', hook, baseContext, Date.now(), { defaults: {} });
    expect(result.action).toBe('exec_script');
  });

  it('unknown action treated as custom module path — throws on load failure so engine onFailure can apply', async () => {
    const { dispatchAction } = await import('../src/actions/index');
    const hook = { ...baseHook, action: '/nonexistent/my-action.js' };
    // Now throws so handleActionError in engine can apply onFailure policy
    await expect(
      dispatchAction('/nonexistent/my-action.js', hook, baseContext, Date.now(), { defaults: {} })
    ).rejects.toThrow('Failed to load custom action');
  });

  it('listBuiltInActions returns all 7 built-ins', async () => {
    const { listBuiltInActions } = await import('../src/actions/index');
    const actions = listBuiltInActions();
    expect(actions).toContain('block');
    expect(actions).toContain('log');
    expect(actions).toContain('summarize_and_log');
    expect(actions).toContain('inject_context');
    expect(actions).toContain('inject_origin');
    expect(actions).toContain('exec_script');
    expect(actions).toContain('notify_user');
    expect(actions).toHaveLength(7);
  });
});

// ─── Variable Interpolation in Actions ────────────────────────────────────────

describe('Variable interpolation in action paths', () => {
  const contextWithTopic: HookContext = {
    point: 'turn:pre',
    sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
    topicId: 42,
    timestamp: 1739948400000, // 2026-02-19T08:00:00.000Z
  };

  it('log action interpolates {topicId} in target path', async () => {
    const { executeLog } = await import('../src/actions/log');
    const logFile = path.join(tmpDir, 'topic-{topicId}', 'events.log');
    const hook: HookDefinition = { ...baseHook, action: 'log', target: logFile };
    
    await executeLog(hook, contextWithTopic, Date.now());
    
    const expectedPath = path.join(tmpDir, 'topic-42', 'events.log');
    const content = await fs.readFile(expectedPath, 'utf-8');
    expect(content).toContain('"point"');
  });

  it('log action interpolates {timestamp} in target path', async () => {
    const { executeLog } = await import('../src/actions/log');
    const logFile = path.join(tmpDir, 'log-{timestamp}.log');
    const hook: HookDefinition = { ...baseHook, action: 'log', target: logFile };
    
    await executeLog(hook, contextWithTopic, Date.now());
    
    // Verify the file was created with the interpolated timestamp
    // The actual timestamp will be when the test ran, not the context timestamp
    const files = await fs.readdir(tmpDir);
    const logFiles = files.filter(f => f.startsWith('log-') && f.endsWith('.log'));
    expect(logFiles.length).toBe(1);
    
    const content = await fs.readFile(path.join(tmpDir, logFiles[0]!), 'utf-8');
    expect(content).toContain('"point"');
  });

  it('summarize action interpolates {topicId} in target path', async () => {
    const { executeSummarize } = await import('../src/actions/summarize');
    const logFile = path.join(tmpDir, 'topic-{topicId}', 'summary.jsonl');
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'summarize_and_log', 
      target: logFile,
      model: 'mock-model'
    };

    // Mock the LLM call to avoid actual API calls
    const llmMock = await import('../src/llm');
    vi.spyOn(llmMock, 'llmComplete').mockResolvedValue('Test summary');
    
    await executeSummarize(hook, contextWithTopic, Date.now(), { defaults: {} });
    
    const expectedPath = path.join(tmpDir, 'topic-42', 'summary.jsonl');
    const content = await fs.readFile(expectedPath, 'utf-8');
    expect(content).toContain('"summary"');
    expect(content).toContain('Test summary');
  });

  it('inject_context action interpolates {topicId} in source path', async () => {
    const { executeInject } = await import('../src/actions/inject');
    
    // Create a source file with interpolated path
    const sourceDir = path.join(tmpDir, 'topic-42');
    await fs.mkdir(sourceDir, { recursive: true });
    const sourceFile = path.join(sourceDir, 'context.txt');
    await fs.writeFile(sourceFile, 'Test context content');
    
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'inject_context',
      source: path.join(tmpDir, 'topic-{topicId}', 'context.txt')
    };
    
    const result = await executeInject(hook, contextWithTopic, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBe('Test context content');
  });

  it('inject_context falls back to "unknown" when no topicId', async () => {
    const { executeInject } = await import('../src/actions/inject');
    
    const contextNoTopic: HookContext = {
      point: 'turn:pre',
      sessionKey: 'agent:main:telegram:user:12345',
      timestamp: Date.now(),
    };

    // Create a source file with "unknown" path
    const sourceDir = path.join(tmpDir, 'topic-unknown');
    await fs.mkdir(sourceDir, { recursive: true });
    const sourceFile = path.join(sourceDir, 'fallback.txt');
    await fs.writeFile(sourceFile, 'Fallback content');
    
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'inject_context',
      source: path.join(tmpDir, 'topic-{topicId}', 'fallback.txt')
    };
    
    const result = await executeInject(hook, contextNoTopic, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBe('Fallback content');
  });

  it('exec_script action interpolates {topicId} in target path', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    
    // Create an executable script with interpolated path
    const scriptDir = path.join(tmpDir, 'topic-42');
    await fs.mkdir(scriptDir, { recursive: true });
    const scriptFile = path.join(scriptDir, 'test.sh');
    await fs.writeFile(scriptFile, '#!/bin/bash\necho "Success"\nexit 0');
    await fs.chmod(scriptFile, 0o755);
    
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'exec_script',
      target: path.join(tmpDir, 'topic-{topicId}', 'test.sh')
    };
    
    const result = await executeExecScript(hook, contextWithTopic, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.message).toContain('Success');
  });
});

// ─── exec_script with injectOutput ─────────────────────────────────────────────

describe('exec_script injectOutput feature', () => {
  const baseCtx: HookContext = {
    point: 'turn:pre',
    sessionKey: 'agent:main:test',
    timestamp: Date.now(),
  };

  it('captures stdout when injectOutput is true', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    
    const scriptFile = path.join(tmpDir, 'output-test.sh');
    await fs.writeFile(scriptFile, '#!/bin/bash\necho "Injected context line 1"\necho "Injected context line 2"');
    await fs.chmod(scriptFile, 0o755);
    
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'exec_script',
      target: scriptFile,
      injectOutput: true
    };
    
    const result = await executeExecScript(hook, baseCtx, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBeDefined();
    expect(result.injectedContent).toContain('Injected context line 1');
    expect(result.injectedContent).toContain('Injected context line 2');
  });

  it('does NOT capture stdout when injectOutput is false', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    
    const scriptFile = path.join(tmpDir, 'no-inject.sh');
    await fs.writeFile(scriptFile, '#!/bin/bash\necho "This should not be injected"');
    await fs.chmod(scriptFile, 0o755);
    
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'exec_script',
      target: scriptFile,
      injectOutput: false
    };
    
    const result = await executeExecScript(hook, baseCtx, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBeUndefined();
  });

  it('does NOT capture stdout when injectOutput is undefined (default)', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    
    const scriptFile = path.join(tmpDir, 'default.sh');
    await fs.writeFile(scriptFile, '#!/bin/bash\necho "Default behavior"');
    await fs.chmod(scriptFile, 0o755);
    
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'exec_script',
      target: scriptFile
    };
    
    const result = await executeExecScript(hook, baseCtx, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBeUndefined();
  });

  it('trims stdout whitespace when injectOutput is true', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    
    const scriptFile = path.join(tmpDir, 'whitespace.sh');
    await fs.writeFile(scriptFile, '#!/bin/bash\n\n  echo "  Content with spaces  "  \n\n');
    await fs.chmod(scriptFile, 0o755);
    
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'exec_script',
      target: scriptFile,
      injectOutput: true
    };
    
    const result = await executeExecScript(hook, baseCtx, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBe('Content with spaces');
  });

  it('does NOT inject empty stdout even when injectOutput is true', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    
    const scriptFile = path.join(tmpDir, 'empty.sh');
    await fs.writeFile(scriptFile, '#!/bin/bash\n# No output\nexit 0');
    await fs.chmod(scriptFile, 0o755);
    
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'exec_script',
      target: scriptFile,
      injectOutput: true
    };
    
    const result = await executeExecScript(hook, baseCtx, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.injectedContent).toBeUndefined();
  });

  it('does NOT inject stdout when script fails, even if injectOutput is true', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    
    const scriptFile = path.join(tmpDir, 'fail.sh');
    await fs.writeFile(scriptFile, '#!/bin/bash\necho "This should not inject"\nexit 1');
    await fs.chmod(scriptFile, 0o755);
    
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'exec_script',
      target: scriptFile,
      injectOutput: true
    };
    
    const result = await executeExecScript(hook, baseCtx, Date.now());
    
    expect(result.passed).toBe(false);
    expect(result.injectedContent).toBeUndefined();
  });

  it('captures multi-line output correctly', async () => {
    const { executeExecScript } = await import('../src/actions/exec-script');
    
    const scriptFile = path.join(tmpDir, 'multiline.sh');
    const scriptContent = `#!/bin/bash
cat <<'EOF'
Line 1
Line 2
Line 3
EOF
`;
    await fs.writeFile(scriptFile, scriptContent);
    await fs.chmod(scriptFile, 0o755);
    
    const hook: HookDefinition = { 
      ...baseHook, 
      action: 'exec_script',
      target: scriptFile,
      injectOutput: true
    };
    
    const result = await executeExecScript(hook, baseCtx, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.injectedContent).toContain('Line 1');
    expect(result.injectedContent).toContain('Line 2');
    expect(result.injectedContent).toContain('Line 3');
  });
});

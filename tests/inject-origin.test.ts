/**
 * tests/inject-origin.test.ts — Tests for inject_origin action.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { HookContext, HookDefinition } from '../src/types';
import { executeInjectOrigin } from '../src/actions/inject-origin';
import {
  setOriginContext,
  clearAllOriginContexts,
} from '../src/context-store';

const baseHook: HookDefinition = {
  point: 'turn:tool:pre',
  action: 'inject_origin',
};

describe('inject_origin action', () => {
  beforeEach(() => {
    clearAllOriginContexts();
  });

  it('returns passed=true (non-blocking)', async () => {
    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
      toolName: 'sessions_spawn',
      toolArgs: { task: 'Do something' },
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    expect(result.passed).toBe(true);
  });

  it('action field is "inject_origin"', async () => {
    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey: 'agent:main:test',
      toolName: 'sessions_spawn',
      toolArgs: {},
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    expect(result.action).toBe('inject_origin');
  });

  it('skips injection for non-sessions_spawn tools', async () => {
    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey: 'agent:main:test',
      toolName: 'exec',
      toolArgs: { command: 'ls' },
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    expect(result.passed).toBe(true);
    expect(result.message).toContain('Not a sessions_spawn');
    expect(result.modifiedParams).toBeUndefined();
  });

  it('skips injection when no origin context available', async () => {
    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey: 'agent:main:unknown',
      toolName: 'sessions_spawn',
      toolArgs: { task: 'Test task' },
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    expect(result.passed).toBe(true);
    expect(result.message).toContain('No origin context available');
    expect(result.modifiedParams).toBeUndefined();
  });

  it('injects full origin context with all fields', async () => {
    const sessionKey = 'agent:main:telegram:group:-100EXAMPLE456789:topic:42';
    
    setOriginContext(sessionKey, {
      topicId: 42,
      chatId: 'group:-100EXAMPLE456789',
      sender: 'testuser',
      parentSessionKey: sessionKey,
    });

    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey,
      toolName: 'sessions_spawn',
      toolArgs: { task: 'Original task' },
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.modifiedParams).toBeDefined();
    expect(result.modifiedParams?.['task']).toContain('Original task');
    expect(result.modifiedParams?.['task']).toContain('[origin:');
    expect(result.modifiedParams?.['task']).toContain('topic=42');
    expect(result.modifiedParams?.['task']).toContain('chat=group:-100EXAMPLE456789');
    expect(result.modifiedParams?.['task']).toContain('sender=testuser');
    expect(result.modifiedParams?.['task']).toContain(`parent=${sessionKey}`);
  });

  it('injects partial origin context (no topic, no sender)', async () => {
    const sessionKey = 'agent:main:telegram:private:12345';
    
    setOriginContext(sessionKey, {
      chatId: 'private:12345',
      parentSessionKey: sessionKey,
      // No topicId or sender
    });

    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey,
      toolName: 'sessions_spawn',
      toolArgs: { task: 'Test' },
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    
    expect(result.passed).toBe(true);
    expect(result.modifiedParams).toBeDefined();
    expect(result.modifiedParams?.['task']).toContain('[origin:');
    expect(result.modifiedParams?.['task']).toContain('chat=private:12345');
    expect(result.modifiedParams?.['task']).toContain(`parent=${sessionKey}`);
    // Should not contain topic or sender
    expect(result.modifiedParams?.['task']).not.toContain('topic=');
    expect(result.modifiedParams?.['task']).not.toContain('sender=');
  });

  it('appends origin tag to existing task content', async () => {
    const sessionKey = 'agent:main:test';
    
    setOriginContext(sessionKey, {
      parentSessionKey: sessionKey,
      topicId: 99,
    });

    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey,
      toolName: 'sessions_spawn',
      toolArgs: { task: 'Do important work\nWith multiple lines' },
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    
    expect(result.modifiedParams?.['task']).toContain('Do important work');
    expect(result.modifiedParams?.['task']).toContain('With multiple lines');
    expect(result.modifiedParams?.['task']).toContain('[origin:');
    // Origin tag should come after the original content
    const taskStr = String(result.modifiedParams?.['task']);
    expect(taskStr.indexOf('With multiple lines')).toBeLessThan(taskStr.indexOf('[origin:'));
  });

  it('handles empty task parameter', async () => {
    const sessionKey = 'agent:main:test';
    
    setOriginContext(sessionKey, {
      parentSessionKey: sessionKey,
      chatId: 'test-chat',
    });

    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey,
      toolName: 'sessions_spawn',
      toolArgs: { task: '' },
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    
    expect(result.modifiedParams?.['task']).toBe('[origin: chat=test-chat, parent=agent:main:test]');
  });

  it('handles missing task parameter', async () => {
    const sessionKey = 'agent:main:test';
    
    setOriginContext(sessionKey, {
      parentSessionKey: sessionKey,
    });

    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey,
      toolName: 'sessions_spawn',
      toolArgs: {}, // No task param
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    
    expect(result.modifiedParams?.['task']).toContain('[origin:');
    expect(result.modifiedParams?.['task']).toContain('parent=agent:main:test');
  });

  it('preserves other tool args while modifying task', async () => {
    const sessionKey = 'agent:main:test';
    
    setOriginContext(sessionKey, {
      parentSessionKey: sessionKey,
    });

    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey,
      toolName: 'sessions_spawn',
      toolArgs: {
        task: 'Test',
        label: 'test-subagent',
        timeout: 30000,
      },
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    
    expect(result.modifiedParams?.['label']).toBe('test-subagent');
    expect(result.modifiedParams?.['timeout']).toBe(30000);
    expect(result.modifiedParams?.['task']).toContain('[origin:');
  });

  it('includes message describing the injection', async () => {
    const sessionKey = 'agent:main:test';
    
    setOriginContext(sessionKey, {
      parentSessionKey: sessionKey,
      topicId: 42,
    });

    const context: HookContext = {
      point: 'turn:tool:pre',
      sessionKey,
      toolName: 'sessions_spawn',
      toolArgs: { task: 'Test' },
      timestamp: Date.now(),
    };

    const result = await executeInjectOrigin(baseHook, context, Date.now());
    
    expect(result.message).toBeTruthy();
    expect(result.message).toContain('Injected origin context');
    expect(result.message).toContain('[origin:');
  });
});

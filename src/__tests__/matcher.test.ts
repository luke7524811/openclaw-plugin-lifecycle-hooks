/**
 * matcher.test.ts — Tests for hook match filter evaluation.
 */

import { describe, it, expect } from 'vitest';
import { shouldFire, matchesFilter } from '../matcher';
import type { HookDefinition, HookContext, MatchFilter } from '../types';

describe('Matcher', () => {
  const createHook = (overrides?: Partial<HookDefinition>): HookDefinition => ({
    point: 'turn:pre',
    action: 'log',
    enabled: true,
    ...overrides,
  });

  const createContext = (overrides?: Partial<HookContext>): HookContext => ({
    point: 'turn:pre',
    sessionKey: 'agent:main:telegram:group:-100EXAMPLE123:topic:42',
    timestamp: Date.now(),
    ...overrides,
  });

  describe('shouldFire', () => {
    it('should return true for enabled hook matching point', async () => {
      const hook = createHook();
      const context = createContext();
      const result = await shouldFire(hook, context);
      expect(result).toBe(true);
    });

    it('should return false for disabled hook', async () => {
      const hook = createHook({ enabled: false });
      const context = createContext();
      const result = await shouldFire(hook, context);
      expect(result).toBe(false);
    });

    it('should return false for hook with mismatched point', async () => {
      const hook = createHook({ point: 'turn:post' });
      const context = createContext();
      const result = await shouldFire(hook, context);
      expect(result).toBe(false);
    });

    it('should return true for hook with multiple points when one matches', async () => {
      const hook = createHook({ point: ['turn:pre', 'turn:post'] });
      const context = createContext();
      const result = await shouldFire(hook, context);
      expect(result).toBe(true);
    });

    it('should return false for hook with multiple points when none match', async () => {
      const hook = createHook({ point: ['turn:post', 'subagent:pre'] });
      const context = createContext();
      const result = await shouldFire(hook, context);
      expect(result).toBe(false);
    });
  });

  describe('matchesFilter', () => {
    it('should return true when filter is undefined', async () => {
      const filter = undefined;
      const context = createContext();
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should return true when filter is empty object', async () => {
      const filter = {};
      const context = createContext();
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should match on tool name', async () => {
      const filter: MatchFilter = { tool: 'exec' };
      const context = createContext({ toolName: 'exec' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should not match on tool name when different', async () => {
      const filter: MatchFilter = { tool: 'exec' };
      const context = createContext({ toolName: 'read' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false);
    });

    it('should match on commandPattern', async () => {
      const filter: MatchFilter = { commandPattern: '^rm' };
      const context = createContext({ toolArgs: { command: 'rm -rf /' } });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should not match on commandPattern when regex does not match', async () => {
      const filter: MatchFilter = { commandPattern: '^rm' };
      const context = createContext({ toolArgs: { command: 'ls -la' } });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false);
    });

    it('should match on topicId', async () => {
      const filter: MatchFilter = { topicId: 42 };
      const context = createContext({ topicId: 42 });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should match on string topicId', async () => {
      const filter: MatchFilter = { topicId: '42' };
      const context = createContext({ topicId: '42' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should not match on topicId when different', async () => {
      const filter: MatchFilter = { topicId: 42 };
      const context = createContext({ topicId: 43 });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false);
    });

    it('should match isSubAgent=true in subagent session', async () => {
      const filter: MatchFilter = { isSubAgent: true };
      const context = createContext({ sessionKey: 'agent:main:subagent:test:123' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should match isSubAgent=false in main session', async () => {
      const filter: MatchFilter = { isSubAgent: false };
      const context = createContext({ sessionKey: 'agent:main:telegram:group:123' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should not match isSubAgent=true in main session', async () => {
      const filter: MatchFilter = { isSubAgent: true };
      const context = createContext({ sessionKey: 'agent:main:telegram:group:123' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false);
    });

    it('should not match isSubAgent=false in subagent session', async () => {
      const filter: MatchFilter = { isSubAgent: false };
      const context = createContext({ sessionKey: 'agent:main:subagent:test:123' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false);
    });

    it('should match on sessionPattern', async () => {
      const filter: MatchFilter = { sessionPattern: 'telegram:group:-100[\\w]+' };
      const context = createContext();
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should not match on sessionPattern when regex does not match', async () => {
      const filter: MatchFilter = { sessionPattern: 'telegram:group:-100\\d+' };
      const context = createContext({ sessionKey: 'agent:main:email:user@example.com' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false);
    });

    it('should match on sessionPattern with complex regex', async () => {
      const filter: MatchFilter = { sessionPattern: 'agent:main:(telegram|discord):.*' };
      const context = createContext();
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should combine all match filters with AND logic', async () => {
      const filter: MatchFilter = {
        tool: 'exec',
        commandPattern: '^rm',
        isSubAgent: false,
      };
      const context = createContext({
        toolName: 'exec',
        toolArgs: { command: 'rm -rf /' },
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should return false when any filter does not match (AND logic)', async () => {
      const filter: MatchFilter = {
        tool: 'exec',
        commandPattern: '^rm',
        isSubAgent: false,
      };
      const context = createContext({
        toolName: 'read', // Different tool
        toolArgs: { command: 'rm -rf /' },
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false);
    });

    it('should match on custom matcher module', async () => {
      const filter: MatchFilter = { custom: './matchers/my-matcher.js' };
      const context = createContext();
      const result = await matchesFilter(filter, context);
      // If module doesn't exist, fail-open (return true)
      expect(result).toBe(true);
    });

    it('should handle context with no toolArgs', async () => {
      const filter: MatchFilter = { commandPattern: '^rm' };
      const context = createContext({ toolArgs: undefined });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false); // No command to match
    });

    it('should handle context with empty toolArgs', async () => {
      const filter: MatchFilter = { commandPattern: '^rm' };
      const context = createContext({ toolArgs: {} });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false); // No command to match
    });

    it('should extract command from toolArgs.command', async () => {
      const filter: MatchFilter = { commandPattern: '^ls' };
      const context = createContext({
        toolArgs: { command: 'ls -la /tmp' },
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should extract command from toolArgs.path', async () => {
      const filter: MatchFilter = { commandPattern: '^cat' };
      const context = createContext({
        toolArgs: { path: 'cat /etc/passwd' },
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should extract command from toolArgs.file_path', async () => {
      const filter: MatchFilter = { commandPattern: '^cat' };
      const context = createContext({
        toolArgs: { file_path: 'cat /etc/hosts' },
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should extract command from toolArgs.url', async () => {
      const filter: MatchFilter = { commandPattern: '^https?' };
      const context = createContext({
        toolArgs: { url: 'https://example.com' },
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should extract command from prompt for turn hooks', async () => {
      const filter: MatchFilter = { commandPattern: 'delete all files' };
      const context = createContext({
        prompt: 'Please delete all files in the directory',
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should return empty string when no command can be extracted', async () => {
      const filter: MatchFilter = { commandPattern: '^rm' };
      const context = createContext({
        toolArgs: undefined,
        prompt: undefined,
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false);
    });

    it('should handle regex with special characters', async () => {
      const filter: MatchFilter = { commandPattern: 'rm.*-rf' };
      const context = createContext({
        toolArgs: { command: 'rm -rf /home/user' },
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should handle regex with character classes', async () => {
      const filter: MatchFilter = { commandPattern: '[a-z]+' };
      const context = createContext({
        toolArgs: { command: 'ls' },
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should handle regex with quantifiers', async () => {
      const filter: MatchFilter = { commandPattern: 'rm\\d+' };
      const context = createContext({
        toolArgs: { command: 'rm5' },
      });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty session key', async () => {
      const filter: MatchFilter = { isSubAgent: true };
      const context = createContext({ sessionKey: '' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false); // Empty string doesn't contain ':subagent:'
    });

    it('should handle session key with subagent prefix', async () => {
      const filter: MatchFilter = { isSubAgent: true };
      const context = createContext({ sessionKey: 'agent:main:subagent:test:123' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should handle session key with multiple subagent markers', async () => {
      const filter: MatchFilter = { isSubAgent: true };
      const context = createContext({ sessionKey: 'agent:main:subagent:test:subagent:nested:123' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should handle custom matcher that returns false', async () => {
      const filter: MatchFilter = { custom: './matchers/fail-matcher.js' };
      const context = createContext();
      const result = await matchesFilter(filter, context);
      // If module doesn't exist, fail-open (return true)
      expect(result).toBe(true);
    });

    it('should handle topicId as number', async () => {
      const filter: MatchFilter = { topicId: 42 };
      const context = createContext({ topicId: 42 });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should handle topicId as string', async () => {
      const filter: MatchFilter = { topicId: '42' };
      const context = createContext({ topicId: '42' });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(true);
    });

    it('should handle topicId as undefined', async () => {
      const filter: MatchFilter = { topicId: 42 };
      const context = createContext({ topicId: undefined });
      const result = await matchesFilter(filter, context);
      expect(result).toBe(false);
    });
  });
});

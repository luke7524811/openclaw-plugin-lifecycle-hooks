/**
 * tests/matcher.test.ts — Match filter evaluation tests.
 */

import { describe, it, expect } from 'vitest';
import { shouldFire, matchesFilter } from '../src/matcher';
import type { HookDefinition, HookContext, MatchFilter } from '../src/types';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    point: 'turn:pre',
    sessionKey: 'agent:main:telegram:group:-100EXAMPLE123:topic:42',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    point: 'turn:pre',
    action: 'log',
    ...overrides,
  };
}

// ─── shouldFire() tests ──────────────────────────────────────────────────────

describe('shouldFire()', () => {
  it('returns true for matching point with no filter', async () => {
    const hook = makeHook({ point: 'turn:pre' });
    const ctx = makeContext({ point: 'turn:pre' });
    expect(await shouldFire(hook, ctx)).toBe(true);
  });

  it('returns false for wrong point', async () => {
    const hook = makeHook({ point: 'turn:post' });
    const ctx = makeContext({ point: 'turn:pre' });
    expect(await shouldFire(hook, ctx)).toBe(false);
  });

  it('returns false for disabled hook', async () => {
    const hook = makeHook({ point: 'turn:pre', enabled: false });
    const ctx = makeContext({ point: 'turn:pre' });
    expect(await shouldFire(hook, ctx)).toBe(false);
  });

  it('returns true for enabled: true explicitly', async () => {
    const hook = makeHook({ point: 'turn:pre', enabled: true });
    const ctx = makeContext({ point: 'turn:pre' });
    expect(await shouldFire(hook, ctx)).toBe(true);
  });

  it('returns true for array of points when context point matches', async () => {
    const hook = makeHook({ point: ['turn:pre', 'turn:tool:pre'] });
    const ctx = makeContext({ point: 'turn:tool:pre' });
    expect(await shouldFire(hook, ctx)).toBe(true);
  });

  it('returns false for array of points when context point does not match', async () => {
    const hook = makeHook({ point: ['turn:pre', 'turn:tool:pre'] });
    const ctx = makeContext({ point: 'turn:post' });
    expect(await shouldFire(hook, ctx)).toBe(false);
  });

  it('evaluates match filter — returns false when filter does not match', async () => {
    const hook = makeHook({
      point: 'turn:tool:pre',
      match: { tool: 'exec' },
    });
    const ctx = makeContext({ point: 'turn:tool:pre', toolName: 'Read' });
    expect(await shouldFire(hook, ctx)).toBe(false);
  });
});

// ─── matchesFilter() tests ───────────────────────────────────────────────────

describe('matchesFilter()', () => {
  describe('no filter', () => {
    it('returns true when filter is undefined', async () => {
      expect(await matchesFilter(undefined, makeContext())).toBe(true);
    });

    it('returns true when filter is an empty object', async () => {
      expect(await matchesFilter({}, makeContext())).toBe(true);
    });
  });

  describe('tool filter', () => {
    it('matches when tool name equals filter', async () => {
      const filter: MatchFilter = { tool: 'exec' };
      const ctx = makeContext({ toolName: 'exec' });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });

    it('does not match when tool name differs', async () => {
      const filter: MatchFilter = { tool: 'exec' };
      const ctx = makeContext({ toolName: 'Read' });
      expect(await matchesFilter(filter, ctx)).toBe(false);
    });

    it('does not match when toolName is undefined', async () => {
      const filter: MatchFilter = { tool: 'exec' };
      const ctx = makeContext({ toolName: undefined });
      expect(await matchesFilter(filter, ctx)).toBe(false);
    });
  });

  describe('commandPattern filter', () => {
    it('matches when command matches pattern', async () => {
      const filter: MatchFilter = { commandPattern: '^rm\\s' };
      const ctx = makeContext({
        toolName: 'exec',
        toolArgs: { command: 'rm somefile.txt' },
      });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });

    it('does not match when command does not match pattern', async () => {
      const filter: MatchFilter = { commandPattern: '^rm\\s' };
      const ctx = makeContext({
        toolName: 'exec',
        toolArgs: { command: 'ls -la' },
      });
      expect(await matchesFilter(filter, ctx)).toBe(false);
    });

    it('falls back to prompt when no toolArgs', async () => {
      const filter: MatchFilter = { commandPattern: 'hello' };
      const ctx = makeContext({ prompt: 'say hello world' });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });

    it('matches rm -rf pattern', async () => {
      const filter: MatchFilter = { commandPattern: 'rm\\s+-r' };
      const ctx = makeContext({
        toolName: 'exec',
        toolArgs: { command: 'rm -rf /tmp/test' },
      });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });
  });

  describe('topicId filter', () => {
    it('matches when topicId equals (number)', async () => {
      const filter: MatchFilter = { topicId: 42 };
      const ctx = makeContext({ topicId: 42 });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });

    it('matches when topicId equals (string)', async () => {
      const filter: MatchFilter = { topicId: '42' };
      const ctx = makeContext({ topicId: 42 });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });

    it('does not match when topicId differs', async () => {
      const filter: MatchFilter = { topicId: 42 };
      const ctx = makeContext({ topicId: 99 });
      expect(await matchesFilter(filter, ctx)).toBe(false);
    });

    it('does not match when topicId is undefined in context', async () => {
      const filter: MatchFilter = { topicId: 42 };
      const ctx = makeContext({ topicId: undefined });
      expect(await matchesFilter(filter, ctx)).toBe(false);
    });
  });

  describe('isSubAgent filter', () => {
    const subagentSession = 'agent:main:subagent:abc123';
    const mainSession = 'agent:main:telegram:group:-100EXAMPLE123:topic:42';

    it('isSubAgent=true matches sub-agent session', async () => {
      const filter: MatchFilter = { isSubAgent: true };
      const ctx = makeContext({ sessionKey: subagentSession });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });

    it('isSubAgent=true does not match main session', async () => {
      const filter: MatchFilter = { isSubAgent: true };
      const ctx = makeContext({ sessionKey: mainSession });
      expect(await matchesFilter(filter, ctx)).toBe(false);
    });

    it('isSubAgent=false matches main session', async () => {
      const filter: MatchFilter = { isSubAgent: false };
      const ctx = makeContext({ sessionKey: mainSession });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });

    it('isSubAgent=false does not match sub-agent session', async () => {
      const filter: MatchFilter = { isSubAgent: false };
      const ctx = makeContext({ sessionKey: subagentSession });
      expect(await matchesFilter(filter, ctx)).toBe(false);
    });
  });

  describe('sessionPattern filter', () => {
    it('matches when sessionKey matches pattern', async () => {
      const filter: MatchFilter = { sessionPattern: 'telegram:group' };
      const ctx = makeContext({
        sessionKey: 'agent:main:telegram:group:-100EXAMPLE123:topic:42',
      });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });

    it('does not match when sessionKey does not match pattern', async () => {
      const filter: MatchFilter = { sessionPattern: 'whatsapp' };
      const ctx = makeContext({
        sessionKey: 'agent:main:telegram:group:-100EXAMPLE123:topic:42',
      });
      expect(await matchesFilter(filter, ctx)).toBe(false);
    });

    it('supports regex patterns', async () => {
      const filter: MatchFilter = { sessionPattern: 'topic:\\d+$' };
      const ctx = makeContext({
        sessionKey: 'agent:main:telegram:group:-100EXAMPLE123:topic:42',
      });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });
  });

  describe('AND logic (multiple fields)', () => {
    it('matches when all filter fields match', async () => {
      const filter: MatchFilter = {
        tool: 'exec',
        commandPattern: '^rm\\s',
      };
      const ctx = makeContext({
        toolName: 'exec',
        toolArgs: { command: 'rm somefile.txt' },
      });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });

    it('does not match when one field fails', async () => {
      const filter: MatchFilter = {
        tool: 'exec',
        commandPattern: '^rm\\s',
      };
      // Tool matches but command pattern does not
      const ctx = makeContext({
        toolName: 'exec',
        toolArgs: { command: 'ls -la' },
      });
      expect(await matchesFilter(filter, ctx)).toBe(false);
    });

    it('does not match when second field fails', async () => {
      const filter: MatchFilter = {
        tool: 'exec',
        commandPattern: '^rm\\s',
      };
      // Command pattern matches but tool does not
      const ctx = makeContext({
        toolName: 'Write',
        toolArgs: { command: 'rm somefile.txt' },
      });
      expect(await matchesFilter(filter, ctx)).toBe(false);
    });

    it('matches three fields all present', async () => {
      const filter: MatchFilter = {
        tool: 'exec',
        isSubAgent: true,
        commandPattern: 'rm',
      };
      const ctx = makeContext({
        point: 'subagent:tool:pre',
        sessionKey: 'agent:main:subagent:abc123',
        toolName: 'exec',
        toolArgs: { command: 'rm -rf /tmp/test' },
      });
      expect(await matchesFilter(filter, ctx)).toBe(true);
    });
  });
});

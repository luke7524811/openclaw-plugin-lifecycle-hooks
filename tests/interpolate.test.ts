/**
 * tests/interpolate.test.ts — Tests for variable interpolation utility.
 *
 * Covers:
 * - extractTopicId from session keys
 * - interpolateVariables with single/multiple variables
 * - Missing topicId fallback to 'unknown'
 */

import { describe, it, expect } from 'vitest';
import { extractTopicId, interpolateVariables } from '../src/utils/interpolate';
import type { HookContext } from '../src/types';

describe('extractTopicId', () => {
  it('extracts topic ID from a standard session key', () => {
    const sessionKey = 'agent:main:telegram:group:-100EXAMPLE456789:topic:42';
    expect(extractTopicId(sessionKey)).toBe('42');
  });

  it('extracts topic ID from session key with multiple colons', () => {
    const sessionKey = 'agent:main:subagent:abc123:topic:999';
    expect(extractTopicId(sessionKey)).toBe('999');
  });

  it('returns "unknown" when no topic pattern found', () => {
    const sessionKey = 'agent:main:telegram:user:12345';
    expect(extractTopicId(sessionKey)).toBe('unknown');
  });

  it('returns "unknown" for empty session key', () => {
    expect(extractTopicId('')).toBe('unknown');
  });

  it('returns "unknown" when topic pattern is malformed', () => {
    const sessionKey = 'agent:main:telegram:group:-100EXAMPLE:topic:';
    expect(extractTopicId(sessionKey)).toBe('unknown');
  });

  it('extracts first topic ID when multiple topic patterns exist (edge case)', () => {
    const sessionKey = 'agent:main:topic:42:subtopic:topic:999';
    expect(extractTopicId(sessionKey)).toBe('42');
  });
});

describe('interpolateVariables', () => {
  // Use a fixed timestamp that we can verify
  const testTimestamp = 1739948400000;
  const expectedIsoTimestamp = new Date(testTimestamp).toISOString();
  
  const baseContext: HookContext = {
    point: 'turn:pre',
    sessionKey: 'agent:main:telegram:group:-100EXAMPLE456789:topic:42',
    topicId: 42,
    timestamp: testTimestamp,
  };

  it('interpolates {topicId} from context.topicId', () => {
    const path = 'logs/topic-{topicId}/events.jsonl';
    expect(interpolateVariables(path, baseContext)).toBe('logs/topic-42/events.jsonl');
  });

  it('interpolates {topicId} from sessionKey when context.topicId is undefined', () => {
    const ctx: HookContext = {
      ...baseContext,
      topicId: undefined,
    };
    const path = 'logs/topic-{topicId}/events.jsonl';
    expect(interpolateVariables(path, ctx)).toBe('logs/topic-42/events.jsonl');
  });

  it('uses "unknown" for {topicId} when not in context or sessionKey', () => {
    const ctx: HookContext = {
      ...baseContext,
      topicId: undefined,
      sessionKey: 'agent:main:telegram:user:12345',
    };
    const path = 'logs/topic-{topicId}/events.jsonl';
    expect(interpolateVariables(path, ctx)).toBe('logs/topic-unknown/events.jsonl');
  });

  it('interpolates {sessionKey}', () => {
    const path = 'context/{sessionKey}/history.txt';
    const expected = 'context/agent:main:telegram:group:-100EXAMPLE456789:topic:42/history.txt';
    expect(interpolateVariables(path, baseContext)).toBe(expected);
  });

  it('interpolates {timestamp} as ISO 8601', () => {
    const path = 'logs/events-{timestamp}.jsonl';
    expect(interpolateVariables(path, baseContext)).toBe(`logs/events-${expectedIsoTimestamp}.jsonl`);
  });

  it('interpolates multiple variables in one path', () => {
    const path = 'logs/{topicId}/session-{sessionKey}-{timestamp}.log';
    const result = interpolateVariables(path, baseContext);
    const expected = `logs/42/session-agent:main:telegram:group:-100EXAMPLE456789:topic:42-${expectedIsoTimestamp}.log`;
    expect(result).toBe(expected);
  });

  it('interpolates the same variable multiple times', () => {
    const path = '{topicId}-start/{topicId}-end';
    expect(interpolateVariables(path, baseContext)).toBe('42-start/42-end');
  });

  it('returns path unchanged when no variables present', () => {
    const path = 'logs/static-file.jsonl';
    expect(interpolateVariables(path, baseContext)).toBe('logs/static-file.jsonl');
  });

  it('handles empty path string', () => {
    expect(interpolateVariables('', baseContext)).toBe('');
  });

  it('does not replace unknown placeholders', () => {
    const path = 'logs/{unknownVar}/test.log';
    expect(interpolateVariables(path, baseContext)).toBe('logs/{unknownVar}/test.log');
  });

  it('handles numeric topicId correctly', () => {
    const ctx: HookContext = {
      ...baseContext,
      topicId: 999,
    };
    const path = 'topic-{topicId}.log';
    expect(interpolateVariables(path, ctx)).toBe('topic-999.log');
  });

  it('handles string topicId correctly', () => {
    const ctx: HookContext = {
      ...baseContext,
      topicId: 'custom-topic',
    };
    const path = 'topic-{topicId}.log';
    expect(interpolateVariables(path, ctx)).toBe('topic-custom-topic.log');
  });
});

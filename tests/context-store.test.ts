/**
 * tests/context-store.test.ts — Tests for origin context storage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setOriginContext,
  getOriginContext,
  clearOriginContext,
  clearAllOriginContexts,
  getOriginContextStoreSize,
  extractTopicId,
  extractChatId,
  extractSenderFromKey,
} from '../src/context-store';

describe('context-store', () => {
  beforeEach(() => {
    clearAllOriginContexts();
  });

  describe('store operations', () => {
    it('sets and gets origin context', () => {
      const sessionKey = 'agent:main:telegram:group:-100EXAMPLE456789:topic:42';
      const context = {
        topicId: 42,
        chatId: 'group:-100EXAMPLE456789',
        sender: 'testuser',
        parentSessionKey: sessionKey,
      };

      setOriginContext(sessionKey, context);
      const retrieved = getOriginContext(sessionKey);

      expect(retrieved).toEqual(context);
    });

    it('returns undefined for unknown session key', () => {
      const result = getOriginContext('unknown-key');
      expect(result).toBeUndefined();
    });

    it('clears origin context for a session', () => {
      const sessionKey = 'agent:main:telegram:group:-100EXAMPLE:topic:42';
      const context = {
        topicId: 42,
        chatId: 'group:-100EXAMPLE',
        parentSessionKey: sessionKey,
      };

      setOriginContext(sessionKey, context);
      expect(getOriginContext(sessionKey)).toBeDefined();

      clearOriginContext(sessionKey);
      expect(getOriginContext(sessionKey)).toBeUndefined();
    });

    it('clears all contexts', () => {
      setOriginContext('session1', { parentSessionKey: 'session1', topicId: 1 });
      setOriginContext('session2', { parentSessionKey: 'session2', topicId: 2 });

      expect(getOriginContextStoreSize()).toBe(2);

      clearAllOriginContexts();

      expect(getOriginContextStoreSize()).toBe(0);
      expect(getOriginContext('session1')).toBeUndefined();
      expect(getOriginContext('session2')).toBeUndefined();
    });

    it('tracks store size correctly', () => {
      expect(getOriginContextStoreSize()).toBe(0);

      setOriginContext('key1', { parentSessionKey: 'key1' });
      expect(getOriginContextStoreSize()).toBe(1);

      setOriginContext('key2', { parentSessionKey: 'key2' });
      expect(getOriginContextStoreSize()).toBe(2);

      clearOriginContext('key1');
      expect(getOriginContextStoreSize()).toBe(1);
    });
  });

  describe('extractTopicId', () => {
    it('extracts topic ID from session key with topic', () => {
      const key = 'agent:main:telegram:group:-100EXAMPLE456789:topic:42';
      expect(extractTopicId(key)).toBe(42);
    });

    it('returns undefined for session key without topic', () => {
      const key = 'agent:main:telegram:private:12345';
      expect(extractTopicId(key)).toBeUndefined();
    });

    it('handles multi-digit topic IDs', () => {
      const key = 'agent:main:telegram:group:-100999:topic:999888777';
      expect(extractTopicId(key)).toBe(999888777);
    });
  });

  describe('extractChatId', () => {
    it('extracts group chat ID', () => {
      const key = 'agent:main:telegram:group:-100EXAMPLE456789:topic:42';
      expect(extractChatId(key)).toBe('group:-100EXAMPLE456789');
    });

    it('extracts private chat ID', () => {
      const key = 'agent:main:telegram:private:12345';
      expect(extractChatId(key)).toBe('private:12345');
    });

    it('extracts channel chat ID', () => {
      const key = 'agent:main:telegram:channel:-100999888777';
      expect(extractChatId(key)).toBe('channel:-100999888777');
    });

    it('returns undefined for non-telegram session key', () => {
      const key = 'agent:main:discord:server:123';
      expect(extractChatId(key)).toBeUndefined();
    });
  });

  describe('extractSenderFromKey', () => {
    it('extracts user ID from private chat key', () => {
      const key = 'agent:main:telegram:private:123456789';
      expect(extractSenderFromKey(key)).toBe('123456789');
    });

    it('returns undefined for group chat (sender not in key)', () => {
      const key = 'agent:main:telegram:group:-100EXAMPLE456789:topic:42';
      expect(extractSenderFromKey(key)).toBeUndefined();
    });

    it('returns undefined for non-telegram key', () => {
      const key = 'agent:main:other:session:123';
      expect(extractSenderFromKey(key)).toBeUndefined();
    });
  });
});

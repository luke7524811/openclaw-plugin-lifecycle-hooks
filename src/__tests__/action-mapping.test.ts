/**
 * action-mapping.test.ts — Tests for semantic action type mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  TOOL_TO_ACTION,
  extractSemanticAction,
  matchesAction,
  hasGlobWildcards,
} from '../action-mapping';

describe('Action Mapping', () => {
  describe('TOOL_TO_ACTION mapping', () => {
    it('should contain expected mappings', () => {
      expect(TOOL_TO_ACTION['read']).toBe('fs.read');
      expect(TOOL_TO_ACTION['write']).toBe('fs.write');
      expect(TOOL_TO_ACTION['edit']).toBe('fs.write');
      expect(TOOL_TO_ACTION['exec']).toBe('shell.exec');
      expect(TOOL_TO_ACTION['web_search']).toBe('http.request');
      expect(TOOL_TO_ACTION['web_fetch']).toBe('http.request');
      expect(TOOL_TO_ACTION['browser']).toBe('browser.navigate');
      expect(TOOL_TO_ACTION['pdf']).toBe('document.read');
      expect(TOOL_TO_ACTION['image']).toBe('image.analyze');
      expect(TOOL_TO_ACTION['sessions_spawn']).toBe('agent.spawn');
      expect(TOOL_TO_ACTION['sessions_send']).toBe('agent.message');
      expect(TOOL_TO_ACTION['message']).toBe('messaging.send');
      expect(TOOL_TO_ACTION['cron']).toBe('system.schedule');
      expect(TOOL_TO_ACTION['gateway']).toBe('system.config');
    });

    it('should include file system operations', () => {
      expect(TOOL_TO_ACTION['delete']).toBe('fs.delete');
      expect(TOOL_TO_ACTION['mkdir']).toBe('fs.create');
      expect(TOOL_TO_ACTION['list']).toBe('fs.read');
      expect(TOOL_TO_ACTION['stat']).toBe('fs.read');
    });

    it('should include shell operations', () => {
      expect(TOOL_TO_ACTION['spawn']).toBe('shell.exec');
      expect(TOOL_TO_ACTION['run']).toBe('shell.exec');
    });
  });

  describe('extractSemanticAction', () => {
    it('should return exact match for mapped tools', () => {
      expect(extractSemanticAction('read')).toBe('fs.read');
      expect(extractSemanticAction('exec')).toBe('shell.exec');
      expect(extractSemanticAction('web_search')).toBe('http.request');
      expect(extractSemanticAction('browser')).toBe('browser.navigate');
    });

    it('should return tool name for unmapped tools', () => {
      expect(extractSemanticAction('unknown_tool')).toBe('unknown_tool');
      expect(extractSemanticAction('custom_action')).toBe('custom_action');
    });

    it('should handle empty string', () => {
      expect(extractSemanticAction('')).toBe('');
    });

    it('should match tools with underscores and dots', () => {
      expect(extractSemanticAction('fs.read')).toBe('fs.read'); // Already semantic
      expect(extractSemanticAction('shell.exec')).toBe('shell.exec');
    });
  });

  describe('matchesAction', () => {
    it('should match exact action', () => {
      expect(matchesAction('read', 'fs.read')).toBe(true);
      expect(matchesAction('exec', 'shell.exec')).toBe(true);
      expect(matchesAction('web_search', 'http.request')).toBe(true);
    });

    it('should not match when actions differ', () => {
      expect(matchesAction('read', 'shell.exec')).toBe(false);
      expect(matchesAction('exec', 'fs.read')).toBe(false);
      expect(matchesAction('web_search', 'browser.navigate')).toBe(false);
    });

    it('should match with glob pattern on action filter (e.g., "fs.*")', () => {
      expect(matchesAction('read', 'fs.*')).toBe(true);
      expect(matchesAction('write', 'fs.*')).toBe(true);
      expect(matchesAction('edit', 'fs.*')).toBe(true);
      expect(matchesAction('delete', 'fs.*')).toBe(true);
      expect(matchesAction('list', 'fs.*')).toBe(true);
    });

    it('should match with glob pattern "shell.*"', () => {
      expect(matchesAction('exec', 'shell.*')).toBe(true);
      expect(matchesAction('spawn', 'shell.*')).toBe(true);
      expect(matchesAction('run', 'shell.*')).toBe(true);
    });

    it('should match with glob pattern "http.*"', () => {
      expect(matchesAction('web_search', 'http.*')).toBe(true);
      expect(matchesAction('web_fetch', 'http.*')).toBe(true);
      expect(matchesAction('http_get', 'http.*')).toBe(true);
      expect(matchesAction('http_post', 'http.*')).toBe(true);
    });

    it('should match with glob pattern "browser.*"', () => {
      expect(matchesAction('browser', 'browser.*')).toBe(true);
      expect(matchesAction('browser_navigate', 'browser.*')).toBe(true);
      expect(matchesAction('browser_click', 'browser.*')).toBe(true);
      expect(matchesAction('browser_type', 'browser.*')).toBe(true);
    });

    it('should match with glob pattern "agent.*"', () => {
      expect(matchesAction('sessions_spawn', 'agent.*')).toBe(true);
      expect(matchesAction('sessions_send', 'agent.*')).toBe(true);
      expect(matchesAction('subagent', 'agent.*')).toBe(true);
    });

    it('should match with glob pattern "messaging.*"', () => {
      expect(matchesAction('message', 'messaging.*')).toBe(true);
      expect(matchesAction('notify', 'messaging.*')).toBe(true);
      expect(matchesAction('broadcast', 'messaging.*')).toBe(true);
    });

    it('should match with glob pattern "system.*"', () => {
      expect(matchesAction('cron', 'system.*')).toBe(true);
      expect(matchesAction('gateway', 'system.*')).toBe(true);
      expect(matchesAction('system', 'system.*')).toBe(true);
    });

    it('should match with glob pattern "document.*"', () => {
      expect(matchesAction('pdf', 'document.*')).toBe(true);
    });

    it('should match with glob pattern "image.*"', () => {
      expect(matchesAction('image', 'image.*')).toBe(true);
    });

    it('should not match with non-matching glob pattern', () => {
      expect(matchesAction('read', 'shell.*')).toBe(false);
      expect(matchesAction('exec', 'fs.*')).toBe(false);
      expect(matchesAction('web_search', 'browser.*')).toBe(false);
    });

    it('should support exact prefix glob like "fs.re*"', () => {
      expect(matchesAction('read', 'fs.re*')).toBe(true);
      expect(matchesAction('write', 'fs.re*')).toBe(false); // doesn't start with "fs.re"
      expect(matchesAction('fs.read', 'fs.re*')).toBe(true);
    });

    it('should support character class patterns like "fs.[rw]*"', () => {
      expect(matchesAction('read', 'fs.[rw]*')).toBe(true);
      expect(matchesAction('write', 'fs.[rw]*')).toBe(true);
      expect(matchesAction('delete', 'fs.[rw]*')).toBe(false);
    });

    it('should return false for unknown tool with exact filter', () => {
      expect(matchesAction('unknown_tool', 'fs.read')).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(matchesAction('', 'fs.*')).toBe(false);
      expect(matchesAction('read', '')).toBe(false);
    });
  });

  describe('hasGlobWildcards', () => {
    it('should detect * wildcard', () => {
      expect(hasGlobWildcards('fs.*')).toBe(true);
      expect(hasGlobWildcards('*.js')).toBe(true);
    });

    it('should detect ? wildcard', () => {
      expect(hasGlobWildcards('file?.txt')).toBe(true);
    });

    it('should detect character classes', () => {
      expect(hasGlobWildcards('fs.[rw]')).toBe(true);
      expect(hasGlobWildcards('[abc]')).toBe(true);
    });

    it('should return false for plain patterns', () => {
      expect(hasGlobWildcards('fs.read')).toBe(false);
      expect(hasGlobWildcards('shell.exec')).toBe(false);
      expect(hasGlobWildcards('exact_match')).toBe(false);
    });

    it('should handle empty string', () => {
      expect(hasGlobWildcards('')).toBe(false);
    });
  });

  describe('Integration: Action filter in matcher', () => {
    // These tests verify that the matchesFilter function correctly uses matchesAction
    // The actual integration is tested in matcher.test.ts via the action field
    // Here we just verify the expected behavior at the boundary

    it('should match tool "read" against action filter "fs.*"', () => {
      expect(matchesAction('read', 'fs.*')).toBe(true);
    });

    it('should match tool "write" against action filter "fs.*"', () => {
      expect(matchesAction('write', 'fs.*')).toBe(true);
    });

    it('should match tool "edit" against action filter "fs.*"', () => {
      expect(matchesAction('edit', 'fs.*')).toBe(true);
    });

    it('should match tool "exec" against action filter "shell.*"', () => {
      expect(matchesAction('exec', 'shell.*')).toBe(true);
    });

    it('should match tool "web_search" against action filter "http.*"', () => {
      expect(matchesAction('web_search', 'http.*')).toBe(true);
    });

    it('should match tool "web_fetch" against action filter "http.*"', () => {
      expect(matchesAction('web_fetch', 'http.*')).toBe(true);
    });

    it('should match tool "browser" against action filter "browser.*"', () => {
      expect(matchesAction('browser', 'browser.*')).toBe(true);
    });

    it('should match tool "sessions_spawn" against action filter "agent.*"', () => {
      expect(matchesAction('sessions_spawn', 'agent.*')).toBe(true);
    });

    it('should match tool "message" against action filter "messaging.*"', () => {
      expect(matchesAction('message', 'messaging.*')).toBe(true);
    });

    it('should match tool "cron" against action filter "system.*"', () => {
      expect(matchesAction('cron', 'system.*')).toBe(true);
    });

    it('should match tool "pdf" against action filter "document.*"', () => {
      expect(matchesAction('pdf', 'document.*')).toBe(true);
    });

    it('should match tool "image" against action filter "image.*"', () => {
      expect(matchesAction('image', 'image.*')).toBe(true);
    });
  });
});

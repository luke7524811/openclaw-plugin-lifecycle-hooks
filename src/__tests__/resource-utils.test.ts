/**
 * resource-utils.test.ts — Unit tests for resource pattern matching utilities.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  expandHome,
  matchResourcePattern,
  isSensitiveResource,
} from '../resource-utils';

describe('Resource Utils', () => {
  describe('expandHome', () => {
    it('should expand leading tilde to HOME environment variable', () => {
      const originalHome = process.env.HOME;
      process.env.HOME = '/home/testuser';

      expect(expandHome('~/.ssh/id_rsa')).toBe('/home/testuser/.ssh/id_rsa');
      expect(expandHome('~')).toBe('/home/testuser');
      expect(expandHome('~/projects/')).toBe('/home/testuser/projects/');

      // Restore original HOME
      if (originalHome) process.env.HOME = originalHome;
    });

    it('should leave paths without tilde unchanged', () => {
      expect(expandHome('/etc/passwd')).toBe('/etc/passwd');
      expect(expandHome('/home/user/file.txt')).toBe('/home/user/file.txt');
      expect(expandHome('relative/path')).toBe('relative/path');
    });

    it('should handle empty string', () => {
      expect(expandHome('')).toBe('');
    });

    it('should handle tilde in middle of path (only leading tilde is expanded)', () => {
      const originalHome = process.env.HOME;
      process.env.HOME = '/home/testuser';

      expect(expandHome('/foo/~bar')).toBe('/foo/~bar');
      expect(expandHome('file~name')).toBe('file~name');

      if (originalHome) process.env.HOME = originalHome;
    });

    it('should handle tilde with no HOME set gracefully', () => {
      const originalHome = process.env.HOME;
      delete process.env.HOME;

      expect(expandHome('~/.ssh')).toBe(''); // Falls back to empty string

      if (originalHome) process.env.HOME = originalHome;
    });
  });

  describe('matchResourcePattern', () => {
    const originalHome = process.env.HOME;
    beforeAll(() => {
      process.env.HOME = '/home/testuser';
    });

    afterAll(() => {
      if (originalHome) process.env.HOME = originalHome;
    });

    it('should match simple glob patterns', () => {
      expect(matchResourcePattern('key.pem', '*.pem')).toBe(true);
      expect(matchResourcePattern('key.txt', '*.pem')).toBe(false);
      expect(matchResourcePattern('config.json', '*.{json,yml}')).toBe(true);
    });

    it('should match recursive glob patterns', () => {
      expect(matchResourcePattern('src/utils/helpers.js', '**/*.js')).toBe(true);
      expect(matchResourcePattern('src/index.ts', '**/*.js')).toBe(false);
    });

    it('should expand tilde in patterns and resources', () => {
      expect(matchResourcePattern('/home/testuser/.ssh/id_rsa', '~/.ssh/**')).toBe(true);
      expect(matchResourcePattern('/home/testuser/.ssh/config', '~/.ssh/*')).toBe(true);
      expect(matchResourcePattern('/etc/ssh/sshd_config', '~/.ssh/**')).toBe(false);
    });

    it('should match .env files with pattern', () => {
      expect(matchResourcePattern('/app/.env', '**/.env*')).toBe(true);
      expect(matchResourcePattern('/app/.env.local', '**/.env*')).toBe(true);
      expect(matchResourcePattern('/app/.env.production', '**/.env*')).toBe(true);
      expect(matchResourcePattern('/app/config.yaml', '**/.env*')).toBe(false);
    });

    it('should handle special glob characters', () => {
      // Character class: [ab] matches either a or b
      expect(matchResourcePattern('cat.txt', 'c[ab]t.txt')).toBe(true);
      expect(matchResourcePattern('cbt.txt', 'c[ab]t.txt')).toBe(true);
      expect(matchResourcePattern('cdt.txt', 'c[ab]t.txt')).toBe(false);
      // Question mark matches any single character
      expect(matchResourcePattern('test?.js', 'test?.js')).toBe(true);
      expect(matchResourcePattern('testA.js', 'test?.js')).toBe(true);
      expect(matchResourcePattern('testAB.js', 'test?.js')).toBe(false);
    });

    it('should return false for empty inputs', () => {
      expect(matchResourcePattern('', '*.pem')).toBe(false);
      expect(matchResourcePattern('key.pem', '')).toBe(false);
      expect(matchResourcePattern('', '')).toBe(false);
    });

    it('should support negation patterns', () => {
      expect(matchResourcePattern('test/unit/file.js', '!test/e2e/**')).toBe(true);
      expect(matchResourcePattern('test/e2e/file.js', '!test/e2e/**')).toBe(false);
    });

    it('should handle complex paths with spaces and special chars', () => {
      expect(matchResourcePattern('/path with spaces/file.txt', '**/*.txt')).toBe(true);
      expect(matchResourcePattern('/path(with)parens/file.js', '**/*.js')).toBe(true);
    });

    it('should match multiple extensions with brace expansion', () => {
      expect(matchResourcePattern('config.yaml', '*.{json,yml,yaml}')).toBe(true);
      expect(matchResourcePattern('config.json', '*.{json,yml,yaml}')).toBe(true);
      expect(matchResourcePattern('config.txt', '*.{json,yml,yaml}')).toBe(false);
    });
  });

  describe('isSensitiveResource', () => {
    const originalHome = process.env.HOME;
    beforeAll(() => {
      process.env.HOME = '/home/testuser';
    });

    afterAll(() => {
      if (originalHome) process.env.HOME = originalHome;
    });

    it('should detect SSH keys as sensitive', () => {
      const result = isSensitiveResource('/home/testuser/.ssh/id_rsa');
      expect(result.sensitive).toBe(true);
      expect(result.pattern).toBe('~/.ssh/**');
    });

    it('should detect AWS credentials as sensitive', () => {
      const result = isSensitiveResource('/home/testuser/.aws/credentials');
      expect(result.sensitive).toBe(true);
    });

    it('should detect .env files as sensitive', () => {
      expect(isSensitiveResource('/app/.env').sensitive).toBe(true);
      expect(isSensitiveResource('/app/.env.local').sensitive).toBe(true);
    });

    it('should detect password/secret files as sensitive', () => {
      expect(isSensitiveResource('/config/db_password.txt').sensitive).toBe(true);
      expect(isSensitiveResource('/secrets/api_keys.json').sensitive).toBe(true);
      expect(isSensitiveResource('/keys/private_key.pem').sensitive).toBe(true);
    });

    it('should return non-sensitive for regular files', () => {
      expect(isSensitiveResource('/app/public/index.html').sensitive).toBe(false);
      expect(isSensitiveResource('/src/utils/helpers.js').sensitive).toBe(false);
      expect(isSensitiveResource('/README.md').sensitive).toBe(false);
    });

    it('should handle empty or nullish resources gracefully', () => {
      expect(isSensitiveResource('').sensitive).toBe(false);
      // @ts-expect-error testing undefined
      expect(isSensitiveResource(undefined).sensitive).toBe(false);
    });
  });
});

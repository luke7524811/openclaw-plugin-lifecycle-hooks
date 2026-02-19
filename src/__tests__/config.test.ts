/**
 * src/__tests__/config.test.ts — Unit tests for HOOKS.yaml schema validation.
 *
 * These tests exercise the config loader and validator in isolation.
 * Integration tests (full pipeline) live in tests/config.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadHooksConfig, ConfigValidationError } from '../config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

describe('Config Validation', () => {
  let tempDir: string;
  let hooksFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'openclaw-hooks-test-'));
    hooksFile = path.join(tempDir, 'HOOKS.yaml');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Valid Configurations', () => {
    it('should load a minimal valid config', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: block
  - point: turn:post
    action: log
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.version).toBe('1');
      expect(config.hooks).toHaveLength(2);
    });

    it('should handle multiple hook points', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: [turn:pre, turn:post]
    action: log
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.hooks[0].point).toEqual(['turn:pre', 'turn:post']);
    });

    it('should accept numeric version', async () => {
      const validYaml = `
version: 1
hooks:
  - point: turn:pre
    action: block
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.version).toBe('1');
    });

    it('should accept optional defaults', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: log
defaults:
  model: claude-opus-4
  onFailure:
    action: retry
    retries: 2
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.defaults?.model).toBe('claude-opus-4');
      expect(config.defaults?.onFailure?.action).toBe('retry');
      expect(config.defaults?.onFailure?.retries).toBe(2);
    });

    it('should accept hook with match filter', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: log
    match:
      tool: exec
      commandPattern: "^rm"
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.hooks[0].match).toBeDefined();
      expect(config.hooks[0].match?.tool).toBe('exec');
      expect(config.hooks[0].match?.commandPattern).toBe('^rm');
    });

    it('should accept hook with isSubAgent filter', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: subagent:pre
    action: log
    match:
      isSubAgent: true
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.hooks[0].match?.isSubAgent).toBe(true);
    });

    it('should accept hook with sessionPattern filter', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: log
    match:
      sessionPattern: "telegram:group:-100[0-9]+"
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.hooks[0].match?.sessionPattern).toBe('telegram:group:-100[0-9]+');
    });

    it('should accept custom action path (treated as module path at runtime)', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: ./custom-actions/my-hook.js
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.hooks[0].action).toBe('./custom-actions/my-hook.js');
    });

    it('should accept hook with onFailure config', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: block
    onFailure:
      action: notify
      message: "Hook blocked"
      retries: 3
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.hooks[0].onFailure?.action).toBe('notify');
      expect(config.hooks[0].onFailure?.message).toBe('Hook blocked');
      expect(config.hooks[0].onFailure?.retries).toBe(3);
    });

    it('should accept disabled hooks', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: block
    enabled: false
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.hooks[0].enabled).toBe(false);
    });

    it('should accept hook with target (for exec_script)', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: exec_script
    target: /path/to/script.sh
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.hooks[0].action).toBe('exec_script');
      expect(config.hooks[0].target).toBe('/path/to/script.sh');
    });

    it('should accept hook with model override', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: log
    model: claude-sonnet-4
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.hooks[0].model).toBe('claude-sonnet-4');
    });

    it('should accept arbitrary non-empty action strings (custom modules)', async () => {
      const validYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: some-custom-action-name
`;
      await fs.writeFile(hooksFile, validYaml);
      const config = await loadHooksConfig(hooksFile);
      expect(config.hooks[0].action).toBe('some-custom-action-name');
    });
  });

  describe('Invalid Configurations', () => {
    it('should reject missing version', async () => {
      const invalidYaml = `
hooks:
  - point: turn:pre
    action: block
`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow('Missing required field: version');
    });

    it('should reject invalid hook point', async () => {
      const invalidYaml = `
version: "1"
hooks:
  - point: invalid:point
    action: block
`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow('not a valid hook point');
    });

    it('should reject empty action', async () => {
      const invalidYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: ""
`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow('must be a non-empty string');
    });

    it('should reject invalid onFailure.action', async () => {
      const invalidYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: block
    onFailure:
      action: invalid_action
`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow('must be one of');
    });

    it('should reject invalid defaults.onFailure.action', async () => {
      const invalidYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: block
defaults:
  onFailure:
    action: invalid_action
`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow('must be a valid FailureAction');
    });

    it('should reject missing action field', async () => {
      const invalidYaml = `
version: "1"
hooks:
  - point: turn:pre
`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow('is required');
    });

    it('should reject hooks that is not an array', async () => {
      const invalidYaml = `
version: "1"
hooks: {}
`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow('must be an array');
    });

    it('should reject top-level that is not an object', async () => {
      const invalidYaml = `not an object`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow('must be a YAML object');
    });

    it('should reject invalid YAML syntax', async () => {
      const invalidYaml = `
version: "1"
hooks:
  - point: turn:pre
    action: block
    invalid: field: with: colons
`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow('Failed to parse HOOKS.yaml');
    });
  });

  describe('Error Messages', () => {
    it('should include field name in validation error for invalid point', async () => {
      const invalidYaml = `
version: "1"
hooks:
  - point: bad:point
    action: block
`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow(/hooks\[0\]\.point/);
    });

    it('should include field name in validation error for missing action', async () => {
      const invalidYaml = `
version: "1"
hooks:
  - point: turn:pre
`;
      await fs.writeFile(hooksFile, invalidYaml);
      await expect(loadHooksConfig(hooksFile)).rejects.toThrow(/hooks\[0\]\.action/);
    });

    it('should throw ConfigValidationError (not generic Error) for schema errors', async () => {
      const invalidYaml = `
version: "1"
hooks:
  - point: bad:point
    action: block
`;
      await fs.writeFile(hooksFile, invalidYaml);
      try {
        await loadHooksConfig(hooksFile);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigValidationError);
      }
    });
  });
});

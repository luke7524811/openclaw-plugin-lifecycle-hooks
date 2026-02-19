/**
 * tests/config.test.ts — Config loader and schema validation tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { loadHooksConfig, ConfigValidationError } from '../src/config';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hooks-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeYaml(filename: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, filename);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('loadHooksConfig', () => {
  describe('valid config', () => {
    it('loads a minimal valid config', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: log
`);
      const config = await loadHooksConfig(filePath);
      expect(config.version).toBe('1');
      expect(config.hooks).toHaveLength(1);
      expect(config.hooks[0]!.point).toBe('turn:pre');
      expect(config.hooks[0]!.action).toBe('log');
    });

    it('loads a config with all optional fields', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
defaults:
  model: "haiku"
  onFailure:
    action: continue
    notifyUser: true
hooks:
  - point: turn:tool:pre
    match:
      tool: exec
      commandPattern: "^rm\\\\s"
    action: block
    onFailure:
      action: block
      notifyUser: true
      message: "Blocked!"
    enabled: true
`);
      const config = await loadHooksConfig(filePath);
      expect(config.version).toBe('1');
      expect(config.defaults?.model).toBe('haiku');
      expect(config.defaults?.onFailure?.action).toBe('continue');
      expect(config.hooks[0]!.match?.tool).toBe('exec');
      expect(config.hooks[0]!.match?.commandPattern).toBe('^rm\\s');
      expect(config.hooks[0]!.onFailure?.message).toBe('Blocked!');
    });

    it('loads a config with array of hook points', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point:
      - turn:tool:pre
      - subagent:tool:pre
    action: block
`);
      const config = await loadHooksConfig(filePath);
      const points = config.hooks[0]!.point;
      expect(Array.isArray(points)).toBe(true);
      expect(points).toContain('turn:tool:pre');
      expect(points).toContain('subagent:tool:pre');
    });

    it('loads a config with enabled: false', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: log
    enabled: false
`);
      const config = await loadHooksConfig(filePath);
      expect(config.hooks[0]!.enabled).toBe(false);
    });

    it('loads a config with no defaults section', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks: []
`);
      const config = await loadHooksConfig(filePath);
      expect(config.defaults).toBeUndefined();
    });

    it('accepts numeric version', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: 1
hooks: []
`);
      const config = await loadHooksConfig(filePath);
      expect(config.version).toBe('1');
    });

    it('loads multiple hooks', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: log
  - point: turn:post
    action: summarize_and_log
    model: "haiku"
    target: "logs/turns.log"
  - point: turn:tool:pre
    action: block
`);
      const config = await loadHooksConfig(filePath);
      expect(config.hooks).toHaveLength(3);
      expect(config.hooks[1]!.model).toBe('haiku');
      expect(config.hooks[1]!.target).toBe('logs/turns.log');
    });

    it('accepts source field as a string', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: inject_context
    source: /path/to/workspace/logs/topics/topic-{topicId}/context.jsonl
`);
      const config = await loadHooksConfig(filePath);
      expect(config.hooks[0]!.source).toBe('/path/to/workspace/logs/topics/topic-{topicId}/context.jsonl');
    });

    it('accepts lastN field as a positive integer', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: inject_context
    source: /some/path/context.jsonl
    lastN: 10
`);
      const config = await loadHooksConfig(filePath);
      expect(config.hooks[0]!.lastN).toBe(10);
    });

    it('accepts both source and target together', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: inject_context
    source: /path/to/source.jsonl
    target: /path/to/output.log
    lastN: 5
`);
      const config = await loadHooksConfig(filePath);
      expect(config.hooks[0]!.source).toBe('/path/to/source.jsonl');
      expect(config.hooks[0]!.target).toBe('/path/to/output.log');
      expect(config.hooks[0]!.lastN).toBe(5);
    });
  });

  describe('missing required fields', () => {
    it('throws ConfigValidationError when version is missing', async () => {
      const filePath = await writeYaml('hooks.yaml', `
hooks:
  - point: turn:pre
    action: log
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
      await expect(loadHooksConfig(filePath)).rejects.toThrow('version');
    });

    it('throws ConfigValidationError when hooks is missing', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
      await expect(loadHooksConfig(filePath)).rejects.toThrow('hooks');
    });

    it('throws ConfigValidationError when hook point is missing', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - action: log
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
      await expect(loadHooksConfig(filePath)).rejects.toThrow('point');
    });

    it('throws ConfigValidationError when hook action is missing', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
      await expect(loadHooksConfig(filePath)).rejects.toThrow('action');
    });
  });

  describe('invalid field values', () => {
    it('throws ConfigValidationError for invalid hook point string', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: not:a:valid:point
    action: log
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
      await expect(loadHooksConfig(filePath)).rejects.toThrow('not:a:valid:point');
    });

    it('throws ConfigValidationError for invalid onFailure.action', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: log
    onFailure:
      action: explode
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
    });

    it('throws ConfigValidationError when hooks is not an array', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks: "not-an-array"
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
      await expect(loadHooksConfig(filePath)).rejects.toThrow('array');
    });

    it('throws ConfigValidationError when source is not a string', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: inject_context
    source: 42
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
      await expect(loadHooksConfig(filePath)).rejects.toThrow('source');
    });

    it('throws ConfigValidationError when lastN is not a positive integer', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: inject_context
    lastN: 0
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
      await expect(loadHooksConfig(filePath)).rejects.toThrow('lastN');
    });

    it('throws ConfigValidationError when lastN is a float', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: inject_context
    lastN: 2.5
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow(ConfigValidationError);
      await expect(loadHooksConfig(filePath)).rejects.toThrow('lastN');
    });
  });

  describe('file I/O errors', () => {
    it('throws when file does not exist', async () => {
      const nonexistent = path.join(tmpDir, 'does-not-exist.yaml');
      await expect(loadHooksConfig(nonexistent)).rejects.toThrow('does-not-exist.yaml');
    });

    it('throws on invalid YAML syntax', async () => {
      const filePath = await writeYaml('hooks.yaml', `
version: "1"
hooks:
  - point: turn:pre
    action: : invalid yaml :::
`);
      await expect(loadHooksConfig(filePath)).rejects.toThrow();
    });
  });
});

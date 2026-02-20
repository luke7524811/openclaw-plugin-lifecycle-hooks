/**
 * __tests__/exec-script-inline.test.ts
 * Tests for exec_script inline script support and error handling
 */

import { describe, test, expect } from 'vitest';
import { executeExecScript } from '../actions/exec-script';
import type { HookDefinition, HookContext } from '../types';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

describe('exec-script inline script support', () => {
  const baseContext: HookContext = {
    point: 'turn:pre',
    sessionKey: 'test:session',
    timestamp: Date.now(),
    prompt: 'test prompt',
  };

  const baseHook: HookDefinition = {
    point: 'turn:pre',
    action: 'exec_script',
  };

  describe('inline script execution', () => {
    test('executes inline script and returns stdout', async () => {
      const hook: HookDefinition = {
        ...baseHook,
        script: '#!/bin/bash\necho "Hello from inline script"',
      };

      const result = await executeExecScript(hook, baseContext, Date.now());

      expect(result.passed).toBe(true);
      expect(result.action).toBe('exec_script');
      expect(result.message).toContain('Hello from inline script');
    });

    test('inline script with injectOutput returns content in injectedContent', async () => {
      const hook: HookDefinition = {
        ...baseHook,
        script: '#!/bin/bash\necho "Injected context data"',
        injectOutput: true,
      };

      const result = await executeExecScript(hook, baseContext, Date.now());

      expect(result.passed).toBe(true);
      expect(result.injectedContent).toBe('Injected context data');
    });

    test('inline script that exits non-zero returns passed: false', async () => {
      const hook: HookDefinition = {
        ...baseHook,
        script: '#!/bin/bash\necho "Error message" >&2\nexit 1',
      };

      const result = await executeExecScript(hook, baseContext, Date.now());

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Script failed');
      expect(result.message).toContain('exit 1');
    });

    test('inline script receives HOOK_* environment variables', async () => {
      const context: HookContext = {
        ...baseContext,
        point: 'turn:tool:pre',
        toolName: 'exec',
        toolArgs: { command: 'ls -la' },
        topicId: 42,
      };

      const hook: HookDefinition = {
        ...baseHook,
        script: `#!/bin/bash
echo "HOOK_POINT=$HOOK_POINT"
echo "HOOK_TOOL=$HOOK_TOOL"
echo "HOOK_TOPIC=$HOOK_TOPIC"
echo "HOOK_SESSION=$HOOK_SESSION"`,
      };

      const result = await executeExecScript(hook, context, Date.now());

      expect(result.passed).toBe(true);
      expect(result.message).toContain('HOOK_POINT=turn:tool:pre');
      expect(result.message).toContain('HOOK_TOOL=exec');
      expect(result.message).toContain('HOOK_TOPIC=42');
      expect(result.message).toContain('HOOK_SESSION=test:session');
    });
  });

  describe('error handling', () => {
    test('no script AND no target returns passed: false with error', async () => {
      const hook: HookDefinition = {
        ...baseHook,
        // No target, no script
      };

      const result = await executeExecScript(hook, baseContext, Date.now());

      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires either "target"');
      expect(result.message).toContain('or "script"');
    });

    test('both script and target present: target takes precedence', async () => {
      // Create a temporary file for the target
      const tmpDir = os.tmpdir();
      const testScriptPath = path.join(tmpDir, `test-precedence-${Date.now()}.sh`);
      await fs.writeFile(testScriptPath, '#!/bin/bash\necho "From target file"', { mode: 0o755 });

      try {
        const hook: HookDefinition = {
          ...baseHook,
          target: testScriptPath,
          script: '#!/bin/bash\necho "From inline script"',
        };

        const result = await executeExecScript(hook, baseContext, Date.now());

        expect(result.passed).toBe(true);
        expect(result.message).toContain('From target file');
        expect(result.message).not.toContain('From inline script');
      } finally {
        // Clean up test file
        await fs.unlink(testScriptPath).catch(() => {});
      }
    });
  });

  describe('temp file cleanup', () => {
    test('inline script temp file is cleaned up after successful execution', async () => {
      const hook: HookDefinition = {
        ...baseHook,
        script: '#!/bin/bash\necho "test"',
      };

      // Track temp files before
      const tmpDir = os.tmpdir();
      const beforeFiles = await fs.readdir(tmpDir);
      const beforeHookFiles = beforeFiles.filter(f => f.startsWith('hook-exec-'));

      await executeExecScript(hook, baseContext, Date.now());

      // Give cleanup time to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const afterFiles = await fs.readdir(tmpDir);
      const afterHookFiles = afterFiles.filter(f => f.startsWith('hook-exec-'));

      // Should have the same number of hook temp files (or fewer if others cleaned up)
      expect(afterHookFiles.length).toBeLessThanOrEqual(beforeHookFiles.length);
    });

    test('inline script temp file is cleaned up after failed execution', async () => {
      const hook: HookDefinition = {
        ...baseHook,
        script: '#!/bin/bash\nexit 1',
      };

      // Track temp files before
      const tmpDir = os.tmpdir();
      const beforeFiles = await fs.readdir(tmpDir);
      const beforeHookFiles = beforeFiles.filter(f => f.startsWith('hook-exec-'));

      await executeExecScript(hook, baseContext, Date.now());

      // Give cleanup time to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const afterFiles = await fs.readdir(tmpDir);
      const afterHookFiles = afterFiles.filter(f => f.startsWith('hook-exec-'));

      // Should have the same number of hook temp files (or fewer)
      expect(afterHookFiles.length).toBeLessThanOrEqual(beforeHookFiles.length);
    });
  });

  describe('multiline inline scripts', () => {
    test('executes multiline bash script correctly', async () => {
      const hook: HookDefinition = {
        ...baseHook,
        script: `#!/bin/bash
set -e
VAR1="Hello"
VAR2="World"
echo "$VAR1 $VAR2"
echo "Line 2"`,
      };

      const result = await executeExecScript(hook, baseContext, Date.now());

      expect(result.passed).toBe(true);
      expect(result.message).toContain('Hello World');
      expect(result.message).toContain('Line 2');
    });

    test('script with loops and conditionals', async () => {
      const hook: HookDefinition = {
        ...baseHook,
        script: `#!/bin/bash
for i in 1 2 3; do
  echo "Count: $i"
done
if [ "$HOOK_POINT" = "turn:pre" ]; then
  echo "Correct hook point"
fi`,
      };

      const result = await executeExecScript(hook, baseContext, Date.now());

      expect(result.passed).toBe(true);
      expect(result.message).toContain('Count: 1');
      expect(result.message).toContain('Count: 2');
      expect(result.message).toContain('Count: 3');
      expect(result.message).toContain('Correct hook point');
    });
  });
});

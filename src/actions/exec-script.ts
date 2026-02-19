/**
 * actions/exec-script.ts — Execute a shell script as a hook action.
 *
 * Runs a user-defined script, passing hook context via environment variables.
 * Exit code 0 = pass; non-zero = fail (onFailure applies).
 */

import { execFile } from 'child_process';
import * as path from 'path';
import type { HookContext, HookResult, HookDefinition } from '../types';
import { interpolateVariables } from '../utils/interpolate';

// ─── Security Allowlist / Denylist ────────────────────────────────────────────

/**
 * Paths that are explicitly blocked for security reasons.
 * Prevents hooks from being used as rm/system override vectors.
 */
const DENIED_SCRIPT_PREFIXES = [
  '/etc/',
  '/usr/bin/rm',
  '/bin/rm',
  '/usr/sbin/',
  '/sbin/',
];

function isDeniedScript(scriptPath: string): string | null {
  // Normalize to resolve symlinks, .., and other traversal tricks
  const resolved = path.resolve(path.normalize(scriptPath));
  for (const denied of DENIED_SCRIPT_PREFIXES) {
    if (resolved.startsWith(denied) || resolved === denied.replace(/\/$/, '')) {
      return `Script path "${resolved}" is blocked for security reasons (matches deny pattern: ${denied})`;
    }
  }
  return null;
}

// ─── Context → Env Vars ───────────────────────────────────────────────────────

function buildEnvVars(context: HookContext): NodeJS.ProcessEnv {
  let hookArgs = '{}';
  try {
    hookArgs = JSON.stringify(context.toolArgs ?? {});
  } catch {
    // toolArgs may contain non-serializable values (e.g. circular refs, BigInt)
    hookArgs = '{}';
  }

  return {
    ...process.env,
    HOOK_POINT: context.point,
    HOOK_SESSION: context.sessionKey,
    HOOK_TOOL: context.toolName ?? '',
    HOOK_ARGS: hookArgs,
    HOOK_TOPIC: context.topicId !== undefined ? String(context.topicId) : '',
    HOOK_TIMESTAMP: String(context.timestamp),
    HOOK_SUBAGENT: context.sessionKey.includes(':subagent:') ? 'true' : 'false',
    HOOK_SUBAGENT_LABEL: context.subagentLabel ?? '',
    HOOK_CRON_JOB: context.cronJob ?? '',
    HOOK_PROMPT: context.prompt ?? '',
  };
}

// ─── Executor ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Execute a shell script as a hook action.
 * The script path is read from `hook.target`.
 * Context is passed as environment variables (HOOK_POINT, HOOK_TOOL, etc.).
 *
 * Exit code 0 → passed=true
 * Exit code ≠ 0 → passed=false, stderr included in message
 */
export async function executeExecScript(
  hook: HookDefinition,
  context: HookContext,
  startTime: number
): Promise<HookResult> {
  if (!hook.target) {
    console.warn(`[lifecycle-hooks/exec-script] No script target specified. Hook point: ${context.point}`);
    return {
      passed: true,
      action: 'exec_script',
      message: 'No script target configured; exec_script skipped.',
      duration: Date.now() - startTime,
    };
  }

  // Interpolate variables in the script path
  const scriptPath = interpolateVariables(hook.target, context);

  // Security check
  const denied = isDeniedScript(scriptPath);
  if (denied) {
    console.error(`[lifecycle-hooks/exec-script] BLOCKED: ${denied}`);
    return {
      passed: false,
      action: 'exec_script',
      message: denied,
      duration: Date.now() - startTime,
    };
  }

  const env = buildEnvVars(context);
  const timeoutMs = DEFAULT_TIMEOUT_MS;

  console.log(
    `[lifecycle-hooks/exec-script] Executing script "${scriptPath}" at ${context.point}` +
    (context.toolName ? ` (tool: ${context.toolName})` : '')
  );

  return new Promise<HookResult>((resolve) => {
    const child = execFile(
      scriptPath,
      [],
      {
        env,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB output buffer
      },
      (error, stdout, stderr) => {
        const duration = Date.now() - startTime;

        if (stdout) {
          console.log(`[lifecycle-hooks/exec-script] stdout: ${stdout.slice(0, 500)}`);
        }
        if (stderr) {
          console.warn(`[lifecycle-hooks/exec-script] stderr: ${stderr.slice(0, 500)}`);
        }

        if (!error) {
          const result: HookResult = {
            passed: true,
            action: 'exec_script',
            message: stdout.trim() || `Script "${scriptPath}" completed successfully`,
            duration,
          };

          // If injectOutput is true, capture stdout for injection into agent context
          if (hook.injectOutput && stdout.trim()) {
            result.injectedContent = stdout.trim();
          }

          resolve(result);
          return;
        }

        // Handle timeout
        if (error.killed || (error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
          const msg = `Script "${scriptPath}" timed out after ${timeoutMs}ms`;
          console.error(`[lifecycle-hooks/exec-script] TIMEOUT: ${msg}`);
          resolve({
            passed: false,
            action: 'exec_script',
            message: msg,
            duration,
          });
          return;
        }

        // Handle script not found or permission denied
        const errCode = (error as NodeJS.ErrnoException).code;
        if (errCode === 'ENOENT') {
          const msg = `Script not found: "${scriptPath}"`;
          console.error(`[lifecycle-hooks/exec-script] ${msg}`);
          resolve({
            passed: false,
            action: 'exec_script',
            message: msg,
            duration,
          });
          return;
        }

        if (errCode === 'EACCES') {
          const msg = `Script not executable: "${scriptPath}" (permission denied)`;
          console.error(`[lifecycle-hooks/exec-script] ${msg}`);
          resolve({
            passed: false,
            action: 'exec_script',
            message: msg,
            duration,
          });
          return;
        }

        // Non-zero exit code
        const exitMsg = stderr.trim() || stdout.trim() || error.message;
        console.warn(
          `[lifecycle-hooks/exec-script] Script "${scriptPath}" exited with code ${error.code ?? 'unknown'}: ${exitMsg.slice(0, 200)}`
        );
        resolve({
          passed: false,
          action: 'exec_script',
          message: `Script failed (exit ${error.code ?? 'unknown'}): ${exitMsg.slice(0, 500)}`,
          duration,
        });
      }
    );

    // Suppress EPIPE errors on stdin (we don't use it)
    child.stdin?.on('error', () => {});
  });
}

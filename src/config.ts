/**
 * config.ts — HOOKS.yaml loader and schema validation.
 */

import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import type { HooksConfig, HookDefinition, OnFailure } from './types';

// ─── Validation ───────────────────────────────────────────────────────────────

export class ConfigValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

const VALID_HOOK_POINTS = new Set([
  'turn:pre',
  'turn:post',
  'turn:tool:pre',
  'turn:tool:post',
  'subagent:spawn:pre',
  'subagent:pre',
  'subagent:post',
  'subagent:tool:pre',
  'subagent:tool:post',
  'heartbeat:pre',
  'heartbeat:post',
  'cron:pre',
  'cron:post',
]);

const VALID_FAILURE_ACTIONS = new Set(['block', 'retry', 'notify', 'continue']);

function validateHookDefinition(hook: unknown, index: number): HookDefinition {
  if (typeof hook !== 'object' || hook === null) {
    throw new ConfigValidationError(`hooks[${index}] must be an object`);
  }

  const h = hook as Record<string, unknown>;

  // Validate 'point'
  if (!('point' in h)) {
    throw new ConfigValidationError(`hooks[${index}].point is required`, `hooks[${index}].point`);
  }

  const points = Array.isArray(h.point) ? h.point : [h.point];
  for (const p of points) {
    if (!VALID_HOOK_POINTS.has(p as string)) {
      throw new ConfigValidationError(
        `hooks[${index}].point "${p}" is not a valid hook point. Valid points: ${[...VALID_HOOK_POINTS].join(', ')}`,
        `hooks[${index}].point`
      );
    }
  }

  // Validate 'action'
  if (!('action' in h)) {
    throw new ConfigValidationError(`hooks[${index}].action is required`, `hooks[${index}].action`);
  }
  if (typeof h.action !== 'string' || h.action.trim() === '') {
    throw new ConfigValidationError(
      `hooks[${index}].action must be a non-empty string`,
      `hooks[${index}].action`
    );
  }

  // Validate optional 'match' filter
  if ('match' in h && h.match !== undefined) {
    const m = h.match;
    if (typeof m !== 'object' || m === null || Array.isArray(m)) {
      throw new ConfigValidationError(`hooks[${index}].match must be an object`, `hooks[${index}].match`);
    }
    const mObj = m as Record<string, unknown>;
    // Validate match.tool
    if ('tool' in mObj && typeof mObj['tool'] !== 'string') {
      throw new ConfigValidationError(`hooks[${index}].match.tool must be a string`, `hooks[${index}].match.tool`);
    }
    // Validate match.commandPattern
    if ('commandPattern' in mObj && typeof mObj['commandPattern'] !== 'string') {
      throw new ConfigValidationError(`hooks[${index}].match.commandPattern must be a string`, `hooks[${index}].match.commandPattern`);
    }
    // Validate match.topicId
    if ('topicId' in mObj) {
      const tid = mObj['topicId'];
      if (typeof tid !== 'string' && typeof tid !== 'number') {
        throw new ConfigValidationError(`hooks[${index}].match.topicId must be a string or number`, `hooks[${index}].match.topicId`);
      }
    }
    // Validate match.isSubAgent
    if ('isSubAgent' in mObj && typeof mObj['isSubAgent'] !== 'boolean') {
      throw new ConfigValidationError(`hooks[${index}].match.isSubAgent must be a boolean`, `hooks[${index}].match.isSubAgent`);
    }
    // Validate match.sessionPattern
    if ('sessionPattern' in mObj && typeof mObj['sessionPattern'] !== 'string') {
      throw new ConfigValidationError(`hooks[${index}].match.sessionPattern must be a string`, `hooks[${index}].match.sessionPattern`);
    }
    // Validate match.custom
    if ('custom' in mObj && typeof mObj['custom'] !== 'string') {
      throw new ConfigValidationError(`hooks[${index}].match.custom must be a string (module path)`, `hooks[${index}].match.custom`);
    }
  }

  // Validate optional 'source'
  if ('source' in h && h.source !== undefined) {
    if (typeof h.source !== 'string') {
      throw new ConfigValidationError(
        `hooks[${index}].source must be a string`,
        `hooks[${index}].source`
      );
    }
  }

  // Validate optional 'script' (inline script content)
  if ('script' in h && h.script !== undefined) {
    if (typeof h.script !== 'string') {
      throw new ConfigValidationError(
        `hooks[${index}].script must be a string`,
        `hooks[${index}].script`
      );
    }
  }

  // Validate optional 'lastN'
  if ('lastN' in h && h.lastN !== undefined) {
    const lastN = h.lastN;
    if (typeof lastN !== 'number' || !Number.isInteger(lastN) || lastN < 1) {
      throw new ConfigValidationError(
        `hooks[${index}].lastN must be a positive integer`,
        `hooks[${index}].lastN`
      );
    }
  }

  // Validate optional 'injectOutput'
  if ('injectOutput' in h && h.injectOutput !== undefined) {
    if (typeof h.injectOutput !== 'boolean') {
      throw new ConfigValidationError(
        `hooks[${index}].injectOutput must be a boolean`,
        `hooks[${index}].injectOutput`
      );
    }
  }

  // Validate optional 'notifyUser'
  if ('notifyUser' in h && h.notifyUser !== undefined) {
    if (typeof h.notifyUser !== 'boolean') {
      throw new ConfigValidationError(
        `hooks[${index}].notifyUser must be a boolean`,
        `hooks[${index}].notifyUser`
      );
    }
  }

  // Validate optional 'onFailure'
  if ('onFailure' in h && h.onFailure !== undefined) {
    const of_ = h.onFailure as Record<string, unknown>;
    if (typeof of_ !== 'object' || of_ === null) {
      throw new ConfigValidationError(`hooks[${index}].onFailure must be an object`, `hooks[${index}].onFailure`);
    }
    if (!('action' in of_) || typeof of_.action !== 'string' || !VALID_FAILURE_ACTIONS.has(of_.action)) {
      throw new ConfigValidationError(
        `hooks[${index}].onFailure.action must be one of: ${[...VALID_FAILURE_ACTIONS].join(', ')}`,
        `hooks[${index}].onFailure.action`
      );
    }
    // Validate retries if present
    if ('retries' in of_ && of_['retries'] !== undefined) {
      const retries = of_['retries'];
      if (typeof retries !== 'number' || !Number.isInteger(retries) || retries < 1) {
        throw new ConfigValidationError(
          `hooks[${index}].onFailure.retries must be a positive integer`,
          `hooks[${index}].onFailure.retries`
        );
      }
    }
  }

  return h as unknown as HookDefinition;
}

function validateConfig(raw: unknown): HooksConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigValidationError('HOOKS.yaml must be a YAML object at the top level');
  }

  const doc = raw as Record<string, unknown>;

  // Validate 'version'
  if (!('version' in doc)) {
    throw new ConfigValidationError('Missing required field: version', 'version');
  }
  if (typeof doc.version !== 'string' && typeof doc.version !== 'number') {
    throw new ConfigValidationError('version must be a string or number', 'version');
  }

  // Validate 'hooks'
  if (!('hooks' in doc)) {
    throw new ConfigValidationError('Missing required field: hooks', 'hooks');
  }
  if (!Array.isArray(doc.hooks)) {
    throw new ConfigValidationError('hooks must be an array', 'hooks');
  }

  const hooks: HookDefinition[] = doc.hooks.map((h, i) => validateHookDefinition(h, i));

  // Build validated config
  const config: HooksConfig = {
    version: String(doc.version),
    hooks,
  };

  // Optional 'defaults'
  if ('defaults' in doc && doc.defaults !== undefined) {
    const defaults = doc.defaults as Record<string, unknown>;
    config.defaults = {};
    if ('model' in defaults && typeof defaults.model === 'string') {
      config.defaults.model = defaults.model;
    }
    if ('notificationTarget' in defaults && typeof defaults.notificationTarget === 'string') {
      config.defaults.notificationTarget = defaults.notificationTarget;
    }
    if ('onFailure' in defaults && defaults.onFailure !== undefined) {
      // Re-use validation logic inline
      const of_ = defaults.onFailure as Record<string, unknown>;
      if (typeof of_ !== 'object' || of_ === null) {
        throw new ConfigValidationError('defaults.onFailure must be an object');
      }
      if (!('action' in of_) || typeof of_.action !== 'string' || !VALID_FAILURE_ACTIONS.has(of_.action)) {
        throw new ConfigValidationError('defaults.onFailure.action must be a valid FailureAction');
      }
      config.defaults.onFailure = of_ as unknown as OnFailure;
    }
  }

  return config;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load and validate a HOOKS.yaml file from disk.
 * Throws ConfigValidationError if validation fails.
 * Throws native fs errors if the file cannot be read.
 * 
 * @param filePath - Path to the HOOKS.yaml file
 * @param sourcePath - Optional source path to stamp on each hook's _source field
 */
export async function loadHooksConfig(
  filePath: string,
  sourcePath?: string
): Promise<HooksConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read HOOKS.yaml at "${filePath}": ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse HOOKS.yaml: ${message}`);
  }

  const config = validateConfig(parsed);

  // Stamp _source on each hook if sourcePath provided
  if (sourcePath) {
    const absoluteSource = require('path').resolve(sourcePath);
    for (const hook of config.hooks) {
      hook._source = absoluteSource;
    }
  }

  return config;
}

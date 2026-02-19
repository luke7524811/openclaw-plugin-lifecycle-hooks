/**
 * llm.ts — Lightweight LLM client for the lifecycle hooks plugin.
 *
 * Reads provider config from openclaw.json at models.providers.
 * Supports a model alias system for short model names.
 * Uses Node's built-in fetch() — no external HTTP deps.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Model Alias Map ──────────────────────────────────────────────────────────

const MODEL_ALIASES: Record<string, { provider: string; model: string }> = {
  'glm-flash':   { provider: 'zai', model: 'GLM-4.7-Flash' },
  'glm-45-flash': { provider: 'zai', model: 'GLM-4.5-Flash' },
  'glm-5':       { provider: 'zai', model: 'GLM-5' },
  'gemini-flash': { provider: 'google-gemini-cli', model: 'gemini-2.5-flash' },
  'gemini-pro':  { provider: 'google-gemini-cli', model: 'gemini-2.5-pro' },
  'free':        { provider: 'openrouter', model: 'openrouter/free' },
  'llama-free':  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
};

const DEFAULT_PROVIDER = 'zai';
const DEFAULT_MODEL    = 'GLM-4.5-Flash';

// ─── Provider Config ──────────────────────────────────────────────────────────

interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  authHeader?: boolean;
}

interface ProvidersMap {
  [providerName: string]: ProviderConfig;
}

// Cached after first read
let _providersCache: ProvidersMap | null = null;

function loadProviders(): ProvidersMap {
  if (_providersCache) return _providersCache;

  try {
    const configPath = path.join('/root/.openclaw', 'openclaw.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const models = parsed['models'] as Record<string, unknown> | undefined;
    const providers = models?.['providers'] as ProvidersMap | undefined;

    if (!providers || typeof providers !== 'object') {
      console.warn('[lifecycle-hooks/llm] No models.providers found in openclaw.json — using empty map');
      _providersCache = {};
    } else {
      _providersCache = providers;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[lifecycle-hooks/llm] Failed to read openclaw.json: ${message}`);
    _providersCache = {};
  }

  return _providersCache;
}

// ─── Model Resolution ─────────────────────────────────────────────────────────

interface ResolvedModel {
  provider: string;
  model: string;
}

function resolveModel(modelAlias: string): ResolvedModel {
  // Direct alias match
  if (MODEL_ALIASES[modelAlias]) {
    return MODEL_ALIASES[modelAlias];
  }

  // provider/model syntax
  if (modelAlias.includes('/')) {
    const slashIdx = modelAlias.indexOf('/');
    return {
      provider: modelAlias.slice(0, slashIdx),
      model: modelAlias.slice(slashIdx + 1),
    };
  }

  // No match — use default
  console.warn(`[lifecycle-hooks/llm] Unknown model alias "${modelAlias}" — defaulting to ${DEFAULT_PROVIDER}/${DEFAULT_MODEL}`);
  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
}

// ─── LLM Completion ───────────────────────────────────────────────────────────

/**
 * Call an OpenAI-compatible chat completion API.
 *
 * @param model       Short alias ("glm-45-flash"), "provider/model", or empty for default.
 * @param systemPrompt System message content.
 * @param userMessage  User message content.
 * @returns            The assistant's response text.
 */
export async function llmComplete(
  model: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const { provider, model: modelId } = resolveModel(model || `${DEFAULT_PROVIDER}/${DEFAULT_MODEL}`);

  const providers = loadProviders();
  const providerCfg = providers[provider];

  if (!providerCfg) {
    console.error(`[lifecycle-hooks/llm] Unknown provider "${provider}" — no config in openclaw.json`);
    return `[LLM unavailable: unknown provider "${provider}"]`;
  }

  if (!providerCfg.baseUrl) {
    console.error(`[lifecycle-hooks/llm] Provider "${provider}" has no baseUrl`);
    return `[LLM unavailable: provider "${provider}" has no baseUrl]`;
  }

  const url = providerCfg.baseUrl.replace(/\/$/, '') + '/chat/completions';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (providerCfg.authHeader && providerCfg.apiKey) {
    headers['Authorization'] = `Bearer ${providerCfg.apiKey}`;
  }

  const body = JSON.stringify({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
    max_tokens: 1024,
    temperature: 0.3,
  });

  try {
    const resp = await fetch(url, { method: 'POST', headers, body });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '(no body)');
      console.error(`[lifecycle-hooks/llm] HTTP ${resp.status} from ${provider}: ${errText.slice(0, 200)}`);
      return `[LLM error: HTTP ${resp.status} from ${provider}]`;
    }

    const json = await resp.json() as Record<string, unknown>;
    const choices = json['choices'] as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.['message'] as Record<string, unknown> | undefined;
    const content = message?.['content'];
    const reasoningContent = message?.['reasoning_content'];

    // Some models (e.g. GLM) return reasoning_content alongside content.
    // If content is empty but reasoning exists, the model used all tokens on reasoning.
    const text = typeof content === 'string' && content.trim()
      ? content.trim()
      : typeof reasoningContent === 'string' && reasoningContent.trim()
        ? reasoningContent.trim().slice(0, 500)
        : null;

    if (!text) {
      console.error(`[lifecycle-hooks/llm] Unexpected response shape from ${provider}: ${JSON.stringify(json).slice(0, 300)}`);
      return '[LLM error: unexpected response shape]';
    }

    return text;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[lifecycle-hooks/llm] Fetch error calling ${provider}: ${message}`);
    return `[LLM fetch error: ${message}]`;
  }
}

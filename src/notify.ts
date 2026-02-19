/**
 * notify.ts — User notification support for lifecycle-hooks.
 *
 * Provides fire-and-forget Telegram notification via the OpenClaw plugin API.
 * Notification failures are caught and logged — they never affect the hook result.
 *
 * Also tracks the most recent main-agent session key so that sub-agent completions
 * can notify the right Telegram chat (sub-agent keys don't embed Telegram info).
 */

import * as fs from 'fs';

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_KEY_PERSIST_PATH = '/tmp/hooks-last-main-session.txt';

// ─── Runtime Reference ────────────────────────────────────────────────────────

/**
 * Stored reference to api.runtime, set during plugin registration.
 * Must be set before notifyUser() can send messages.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _runtime: any = null;

/**
 * Store the api.runtime reference for later use by notifyUser().
 * Called once during plugin register().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setRuntime(runtime: any): void {
  _runtime = runtime;
}

// ─── Session Key Tracker ──────────────────────────────────────────────────────

/**
 * The most recently seen main-agent (non-subagent) session key.
 *
 * Sub-agent session keys (agent:main:subagent:<uuid>) contain no Telegram
 * routing info. When a sub-agent ends and we need to notify the user, we
 * use this cached key to find the Telegram target.
 *
 * Updated by recordMainSessionKey() whenever a main-agent hook fires.
 */
let _lastMainSessionKey: string | null = null;

/**
 * Record a session key as the most recent main-agent session key.
 * Only stores non-subagent session keys (ones containing "telegram:" etc).
 * Called from index.ts in before_agent_start and agent_end handlers.
 * 
 * Persists to disk so the key survives gateway restarts.
 */
export function recordMainSessionKey(sessionKey: string): void {
  // Only track keys that contain Telegram routing info
  if (!sessionKey.includes(':subagent:') && sessionKey.includes('telegram:')) {
    _lastMainSessionKey = sessionKey;
    
    // Persist to disk (synchronous, fire-and-forget)
    try {
      fs.writeFileSync(SESSION_KEY_PERSIST_PATH, sessionKey, 'utf-8');
    } catch (err) {
      // Silent failure — don't break the hook pipeline over persistence issues
    }
  }
}

/**
 * Get the most recently seen main-agent session key.
 * Returns null if no main-agent session has been seen yet.
 * 
 * If in-memory value is null (e.g., after gateway restart), tries to read from disk.
 */
export function getLastMainSessionKey(): string | null {
  // If we have it in memory, return it
  if (_lastMainSessionKey !== null) {
    return _lastMainSessionKey;
  }
  
  // Try reading from disk (synchronous)
  try {
    const persisted = fs.readFileSync(SESSION_KEY_PERSIST_PATH, 'utf-8').trim();
    if (persisted) {
      _lastMainSessionKey = persisted;
      return persisted;
    }
  } catch (err) {
    // File doesn't exist or can't be read — silent failure
  }
  
  return null;
}

// ─── Telegram Target Parsing ──────────────────────────────────────────────────

interface TelegramTarget {
  chatId: string;
  threadId?: number;
}

/**
 * Parse a Telegram chat target from an OpenClaw session key.
 *
 * Supported formats:
 *   - telegram:group:-100EXAMPLE456789:topic:42  → { chatId: "-100EXAMPLE456789", threadId: 42 }
 *   - telegram:group:-100EXAMPLE456789           → { chatId: "-100EXAMPLE456789" }
 *   - telegram:987654321                     → { chatId: "987654321" }
 */
function parseTelegramTarget(sessionKey: string): TelegramTarget | null {
  // Forum topic in a group (chat ID may be numeric or alphanumeric)
  const topicMatch = /telegram:group:([-\w]+):topic:(\d+)/.exec(sessionKey);
  if (topicMatch) {
    return { chatId: topicMatch[1]!, threadId: parseInt(topicMatch[2]!, 10) };
  }

  // Group without topic (chat ID may be numeric or alphanumeric)
  const groupMatch = /telegram:group:([-\w]+)/.exec(sessionKey);
  if (groupMatch) {
    return { chatId: groupMatch[1]! };
  }

  // Direct message (numeric only)
  const dmMatch = /telegram:(\d+)$/.exec(sessionKey);
  if (dmMatch) {
    return { chatId: dmMatch[1]! };
  }

  return null;
}

// ─── notifyUser ───────────────────────────────────────────────────────────────

/**
 * Send a Telegram notification to the user associated with the given session key.
 *
 * This function is **fire-and-forget**: it does not block the caller and any
 * failure is caught and logged without propagating.
 *
 * @param sessionKey  The active session key (used to determine the Telegram target).
 * @param message     The notification message text.
 */
export function notifyUser(sessionKey: string, message: string): void {
  // Fire-and-forget: kick off async work without awaiting
  void _sendNotification(sessionKey, message);
}

async function _sendNotification(sessionKey: string, message: string): Promise<void> {
  try {
    if (!_runtime) {
      console.warn('[lifecycle-hooks/notify] Runtime not set — cannot send notification.');
      return;
    }

    const target = parseTelegramTarget(sessionKey);
    if (!target) {
      console.warn(
        `[lifecycle-hooks/notify] Could not parse Telegram target from session key: "${sessionKey}"`
      );
      return;
    }

    const { chatId, threadId } = target;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const telegram: any = _runtime?.channel?.telegram;
    if (!telegram?.sendMessageTelegram) {
      console.warn('[lifecycle-hooks/notify] api.runtime.channel.telegram.sendMessageTelegram not available.');
      return;
    }

    const opts: Record<string, unknown> = {};
    if (threadId !== undefined) {
      opts['messageThreadId'] = threadId;
    }

    await telegram.sendMessageTelegram(chatId, message, opts);

    console.log(
      `[lifecycle-hooks/notify] Notification sent to chatId=${chatId}` +
      (threadId !== undefined ? ` threadId=${threadId}` : '') +
      `: ${message.slice(0, 80)}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[lifecycle-hooks/notify] Failed to send notification: ${msg}`);
  }
}

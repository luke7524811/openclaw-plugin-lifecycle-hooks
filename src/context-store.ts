/**
 * context-store.ts — In-memory origin context storage.
 *
 * Stores origin context keyed by sessionKey for injection into subagent spawns.
 * Populated by turn:pre hooks, consumed by tool:pre hooks when tool is sessions_spawn.
 */

/** Origin context metadata for a session. */
export interface OriginContext {
  /** Topic ID extracted from session key (e.g. topic:42 → 124). */
  topicId?: number | string;
  /** Chat ID extracted from session key (e.g. group:-100EXAMPLE456789). */
  chatId?: string;
  /** Sender/user name if available from hook context. */
  sender?: string;
  /** Parent session key (the session that will spawn sub-agents). */
  parentSessionKey: string;
}

/** In-memory store: sessionKey → OriginContext */
const store = new Map<string, OriginContext>();

/**
 * Store origin context for a session.
 * Called by hooks at turn:pre to capture the current session's context.
 */
export function setOriginContext(sessionKey: string, context: OriginContext): void {
  store.set(sessionKey, context);
}

/**
 * Retrieve origin context for a session.
 * Called by inject-origin action to build the origin tag.
 */
export function getOriginContext(sessionKey: string): OriginContext | undefined {
  return store.get(sessionKey);
}

/**
 * Clear origin context for a session.
 * Called on session end to prevent memory leaks.
 */
export function clearOriginContext(sessionKey: string): void {
  store.delete(sessionKey);
}

/**
 * Clear all stored contexts (for testing).
 */
export function clearAllOriginContexts(): void {
  store.clear();
}

/**
 * Get the current size of the store (for debugging/testing).
 */
export function getOriginContextStoreSize(): number {
  return store.size;
}

/**
 * Extract topic ID from a session key.
 * E.g. "agent:main:telegram:group:-100EXAMPLE456789:topic:42" → 124
 */
export function extractTopicId(sessionKey: string): number | undefined {
  const match = /:topic:(\d+)/.exec(sessionKey);
  return match ? parseInt(match[1]!, 10) : undefined;
}

/**
 * Extract chat ID from a session key.
 * E.g. "agent:main:telegram:group:-100EXAMPLE456789:topic:42" → "group:-100EXAMPLE456789"
 * E.g. "agent:main:telegram:private:12345" → "private:12345"
 */
export function extractChatId(sessionKey: string): string | undefined {
  // Match patterns like "telegram:group:-100xxx" or "telegram:private:123"
  const match = /telegram:((?:group|private|channel):[^:]+)/.exec(sessionKey);
  return match ? match[1] : undefined;
}

/**
 * Extract sender/user identifier from a session key.
 * This is a best-effort heuristic — real sender info should come from hook context.
 * E.g. "agent:main:telegram:group:-100xxx:topic:42" → undefined (no user in key)
 * E.g. "agent:main:telegram:private:123456" → "123456"
 */
export function extractSenderFromKey(sessionKey: string): string | undefined {
  // For private chats, the chat ID is also the user ID
  const privateMatch = /telegram:private:(\d+)/.exec(sessionKey);
  if (privateMatch) return privateMatch[1];
  
  // For groups/topics, sender is not in the key
  return undefined;
}

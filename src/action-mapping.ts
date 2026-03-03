/**
 * action-mapping.ts — Semantic action type mapping for tool names.
 *
 * Provides a function to extract a semantic action category from a raw tool name.
 * Supports glob pattern matching (e.g., "fs.*" matches "fs.read" and "fs.write").
 */

/**
 * Mapping from tool names to semantic action categories.
 * Tools not listed will fall back to "unknown" or the tool name itself.
 */
export const TOOL_TO_ACTION: Record<string, string> = {
  // File system operations
  'read': 'fs.read',
  'write': 'fs.write',
  'edit': 'fs.write',
  'delete': 'fs.delete',
  'mkdir': 'fs.create',
  'rmdir': 'fs.delete',
  'list': 'fs.read',
  'stat': 'fs.read',

  // Shell/execution
  'exec': 'shell.exec',
  'spawn': 'shell.exec',
  'run': 'shell.exec',

  // HTTP/network
  'web_search': 'http.request',
  'web_fetch': 'http.request',
  'browser': 'browser.navigate',
  'http_get': 'http.request',
  'http_post': 'http.request',
  'download': 'http.request',

  // Document handling
  'pdf': 'document.read',
  'image': 'image.analyze',
  'audio': 'audio.process',
  'video': 'video.process',

  // Agent/subagent operations
  'sessions_spawn': 'agent.spawn',
  'sessions_send': 'agent.message',
  'sessions_list': 'agent.query',
  'subagent': 'agent.spawn',

  // Messaging
  'message': 'messaging.send',
  'notify': 'messaging.send',
  'broadcast': 'messaging.send',

  // System/scheduling
  'cron': 'system.schedule',
  'gateway': 'system.config',
  'system': 'system.config',
  'clock': 'system.time',

  // Browser automation
  'browser_click': 'browser.interact',
  'browser_type': 'browser.interact',
  'browser_navigate': 'browser.navigate',
  'browser_screenshot': 'browser.capture',

  // Database
  'db_query': 'database.query',
  'db_insert': 'database.write',
  'db_update': 'database.write',
  'db_delete': 'database.delete',
};

/**
 * Converts a glob pattern to a RegExp pattern.
 * Supports:
 *   - * (matches any sequence of characters)
 *   - ? (matches any single character)
 *   - [abc] (character classes)
 *   - [a-z] (character ranges)
 *
 * @param glob - Glob pattern (e.g., "fs.*", "shell.*")
 * @returns RegExp pattern string
 */
function globToRegex(glob: string): string {
  let regex = '';
  let i = 0;
  const len = glob.length;

  while (i < len) {
    const char = glob[i];
    if (char === '*') {
      regex += '.*';
      i++;
    } else if (char === '?') {
      regex += '.';
      i++;
    } else if (char === '[') {
      // Find closing bracket for character class
      let j = i + 1;
      let found = false;
      while (j < len) {
        if (glob[j] === ']') {
          found = true;
          break;
        }
        j++;
      }
      if (found) {
        // Include entire character class as-is (it's valid regex)
        regex += glob.slice(i, j + 1);
        i = j + 1;
      } else {
        // Unmatched [, treat as literal
        regex += '\\[';
        i++;
      }
    } else if (/[\\^$.|+(){}]/.test(char)) {
      regex += '\\' + char;
      i++;
    } else {
      regex += char;
      i++;
    }
  }

  return `^${regex}$`;
}

/**
 * Checks if a pattern contains glob wildcards.
 * @param pattern - Pattern to check
 * @returns true if pattern contains wildcards
 */
export function hasGlobWildcards(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[') || pattern.includes(']');
}

/**
 * Extracts the semantic action category from a tool name.
 *
 * @param toolName - The raw tool name (e.g., "read", "web_search")
 * @returns The semantic action (e.g., "fs.read", "http.request")
 */
export function extractSemanticAction(toolName: string): string {
  // Exact match in mapping
  if (TOOL_TO_ACTION[toolName] !== undefined) {
    return TOOL_TO_ACTION[toolName];
  }

  // Try glob pattern matching for unmapped tools
  // Split potential compound names (e.g., "browser_navigate" -> "browser", "navigate")
  // and check if any prefix matches a pattern like "browser.*"
  for (const [pattern, action] of Object.entries(TOOL_TO_ACTION)) {
    if (hasGlobWildcards(pattern)) {
      const regexPattern = globToRegex(pattern);
      try {
        const regex = new RegExp(regexPattern);
        if (regex.test(toolName)) {
          return action;
        }
      } catch {
        // Invalid regex pattern, skip
        continue;
      }
    }
  }

  // Fallback: return the tool name itself as the action
  return toolName;
}

/**
 * Matches a tool name against an action filter pattern.
 * Supports exact match and glob patterns (e.g., "fs.*" matches "fs.read").
 *
 * @param toolName - The raw tool name to test
 * @param actionFilter - The action filter pattern (e.g., "fs.*", "http.request")
 * @returns true if the tool matches the filter
 */
export function matchesAction(toolName: string, actionFilter: string): boolean {
  const semanticAction = extractSemanticAction(toolName);

  // Exact match
  if (semanticAction === actionFilter) {
    return true;
  }

  // Glob pattern match on filter (e.g., "fs.*" matches "fs.read")
  if (hasGlobWildcards(actionFilter)) {
    const regexPattern = globToRegex(actionFilter);
    try {
      const regex = new RegExp(regexPattern);
      return regex.test(semanticAction);
    } catch {
      // Invalid regex pattern, no match
      return false;
    }
  }

  return false;
}

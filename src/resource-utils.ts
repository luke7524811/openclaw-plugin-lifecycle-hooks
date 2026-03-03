/**
 * Resource path pattern matching utilities.
 */

import micromatch from 'micromatch';

/**
 * Expand tilde (~) in a path to the user's home directory.
 * If HOME is not set and path starts with ~, returns empty string.
 */
export function expandHome(path: string): string {
  if (!path) return path;
  if (path.startsWith('~')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (!home) return '';
    return home + path.slice(1);
  }
  return path;
}

/**
 * Match a resource string against a glob pattern.
 */
export function matchResourcePattern(resource: string, pattern: string): boolean {
  if (!resource || !pattern) return false;
  const expandedResource = expandHome(resource);
  const expandedPattern = expandHome(pattern);
  return micromatch.isMatch(expandedResource, expandedPattern);
}

/**
 * Check if a resource is considered sensitive.
 * Placeholder for Priority 3.
 */
export function isSensitiveResource(resource: string): { sensitive: boolean; pattern?: string } {
  const sensitivePatterns = [
    '~/.ssh/**',
    '~/.aws/**',
    '**/credentials.json',
    '**/secrets.*',
    '**/secrets/**',
    '**/.env*',
    '**/*password*',
    '**/*secret*',
    '**/*key*.pem',
  ];

  for (const pattern of sensitivePatterns) {
    if (matchResourcePattern(resource, pattern)) {
      return { sensitive: true, pattern };
    }
  }

  return { sensitive: false };
}

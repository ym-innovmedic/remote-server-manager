/**
 * Server environment detection and visual styling utilities
 */

export type ServerEnvironment = 'prod' | 'staging' | 'uat' | 'test' | 'dev' | 'db' | 'unknown';

export interface EnvironmentStyle {
  icon: string;
  color: string;
  badge?: string;
  requiresConfirmation: boolean;
  warningMessage?: string;
}

/**
 * Environment styles configuration
 */
export const ENVIRONMENT_STYLES: Record<ServerEnvironment, EnvironmentStyle> = {
  prod: {
    icon: 'server-environment',
    color: 'terminal.ansiRed',
    badge: '🔴',
    requiresConfirmation: true,
    warningMessage: '⚠️ You are connecting to a PRODUCTION server!\n\nAre you sure you want to proceed?',
  },
  staging: {
    icon: 'server-environment',
    color: 'terminal.ansiYellow',
    badge: '🟡',
    requiresConfirmation: false,
  },
  uat: {
    icon: 'server-environment',
    color: 'terminal.ansiMagenta',
    badge: '🟣',
    requiresConfirmation: false,
  },
  test: {
    icon: 'server-environment',
    color: 'terminal.ansiCyan',
    badge: '🔵',
    requiresConfirmation: false,
  },
  dev: {
    icon: 'server-environment',
    color: 'terminal.ansiGreen',
    badge: '🟢',
    requiresConfirmation: false,
  },
  db: {
    icon: 'database',
    color: 'terminal.ansiBrightYellow',
    badge: '💾',
    requiresConfirmation: false,
  },
  unknown: {
    icon: 'server',
    color: 'terminal.ansiWhite',
    requiresConfirmation: false,
  },
};

/**
 * Keywords for environment detection
 */
const ENVIRONMENT_KEYWORDS: Record<ServerEnvironment, string[]> = {
  prod: ['prod', 'production', 'prd', 'live', 'master'],
  staging: ['staging', 'stage', 'stg', 'preprod', 'pre-prod'],
  uat: ['uat', 'acceptance', 'qa'],
  test: ['test', 'testing', 'tst'],
  dev: ['dev', 'develop', 'development', 'sandbox', 'local'],
  db: ['db', 'database', 'sql', 'mysql', 'postgres', 'mongo', 'redis', 'oracle', 'mariadb'],
  unknown: [],
};

/**
 * Detect server environment from hostname, group name, or display name
 */
export function detectServerEnvironment(
  hostname: string,
  groupName?: string,
  displayName?: string,
  comment?: string
): ServerEnvironment {
  // Combine all text sources for detection
  const searchText = [
    hostname,
    groupName,
    displayName,
    comment,
  ].filter(Boolean).join(' ').toLowerCase();

  // Check for DB first (can be combined with environments)
  const isDb = ENVIRONMENT_KEYWORDS.db.some(keyword =>
    searchText.includes(keyword)
  );

  // Check environments in priority order
  for (const env of ['prod', 'staging', 'uat', 'test', 'dev'] as ServerEnvironment[]) {
    const keywords = ENVIRONMENT_KEYWORDS[env];
    for (const keyword of keywords) {
      // Match whole word or with common separators
      const pattern = new RegExp(`(^|[._\\-\\s/])${keyword}([._\\-\\s/]|$)`, 'i');
      if (pattern.test(searchText)) {
        // If it's also a DB, prefer DB icon for DB servers in prod
        if (isDb && env === 'prod') {
          return 'db'; // DB servers get special treatment
        }
        return env;
      }
    }
  }

  // If only DB detected
  if (isDb) {
    return 'db';
  }

  return 'unknown';
}

/**
 * Get the style for a server environment
 */
export function getEnvironmentStyle(env: ServerEnvironment): EnvironmentStyle {
  return ENVIRONMENT_STYLES[env];
}

/**
 * Check if an environment requires confirmation before connecting
 */
export function requiresConnectionConfirmation(env: ServerEnvironment): boolean {
  return ENVIRONMENT_STYLES[env].requiresConfirmation;
}

/**
 * Get warning message for an environment
 */
export function getEnvironmentWarning(env: ServerEnvironment): string | undefined {
  return ENVIRONMENT_STYLES[env].warningMessage;
}

/**
 * Format display label with environment badge
 */
export function formatLabelWithBadge(label: string, env: ServerEnvironment): string {
  const style = ENVIRONMENT_STYLES[env];
  if (style.badge) {
    return `${style.badge} ${label}`;
  }
  return label;
}

/**
 * Get environment display name
 */
export function getEnvironmentDisplayName(env: ServerEnvironment): string {
  const names: Record<ServerEnvironment, string> = {
    prod: 'Production',
    staging: 'Staging',
    uat: 'UAT',
    test: 'Test',
    dev: 'Development',
    db: 'Database',
    unknown: 'Server',
  };
  return names[env];
}

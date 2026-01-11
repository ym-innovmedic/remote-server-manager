/**
 * Utilities for group name normalization
 */

/**
 * Normalize a group name for Ansible format
 * - Converts spaces to underscores
 * - Converts to lowercase
 * - Handles empty strings
 */
export function normalizeGroupName(name: string): string {
  if (!name || name.trim() === '') {
    return 'ungrouped';
  }
  return name.replace(/\s+/g, '_').toLowerCase();
}

/**
 * Convert Ansible group name to display format
 * - Converts underscores to spaces
 * - Handles 'ungrouped' specially
 */
export function displayGroupName(name: string): string {
  if (name === 'ungrouped') {
    return 'Ungrouped';
  }
  return name.replace(/_/g, ' ');
}

/**
 * Check if a group name is valid for Ansible
 * - Only alphanumeric, underscore, hyphen allowed
 * - Cannot start with number or hyphen
 */
export function isValidGroupName(name: string): boolean {
  if (!name || name.trim() === '') {
    return false;
  }
  // Must start with letter or underscore
  // Can contain letters, numbers, underscores, hyphens
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name);
}

/**
 * Sanitize a group name for Ansible
 * - Replaces invalid characters
 * - Ensures valid starting character
 */
export function sanitizeGroupName(name: string): string {
  if (!name || name.trim() === '') {
    return 'ungrouped';
  }

  // Replace spaces and special chars with underscores
  let sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Remove consecutive underscores
  sanitized = sanitized.replace(/_+/g, '_');

  // Remove leading/trailing underscores
  sanitized = sanitized.replace(/^_+|_+$/g, '');

  // Ensure starts with letter or underscore
  if (/^[0-9-]/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }

  // If empty after sanitization, use default
  if (!sanitized) {
    return 'ungrouped';
  }

  return sanitized.toLowerCase();
}

/**
 * Compare two group names for equality (case-insensitive)
 */
export function groupNamesEqual(a: string, b: string): boolean {
  return normalizeGroupName(a) === normalizeGroupName(b);
}

/**
 * Sort group names alphabetically, with 'ungrouped' at the end
 */
export function sortGroupNames(names: string[]): string[] {
  return [...names].sort((a, b) => {
    // Ungrouped always last
    if (a === 'ungrouped') {
      return 1;
    }
    if (b === 'ungrouped') {
      return -1;
    }

    // Alphabetical otherwise
    return a.localeCompare(b);
  });
}

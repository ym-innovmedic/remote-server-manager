/**
 * Group-related utilities and types
 */

/**
 * Normalize a group name for Ansible format
 * Converts spaces to underscores, lowercase
 */
export function normalizeGroupName(name: string): string {
  if (!name || name.trim() === '') {
    return 'ungrouped';
  }
  return name.replace(/\s+/g, '_').toLowerCase();
}

/**
 * Convert Ansible group name to display format
 * Converts underscores to spaces, title case first letter
 */
export function displayGroupName(name: string): string {
  if (name === 'ungrouped') {
    return 'Ungrouped';
  }
  return name.replace(/_/g, ' ');
}

/**
 * Check if a group name is valid
 */
export function isValidGroupName(name: string): boolean {
  if (!name || name.trim() === '') {
    return false;
  }
  // Ansible group names should only contain alphanumeric, underscore, hyphen
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Parse a group header from an Ansible inventory line
 * Examples: [group_name], [group_name:children], [group_name:vars]
 */
export interface ParsedGroupHeader {
  name: string;
  type: 'hosts' | 'children' | 'vars';
}

export function parseGroupHeader(line: string): ParsedGroupHeader | null {
  const match = line.match(/^\[([^\]:]+)(?::(\w+))?\]$/);
  if (!match) {
    return null;
  }

  const name = match[1];
  const modifier = match[2];

  let type: 'hosts' | 'children' | 'vars' = 'hosts';
  if (modifier === 'children') {
    type = 'children';
  } else if (modifier === 'vars') {
    type = 'vars';
  }

  return { name, type };
}

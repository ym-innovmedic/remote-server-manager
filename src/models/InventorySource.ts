import { AnsibleInventory } from './Connection';

/**
 * Represents the source of an inventory file
 */
export interface InventorySource {
  /** File path */
  path: string;

  /** Display name (filename) */
  name: string;

  /** Whether the file is read-only */
  readOnly: boolean;

  /** Parsed inventory data */
  inventory: AnsibleInventory | null;

  /** Last loaded timestamp */
  lastLoaded?: Date;

  /** Load error if any */
  error?: string;
}

/**
 * Configuration entry for inventory files
 */
export type InventoryFileConfig = string | { path: string; readOnly?: boolean };

/**
 * Normalize inventory file configuration
 */
export function normalizeInventoryConfig(
  config: InventoryFileConfig
): { path: string; readOnly: boolean } {
  if (typeof config === 'string') {
    return { path: config, readOnly: false };
  }
  return {
    path: config.path,
    readOnly: config.readOnly ?? false,
  };
}

/**
 * Extract filename from path
 */
export function getInventoryDisplayName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Create an empty inventory source
 */
export function createInventorySource(
  path: string,
  readOnly: boolean = false
): InventorySource {
  return {
    path,
    name: getInventoryDisplayName(path),
    readOnly,
    inventory: null,
  };
}

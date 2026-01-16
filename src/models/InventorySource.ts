import { AnsibleInventory } from './Connection';
import { AwsEc2Config, GcpComputeConfig } from './CloudSource';

/**
 * Source type
 */
export type InventorySourceType = 'file' | 'aws_ec2' | 'gcp_compute';

/**
 * Represents the source of an inventory
 */
export interface InventorySource {
  /** Unique identifier for this source */
  id: string;

  /** Source type */
  type: InventorySourceType;

  /** File path (for file sources) */
  path: string;

  /** Display name */
  name: string;

  /** Whether the source is read-only */
  readOnly: boolean;

  /** Parsed inventory data */
  inventory: AnsibleInventory | null;

  /** Last loaded timestamp */
  lastLoaded?: Date;

  /** Load error if any */
  error?: string;

  /** AWS EC2 configuration (for aws_ec2 type) */
  awsConfig?: AwsEc2Config;

  /** GCP Compute configuration (for gcp_compute type) */
  gcpConfig?: GcpComputeConfig;

  /** AWS profile name (for aws_ec2 type) */
  awsProfile?: string;

  /** GCP credentials (stored separately in secrets) */
  gcpProjectId?: string;
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
 * Generate a unique source ID
 */
export function generateSourceId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create an empty file inventory source
 */
export function createInventorySource(
  path: string,
  readOnly: boolean = false
): InventorySource {
  return {
    id: generateSourceId(),
    type: 'file',
    path,
    name: getInventoryDisplayName(path),
    readOnly,
    inventory: null,
  };
}

/**
 * Create an AWS EC2 inventory source
 */
export function createAwsEc2Source(
  name: string,
  config: AwsEc2Config,
  profile?: string
): InventorySource {
  return {
    id: generateSourceId(),
    type: 'aws_ec2',
    path: '', // Not used for cloud sources
    name,
    readOnly: true, // Cloud sources are always read-only
    inventory: null,
    awsConfig: config,
    awsProfile: profile,
  };
}

/**
 * Create a GCP Compute inventory source
 */
export function createGcpComputeSource(
  name: string,
  config: GcpComputeConfig
): InventorySource {
  return {
    id: generateSourceId(),
    type: 'gcp_compute',
    path: '', // Not used for cloud sources
    name,
    readOnly: true, // Cloud sources are always read-only
    inventory: null,
    gcpConfig: config,
    gcpProjectId: config.projectId,
  };
}

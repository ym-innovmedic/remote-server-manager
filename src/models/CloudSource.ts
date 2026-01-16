/**
 * Cloud provider source types and configuration
 * v0.3.0: AWS EC2 and GCP Compute Discovery
 */

/**
 * Supported cloud provider types
 */
export type CloudProviderType = 'aws-ec2' | 'gcp-compute';

/**
 * Grouping options for cloud instances
 */
export type AwsGroupBy = 'region' | 'vpc' | 'tag' | 'none';
export type GcpGroupBy = 'zone' | 'network' | 'label' | 'none';

/**
 * AWS EC2 configuration
 */
export interface AwsEc2Config {
  type: 'aws-ec2';
  profile?: string;
  region: string;
  regions?: string[]; // Multiple regions
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  instanceStateFilter?: string[]; // e.g., ['running', 'stopped']
  tagFilters?: Record<string, string>; // Filter by tags
  groupBy?: AwsGroupBy;
  groupByTagKey?: string; // When groupBy is 'tag'
  autoRefresh?: boolean;
  refreshIntervalMinutes?: number;
}

/**
 * GCP Compute configuration
 */
export interface GcpComputeConfig {
  type: 'gcp-compute';
  projectId: string;
  keyFilePath?: string; // Path to service account JSON
  useApplicationDefaultCredentials?: boolean;
  zones?: string[]; // Empty means all zones
  statusFilter?: string[]; // e.g., ['RUNNING', 'TERMINATED']
  labelFilters?: Record<string, string>; // Filter by labels
  groupBy?: GcpGroupBy;
  groupByLabelKey?: string; // When groupBy is 'label'
  autoRefresh?: boolean;
  refreshIntervalMinutes?: number;
}

/**
 * Union type for cloud configurations
 */
export type CloudConfig = AwsEc2Config | GcpComputeConfig;

/**
 * Cloud source metadata
 */
export interface CloudSourceMetadata {
  providerId: string; // Unique identifier for this source
  providerType: CloudProviderType;
  displayName: string;
  config: CloudConfig;
  lastRefreshed?: Date;
  instanceCount?: number;
  error?: string;
  isRefreshing?: boolean;
}

/**
 * Default AWS configuration
 */
export function getDefaultAwsConfig(): Partial<AwsEc2Config> {
  return {
    type: 'aws-ec2',
    region: 'us-east-1',
    instanceStateFilter: ['running'],
    groupBy: 'region',
    autoRefresh: false,
    refreshIntervalMinutes: 5,
  };
}

/**
 * Default GCP configuration
 */
export function getDefaultGcpConfig(): Partial<GcpComputeConfig> {
  return {
    type: 'gcp-compute',
    useApplicationDefaultCredentials: true,
    statusFilter: ['RUNNING'],
    groupBy: 'zone',
    autoRefresh: false,
    refreshIntervalMinutes: 5,
  };
}

/**
 * Generate a unique provider ID
 */
export function generateProviderId(type: CloudProviderType, identifier: string): string {
  return `${type}://${identifier}`;
}

/**
 * Parse a provider ID
 */
export function parseProviderId(providerId: string): { type: CloudProviderType; identifier: string } | null {
  const match = providerId.match(/^(aws-ec2|gcp-compute):\/\/(.+)$/);
  if (!match) {
    return null;
  }
  return {
    type: match[1] as CloudProviderType,
    identifier: match[2],
  };
}

/**
 * Get display name for a cloud provider
 */
export function getCloudProviderDisplayName(type: CloudProviderType): string {
  switch (type) {
    case 'aws-ec2':
      return 'AWS EC2';
    case 'gcp-compute':
      return 'GCP Compute';
    default:
      return 'Cloud Provider';
  }
}

/**
 * AWS regions with display names
 */
export const AWS_REGIONS: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-west-2': 'Europe (London)',
  'eu-west-3': 'Europe (Paris)',
  'eu-central-1': 'Europe (Frankfurt)',
  'eu-north-1': 'Europe (Stockholm)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-northeast-3': 'Asia Pacific (Osaka)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'sa-east-1': 'South America (Sao Paulo)',
  'ca-central-1': 'Canada (Central)',
  'me-south-1': 'Middle East (Bahrain)',
  'af-south-1': 'Africa (Cape Town)',
};

/**
 * Common GCP regions/zones
 */
export const GCP_REGIONS: string[] = [
  'us-central1',
  'us-east1',
  'us-east4',
  'us-west1',
  'us-west2',
  'us-west3',
  'us-west4',
  'europe-west1',
  'europe-west2',
  'europe-west3',
  'europe-west4',
  'europe-west6',
  'europe-north1',
  'asia-east1',
  'asia-east2',
  'asia-northeast1',
  'asia-northeast2',
  'asia-northeast3',
  'asia-south1',
  'asia-southeast1',
  'asia-southeast2',
  'australia-southeast1',
  'southamerica-east1',
];

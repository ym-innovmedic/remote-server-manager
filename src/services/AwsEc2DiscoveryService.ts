/**
 * AWS EC2 Discovery Service
 * Discovers EC2 instances and converts them to AnsibleHost format
 * v0.3.0
 */

import {
  EC2Client,
  DescribeInstancesCommand,
  Instance,
  Tag,
  Filter,
} from '@aws-sdk/client-ec2';
import type { Provider, AwsCredentialIdentity } from '@aws-sdk/types';
import { AnsibleHost, AnsibleGroup } from '../models/Connection';
import { AwsEc2Config, AwsGroupBy } from '../models/CloudSource';
import { logger } from '../utils/Logger';

/**
 * Discovery result for a region
 */
export interface AwsDiscoveryResult {
  region: string;
  hosts: AnsibleHost[];
  error?: string;
}

/**
 * Grouped discovery result
 */
export interface AwsGroupedResult {
  groups: AnsibleGroup[];
  ungroupedHosts: AnsibleHost[];
  totalCount: number;
}

/**
 * Service for discovering AWS EC2 instances
 */
export class AwsEc2DiscoveryService {
  /**
   * Discover EC2 instances from one or more regions
   */
  async discoverInstances(
    config: AwsEc2Config,
    credentialProvider: Provider<AwsCredentialIdentity>
  ): Promise<AwsGroupedResult> {
    const regions = config.regions || [config.region];
    const allHosts: AnsibleHost[] = [];

    // Discover from each region
    for (const region of regions) {
      try {
        const regionHosts = await this.discoverRegion(region, config, credentialProvider);
        allHosts.push(...regionHosts);
      } catch (error) {
        logger.error(`[AwsEc2Discovery] Error discovering region ${region}:`, error);
        // Continue with other regions
      }
    }

    // Group the hosts
    return this.groupHosts(allHosts, config.groupBy || 'region', config.groupByTagKey);
  }

  /**
   * Discover instances from a single region
   */
  private async discoverRegion(
    region: string,
    config: AwsEc2Config,
    credentialProvider: Provider<AwsCredentialIdentity>
  ): Promise<AnsibleHost[]> {
    const client = new EC2Client({
      region,
      credentials: credentialProvider,
    });

    const filters: Filter[] = [];

    // State filter
    if (config.instanceStateFilter && config.instanceStateFilter.length > 0) {
      filters.push({
        Name: 'instance-state-name',
        Values: config.instanceStateFilter,
      });
    }

    // Tag filters
    if (config.tagFilters) {
      for (const [key, value] of Object.entries(config.tagFilters)) {
        filters.push({
          Name: `tag:${key}`,
          Values: [value],
        });
      }
    }

    const command = new DescribeInstancesCommand({
      Filters: filters.length > 0 ? filters : undefined,
    });

    const response = await client.send(command);
    const hosts: AnsibleHost[] = [];

    // Process reservations
    for (const reservation of response.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        const host = this.convertInstanceToHost(instance, region);
        if (host) {
          hosts.push(host);
        }
      }
    }

    return hosts;
  }

  /**
   * Convert EC2 instance to AnsibleHost
   */
  private convertInstanceToHost(instance: Instance, region: string): AnsibleHost | null {
    // Skip instances without an IP
    if (!instance.PrivateIpAddress && !instance.PublicIpAddress) {
      return null;
    }

    // Get Name tag
    const nameTag = this.getTag(instance.Tags, 'Name');
    const displayName = nameTag || instance.InstanceId || 'Unknown';

    // Detect platform (Windows vs Linux)
    const isWindows = instance.Platform?.toLowerCase() === 'windows';
    const connectionType = isWindows ? 'winrm' : 'ssh';

    // Build host name (prefer private DNS, fall back to instance ID)
    const hostName = instance.PrivateDnsName || instance.InstanceId || 'unknown';

    // Build tags array
    const tags: string[] = ['aws', 'ec2'];
    if (instance.InstanceType) {
      tags.push(instance.InstanceType);
    }
    if (instance.State?.Name) {
      tags.push(instance.State.Name);
    }
    // Add user tags
    for (const tag of instance.Tags || []) {
      if (tag.Key && tag.Value && !['Name'].includes(tag.Key)) {
        tags.push(`${tag.Key}:${tag.Value}`);
      }
    }

    // Build raw variables with all AWS metadata
    const rawVariables: Record<string, string> = {
      aws_instance_id: instance.InstanceId || '',
      aws_region: region,
      aws_availability_zone: instance.Placement?.AvailabilityZone || '',
      aws_instance_type: instance.InstanceType || '',
      aws_vpc_id: instance.VpcId || '',
      aws_subnet_id: instance.SubnetId || '',
      aws_state: instance.State?.Name || '',
      aws_launch_time: instance.LaunchTime?.toISOString() || '',
      aws_key_name: instance.KeyName || '',
      aws_platform: instance.Platform || 'linux',
      aws_architecture: instance.Architecture || '',
      aws_image_id: instance.ImageId || '',
    };

    // Add IP addresses
    if (instance.PublicIpAddress) {
      rawVariables.aws_public_ip = instance.PublicIpAddress;
    }
    if (instance.PublicDnsName) {
      rawVariables.aws_public_dns = instance.PublicDnsName;
    }
    if (instance.PrivateIpAddress) {
      rawVariables.aws_private_ip = instance.PrivateIpAddress;
    }
    if (instance.PrivateDnsName) {
      rawVariables.aws_private_dns = instance.PrivateDnsName;
    }

    // Add security groups
    if (instance.SecurityGroups && instance.SecurityGroups.length > 0) {
      rawVariables.aws_security_groups = instance.SecurityGroups
        .map(sg => sg.GroupName || sg.GroupId)
        .filter(Boolean)
        .join(',');
    }

    // Add all tags as aws_tag_*
    for (const tag of instance.Tags || []) {
      if (tag.Key && tag.Value) {
        rawVariables[`aws_tag_${tag.Key.toLowerCase().replace(/[^a-z0-9]/g, '_')}`] = tag.Value;
      }
    }

    const host: AnsibleHost = {
      name: hostName,
      ansible_host: instance.PrivateIpAddress || instance.PublicIpAddress,
      ansible_connection: connectionType === 'winrm' ? 'winrm' : 'ssh',
      ansible_port: connectionType === 'winrm' ? 5986 : 22,
      remote_mgr_connection_type: connectionType === 'winrm' ? 'rdp' : 'ssh',
      remote_mgr_display_name: displayName,
      remote_mgr_tags: tags,
      rawVariables,
    };

    // Add SSH key reference if available
    if (instance.KeyName) {
      // Common key paths
      const possibleKeyPaths = [
        `~/.ssh/${instance.KeyName}.pem`,
        `~/.ssh/${instance.KeyName}`,
      ];
      host.remote_mgr_identity_file = possibleKeyPaths[0];
    }

    return host;
  }

  /**
   * Get tag value from tags array
   */
  private getTag(tags: Tag[] | undefined, key: string): string | undefined {
    if (!tags) {
      return undefined;
    }
    const tag = tags.find(t => t.Key === key);
    return tag?.Value;
  }

  /**
   * Group hosts by specified criteria
   */
  private groupHosts(
    hosts: AnsibleHost[],
    groupBy: AwsGroupBy,
    tagKey?: string
  ): AwsGroupedResult {
    if (groupBy === 'none') {
      return {
        groups: [],
        ungroupedHosts: hosts,
        totalCount: hosts.length,
      };
    }

    const groupMap = new Map<string, AnsibleHost[]>();

    for (const host of hosts) {
      let groupName: string;

      switch (groupBy) {
        case 'region':
          groupName = host.rawVariables.aws_region || 'unknown-region';
          break;
        case 'vpc':
          groupName = host.rawVariables.aws_vpc_id || 'no-vpc';
          break;
        case 'tag':
          if (tagKey) {
            const tagValue = host.rawVariables[`aws_tag_${tagKey.toLowerCase().replace(/[^a-z0-9]/g, '_')}`];
            groupName = tagValue || `no-${tagKey}`;
          } else {
            groupName = 'ungrouped';
          }
          break;
        default:
          groupName = 'ungrouped';
      }

      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, []);
      }
      groupMap.get(groupName)!.push(host);
    }

    const groups: AnsibleGroup[] = [];
    for (const [name, groupHosts] of groupMap) {
      groups.push({
        name: this.formatGroupName(name, groupBy),
        hosts: groupHosts,
        children: [],
        vars: {},
        comments: [],
      });
    }

    // Sort groups alphabetically
    groups.sort((a, b) => a.name.localeCompare(b.name));

    return {
      groups,
      ungroupedHosts: [],
      totalCount: hosts.length,
    };
  }

  /**
   * Format group name for display
   */
  private formatGroupName(name: string, groupBy: AwsGroupBy): string {
    switch (groupBy) {
      case 'region':
        return `aws_${name}`;
      case 'vpc':
        return name === 'no-vpc' ? 'aws_no_vpc' : `aws_${name}`;
      case 'tag':
        return `aws_${name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
      default:
        return name;
    }
  }

  /**
   * Test connection to AWS
   */
  async testConnection(
    region: string,
    credentialProvider: Provider<AwsCredentialIdentity>
  ): Promise<{ success: boolean; error?: string; accountId?: string }> {
    try {
      const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts');
      const client = new STSClient({
        region,
        credentials: credentialProvider,
      });

      const response = await client.send(new GetCallerIdentityCommand({}));
      return {
        success: true,
        accountId: response.Account,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

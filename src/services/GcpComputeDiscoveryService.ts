/**
 * GCP Compute Engine Discovery Service
 * Discovers GCP VM instances and converts them to AnsibleHost format
 * v0.3.0
 */

import { InstancesClient, ZonesClient } from '@google-cloud/compute';
import type { protos } from '@google-cloud/compute';
import { AnsibleHost, AnsibleGroup } from '../models/Connection';
import { GcpComputeConfig, GcpGroupBy } from '../models/CloudSource';
import { GcpCredentials, GcpCredentialProvider } from '../providers/GcpCredentialProvider';

type Instance = protos.google.cloud.compute.v1.IInstance;

/**
 * Grouped discovery result
 */
export interface GcpGroupedResult {
  groups: AnsibleGroup[];
  ungroupedHosts: AnsibleHost[];
  totalCount: number;
}

/**
 * Service for discovering GCP Compute Engine instances
 */
export class GcpComputeDiscoveryService {
  private credentialProvider: GcpCredentialProvider;

  constructor(credentialProvider: GcpCredentialProvider) {
    this.credentialProvider = credentialProvider;
  }

  /**
   * Discover Compute Engine instances
   */
  async discoverInstances(
    config: GcpComputeConfig,
    credentials: GcpCredentials
  ): Promise<GcpGroupedResult> {
    const authOptions = this.credentialProvider.getAuthOptions(credentials);
    const instancesClient = new InstancesClient(authOptions);

    const allHosts: AnsibleHost[] = [];

    // Get zones to scan
    const zones = config.zones && config.zones.length > 0
      ? config.zones
      : await this.listAllZones(credentials);

    // Discover from all zones in parallel (batched to avoid rate limits)
    const batchSize = 10;
    for (let i = 0; i < zones.length; i += batchSize) {
      const batch = zones.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(zone => this.discoverZone(instancesClient, credentials.projectId, zone, config))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          allHosts.push(...result.value);
        } else {
          console.error(`[GcpComputeDiscovery] Error discovering zone ${batch[j]}:`, result.reason);
        }
      }
    }

    // Group the hosts
    return this.groupHosts(allHosts, config.groupBy || 'zone', config.groupByLabelKey);
  }

  /**
   * List all available zones in the project
   */
  private async listAllZones(credentials: GcpCredentials): Promise<string[]> {
    const authOptions = this.credentialProvider.getAuthOptions(credentials);
    const zonesClient = new ZonesClient(authOptions);

    const zones: string[] = [];
    const [zonesList] = await zonesClient.list({ project: credentials.projectId });

    for (const zone of zonesList) {
      if (zone.name) {
        zones.push(zone.name);
      }
    }

    return zones;
  }

  /**
   * Discover instances from a single zone
   */
  private async discoverZone(
    client: InstancesClient,
    projectId: string,
    zone: string,
    config: GcpComputeConfig
  ): Promise<AnsibleHost[]> {
    const hosts: AnsibleHost[] = [];

    // List instances in zone
    const [instances] = await client.list({
      project: projectId,
      zone,
    });

    for (const instance of instances) {
      // Apply status filter
      if (config.statusFilter && config.statusFilter.length > 0) {
        if (!config.statusFilter.includes(instance.status || '')) {
          continue;
        }
      }

      // Apply label filters
      if (config.labelFilters) {
        let matchesFilters = true;
        for (const [key, value] of Object.entries(config.labelFilters)) {
          if (instance.labels?.[key] !== value) {
            matchesFilters = false;
            break;
          }
        }
        if (!matchesFilters) {
          continue;
        }
      }

      const host = this.convertInstanceToHost(instance, projectId, zone);
      if (host) {
        hosts.push(host);
      }
    }

    return hosts;
  }

  /**
   * Convert GCP VM instance to AnsibleHost
   */
  private convertInstanceToHost(
    instance: Instance,
    projectId: string,
    zone: string
  ): AnsibleHost | null {
    // Get network interface
    const networkInterface = instance.networkInterfaces?.[0];
    if (!networkInterface) {
      return null;
    }

    const internalIp = networkInterface.networkIP;
    const externalIp = networkInterface.accessConfigs?.[0]?.natIP;

    // Skip instances without an IP
    if (!internalIp && !externalIp) {
      return null;
    }

    const displayName = instance.name || 'unknown';

    // Detect platform (Windows vs Linux)
    const isWindows = this.isWindowsInstance(instance);
    const connectionType = isWindows ? 'winrm' : 'ssh';

    // Build tags array
    const tags: string[] = ['gcp', 'compute'];

    // Add machine type
    const machineType = instance.machineType?.split('/').pop();
    if (machineType) {
      tags.push(machineType);
    }

    // Add status
    if (instance.status) {
      tags.push(instance.status.toLowerCase());
    }

    // Add labels as tags
    for (const [key, value] of Object.entries(instance.labels || {})) {
      tags.push(`${key}:${value}`);
    }

    // Build raw variables with all GCP metadata
    const rawVariables: Record<string, string> = {
      gcp_project_id: projectId,
      gcp_zone: zone,
      gcp_region: zone.replace(/-[a-z]$/, ''),
      gcp_instance_id: instance.id?.toString() || '',
      gcp_instance_name: instance.name || '',
      gcp_machine_type: machineType || '',
      gcp_status: instance.status || '',
      gcp_creation_timestamp: instance.creationTimestamp || '',
      gcp_self_link: instance.selfLink || '',
    };

    // Add IP addresses
    if (internalIp) {
      rawVariables.gcp_internal_ip = internalIp;
    }
    if (externalIp) {
      rawVariables.gcp_external_ip = externalIp;
    }

    // Add network info
    if (networkInterface.network) {
      rawVariables.gcp_network = networkInterface.network.split('/').pop() || '';
    }
    if (networkInterface.subnetwork) {
      rawVariables.gcp_subnetwork = networkInterface.subnetwork.split('/').pop() || '';
    }

    // Add service account
    if (instance.serviceAccounts && instance.serviceAccounts.length > 0) {
      rawVariables.gcp_service_account = instance.serviceAccounts[0].email || '';
    }

    // Add disk info
    if (instance.disks && instance.disks.length > 0) {
      const bootDisk = instance.disks.find(d => d.boot);
      if (bootDisk?.source) {
        rawVariables.gcp_boot_disk = bootDisk.source.split('/').pop() || '';
      }
    }

    // Add all labels as gcp_label_*
    for (const [key, value] of Object.entries(instance.labels || {})) {
      rawVariables[`gcp_label_${key.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`] = value;
    }

    // Add network tags
    if (instance.tags?.items && instance.tags.items.length > 0) {
      rawVariables.gcp_network_tags = instance.tags.items.join(',');
    }

    const host: AnsibleHost = {
      name: instance.name || 'unknown',
      ansible_host: internalIp || externalIp || undefined,
      ansible_connection: connectionType === 'winrm' ? 'winrm' : 'ssh',
      ansible_port: connectionType === 'winrm' ? 5986 : 22,
      remote_mgr_connection_type: connectionType === 'winrm' ? 'rdp' : 'ssh',
      remote_mgr_display_name: displayName,
      remote_mgr_tags: tags,
      rawVariables,
    };

    return host;
  }

  /**
   * Check if instance is Windows
   */
  private isWindowsInstance(instance: Instance): boolean {
    // Check disks for Windows licenses
    for (const disk of instance.disks || []) {
      const licenses = disk.licenses || [];
      for (const license of licenses) {
        if (license?.toLowerCase().includes('windows')) {
          return true;
        }
      }
    }

    // Check metadata for Windows indicators
    const metadata = instance.metadata?.items || [];
    for (const item of metadata) {
      if (item.key?.toLowerCase() === 'windows-startup-script-ps1') {
        return true;
      }
    }

    return false;
  }

  /**
   * Group hosts by specified criteria
   */
  private groupHosts(
    hosts: AnsibleHost[],
    groupBy: GcpGroupBy,
    labelKey?: string
  ): GcpGroupedResult {
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
        case 'zone':
          groupName = host.rawVariables.gcp_zone || 'unknown-zone';
          break;
        case 'network':
          groupName = host.rawVariables.gcp_network || 'no-network';
          break;
        case 'label':
          if (labelKey) {
            const labelValue = host.rawVariables[`gcp_label_${labelKey.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`];
            groupName = labelValue || `no-${labelKey}`;
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
  private formatGroupName(name: string, groupBy: GcpGroupBy): string {
    switch (groupBy) {
      case 'zone':
        return `gcp_${name}`;
      case 'network':
        return name === 'no-network' ? 'gcp_no_network' : `gcp_${name}`;
      case 'label':
        return `gcp_${name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
      default:
        return name;
    }
  }

  /**
   * Test connection to GCP
   */
  async testConnection(
    credentials: GcpCredentials
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const authOptions = this.credentialProvider.getAuthOptions(credentials);
      const zonesClient = new ZonesClient(authOptions);

      // Try to list zones (quick API call to validate auth)
      await zonesClient.list({
        project: credentials.projectId,
        maxResults: 1,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

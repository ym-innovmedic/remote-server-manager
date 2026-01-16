import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AnsibleParser } from '../parsers/AnsibleParser';
import { AnsibleHost, AnsibleInventory } from '../models/Connection';
import {
  InventorySource,
  InventorySourceType,
  InventoryFileConfig,
  normalizeInventoryConfig,
  createInventorySource,
  createAwsEc2Source,
  createGcpComputeSource,
} from '../models/InventorySource';
import { AwsEc2Config, GcpComputeConfig } from '../models/CloudSource';
import { AwsEc2DiscoveryService } from './AwsEc2DiscoveryService';
import { GcpComputeDiscoveryService } from './GcpComputeDiscoveryService';
import { AwsCredentialProvider } from '../providers/AwsCredentialProvider';
import { GcpCredentialProvider, GcpCredentials } from '../providers/GcpCredentialProvider';

/**
 * Cloud source configuration for storage
 */
interface CloudSourceConfig {
  type: 'aws_ec2' | 'gcp_compute';
  name: string;
  config: AwsEc2Config | GcpComputeConfig;
  profile?: string; // AWS profile
}

/**
 * Manages multiple inventory sources (files and cloud)
 */
export class InventoryManager {
  private sources: InventorySource[] = [];
  private parser: AnsibleParser;
  private awsCredentialProvider?: AwsCredentialProvider;
  private gcpCredentialProvider?: GcpCredentialProvider;
  private awsDiscoveryService?: AwsEc2DiscoveryService;
  private gcpDiscoveryService?: GcpComputeDiscoveryService;

  constructor() {
    this.parser = new AnsibleParser();
  }

  /**
   * Initialize cloud providers (call after extension context is available)
   */
  initializeCloudProviders(secretStorage: vscode.SecretStorage): void {
    this.awsCredentialProvider = new AwsCredentialProvider(secretStorage);
    this.gcpCredentialProvider = new GcpCredentialProvider(secretStorage);
    this.awsDiscoveryService = new AwsEc2DiscoveryService();
    this.gcpDiscoveryService = new GcpComputeDiscoveryService(this.gcpCredentialProvider);
  }

  /**
   * Load inventory sources from VS Code configuration
   */
  loadFromConfiguration(): void {
    const config = vscode.workspace.getConfiguration('remoteServerManager');
    const inventoryFiles = config.get<InventoryFileConfig[]>('inventoryFiles', []);
    const cloudSources = config.get<CloudSourceConfig[]>('cloudSources', []);

    console.log('Loading inventory configuration:', JSON.stringify(inventoryFiles));
    console.log('Loading cloud sources:', JSON.stringify(cloudSources));

    this.sources = [];

    // Load file-based inventory sources
    for (const fileConfig of inventoryFiles) {
      const { path: filePath, readOnly } = normalizeInventoryConfig(fileConfig);
      const resolvedPath = this.resolvePath(filePath);
      console.log(`Loading inventory file: ${resolvedPath} (readOnly: ${readOnly})`);
      const source = createInventorySource(resolvedPath, readOnly);

      try {
        this.loadInventoryFile(source);
        if (source.inventory) {
          console.log(`Loaded ${source.inventory.groups.length} groups, ${source.inventory.ungroupedHosts.length} ungrouped hosts`);
        }
      } catch (error) {
        console.error(`Failed to load inventory: ${String(error)}`);
        source.error = `Failed to load: ${String(error)}`;
      }

      this.sources.push(source);
    }

    // Load cloud sources (without fetching data - that happens on refresh)
    for (const cloudConfig of cloudSources) {
      let source: InventorySource;

      if (cloudConfig.type === 'aws_ec2') {
        source = createAwsEc2Source(
          cloudConfig.name,
          cloudConfig.config as AwsEc2Config,
          cloudConfig.profile
        );
      } else if (cloudConfig.type === 'gcp_compute') {
        source = createGcpComputeSource(
          cloudConfig.name,
          cloudConfig.config as GcpComputeConfig
        );
      } else {
        console.warn(`Unknown cloud source type: ${String(cloudConfig.type)}`);
        continue;
      }

      this.sources.push(source);
    }

    console.log(`Total inventory sources loaded: ${this.sources.length}`);
  }

  /**
   * Load a single inventory file
   */
  private loadInventoryFile(source: InventorySource): void {
    if (!fs.existsSync(source.path)) {
      source.error = 'File not found';
      source.inventory = null;
      return;
    }

    try {
      const content = fs.readFileSync(source.path, 'utf-8');
      source.inventory = this.parser.parse(content);
      source.lastLoaded = new Date();
      source.error = undefined;
    } catch (error) {
      source.error = `Parse error: ${String(error)}`;
      source.inventory = null;
    }
  }

  /**
   * Save an inventory file
   */
  saveInventoryFile(source: InventorySource): void {
    if (source.readOnly) {
      throw new Error('Cannot save read-only inventory file');
    }

    if (!source.inventory) {
      throw new Error('No inventory data to save');
    }

    const content = this.parser.serialize(source.inventory);
    fs.writeFileSync(source.path, content, 'utf-8');
    source.lastLoaded = new Date();
  }

  /**
   * Get all inventory sources
   */
  getSources(): InventorySource[] {
    return this.sources;
  }

  /**
   * Get a source by path
   */
  getSourceByPath(filePath: string): InventorySource | undefined {
    return this.sources.find((s) => s.path === filePath);
  }

  /**
   * Add a new inventory source
   */
  async addSource(filePath: string, readOnly: boolean = false): Promise<InventorySource> {
    const resolvedPath = this.resolvePath(filePath);

    // Check if already exists
    const existing = this.getSourceByPath(resolvedPath);
    if (existing) {
      return existing;
    }

    const source = createInventorySource(resolvedPath, readOnly);
    this.loadInventoryFile(source);
    this.sources.push(source);

    // Update configuration
    await this.updateConfiguration();

    return source;
  }

  /**
   * Remove an inventory source
   */
  async removeSource(filePath: string): Promise<void> {
    const index = this.sources.findIndex((s) => s.path === filePath);
    if (index !== -1) {
      this.sources.splice(index, 1);
      await this.updateConfiguration();
    }
  }

  /**
   * Refresh all sources
   */
  async refresh(): Promise<void> {
    for (const source of this.sources) {
      if (source.type === 'file') {
        this.loadInventoryFile(source);
      } else {
        await this.refreshCloudSource(source);
      }
    }
  }

  /**
   * Refresh a specific source by ID
   */
  async refreshSource(sourceId: string): Promise<void> {
    const source = this.sources.find(s => s.id === sourceId);
    if (!source) {
      return;
    }

    if (source.type === 'file') {
      this.loadInventoryFile(source);
    } else {
      await this.refreshCloudSource(source);
    }
  }

  /**
   * Refresh a cloud source
   */
  private async refreshCloudSource(source: InventorySource): Promise<void> {
    try {
      if (source.type === 'aws_ec2' && source.awsConfig) {
        await this.refreshAwsSource(source);
      } else if (source.type === 'gcp_compute' && source.gcpConfig) {
        await this.refreshGcpSource(source);
      }
    } catch (error) {
      source.error = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[InventoryManager] Failed to refresh cloud source ${source.name}:`, error);
    }
  }

  /**
   * Refresh AWS EC2 source
   */
  private async refreshAwsSource(source: InventorySource): Promise<void> {
    if (!this.awsCredentialProvider || !this.awsDiscoveryService || !source.awsConfig) {
      source.error = 'AWS providers not initialized';
      return;
    }

    console.log(`[InventoryManager] Refreshing AWS EC2 source: ${source.name}`);

    try {
      const credentialProvider = await this.awsCredentialProvider.getCredentialProvider(source.awsProfile);
      const result = await this.awsDiscoveryService.discoverInstances(source.awsConfig, credentialProvider);

      // Convert to AnsibleInventory format
      const inventory: AnsibleInventory = {
        groups: result.groups,
        ungroupedHosts: result.ungroupedHosts,
        headerComments: [`# AWS EC2 Discovery - ${new Date().toISOString()}`],
      };

      source.inventory = inventory;
      source.lastLoaded = new Date();
      source.error = undefined;

      console.log(`[InventoryManager] AWS EC2 discovered ${result.totalCount} instances`);
    } catch (error) {
      source.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Refresh GCP Compute source
   */
  private async refreshGcpSource(source: InventorySource): Promise<void> {
    if (!this.gcpCredentialProvider || !this.gcpDiscoveryService || !source.gcpConfig) {
      source.error = 'GCP providers not initialized';
      return;
    }

    console.log(`[InventoryManager] Refreshing GCP Compute source: ${source.name}`);

    try {
      const credentials: GcpCredentials = {
        projectId: source.gcpConfig.projectId,
        useAdc: source.gcpConfig.useApplicationDefaultCredentials ?? true,
        keyFilePath: source.gcpConfig.keyFilePath,
      };

      const result = await this.gcpDiscoveryService.discoverInstances(source.gcpConfig, credentials);

      // Convert to AnsibleInventory format
      const inventory: AnsibleInventory = {
        groups: result.groups,
        ungroupedHosts: result.ungroupedHosts,
        headerComments: [`# GCP Compute Discovery - ${new Date().toISOString()}`],
      };

      source.inventory = inventory;
      source.lastLoaded = new Date();
      source.error = undefined;

      console.log(`[InventoryManager] GCP Compute discovered ${result.totalCount} instances`);
    } catch (error) {
      source.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Add an AWS EC2 source
   */
  async addAwsEc2Source(
    name: string,
    config: AwsEc2Config,
    profile?: string
  ): Promise<InventorySource> {
    const source = createAwsEc2Source(name, config, profile);
    this.sources.push(source);

    // Refresh to get initial data
    await this.refreshCloudSource(source);

    // Update configuration
    await this.updateConfiguration();

    return source;
  }

  /**
   * Add a GCP Compute source
   */
  async addGcpComputeSource(
    name: string,
    config: GcpComputeConfig
  ): Promise<InventorySource> {
    const source = createGcpComputeSource(name, config);
    this.sources.push(source);

    // Refresh to get initial data
    await this.refreshCloudSource(source);

    // Update configuration
    await this.updateConfiguration();

    return source;
  }

  /**
   * Remove a source by ID
   */
  async removeSourceById(sourceId: string): Promise<void> {
    const index = this.sources.findIndex(s => s.id === sourceId);
    if (index !== -1) {
      this.sources.splice(index, 1);
      await this.updateConfiguration();
    }
  }

  /**
   * Get AWS credential provider
   */
  getAwsCredentialProvider(): AwsCredentialProvider | undefined {
    return this.awsCredentialProvider;
  }

  /**
   * Get GCP credential provider
   */
  getGcpCredentialProvider(): GcpCredentialProvider | undefined {
    return this.gcpCredentialProvider;
  }

  /**
   * Get sources by type
   */
  getSourcesByType(type: InventorySourceType): InventorySource[] {
    return this.sources.filter(s => s.type === type);
  }

  /**
   * Add a host to an inventory
   */
  addHost(source: InventorySource, host: AnsibleHost, groupName?: string): void {
    if (source.readOnly) {
      throw new Error('Cannot modify read-only inventory file');
    }

    if (!source.inventory) {
      source.inventory = {
        groups: [],
        ungroupedHosts: [],
        headerComments: [],
      };
    }

    if (groupName) {
      let group = source.inventory.groups.find((g) => g.name === groupName);
      if (!group) {
        group = {
          name: groupName,
          hosts: [],
          children: [],
          vars: {},
          comments: [],
        };
        source.inventory.groups.push(group);
      }
      group.hosts.push(host);
    } else {
      source.inventory.ungroupedHosts.push(host);
    }
  }

  /**
   * Remove a host from an inventory
   */
  removeHost(source: InventorySource, hostName: string): boolean {
    if (source.readOnly) {
      throw new Error('Cannot modify read-only inventory file');
    }

    if (!source.inventory) {
      return false;
    }

    // Check ungrouped hosts
    const ungroupedIndex = source.inventory.ungroupedHosts.findIndex(
      (h) => h.name === hostName
    );
    if (ungroupedIndex !== -1) {
      source.inventory.ungroupedHosts.splice(ungroupedIndex, 1);
      return true;
    }

    // Check groups
    for (const group of source.inventory.groups) {
      const hostIndex = group.hosts.findIndex((h) => h.name === hostName);
      if (hostIndex !== -1) {
        group.hosts.splice(hostIndex, 1);
        return true;
      }
    }

    return false;
  }

  /**
   * Find a host across all inventories
   */
  findHost(hostName: string): { host: AnsibleHost; source: InventorySource } | undefined {
    for (const source of this.sources) {
      if (!source.inventory) {
        continue;
      }

      // Check ungrouped
      const ungroupedHost = source.inventory.ungroupedHosts.find(
        (h) => h.name === hostName
      );
      if (ungroupedHost) {
        return { host: ungroupedHost, source };
      }

      // Check groups
      for (const group of source.inventory.groups) {
        const host = group.hosts.find((h) => h.name === hostName);
        if (host) {
          return { host, source };
        }
      }
    }

    return undefined;
  }

  /**
   * Get all hosts across all inventories
   */
  getAllHosts(): AnsibleHost[] {
    const hosts: AnsibleHost[] = [];

    for (const source of this.sources) {
      if (!source.inventory) {
        continue;
      }

      hosts.push(...source.inventory.ungroupedHosts);

      for (const group of source.inventory.groups) {
        hosts.push(...group.hosts);
      }
    }

    return hosts;
  }

  /**
   * Get the first editable source (for adding new connections)
   */
  getEditableSource(): InventorySource | undefined {
    return this.sources.find((s) => !s.readOnly);
  }

  /**
   * Resolve a file path (handle workspace relative paths)
   */
  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    // Try workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      return path.join(workspaceFolders[0].uri.fsPath, filePath);
    }

    // Use home directory
    const homedir = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(homedir, filePath);
  }

  /**
   * Update VS Code configuration with current sources
   */
  private async updateConfiguration(): Promise<void> {
    const config = vscode.workspace.getConfiguration('remoteServerManager');

    // Build file inventory list
    const inventoryFiles: InventoryFileConfig[] = this.sources
      .filter(s => s.type === 'file')
      .map((s) => {
        if (s.readOnly) {
          return { path: s.path, readOnly: true };
        }
        return s.path;
      });

    // Build cloud sources list
    const cloudSources: CloudSourceConfig[] = [];
    for (const s of this.sources) {
      if (s.type === 'aws_ec2' && s.awsConfig) {
        cloudSources.push({
          type: 'aws_ec2',
          name: s.name,
          config: s.awsConfig,
          profile: s.awsProfile,
        });
      } else if (s.type === 'gcp_compute' && s.gcpConfig) {
        cloudSources.push({
          type: 'gcp_compute',
          name: s.name,
          config: s.gcpConfig,
        });
      }
    }

    await config.update(
      'inventoryFiles',
      inventoryFiles,
      vscode.ConfigurationTarget.Global
    );

    await config.update(
      'cloudSources',
      cloudSources,
      vscode.ConfigurationTarget.Global
    );
  }
}

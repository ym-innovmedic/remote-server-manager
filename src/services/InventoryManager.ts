import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AnsibleParser } from '../parsers/AnsibleParser';
import { AnsibleHost } from '../models/Connection';
import {
  InventorySource,
  InventoryFileConfig,
  normalizeInventoryConfig,
  createInventorySource,
} from '../models/InventorySource';

/**
 * Manages multiple inventory files
 */
export class InventoryManager {
  private sources: InventorySource[] = [];
  private parser: AnsibleParser;

  constructor() {
    this.parser = new AnsibleParser();
  }

  /**
   * Load inventory files from VS Code configuration
   */
  loadFromConfiguration(): void {
    const config = vscode.workspace.getConfiguration('remoteServerManager');
    const inventoryFiles = config.get<InventoryFileConfig[]>('inventoryFiles', []);

    console.log('Loading inventory configuration:', JSON.stringify(inventoryFiles));

    this.sources = [];

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
  refresh(): void {
    for (const source of this.sources) {
      this.loadInventoryFile(source);
    }
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
    const inventoryFiles: InventoryFileConfig[] = this.sources.map((s) => {
      if (s.readOnly) {
        return { path: s.path, readOnly: true };
      }
      return s.path;
    });

    await config.update(
      'inventoryFiles',
      inventoryFiles,
      vscode.ConfigurationTarget.Global
    );
  }
}

import * as vscode from 'vscode';
import { InventoryManager } from '../services/InventoryManager';
import {
  AnsibleHost,
  AnsibleGroup,
  getDisplayLabel,
  detectConnectionType,
  ConnectionType,
} from '../models/Connection';
import { InventorySource } from '../models/InventorySource';
import { displayGroupName } from '../models/Group';
import {
  detectServerEnvironment,
  getEnvironmentStyle,
  ServerEnvironment,
  getEnvironmentDisplayName,
} from '../utils/serverEnvironment';
import { UsageTrackingService } from '../services/UsageTrackingService';

/**
 * Tree item types
 */
export type TreeItemType = 'inventory' | 'group' | 'connection' | 'favorites' | 'recent';

/**
 * Custom tree item with additional metadata
 */
export class ConnectionTreeItem extends vscode.TreeItem {
  public serverEnvironment?: ServerEnvironment;
  public usageCount?: number;
  public isFavorite?: boolean;
  public sourceId?: string;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: TreeItemType,
    public readonly data?: AnsibleHost | AnsibleGroup | InventorySource,
    public readonly inventorySource?: InventorySource,
    public readonly groupName?: string
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;
    this.setupItem();
  }

  private setupItem(): void {
    switch (this.itemType) {
      case 'inventory':
        this.setupInventoryItem();
        break;
      case 'group':
        this.setupGroupItem();
        break;
      case 'connection':
        this.setupConnectionItem();
        break;
    }
  }

  private setupInventoryItem(): void {
    const source = this.data as InventorySource | undefined;
    if (!source) {
      this.iconPath = new vscode.ThemeIcon('folder-library', new vscode.ThemeColor('terminal.ansiMagenta'));
      return;
    }

    // Set sourceId for cloud source removal
    this.sourceId = source.id;

    // Handle different source types
    if (source.type === 'aws_ec2') {
      // AWS EC2 cloud source - orange cloud icon
      this.iconPath = new vscode.ThemeIcon('cloud', new vscode.ThemeColor('terminal.ansiYellow'));
      this.contextValue = 'cloudSource';
      this.description = source.error || 'AWS EC2';
    } else if (source.type === 'gcp_compute') {
      // GCP Compute cloud source - blue cloud icon
      this.iconPath = new vscode.ThemeIcon('cloud', new vscode.ThemeColor('terminal.ansiBrightBlue'));
      this.contextValue = 'cloudSource';
      this.description = source.error || 'GCP Compute';
    } else {
      // File-based inventory source
      this.iconPath = new vscode.ThemeIcon('folder-library', new vscode.ThemeColor('terminal.ansiMagenta'));
      if (source.readOnly) {
        this.description = '(read-only)';
        this.iconPath = new vscode.ThemeIcon('lock', new vscode.ThemeColor('terminal.ansiYellow'));
      }
    }

    // Override icon for error state
    if (source.error) {
      this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('terminal.ansiRed'));
      this.description = source.error;
    }
  }

  private setupGroupItem(): void {
    const group = this.data as AnsibleGroup;
    // Special color for ungrouped section
    if (group.name === 'ungrouped') {
      this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('terminal.ansiWhite'));
    } else {
      // Blue-ish for regular groups
      this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('terminal.ansiBrightBlue'));
    }
    const hostCount = group.hosts.length;
    const childCount = group.children.length;
    if (hostCount > 0 || childCount > 0) {
      const parts: string[] = [];
      if (hostCount > 0) {
        parts.push(`${hostCount} host${hostCount !== 1 ? 's' : ''}`);
      }
      if (childCount > 0) {
        parts.push(`${childCount} group${childCount !== 1 ? 's' : ''}`);
      }
      this.description = parts.join(', ');
    }
  }

  private setupConnectionItem(): void {
    const host = this.data as AnsibleHost;
    const connectionType = detectConnectionType(host);

    // Detect server environment
    this.serverEnvironment = detectServerEnvironment(
      host.name,
      this.groupName,
      host.remote_mgr_display_name,
      host.comment
    );

    // Set icon based on environment and connection type
    this.iconPath = this.getConnectionIcon(connectionType, this.serverEnvironment);

    // Build description with environment and IP
    const descParts: string[] = [];

    // Add environment badge for prod/staging/uat
    if (this.serverEnvironment !== 'unknown') {
      descParts.push(getEnvironmentDisplayName(this.serverEnvironment).toUpperCase());
    }

    // Add IP if different from hostname
    if (host.ansible_host && host.ansible_host !== host.name) {
      descParts.push(host.ansible_host);
    }

    // Add favorite star
    if (this.isFavorite) {
      descParts.unshift('⭐');
    }

    // Add usage count if frequently used
    if (this.usageCount && this.usageCount > 5) {
      descParts.push(`(${this.usageCount}x)`);
    }

    this.description = descParts.join(' • ');

    // Set tooltip
    this.tooltip = this.buildTooltip(host, connectionType);

    // Set context value based on connection type and environment (for conditional menu items)
    // Format: connection-{type} or connection-{type}-prod
    const connTypeSuffix = connectionType === 'rdp' ? 'rdp' : 'ssh';
    if (this.serverEnvironment === 'prod') {
      this.contextValue = `connection-${connTypeSuffix}-prod`;
    } else {
      this.contextValue = `connection-${connTypeSuffix}`;
    }

    // Enable double-click to connect
    this.command = {
      command: 'remoteServerManager.connect',
      title: 'Connect',
      arguments: [this],
    };
  }

  private getConnectionIcon(connectionType: ConnectionType, environment?: ServerEnvironment): vscode.ThemeIcon {
    // Get environment-based color if available
    const envStyle = environment ? getEnvironmentStyle(environment) : null;

    // Use environment color for prod/staging/uat, otherwise use connection type color
    const getColor = (): vscode.ThemeColor | undefined => {
      if (envStyle && environment !== 'unknown') {
        return new vscode.ThemeColor(envStyle.color);
      }
      // Default colors by connection type
      switch (connectionType) {
        case 'rdp':
          return new vscode.ThemeColor('terminal.ansiBlue');
        case 'ssh':
          return new vscode.ThemeColor('terminal.ansiGreen');
        case 'sftp':
          return new vscode.ThemeColor('terminal.ansiCyan');
        case 'ftp':
          return new vscode.ThemeColor('terminal.ansiRed');
        default:
          return undefined;
      }
    };

    // Special icons for database servers
    if (environment === 'db') {
      return new vscode.ThemeIcon('database', getColor());
    }

    // Icons by connection type
    switch (connectionType) {
      case 'rdp':
        return new vscode.ThemeIcon('remote-explorer', getColor());
      case 'ssh':
        return new vscode.ThemeIcon('terminal', getColor());
      case 'sftp':
        return new vscode.ThemeIcon('files', getColor());
      case 'ftp':
        return new vscode.ThemeIcon('cloud-upload', getColor());
      default:
        return new vscode.ThemeIcon('plug', getColor());
    }
  }

  private buildTooltip(host: AnsibleHost, connectionType: ConnectionType): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;
    tooltip.supportHtml = true;

    // Header with display name
    const displayName = host.remote_mgr_display_name || host.comment || host.name;

    // Add environment badge to header
    const envStyle = this.serverEnvironment ? getEnvironmentStyle(this.serverEnvironment) : null;
    if (envStyle?.badge && this.serverEnvironment !== 'unknown') {
      tooltip.appendMarkdown(`### ${envStyle.badge} ${displayName}\n\n`);
      tooltip.appendMarkdown(`**Environment:** ${getEnvironmentDisplayName(this.serverEnvironment!)}\n\n`);
    } else {
      tooltip.appendMarkdown(`### ${displayName}\n\n`);
    }

    // Show warning for production
    if (this.serverEnvironment === 'prod') {
      tooltip.appendMarkdown(`> ⚠️ **PRODUCTION SERVER** - Exercise caution!\n\n`);
    }

    // Show usage stats
    if (this.usageCount && this.usageCount > 0) {
      tooltip.appendMarkdown(`📊 **Used ${this.usageCount} times**\n\n`);
    }
    if (this.isFavorite) {
      tooltip.appendMarkdown(`⭐ **Favorite**\n\n`);
    }

    // Basic info table
    tooltip.appendMarkdown(`| Property | Value |\n`);
    tooltip.appendMarkdown(`|----------|-------|\n`);
    tooltip.appendMarkdown(`| **Hostname** | \`${host.name}\` |\n`);

    if (host.ansible_host) {
      tooltip.appendMarkdown(`| **IP Address** | \`${host.ansible_host}\` |\n`);
    }

    tooltip.appendMarkdown(`| **Type** | ${connectionType.toUpperCase()} |\n`);

    // Port
    const port = host.remote_mgr_port || host.ansible_port;
    if (port) {
      tooltip.appendMarkdown(`| **Port** | ${port} |\n`);
    }

    // Connection details
    if (host.ansible_connection) {
      tooltip.appendMarkdown(`| **Connection** | ${host.ansible_connection} |\n`);
    }

    if (host.ansible_user) {
      tooltip.appendMarkdown(`| **User** | ${host.ansible_user} |\n`);
    }

    // Domain (for RDP/Windows)
    if (host.remote_mgr_domain) {
      tooltip.appendMarkdown(`| **Domain** | ${host.remote_mgr_domain} |\n`);
    }

    // Credential info
    if (host.remote_mgr_credential_id) {
      tooltip.appendMarkdown(`| **Credential** | ${host.remote_mgr_credential_id} |\n`);
    } else {
      tooltip.appendMarkdown(`| **Credential** | *Prompt on connect* |\n`);
    }

    // WinRM specific
    if (host.ansible_winrm_transport) {
      tooltip.appendMarkdown(`| **WinRM Transport** | ${host.ansible_winrm_transport} |\n`);
    }

    // Comment/Note
    if (host.comment) {
      tooltip.appendMarkdown(`\n---\n**Note:** ${host.comment}\n`);
    }

    // Display name if different from hostname
    if (host.remote_mgr_display_name && host.remote_mgr_display_name !== host.name) {
      tooltip.appendMarkdown(`\n**Display Name:** ${host.remote_mgr_display_name}\n`);
    }

    // v0.2.0: Show tags if present
    if (host.remote_mgr_tags && host.remote_mgr_tags.length > 0) {
      const tagBadges = host.remote_mgr_tags.map(tag => `\`${tag}\``).join(' ');
      tooltip.appendMarkdown(`\n**Tags:** ${tagBadges}\n`);
    }

    // v0.2.0: Show SSH key info if present
    if (host.remote_mgr_identity_file) {
      tooltip.appendMarkdown(`\n**SSH Key:** \`${host.remote_mgr_identity_file}\`\n`);
    }

    // v0.2.0: Show jump host if present
    if (host.remote_mgr_proxy_jump) {
      tooltip.appendMarkdown(`\n**Jump Host:** \`${host.remote_mgr_proxy_jump}\`\n`);
    }

    // Additional raw variables (show first 5)
    const rawVars = Object.entries(host.rawVariables || {});
    if (rawVars.length > 0) {
      tooltip.appendMarkdown(`\n---\n**Additional Variables:**\n`);
      const varsToShow = rawVars.slice(0, 5);
      for (const [key, value] of varsToShow) {
        const displayValue = value.length > 30 ? value.substring(0, 30) + '...' : value;
        tooltip.appendMarkdown(`- \`${key}\`: ${displayValue}\n`);
      }
      if (rawVars.length > 5) {
        tooltip.appendMarkdown(`- *...and ${rawVars.length - 5} more*\n`);
      }
    }

    return tooltip;
  }
}

/**
 * Tree data provider for the connection tree view
 */
export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ConnectionTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ConnectionTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ConnectionTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private searchFilter: string = '';
  private tagFilter: string[] = [];
  private usageService?: UsageTrackingService;

  constructor(private inventoryManager: InventoryManager) {}

  /**
   * Set the usage tracking service
   */
  setUsageTrackingService(service: UsageTrackingService): void {
    this.usageService = service;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Set a search filter
   */
  setSearchFilter(filter: string): void {
    this.searchFilter = filter.toLowerCase().trim();
    this.refresh();
  }

  /**
   * Clear the search filter
   */
  clearSearchFilter(): void {
    this.searchFilter = '';
    this.refresh();
  }

  /**
   * Get the current search filter
   */
  getSearchFilter(): string {
    return this.searchFilter;
  }

  /**
   * Set a tag filter (shows only hosts with matching tags)
   */
  setTagFilter(tags: string[]): void {
    this.tagFilter = tags.map(t => t.toLowerCase().trim());
    this.refresh();
  }

  /**
   * Clear the tag filter
   */
  clearTagFilter(): void {
    this.tagFilter = [];
    this.refresh();
  }

  /**
   * Get the current tag filter
   */
  getTagFilter(): string[] {
    return this.tagFilter;
  }

  /**
   * Get all unique tags from all hosts in all inventories
   */
  getAllTags(): string[] {
    const tagSet = new Set<string>();
    const sources = this.inventoryManager.getSources();

    for (const source of sources) {
      if (!source.inventory) {continue;}

      // Check ungrouped hosts
      for (const host of source.inventory.ungroupedHosts) {
        if (host.remote_mgr_tags) {
          host.remote_mgr_tags.forEach(tag => tagSet.add(tag));
        }
      }

      // Check grouped hosts
      for (const group of source.inventory.groups) {
        for (const host of group.hosts) {
          if (host.remote_mgr_tags) {
            host.remote_mgr_tags.forEach(tag => tagSet.add(tag));
          }
        }
      }
    }

    return Array.from(tagSet).sort();
  }

  /**
   * Get all hosts in a group by group name
   */
  getHostsInGroup(groupName: string): AnsibleHost[] {
    const hosts: AnsibleHost[] = [];
    const sources = this.inventoryManager.getSources();

    for (const source of sources) {
      if (!source.inventory) {continue;}

      for (const group of source.inventory.groups) {
        if (group.name === groupName) {
          hosts.push(...group.hosts);
        }
      }
    }

    return hosts;
  }

  /**
   * Check if a host matches the search filter and tag filter
   */
  private hostMatchesFilter(host: AnsibleHost): boolean {
    // Check tag filter first
    if (this.tagFilter.length > 0) {
      const hostTags = (host.remote_mgr_tags || []).map(t => t.toLowerCase());
      const hasMatchingTag = this.tagFilter.some(filterTag => hostTags.includes(filterTag));
      if (!hasMatchingTag) {
        return false;
      }
    }

    // Check search filter
    if (!this.searchFilter) {
      return true;
    }

    const searchTerms = [
      host.name,
      host.ansible_host,
      host.remote_mgr_display_name,
      host.comment,
      host.ansible_user,
      host.remote_mgr_domain,
      // v0.2.0: Include tags in search
      ...(host.remote_mgr_tags || []),
    ].filter(Boolean).map(s => s!.toLowerCase());

    return searchTerms.some(term => term.includes(this.searchFilter));
  }

  /**
   * Check if a group has any matching hosts (including nested)
   */
  private groupHasMatchingHosts(group: AnsibleGroup, source: InventorySource): boolean {
    // Check direct hosts
    if (group.hosts.some(h => this.hostMatchesFilter(h))) {
      return true;
    }

    // Check child groups
    for (const childName of group.children) {
      const childGroup = source.inventory?.groups.find(g => g.name === childName);
      if (childGroup && this.groupHasMatchingHosts(childGroup, source)) {
        return true;
      }
    }

    return false;
  }

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConnectionTreeItem): ConnectionTreeItem[] {
    if (!element) {
      // Root level: show "Most Connected" section first, then inventory sources
      return this.getRootItems();
    }

    switch (element.itemType) {
      case 'inventory':
        return this.getInventoryChildren(element.data as InventorySource);
      case 'group':
        return this.getGroupChildren(
          element.data as AnsibleGroup,
          element.inventorySource!
        );
      case 'favorites':
        return this.getMostConnectedChildren();
      default:
        return [];
    }
  }

  /**
   * Get root items: Most Connected section + inventory sources
   */
  private getRootItems(): ConnectionTreeItem[] {
    const items: ConnectionTreeItem[] = [];

    // Add "Most Connected" section if we have usage data
    if (this.usageService) {
      const topUsed = this.usageService.getTopUsedHosts(10);
      if (topUsed.length > 0) {
        const mostConnectedItem = new ConnectionTreeItem(
          '⚡ Most Connected',
          vscode.TreeItemCollapsibleState.Expanded, // Always expanded
          'favorites'
        );
        mostConnectedItem.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('terminal.ansiYellow'));
        mostConnectedItem.description = `${topUsed.length} servers`;
        items.push(mostConnectedItem);
      }
    }

    // Add inventory sources
    items.push(...this.getInventorySources());

    return items;
  }

  /**
   * Get children for the "Most Connected" section
   */
  private getMostConnectedChildren(): ConnectionTreeItem[] {
    if (!this.usageService) {
      return [];
    }

    const topUsed = this.usageService.getTopUsedHosts(10);
    const items: ConnectionTreeItem[] = [];

    // Find the actual hosts from inventory
    const sources = this.inventoryManager.getSources();

    for (const usage of topUsed) {
      // Parse the key to get hostname and IP
      const [hostname, ip] = usage.key.split('::');

      // Find the host in inventory
      let foundHost: AnsibleHost | undefined;
      let foundSource: InventorySource | undefined;
      let foundGroupName: string | undefined;

      for (const source of sources) {
        if (!source.inventory) {continue;}

        // Check ungrouped hosts
        for (const host of source.inventory.ungroupedHosts) {
          if (host.name === hostname || host.ansible_host === ip) {
            foundHost = host;
            foundSource = source;
            foundGroupName = 'ungrouped';
            break;
          }
        }

        if (foundHost) {break;}

        // Check grouped hosts
        for (const group of source.inventory.groups) {
          for (const host of group.hosts) {
            if (host.name === hostname || host.ansible_host === ip) {
              foundHost = host;
              foundSource = source;
              foundGroupName = group.name;
              break;
            }
          }
          if (foundHost) {break;}
        }

        if (foundHost) {break;}
      }

      if (foundHost && foundSource) {
        const item = new ConnectionTreeItem(
          getDisplayLabel(foundHost),
          vscode.TreeItemCollapsibleState.None,
          'connection',
          foundHost,
          foundSource,
          foundGroupName
        );

        item.usageCount = usage.count;
        item.isFavorite = this.usageService.isFavorite(hostname, ip);

        items.push(item);
      }
    }

    return items;
  }

  private getInventorySources(): ConnectionTreeItem[] {
    const sources = this.inventoryManager.getSources();

    if (sources.length === 0) {
      // Show a placeholder item when no inventory files are configured
      const placeholderItem = new ConnectionTreeItem(
        'No inventory files configured',
        vscode.TreeItemCollapsibleState.None,
        'inventory'
      );
      placeholderItem.description = 'Add files in settings';
      placeholderItem.iconPath = new vscode.ThemeIcon('info');
      placeholderItem.command = {
        command: 'remoteServerManager.openSettings',
        title: 'Open Settings',
      };
      return [placeholderItem];
    }

    return sources.map((source) => {
      const hasContent = source.inventory &&
        (source.inventory.groups.length > 0 || source.inventory.ungroupedHosts.length > 0);

      return new ConnectionTreeItem(
        source.name,
        hasContent ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
        'inventory',
        source,
        source
      );
    });
  }

  private getInventoryChildren(source: InventorySource): ConnectionTreeItem[] {
    if (!source.inventory) {
      return [];
    }

    const items: ConnectionTreeItem[] = [];
    const config = vscode.workspace.getConfiguration('remoteServerManager');
    const showUngrouped = config.get<boolean>('showUngroupedConnections', true);

    // Add groups (only if they have matching hosts when filtering)
    for (const group of source.inventory.groups) {
      // Skip groups that are children of other groups (they'll be shown nested)
      const isChildGroup = source.inventory.groups.some(g => g.children.includes(group.name));
      if (!isChildGroup) {
        // When filtering, only show groups with matching hosts
        if (!this.searchFilter || this.groupHasMatchingHosts(group, source)) {
          items.push(this.createGroupItem(group, source));
        }
      }
    }

    // Add ungrouped hosts
    if (showUngrouped && source.inventory.ungroupedHosts.length > 0) {
      const filteredUngrouped = this.searchFilter
        ? source.inventory.ungroupedHosts.filter(h => this.hostMatchesFilter(h))
        : source.inventory.ungroupedHosts;

      if (filteredUngrouped.length > 0) {
        const ungroupedGroup: AnsibleGroup = {
          name: 'ungrouped',
          hosts: filteredUngrouped,
          children: [],
          vars: {},
          comments: [],
        };
        items.push(this.createGroupItem(ungroupedGroup, source));
      }
    }

    // Show "no results" message when filtering returns nothing
    if (this.searchFilter && items.length === 0) {
      const noResultsItem = new ConnectionTreeItem(
        `No matches for "${this.searchFilter}"`,
        vscode.TreeItemCollapsibleState.None,
        'inventory'
      );
      noResultsItem.iconPath = new vscode.ThemeIcon('info');
      return [noResultsItem];
    }

    return items;
  }

  private createGroupItem(group: AnsibleGroup, source: InventorySource): ConnectionTreeItem {
    // When filtering, check if group has matching content
    const hasDirectMatches = group.hosts.some(h => this.hostMatchesFilter(h));
    const hasChildMatches = group.children.length > 0 && this.groupHasMatchingHosts(group, source);
    const hasContent = group.hosts.length > 0 || group.children.length > 0;

    // Expand groups when filtering to show results
    const shouldExpand = this.searchFilter && (hasDirectMatches || hasChildMatches);

    return new ConnectionTreeItem(
      displayGroupName(group.name),
      hasContent
        ? (shouldExpand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None,
      'group',
      group,
      source
    );
  }

  private getGroupChildren(
    group: AnsibleGroup,
    source: InventorySource
  ): ConnectionTreeItem[] {
    const items: ConnectionTreeItem[] = [];

    // Add child groups (only if they have matching hosts when filtering)
    if (source.inventory) {
      for (const childName of group.children) {
        const childGroup = source.inventory.groups.find((g) => g.name === childName);
        if (childGroup) {
          if (!this.searchFilter || this.groupHasMatchingHosts(childGroup, source)) {
            items.push(this.createGroupItem(childGroup, source));
          }
        }
      }
    }

    // Add hosts (filtered when searching)
    const hostsToShow = this.searchFilter
      ? group.hosts.filter(h => this.hostMatchesFilter(h))
      : group.hosts;

    // Create connection items with usage info
    const connectionItems: ConnectionTreeItem[] = [];
    for (const host of hostsToShow) {
      const item = new ConnectionTreeItem(
        getDisplayLabel(host),
        vscode.TreeItemCollapsibleState.None,
        'connection',
        host,
        source,
        group.name  // Pass group name for environment detection
      );

      // Add usage info if service is available
      if (this.usageService) {
        item.usageCount = this.usageService.getConnectionCount(host.name, host.ansible_host);
        item.isFavorite = this.usageService.isFavorite(host.name, host.ansible_host);
      }

      connectionItems.push(item);
    }

    // Sort connection items: favorites first, then by usage count
    connectionItems.sort((a, b) => {
      // Favorites always first
      if (a.isFavorite && !b.isFavorite) {return -1;}
      if (!a.isFavorite && b.isFavorite) {return 1;}

      // Then by usage count
      const aCount = a.usageCount || 0;
      const bCount = b.usageCount || 0;
      if (bCount !== aCount) {return bCount - aCount;}

      // Finally alphabetically
      return a.label.toString().localeCompare(b.label.toString());
    });

    items.push(...connectionItems);
    return items;
  }

  /**
   * Create a connection tree item with all metadata
   */
  createConnectionItem(
    host: AnsibleHost,
    source: InventorySource,
    groupName?: string
  ): ConnectionTreeItem {
    const item = new ConnectionTreeItem(
      getDisplayLabel(host),
      vscode.TreeItemCollapsibleState.None,
      'connection',
      host,
      source,
      groupName
    );

    if (this.usageService) {
      item.usageCount = this.usageService.getConnectionCount(host.name, host.ansible_host);
      item.isFavorite = this.usageService.isFavorite(host.name, host.ansible_host);
    }

    return item;
  }
}

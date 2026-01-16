/**
 * Port Forwarding Tree Provider
 * Tree view for managing active SSH tunnels
 * v0.3.0
 */

import * as vscode from 'vscode';
import {
  PortForward,
  getTunnelDescription,
  getTunnelTypeName,
} from '../models/PortForward';
import { PortForwardingService } from '../services/PortForwardingService';

/**
 * Tree item for port forwarding view
 */
export class PortForwardingTreeItem extends vscode.TreeItem {
  constructor(
    public readonly tunnel: PortForward,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(tunnel.name, collapsibleState);
    this.contextValue = 'tunnel';
    this.setupItem();
  }

  private setupItem(): void {
    // Icon based on status
    const { icon, color } = this.getStatusIcon();
    this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));

    // Description shows the tunnel mapping
    this.description = getTunnelDescription(this.tunnel);

    // Tooltip with details
    this.tooltip = this.buildTooltip();

    // Command to view details
    this.command = {
      command: 'remoteServerManager.viewTunnelDetails',
      title: 'View Details',
      arguments: [this.tunnel],
    };
  }

  private getStatusIcon(): { icon: string; color: string } {
    switch (this.tunnel.status) {
      case 'active':
        return { icon: 'play-circle', color: 'terminal.ansiGreen' };
      case 'connecting':
        return { icon: 'sync~spin', color: 'terminal.ansiYellow' };
      case 'error':
        return { icon: 'error', color: 'terminal.ansiRed' };
      case 'stopped':
      default:
        return { icon: 'stop-circle', color: 'terminal.ansiWhite' };
    }
  }

  private buildTooltip(): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;

    tooltip.appendMarkdown(`### ${this.tunnel.name}\n\n`);
    tooltip.appendMarkdown(`**Type:** ${getTunnelTypeName(this.tunnel.type)}\n\n`);
    tooltip.appendMarkdown(`**Status:** ${this.tunnel.status}\n\n`);

    // Tunnel details
    tooltip.appendMarkdown(`**SSH Host:** \`${this.tunnel.sshHost}\`\n\n`);

    if (this.tunnel.sshUser) {
      tooltip.appendMarkdown(`**SSH User:** ${this.tunnel.sshUser}\n\n`);
    }

    if (this.tunnel.sshPort && this.tunnel.sshPort !== 22) {
      tooltip.appendMarkdown(`**SSH Port:** ${this.tunnel.sshPort}\n\n`);
    }

    // Forward details
    tooltip.appendMarkdown(`---\n\n`);
    tooltip.appendMarkdown(`**Local Port:** ${this.tunnel.localPort}\n\n`);

    if (this.tunnel.type === 'local') {
      tooltip.appendMarkdown(`**Remote:** ${this.tunnel.remoteHost}:${this.tunnel.remotePort}\n\n`);
    } else if (this.tunnel.type === 'remote') {
      tooltip.appendMarkdown(`**Remote Port:** ${this.tunnel.remotePort}\n\n`);
    }

    // Connection string
    if (this.tunnel.type === 'local' || this.tunnel.type === 'dynamic') {
      tooltip.appendMarkdown(`---\n\n`);
      tooltip.appendMarkdown(`**Connect to:** \`localhost:${this.tunnel.localPort}\`\n\n`);
    }

    // Error message
    if (this.tunnel.errorMessage) {
      tooltip.appendMarkdown(`---\n\n`);
      tooltip.appendMarkdown(`> ⚠️ **Error:** ${this.tunnel.errorMessage}\n\n`);
    }

    // Started time
    if (this.tunnel.startedAt) {
      const runtime = this.formatRuntime(this.tunnel.startedAt);
      tooltip.appendMarkdown(`**Running:** ${runtime}\n\n`);
    }

    // Associated host
    if (this.tunnel.hostDisplayName) {
      tooltip.appendMarkdown(`**Host:** ${this.tunnel.hostDisplayName}\n\n`);
    }

    return tooltip;
  }

  private formatRuntime(startedAt: Date): string {
    const seconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);

    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
}

/**
 * Group item for organizing tunnels by host
 */
export class PortForwardingGroupItem extends vscode.TreeItem {
  constructor(
    public readonly hostName: string,
    public readonly displayName: string,
    public readonly tunnelCount: number
  ) {
    super(displayName, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'tunnelGroup';
    this.description = `${tunnelCount} tunnel${tunnelCount !== 1 ? 's' : ''}`;
    this.iconPath = new vscode.ThemeIcon('server', new vscode.ThemeColor('terminal.ansiBrightBlue'));
  }
}

/**
 * Tree data provider for port forwarding view
 */
export class PortForwardingTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private portForwardingService: PortForwardingService;

  constructor(portForwardingService: PortForwardingService) {
    this.portForwardingService = portForwardingService;

    // Refresh tree when tunnels change
    this.portForwardingService.onTunnelsChanged(() => {
      this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // Root level: group by host or show all
      return this.getRootItems();
    }

    if (element instanceof PortForwardingGroupItem) {
      // Show tunnels for this host
      return this.getTunnelsForHost(element.hostName);
    }

    return [];
  }

  private getRootItems(): vscode.TreeItem[] {
    const tunnels = this.portForwardingService.getActiveTunnels();

    if (tunnels.length === 0) {
      const emptyItem = new vscode.TreeItem('No active tunnels');
      emptyItem.iconPath = new vscode.ThemeIcon('info');
      emptyItem.description = 'Right-click a connection to create a tunnel';
      return [emptyItem];
    }

    // Group tunnels by host
    const hostGroups = new Map<string, PortForward[]>();

    for (const tunnel of tunnels) {
      const hostKey = tunnel.hostName || 'ungrouped';
      if (!hostGroups.has(hostKey)) {
        hostGroups.set(hostKey, []);
      }
      hostGroups.get(hostKey)!.push(tunnel);
    }

    // If only one host or no grouping needed, show tunnels directly
    if (hostGroups.size === 1 || !tunnels.some(t => t.hostName)) {
      return tunnels.map(t => new PortForwardingTreeItem(t, vscode.TreeItemCollapsibleState.None));
    }

    // Create group items
    const items: vscode.TreeItem[] = [];
    for (const [hostName, hostTunnels] of hostGroups) {
      const displayName = hostTunnels[0].hostDisplayName || hostName;
      items.push(new PortForwardingGroupItem(hostName, displayName, hostTunnels.length));
    }

    return items;
  }

  private getTunnelsForHost(hostName: string): vscode.TreeItem[] {
    const tunnels = this.portForwardingService.getTunnelsForHost(hostName);
    return tunnels.map(t => new PortForwardingTreeItem(t, vscode.TreeItemCollapsibleState.None));
  }
}

import * as vscode from 'vscode';
import {
  ConnectionTreeProvider,
  ConnectionTreeItem,
} from './providers/ConnectionTreeProvider';
import { CredentialService } from './services/CredentialService';
import { ConnectionService } from './services/ConnectionService';
import { InventoryManager } from './services/InventoryManager';
import { QuickConnectService } from './services/QuickConnectService';
import { ImportService } from './services/ImportService';
import { UsageTrackingService } from './services/UsageTrackingService';
import { PortForwardingService } from './services/PortForwardingService';
import { PortForwardingTreeProvider, PortForwardingTreeItem } from './providers/PortForwardingTreeProvider';
import type { AnsibleHost } from './models/Connection';
import type { PortForward } from './models/PortForward';
import { AwsEc2Config, GcpComputeConfig } from './models/CloudSource';
import {
  requiresConnectionConfirmation,
  getEnvironmentWarning,
} from './utils/serverEnvironment';
import { logger } from './utils/Logger';

let credentialService: CredentialService;
let connectionService: ConnectionService;
let inventoryManager: InventoryManager;
let treeProvider: ConnectionTreeProvider;
let usageTrackingService: UsageTrackingService;
let portForwardingService: PortForwardingService;
let portForwardingTreeProvider: PortForwardingTreeProvider;

export function activate(context: vscode.ExtensionContext): void {
  // Initialize logger first
  const outputChannel = logger.initialize();
  context.subscriptions.push(outputChannel);

  logger.info('Remote Server Manager is now active');

  // Initialize services
  credentialService = new CredentialService(context.secrets);
  inventoryManager = new InventoryManager();
  inventoryManager.initializeCloudProviders(context.secrets);
  connectionService = new ConnectionService(inventoryManager, credentialService);
  usageTrackingService = new UsageTrackingService(context.globalState);
  portForwardingService = new PortForwardingService();
  const quickConnectService = new QuickConnectService(connectionService, credentialService);
  const importService = new ImportService(inventoryManager, credentialService);

  // Initialize tree views
  treeProvider = new ConnectionTreeProvider(inventoryManager);
  treeProvider.setUsageTrackingService(usageTrackingService);
  portForwardingTreeProvider = new PortForwardingTreeProvider(portForwardingService);

  const treeView = vscode.window.createTreeView('remoteServerManager', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const portForwardingTreeView = vscode.window.createTreeView('remoteServerManager.portForwarding', {
    treeDataProvider: portForwardingTreeProvider,
    showCollapseAll: true,
  });

  // Register commands
  context.subscriptions.push(
    treeView,
    portForwardingTreeView,
    portForwardingService,

    // Refresh
    vscode.commands.registerCommand('remoteServerManager.refresh', () => {
      treeProvider.refresh();
    }),

    // Search
    vscode.commands.registerCommand('remoteServerManager.search', async () => {
      const currentFilter = treeProvider.getSearchFilter();
      const searchTerm = await vscode.window.showInputBox({
        prompt: 'Search connections by name, IP, or display name',
        placeHolder: 'Enter search term...',
        value: currentFilter,
      });

      if (searchTerm !== undefined) {
        treeProvider.setSearchFilter(searchTerm);
        if (searchTerm) {
          void vscode.window.showInformationMessage(`Filtering: "${searchTerm}"`);
        }
      }
    }),

    // Clear Search
    vscode.commands.registerCommand('remoteServerManager.clearSearch', () => {
      treeProvider.clearSearchFilter();
      void vscode.window.showInformationMessage('Search filter cleared');
    }),

    // Filter by Tags (v0.2.0)
    vscode.commands.registerCommand('remoteServerManager.filterByTags', async () => {
      const allTags = treeProvider.getAllTags();

      if (allTags.length === 0) {
        void vscode.window.showInformationMessage('No tags found. Add tags to connections using remote_mgr_tags in your inventory.');
        return;
      }

      const currentFilter = treeProvider.getTagFilter();
      const items = allTags.map(tag => ({
        label: tag,
        picked: currentFilter.includes(tag.toLowerCase()),
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select tags to filter by',
        canPickMany: true,
      });

      if (selected !== undefined) {
        const selectedTags = selected.map(item => item.label);
        treeProvider.setTagFilter(selectedTags);
        if (selectedTags.length > 0) {
          void vscode.window.showInformationMessage(`Filtering by tags: ${selectedTags.join(', ')}`);
        } else {
          void vscode.window.showInformationMessage('Tag filter cleared');
        }
      }
    }),

    // Clear Tag Filter (v0.2.0)
    vscode.commands.registerCommand('remoteServerManager.clearTagFilter', () => {
      treeProvider.clearTagFilter();
      void vscode.window.showInformationMessage('Tag filter cleared');
    }),

    // Connect commands
    vscode.commands.registerCommand(
      'remoteServerManager.connect',
      async (item: ConnectionTreeItem) => {
        // Check if production server needs confirmation
        if (item.serverEnvironment && requiresConnectionConfirmation(item.serverEnvironment)) {
          const warning = getEnvironmentWarning(item.serverEnvironment);
          const result = await vscode.window.showWarningMessage(
            warning || '⚠️ You are connecting to a PRODUCTION server!',
            { modal: true },
            'Connect Anyway',
            'Cancel'
          );

          if (result !== 'Connect Anyway') {
            return;
          }
        }

        // Track usage
        const host = item.data as AnsibleHost;
        if (host) {
          await usageTrackingService.recordConnection(host.name, host.ansible_host);
        }

        await connectionService.connect(item);

        // Refresh tree to update usage counts
        treeProvider.refresh();
      }
    ),

    vscode.commands.registerCommand(
      'remoteServerManager.connectSsh',
      async (item: ConnectionTreeItem) => {
        await connectionService.connectSsh(item);
      }
    ),

    vscode.commands.registerCommand(
      'remoteServerManager.connectSftp',
      async (item: ConnectionTreeItem) => {
        await connectionService.connectSftp(item);
      }
    ),

    vscode.commands.registerCommand(
      'remoteServerManager.connectUsingFqdn',
      async (item: ConnectionTreeItem) => {
        await connectionService.connectUsingFqdn(item);
      }
    ),

    vscode.commands.registerCommand(
      'remoteServerManager.connectUsingIp',
      async (item: ConnectionTreeItem) => {
        await connectionService.connectUsingIp(item);
      }
    ),

    // CRUD commands
    vscode.commands.registerCommand('remoteServerManager.addConnection', async () => {
      await connectionService.addConnection();
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand(
      'remoteServerManager.editConnection',
      async (item: ConnectionTreeItem) => {
        await connectionService.editConnection(item);
        treeProvider.refresh();
      }
    ),

    vscode.commands.registerCommand(
      'remoteServerManager.deleteConnection',
      async (item: ConnectionTreeItem) => {
        await connectionService.deleteConnection(item);
        treeProvider.refresh();
      }
    ),

    // Toggle favorite
    vscode.commands.registerCommand(
      'remoteServerManager.toggleFavorite',
      async (item: ConnectionTreeItem) => {
        const host = item.data as AnsibleHost;
        if (host) {
          const isFavorite = await usageTrackingService.toggleFavorite(host.name, host.ansible_host);
          void vscode.window.showInformationMessage(
            isFavorite ? `⭐ Added to favorites: ${host.name}` : `Removed from favorites: ${host.name}`
          );
          treeProvider.refresh();
        }
      }
    ),

    // Copy commands
    vscode.commands.registerCommand(
      'remoteServerManager.copyHostname',
      async (item: ConnectionTreeItem) => {
        await connectionService.copyHostname(item);
      }
    ),

    vscode.commands.registerCommand(
      'remoteServerManager.copyIpAddress',
      async (item: ConnectionTreeItem) => {
        await connectionService.copyIpAddress(item);
      }
    ),

    vscode.commands.registerCommand(
      'remoteServerManager.copyDisplayName',
      async (item: ConnectionTreeItem) => {
        await connectionService.copyDisplayName(item);
      }
    ),

    vscode.commands.registerCommand(
      'remoteServerManager.copyConnectionInfo',
      async (item: ConnectionTreeItem) => {
        await connectionService.copyConnectionInfo(item);
      }
    ),

    vscode.commands.registerCommand(
      'remoteServerManager.copyAsJson',
      async (item: ConnectionTreeItem) => {
        await connectionService.copyAsJson(item);
      }
    ),

    // Quick Connect
    vscode.commands.registerCommand('remoteServerManager.quickConnect', async () => {
      await quickConnectService.quickConnect();
    }),

    // Import/Export
    vscode.commands.registerCommand('remoteServerManager.importJson', async () => {
      await importService.importFromJson();
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('remoteServerManager.importAnsible', async () => {
      await importService.importFromAnsible();
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('remoteServerManager.importSshConfig', async () => {
      await importService.importFromSshConfig();
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('remoteServerManager.exportJson', async () => {
      await importService.exportToJson();
    }),

    vscode.commands.registerCommand('remoteServerManager.exportAnsible', async () => {
      await importService.exportToAnsible();
    }),

    // Settings
    vscode.commands.registerCommand('remoteServerManager.openSettings', () => {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'remoteServerManager.inventoryFiles'
      );
    }),

    // Add inventory file
    vscode.commands.registerCommand('remoteServerManager.addInventoryFile', async () => {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: 'Select Ansible Inventory File',
        filters: {
          'All Files': ['*'],
        },
      });

      if (result && result.length > 0) {
        const filePath = result[0].fsPath;
        await inventoryManager.addSource(filePath, false);
        treeProvider.refresh();
        void vscode.window.showInformationMessage(`Added inventory file: ${filePath}`);
      }
    }),

    // Credential management - simplified view/delete only
    vscode.commands.registerCommand('remoteServerManager.manageCredentials', async () => {
      const credentials = await credentialService.listCredentials();

      if (credentials.length === 0) {
        void vscode.window.showInformationMessage(
          'No saved credentials. Credentials are saved automatically when you connect to servers.'
        );
        return;
      }

      const items = credentials.map(c => ({
        label: `$(key) ${c.username}${c.domain ? ` (${c.domain})` : ''}`,
        description: `${c.category?.toUpperCase() || 'SSH'} - ${c.name}`,
        detail: `ID: ${c.id} | Strategy: ${c.strategy} | Password: ${c.password ? 'YES ✓' : 'NO ✗'}`,
        credential: c,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a credential to manage',
      });

      if (!selected) {
        return;
      }

      const action = await vscode.window.showQuickPick(
        [
          { label: '$(info) View Details', action: 'view' },
          { label: '$(trash) Delete', action: 'delete' },
          { label: '$(x) Cancel', action: 'cancel' },
        ],
        { placeHolder: `Manage "${selected.credential.username}"` }
      );

      if (action?.action === 'view') {
        const c = selected.credential;
        void vscode.window.showInformationMessage(
          `Credential Details:\n` +
          `ID: ${c.id}\n` +
          `Username: ${c.username}\n` +
          `Domain: ${c.domain || 'none'}\n` +
          `Category: ${c.category}\n` +
          `Strategy: ${c.strategy}\n` +
          `Has Password: ${c.password ? 'YES' : 'NO'}`
        );
      } else if (action?.action === 'delete') {
        await credentialService.deleteCredential(selected.credential.id);
        void vscode.window.showInformationMessage('Credential deleted');
      }
    }),

    // AWS EC2 Source (v0.3.0)
    vscode.commands.registerCommand('remoteServerManager.addAwsEc2Source', async () => {
      const awsCredentialProvider = inventoryManager.getAwsCredentialProvider();
      if (!awsCredentialProvider) {
        void vscode.window.showErrorMessage('AWS credential provider not initialized');
        return;
      }

      // Select profile
      const profileName = await awsCredentialProvider.promptForProfile();
      if (!profileName) {
        return;
      }

      // Handle manual credentials
      if (profileName === '__manual__') {
        const credentials = await awsCredentialProvider.promptForCredentials();
        if (!credentials) {
          return;
        }
        await awsCredentialProvider.storeCredentials(credentials);
      }

      // Select regions
      const regions = await awsCredentialProvider.promptForRegions(true);
      if (!regions || regions.length === 0) {
        return;
      }

      // Get source name
      const sourceName = await vscode.window.showInputBox({
        prompt: 'Enter a name for this AWS EC2 source',
        value: `AWS EC2 (${regions.join(', ')})`,
      });

      if (!sourceName) {
        return;
      }

      // Get settings
      const config = vscode.workspace.getConfiguration('remoteServerManager');
      const instanceStateFilter = config.get<string[]>('aws.instanceStateFilter', ['running']);

      const awsConfig: AwsEc2Config = {
        type: 'aws-ec2',
        region: regions[0],
        regions,
        instanceStateFilter,
      };

      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Discovering AWS EC2 instances...',
          cancellable: false,
        }, async () => {
          await inventoryManager.addAwsEc2Source(sourceName, awsConfig, profileName === '__manual__' ? undefined : profileName);
        });
        treeProvider.refresh();
        void vscode.window.showInformationMessage(`Added AWS EC2 source: ${sourceName}`);
      } catch (error) {
        void vscode.window.showErrorMessage(`Failed to add AWS EC2 source: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),

    // GCP Compute Source (v0.3.0)
    vscode.commands.registerCommand('remoteServerManager.addGcpComputeSource', async () => {
      const gcpCredentialProvider = inventoryManager.getGcpCredentialProvider();
      if (!gcpCredentialProvider) {
        void vscode.window.showErrorMessage('GCP credential provider not initialized');
        return;
      }

      // Select authentication method
      const authMethod = await gcpCredentialProvider.promptForAuthMethod();
      if (!authMethod) {
        return;
      }

      let keyFilePath: string | undefined;
      if (authMethod === 'service-account') {
        keyFilePath = await gcpCredentialProvider.promptForKeyFile();
        if (!keyFilePath) {
          return;
        }
      }

      // Select project
      const projectId = await gcpCredentialProvider.promptForProject();
      if (!projectId) {
        return;
      }

      // Get source name
      const sourceName = await vscode.window.showInputBox({
        prompt: 'Enter a name for this GCP Compute source',
        value: `GCP Compute (${projectId})`,
      });

      if (!sourceName) {
        return;
      }

      // Get settings
      const config = vscode.workspace.getConfiguration('remoteServerManager');
      const statusFilter = config.get<string[]>('gcp.statusFilter', ['RUNNING']);

      const gcpConfig: GcpComputeConfig = {
        type: 'gcp-compute',
        projectId,
        useApplicationDefaultCredentials: authMethod === 'adc',
        keyFilePath,
        statusFilter,
      };

      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Discovering GCP Compute instances...',
          cancellable: false,
        }, async () => {
          await inventoryManager.addGcpComputeSource(sourceName, gcpConfig);
        });
        treeProvider.refresh();
        void vscode.window.showInformationMessage(`Added GCP Compute source: ${sourceName}`);
      } catch (error) {
        void vscode.window.showErrorMessage(`Failed to add GCP Compute source: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),

    // Refresh cloud sources (v0.3.0)
    vscode.commands.registerCommand('remoteServerManager.refreshCloudSources', async () => {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Refreshing cloud sources...',
        cancellable: false,
      }, async () => {
        await inventoryManager.refresh();
      });
      treeProvider.refresh();
      void vscode.window.showInformationMessage('Cloud sources refreshed');
    }),

    // Remove cloud source (v0.3.0)
    vscode.commands.registerCommand('remoteServerManager.removeCloudSource', async (item: ConnectionTreeItem) => {
      if (item.sourceId) {
        const confirm = await vscode.window.showWarningMessage(
          `Remove cloud source "${item.label}"?`,
          { modal: true },
          'Remove'
        );
        if (confirm === 'Remove') {
          await inventoryManager.removeSourceById(item.sourceId);
          treeProvider.refresh();
          void vscode.window.showInformationMessage('Cloud source removed');
        }
      }
    }),

    // Port forwarding commands (v0.3.0)
    vscode.commands.registerCommand('remoteServerManager.createLocalForward', async (item: ConnectionTreeItem) => {
      const host = item.data as AnsibleHost;
      if (!host) {
        return;
      }

      const config = await portForwardingService.promptLocalForward(host);
      if (!config) {
        return;
      }

      try {
        const tunnel = await portForwardingService.createLocalForward(config);
        void vscode.window.showInformationMessage(
          `Tunnel created: localhost:${tunnel.localPort} → ${tunnel.remoteHost}:${tunnel.remotePort}`
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Failed to create tunnel: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }),

    vscode.commands.registerCommand('remoteServerManager.createDynamicForward', async (item: ConnectionTreeItem) => {
      const host = item.data as AnsibleHost;
      if (!host) {
        return;
      }

      const config = await portForwardingService.promptDynamicForward(host);
      if (!config) {
        return;
      }

      try {
        const tunnel = await portForwardingService.createDynamicForward(config);
        void vscode.window.showInformationMessage(
          `SOCKS proxy created on localhost:${tunnel.localPort}`
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Failed to create SOCKS proxy: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }),

    vscode.commands.registerCommand('remoteServerManager.stopTunnel', async (item: PortForwardingTreeItem) => {
      if (item.tunnel) {
        await portForwardingService.stopTunnel(item.tunnel.id);
        void vscode.window.showInformationMessage(`Tunnel "${item.tunnel.name}" stopped`);
      }
    }),

    vscode.commands.registerCommand('remoteServerManager.stopAllTunnels', async () => {
      const count = portForwardingService.getActiveTunnelCount();
      if (count === 0) {
        void vscode.window.showInformationMessage('No active tunnels');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Stop all ${count} active tunnel${count !== 1 ? 's' : ''}?`,
        { modal: true },
        'Stop All'
      );

      if (confirm === 'Stop All') {
        await portForwardingService.stopAllTunnels();
        void vscode.window.showInformationMessage('All tunnels stopped');
      }
    }),

    vscode.commands.registerCommand('remoteServerManager.restartTunnel', async (item: PortForwardingTreeItem) => {
      if (item.tunnel) {
        const tunnel = await portForwardingService.restartTunnel(item.tunnel.id);
        if (tunnel) {
          void vscode.window.showInformationMessage(`Tunnel "${tunnel.name}" restarted`);
        }
      }
    }),

    vscode.commands.registerCommand('remoteServerManager.showActiveTunnels', () => {
      const tunnels = portForwardingService.getActiveTunnels();
      if (tunnels.length === 0) {
        void vscode.window.showInformationMessage('No active tunnels');
        return;
      }

      const items = tunnels.map(t => ({
        label: t.name,
        description: `${t.status} - localhost:${t.localPort}`,
        detail: t.type === 'local' ? `→ ${t.remoteHost}:${t.remotePort}` : t.type,
        tunnel: t,
      }));

      void vscode.window.showQuickPick(items, {
        placeHolder: `${tunnels.length} active tunnel${tunnels.length !== 1 ? 's' : ''}`,
      });
    }),

    vscode.commands.registerCommand('remoteServerManager.viewTunnelDetails', (tunnel: PortForward) => {
      const details = [
        `Name: ${tunnel.name}`,
        `Type: ${tunnel.type}`,
        `Status: ${tunnel.status}`,
        `SSH Host: ${tunnel.sshHost}`,
        `Local Port: ${tunnel.localPort}`,
      ];

      if (tunnel.type === 'local' || tunnel.type === 'remote') {
        details.push(`Remote: ${tunnel.remoteHost}:${tunnel.remotePort}`);
      }

      if (tunnel.startedAt) {
        details.push(`Started: ${tunnel.startedAt.toLocaleString()}`);
      }

      if (tunnel.errorMessage) {
        details.push(`Error: ${tunnel.errorMessage}`);
      }

      void vscode.window.showInformationMessage(details.join('\n'));
    }),

    vscode.commands.registerCommand('remoteServerManager.refreshTunnels', () => {
      portForwardingTreeProvider.refresh();
    })
  );

  // Load inventory files on startup
  inventoryManager.loadFromConfiguration();
  treeProvider.refresh();

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('remoteServerManager')) {
        inventoryManager.loadFromConfiguration();
        treeProvider.refresh();
      }
    })
  );
}

export function deactivate(): void {
  logger.info('Remote Server Manager is now deactivated');
}

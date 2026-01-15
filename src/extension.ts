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
import type { AnsibleHost } from './models/Connection';
import {
  requiresConnectionConfirmation,
  getEnvironmentWarning,
} from './utils/serverEnvironment';

let credentialService: CredentialService;
let connectionService: ConnectionService;
let inventoryManager: InventoryManager;
let treeProvider: ConnectionTreeProvider;
let usageTrackingService: UsageTrackingService;

export function activate(context: vscode.ExtensionContext): void {
  console.log('Remote Server Manager is now active');

  // Initialize services
  credentialService = new CredentialService(context.secrets);
  inventoryManager = new InventoryManager();
  connectionService = new ConnectionService(inventoryManager, credentialService);
  usageTrackingService = new UsageTrackingService(context.globalState);
  const quickConnectService = new QuickConnectService(connectionService, credentialService);
  const importService = new ImportService(inventoryManager, credentialService);

  // Initialize tree view with usage tracking
  treeProvider = new ConnectionTreeProvider(inventoryManager);
  treeProvider.setUsageTrackingService(usageTrackingService);

  const treeView = vscode.window.createTreeView('remoteServerManager', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Register commands
  context.subscriptions.push(
    treeView,

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
  console.log('Remote Server Manager is now deactivated');
}

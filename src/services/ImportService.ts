import * as vscode from 'vscode';
import * as fs from 'fs';
import { InventoryManager } from './InventoryManager';
import { CredentialService } from './CredentialService';
import { AnsibleHost, ConnectionType, CredentialStrategy } from '../models/Connection';
import { JsonCredential } from '../models/Credential';
import { normalizeGroupName } from '../models/Group';

/**
 * JSON connection format (for import)
 */
interface JsonConnection {
  id: string;
  name: string;
  hostname: string;
  type: string;
  group: string;
  credentialId?: string;
  connectionSettings?: {
    domain?: string;
    sshPort?: number;
    rdpPort?: number;
  };
  createdAt?: string;
  modifiedAt?: string;
}

/**
 * JSON import file format
 */
interface JsonImportFile {
  connections: JsonConnection[];
  credentials: JsonCredential[];
  exportedAt?: string;
  version?: string;
}

/**
 * Import validation issue
 */
interface ImportIssue {
  type: 'error' | 'warning';
  message: string;
  connection?: string;
}

/**
 * Import result
 */
interface ImportResult {
  success: boolean;
  connectionsImported: number;
  credentialsMigrated: number;
  issues: ImportIssue[];
}

/**
 * Service for importing connections from external sources
 */
export class ImportService {
  constructor(
    private inventoryManager: InventoryManager,
    private credentialService: CredentialService
  ) {}

  /**
   * Import from JSON file
   */
  async importFromJson(): Promise<ImportResult | undefined> {
    // Select file
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'JSON files': ['json'],
        'All files': ['*'],
      },
      title: 'Select JSON file to import',
    });

    if (!fileUri || fileUri.length === 0) {
      return undefined;
    }

    const filePath = fileUri[0].fsPath;

    try {
      // Read and parse file
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as JsonImportFile;

      // Validate
      const validation = this.validateImport(data);
      if (validation.issues.some((i) => i.type === 'error')) {
        const errors = validation.issues.filter((i) => i.type === 'error');
        void vscode.window.showErrorMessage(
          `Import validation failed:\n${errors.map((e) => e.message).join('\n')}`
        );
        return {
          success: false,
          connectionsImported: 0,
          credentialsMigrated: 0,
          issues: validation.issues,
        };
      }

      // Show warnings if any
      const warnings = validation.issues.filter((i) => i.type === 'warning');
      if (warnings.length > 0) {
        const proceed = await vscode.window.showWarningMessage(
          `Import has ${warnings.length} warning(s). Proceed?`,
          { modal: true, detail: warnings.map((w) => w.message).join('\n') },
          'Import Anyway',
          'Cancel'
        );
        if (proceed !== 'Import Anyway') {
          return undefined;
        }
      }

      // Get or create editable inventory
      let source = this.inventoryManager.getEditableSource();
      if (!source) {
        // Ask user to create a new inventory file
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file('inventory.ini'),
          filters: {
            'Ansible Inventory': ['ini'],
            'All files': ['*'],
          },
          title: 'Create new inventory file',
        });

        if (!saveUri) {
          return undefined;
        }

        // Create empty file
        fs.writeFileSync(saveUri.fsPath, '# Imported connections\n');
        source = await this.inventoryManager.addSource(saveUri.fsPath, false);
      }

      // Migrate credentials first
      const config = vscode.workspace.getConfiguration('remoteServerManager');
      const defaultStrategy = config.get<CredentialStrategy>('defaultCredentialStrategy', 'prompt');

      const credentialResult = await this.credentialService.migrateFromJson(
        data.credentials,
        defaultStrategy
      );

      // Import connections
      let connectionsImported = 0;
      for (const conn of data.connections) {
        const host = this.convertJsonConnection(conn);
        const groupName = conn.group ? normalizeGroupName(conn.group) : undefined;
        this.inventoryManager.addHost(source, host, groupName);
        connectionsImported++;
      }

      // Save inventory
      this.inventoryManager.saveInventoryFile(source);

      // Show result
      const result: ImportResult = {
        success: true,
        connectionsImported,
        credentialsMigrated: credentialResult.migrated,
        issues: [...validation.issues, ...credentialResult.errors.map((e) => ({
          type: 'warning' as const,
          message: e,
        }))],
      };

      void vscode.window.showInformationMessage(
        `Import complete: ${connectionsImported} connections, ${credentialResult.migrated} credentials`
      );

      return result;
    } catch (error) {
      void vscode.window.showErrorMessage(`Import failed: ${String(error)}`);
      return {
        success: false,
        connectionsImported: 0,
        credentialsMigrated: 0,
        issues: [{ type: 'error', message: String(error) }],
      };
    }
  }

  /**
   * Validate import data
   */
  private validateImport(data: JsonImportFile): { valid: boolean; issues: ImportIssue[] } {
    const issues: ImportIssue[] = [];

    // Check required fields
    if (!data.connections || !Array.isArray(data.connections)) {
      issues.push({ type: 'error', message: 'Missing or invalid connections array' });
    }

    if (!data.credentials || !Array.isArray(data.credentials)) {
      issues.push({ type: 'warning', message: 'No credentials found in import file' });
    }

    // Check for duplicate hostnames
    const hostnames = new Map<string, number>();
    for (const conn of data.connections || []) {
      const count = hostnames.get(conn.hostname) || 0;
      hostnames.set(conn.hostname, count + 1);
    }

    for (const [hostname, count] of hostnames) {
      if (count > 1) {
        issues.push({
          type: 'warning',
          message: `Duplicate hostname: ${hostname} (${count} occurrences)`,
        });
      }
    }

    // Check credential references
    const credentialIds = new Set((data.credentials || []).map((c) => c.id));
    for (const conn of data.connections || []) {
      if (conn.credentialId && !credentialIds.has(conn.credentialId)) {
        issues.push({
          type: 'warning',
          message: `Missing credential reference: ${conn.credentialId}`,
          connection: conn.name,
        });
      }
    }

    // Validate connection types
    const validTypes = ['rdp', 'ssh', 'sftp', 'ftp'];
    for (const conn of data.connections || []) {
      if (!validTypes.includes(conn.type)) {
        issues.push({
          type: 'warning',
          message: `Unknown connection type: ${conn.type}`,
          connection: conn.name,
        });
      }
    }

    return {
      valid: !issues.some((i) => i.type === 'error'),
      issues,
    };
  }

  /**
   * Convert JSON connection to Ansible host
   */
  private convertJsonConnection(conn: JsonConnection): AnsibleHost {
    const host: AnsibleHost = {
      name: conn.hostname,
      rawVariables: {},
    };

    // Set display name
    if (conn.name && conn.name !== conn.hostname) {
      host.remote_mgr_display_name = conn.name;
    }

    // Set connection type
    if (conn.type) {
      host.remote_mgr_connection_type = conn.type as ConnectionType;

      // Map to ansible_connection
      if (conn.type === 'rdp') {
        host.ansible_connection = 'winrm';
      } else if (conn.type === 'ssh' || conn.type === 'sftp') {
        host.ansible_connection = 'ssh';
      }
    }

    // Set credential
    if (conn.credentialId) {
      host.remote_mgr_credential_id = conn.credentialId;
      host.remote_mgr_credential_strategy = 'save';
    } else {
      host.remote_mgr_credential_strategy = 'prompt';
    }

    // Set port
    if (conn.connectionSettings?.sshPort) {
      host.ansible_port = conn.connectionSettings.sshPort;
    } else if (conn.connectionSettings?.rdpPort) {
      host.ansible_port = conn.connectionSettings.rdpPort;
    }

    // Set domain
    if (conn.connectionSettings?.domain) {
      host.remote_mgr_domain = conn.connectionSettings.domain;
    }

    // Try to extract IP from hostname if it looks like an IP
    if (this.isIpAddress(conn.hostname)) {
      // hostname is the IP, no ansible_host needed
    } else {
      // Try to extract IP from the name field
      const ipMatch = conn.name.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      if (ipMatch) {
        host.ansible_host = ipMatch[1];
      }
    }

    return host;
  }

  /**
   * Check if a string is an IP address
   */
  private isIpAddress(str: string): boolean {
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(str);
  }

  /**
   * Import from Ansible inventory file (adds as a new source)
   */
  async importFromAnsible(): Promise<boolean> {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'All files': ['*'],
      },
      title: 'Select Ansible inventory file to import',
    });

    if (!fileUri || fileUri.length === 0) {
      return false;
    }

    const filePath = fileUri[0].fsPath;

    // Ask if it should be read-only
    const readOnlyChoice = await vscode.window.showQuickPick(
      [
        { label: 'Editable', description: 'Allow editing connections in this file', readOnly: false },
        { label: 'Read-Only', description: 'Import as reference only', readOnly: true },
      ],
      { placeHolder: 'How should this inventory be treated?' }
    );

    if (!readOnlyChoice) {
      return false;
    }

    try {
      await this.inventoryManager.addSource(filePath, readOnlyChoice.readOnly);
      void vscode.window.showInformationMessage(`Imported Ansible inventory: ${filePath}`);
      return true;
    } catch (error) {
      void vscode.window.showErrorMessage(`Import failed: ${String(error)}`);
      return false;
    }
  }

  /**
   * Export to JSON file
   */
  async exportToJson(): Promise<boolean> {
    const sources = this.inventoryManager.getSources();

    if (sources.length === 0) {
      void vscode.window.showErrorMessage('No inventory sources to export');
      return false;
    }

    // Let user select which source to export
    let sourceToExport = sources[0];
    if (sources.length > 1) {
      const items = sources.map(s => ({
        label: s.name,
        description: s.readOnly ? '(read-only)' : '',
        source: s,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select inventory to export',
      });

      if (!selected) {
        return false;
      }
      sourceToExport = selected.source;
    }

    if (!sourceToExport.inventory) {
      void vscode.window.showErrorMessage('Selected inventory is empty');
      return false;
    }

    // Get save location
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${sourceToExport.name.replace(/\.[^.]+$/, '')}-export.json`),
      filters: {
        'JSON files': ['json'],
        'All files': ['*'],
      },
      title: 'Export to JSON',
    });

    if (!saveUri) {
      return false;
    }

    try {
      // Convert to JSON format
      const connections: JsonConnection[] = [];
      const credentialIds = new Set<string>();

      // Process groups
      for (const group of sourceToExport.inventory.groups) {
        for (const host of group.hosts) {
          connections.push(this.convertHostToJson(host, group.name));
          if (host.remote_mgr_credential_id) {
            credentialIds.add(host.remote_mgr_credential_id);
          }
        }
      }

      // Process ungrouped hosts
      for (const host of sourceToExport.inventory.ungroupedHosts) {
        connections.push(this.convertHostToJson(host, ''));
        if (host.remote_mgr_credential_id) {
          credentialIds.add(host.remote_mgr_credential_id);
        }
      }

      // Get credentials (without passwords for security)
      const credentials: JsonCredential[] = [];
      for (const credId of credentialIds) {
        const cred = await this.credentialService.getCredential(credId);
        if (cred) {
          credentials.push({
            id: cred.id,
            name: cred.name,
            username: cred.username,
            domain: cred.domain,
            // Note: password not exported for security
          });
        }
      }

      const exportData: JsonImportFile = {
        connections,
        credentials,
        exportedAt: new Date().toISOString(),
        version: '1.0',
      };

      fs.writeFileSync(saveUri.fsPath, JSON.stringify(exportData, null, 2));
      void vscode.window.showInformationMessage(
        `Exported ${connections.length} connections to ${saveUri.fsPath}`
      );
      return true;
    } catch (error) {
      void vscode.window.showErrorMessage(`Export failed: ${String(error)}`);
      return false;
    }
  }

  /**
   * Export to Ansible inventory file
   */
  async exportToAnsible(): Promise<boolean> {
    const sources = this.inventoryManager.getSources();

    if (sources.length === 0) {
      void vscode.window.showErrorMessage('No inventory sources to export');
      return false;
    }

    // Let user select which source to export
    let sourceToExport = sources[0];
    if (sources.length > 1) {
      const items = sources.map(s => ({
        label: s.name,
        description: s.readOnly ? '(read-only)' : '',
        source: s,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select inventory to export',
      });

      if (!selected) {
        return false;
      }
      sourceToExport = selected.source;
    }

    if (!sourceToExport.inventory) {
      void vscode.window.showErrorMessage('Selected inventory is empty');
      return false;
    }

    // Get save location
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${sourceToExport.name.replace(/\.[^.]+$/, '')}-export.ini`),
      filters: {
        'Ansible Inventory': ['ini'],
        'All files': ['*'],
      },
      title: 'Export to Ansible inventory',
    });

    if (!saveUri) {
      return false;
    }

    try {
      // Use the existing serialization
      const { AnsibleParser } = await import('../parsers/AnsibleParser');
      const parser = new AnsibleParser();
      const content = parser.serialize(sourceToExport.inventory);

      fs.writeFileSync(saveUri.fsPath, content);
      void vscode.window.showInformationMessage(
        `Exported inventory to ${saveUri.fsPath}`
      );
      return true;
    } catch (error) {
      void vscode.window.showErrorMessage(`Export failed: ${String(error)}`);
      return false;
    }
  }

  /**
   * Convert Ansible host to JSON connection
   */
  private convertHostToJson(host: AnsibleHost, group: string): JsonConnection {
    const type = host.remote_mgr_connection_type ||
      (host.ansible_connection === 'winrm' ? 'rdp' : 'ssh');

    return {
      id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: host.remote_mgr_display_name || host.comment || host.name,
      hostname: host.ansible_host || host.name,
      type,
      group: group === 'ungrouped' ? '' : group.replace(/_/g, ' '),
      credentialId: host.remote_mgr_credential_id,
      connectionSettings: {
        domain: host.remote_mgr_domain,
        sshPort: type === 'ssh' || type === 'sftp' ? host.ansible_port : undefined,
        rdpPort: type === 'rdp' ? host.remote_mgr_port : undefined,
      },
    };
  }
}

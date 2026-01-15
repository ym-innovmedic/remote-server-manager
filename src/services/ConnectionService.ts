import * as vscode from 'vscode';
import { InventoryManager } from './InventoryManager';
import { CredentialService } from './CredentialService';
import { ConnectionTreeItem } from '../providers/ConnectionTreeProvider';
import {
  AnsibleHost,
  detectConnectionType,
  getConnectionHost,
  getConnectionPort,
  getDisplayLabel,
  createEmptyHost,
  ConnectionType,
} from '../models/Connection';
import { RdpLauncher } from '../launchers/RdpLauncher';
import { SshLauncher } from '../launchers/SshLauncher';
import { SftpLauncher } from '../launchers/SftpLauncher';
import { FtpLauncher } from '../launchers/FtpLauncher';
import { normalizeGroupName } from '../models/Group';

/**
 * Service for connection operations
 */
export class ConnectionService {
  private rdpLauncher: RdpLauncher;
  private sshLauncher: SshLauncher;
  private sftpLauncher: SftpLauncher;
  private ftpLauncher: FtpLauncher;

  constructor(
    private inventoryManager: InventoryManager,
    private credentialService: CredentialService
  ) {
    this.rdpLauncher = new RdpLauncher();
    this.sshLauncher = new SshLauncher();
    this.sftpLauncher = new SftpLauncher();
    this.ftpLauncher = new FtpLauncher();
  }

  /**
   * Connect to a host using the default connection type
   */
  async connect(item: ConnectionTreeItem): Promise<void> {
    const host = item.data as AnsibleHost;
    const connectionType = detectConnectionType(host);
    await this.launchConnection(host, connectionType);
  }

  /**
   * Connect via SSH
   */
  async connectSsh(item: ConnectionTreeItem): Promise<void> {
    const host = item.data as AnsibleHost;
    await this.launchConnection(host, 'ssh');
  }

  /**
   * Connect via SFTP
   */
  async connectSftp(item: ConnectionTreeItem): Promise<void> {
    const host = item.data as AnsibleHost;
    await this.launchConnection(host, 'sftp');
  }

  /**
   * Connect using FQDN
   */
  async connectUsingFqdn(item: ConnectionTreeItem): Promise<void> {
    const host = item.data as AnsibleHost;
    const connectionType = detectConnectionType(host);
    await this.launchConnection(host, connectionType, 'name');
  }

  /**
   * Connect using IP address
   */
  async connectUsingIp(item: ConnectionTreeItem): Promise<void> {
    const host = item.data as AnsibleHost;
    const connectionType = detectConnectionType(host);
    await this.launchConnection(host, connectionType, 'ansible_host');
  }

  /**
   * Launch a connection
   */
  async launchConnection(
    host: AnsibleHost,
    connectionType: ConnectionType,
    hostnamePreference?: 'name' | 'ansible_host'
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('remoteServerManager');
    const defaultPreference = config.get<'name' | 'ansible_host'>(
      'preferHostnameType',
      'ansible_host'
    );

    const preference = hostnamePreference || defaultPreference;
    const hostname = getConnectionHost(host, preference);
    const port = getConnectionPort(host, connectionType);
    const displayName = getDisplayLabel(host);

    try {
      switch (connectionType) {
        case 'rdp': {
          // RDP needs full credentials for .rdp file
          const result = await this.credentialService.getCredentialForRdp(
            host.remote_mgr_credential_id,
            displayName
          );
          if (!result) {
            return; // User cancelled
          }

          // Auto-assign credential to host for future use
          if (result.credential.id && !host.remote_mgr_credential_id) {
            host.remote_mgr_credential_id = result.credential.id;
            this.saveHostChanges(host);
          }

          await this.rdpLauncher.launch({
            hostname,
            port,
            username: result.username,
            password: result.password,
            domain: host.remote_mgr_domain || result.domain,
            displayName,
          });
          break;
        }

        case 'ssh':
        case 'sftp': {
          // SSH/SFTP - get full credentials, use sshpass if available
          const result = await this.credentialService.getCredentialForSsh(
            host.remote_mgr_credential_id,
            displayName
          );
          if (!result) {
            return; // User cancelled
          }

          // Auto-assign credential to host for future use
          if (result.credential.id && !host.remote_mgr_credential_id) {
            host.remote_mgr_credential_id = result.credential.id;
            this.saveHostChanges(host);
          }

          const launcher = connectionType === 'ssh' ? this.sshLauncher : this.sftpLauncher;
          await launcher.launch({
            hostname,
            port,
            username: result.username,
            password: result.password,
            displayName,
            // v0.2.0: SSH key and jump host support
            identityFile: host.remote_mgr_identity_file,
            proxyJump: host.remote_mgr_proxy_jump,
          });
          break;
        }

        case 'ftp': {
          // FTP - similar flow but separate for now
          const ftpResult = await this.credentialService.getCredentialForSsh(
            host.remote_mgr_credential_id,
            displayName
          );
          if (!ftpResult) {
            return;
          }

          if (ftpResult.credential.id && !host.remote_mgr_credential_id) {
            host.remote_mgr_credential_id = ftpResult.credential.id;
            this.saveHostChanges(host);
          }

          await this.ftpLauncher.launch({
            hostname,
            port,
            username: ftpResult.username,
            password: ftpResult.password,
            displayName,
          });
          break;
        }
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to connect: ${String(error)}`);
    }
  }

  /**
   * Save changes to a host (e.g., credential assignment)
   */
  private saveHostChanges(host: AnsibleHost): void {
    const result = this.inventoryManager.findHost(host.name);
    if (result && !result.source.readOnly) {
      try {
        this.inventoryManager.saveInventoryFile(result.source);
      } catch {
        // Silent fail - not critical
      }
    }
  }

  /**
   * Add a new connection
   */
  async addConnection(): Promise<void> {
    const source = this.inventoryManager.getEditableSource();
    if (!source) {
      void vscode.window.showErrorMessage('No editable inventory file available');
      return;
    }

    // Get hostname
    const hostname = await vscode.window.showInputBox({
      prompt: 'Enter hostname or IP address',
      placeHolder: 'server.example.com or 192.168.1.1',
    });
    if (!hostname) {
      return;
    }

    // Get connection type
    const connectionType = await vscode.window.showQuickPick(
      [
        { label: 'SSH', value: 'ssh' },
        { label: 'RDP', value: 'rdp' },
        { label: 'SFTP', value: 'sftp' },
        { label: 'FTP', value: 'ftp' },
      ],
      { placeHolder: 'Select connection type' }
    );
    if (!connectionType) {
      return;
    }

    // Get group (optional)
    const groupInput = await vscode.window.showInputBox({
      prompt: 'Enter group name (optional)',
      placeHolder: 'Leave empty for ungrouped',
    });

    // Create host
    const host = createEmptyHost(hostname);
    host.remote_mgr_connection_type = connectionType.value as ConnectionType;

    // Add to inventory
    const groupName = groupInput ? normalizeGroupName(groupInput) : undefined;
    this.inventoryManager.addHost(source, host, groupName);

    // Save
    this.inventoryManager.saveInventoryFile(source);
    void vscode.window.showInformationMessage(`Connection added: ${hostname}`);
  }

  /**
   * Edit a connection
   */
  async editConnection(item: ConnectionTreeItem): Promise<void> {
    const source = item.inventorySource;
    if (!source || source.readOnly) {
      void vscode.window.showErrorMessage('Cannot edit read-only inventory');
      return;
    }

    const host = item.data as AnsibleHost;
    const currentType = detectConnectionType(host);
    const displayName = getDisplayLabel(host);

    // Show edit menu
    const editOptions = [
      {
        label: '$(edit) Display Name',
        description: host.remote_mgr_display_name || host.comment || '(not set)',
        field: 'displayName',
      },
      {
        label: '$(globe) IP Address',
        description: host.ansible_host || '(uses hostname)',
        field: 'ip',
      },
      {
        label: '$(plug) Connection Type',
        description: currentType.toUpperCase(),
        field: 'type',
      },
      {
        label: '$(symbol-number) Port',
        description: String(host.remote_mgr_port || host.ansible_port || getConnectionPort(host, currentType)),
        field: 'port',
      },
      {
        label: '$(person) Username',
        description: host.ansible_user || '(not set)',
        field: 'user',
      },
      {
        label: '$(organization) Domain',
        description: host.remote_mgr_domain || '(not set)',
        field: 'domain',
      },
      {
        label: '$(note) Comment',
        description: host.comment || '(not set)',
        field: 'comment',
      },
      {
        label: '$(key) Credential',
        description: host.remote_mgr_credential_id || '(none)',
        field: 'credential',
      },
      // v0.2.0: SSH Key and Jump Host options
      {
        label: '$(file) SSH Key File',
        description: host.remote_mgr_identity_file || '(not set)',
        field: 'identityFile',
      },
      {
        label: '$(remote) Jump Host',
        description: host.remote_mgr_proxy_jump || '(not set)',
        field: 'proxyJump',
      },
      {
        label: '$(tag) Tags',
        description: host.remote_mgr_tags?.join(', ') || '(none)',
        field: 'tags',
      },
    ];

    const selected = await vscode.window.showQuickPick(editOptions, {
      placeHolder: `Edit "${displayName}" - Select field to modify`,
    });

    if (!selected) {
      return;
    }

    let changed = false;

    switch (selected.field) {
      case 'displayName': {
        const newDisplayName = await vscode.window.showInputBox({
          prompt: 'Enter display name',
          value: host.remote_mgr_display_name || host.comment || '',
          placeHolder: 'Friendly name for this connection',
        });
        if (newDisplayName !== undefined) {
          host.remote_mgr_display_name = newDisplayName || undefined;
          changed = true;
        }
        break;
      }

      case 'ip': {
        const newIp = await vscode.window.showInputBox({
          prompt: 'Enter IP address',
          value: host.ansible_host || '',
          placeHolder: 'e.g., 192.168.1.100',
        });
        if (newIp !== undefined) {
          host.ansible_host = newIp || undefined;
          changed = true;
        }
        break;
      }

      case 'type': {
        const typeOptions = [
          { label: 'SSH', value: 'ssh' as ConnectionType },
          { label: 'RDP', value: 'rdp' as ConnectionType },
          { label: 'SFTP', value: 'sftp' as ConnectionType },
          { label: 'FTP', value: 'ftp' as ConnectionType },
        ];
        const newType = await vscode.window.showQuickPick(typeOptions, {
          placeHolder: 'Select connection type',
        });
        if (newType) {
          host.remote_mgr_connection_type = newType.value;
          changed = true;
        }
        break;
      }

      case 'port': {
        const newPort = await vscode.window.showInputBox({
          prompt: 'Enter port number',
          value: String(host.remote_mgr_port || host.ansible_port || ''),
          placeHolder: 'Leave empty for default',
          validateInput: (value) => {
            if (value && (isNaN(Number(value)) || Number(value) < 1 || Number(value) > 65535)) {
              return 'Port must be a number between 1 and 65535';
            }
            return undefined;
          },
        });
        if (newPort !== undefined) {
          const portNum = newPort ? Number(newPort) : undefined;
          host.remote_mgr_port = portNum;
          changed = true;
        }
        break;
      }

      case 'user': {
        const newUser = await vscode.window.showInputBox({
          prompt: 'Enter username',
          value: host.ansible_user || '',
          placeHolder: 'Username for connection',
        });
        if (newUser !== undefined) {
          host.ansible_user = newUser || undefined;
          changed = true;
        }
        break;
      }

      case 'domain': {
        const newDomain = await vscode.window.showInputBox({
          prompt: 'Enter domain (for RDP/Windows)',
          value: host.remote_mgr_domain || '',
          placeHolder: 'e.g., MYDOMAIN',
        });
        if (newDomain !== undefined) {
          host.remote_mgr_domain = newDomain || undefined;
          changed = true;
        }
        break;
      }

      case 'comment': {
        const newComment = await vscode.window.showInputBox({
          prompt: 'Enter comment/note',
          value: host.comment || '',
          placeHolder: 'Description or note about this server',
        });
        if (newComment !== undefined) {
          host.comment = newComment || undefined;
          changed = true;
        }
        break;
      }

      case 'credential': {
        const credentials = await this.credentialService.listCredentials();
        const credOptions = [
          { label: '$(x) No credential (prompt each time)', id: '' },
          ...credentials.map((c) => ({
            label: `$(key) ${c.username}${c.domain ? ` (${c.domain})` : ''}`,
            description: c.name + (c.password ? ' - password saved' : ''),
            id: c.id,
          })),
        ];
        const selected = await vscode.window.showQuickPick(credOptions, {
          placeHolder: 'Select credential',
        });
        if (selected) {
          host.remote_mgr_credential_id = selected.id || undefined;
          changed = true;
        }
        break;
      }

      // v0.2.0: SSH Key File
      case 'identityFile': {
        const newKeyFile = await vscode.window.showInputBox({
          prompt: 'Enter path to SSH private key',
          value: host.remote_mgr_identity_file || '',
          placeHolder: 'e.g., ~/.ssh/id_rsa or ~/.ssh/id_ed25519',
        });
        if (newKeyFile !== undefined) {
          host.remote_mgr_identity_file = newKeyFile || undefined;
          changed = true;
        }
        break;
      }

      // v0.2.0: Jump Host / ProxyJump
      case 'proxyJump': {
        const newJumpHost = await vscode.window.showInputBox({
          prompt: 'Enter jump host (bastion server)',
          value: host.remote_mgr_proxy_jump || '',
          placeHolder: 'e.g., bastion.example.com or user@bastion.example.com',
        });
        if (newJumpHost !== undefined) {
          host.remote_mgr_proxy_jump = newJumpHost || undefined;
          changed = true;
        }
        break;
      }

      // v0.2.0: Tags
      case 'tags': {
        const newTags = await vscode.window.showInputBox({
          prompt: 'Enter tags (comma-separated)',
          value: host.remote_mgr_tags?.join(', ') || '',
          placeHolder: 'e.g., web, production, critical',
        });
        if (newTags !== undefined) {
          host.remote_mgr_tags = newTags
            ? newTags.split(',').map(t => t.trim()).filter(t => t.length > 0)
            : undefined;
          changed = true;
        }
        break;
      }
    }

    if (changed) {
      try {
        this.inventoryManager.saveInventoryFile(source);
        void vscode.window.showInformationMessage(`Updated: ${displayName}`);
      } catch (error) {
        void vscode.window.showErrorMessage(`Failed to save: ${String(error)}`);
      }
    }
  }

  /**
   * Delete a connection
   */
  async deleteConnection(item: ConnectionTreeItem): Promise<void> {
    const source = item.inventorySource;
    if (!source || source.readOnly) {
      void vscode.window.showErrorMessage('Cannot delete from read-only inventory');
      return;
    }

    const host = item.data as AnsibleHost;

    const confirm = await vscode.window.showWarningMessage(
      `Delete connection "${host.name}"?`,
      { modal: true },
      'Delete'
    );

    if (confirm !== 'Delete') {
      return;
    }

    const removed = this.inventoryManager.removeHost(source, host.name);
    if (removed) {
      this.inventoryManager.saveInventoryFile(source);
      void vscode.window.showInformationMessage(`Connection deleted: ${host.name}`);
    } else {
      void vscode.window.showErrorMessage('Failed to delete connection');
    }
  }

  /**
   * Copy hostname to clipboard
   */
  async copyHostname(item: ConnectionTreeItem): Promise<void> {
    const host = item.data as AnsibleHost;
    await vscode.env.clipboard.writeText(host.name);
    void vscode.window.showInformationMessage(`Copied: ${host.name}`);
  }

  /**
   * Copy IP address to clipboard
   */
  async copyIpAddress(item: ConnectionTreeItem): Promise<void> {
    const host = item.data as AnsibleHost;
    const ip = host.ansible_host || host.name;
    await vscode.env.clipboard.writeText(ip);
    void vscode.window.showInformationMessage(`Copied: ${ip}`);
  }

  /**
   * Copy display name to clipboard
   */
  async copyDisplayName(item: ConnectionTreeItem): Promise<void> {
    const host = item.data as AnsibleHost;
    const displayName = getDisplayLabel(host);
    await vscode.env.clipboard.writeText(displayName);
    void vscode.window.showInformationMessage(`Copied: ${displayName}`);
  }

  /**
   * Copy full connection info to clipboard
   */
  async copyConnectionInfo(item: ConnectionTreeItem): Promise<void> {
    const host = item.data as AnsibleHost;
    const connectionType = detectConnectionType(host);

    const lines: string[] = [
      `Display Name: ${getDisplayLabel(host)}`,
      `Hostname: ${host.name}`,
    ];

    if (host.ansible_host) {
      lines.push(`IP Address: ${host.ansible_host}`);
    }

    lines.push(`Type: ${connectionType.toUpperCase()}`);

    const port = getConnectionPort(host, connectionType);
    lines.push(`Port: ${port}`);

    if (host.ansible_user) {
      lines.push(`User: ${host.ansible_user}`);
    }

    if (host.remote_mgr_domain) {
      lines.push(`Domain: ${host.remote_mgr_domain}`);
    }

    if (host.ansible_connection) {
      lines.push(`Connection: ${host.ansible_connection}`);
    }

    if (host.comment) {
      lines.push(`Note: ${host.comment}`);
    }

    const info = lines.join('\n');
    await vscode.env.clipboard.writeText(info);
    void vscode.window.showInformationMessage('Connection info copied to clipboard');
  }

  /**
   * Copy host data as JSON
   */
  async copyAsJson(item: ConnectionTreeItem): Promise<void> {
    const host = item.data as AnsibleHost;
    const connectionType = detectConnectionType(host);

    const jsonData = {
      name: host.name,
      displayName: getDisplayLabel(host),
      ip: host.ansible_host,
      type: connectionType,
      port: getConnectionPort(host, connectionType),
      user: host.ansible_user,
      domain: host.remote_mgr_domain,
      connection: host.ansible_connection,
      comment: host.comment,
      credentialId: host.remote_mgr_credential_id,
      rawVariables: host.rawVariables,
    };

    // Remove undefined values
    const cleanedData = Object.fromEntries(
      Object.entries(jsonData).filter(([, v]) => v !== undefined)
    );

    const json = JSON.stringify(cleanedData, null, 2);
    await vscode.env.clipboard.writeText(json);
    void vscode.window.showInformationMessage('Copied as JSON to clipboard');
  }
}

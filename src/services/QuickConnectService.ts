import * as vscode from 'vscode';
import { ConnectionService } from './ConnectionService';
import { CredentialService } from './CredentialService';
import { createEmptyHost, ConnectionType } from '../models/Connection';

/**
 * Service for quick connect functionality
 */
export class QuickConnectService {
  constructor(
    private connectionService: ConnectionService,
    private credentialService: CredentialService
  ) {}

  /**
   * Launch quick connect flow
   */
  async quickConnect(): Promise<void> {
    // Step 1: Get hostname
    const hostname = await vscode.window.showInputBox({
      prompt: 'Enter hostname or IP address',
      placeHolder: 'server.example.com or 192.168.1.1',
      ignoreFocusOut: true,
    });

    if (!hostname) {
      return;
    }

    // Step 2: Select connection type
    const connectionTypeItem = await vscode.window.showQuickPick(
      [
        { label: '$(terminal) SSH', description: 'Secure Shell', value: 'ssh' as ConnectionType },
        { label: '$(remote-explorer) RDP', description: 'Remote Desktop', value: 'rdp' as ConnectionType },
        { label: '$(files) SFTP', description: 'Secure File Transfer', value: 'sftp' as ConnectionType },
        { label: '$(cloud-upload) FTP', description: 'File Transfer (unencrypted)', value: 'ftp' as ConnectionType },
      ],
      {
        placeHolder: 'Select connection type',
        ignoreFocusOut: true,
      }
    );

    if (!connectionTypeItem) {
      return;
    }

    const connectionType = connectionTypeItem.value;

    // Step 3: Get credentials
    const credentialOption = await vscode.window.showQuickPick(
      [
        { label: '$(key) Enter credentials', description: 'Enter username and password', value: 'new' },
        { label: '$(person) Use existing', description: 'Select from saved credentials', value: 'existing' },
        { label: '$(circle-slash) No credentials', description: 'Connect without authentication', value: 'none' },
      ],
      {
        placeHolder: 'How do you want to authenticate?',
        ignoreFocusOut: true,
      }
    );

    if (!credentialOption) {
      return;
    }

    let username: string | undefined;
    let password: string | undefined;
    let domain: string | undefined;

    if (credentialOption.value === 'new') {
      // Prompt for new credentials
      username = await vscode.window.showInputBox({
        prompt: 'Enter username',
        ignoreFocusOut: true,
      });

      if (!username) {
        return;
      }

      // For RDP, ask for domain
      if (connectionType === 'rdp') {
        domain = await vscode.window.showInputBox({
          prompt: 'Enter domain (optional)',
          placeHolder: 'Leave empty if not needed',
          ignoreFocusOut: true,
        });
      }

      password = await vscode.window.showInputBox({
        prompt: domain ? `Enter password for ${domain}\\${username}` : `Enter password for ${username}`,
        password: true,
        ignoreFocusOut: true,
      });

      if (!password) {
        return;
      }
    } else if (credentialOption.value === 'existing') {
      // Select from existing credentials
      const credentials = await this.credentialService.listCredentials();

      if (credentials.length === 0) {
        void vscode.window.showWarningMessage('No saved credentials found');
        return;
      }

      const credentialItems = credentials.map((c) => ({
        label: c.name,
        description: c.username,
        value: c,
      }));

      const selectedCredential = await vscode.window.showQuickPick(credentialItems, {
        placeHolder: 'Select credential',
        ignoreFocusOut: true,
      });

      if (!selectedCredential) {
        return;
      }

      username = selectedCredential.value.username;
      domain = selectedCredential.value.domain;

      if (selectedCredential.value.password) {
        password = selectedCredential.value.password;
      } else {
        password = await this.credentialService.promptForPassword(username, domain);
        if (!password) {
          return;
        }
      }
    }

    // Create temporary host for connection
    const host = createEmptyHost(hostname);
    host.remote_mgr_connection_type = connectionType;
    if (domain) {
      host.remote_mgr_domain = domain;
    }

    // Launch connection
    try {
      await this.connectionService.launchConnection(host, connectionType);

      // Ask if user wants to save the connection
      const saveOption = await vscode.window.showInformationMessage(
        `Connected to ${hostname}. Save this connection?`,
        'Save',
        'Don\'t Save'
      );

      if (saveOption === 'Save') {
        // TODO: Implement save after quick connect
        void vscode.window.showInformationMessage('Save functionality coming soon');
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to connect: ${String(error)}`);
    }
  }
}

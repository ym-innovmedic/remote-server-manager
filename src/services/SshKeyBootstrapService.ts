/**
 * SSH Key Bootstrap Service
 * Helps users set up SSH key authentication for servers
 * Supports ssh-agent, PKCS#11/YubiKey, and hardware security keys
 * v0.3.0
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync } from 'child_process';
import { AnsibleHost } from '../models/Connection';
import { CredentialService } from './CredentialService';
import { InventoryManager } from './InventoryManager';
import { logger } from '../utils/Logger';

/**
 * SSH Key types supported
 */
type SshKeyType = 'ed25519' | 'rsa' | 'ecdsa' | 'ed25519-sk' | 'ecdsa-sk';

/**
 * SSH Key info
 */
interface SshKeyInfo {
  type: SshKeyType;
  privateKeyPath: string;
  publicKeyPath: string;
  exists: boolean;
  isHardwareKey?: boolean; // FIDO2/YubiKey
  hasPassphrase?: boolean;
}

/**
 * Service for bootstrapping SSH key authentication
 */
export class SshKeyBootstrapService {
  private credentialService: CredentialService;
  private inventoryManager: InventoryManager;

  constructor(credentialService: CredentialService, inventoryManager: InventoryManager) {
    this.credentialService = credentialService;
    this.inventoryManager = inventoryManager;
  }

  /**
   * Main bootstrap flow for a host
   */
  async bootstrapHost(host: AnsibleHost): Promise<boolean> {
    logger.info(`[SshKeyBootstrap] Starting bootstrap for host: ${host.name}`);

    // Check if this is a production server and recommend hardware keys
    // Uses tags for environment detection (e.g., 'production', 'prod')
    const isProduction = host.remote_mgr_tags?.includes('production') ||
                         host.remote_mgr_tags?.includes('prod') ||
                         host.name.toLowerCase().includes('prod');

    if (isProduction) {
      const hasYubiKey = this.detectYubiKey();
      if (hasYubiKey) {
        const useHardware = await vscode.window.showWarningMessage(
          '⚠️ PRODUCTION SERVER DETECTED\n\n' +
          'For enhanced security, we recommend using a hardware security key (YubiKey) for production servers.\n\n' +
          'A YubiKey was detected on your system.',
          { modal: true },
          'Use YubiKey (Recommended)',
          'Use Regular Key',
          'Cancel'
        );

        if (useHardware === 'Cancel') {
          return false;
        }

        if (useHardware === 'Use YubiKey (Recommended)') {
          return this.bootstrapWithHardwareKey(host);
        }
      } else {
        const proceed = await vscode.window.showWarningMessage(
          '⚠️ PRODUCTION SERVER DETECTED\n\n' +
          'For enhanced security, consider using a hardware security key (YubiKey/FIDO2) for production servers.\n\n' +
          'No hardware key detected. You can still proceed with a regular SSH key.',
          { modal: true },
          'Proceed with Regular Key',
          'Cancel'
        );

        if (proceed !== 'Proceed with Regular Key') {
          return false;
        }
      }
    }

    // Step 1: Check for existing SSH keys
    const existingKeys = this.findExistingKeys();

    let selectedKey: SshKeyInfo;

    if (existingKeys.length > 0) {
      // Ask user to select existing key or generate new
      const choice = await this.promptKeyChoice(existingKeys);
      if (!choice) {
        return false;
      }

      if (choice === 'generate') {
        const newKey = await this.generateNewKey();
        if (!newKey) {
          return false;
        }
        selectedKey = newKey;
      } else {
        selectedKey = choice;
      }
    } else {
      // No existing keys, offer to generate
      const generate = await vscode.window.showInformationMessage(
        'No SSH keys found. Would you like to generate a new SSH key?',
        'Generate Key',
        'Cancel'
      );

      if (generate !== 'Generate Key') {
        return false;
      }

      const newKey = await this.generateNewKey();
      if (!newKey) {
        return false;
      }
      selectedKey = newKey;
    }

    // Step 2: Get password for ssh-copy-id
    const sshHost = host.ansible_host || host.name;
    const sshUser = host.ansible_user || await this.promptForUsername();

    if (!sshUser) {
      return false;
    }

    const password = await vscode.window.showInputBox({
      prompt: `Enter SSH password for ${sshUser}@${sshHost} (one-time, to copy the key)`,
      password: true,
      placeHolder: 'Password',
    });

    if (!password) {
      void vscode.window.showWarningMessage('Password required to copy SSH key to server');
      return false;
    }

    // Step 3: Copy public key to server
    const copySuccess = await this.copyKeyToServer(
      selectedKey,
      sshUser,
      sshHost,
      host.ansible_port,
      password
    );

    if (!copySuccess) {
      return false;
    }

    // Step 4: Create credential with SSH key
    const credential = await this.createSshKeyCredential(selectedKey, sshUser, host.name);
    if (!credential) {
      return false;
    }

    // Step 5: Assign credential and identity file to host
    await this.assignCredentialToHost(host, credential.id, credential.identityFile);

    // Step 6: Offer to add key to ssh-agent (for passphrase caching)
    await this.promptAddToAgent(selectedKey);

    void vscode.window.showInformationMessage(
      `SSH key authentication configured for ${host.name}. You can now connect without a password!`
    );

    logger.info(`[SshKeyBootstrap] Successfully bootstrapped SSH key for: ${host.name}`);
    return true;
  }

  /**
   * Find existing SSH keys in ~/.ssh
   */
  private findExistingKeys(): SshKeyInfo[] {
    const sshDir = path.join(os.homedir(), '.ssh');
    const keys: SshKeyInfo[] = [];

    const keyTypes: { type: SshKeyType; filename: string }[] = [
      { type: 'ed25519', filename: 'id_ed25519' },
      { type: 'rsa', filename: 'id_rsa' },
      { type: 'ecdsa', filename: 'id_ecdsa' },
    ];

    for (const { type, filename } of keyTypes) {
      const privateKeyPath = path.join(sshDir, filename);
      const publicKeyPath = path.join(sshDir, `${filename}.pub`);

      if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
        keys.push({
          type,
          privateKeyPath,
          publicKeyPath,
          exists: true,
        });
      }
    }

    return keys;
  }

  /**
   * Prompt user to select a key or generate new
   */
  private async promptKeyChoice(existingKeys: SshKeyInfo[]): Promise<SshKeyInfo | 'generate' | undefined> {
    const items: (vscode.QuickPickItem & { key?: SshKeyInfo; action?: string })[] = existingKeys.map(key => ({
      label: `$(key) ${key.type.toUpperCase()}`,
      description: key.privateKeyPath,
      detail: 'Use this existing key',
      key,
    }));

    items.push({
      label: '$(add) Generate New Key',
      description: 'Create a new SSH key pair',
      action: 'generate',
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an SSH key to use or generate a new one',
    });

    if (!selected) {
      return undefined;
    }

    if (selected.action === 'generate') {
      return 'generate';
    }

    return selected.key;
  }

  /**
   * Generate a new SSH key
   */
  private async generateNewKey(): Promise<SshKeyInfo | undefined> {
    // Ask for key type
    const keyType = await vscode.window.showQuickPick(
      [
        { label: 'ED25519 (Recommended)', description: 'Modern, secure, fast', type: 'ed25519' as SshKeyType },
        { label: 'RSA 4096', description: 'Traditional, widely compatible', type: 'rsa' as SshKeyType },
        { label: 'ECDSA', description: 'Elliptic curve', type: 'ecdsa' as SshKeyType },
      ],
      { placeHolder: 'Select key type' }
    );

    if (!keyType) {
      return undefined;
    }

    // Ask for passphrase (optional)
    const passphrase = await vscode.window.showInputBox({
      prompt: 'Enter passphrase for the key (leave empty for no passphrase)',
      password: true,
      placeHolder: 'Passphrase (optional)',
    });

    if (passphrase === undefined) {
      return undefined;
    }

    // Ask for comment
    const comment = await vscode.window.showInputBox({
      prompt: 'Enter a comment/label for this key',
      value: `${os.userInfo().username}@${os.hostname()}`,
      placeHolder: 'user@hostname',
    });

    if (comment === undefined) {
      return undefined;
    }

    const sshDir = path.join(os.homedir(), '.ssh');
    const filename = `id_${keyType.type}`;
    const privateKeyPath = path.join(sshDir, filename);
    const publicKeyPath = `${privateKeyPath}.pub`;

    // Check if key already exists
    if (fs.existsSync(privateKeyPath)) {
      const overwrite = await vscode.window.showWarningMessage(
        `Key ${filename} already exists. Overwrite?`,
        { modal: true },
        'Overwrite',
        'Cancel'
      );

      if (overwrite !== 'Overwrite') {
        return undefined;
      }
    }

    // Ensure .ssh directory exists
    if (!fs.existsSync(sshDir)) {
      fs.mkdirSync(sshDir, { mode: 0o700 });
    }

    // Generate key using ssh-keygen
    return new Promise((resolve) => {
      const args = [
        '-t', keyType.type,
        '-f', privateKeyPath,
        '-C', comment,
        '-N', passphrase,
      ];

      // Add bits for RSA
      if (keyType.type === 'rsa') {
        args.push('-b', '4096');
      }

      logger.info(`[SshKeyBootstrap] Generating ${keyType.type} key at ${privateKeyPath}`);

      const keygen = spawn('ssh-keygen', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      keygen.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      keygen.on('close', (code) => {
        if (code === 0) {
          void vscode.window.showInformationMessage(`SSH key generated: ${privateKeyPath}`);
          resolve({
            type: keyType.type,
            privateKeyPath,
            publicKeyPath,
            exists: true,
          });
        } else {
          logger.error(`[SshKeyBootstrap] ssh-keygen failed:`, stderr);
          void vscode.window.showErrorMessage(`Failed to generate SSH key: ${stderr}`);
          resolve(undefined);
        }
      });

      keygen.on('error', (error) => {
        logger.error(`[SshKeyBootstrap] ssh-keygen error:`, error);
        void vscode.window.showErrorMessage(`Failed to run ssh-keygen: ${error.message}`);
        resolve(undefined);
      });
    });
  }

  /**
   * Copy public key to server using ssh-copy-id (or sshpass + ssh-copy-id)
   */
  private async copyKeyToServer(
    key: SshKeyInfo,
    user: string,
    host: string,
    port?: number,
    password?: string
  ): Promise<boolean> {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Copying SSH key to ${user}@${host}...`,
      cancellable: false,
    }, async () => {
      return new Promise((resolve) => {
        const sshCopyIdArgs = ['-i', key.publicKeyPath];

        if (port && port !== 22) {
          sshCopyIdArgs.push('-p', String(port));
        }

        // Add host key checking option to auto-accept new hosts
        sshCopyIdArgs.push('-o', 'StrictHostKeyChecking=accept-new');

        sshCopyIdArgs.push(`${user}@${host}`);

        let command: string;
        let args: string[];
        const env = { ...process.env };

        if (password) {
          // Use sshpass for non-interactive password entry
          command = 'sshpass';
          args = ['-e', 'ssh-copy-id', ...sshCopyIdArgs];
          env.SSHPASS = password;
        } else {
          command = 'ssh-copy-id';
          args = sshCopyIdArgs;
        }

        logger.info(`[SshKeyBootstrap] Running: ${command} ${args.join(' ')} (password hidden)`);

        const proc = spawn(command, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        proc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            logger.info(`[SshKeyBootstrap] Key copied successfully`);
            void vscode.window.showInformationMessage('SSH key copied to server successfully!');
            resolve(true);
          } else {
            logger.error(`[SshKeyBootstrap] ssh-copy-id failed:`, stderr || stdout);

            // Parse common errors
            let errorMsg = 'Failed to copy SSH key to server';
            if (stderr.includes('Permission denied')) {
              errorMsg = 'Permission denied - check your password';
            } else if (stderr.includes('Connection refused')) {
              errorMsg = 'Connection refused - check host and port';
            } else if (stderr.includes('No route to host')) {
              errorMsg = 'Cannot reach host - check network';
            } else if (stderr.includes('sshpass')) {
              errorMsg = 'sshpass not installed. Install with: brew install hudochenkov/sshpass/sshpass';
            }

            void vscode.window.showErrorMessage(errorMsg);
            resolve(false);
          }
        });

        proc.on('error', (error) => {
          logger.error(`[SshKeyBootstrap] Process error:`, error);

          let errorMsg = `Failed to run ssh-copy-id: ${error.message}`;
          if (error.message.includes('ENOENT')) {
            if (password) {
              errorMsg = 'sshpass not found. Install with: brew install hudochenkov/sshpass/sshpass';
            } else {
              errorMsg = 'ssh-copy-id not found. Please install OpenSSH.';
            }
          }

          void vscode.window.showErrorMessage(errorMsg);
          resolve(false);
        });
      });
    });
  }

  /**
   * Create a credential entry for the SSH key
   * Note: The identity file path is stored on the host, not the credential
   */
  private async createSshKeyCredential(
    key: SshKeyInfo,
    username: string,
    hostName: string
  ): Promise<{ id: string; identityFile: string } | undefined> {
    const credentialId = `ssh-key-${hostName}-${Date.now()}`;
    const credentialName = `SSH Key for ${hostName}`;

    try {
      await this.credentialService.saveCredential({
        id: credentialId,
        name: credentialName,
        username,
        strategy: 'save',
        category: 'ssh',
        // No password - using key-based auth
      });

      logger.info(`[SshKeyBootstrap] Created credential: ${credentialId}`);
      return { id: credentialId, identityFile: key.privateKeyPath };
    } catch (error) {
      logger.error(`[SshKeyBootstrap] Failed to create credential:`, error);
      void vscode.window.showErrorMessage('Failed to save SSH key credential');
      return undefined;
    }
  }

  /**
   * Assign credential and identity file to host
   */
  private async assignCredentialToHost(host: AnsibleHost, credentialId: string, identityFile: string): Promise<void> {
    // Update the host with the new credential and identity file
    host.remote_mgr_credential_id = credentialId;
    host.remote_mgr_identity_file = identityFile;

    // Find the source and update
    const sources = this.inventoryManager.getSources();
    for (const source of sources) {
      if (source.readOnly || !source.inventory) continue;

      for (const group of source.inventory.groups) {
        const hostIndex = group.hosts.findIndex((h: AnsibleHost) => h.name === host.name);
        if (hostIndex !== -1) {
          group.hosts[hostIndex] = { ...host };
          this.inventoryManager.saveInventoryFile(source);
          logger.info(`[SshKeyBootstrap] Assigned credential ${credentialId} to host ${host.name}`);
          return;
        }
      }

      const ungroupedIndex = source.inventory.ungroupedHosts.findIndex((h: AnsibleHost) => h.name === host.name);
      if (ungroupedIndex !== -1) {
        source.inventory.ungroupedHosts[ungroupedIndex] = { ...host };
        this.inventoryManager.saveInventoryFile(source);
        logger.info(`[SshKeyBootstrap] Assigned credential ${credentialId} to host ${host.name}`);
        return;
      }
    }

    logger.warn(`[SshKeyBootstrap] Could not find host ${host.name} in any writable source`);
  }

  /**
   * Prompt for username
   */
  private async promptForUsername(): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: 'Enter SSH username',
      value: os.userInfo().username,
      placeHolder: 'Username',
    });
  }

  /**
   * Detect if a YubiKey or FIDO2 hardware key is connected
   */
  private detectYubiKey(): boolean {
    try {
      // Check for YubiKey using ykman (YubiKey Manager)
      execSync('which ykman', { stdio: 'ignore' });
      const result = execSync('ykman list', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (result.trim().length > 0) {
        logger.info('[SshKeyBootstrap] YubiKey detected via ykman');
        return true;
      }
    } catch {
      // ykman not installed or no YubiKey
    }

    try {
      // Check for FIDO2 keys using system_profiler on macOS
      if (process.platform === 'darwin') {
        const result = execSync('system_profiler SPUSBDataType 2>/dev/null | grep -i "yubikey\\|fido"', {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (result.trim().length > 0) {
          logger.info('[SshKeyBootstrap] YubiKey detected via system_profiler');
          return true;
        }
      }
    } catch {
      // No YubiKey found
    }

    return false;
  }

  /**
   * Bootstrap with hardware security key (YubiKey/FIDO2)
   */
  private async bootstrapWithHardwareKey(host: AnsibleHost): Promise<boolean> {
    logger.info(`[SshKeyBootstrap] Starting hardware key bootstrap for: ${host.name}`);

    // Check for existing hardware-backed keys
    const sshDir = path.join(os.homedir(), '.ssh');
    const skKeyTypes: { type: SshKeyType; filename: string }[] = [
      { type: 'ed25519-sk', filename: 'id_ed25519_sk' },
      { type: 'ecdsa-sk', filename: 'id_ecdsa_sk' },
    ];

    const existingSkKeys: SshKeyInfo[] = [];
    for (const { type, filename } of skKeyTypes) {
      const privateKeyPath = path.join(sshDir, filename);
      const publicKeyPath = `${privateKeyPath}.pub`;
      if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
        existingSkKeys.push({
          type,
          privateKeyPath,
          publicKeyPath,
          exists: true,
          isHardwareKey: true,
        });
      }
    }

    let selectedKey: SshKeyInfo;

    if (existingSkKeys.length > 0) {
      // Offer existing hardware keys or generate new
      const items: (vscode.QuickPickItem & { key?: SshKeyInfo; action?: string })[] = existingSkKeys.map(key => ({
        label: `$(key) ${key.type.toUpperCase()} (Hardware Key)`,
        description: key.privateKeyPath,
        detail: 'Use this existing hardware-backed key',
        key,
      }));

      items.push({
        label: '$(add) Generate New Hardware Key',
        description: 'Create a new FIDO2/YubiKey-backed SSH key',
        action: 'generate',
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a hardware-backed key or generate new',
      });

      if (!selected) {
        return false;
      }

      if (selected.action === 'generate') {
        const newKey = await this.generateHardwareKey();
        if (!newKey) {
          return false;
        }
        selectedKey = newKey;
      } else {
        selectedKey = selected.key!;
      }
    } else {
      // No existing hardware keys, generate new
      const generate = await vscode.window.showInformationMessage(
        'No hardware-backed SSH keys found. Would you like to generate one?\n\n' +
        'You will need to touch your YubiKey during generation.',
        'Generate Hardware Key',
        'Cancel'
      );

      if (generate !== 'Generate Hardware Key') {
        return false;
      }

      const newKey = await this.generateHardwareKey();
      if (!newKey) {
        return false;
      }
      selectedKey = newKey;
    }

    // Continue with standard flow for copying key to server
    const sshHost = host.ansible_host || host.name;
    const sshUser = host.ansible_user || await this.promptForUsername();

    if (!sshUser) {
      return false;
    }

    const password = await vscode.window.showInputBox({
      prompt: `Enter SSH password for ${sshUser}@${sshHost} (one-time, to copy the key)`,
      password: true,
      placeHolder: 'Password',
    });

    if (!password) {
      void vscode.window.showWarningMessage('Password required to copy SSH key to server');
      return false;
    }

    const copySuccess = await this.copyKeyToServer(
      selectedKey,
      sshUser,
      sshHost,
      host.ansible_port,
      password
    );

    if (!copySuccess) {
      return false;
    }

    const credential = await this.createSshKeyCredential(selectedKey, sshUser, host.name);
    if (!credential) {
      return false;
    }

    await this.assignCredentialToHost(host, credential.id, credential.identityFile);

    void vscode.window.showInformationMessage(
      `Hardware key authentication configured for ${host.name}.\n` +
      'You will need to touch your YubiKey when connecting.'
    );

    return true;
  }

  /**
   * Generate a new hardware-backed SSH key (FIDO2/YubiKey)
   */
  private async generateHardwareKey(): Promise<SshKeyInfo | undefined> {
    const keyType = await vscode.window.showQuickPick(
      [
        { label: 'ED25519-SK (Recommended)', description: 'Modern, requires OpenSSH 8.2+', type: 'ed25519-sk' as SshKeyType },
        { label: 'ECDSA-SK', description: 'Wider compatibility', type: 'ecdsa-sk' as SshKeyType },
      ],
      { placeHolder: 'Select hardware key type' }
    );

    if (!keyType) {
      return undefined;
    }

    // Ask if resident key (stored on YubiKey)
    const resident = await vscode.window.showQuickPick(
      [
        { label: 'Discoverable (Resident)', description: 'Key stored on YubiKey, portable', resident: true },
        { label: 'Non-Resident', description: 'Key file required, more secure', resident: false },
      ],
      { placeHolder: 'Key storage type' }
    );

    if (!resident) {
      return undefined;
    }

    const comment = await vscode.window.showInputBox({
      prompt: 'Enter a comment/label for this key',
      value: `${os.userInfo().username}@${os.hostname()}-yubikey`,
      placeHolder: 'user@hostname-yubikey',
    });

    if (comment === undefined) {
      return undefined;
    }

    const sshDir = path.join(os.homedir(), '.ssh');
    const filename = `id_${keyType.type}`;
    const privateKeyPath = path.join(sshDir, filename);
    const publicKeyPath = `${privateKeyPath}.pub`;

    // Ensure .ssh directory exists
    if (!fs.existsSync(sshDir)) {
      fs.mkdirSync(sshDir, { mode: 0o700 });
    }

    void vscode.window.showInformationMessage(
      'Please touch your YubiKey when it blinks to generate the key...'
    );

    return new Promise((resolve) => {
      const args = [
        '-t', keyType.type,
        '-f', privateKeyPath,
        '-C', comment,
        '-N', '', // No passphrase for hardware keys (hardware provides protection)
      ];

      if (resident.resident) {
        args.push('-O', 'resident');
      }

      logger.info(`[SshKeyBootstrap] Generating ${keyType.type} hardware key at ${privateKeyPath}`);

      const keygen = spawn('ssh-keygen', args, {
        stdio: ['inherit', 'pipe', 'pipe'], // inherit stdin for YubiKey touch
      });

      let stderr = '';

      keygen.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      keygen.on('close', (code) => {
        if (code === 0) {
          void vscode.window.showInformationMessage(`Hardware SSH key generated: ${privateKeyPath}`);
          resolve({
            type: keyType.type,
            privateKeyPath,
            publicKeyPath,
            exists: true,
            isHardwareKey: true,
          });
        } else {
          logger.error(`[SshKeyBootstrap] ssh-keygen failed:`, stderr);
          void vscode.window.showErrorMessage(
            `Failed to generate hardware key: ${stderr || 'Unknown error'}\n\n` +
            'Make sure your YubiKey is connected and supports FIDO2.'
          );
          resolve(undefined);
        }
      });

      keygen.on('error', (error) => {
        logger.error(`[SshKeyBootstrap] ssh-keygen error:`, error);
        void vscode.window.showErrorMessage(`Failed to run ssh-keygen: ${error.message}`);
        resolve(undefined);
      });
    });
  }

  /**
   * Add key to ssh-agent for passphrase caching
   */
  async addKeyToSshAgent(keyPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      // Check if ssh-agent is running
      if (!process.env.SSH_AUTH_SOCK) {
        logger.warn('[SshKeyBootstrap] SSH_AUTH_SOCK not set, ssh-agent may not be running');
        void vscode.window.showWarningMessage(
          'ssh-agent does not appear to be running.\n\n' +
          'To start ssh-agent, add this to your shell profile:\n' +
          'eval "$(ssh-agent -s)"'
        );
        resolve(false);
        return;
      }

      void vscode.window.showInformationMessage(
        'Adding key to ssh-agent. You may be prompted for your passphrase...'
      );

      const sshAdd = spawn('ssh-add', [keyPath], {
        stdio: ['inherit', 'pipe', 'pipe'], // inherit stdin for passphrase
      });

      let stderr = '';

      sshAdd.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      sshAdd.on('close', (code) => {
        if (code === 0) {
          logger.info(`[SshKeyBootstrap] Key added to ssh-agent: ${keyPath}`);
          void vscode.window.showInformationMessage('Key added to ssh-agent successfully!');
          resolve(true);
        } else {
          logger.error(`[SshKeyBootstrap] ssh-add failed:`, stderr);
          void vscode.window.showErrorMessage(`Failed to add key to ssh-agent: ${stderr}`);
          resolve(false);
        }
      });

      sshAdd.on('error', (error) => {
        logger.error(`[SshKeyBootstrap] ssh-add error:`, error);
        void vscode.window.showErrorMessage(`Failed to run ssh-add: ${error.message}`);
        resolve(false);
      });
    });
  }

  /**
   * Check if key is already in ssh-agent
   */
  isKeyInAgent(keyPath: string): boolean {
    try {
      const result = execSync('ssh-add -l', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      return result.includes(keyPath) || result.includes(path.basename(keyPath));
    } catch {
      return false;
    }
  }

  /**
   * Prompt to add key to ssh-agent after generation
   */
  async promptAddToAgent(key: SshKeyInfo): Promise<void> {
    if (key.isHardwareKey) {
      // Hardware keys don't need ssh-agent for passphrase caching
      return;
    }

    const addToAgent = await vscode.window.showInformationMessage(
      'Would you like to add this key to ssh-agent?\n\n' +
      'This will cache your passphrase so you don\'t have to enter it every time.',
      'Add to ssh-agent',
      'Skip'
    );

    if (addToAgent === 'Add to ssh-agent') {
      await this.addKeyToSshAgent(key.privateKeyPath);
    }
  }
}

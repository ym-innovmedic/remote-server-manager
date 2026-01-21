import * as vscode from 'vscode';
import { logger } from '../utils/Logger';
import { Credential, JsonCredential, convertJsonCredential } from '../models/Credential';
import { CredentialStrategy } from '../models/Connection';

const CREDENTIAL_PREFIX = 'remoteServerManager.credential.';
const CREDENTIAL_LIST_KEY = 'remoteServerManager.credentialList';

/**
 * Migration result for JSON import
 */
export interface MigrationResult {
  success: boolean;
  migrated: number;
  failed: number;
  errors: string[];
}

/**
 * Stored credential data (without password, as JSON)
 */
interface StoredCredentialData {
  id: string;
  name: string;
  username: string;
  domain?: string;
  strategy: CredentialStrategy;
  category?: 'rdp' | 'ssh' | 'sftp' | 'ftp';
  createdAt?: string;
  modifiedAt?: string;
}

/**
 * Service for managing credentials using VS Code Secrets API
 */
export class CredentialService {
  constructor(private secrets: vscode.SecretStorage) {}

  /**
   * Save a credential
   */
  async saveCredential(credential: Credential): Promise<void> {
    logger.info('[CredentialService] Saving credential:', {
      id: credential.id,
      username: credential.username,
      strategy: credential.strategy,
      category: credential.category,
      hasPassword: !!credential.password,
    });

    // Store the credential data (without password)
    const credentialData = {
      id: credential.id,
      name: credential.name,
      username: credential.username,
      domain: credential.domain,
      strategy: credential.strategy,
      category: credential.category,
      createdAt: credential.createdAt?.toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    await this.secrets.store(
      CREDENTIAL_PREFIX + credential.id,
      JSON.stringify(credentialData)
    );

    // Store password separately if strategy is 'save'
    if (credential.strategy === 'save' && credential.password) {
      logger.info('[CredentialService] Storing password for:', credential.id);
      await this.secrets.store(
        CREDENTIAL_PREFIX + credential.id + '.password',
        credential.password
      );
    } else {
      logger.info('[CredentialService] NOT storing password. Strategy:', credential.strategy, 'Has password:', !!credential.password);
    }

    // Update credential list
    await this.addToCredentialList(credential.id);
    logger.info('[CredentialService] Credential saved successfully:', credential.id);
  }

  /**
   * Get a credential by ID
   */
  async getCredential(id: string): Promise<Credential | undefined> {
    logger.info('[CredentialService] Getting credential:', id);
    const data = await this.secrets.get(CREDENTIAL_PREFIX + id);
    if (!data) {
      logger.info('[CredentialService] No credential data found for:', id);
      return undefined;
    }

    try {
      const credentialData = JSON.parse(data) as StoredCredentialData;
      const credential: Credential = {
        id: credentialData.id,
        name: credentialData.name,
        username: credentialData.username,
        domain: credentialData.domain,
        strategy: credentialData.strategy,
        category: credentialData.category ?? 'ssh',
        createdAt: credentialData.createdAt ? new Date(credentialData.createdAt) : undefined,
        modifiedAt: credentialData.modifiedAt ? new Date(credentialData.modifiedAt) : undefined,
      };

      // Get password if strategy is 'save'
      if (credential.strategy === 'save') {
        credential.password = await this.secrets.get(CREDENTIAL_PREFIX + id + '.password');
        logger.info('[CredentialService] Retrieved password for', id, ':', credential.password ? 'YES' : 'NO');
      }

      logger.info('[CredentialService] Loaded credential:', {
        id: credential.id,
        username: credential.username,
        strategy: credential.strategy,
        hasPassword: !!credential.password,
      });

      return credential;
    } catch {
      logger.error(`[CredentialService] Failed to parse credential: ${id}`);
      return undefined;
    }
  }

  /**
   * Prompt for password
   */
  async promptForPassword(username: string, domain?: string): Promise<string | undefined> {
    const prompt = domain
      ? `Enter password for ${domain}\\${username}`
      : `Enter password for ${username}`;

    return vscode.window.showInputBox({
      prompt,
      password: true,
      ignoreFocusOut: true,
    });
  }

  /**
   * Prompt for username
   */
  async promptForUsername(): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: 'Enter username',
      ignoreFocusOut: true,
    });
  }

  /**
   * Delete a credential
   */
  async deleteCredential(id: string): Promise<void> {
    await this.secrets.delete(CREDENTIAL_PREFIX + id);
    await this.secrets.delete(CREDENTIAL_PREFIX + id + '.password');
    await this.removeFromCredentialList(id);
  }

  /**
   * List all credentials
   */
  async listCredentials(): Promise<Credential[]> {
    const ids = await this.getCredentialList();
    const credentials: Credential[] = [];

    for (const id of ids) {
      const credential = await this.getCredential(id);
      if (credential) {
        credentials.push(credential);
      }
    }

    return credentials;
  }

  /**
   * Migrate credentials from JSON import
   */
  async migrateFromJson(
    jsonCredentials: JsonCredential[],
    defaultStrategy: CredentialStrategy = 'save'
  ): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      migrated: 0,
      failed: 0,
      errors: [],
    };

    for (const jsonCred of jsonCredentials) {
      try {
        const credential = convertJsonCredential(jsonCred, defaultStrategy);
        await this.saveCredential(credential);
        result.migrated++;
      } catch (error) {
        result.failed++;
        result.errors.push(`Failed to migrate credential ${jsonCred.id}: ${String(error)}`);
      }
    }

    result.success = result.failed === 0;
    return result;
  }

  /**
   * Create and save a credential quickly
   * @param label Optional label to identify environment (e.g., "PROD", "DEV")
   */
  async createAndSaveCredential(
    username: string,
    domain: string | undefined,
    strategy: CredentialStrategy,
    password?: string,
    category: 'rdp' | 'ssh' | 'sftp' | 'ftp' = 'ssh',
    label?: string
  ): Promise<Credential> {
    // Create a descriptive name including category and optional label
    const categoryLabel = category.toUpperCase();
    const domainPart = domain ? ` (${domain})` : '';
    const envPart = label ? ` [${label}]` : '';
    const name = `${username}${domainPart} - ${categoryLabel}${envPart}`;

    const credential: Credential = {
      id: `cred_${category}_${Date.now()}`,
      name,
      username,
      domain,
      strategy,
      password,
      category,
      createdAt: new Date(),
    };
    await this.saveCredential(credential);
    return credential;
  }

  /**
   * Get credential for SSH/SFTP/FTP connection with smart reuse
   */
  async getCredentialForSsh(
    credentialId: string | undefined,
    hostName: string
  ): Promise<{ credential: Credential; username: string; password?: string } | undefined> {
    // 1. Check for stored credential on this host
    if (credentialId) {
      const credential = await this.getCredential(credentialId);
      if (credential) {
        return {
          credential,
          username: credential.username,
          password: credential.password,
        };
      }
    }

    // 2. Check for existing credentials to reuse
    const existingCredentials = await this.listCredentials();

    if (existingCredentials.length > 0) {
      // Sort credentials: SSH/SFTP/FTP first for SSH connections
      const sortedCredentials = [...existingCredentials].sort((a, b) => {
        const aIsSsh = a.category === 'ssh' || a.category === 'sftp' || a.category === 'ftp';
        const bIsSsh = b.category === 'ssh' || b.category === 'sftp' || b.category === 'ftp';
        if (aIsSsh && !bIsSsh) {return -1;}
        if (!aIsSsh && bIsSsh) {return 1;}
        return 0;
      });

      const items = [
        { label: '$(add) Enter new credentials...', id: '__new__' },
        ...sortedCredentials.map(c => {
          const typeIcon = this.getCredentialTypeIcon(c.category);
          const typeLabel = (c.category || 'ssh').toUpperCase();
          return {
            label: `${typeIcon} ${c.username}`,
            description: `[${typeLabel}] ${c.domain ? `${c.domain}\\` : ''}${c.password ? '• password saved' : '• username only'}`,
            detail: c.name,
            id: c.id,
            credential: c,
          };
        }),
      ];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select credentials for ${hostName}`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selected) {
        return undefined;
      }

      if (selected.id !== '__new__' && 'credential' in selected) {
        const cred = selected.credential;
        return {
          credential: cred,
          username: cred.username,
          password: cred.password,
        };
      }
    }

    // 3. Prompt for new credentials
    const username = await this.promptForUsername();
    if (!username) {
      return undefined;
    }

    const password = await this.promptForPassword(username);

    // 4. Offer to save
    const save = await vscode.window.showQuickPick(
      [
        { label: '$(check) Yes, save credentials', save: true },
        { label: '$(x) No, just this once', save: false },
      ],
      { placeHolder: 'Save credentials for future connections?' }
    );

    if (save?.save) {
      // Ask for a label to identify this credential (e.g., "PROD", "DEV", etc.)
      const label = await vscode.window.showInputBox({
        prompt: 'Enter a label to identify these credentials (e.g., PROD, DEV, staging)',
        placeHolder: 'Optional - press Enter to skip',
        value: '',
      });

      const credential = await this.createAndSaveCredential(
        username,
        undefined,
        password ? 'save' : 'prompt',
        password,
        'ssh',
        label || undefined
      );
      return { credential, username, password };
    }

    // Return without saving
    return {
      credential: { id: '', name: '', username, strategy: 'prompt', category: 'ssh' },
      username,
      password,
    };
  }

  /**
   * Get credential for RDP connection with smart reuse
   */
  async getCredentialForRdp(
    credentialId: string | undefined,
    hostName: string
  ): Promise<{ credential: Credential; username: string; password: string; domain?: string } | undefined> {
    // 1. Check for stored credential on this host
    if (credentialId) {
      const credential = await this.getCredential(credentialId);
      if (credential && credential.strategy === 'save' && credential.password) {
        return {
          credential,
          username: credential.username,
          password: credential.password,
          domain: credential.domain,
        };
      }
    }

    // 2. Check for existing credentials to reuse (show all with saved passwords)
    const existingCredentials = await this.listCredentials();
    const credentialsWithPassword = existingCredentials.filter(c => c.strategy === 'save' && c.password);

    if (credentialsWithPassword.length > 0) {
      // Sort credentials: RDP first for RDP connections
      const sortedCredentials = [...credentialsWithPassword].sort((a, b) => {
        if (a.category === 'rdp' && b.category !== 'rdp') {return -1;}
        if (a.category !== 'rdp' && b.category === 'rdp') {return 1;}
        return 0;
      });

      const items = [
        { label: '$(add) Enter new credentials...', id: '__new__' },
        ...sortedCredentials.map(c => {
          const typeIcon = this.getCredentialTypeIcon(c.category);
          const typeLabel = (c.category || 'ssh').toUpperCase();
          return {
            label: `${typeIcon} ${c.domain ? `${c.domain}\\` : ''}${c.username}`,
            description: `[${typeLabel}] • password saved`,
            detail: c.name,
            id: c.id,
            credential: c,
          };
        }),
      ];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Select credentials for ${hostName} (RDP)`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selected) {
        return undefined;
      }

      if (selected.id !== '__new__' && 'credential' in selected) {
        const cred = selected.credential;
        return {
          credential: cred,
          username: cred.username,
          password: cred.password!,
          domain: cred.domain,
        };
      }
    }

    // 3. Prompt for new credentials
    const username = await this.promptForUsername();
    if (!username) {
      return undefined;
    }

    const domain = await vscode.window.showInputBox({
      prompt: 'Domain (optional)',
      placeHolder: 'Leave empty for no domain',
    });

    const password = await this.promptForPassword(username, domain || undefined);
    if (!password) {
      return undefined;
    }

    // 4. Offer to save
    const save = await vscode.window.showQuickPick(
      [
        { label: '$(check) Yes, save for future connections', save: true },
        { label: '$(x) No, just this once', save: false },
      ],
      { placeHolder: 'Save credentials securely?' }
    );

    if (save?.save) {
      // Ask for a label to identify this credential (e.g., "PROD", "DEV", etc.)
      const label = await vscode.window.showInputBox({
        prompt: 'Enter a label to identify these credentials (e.g., PROD, DEV, staging)',
        placeHolder: 'Optional - press Enter to skip',
        value: '',
      });

      const credential = await this.createAndSaveCredential(
        username,
        domain || undefined,
        'save',
        password,
        'rdp',
        label || undefined
      );
      return { credential, username, password, domain: domain || undefined };
    }

    // Return without saving
    return {
      credential: { id: '', name: '', username, strategy: 'prompt', category: 'rdp' },
      username,
      password,
      domain: domain || undefined,
    };
  }

  /**
   * Get credential for a connection, prompting if needed (legacy - for backwards compatibility)
   */
  async getCredentialForConnection(
    credentialId: string | undefined,
    _strategy: CredentialStrategy | undefined
  ): Promise<{ username: string; password: string; domain?: string } | undefined> {
    // If we have a credential ID, try to load it
    if (credentialId) {
      const credential = await this.getCredential(credentialId);
      if (credential) {
        // If strategy is 'save' and we have password, return it
        if (credential.strategy === 'save' && credential.password) {
          return {
            username: credential.username,
            password: credential.password,
            domain: credential.domain,
          };
        }
        // Otherwise prompt for password
        const password = await this.promptForPassword(credential.username, credential.domain);
        if (password) {
          return {
            username: credential.username,
            password,
            domain: credential.domain,
          };
        }
        return undefined;
      }
    }

    // No credential ID or credential not found - prompt for everything
    const username = await this.promptForUsername();
    if (!username) {
      return undefined;
    }

    const password = await this.promptForPassword(username);
    if (!password) {
      return undefined;
    }

    return { username, password };
  }

  /**
   * Get the list of credential IDs
   */
  private async getCredentialList(): Promise<string[]> {
    const data = await this.secrets.get(CREDENTIAL_LIST_KEY);
    if (!data) {
      return [];
    }
    try {
      return JSON.parse(data) as string[];
    } catch {
      return [];
    }
  }

  /**
   * Add an ID to the credential list
   */
  private async addToCredentialList(id: string): Promise<void> {
    const list = await this.getCredentialList();
    if (!list.includes(id)) {
      list.push(id);
      await this.secrets.store(CREDENTIAL_LIST_KEY, JSON.stringify(list));
    }
  }

  /**
   * Remove an ID from the credential list
   */
  private async removeFromCredentialList(id: string): Promise<void> {
    const list = await this.getCredentialList();
    const index = list.indexOf(id);
    if (index !== -1) {
      list.splice(index, 1);
      await this.secrets.store(CREDENTIAL_LIST_KEY, JSON.stringify(list));
    }
  }

  /**
   * Get VS Code icon for credential type
   */
  private getCredentialTypeIcon(category?: 'rdp' | 'ssh' | 'sftp' | 'ftp'): string {
    switch (category) {
      case 'rdp':
        return '$(remote-explorer)';  // Windows/RDP icon
      case 'ssh':
        return '$(terminal)';         // Terminal icon for SSH
      case 'sftp':
        return '$(cloud-upload)';     // File transfer icon
      case 'ftp':
        return '$(cloud)';            // Cloud icon (unsecure)
      default:
        return '$(key)';              // Default key icon
    }
  }
}

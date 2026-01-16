/**
 * AWS Credential Provider
 * Handles AWS authentication for EC2 discovery
 * v0.3.0
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  fromIni,
  fromEnv,
  fromNodeProviderChain,
} from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity, Provider } from '@aws-sdk/types';
import { AWS_REGIONS } from '../models/CloudSource';

/**
 * AWS credentials interface
 */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * AWS profile information
 */
export interface AwsProfile {
  name: string;
  region?: string;
  hasCredentials: boolean;
}

/**
 * Provides AWS credentials from various sources
 */
export class AwsCredentialProvider {
  private secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this.secretStorage = secretStorage;
  }

  /**
   * Get credential provider for AWS SDK
   * Tries in order: stored credentials, profile, environment, default chain
   */
  async getCredentialProvider(profile?: string): Promise<Provider<AwsCredentialIdentity>> {
    // Check for stored credentials first
    const stored = await this.getStoredCredentials();
    if (stored) {
      return () => Promise.resolve({
        accessKeyId: stored.accessKeyId,
        secretAccessKey: stored.secretAccessKey,
        sessionToken: stored.sessionToken,
      });
    }

    // Use profile if specified
    if (profile) {
      return fromIni({ profile });
    }

    // Try environment variables
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      return fromEnv();
    }

    // Fall back to default provider chain (includes IAM roles, etc.)
    return fromNodeProviderChain();
  }

  /**
   * List available AWS profiles from ~/.aws/credentials and ~/.aws/config
   */
  listProfiles(): AwsProfile[] {
    const profiles: AwsProfile[] = [];
    const awsDir = path.join(os.homedir(), '.aws');

    // Parse credentials file
    const credentialsPath = path.join(awsDir, 'credentials');
    if (fs.existsSync(credentialsPath)) {
      const content = fs.readFileSync(credentialsPath, 'utf-8');
      const credentialProfiles = this.parseIniFile(content);

      for (const name of Object.keys(credentialProfiles)) {
        const profile = credentialProfiles[name];
        profiles.push({
          name,
          hasCredentials: !!(profile.aws_access_key_id && profile.aws_secret_access_key),
        });
      }
    }

    // Parse config file for regions
    const configPath = path.join(awsDir, 'config');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const configProfiles = this.parseIniFile(content);

      for (const rawName of Object.keys(configProfiles)) {
        // Config file uses "profile name" format except for default
        const name = rawName.startsWith('profile ') ? rawName.substring(8) : rawName;
        const config = configProfiles[rawName];

        const existing = profiles.find(p => p.name === name);
        if (existing) {
          existing.region = config.region;
        } else {
          profiles.push({
            name,
            region: config.region,
            hasCredentials: false,
          });
        }
      }
    }

    return profiles;
  }

  /**
   * Parse INI file format
   */
  private parseIniFile(content: string): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    let currentSection = '';

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        continue;
      }

      // Section header
      const sectionMatch = trimmed.match(/^\[(.+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        result[currentSection] = {};
        continue;
      }

      // Key-value pair
      const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
      if (kvMatch && currentSection) {
        result[currentSection][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }

    return result;
  }

  /**
   * Prompt user for AWS credentials
   */
  async promptForCredentials(): Promise<AwsCredentials | undefined> {
    const accessKeyId = await vscode.window.showInputBox({
      prompt: 'Enter AWS Access Key ID',
      placeHolder: 'AKIAIOSFODNN7EXAMPLE',
      ignoreFocusOut: true,
    });

    if (!accessKeyId) {
      return undefined;
    }

    const secretAccessKey = await vscode.window.showInputBox({
      prompt: 'Enter AWS Secret Access Key',
      placeHolder: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      password: true,
      ignoreFocusOut: true,
    });

    if (!secretAccessKey) {
      return undefined;
    }

    const sessionToken = await vscode.window.showInputBox({
      prompt: 'Enter AWS Session Token (optional, for temporary credentials)',
      placeHolder: 'Leave empty if using permanent credentials',
      ignoreFocusOut: true,
    });

    return {
      accessKeyId,
      secretAccessKey,
      sessionToken: sessionToken || undefined,
    };
  }

  /**
   * Prompt user to select a profile
   */
  async promptForProfile(): Promise<string | undefined> {
    const profiles = this.listProfiles();

    if (profiles.length === 0) {
      const useManual = await vscode.window.showQuickPick(
        [
          { label: 'Enter credentials manually', value: 'manual' },
          { label: 'Cancel', value: 'cancel' },
        ],
        { placeHolder: 'No AWS profiles found in ~/.aws/' }
      );

      return useManual?.value === 'manual' ? '__manual__' : undefined;
    }

    const items = profiles.map(p => ({
      label: p.name,
      description: p.region ? `Region: ${p.region}` : undefined,
      detail: p.hasCredentials ? 'Has credentials' : 'No credentials (uses IAM role or other method)',
      profile: p,
    }));

    // Add manual entry option
    items.push({
      label: 'Enter credentials manually',
      description: 'Provide Access Key ID and Secret Key',
      detail: '',
      profile: { name: '__manual__', hasCredentials: true },
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select AWS profile',
    });

    return selected?.profile.name;
  }

  /**
   * Prompt user to select region(s)
   */
  async promptForRegions(multi: boolean = false): Promise<string[] | undefined> {
    const items = Object.entries(AWS_REGIONS).map(([code, name]) => ({
      label: code,
      description: name,
      picked: code === 'us-east-1', // Default selection
    }));

    if (multi) {
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select AWS regions to scan',
        canPickMany: true,
      });
      return selected?.map(s => s.label);
    } else {
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select AWS region',
      });
      return selected ? [selected.label] : undefined;
    }
  }

  /**
   * Store credentials securely
   */
  async storeCredentials(credentials: AwsCredentials): Promise<void> {
    await this.secretStorage.store(
      'aws-credentials',
      JSON.stringify(credentials)
    );
  }

  /**
   * Get stored credentials
   */
  async getStoredCredentials(): Promise<AwsCredentials | undefined> {
    const stored = await this.secretStorage.get('aws-credentials');
    if (stored) {
      try {
        return JSON.parse(stored) as AwsCredentials;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Clear stored credentials
   */
  async clearStoredCredentials(): Promise<void> {
    await this.secretStorage.delete('aws-credentials');
  }

  /**
   * Check if credentials are valid by making a test API call
   */
  async validateCredentials(profile?: string): Promise<boolean> {
    try {
      const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts');
      const credentialProvider = await this.getCredentialProvider(profile);

      const client = new STSClient({
        credentials: credentialProvider,
        region: 'us-east-1',
      });

      await client.send(new GetCallerIdentityCommand({}));
      return true;
    } catch {
      return false;
    }
  }
}

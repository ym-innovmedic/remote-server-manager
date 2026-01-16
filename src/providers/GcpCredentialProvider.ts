/**
 * GCP Credential Provider
 * Handles GCP authentication for Compute Engine discovery
 * v0.3.0
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GCP_REGIONS } from '../models/CloudSource';

const execAsync = promisify(exec);

/**
 * GCP credentials interface
 */
export interface GcpCredentials {
  projectId: string;
  keyFilePath?: string;
  useAdc?: boolean; // Application Default Credentials
}

/**
 * GCP project information
 */
export interface GcpProject {
  projectId: string;
  name?: string;
}

/**
 * Provides GCP credentials from various sources
 */
export class GcpCredentialProvider {
  private secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this.secretStorage = secretStorage;
  }

  /**
   * Get authentication options for GCP SDK
   */
  getAuthOptions(credentials: GcpCredentials): { projectId: string; keyFilename?: string } {
    const options: { projectId: string; keyFilename?: string } = {
      projectId: credentials.projectId,
    };

    if (credentials.keyFilePath && fs.existsSync(credentials.keyFilePath)) {
      options.keyFilename = credentials.keyFilePath;
    }
    // If using ADC, no keyFilename needed - SDK will auto-detect

    return options;
  }

  /**
   * List available GCP projects using gcloud CLI
   */
  async listProjects(): Promise<GcpProject[]> {
    try {
      const { stdout } = await execAsync('gcloud projects list --format="json"');
      const projects = JSON.parse(stdout) as Array<{ projectId: string; name: string }>;
      return projects.map(p => ({
        projectId: p.projectId,
        name: p.name,
      }));
    } catch (error) {
      console.warn('[GcpCredentialProvider] Failed to list projects via gcloud:', error);
      return [];
    }
  }

  /**
   * Get the current gcloud project
   */
  async getCurrentProject(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('gcloud config get-value project');
      const project = stdout.trim();
      return project || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if gcloud CLI is available
   */
  async isGcloudAvailable(): Promise<boolean> {
    try {
      await execAsync('gcloud --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Application Default Credentials are configured
   */
  hasApplicationDefaultCredentials(): boolean {
    const adcPath = path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
    return fs.existsSync(adcPath);
  }

  /**
   * Prompt user for GCP project
   */
  async promptForProject(): Promise<string | undefined> {
    const projects = await this.listProjects();

    if (projects.length === 0) {
      // No gcloud or no projects - ask for manual entry
      return vscode.window.showInputBox({
        prompt: 'Enter GCP Project ID',
        placeHolder: 'my-project-123',
        ignoreFocusOut: true,
      });
    }

    const currentProject = await this.getCurrentProject();

    const items = projects.map(p => ({
      label: p.projectId,
      description: p.name,
      picked: p.projectId === currentProject,
    }));

    // Add manual entry option
    items.push({
      label: 'Enter project ID manually',
      description: 'Type a project ID',
      picked: false,
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select GCP project',
    });

    if (!selected) {
      return undefined;
    }

    if (selected.label === 'Enter project ID manually') {
      return vscode.window.showInputBox({
        prompt: 'Enter GCP Project ID',
        placeHolder: 'my-project-123',
        ignoreFocusOut: true,
      });
    }

    return selected.label;
  }

  /**
   * Prompt user for authentication method
   */
  async promptForAuthMethod(): Promise<'adc' | 'service-account' | undefined> {
    const hasAdc = this.hasApplicationDefaultCredentials();
    const hasGcloud = await this.isGcloudAvailable();

    const items: Array<{ label: string; description: string; value: 'adc' | 'service-account' }> = [];

    if (hasAdc || hasGcloud) {
      items.push({
        label: 'Application Default Credentials (Recommended)',
        description: hasAdc ? 'ADC file found' : 'Using gcloud auth',
        value: 'adc',
      });
    }

    items.push({
      label: 'Service Account Key File',
      description: 'Select a JSON key file',
      value: 'service-account',
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select authentication method',
    });

    return selected?.value;
  }

  /**
   * Prompt user for service account key file
   */
  async promptForKeyFile(): Promise<string | undefined> {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'JSON files': ['json'],
        'All files': ['*'],
      },
      title: 'Select GCP Service Account Key File',
    });

    if (!fileUri || fileUri.length === 0) {
      return undefined;
    }

    const keyPath = fileUri[0].fsPath;

    // Validate it's a valid service account key
    try {
      const content = fs.readFileSync(keyPath, 'utf-8');
      const key = JSON.parse(content) as { type?: string };

      if (!key.type || key.type !== 'service_account') {
        void vscode.window.showErrorMessage('Invalid service account key file');
        return undefined;
      }

      return keyPath;
    } catch {
      void vscode.window.showErrorMessage('Failed to read key file');
      return undefined;
    }
  }

  /**
   * Prompt user to select zones
   */
  async promptForZones(): Promise<string[] | undefined> {
    const items = GCP_REGIONS.flatMap(region => [
      { label: `${region}-a`, description: region },
      { label: `${region}-b`, description: region },
      { label: `${region}-c`, description: region },
    ]);

    // Add "all zones" option
    items.unshift({
      label: 'All zones',
      description: 'Scan all available zones (slower)',
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select zones to scan (or choose all)',
      canPickMany: true,
    });

    if (!selected || selected.length === 0) {
      return undefined;
    }

    // If "All zones" is selected, return empty array (means all)
    if (selected.some(s => s.label === 'All zones')) {
      return [];
    }

    return selected.map(s => s.label);
  }

  /**
   * Store credentials configuration
   */
  async storeCredentials(credentials: GcpCredentials): Promise<void> {
    await this.secretStorage.store(
      'gcp-credentials',
      JSON.stringify(credentials)
    );
  }

  /**
   * Get stored credentials
   */
  async getStoredCredentials(): Promise<GcpCredentials | undefined> {
    const stored = await this.secretStorage.get('gcp-credentials');
    if (stored) {
      try {
        return JSON.parse(stored) as GcpCredentials;
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
    await this.secretStorage.delete('gcp-credentials');
  }

  /**
   * Validate credentials by making a test API call
   */
  async validateCredentials(credentials: GcpCredentials): Promise<boolean> {
    try {
      const { InstancesClient } = await import('@google-cloud/compute');
      const authOptions = this.getAuthOptions(credentials);

      const client = new InstancesClient(authOptions);

      // Try to list instances (will fail quickly if auth is bad)
      // Use a short timeout by listing from a single zone
      await client.list({
        project: credentials.projectId,
        zone: 'us-central1-a',
        maxResults: 1,
      });

      return true;
    } catch {
      return false;
    }
  }
}

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Connection options for launchers
 */
export interface ConnectionOptions {
  hostname: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  displayName?: string;
  // v0.2.0: SSH key and jump host support
  identityFile?: string; // Path to SSH private key
  proxyJump?: string; // Jump host for SSH connections
}

/**
 * Base class for connection launchers
 */
export abstract class BaseLauncher {
  /**
   * Launch the connection
   */
  abstract launch(options: ConnectionOptions): Promise<void>;

  /**
   * Execute an AppleScript command
   */
  protected async executeAppleScript(script: string): Promise<void> {
    const escapedScript = script.replace(/"/g, '\\"');
    await execAsync(`osascript -e "${escapedScript}"`);
  }

  /**
   * Execute a shell command
   */
  protected async executeCommand(command: string): Promise<void> {
    await execAsync(command);
  }

  /**
   * Open a file with the default application
   */
  protected async openFile(filePath: string): Promise<void> {
    await execAsync(`open "${filePath}"`);
  }

  /**
   * Check if an application is installed
   */
  protected async isAppInstalled(appName: string): Promise<boolean> {
    try {
      await execAsync(`mdfind "kMDItemKind == 'Application'" | grep -i "${appName}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get platform
   */
  protected getPlatform(): 'darwin' | 'linux' | 'win32' {
    return process.platform as 'darwin' | 'linux' | 'win32';
  }

  /**
   * Check if running on macOS
   */
  protected isMacOS(): boolean {
    return this.getPlatform() === 'darwin';
  }
}

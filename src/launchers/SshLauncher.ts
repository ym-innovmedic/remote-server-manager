import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseLauncher, ConnectionOptions } from './BaseLauncher';

const execAsync = promisify(exec);

/**
 * SSH connection launcher for macOS
 * Uses Terminal.app or VS Code integrated terminal
 * Supports sshpass for password automation when available
 */
export class SshLauncher extends BaseLauncher {
  private sshpassAvailable: boolean | null = null;

  /**
   * Launch SSH connection
   */
  async launch(options: ConnectionOptions): Promise<void> {
    if (!this.isMacOS()) {
      throw new Error('SSH launcher currently only supports macOS');
    }

    const config = vscode.workspace.getConfiguration('remoteServerManager');
    const terminalType = config.get<'terminal' | 'integrated'>('defaultSshTerminal', 'terminal');

    // Check if we can use sshpass (password provided and sshpass available)
    const canUseSshpass = !!(options.password && await this.checkSshpassAvailable());

    if (terminalType === 'integrated') {
      this.launchInIntegratedTerminal(options, canUseSshpass);
    } else {
      await this.launchInTerminalApp(options, canUseSshpass);
    }
  }

  /**
   * Check if sshpass is available
   */
  private async checkSshpassAvailable(): Promise<boolean> {
    if (this.sshpassAvailable !== null) {
      return this.sshpassAvailable;
    }

    try {
      await execAsync('which sshpass');
      this.sshpassAvailable = true;
    } catch {
      this.sshpassAvailable = false;
    }

    return this.sshpassAvailable;
  }

  /**
   * Launch in Terminal.app (uses temp file for password - secure)
   */
  private async launchInTerminalApp(
    options: ConnectionOptions,
    useSshpass: boolean
  ): Promise<void> {
    const sshCommand = this.buildSshCommand(options);

    let command: string;
    if (useSshpass && options.password) {
      // Write password to secure temp file
      const passFile = this.createSecurePasswordFile(options.password);
      // Use sshpass -f to read from file, then delete the file
      command = `sshpass -f '${passFile}' ${sshCommand}; rm -f '${passFile}'`;
    } else {
      command = sshCommand;
    }

    const script = `
      tell application "Terminal"
        do script "${command}"
        activate
      end tell
    `;

    await this.executeAppleScript(script);
  }

  /**
   * Launch in VS Code integrated terminal (uses env var - secure)
   */
  private launchInIntegratedTerminal(
    options: ConnectionOptions,
    useSshpass: boolean
  ): void {
    const terminalName = `SSH: ${options.displayName || options.hostname}`;
    const sshCommand = this.buildSshCommand(options);

    if (useSshpass && options.password) {
      // Create terminal with SSHPASS env var set invisibly
      const terminal = vscode.window.createTerminal({
        name: terminalName,
        env: { SSHPASS: options.password },
      });
      terminal.show();
      terminal.sendText(`sshpass -e ${sshCommand}`);
    } else {
      // Regular SSH without password
      const terminal = vscode.window.createTerminal(terminalName);
      terminal.show();
      terminal.sendText(sshCommand);
    }
  }

  /**
   * Build SSH command string (without sshpass wrapper)
   */
  private buildSshCommand(options: ConnectionOptions): string {
    const parts: string[] = ['ssh'];

    // Port
    const port = options.port || 22;
    if (port !== 22) {
      parts.push(`-p ${port}`);
    }

    // User and host
    if (options.username) {
      parts.push(`${options.username}@${options.hostname}`);
    } else {
      parts.push(options.hostname);
    }

    return parts.join(' ');
  }

  /**
   * Create a secure temporary file containing the password
   * File is readable only by owner (mode 0600)
   */
  private createSecurePasswordFile(password: string): string {
    const fileName = `.sshpass_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filePath = path.join(os.tmpdir(), fileName);

    // Write with mode 0600 (owner read/write only)
    fs.writeFileSync(filePath, password, { mode: 0o600 });

    return filePath;
  }
}

import * as vscode from 'vscode';
import { BaseLauncher, ConnectionOptions } from './BaseLauncher';

/**
 * FTP connection launcher for macOS
 * Uses Terminal.app with security warning
 */
export class FtpLauncher extends BaseLauncher {
  /**
   * Launch FTP connection
   */
  async launch(options: ConnectionOptions): Promise<void> {
    if (!this.isMacOS()) {
      throw new Error('FTP launcher currently only supports macOS');
    }

    // Show security warning
    const config = vscode.workspace.getConfiguration('remoteServerManager');
    const showWarning = config.get<boolean>('showFtpSecurityWarning', true);

    if (showWarning) {
      const result = await vscode.window.showWarningMessage(
        'FTP transmits data unencrypted, including passwords. ' +
        'Consider using SFTP for secure file transfers.',
        { modal: true },
        'Connect Anyway',
        'Use SFTP Instead',
        'Don\'t Show Again'
      );

      if (result === 'Use SFTP Instead') {
        // User wants to use SFTP instead
        const { SftpLauncher } = await import('./SftpLauncher');
        const sftpLauncher = new SftpLauncher();
        return sftpLauncher.launch(options);
      }

      if (result === 'Don\'t Show Again') {
        // Disable warning for future
        await config.update(
          'showFtpSecurityWarning',
          false,
          vscode.ConfigurationTarget.Global
        );
      }

      if (result !== 'Connect Anyway' && result !== 'Don\'t Show Again') {
        // User cancelled
        return;
      }
    }

    const terminalType = config.get<'terminal' | 'integrated'>('defaultSshTerminal', 'terminal');

    if (terminalType === 'integrated') {
      this.launchInIntegratedTerminal(options);
    } else {
      await this.launchInTerminalApp(options);
    }
  }

  /**
   * Launch in Terminal.app
   */
  private async launchInTerminalApp(options: ConnectionOptions): Promise<void> {
    const ftpCommand = this.buildFtpCommand(options);

    const script = `
      tell application "Terminal"
        do script "${ftpCommand}"
        activate
      end tell
    `;

    await this.executeAppleScript(script);
  }

  /**
   * Launch in VS Code integrated terminal
   */
  private launchInIntegratedTerminal(options: ConnectionOptions): void {
    const terminalName = `FTP: ${options.displayName || options.hostname}`;

    // Create terminal and send FTP command
    const terminal = vscode.window.createTerminal(terminalName);
    terminal.show();
    terminal.sendText(this.buildFtpCommand(options));
  }

  /**
   * Build FTP command string
   */
  private buildFtpCommand(options: ConnectionOptions): string {
    const parts: string[] = ['ftp'];

    // Port
    const port = options.port || 21;
    if (port !== 21) {
      parts.push(`-P ${port}`);
    }

    // For FTP, we typically specify user@host or just host
    // Username/password will be prompted interactively
    if (options.username) {
      parts.push(`${options.username}@${options.hostname}`);
    } else {
      parts.push(options.hostname);
    }

    return parts.join(' ');
  }
}

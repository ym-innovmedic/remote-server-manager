import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { BaseLauncher, ConnectionOptions } from './BaseLauncher';

/**
 * RDP connection launcher for macOS
 * Uses Microsoft Remote Desktop / Windows App with AppleScript automation for auto-login
 */
export class RdpLauncher extends BaseLauncher {
  private static readonly RDP_APP_NAMES = [
    'Microsoft Remote Desktop',
    'Windows App',
  ];

  /**
   * Launch RDP connection
   */
  async launch(options: ConnectionOptions): Promise<void> {
    if (!this.isMacOS()) {
      throw new Error('RDP launcher currently only supports macOS');
    }

    // Check if an RDP client is installed
    const rdpClientInstalled = await this.checkRdpClientInstalled();
    if (!rdpClientInstalled) {
      const result = await vscode.window.showErrorMessage(
        'No RDP client found. Microsoft Remote Desktop or Windows App is required for RDP connections on macOS.',
        'Open App Store',
        'Cancel'
      );

      if (result === 'Open App Store') {
        await this.executeCommand(
          'open "https://apps.apple.com/app/microsoft-remote-desktop/id1295203466"'
        );
      }
      return;
    }

    // Generate .rdp file
    const rdpContent = this.generateRdpFile(options);
    const rdpPath = this.getRdpFilePath(options.hostname);

    // Write file
    fs.writeFileSync(rdpPath, rdpContent);

    try {
      // Check if auto-login is enabled in settings
      const config = vscode.workspace.getConfiguration('remoteServerManager');
      const rdpAutoLogin = config.get<boolean>('rdpAutoLogin', true);

      // If we have password and auto-login is enabled, start the auto-login script in background
      if (options.username && options.password && rdpAutoLogin) {
        // Show first-time setup hint
        await this.showAccessibilityHint();
        this.startAutoLoginScript(options);
      }

      // Open with default RDP handler (Microsoft Remote Desktop / Windows App)
      await this.openFile(rdpPath);
    } catch (error) {
      this.cleanupFile(rdpPath);
      throw new Error(
        `Failed to open RDP connection. Please ensure Microsoft Remote Desktop is installed and set as the default app for .rdp files. Error: ${String(error)}`
      );
    }

    // Clean up after a delay to allow the app to read the file
    setTimeout(() => this.cleanupFile(rdpPath), 5000);
  }

  private static accessibilityHintShown = false;

  /**
   * Show a one-time hint about Accessibility permissions
   */
  private async showAccessibilityHint(): Promise<void> {
    if (RdpLauncher.accessibilityHintShown) {
      return;
    }
    RdpLauncher.accessibilityHintShown = true;

    // Check if we have accessibility permission by trying a simple command
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      await execAsync('osascript -e \'tell application "System Events" to return name of first process\'');
      // Permission granted, no need to show hint
      return;
    } catch {
      // Permission not granted, show hint
      const result = await vscode.window.showInformationMessage(
        'For RDP auto-login, VS Code needs Accessibility permissions. ' +
        'Go to System Preferences > Security & Privacy > Privacy > Accessibility and add VS Code.',
        'Open System Preferences',
        'Skip'
      );

      if (result === 'Open System Preferences') {
        const { exec } = await import('child_process');
        exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
      }
    }
  }

  /**
   * Start AppleScript to automatically handle certificate and password dialogs
   * Note: Requires macOS Accessibility permissions for VS Code
   */
  private startAutoLoginScript(options: ConnectionOptions): void {
    const password = options.password!;
    // Escape special characters for AppleScript string
    const escapedPassword = password
      .replace(/\\/g, '\\\\')       // Escape backslashes
      .replace(/"/g, '\\"');        // Escape quotes

    // Check if certificate auto-accept is enabled
    const config = vscode.workspace.getConfiguration('remoteServerManager');
    const autoCertificateAccept = config.get<boolean>('rdpAutoCertificateAccept', true);

    // AppleScript to handle password dialog first, then certificate dialog after
    const script = `
on run
  set handleCertificate to ${autoCertificateAccept}
  set thePassword to "${escapedPassword}"
  set maxAttempts to 90
  set attemptCount to 0
  set certificateHandled to false
  set passwordHandled to false

  -- Keep running until both are handled or timeout
  repeat while attemptCount < maxAttempts
    delay 0.5
    set attemptCount to attemptCount + 1

    -- Exit early if both handled (or just password if certificate handling disabled)
    if passwordHandled and (certificateHandled or not handleCertificate) then
      exit repeat
    end if

    -- Also exit if password handled and no certificate dialog for 10 seconds
    if passwordHandled and attemptCount > 20 then
      exit repeat
    end if

    tell application "System Events"
      if exists (process "Windows App") then
        tell process "Windows App"
          set allWindows to every window

          repeat with aWindow in allWindows
            try
              set allSheets to every sheet of aWindow
              repeat with aSheet in allSheets

                -- Get all elements once for this sheet
                set sheetElements to entire contents of aSheet

                -- Handle Certificate Dialog (can appear before or after password)
                if handleCertificate and not certificateHandled then
                  try
                    set isCertDialog to false
                    repeat with elem in sheetElements
                      try
                        if class of elem is button then
                          set btnName to name of elem
                          if btnName is "Show Certificate" or btnName is "Hide Certificate" then
                            set isCertDialog to true
                            exit repeat
                          end if
                        end if
                      end try
                    end repeat

                    if isCertDialog then
                      repeat with elem in sheetElements
                        try
                          if class of elem is button and name of elem is "Continue" then
                            click elem
                            set certificateHandled to true
                            delay 1
                            exit repeat
                          end if
                        end try
                      end repeat
                    end if
                  end try
                end if

                -- Handle Password Dialog
                if not passwordHandled then
                  try
                    set isCredentialsDialog to false
                    repeat with elem in sheetElements
                      try
                        if class of elem is static text then
                          if (value of elem) contains "Credentials" then
                            set isCredentialsDialog to true
                            exit repeat
                          end if
                        end if
                      end try
                    end repeat

                    if isCredentialsDialog then
                      set textFields to every text field of aSheet
                      if (count of textFields) >= 2 then
                        set passwordField to item 2 of textFields
                        set focused of passwordField to true
                        delay 0.2
                        set value of passwordField to thePassword
                        delay 0.3

                        -- Click Continue
                        repeat with elem in sheetElements
                          try
                            if class of elem is button and name of elem is "Continue" then
                              click elem
                              set passwordHandled to true
                              -- Reset attempt count to give time for certificate dialog
                              set attemptCount to 0
                              delay 1
                              exit repeat
                            end if
                          end try
                        end repeat
                      end if
                    end if
                  end try
                end if

              end repeat
            end try
          end repeat
        end tell
      end if
    end tell
  end repeat

  if passwordHandled and certificateHandled then
    return "success_both"
  else if passwordHandled then
    return "success_password"
  else if certificateHandled then
    return "success_certificate"
  else
    return "timeout"
  end if
end run
    `;

    // Write script to temp file and execute (more reliable than -e for complex scripts)
    const scriptPath = path.join(os.tmpdir(), `rdp_autologin_${Date.now()}.scpt`);
    fs.writeFileSync(scriptPath, script);
    console.log('[RdpLauncher] Script written to:', scriptPath);

    // Run AppleScript in background with output capture for debugging
    const child = spawn('osascript', [scriptPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Log output for debugging
    child.stdout?.on('data', (data: Buffer) => {
      console.log('[RdpLauncher] Script output:', data.toString());
    });
    child.stderr?.on('data', (data: Buffer) => {
      console.log('[RdpLauncher] Script log:', data.toString());
    });
    child.on('exit', (code) => {
      console.log('[RdpLauncher] Script exited with code:', code);
    });

    child.unref();

    // Clean up script file after a delay
    setTimeout(() => {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        // Ignore
      }
    }, 35000);

    console.log('[RdpLauncher] Started auto-login script');
  }

  /**
   * Check if an RDP client is installed
   */
  private async checkRdpClientInstalled(): Promise<boolean> {
    for (const appName of RdpLauncher.RDP_APP_NAMES) {
      if (await this.isAppInstalled(appName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clean up temporary RDP file
   */
  private cleanupFile(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Generate RDP file content
   */
  private generateRdpFile(options: ConnectionOptions): string {
    const lines: string[] = [];

    // Full address
    const port = options.port || 3389;
    lines.push(`full address:s:${options.hostname}:${port}`);

    // Username
    if (options.username) {
      if (options.domain) {
        lines.push(`username:s:${options.domain}\\${options.username}`);
        lines.push(`domain:s:${options.domain}`);
      } else {
        lines.push(`username:s:${options.username}`);
      }
    }

    // Prompt for credentials - enable since AppleScript will auto-fill password
    // Setting to 1 ensures the dialog appears for our script to interact with
    lines.push('prompt for credentials:i:1');

    // Display settings
    lines.push('screen mode id:i:2'); // Full screen
    lines.push('use multimon:i:0');
    lines.push('desktopwidth:i:1920');
    lines.push('desktopheight:i:1080');
    lines.push('session bpp:i:32');

    // Performance settings
    lines.push('connection type:i:7'); // Auto detect
    lines.push('networkautodetect:i:1');
    lines.push('bandwidthautodetect:i:1');

    // Redirection
    lines.push('redirectclipboard:i:1');
    lines.push('redirectprinters:i:0');
    lines.push('redirectcomports:i:0');
    lines.push('redirectsmartcards:i:0');
    lines.push('drivestoredirect:s:');

    // Security
    lines.push('authentication level:i:2');
    lines.push('enablecredsspsupport:i:1');

    return lines.join('\r\n');
  }

  /**
   * Get path for temporary RDP file
   */
  private getRdpFilePath(hostname: string): string {
    const sanitizedHostname = hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `remote_${sanitizedHostname}_${Date.now()}.rdp`;
    return path.join(os.tmpdir(), fileName);
  }
}

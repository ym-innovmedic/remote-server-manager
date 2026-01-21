/**
 * Logger utility for Remote Server Manager
 * Outputs to both VS Code Output channel and console
 */

import * as vscode from 'vscode';

class Logger {
  private outputChannel: vscode.OutputChannel | undefined;
  private readonly channelName = 'Remote Server Manager';

  /**
   * Initialize the logger with VS Code output channel
   */
  initialize(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel(this.channelName);
    }
    return this.outputChannel;
  }

  /**
   * Get the output channel (for disposal)
   */
  getChannel(): vscode.OutputChannel | undefined {
    return this.outputChannel;
  }

  /**
   * Show the output channel
   */
  show(): void {
    this.outputChannel?.show();
  }

  /**
   * Log info message
   */
  info(message: string, ...args: unknown[]): void {
    const formatted = this.format('INFO', message, args);
    console.log(formatted);
    this.outputChannel?.appendLine(formatted);
  }

  /**
   * Log warning message
   */
  warn(message: string, ...args: unknown[]): void {
    const formatted = this.format('WARN', message, args);
    console.warn(formatted);
    this.outputChannel?.appendLine(formatted);
  }

  /**
   * Log error message
   */
  error(message: string, ...args: unknown[]): void {
    const formatted = this.format('ERROR', message, args);
    console.error(formatted);
    this.outputChannel?.appendLine(formatted);
  }

  /**
   * Log debug message (only in development)
   */
  debug(message: string, ...args: unknown[]): void {
    const formatted = this.format('DEBUG', message, args);
    console.log(formatted);
    // Only show debug in output channel if verbose
    this.outputChannel?.appendLine(formatted);
  }

  /**
   * Format log message with timestamp and level
   */
  private format(level: string, message: string, args: unknown[]): string {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    let formatted = `[${timestamp}] [${level}] ${message}`;

    if (args.length > 0) {
      const argsStr = args.map(arg => {
        if (arg instanceof Error) {
          return arg.message;
        }
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
      formatted += ' ' + argsStr;
    }

    return formatted;
  }

  /**
   * Dispose the output channel
   */
  dispose(): void {
    this.outputChannel?.dispose();
    this.outputChannel = undefined;
  }
}

// Singleton instance
export const logger = new Logger();

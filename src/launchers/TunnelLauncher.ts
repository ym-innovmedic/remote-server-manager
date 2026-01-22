/**
 * Tunnel Launcher
 * Launches and manages SSH tunnels for port forwarding
 * v0.3.0
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import { PortForward } from '../models/PortForward';
import { BaseLauncher } from './BaseLauncher';
import { logger } from '../utils/Logger';

/**
 * Tunnel process info
 */
export interface TunnelProcess {
  tunnel: PortForward;
  process: ChildProcess;
  output: string[];
}

/**
 * Event handlers for tunnel lifecycle
 */
export interface TunnelEventHandlers {
  onStarted?: (tunnel: PortForward) => void;
  onStopped?: (tunnel: PortForward) => void;
  onError?: (tunnel: PortForward, error: string) => void;
  onOutput?: (tunnel: PortForward, data: string) => void;
}

/**
 * Launcher for SSH tunnels
 */
export class TunnelLauncher extends BaseLauncher {
  private eventHandlers?: TunnelEventHandlers;

  constructor(handlers?: TunnelEventHandlers) {
    super();
    this.eventHandlers = handlers;
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: TunnelEventHandlers): void {
    this.eventHandlers = handlers;
  }

  /**
   * Launch method (required by BaseLauncher but not used for tunnels)
   */
  launch(): Promise<void> {
    return Promise.reject(new Error('Use launchTunnel() for tunnel operations'));
  }

  /**
   * Launch an SSH tunnel
   */
  launchTunnel(tunnel: PortForward): TunnelProcess {
    const args = this.buildSshArgs(tunnel);
    const useSshpass = !!tunnel.sshPassword && !tunnel.identityFile;

    let command: string;
    let spawnArgs: string[];
    let env = { ...process.env };

    if (useSshpass) {
      command = 'sshpass';
      spawnArgs = ['-e', 'ssh', ...args];
      env.SSHPASS = tunnel.sshPassword;
      logger.info(`[TunnelLauncher] Starting tunnel with sshpass: ssh ${args.join(' ')}`);
    } else {
      command = 'ssh';
      spawnArgs = args;
      logger.info(`[TunnelLauncher] Starting tunnel: ssh ${args.join(' ')}`);
    }

    const childProcess = spawn(command, spawnArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env,
    });

    const tunnelProcess: TunnelProcess = {
      tunnel: { ...tunnel, status: 'connecting', pid: childProcess.pid },
      process: childProcess,
      output: [],
    };

    // Handle stdout
    childProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      tunnelProcess.output.push(output);
      this.eventHandlers?.onOutput?.(tunnelProcess.tunnel, output);
    });

    // Handle stderr
    childProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      tunnelProcess.output.push(output);

      // Check for errors
      if (output.toLowerCase().includes('permission denied') ||
          output.toLowerCase().includes('connection refused') ||
          output.toLowerCase().includes('no route to host') ||
          output.toLowerCase().includes('could not resolve')) {
        tunnelProcess.tunnel.status = 'error';
        tunnelProcess.tunnel.errorMessage = output.trim();
        this.eventHandlers?.onError?.(tunnelProcess.tunnel, output.trim());
      } else {
        this.eventHandlers?.onOutput?.(tunnelProcess.tunnel, output);
      }
    });

    // Handle process exit
    childProcess.on('exit', (code) => {
      logger.info(`[TunnelLauncher] Tunnel process exited with code ${code}`);

      if (code === 0) {
        tunnelProcess.tunnel.status = 'stopped';
      } else {
        tunnelProcess.tunnel.status = 'error';
        if (!tunnelProcess.tunnel.errorMessage) {
          tunnelProcess.tunnel.errorMessage = `Process exited with code ${code}`;
        }
      }

      this.eventHandlers?.onStopped?.(tunnelProcess.tunnel);
    });

    // Handle process error
    childProcess.on('error', (error) => {
      logger.error(`[TunnelLauncher] Process error:`, error);
      tunnelProcess.tunnel.status = 'error';
      tunnelProcess.tunnel.errorMessage = error.message;
      this.eventHandlers?.onError?.(tunnelProcess.tunnel, error.message);
    });

    // Mark as started after a short delay (SSH needs time to establish)
    setTimeout(() => {
      if (tunnelProcess.tunnel.status === 'connecting') {
        tunnelProcess.tunnel.status = 'active';
        tunnelProcess.tunnel.startedAt = new Date();
        this.eventHandlers?.onStarted?.(tunnelProcess.tunnel);
      }
    }, 1000);

    return tunnelProcess;
  }

  /**
   * Build SSH arguments for tunnel
   */
  private buildSshArgs(tunnel: PortForward): string[] {
    const args: string[] = [];

    // No remote command, just tunnel
    args.push('-N');

    // No TTY
    args.push('-T');

    // Exit on tunnel failure
    args.push('-o', 'ExitOnForwardFailure=yes');

    // Auto-accept new host keys when using sshpass (can't prompt interactively)
    if (tunnel.sshPassword && !tunnel.identityFile) {
      args.push('-o', 'StrictHostKeyChecking=accept-new');
    }

    // Batch mode (no password prompts, fail if key auth fails)
    if (tunnel.identityFile) {
      args.push('-o', 'BatchMode=yes');
    }

    // Server alive interval for keep-alive
    args.push('-o', 'ServerAliveInterval=60');
    args.push('-o', 'ServerAliveCountMax=3');

    // Identity file
    if (tunnel.identityFile && fs.existsSync(tunnel.identityFile)) {
      args.push('-i', tunnel.identityFile);
    }

    // Jump host
    if (tunnel.proxyJump) {
      args.push('-J', tunnel.proxyJump);
    }

    // Port
    if (tunnel.sshPort && tunnel.sshPort !== 22) {
      args.push('-p', String(tunnel.sshPort));
    }

    // Tunnel type
    switch (tunnel.type) {
      case 'local':
        // -L localPort:remoteHost:remotePort
        args.push('-L', `${tunnel.localPort}:${tunnel.remoteHost || 'localhost'}:${tunnel.remotePort}`);
        break;
      case 'remote':
        // -R remotePort:localhost:localPort
        args.push('-R', `${tunnel.remotePort}:localhost:${tunnel.localPort}`);
        break;
      case 'dynamic':
        // -D localPort
        args.push('-D', String(tunnel.localPort));
        break;
    }

    // User and host
    if (tunnel.sshUser) {
      args.push(`${tunnel.sshUser}@${tunnel.sshHost}`);
    } else {
      args.push(tunnel.sshHost);
    }

    return args;
  }

  /**
   * Kill a tunnel process
   */
  async killTunnel(process: ChildProcess): Promise<void> {
    if (process.killed) {
      return;
    }

    return new Promise((resolve) => {
      process.on('exit', () => {
        resolve();
      });

      // Try graceful termination first
      process.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
        resolve();
      }, 3000);
    });
  }

  /**
   * Check if a local port is available
   */
  isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once('error', () => {
        resolve(false);
      });

      server.once('listening', () => {
        server.close();
        resolve(true);
      });

      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * Find an available port starting from a given port
   */
  async findAvailablePort(startPort: number, maxAttempts: number = 100): Promise<number | null> {
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    return null;
  }
}

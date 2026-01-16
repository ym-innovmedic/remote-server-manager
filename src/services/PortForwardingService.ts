/**
 * Port Forwarding Service
 * Manages SSH tunnels for port forwarding
 * v0.3.0
 */

import * as vscode from 'vscode';
import {
  PortForward,
  LocalForwardConfig,
  RemoteForwardConfig,
  DynamicForwardConfig,
  createLocalForward,
  createRemoteForward,
  createDynamicForward,
  TUNNEL_PRESETS,
} from '../models/PortForward';
import { TunnelLauncher, TunnelProcess } from '../launchers/TunnelLauncher';
import { AnsibleHost } from '../models/Connection';

/**
 * Event emitter for tunnel state changes
 */
export interface PortForwardingEvents {
  onTunnelStarted: vscode.Event<PortForward>;
  onTunnelStopped: vscode.Event<PortForward>;
  onTunnelError: vscode.Event<{ tunnel: PortForward; error: string }>;
  onTunnelsChanged: vscode.Event<void>;
}

/**
 * Service for managing port forwarding tunnels
 */
export class PortForwardingService {
  private tunnelLauncher: TunnelLauncher;
  private activeTunnels: Map<string, TunnelProcess> = new Map();
  private statusBarItem: vscode.StatusBarItem;

  // Event emitters
  private _onTunnelStarted = new vscode.EventEmitter<PortForward>();
  private _onTunnelStopped = new vscode.EventEmitter<PortForward>();
  private _onTunnelError = new vscode.EventEmitter<{ tunnel: PortForward; error: string }>();
  private _onTunnelsChanged = new vscode.EventEmitter<void>();

  readonly onTunnelStarted = this._onTunnelStarted.event;
  readonly onTunnelStopped = this._onTunnelStopped.event;
  readonly onTunnelError = this._onTunnelError.event;
  readonly onTunnelsChanged = this._onTunnelsChanged.event;

  constructor() {
    this.tunnelLauncher = new TunnelLauncher({
      onStarted: (tunnel) => {
        this._onTunnelStarted.fire(tunnel);
        this._onTunnelsChanged.fire();
        this.updateStatusBar();
      },
      onStopped: (tunnel) => {
        this._onTunnelStopped.fire(tunnel);
        this._onTunnelsChanged.fire();
        this.updateStatusBar();
      },
      onError: (tunnel, error) => {
        this._onTunnelError.fire({ tunnel, error });
        this._onTunnelsChanged.fire();
        this.updateStatusBar();
      },
    });

    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'remoteServerManager.showActiveTunnels';
    this.updateStatusBar();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    void this.stopAllTunnels();
    this.statusBarItem.dispose();
    this._onTunnelStarted.dispose();
    this._onTunnelStopped.dispose();
    this._onTunnelError.dispose();
    this._onTunnelsChanged.dispose();
  }

  /**
   * Create and start a local port forward
   */
  async createLocalForward(config: LocalForwardConfig): Promise<PortForward> {
    // Check if port is available
    const available = await this.tunnelLauncher.isPortAvailable(config.localPort);
    if (!available) {
      throw new Error(`Local port ${config.localPort} is already in use`);
    }

    const tunnel = createLocalForward(config);
    return this.startTunnel(tunnel);
  }

  /**
   * Create and start a remote port forward
   */
  createRemoteForward(config: RemoteForwardConfig): PortForward {
    const tunnel = createRemoteForward(config);
    return this.startTunnel(tunnel);
  }

  /**
   * Create and start a dynamic (SOCKS) forward
   */
  async createDynamicForward(config: DynamicForwardConfig): Promise<PortForward> {
    // Check if port is available
    const available = await this.tunnelLauncher.isPortAvailable(config.localPort);
    if (!available) {
      throw new Error(`Local port ${config.localPort} is already in use`);
    }

    const tunnel = createDynamicForward(config);
    return this.startTunnel(tunnel);
  }

  /**
   * Start a tunnel
   */
  private startTunnel(tunnel: PortForward): PortForward {
    const tunnelProcess = this.tunnelLauncher.launchTunnel(tunnel);
    this.activeTunnels.set(tunnel.id, tunnelProcess);
    this.updateStatusBar();
    return tunnelProcess.tunnel;
  }

  /**
   * Stop a tunnel by ID
   */
  async stopTunnel(id: string): Promise<void> {
    const tunnelProcess = this.activeTunnels.get(id);
    if (!tunnelProcess) {
      return;
    }

    await this.tunnelLauncher.killTunnel(tunnelProcess.process);
    this.activeTunnels.delete(id);
    this.updateStatusBar();
    this._onTunnelsChanged.fire();
  }

  /**
   * Stop all tunnels
   */
  async stopAllTunnels(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [, tunnelProcess] of this.activeTunnels) {
      stopPromises.push(this.tunnelLauncher.killTunnel(tunnelProcess.process));
    }

    await Promise.all(stopPromises);
    this.activeTunnels.clear();
    this.updateStatusBar();
    this._onTunnelsChanged.fire();
  }

  /**
   * Restart a tunnel
   */
  async restartTunnel(id: string): Promise<PortForward | undefined> {
    const tunnelProcess = this.activeTunnels.get(id);
    if (!tunnelProcess) {
      return undefined;
    }

    const tunnelConfig = { ...tunnelProcess.tunnel };
    await this.stopTunnel(id);

    // Reset state
    tunnelConfig.status = 'stopped';
    tunnelConfig.errorMessage = undefined;
    tunnelConfig.startedAt = undefined;
    tunnelConfig.pid = undefined;

    return this.startTunnel(tunnelConfig);
  }

  /**
   * Get all active tunnels
   */
  getActiveTunnels(): PortForward[] {
    return Array.from(this.activeTunnels.values()).map(tp => tp.tunnel);
  }

  /**
   * Get tunnels for a specific host
   */
  getTunnelsForHost(hostName: string): PortForward[] {
    return this.getActiveTunnels().filter(t => t.hostName === hostName);
  }

  /**
   * Get tunnel by ID
   */
  getTunnel(id: string): PortForward | undefined {
    return this.activeTunnels.get(id)?.tunnel;
  }

  /**
   * Get active tunnel count
   */
  getActiveTunnelCount(): number {
    return Array.from(this.activeTunnels.values())
      .filter(tp => tp.tunnel.status === 'active')
      .length;
  }

  /**
   * Check if port is available
   */
  async isPortAvailable(port: number): Promise<boolean> {
    return this.tunnelLauncher.isPortAvailable(port);
  }

  /**
   * Find an available port
   */
  async findAvailablePort(startPort: number): Promise<number | null> {
    return this.tunnelLauncher.findAvailablePort(startPort);
  }

  /**
   * Update status bar
   */
  private updateStatusBar(): void {
    const activeCount = this.getActiveTunnelCount();

    if (activeCount > 0) {
      this.statusBarItem.text = `$(plug) ${activeCount} tunnel${activeCount !== 1 ? 's' : ''}`;
      this.statusBarItem.tooltip = `${activeCount} active SSH tunnel${activeCount !== 1 ? 's' : ''} - Click to manage`;
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  /**
   * Show status bar item (call on activation)
   */
  showStatusBar(): void {
    this.updateStatusBar();
  }

  /**
   * Prompt user for local forward configuration
   */
  async promptLocalForward(host: AnsibleHost): Promise<LocalForwardConfig | undefined> {
    // Select preset or custom
    const presetItems = TUNNEL_PRESETS.map(p => ({
      label: p.name,
      description: p.description,
      preset: p,
    }));

    const selectedPreset = await vscode.window.showQuickPick(presetItems, {
      placeHolder: 'Select service type or Custom',
    });

    if (!selectedPreset) {
      return undefined;
    }

    const preset = selectedPreset.preset;
    let localPort = preset.defaultLocalPort;
    let remoteHost = preset.defaultRemoteHost;
    let remotePort = preset.defaultRemotePort;

    // For custom or if we need to confirm ports
    if (preset.id === 'custom' || preset.defaultRemotePort === 0) {
      const remotePortStr = await vscode.window.showInputBox({
        prompt: 'Enter remote port',
        placeHolder: '3306',
        validateInput: (value) => {
          const port = parseInt(value, 10);
          if (isNaN(port) || port < 1 || port > 65535) {
            return 'Port must be between 1 and 65535';
          }
          return undefined;
        },
      });

      if (!remotePortStr) {
        return undefined;
      }
      remotePort = parseInt(remotePortStr, 10);
      localPort = remotePort; // Default to same port
    }

    // Ask for remote host if not localhost
    const remoteHostInput = await vscode.window.showInputBox({
      prompt: 'Enter remote host (the host to forward to)',
      value: remoteHost,
      placeHolder: 'localhost or internal-db.example.com',
    });

    if (remoteHostInput === undefined) {
      return undefined;
    }
    remoteHost = remoteHostInput || 'localhost';

    // Ask for local port
    const localPortStr = await vscode.window.showInputBox({
      prompt: 'Enter local port',
      value: String(localPort),
      validateInput: (value) => {
        const port = parseInt(value, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          return 'Port must be between 1 and 65535';
        }
        return undefined;
      },
    });

    if (!localPortStr) {
      return undefined;
    }
    localPort = parseInt(localPortStr, 10);

    // Check port availability
    const available = await this.isPortAvailable(localPort);
    if (!available) {
      const newPort = await this.findAvailablePort(localPort);
      if (newPort) {
        const useAlternate = await vscode.window.showWarningMessage(
          `Port ${localPort} is in use. Use ${newPort} instead?`,
          'Yes',
          'No'
        );
        if (useAlternate === 'Yes') {
          localPort = newPort;
        } else {
          return undefined;
        }
      } else {
        void vscode.window.showErrorMessage(`Port ${localPort} is in use and no alternative found`);
        return undefined;
      }
    }

    return {
      sshHost: host.ansible_host || host.name,
      sshPort: host.ansible_port,
      sshUser: host.ansible_user,
      identityFile: host.remote_mgr_identity_file,
      proxyJump: host.remote_mgr_proxy_jump,
      localPort,
      remoteHost,
      remotePort,
      name: `${preset.name !== 'Custom' ? preset.name + ': ' : ''}${remoteHost}:${remotePort}`,
      hostName: host.name,
      hostDisplayName: host.remote_mgr_display_name || host.name,
    };
  }

  /**
   * Prompt user for dynamic forward configuration
   */
  async promptDynamicForward(host: AnsibleHost): Promise<DynamicForwardConfig | undefined> {
    const localPortStr = await vscode.window.showInputBox({
      prompt: 'Enter local SOCKS port',
      value: '1080',
      validateInput: (value) => {
        const port = parseInt(value, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          return 'Port must be between 1 and 65535';
        }
        return undefined;
      },
    });

    if (!localPortStr) {
      return undefined;
    }

    let localPort = parseInt(localPortStr, 10);

    // Check port availability
    const available = await this.isPortAvailable(localPort);
    if (!available) {
      const newPort = await this.findAvailablePort(localPort);
      if (newPort) {
        const useAlternate = await vscode.window.showWarningMessage(
          `Port ${localPort} is in use. Use ${newPort} instead?`,
          'Yes',
          'No'
        );
        if (useAlternate === 'Yes') {
          localPort = newPort;
        } else {
          return undefined;
        }
      } else {
        void vscode.window.showErrorMessage(`Port ${localPort} is in use`);
        return undefined;
      }
    }

    return {
      sshHost: host.ansible_host || host.name,
      sshPort: host.ansible_port,
      sshUser: host.ansible_user,
      identityFile: host.remote_mgr_identity_file,
      proxyJump: host.remote_mgr_proxy_jump,
      localPort,
      name: `SOCKS via ${host.remote_mgr_display_name || host.name}`,
      hostName: host.name,
      hostDisplayName: host.remote_mgr_display_name || host.name,
    };
  }
}

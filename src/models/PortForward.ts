/**
 * Port Forwarding Models
 * SSH tunnel types and presets
 * v0.3.0
 */

/**
 * Types of SSH tunnels
 */
export type TunnelType = 'local' | 'remote' | 'dynamic';

/**
 * Tunnel status
 */
export type TunnelStatus = 'active' | 'stopped' | 'error' | 'connecting';

/**
 * Port forward configuration
 */
export interface PortForward {
  id: string;
  type: TunnelType;
  name: string;

  // SSH connection details
  sshHost: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string; // For sshpass authentication
  identityFile?: string;
  proxyJump?: string;
  credentialId?: string; // Reference to stored credential for restart

  // Tunnel configuration
  localPort: number;
  remoteHost?: string; // For local/remote forwarding (default: localhost)
  remotePort?: number; // For local/remote forwarding

  // Runtime state
  status: TunnelStatus;
  pid?: number;
  startedAt?: Date;
  errorMessage?: string;

  // Association with connection
  hostName?: string; // Associated AnsibleHost name
  hostDisplayName?: string;
}

/**
 * Configuration for creating a local forward
 */
export interface LocalForwardConfig {
  sshHost: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  identityFile?: string;
  proxyJump?: string;
  credentialId?: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  name?: string;
  hostName?: string;
  hostDisplayName?: string;
}

/**
 * Configuration for creating a remote forward
 */
export interface RemoteForwardConfig {
  sshHost: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  identityFile?: string;
  proxyJump?: string;
  credentialId?: string;
  localPort: number;
  remotePort: number;
  name?: string;
  hostName?: string;
  hostDisplayName?: string;
}

/**
 * Configuration for creating a dynamic (SOCKS) forward
 */
export interface DynamicForwardConfig {
  sshHost: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  identityFile?: string;
  proxyJump?: string;
  credentialId?: string;
  localPort: number;
  name?: string;
  hostName?: string;
  hostDisplayName?: string;
}

/**
 * Tunnel presets for common services
 */
export interface TunnelPreset {
  id: string;
  name: string;
  description: string;
  defaultRemotePort: number;
  defaultLocalPort: number;
  icon: string;
  defaultRemoteHost: string;
}

/**
 * Built-in presets for common services
 */
export const TUNNEL_PRESETS: TunnelPreset[] = [
  {
    id: 'mysql',
    name: 'MySQL',
    description: 'MySQL Database Server',
    defaultRemotePort: 3306,
    defaultLocalPort: 3306,
    icon: 'database',
    defaultRemoteHost: 'localhost',
  },
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    description: 'PostgreSQL Database Server',
    defaultRemotePort: 5432,
    defaultLocalPort: 5432,
    icon: 'database',
    defaultRemoteHost: 'localhost',
  },
  {
    id: 'redis',
    name: 'Redis',
    description: 'Redis Cache Server',
    defaultRemotePort: 6379,
    defaultLocalPort: 6379,
    icon: 'server',
    defaultRemoteHost: 'localhost',
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    description: 'MongoDB Database Server',
    defaultRemotePort: 27017,
    defaultLocalPort: 27017,
    icon: 'database',
    defaultRemoteHost: 'localhost',
  },
  {
    id: 'elasticsearch',
    name: 'Elasticsearch',
    description: 'Elasticsearch Search Engine',
    defaultRemotePort: 9200,
    defaultLocalPort: 9200,
    icon: 'search',
    defaultRemoteHost: 'localhost',
  },
  {
    id: 'http',
    name: 'HTTP',
    description: 'HTTP Web Server',
    defaultRemotePort: 80,
    defaultLocalPort: 8080,
    icon: 'globe',
    defaultRemoteHost: 'localhost',
  },
  {
    id: 'https',
    name: 'HTTPS',
    description: 'HTTPS Web Server',
    defaultRemotePort: 443,
    defaultLocalPort: 8443,
    icon: 'lock',
    defaultRemoteHost: 'localhost',
  },
  {
    id: 'vnc',
    name: 'VNC',
    description: 'VNC Remote Desktop',
    defaultRemotePort: 5900,
    defaultLocalPort: 5900,
    icon: 'remote-explorer',
    defaultRemoteHost: 'localhost',
  },
  {
    id: 'rdp',
    name: 'RDP',
    description: 'Remote Desktop Protocol',
    defaultRemotePort: 3389,
    defaultLocalPort: 3389,
    icon: 'remote-explorer',
    defaultRemoteHost: 'localhost',
  },
  {
    id: 'ssh',
    name: 'SSH',
    description: 'SSH to another host',
    defaultRemotePort: 22,
    defaultLocalPort: 2222,
    icon: 'terminal',
    defaultRemoteHost: 'localhost',
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Custom port forwarding',
    defaultRemotePort: 0,
    defaultLocalPort: 0,
    icon: 'settings-gear',
    defaultRemoteHost: 'localhost',
  },
];

/**
 * Generate unique tunnel ID
 */
export function generateTunnelId(): string {
  return `tunnel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get human-readable tunnel description
 */
export function getTunnelDescription(tunnel: PortForward): string {
  switch (tunnel.type) {
    case 'local':
      return `localhost:${tunnel.localPort} → ${tunnel.remoteHost || 'localhost'}:${tunnel.remotePort}`;
    case 'remote':
      return `${tunnel.sshHost}:${tunnel.remotePort} → localhost:${tunnel.localPort}`;
    case 'dynamic':
      return `SOCKS5 proxy on localhost:${tunnel.localPort}`;
    default:
      return `Port ${tunnel.localPort}`;
  }
}

/**
 * Get tunnel type display name
 */
export function getTunnelTypeName(type: TunnelType): string {
  switch (type) {
    case 'local':
      return 'Local Forward';
    case 'remote':
      return 'Remote Forward';
    case 'dynamic':
      return 'Dynamic (SOCKS)';
    default:
      return 'Unknown';
  }
}

/**
 * Get preset by ID
 */
export function getPresetById(id: string): TunnelPreset | undefined {
  return TUNNEL_PRESETS.find(p => p.id === id);
}

/**
 * Create a PortForward from a local forward config
 */
export function createLocalForward(config: LocalForwardConfig): PortForward {
  return {
    id: generateTunnelId(),
    type: 'local',
    name: config.name || `Local ${config.remotePort}`,
    sshHost: config.sshHost,
    sshPort: config.sshPort,
    sshUser: config.sshUser,
    sshPassword: config.sshPassword,
    identityFile: config.identityFile,
    proxyJump: config.proxyJump,
    credentialId: config.credentialId,
    localPort: config.localPort,
    remoteHost: config.remoteHost,
    remotePort: config.remotePort,
    status: 'stopped',
    hostName: config.hostName,
    hostDisplayName: config.hostDisplayName,
  };
}

/**
 * Create a PortForward from a remote forward config
 */
export function createRemoteForward(config: RemoteForwardConfig): PortForward {
  return {
    id: generateTunnelId(),
    type: 'remote',
    name: config.name || `Remote ${config.remotePort}`,
    sshHost: config.sshHost,
    sshPort: config.sshPort,
    sshUser: config.sshUser,
    sshPassword: config.sshPassword,
    identityFile: config.identityFile,
    proxyJump: config.proxyJump,
    credentialId: config.credentialId,
    localPort: config.localPort,
    remotePort: config.remotePort,
    status: 'stopped',
    hostName: config.hostName,
    hostDisplayName: config.hostDisplayName,
  };
}

/**
 * Create a PortForward from a dynamic forward config
 */
export function createDynamicForward(config: DynamicForwardConfig): PortForward {
  return {
    id: generateTunnelId(),
    type: 'dynamic',
    name: config.name || `SOCKS ${config.localPort}`,
    sshHost: config.sshHost,
    sshPort: config.sshPort,
    sshUser: config.sshUser,
    sshPassword: config.sshPassword,
    identityFile: config.identityFile,
    proxyJump: config.proxyJump,
    credentialId: config.credentialId,
    localPort: config.localPort,
    status: 'stopped',
    hostName: config.hostName,
    hostDisplayName: config.hostDisplayName,
  };
}

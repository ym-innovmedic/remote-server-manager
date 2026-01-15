/**
 * Connection types supported by the extension
 */
export type ConnectionType = 'rdp' | 'ssh' | 'sftp' | 'ftp';

/**
 * Credential storage strategy
 */
export type CredentialStrategy = 'save' | 'prompt';

/**
 * Represents an Ansible host entry with all variables
 */
export interface AnsibleHost {
  // Identity
  name: string; // Host entry name (FQDN or short name)

  // Display (priority: displayName > comment > name)
  displayName?: string; // From remote_mgr_display_name
  comment?: string; // From comment="..." variable

  // Standard Ansible variables
  ansible_host?: string; // IP address (optional - fallback to name)
  ansible_connection?: string; // ssh, winrm, local
  ansible_port?: number; // Connection port
  ansible_user?: string; // Remote user

  // WinRM-specific (Windows hosts)
  ansible_winrm_transport?: string; // ntlm, kerberos
  ansible_winrm_server_cert_validation?: string;

  // Extension-specific (remote_mgr_*)
  remote_mgr_connection_type?: ConnectionType;
  remote_mgr_credential_id?: string;
  remote_mgr_credential_strategy?: CredentialStrategy;
  remote_mgr_domain?: string;
  remote_mgr_port?: number;
  remote_mgr_display_name?: string;

  // v0.2.0: SSH Key and Jump Host support
  remote_mgr_identity_file?: string; // Path to SSH key (e.g., ~/.ssh/id_rsa)
  remote_mgr_proxy_jump?: string; // Jump host for SSH (ProxyJump)
  remote_mgr_tags?: string[]; // User-defined tags for organization

  // Preserve all other Ansible variables
  rawVariables: Record<string, string>;

  // Parser metadata
  lineNumber?: number;
  inlineComment?: string; // Comment after host line
}

/**
 * Represents an Ansible group
 */
export interface AnsibleGroup {
  name: string;
  hosts: AnsibleHost[];
  children: string[]; // Child group names
  vars: Record<string, string>; // [group:vars] section
  comments: string[]; // Comments within section
}

/**
 * Represents a complete Ansible inventory
 */
export interface AnsibleInventory {
  groups: AnsibleGroup[];
  ungroupedHosts: AnsibleHost[];
  headerComments: string[]; // Top-of-file comments
}

/**
 * Get the display label for a host
 */
export function getDisplayLabel(host: AnsibleHost): string {
  return host.remote_mgr_display_name || host.comment || host.name;
}

/**
 * Get the connection host based on preference
 */
export function getConnectionHost(
  host: AnsibleHost,
  preference: 'name' | 'ansible_host'
): string {
  if (preference === 'ansible_host') {
    return host.ansible_host || host.name;
  }
  return host.name;
}

/**
 * Detect connection type from Ansible host variables
 */
export function detectConnectionType(host: AnsibleHost): ConnectionType {
  // 1. Explicit override (highest priority)
  if (host.remote_mgr_connection_type) {
    return host.remote_mgr_connection_type;
  }

  // 2. WinRM = Windows = RDP for user connections
  if (host.ansible_connection === 'winrm') {
    return 'rdp';
  }

  // 3. SSH connection
  if (host.ansible_connection === 'ssh') {
    return 'ssh';
  }

  // 4. Default (standard Ansible behavior)
  return 'ssh';
}

/**
 * Get the default port for a connection type
 */
function getDefaultPort(connectionType: ConnectionType): number {
  switch (connectionType) {
    case 'rdp':
      return 3389;
    case 'ssh':
    case 'sftp':
      return 22;
    case 'ftp':
      return 21;
    default:
      return 22;
  }
}

/**
 * Get the port for a connection
 * Note: ansible_port is for Ansible automation (e.g., 5985 for WinRM)
 * For user-facing connections (RDP, SSH), we use the appropriate protocol port
 */
export function getConnectionPort(
  host: AnsibleHost,
  connectionType?: ConnectionType
): number {
  // 1. Extension-specific port override (highest priority)
  if (host.remote_mgr_port) {
    return host.remote_mgr_port;
  }

  const connType = connectionType || detectConnectionType(host);

  // 2. For RDP connections from WinRM hosts, ignore ansible_port (5985 is WinRM, not RDP)
  // WinRM port is for Ansible automation, RDP uses 3389
  if (connType === 'rdp' && host.ansible_connection === 'winrm') {
    return 3389;
  }

  // 3. For SSH/SFTP connections, ansible_port is likely the SSH port
  if ((connType === 'ssh' || connType === 'sftp') && host.ansible_port) {
    return host.ansible_port;
  }

  // 4. Default port for the connection type
  return getDefaultPort(connType);
}

/**
 * Create an empty AnsibleHost
 */
export function createEmptyHost(name: string): AnsibleHost {
  return {
    name,
    rawVariables: {},
  };
}

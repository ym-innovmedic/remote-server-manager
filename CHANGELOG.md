# Changelog

All notable changes to the Remote Server Manager extension will be documented in this file.

## [0.3.0] - 2026-01-16

### Added

#### Cloud Provider Discovery
- **AWS EC2 Discovery**: Automatically discover EC2 instances across multiple regions
  - Profile authentication from ~/.aws/credentials
  - Manual credentials entry with secure storage
  - Multi-region scanning
  - Filter by instance state (running, stopped, etc.)
  - Group by region, VPC, or tag
- **GCP Compute Discovery**: Discover Compute Engine VMs
  - Application Default Credentials (gcloud auth)
  - Service Account key file authentication
  - Zone-based scanning
  - Filter by instance status
  - Group by zone, network, or label
- **Cloud Source Management**: Add, refresh, and remove cloud sources from sidebar

#### SSH Port Forwarding
- **Local Forwarding (-L)**: Access remote services on localhost
- **Dynamic/SOCKS Proxy (-D)**: Route traffic through remote host
- **Remote Forwarding (-R)**: Expose local services to remote host
- **Service Presets**: One-click setup for common services
  - MySQL (3306), PostgreSQL (5432), Redis (6379)
  - MongoDB (27017), Elasticsearch (9200)
  - HTTP (80→8080), HTTPS (443→8443)
  - VNC (5900), RDP (3389), SSH (22→2222)
- **Tunnel Management Panel**: Visual tree view of all tunnels
- **Status Bar**: Shows count of active tunnels
- **Port Availability Check**: Suggests alternate ports if occupied

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `aws.defaultProfile` | `""` | Default AWS profile |
| `aws.defaultRegions` | `["us-east-1"]` | Regions to scan |
| `aws.instanceStateFilter` | `["running"]` | Filter by state |
| `gcp.defaultProjectId` | `""` | Default GCP project |
| `gcp.statusFilter` | `["RUNNING"]` | Filter by status |

### Requirements

- **AWS**: AWS CLI configured or manual credentials, `ec2:DescribeInstances` permission
- **GCP**: gcloud CLI or service account key, `roles/compute.viewer` role

---

## [0.2.0] - 2026-01-12

### Added

#### SSH Key Support
- **Identity File**: Specify SSH private key per host via `ansible_ssh_private_key_file`
- **Key Selection**: Choose from available keys when connecting

#### SSH Config Import
- **Import from ~/.ssh/config**: One-click import of SSH config hosts
- **Preserves settings**: Host, port, user, identity file, proxy jump

#### Tags
- **Host Tags**: Tag hosts with `remote_mgr_tags` variable
- **Filter by Tags**: Quick filter connections by tag
- **Multi-tag Support**: Hosts can have multiple comma-separated tags

#### Jump Host / Bastion
- **ProxyJump Support**: Connect through bastion hosts via `ansible_ssh_common_args` or `remote_mgr_proxy_jump`
- **Chained Jumps**: Support for multiple jump hosts

---

## [0.1.0] - 2026-01-10

### Added

#### Core Features
- **Multi-Protocol Support**: RDP, SSH, SFTP, and FTP connections from one interface
- **Ansible Inventory Native**: Direct parsing of Ansible INI inventory format
- **Multi-Inventory**: Load multiple inventory files with read-only option for shared configs
- **One-Click Connect**: Double-click any server to connect instantly

#### Credential Management
- **Secure Storage**: VS Code Secret Storage API (OS Keychain)
- **Environment Labels**: Tag credentials with environment (PROD, DEV, STAGING, etc.)
- **Type Icons**: Visual distinction between RDP, SSH, SFTP, FTP credentials
- **Smart Suggestions**: Relevant credentials shown first based on connection type
- **Credential Reuse**: Save once, use across multiple servers

#### Auto-Login (macOS)
- **RDP Auto-Fill**: Automatically fills password dialogs
- **Certificate Acceptance**: Auto-clicks "Continue" on certificate validation
- **SSH/SFTP Password**: Uses sshpass for seamless authentication
- **Configurable**: Enable/disable via settings

#### Organization & Safety
- **Environment Detection**: Auto-detect prod/staging/uat/test/dev/db from hostname
- **Visual Indicators**: Color-coded icons for quick identification
- **Production Warnings**: Confirmation dialog before connecting to production
- **Favorites**: Star frequently used servers
- **Most Connected**: Quick access to your go-to servers
- **Search**: Find any server instantly across all inventories

#### Inventory Management
- **Tree View**: Hierarchical display by Ansible groups
- **Edit Connection**: Modify display name, IP, port, credentials, etc.
- **Add/Delete**: Full CRUD operations on connections
- **Import/Export**: JSON import, Ansible inventory export
- **Quick Connect**: Connect without saving to inventory

#### Usability
- **Copy Options**: Copy hostname, IP, display name, connection info, or as JSON
- **Context Menu**: Right-click for all connection options
- **Command Palette**: All commands accessible via Cmd+Shift+P

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `rdpAutoLogin` | `true` | Auto-fill RDP password dialogs |
| `rdpAutoCertificateAccept` | `true` | Auto-accept RDP certificates |
| `defaultCredentialStrategy` | `"prompt"` | Save or prompt for new credentials |
| `preferHostnameType` | `"ansible_host"` | Use IP or FQDN for connections |
| `defaultSshTerminal` | `"terminal"` | Terminal.app or VS Code integrated |
| `showFtpSecurityWarning` | `true` | Warn before FTP connections |

### Platform Support

| Platform | Status |
|----------|--------|
| macOS | ✅ Fully supported |
| Linux | 🔜 Planned |
| Windows | 🔜 Planned |

### Requirements (macOS)

- **RDP**: Microsoft Remote Desktop or Windows App
- **RDP Auto-Login**: Accessibility permission for VS Code
- **SSH Auto-Login**: `brew install hudochenkov/sshpass/sshpass`

### Known Limitations

- macOS only (Linux and Windows support planned)
- RDP auto-login requires Accessibility permissions
- SSH password automation requires sshpass installation
- FTP transmits data unencrypted (warning displayed)

---

## Future Plans

- Linux support (Remmina for RDP)
- Windows support
- SSH key authentication
- Connection groups/folders
- Bulk operations

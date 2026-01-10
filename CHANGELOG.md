# Changelog

All notable changes to the Remote Server Manager extension will be documented in this file.

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

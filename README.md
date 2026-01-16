# Remote Server Manager

**The missing connection manager for VS Code** - Manage all your remote servers (RDP, SSH, SFTP, FTP) directly from VS Code using your existing Ansible inventory files.

---

## Why Remote Server Manager?

| Problem | Solution |
|---------|----------|
| Switching between multiple apps for different protocols | **One interface** for RDP, SSH, SFTP, and FTP |
| Manually typing passwords every time | **Auto-login** fills passwords automatically |
| Forgetting which server is prod vs dev | **Visual environment indicators** with production warnings |
| Managing credentials across tools | **Secure credential vault** with environment labels |
| Maintaining separate server lists | **Use your Ansible inventory** - no duplicate configs |
| Manually tracking cloud instances | **AWS EC2 & GCP Compute** auto-discovery |
| Setting up SSH tunnels via command line | **Visual port forwarding** with presets |

---

## Key Features

### One-Click Connections
Connect to any server with a single click. No more copy-pasting hostnames or remembering ports.

### Auto-Login (macOS)
- **RDP**: Automatically fills password dialogs and accepts certificates
- **SSH/SFTP**: Uses `sshpass` for seamless password authentication
- **Configurable**: Enable/disable per your security requirements

### Ansible Inventory Native
Use your existing Ansible inventory files directly - no migration needed. Supports:
- Standard INI format
- Group hierarchies (`[group:children]`)
- Group variables (`[group:vars]`)
- All your custom variables preserved

### Smart Credential Management
- **Environment Labels**: `admin [PROD]`, `admin [DEV]` - same username, different passwords
- **Type Icons**: Instantly distinguish RDP vs SSH credentials
- **Secure Storage**: Uses VS Code's Secret Storage (OS keychain)
- **Smart Reuse**: Suggests relevant credentials based on connection type

### Production Safety
- **Auto-Detection**: Recognizes prod/staging/uat/test/dev servers from hostnames
- **Visual Indicators**: Color-coded icons for quick identification
- **Confirmation Dialogs**: Warning before connecting to production servers

### Organized Workflow
- **Favorites**: Star frequently used servers
- **Most Connected**: Quick access to your go-to servers
- **Search**: Find any server instantly
- **Groups**: Servers organized by Ansible groups

### Cloud Provider Discovery (v0.3.0)
Automatically discover and connect to cloud instances:
- **AWS EC2**: Multi-region scanning with profile or manual credentials
- **GCP Compute**: Zone discovery with ADC or service account authentication
- **Auto-grouping**: Organize by region, VPC, zone, network, or tags/labels
- **Live refresh**: Update instance lists on demand

### SSH Port Forwarding (v0.3.0)
Create SSH tunnels directly from VS Code:
- **Local Forwarding**: Access remote services on localhost (`-L`)
- **Dynamic/SOCKS Proxy**: Route traffic through remote host (`-D`)
- **Service Presets**: One-click setup for MySQL, PostgreSQL, Redis, MongoDB, and more
- **Tunnel Management**: Visual panel showing all active tunnels with status

---

## Quick Start

### 1. Install the Extension
Search for "Remote Server Manager" in VS Code Extensions, or install from [VS Code Marketplace](#).

### 2. Add Your Inventory
Open VS Code Settings and add your Ansible inventory file:
```json
{
  "remoteServerManager.inventoryFiles": [
    "/path/to/your/inventory.ini"
  ]
}
```

### 3. Connect!
Click on any server in the sidebar to connect. That's it!

---

## Supported Protocols

| Protocol | macOS | Linux | Windows |
|----------|-------|-------|---------|
| **RDP** | ✅ Full (auto-login) | 🔜 Planned | 🔜 Planned |
| **SSH** | ✅ Full (auto-login) | 🔜 Planned | 🔜 Planned |
| **SFTP** | ✅ Full | 🔜 Planned | 🔜 Planned |
| **FTP** | ✅ Full (with warning) | 🔜 Planned | 🔜 Planned |

---

## Feature Highlights

### Environment Detection
Servers are automatically categorized based on hostname patterns:

| Environment | Keywords | Visual |
|-------------|----------|--------|
| Production | `prod`, `prd`, `live` | 🔴 Red |
| Staging | `staging`, `stg`, `preprod` | 🟠 Orange |
| UAT | `uat`, `acceptance` | 🟡 Yellow |
| Test | `test`, `tst`, `qa` | 🔵 Blue |
| Development | `dev`, `local` | 🟢 Green |
| Database | `db`, `sql`, `mysql`, `postgres` | 🟣 Purple |

### Credential Labels
Manage the same username with different passwords per environment:
```
admin - SSH [PROD]     → Production password
admin - SSH [DEV]      → Development password
admin - RDP [STAGING]  → Staging password
```

### RDP Auto-Login (macOS)
When enabled, the extension automatically:
1. Opens Microsoft Remote Desktop
2. Fills in your password
3. Clicks through certificate dialogs
4. Gets you connected - hands free!

**Settings:**
```json
{
  "remoteServerManager.rdpAutoLogin": true,
  "remoteServerManager.rdpAutoCertificateAccept": true
}
```

---

## Ansible Inventory Format

Use standard Ansible inventory with optional extension variables:

```ini
# Production servers
[webservers]
web1.example.com ansible_host=192.168.1.10 remote_mgr_display_name="Web Server 1"
web2.example.com ansible_host=192.168.1.11 comment="Primary web server"

[databases]
db1.example.com ansible_host=192.168.1.20

[windows_servers]
win1.example.com ansible_host=192.168.1.30 ansible_connection=winrm remote_mgr_domain=MYDOMAIN

[prod:children]
webservers
databases
```

### Extension Variables

| Variable | Description |
|----------|-------------|
| `remote_mgr_display_name` | Friendly name shown in sidebar |
| `remote_mgr_connection_type` | Force type: `rdp`, `ssh`, `sftp`, `ftp` |
| `remote_mgr_credential_id` | Link to saved credential |
| `remote_mgr_domain` | Windows domain for RDP |
| `remote_mgr_port` | Override default port |
| `comment` | Alternative display name / note |

---

## Configuration

### All Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `inventoryFiles` | `[]` | Ansible inventory files to load |
| `defaultCredentialStrategy` | `"prompt"` | `"save"` or `"prompt"` for new credentials |
| `preferHostnameType` | `"ansible_host"` | Use IP (`ansible_host`) or FQDN (`name`) |
| `rdpAutoLogin` | `true` | Auto-fill RDP passwords |
| `rdpAutoCertificateAccept` | `true` | Auto-accept RDP certificates |
| `defaultSshTerminal` | `"terminal"` | `"terminal"` or `"integrated"` |
| `showFtpSecurityWarning` | `true` | Warn before FTP connections |
| `displayNameSource` | `"auto"` | Display name priority |

### Multi-Inventory Support

Load multiple inventory files, including read-only external ones:
```json
{
  "remoteServerManager.inventoryFiles": [
    "/path/to/my-servers.ini",
    {
      "path": "/shared/team-inventory.ini",
      "readOnly": true
    }
  ]
}
```

### AWS EC2 Settings (v0.3.0)

| Setting | Default | Description |
|---------|---------|-------------|
| `aws.defaultProfile` | `""` | Default AWS profile from ~/.aws/credentials |
| `aws.defaultRegions` | `["us-east-1"]` | Default regions to scan |
| `aws.instanceStateFilter` | `["running"]` | Filter by instance state |

### GCP Compute Settings (v0.3.0)

| Setting | Default | Description |
|---------|---------|-------------|
| `gcp.defaultProjectId` | `""` | Default GCP project ID |
| `gcp.useApplicationDefaultCredentials` | `true` | Use gcloud auth credentials |
| `gcp.statusFilter` | `["RUNNING"]` | Filter by instance status |

---

## Commands

Access via Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `Quick Connect` | Connect to a server without saving |
| `Manage Saved Credentials` | View, edit, or delete credentials |
| `Import from JSON` | Import connections from JSON file |
| `Import Ansible Inventory` | Import from another inventory |
| `Import SSH Config` | Import hosts from ~/.ssh/config |
| `Export to JSON` | Export connections as JSON |
| `Add Inventory File` | Add a new inventory file |
| `Add AWS EC2 Source` | Discover EC2 instances from AWS |
| `Add GCP Compute Source` | Discover VMs from Google Cloud |
| `Refresh Cloud Sources` | Update cloud instance lists |
| `Show Active Tunnels` | View and manage SSH tunnels |
| `Stop All Tunnels` | Close all active port forwards |

---

## Requirements (macOS)

### Required
- **VS Code** 1.85.0 or higher

### For RDP
- **Microsoft Remote Desktop** or **Windows App** from [Mac App Store](https://apps.apple.com/app/microsoft-remote-desktop/id1295203466)
- **Accessibility Permission** for auto-login (System Preferences → Security & Privacy → Privacy → Accessibility)

### For SSH Auto-Login (Optional)
```bash
brew install hudochenkov/sshpass/sshpass
```

### For AWS EC2 Discovery (v0.3.0)
- **AWS CLI** configured with credentials in `~/.aws/credentials`, or
- **Manual credentials** (Access Key ID + Secret Access Key)
- Required IAM permissions: `ec2:DescribeInstances`, `ec2:DescribeRegions`

### For GCP Compute Discovery (v0.3.0)
- **gcloud CLI** with application default credentials (`gcloud auth application-default login`), or
- **Service Account Key** JSON file
- Required IAM role: `roles/compute.viewer`

---

## Security

| Aspect | Implementation |
|--------|----------------|
| Credential Storage | VS Code Secret Storage API (OS Keychain) |
| Password Transmission | Never written to files or logs |
| SSH Passwords | Passed via environment variables |
| RDP Passwords | Passed via AppleScript automation |
| FTP | Warning displayed (unencrypted protocol) |

---

## Troubleshooting

### RDP not auto-filling password?
1. Grant Accessibility permission: System Preferences → Security & Privacy → Privacy → Accessibility → Add VS Code
2. Restart VS Code

### SSH asking for password?
Install sshpass: `brew install hudochenkov/sshpass/sshpass`

### Servers not showing?
1. Check inventory file path in settings
2. Click refresh button in sidebar
3. Check Output panel for parsing errors

---

## License

**Source Available - Always Open**

This project's source code will always be publicly available. You can view, learn from, and contribute to the code.

| User Type | License |
|-----------|---------|
| Individuals | ✅ Free forever |
| Small Teams (≤4 people) | ✅ Free forever |
| Organizations (>4 people) | 💼 Commercial license required |

See [LICENSE](LICENSE) for full terms.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run `npm run lint` and `npm run compile`
4. Submit a pull request

---

**Made with ❤️ for DevOps engineers who are tired of juggling multiple tools.**

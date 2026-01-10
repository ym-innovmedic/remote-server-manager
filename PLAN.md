# Remote Server Manager - Implementation Plan (Revised)

## Overview

A VS Code extension for managing remote server connections (RDP, SSH, SFTP, FTP) using Ansible inventory format as the native storage mechanism. Initial focus on macOS with enterprise-grade security.

## Project Scope

### In Scope (Phase 1 - macOS)
- **Connection Types**: RDP, SSH, SFTP, FTP
- **Platform**: macOS (primary target)
- **Storage Format**: Ansible inventory (INI format)
- **Security**: AES-256-GCM encryption, VS Code Secrets API
- **Import Sources**: JSON (remote-manager-import.json), Ansible inventory files
- **Credential Strategies**: "save" (permanent) or "prompt" (ask every time)
- **Multi-Inventory Support**: Multiple inventory files with read-only option
- **Quick Connect**: Connect without saving to inventory
- **Display Names**: Friendly names with hostname fallback

### Out of Scope (Deferred)
- VNC and Telnet connections
- Linux support (deferred to Phase 2)
- Terraform import (deferred)

---

## Technical Architecture

### Core Technologies
- **Language**: TypeScript (strict mode)
- **Framework**: VS Code Extension API
- **Bundler**: Webpack
- **Storage**: Ansible INI format + VS Code Secrets API
- **Encryption**: AES-256-GCM for temporary credential handling

### VS Code Configuration Settings

```json
{
  "remoteServerManager.inventoryFiles": {
    "type": "array",
    "default": [],
    "description": "List of Ansible inventory files to load",
    "items": {
      "oneOf": [
        { "type": "string" },
        {
          "type": "object",
          "properties": {
            "path": { "type": "string" },
            "readOnly": { "type": "boolean", "default": false }
          }
        }
      ]
    }
  },
  "remoteServerManager.defaultCredentialStrategy": {
    "type": "string",
    "enum": ["save", "prompt"],
    "default": "prompt",
    "description": "Default credential strategy for new connections"
  },
  "remoteServerManager.preferHostnameType": {
    "type": "string",
    "enum": ["name", "ansible_host"],
    "default": "ansible_host",
    "description": "Preferred hostname for connections: 'name' (FQDN) or 'ansible_host' (IP)"
  },
  "remoteServerManager.showFtpSecurityWarning": {
    "type": "boolean",
    "default": true,
    "description": "Show security warning before FTP connections"
  },
  "remoteServerManager.defaultSshTerminal": {
    "type": "string",
    "enum": ["terminal", "integrated"],
    "default": "terminal",
    "description": "Default terminal for SSH: 'terminal' (Terminal.app) or 'integrated'"
  },
  "remoteServerManager.showUngroupedConnections": {
    "type": "boolean",
    "default": true,
    "description": "Show ungrouped connections in tree view"
  },
  "remoteServerManager.displayNameSource": {
    "type": "string",
    "enum": ["display_name", "comment", "hostname", "auto"],
    "default": "auto",
    "description": "Source for connection display names (auto = display_name > comment > hostname)"
  }
}
```

---

## Data Models

### AnsibleHost Interface

```typescript
interface AnsibleHost {
  // Identity
  name: string;                              // Host entry name (FQDN or short name)

  // Display (priority: displayName > comment > name)
  displayName?: string;                      // From remote_mgr_display_name
  comment?: string;                          // From comment="..." variable

  // Standard Ansible variables
  ansible_host?: string;                     // IP address (optional - fallback to name)
  ansible_connection?: string;               // ssh, winrm, local
  ansible_port?: number;                     // Connection port
  ansible_user?: string;                     // Remote user

  // WinRM-specific (Windows hosts)
  ansible_winrm_transport?: string;          // ntlm, kerberos
  ansible_winrm_server_cert_validation?: string;

  // Extension-specific (remote_mgr_*)
  remote_mgr_connection_type?: 'rdp' | 'ssh' | 'sftp' | 'ftp';
  remote_mgr_credential_id?: string;
  remote_mgr_credential_strategy?: 'save' | 'prompt';
  remote_mgr_domain?: string;
  remote_mgr_port?: number;
  remote_mgr_display_name?: string;

  // Preserve all other Ansible variables
  rawVariables: Record<string, string>;      // util_list, keepalived_state, etc.

  // Parser metadata
  lineNumber?: number;
  inlineComment?: string;                    // Comment after host line
}

interface AnsibleGroup {
  name: string;
  hosts: AnsibleHost[];
  children: string[];                        // Child group names
  vars: Record<string, string>;              // [group:vars] section
  comments: string[];                        // Comments within section
}

interface AnsibleInventory {
  groups: AnsibleGroup[];
  ungroupedHosts: AnsibleHost[];             // Hosts without a group
  headerComments: string[];                  // Top-of-file comments
}
```

### Credential Interface

```typescript
interface Credential {
  id: string;
  name: string;                              // Display name: "larsv (RDP)"
  username: string;
  password?: string;                         // Only if strategy is 'save'
  domain?: string;                           // For RDP/Windows
  strategy: 'save' | 'prompt';
  category: 'rdp' | 'ssh' | 'sftp' | 'ftp';
  createdAt?: Date;
  modifiedAt?: Date;
}
```

---

## Ansible Inventory Format

### Example Structure

```ini
# Production servers - Trollhattan site
[weblogic_prod_thn]
weblogic1.prod.thn.tms.int.pagero.com ansible_host=10.4.48.18 remote_mgr_display_name="Nordlo PROD WebLogic1" remote_mgr_credential_id=cred_ssh_larsv

[inobiz_prod_thn]
inobiz1.prod.thn.tms.int.pagero.com ansible_host=10.4.48.9 ansible_port=5985 ansible_connection=winrm remote_mgr_connection_type=rdp remote_mgr_credential_id=cred_rdp_larsv remote_mgr_domain=tms-int

[ovm_servers]
sethnpl008 ansible_host=10.4.48.8 comment="OVM Manager"

[ungrouped]
# Quick connect entries saved by user
10.4.51.11 remote_mgr_connection_type=rdp remote_mgr_display_name="Quick Connect RDP"

[prod_thn:children]
weblogic_prod_thn
inobiz_prod_thn
```

### Custom Variables (remote_mgr_*)

| Variable | Description |
|----------|-------------|
| `remote_mgr_connection_type` | Explicit type: rdp, ssh, sftp, ftp |
| `remote_mgr_credential_id` | Reference to VS Code Secrets |
| `remote_mgr_credential_strategy` | "save" or "prompt" |
| `remote_mgr_domain` | RDP domain (Windows) |
| `remote_mgr_port` | Override port |
| `remote_mgr_display_name` | Friendly display name |

**Important**: Parser preserves ALL existing variables (util_list, keepalived_state, vault_address, etc.) and only manages `remote_mgr_*` prefixed variables.

---

## Connection Type Detection

Priority-based detection from Ansible variables:

```typescript
function detectConnectionType(host: AnsibleHost): ConnectionType {
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
```

**Note on WinRM vs RDP**: WinRM is Ansible's connection method for Windows automation. For user-facing connections, WinRM hosts launch RDP (Remote Desktop).

---

## Display Name Resolution

Display names shown in tree view follow this priority:

```typescript
function getDisplayLabel(host: AnsibleHost): string {
  // Priority: display_name > comment > name
  return host.remote_mgr_display_name ||
         host.comment ||
         host.name;
}
```

**Examples**:
- Host with `remote_mgr_display_name="Nordlo PROD WebLogic1"` → "Nordlo PROD WebLogic1"
- Host with `comment="OVM Manager"` → "OVM Manager"
- Host `weblogic1.prod.thn.tms.int.pagero.com` → "weblogic1.prod.thn.tms.int.pagero.com"

---

## Hostname Resolution

The extension supports dual hostname resolution:

```typescript
function getConnectionHost(host: AnsibleHost, preference: 'name' | 'ansible_host'): string {
  if (preference === 'ansible_host') {
    return host.ansible_host || host.name;  // Fallback if no IP
  }
  return host.name;
}
```

- **name**: Host entry name (FQDN, e.g., `weblogic1.prod.thn.tms.int.pagero.com`)
- **ansible_host**: IP address (e.g., `10.4.48.18`)

**Note**: Some hosts may not have `ansible_host` defined. In these cases, always use the host name for connection.

---

## Group Name Normalization

| JSON Format | Ansible Format | Display Format |
|-------------|----------------|----------------|
| `"prod thn"` | `prod_thn` | `prod thn` |
| `"uat skf"` | `uat_skf` | `uat skf` |
| `""` (empty) | `ungrouped` | `Ungrouped` |

```typescript
function normalizeGroupName(name: string): string {
  if (!name || name.trim() === '') return 'ungrouped';
  return name.replace(/\s+/g, '_').toLowerCase();
}

function displayGroupName(name: string): string {
  if (name === 'ungrouped') return 'Ungrouped';
  return name.replace(/_/g, ' ');
}
```

---

## macOS Connection Launchers

### 1. RDP (Microsoft Remote Desktop)

Generate `.rdp` file and launch:
```
full address:s:hostname:port
username:s:domain\username
prompt for credentials:i:1
```

### 2. SSH (Terminal.app or VS Code)

```applescript
tell application "Terminal"
  do script "ssh -p 22 username@hostname"
  activate
end tell
```

### 3. SFTP (Terminal.app)

```applescript
tell application "Terminal"
  do script "sftp -P 22 username@hostname"
  activate
end tell
```

### 4. FTP (Terminal.app with warning)

Display security warning first, then:
```applescript
tell application "Terminal"
  do script "ftp hostname"
  activate
end tell
```

---

## Implementation Phases

### Phase 1: Foundation

**Objective**: Project setup and scaffolding

**Tasks**:
1. Initialize VS Code extension with `yo code`
2. Configure TypeScript strict mode
3. Set up webpack bundling
4. Create folder structure (see File Structure)
5. Define VS Code configuration schema
6. Set up ESLint and Prettier

**Success Criteria**:
- Extension loads in VS Code
- TypeScript compiles without errors
- Webpack bundles successfully
- Configuration settings registered

---

### Phase 2: Ansible Parser

**Objective**: Parse Ansible inventory with full fidelity

**Tasks**:
1. Implement INI parser for Ansible format
2. Parse groups, hosts, and variables
3. Handle `[group:children]` hierarchies
4. Handle `[group:vars]` sections
5. Extract `remote_mgr_*` variables
6. **Preserve ALL non-extension variables**
7. **Preserve comments** (header, section, inline)
8. **Handle hosts without `ansible_host`**
9. **Parse `comment="..."` variable**
10. **Handle complex values** like `util_list="['tms-nginx',...]"`
11. Test with `tms` file (30+ hosts, complex structure)

**Key Requirements**:
```typescript
class AnsibleParser {
  parse(content: string): AnsibleInventory;
  serialize(inventory: AnsibleInventory): string;

  // Round-trip integrity: parse(serialize(parse(content))) preserves all data
}
```

**Complex Variable Handling**:
```ini
# Must preserve exactly:
util_list="['tms-nginx','tms-archiving','tms-purging']"
keepalived_state=MASTER
ansible_winrm_server_cert_validation=ignore
```

**Success Criteria**:
- Parse entire `tms` file successfully
- All 30+ hosts identified correctly
- Group hierarchies preserved
- Round-trip test passes (serialize → parse → serialize = same content)
- Comments preserved

---

### Phase 3: Tree View

**Objective**: Display connections in VS Code sidebar

**Tasks**:
1. Implement `TreeDataProvider`
2. Build hierarchical tree from groups
3. Support multiple inventory files as roots
4. Add connection type icons (RDP, SSH, SFTP, FTP)
5. Add read-only badge for external files
6. **Show display names** (priority: display_name > comment > hostname)
7. **Handle ungrouped hosts** section
8. Add context menu actions:
   - Connect (default)
   - Connect via SSH / Connect via SFTP
   - Connect using FQDN / Connect using IP
   - Edit / Delete (disabled for read-only)
   - Copy hostname / Copy IP
9. Implement refresh functionality
10. Add tooltips with full details
11. **Add search/filter capability**

**Tree Structure**:
```
📁 inventory.ini (editable)
  📁 prod_thn
    📁 weblogic_prod_thn
      🐧 Nordlo PROD WebLogic1 (SSH)
      🐧 Nordlo PROD WebLogic2 (SSH)
    📁 inobiz_prod_thn
      🪟 Nordlo PROD Inobiz1 (RDP)
  📁 ungrouped
    🐧 Quick Connect SSH
📁 external.ini 🔒 (read-only)
  ...
```

**Tooltip Content**:
```
Name: weblogic1.prod.thn.tms.int.pagero.com
IP: 10.4.48.18
Type: SSH
Note: OVM Manager (if comment exists)
Credential: larsv (SSH) or "Prompt on connect"
```

**Success Criteria**:
- Tree view appears in sidebar
- Display names show correctly
- Multiple inventory files display as roots
- Ungrouped section works
- Icons match connection types
- Context menu actions work

---

### Phase 4: Credential Management

**Objective**: Secure credential storage and retrieval

**Tasks**:
1. Integrate VS Code Secrets API
2. Implement credential repository
3. Support credential strategies (save/prompt)
4. Build password input dialogs
5. Implement credential migration from JSON
6. Support domain credentials for RDP
7. **Handle connections without credentials** (default to prompt)

**Key Interfaces**:
```typescript
class CredentialService {
  async saveCredential(credential: Credential): Promise<void>;
  async getCredential(id: string): Promise<Credential | undefined>;
  async promptForPassword(username: string, domain?: string): Promise<string>;
  async deleteCredential(id: string): Promise<void>;
  async listCredentials(): Promise<Credential[]>;
  async migrateFromJson(jsonCredentials: JsonCredential[]): Promise<MigrationResult>;
}
```

**Success Criteria**:
- Credentials stored securely in VS Code Secrets API
- "save" strategy persists across sessions
- "prompt" strategy asks each time
- Connections without credentials prompt for password
- No credentials in logs or files

---

### Phase 5: macOS Launchers

**Objective**: Launch connections on macOS

**Tasks**:
1. Implement RDP launcher (Microsoft Remote Desktop)
   - Generate `.rdp` file
   - Handle domain, username, hostname
   - Support both FQDN and IP
2. Implement SSH launcher (Terminal.app)
   - AppleScript to open Terminal
   - Support custom port
3. Implement SFTP launcher (Terminal.app)
   - Separate from SSH
4. Implement FTP launcher (Terminal.app)
   - **Display security warning** first
5. Error handling and user feedback
6. **Handle hosts without `ansible_host`** (use name)

**Success Criteria**:
- RDP launches Microsoft Remote Desktop
- SSH opens Terminal with command
- SFTP opens Terminal (separate option)
- FTP shows warning, then launches
- Error messages display for missing tools
- Both FQDN and IP work as targets

---

### Phase 6: Import Functionality

**Objective**: Import from JSON and external sources

**Tasks**:
1. Build JSON importer for `remote-manager-import.json`
2. Convert JSON structure to Ansible format
3. **Handle group name normalization** (spaces → underscores)
4. **Preserve display names** from JSON `name` field
5. Migrate credentials to VS Code Secrets API
6. **Handle missing credentials** gracefully
7. **Handle empty groups** (→ ungrouped)
8. **Validate and warn about duplicates**
9. Generate import summary/report

**JSON to Ansible Mapping**:
```typescript
function convertJsonToAnsible(conn: JsonConnection): AnsibleHost {
  return {
    name: conn.hostname,
    displayName: conn.name,  // Preserve friendly name
    ansible_host: extractIpIfDifferent(conn.hostname),
    ansible_connection: mapTypeToConnection(conn.type),
    ansible_port: conn.connectionSettings?.sshPort,
    remote_mgr_connection_type: conn.type,
    remote_mgr_credential_id: conn.credentialId || undefined,
    remote_mgr_credential_strategy: conn.credentialId ? 'save' : 'prompt',
    remote_mgr_domain: conn.connectionSettings?.domain,
    remote_mgr_display_name: conn.name,
    rawVariables: {}
  };
}
```

**Import Validation**:
```typescript
interface ImportValidation {
  valid: boolean;
  issues: ImportIssue[];
  // Warnings: duplicate hostnames, missing credentials
  // Errors: invalid data, missing required fields
}
```

**Success Criteria**:
- Import all 58 connections from `remote-manager-import.json`
- All 3 credentials migrated
- Groups normalized correctly
- Display names preserved
- Empty groups → ungrouped
- Missing credentials handled (strategy=prompt)

---

### Phase 7: Edit, Export & Quick Connect

**Objective**: CRUD operations and quick connect

**Tasks**:
1. Add new connection form
2. Edit connection properties
3. Delete connections
4. Export to Ansible inventory
5. **Quick Connect feature**:
   - Command palette: "Remote Manager: Quick Connect"
   - Prompt for hostname, type, credentials
   - Connect without saving
   - Option to save after success

**Quick Connect Flow**:
```
1. Invoke "Remote Manager: Quick Connect"
2. Enter hostname or IP
3. Select connection type (RDP, SSH, SFTP, FTP)
4. Select credentials (existing, new, or none)
5. Launch connection
6. After success: "Save this connection?" (optional)
```

**Success Criteria**:
- Add/edit/delete connections work
- Changes persist to inventory file
- Quick Connect works without saving
- Read-only enforcement for external files

---

### Phase 8: Testing & Polish

**Objective**: Quality and reliability

**Tasks**:
1. Unit tests for parser (round-trip, complex variables)
2. Integration tests with `tms` and `remote-manager-import.json`
3. Multi-inventory testing
4. Quick Connect testing
5. Error handling improvements
6. Documentation (README, CHANGELOG)
7. Performance optimization (100+ connections)

**Test Cases**:

| Test | Input | Expected |
|------|-------|----------|
| Complex variables | `util_list="['a','b']"` | Preserved exactly |
| Host without IP | `service1.prod...` (no ansible_host) | Connect using FQDN |
| Comment variable | `comment="OVM Manager"` | Shows in tooltip |
| WinRM host | `ansible_connection=winrm` | Detected as RDP |
| Empty group import | `"group": ""` | Goes to ungrouped |
| Missing credential | No `credentialId` | Strategy = prompt |

**Success Criteria**:
- All tests pass
- No critical bugs
- Documentation complete
- Performance acceptable with 100+ connections

---

## File Structure

```
remote-server-manager/
├── src/
│   ├── extension.ts                    # Entry point
│   ├── models/
│   │   ├── Connection.ts               # Connection model
│   │   ├── Credential.ts               # Credential model
│   │   ├── Group.ts                    # Group model
│   │   └── InventorySource.ts          # Inventory file metadata
│   ├── parsers/
│   │   └── AnsibleParser.ts            # Ansible INI parser
│   ├── providers/
│   │   └── ConnectionTreeProvider.ts   # Tree view provider
│   ├── services/
│   │   ├── CredentialService.ts        # Credential management
│   │   ├── ConnectionService.ts        # Connection CRUD
│   │   ├── ImportService.ts            # JSON/Ansible import
│   │   ├── InventoryManager.ts         # Multi-file management
│   │   └── QuickConnectService.ts      # Quick connect
│   ├── launchers/
│   │   ├── BaseLauncher.ts             # Abstract launcher
│   │   ├── RdpLauncher.ts              # RDP launcher
│   │   ├── SshLauncher.ts              # SSH launcher
│   │   ├── SftpLauncher.ts             # SFTP launcher
│   │   └── FtpLauncher.ts              # FTP launcher
│   └── utils/
│       ├── encryption.ts               # AES-256-GCM
│       ├── validation.ts               # Input validation
│       └── groupNormalization.ts       # Group name conversion
├── test/
│   ├── suite/
│   │   ├── parser.test.ts
│   │   ├── credential.test.ts
│   │   ├── import.test.ts
│   │   ├── inventory.test.ts
│   │   └── quickConnect.test.ts
│   └── fixtures/
│       ├── sample-inventory.ini
│       ├── sample-import.json
│       └── tms                         # Real-world inventory
├── resources/
│   └── icons/
│       ├── rdp.svg
│       ├── ssh.svg
│       ├── sftp.svg
│       ├── ftp.svg
│       └── readonly.svg
├── package.json
├── tsconfig.json
├── webpack.config.js
├── README.md
├── CHANGELOG.md
└── PLAN.md
```

---

## Key Design Decisions

### 1. Ansible Inventory as Native Format
Provides compatibility with existing infrastructure, human-readable config, hierarchical groups, and extensibility.

### 2. VS Code Secrets API for Credentials
Built-in secure storage using OS keychain. No custom encryption needed.

### 3. Per-Connection Credential Strategy
Flexibility for different security requirements. User controls security vs convenience.

### 4. Display Name Priority (display_name > comment > hostname)
User-friendly labels in tree view while preserving technical hostnames.

### 5. Preserve Non-Extension Variables
Real-world inventories contain deployment-specific variables that must survive round-trips.

### 6. WinRM to RDP Mapping
WinRM is for Ansible automation; RDP is for user interactive sessions.

### 7. Ungrouped Hosts Support
Hosts without groups (Quick Connect, ad-hoc) stored in standard `[ungrouped]` section.

### 8. Hosts Without ansible_host
Use FQDN name as connection target when IP not specified.

---

## Validation Rules

### Host Validation
```typescript
function validateHost(host: AnsibleHost): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!host.name) errors.push('Host must have a name');

  if (!host.ansible_host && !isValidHostname(host.name)) {
    warnings.push('No IP and hostname may not resolve');
  }

  const port = host.remote_mgr_port || host.ansible_port;
  if (port && (port < 1 || port > 65535)) {
    errors.push(`Invalid port: ${port}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
```

### Import Validation
- Check for duplicate hostnames (warn)
- Verify credential references exist (error if missing)
- Validate connection types (error if invalid)

---

## Success Metrics

1. **Functionality**:
   - Import all 58 connections from JSON
   - Parse `tms` inventory (30+ hosts)
   - Launch RDP, SSH, SFTP, FTP on macOS
   - Quick Connect without saving
   - Multi-inventory support

2. **Security**:
   - No credentials in plain text
   - VS Code Secrets API working
   - FTP warning displayed

3. **Usability**:
   - Display names in tree view
   - Clear connection type icons
   - Helpful tooltips
   - Search/filter capability

4. **Quality**:
   - All tests passing
   - Round-trip integrity
   - 100+ connection performance

5. **Compatibility**:
   - Preserves all Ansible variables
   - Works with real-world inventories

---

## Future Enhancements (Post-Phase 1)

1. **Linux Support**: Remmina for RDP, native terminal
2. **Terraform Import**: Parse Terraform output
3. **SSH Key Authentication**: Support key-based auth
4. **Connection Favorites**: Pin frequently used
5. **Bulk Operations**: Multi-select actions
6. **Git Integration**: Version inventory files

---

## Reference Files

- **remote-manager-import.json**: 58 connections, 3 credentials
- **tms**: Complex Ansible inventory with 30+ hosts, group hierarchies, vars sections

---

## Notes

- VNC and Telnet removed from scope
- macOS first, Linux deferred
- Display names shown by default (configurable)
- Empty JSON groups → ungrouped section
- Missing credentials → prompt strategy

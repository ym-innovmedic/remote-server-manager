# Remote Server Manager v0.3.0 - Manual Testing Plan

## Prerequisites

1. **Install the extension:**
   ```bash
   code --install-extension /Users/yogeshm/github-clone-folder/remote-server-manager/remote-server-manager-0.3.0.vsix
   ```

2. **Reload VS Code** after installation (Cmd+Shift+P → "Developer: Reload Window")

3. **Open Output panel** (View → Output) and select "Remote Server Manager" from dropdown to see logs

---

## Test 1: Extension Activation

### Steps:
1. Open VS Code
2. Look for "REMOTE SERVER MANAGER" in the sidebar (Activity Bar)
3. Click on it to open the panel

### Expected:
- [ ] Panel opens showing "CONNECTIONS" section
- [ ] "Most Connected" section appears (may be empty initially)
- [ ] Logs appear in Output panel: "Remote Server Manager is now active"

---

## Test 2: Inventory File Loading

### Setup:
Create a test inventory file at `~/test-inventory.ini`:
```ini
[webservers]
web1.example.com ansible_user=admin
web2.example.com ansible_user=admin ansible_port=2222

[databases]
db1.example.com ansible_user=dbadmin remote_mgr_connection_type=ssh
db2.example.com ansible_host=192.168.1.100
```

### Steps:
1. Open VS Code Settings (Cmd+,)
2. Search for "remoteServerManager.inventoryFiles"
3. Click "Edit in settings.json"
4. Add:
   ```json
   "remoteServerManager.inventoryFiles": [
     "~/test-inventory.ini"
   ]
   ```
5. Reload VS Code

### Expected:
- [ ] Inventory appears in CONNECTIONS panel
- [ ] Two groups visible: "webservers" and "databases"
- [ ] Expanding groups shows hosts with correct names
- [ ] Logs show: "Loading inventory file: ... Loaded 2 groups, 0 ungrouped hosts"

---

## Test 3: SSH Connection (Manual Login)

### Prerequisites:
- A reachable SSH server (e.g., `yourserver.example.com`)
- Valid username

### Steps:
1. Right-click on a host in the tree
2. Select "Connect via SSH (Manual Login)"
3. Terminal should open

### Expected:
- [ ] Terminal opens with SSH command
- [ ] SSH prompts for password (if no key configured)
- [ ] Connection succeeds after entering password
- [ ] "Most Connected" updates to show this server

---

## Test 4: SSH Connection (Auto-Login with sshpass)

### Prerequisites:
- `sshpass` installed: `brew install hudochenkov/sshpass/sshpass`
- A credential configured for the host

### Steps:
1. **Create a credential:**
   - Cmd+Shift+P → "Remote Server Manager: Manage Credentials"
   - Click "Add Credential"
   - Fill in: ID, Username, Password
   - Save

2. **Assign credential to host:**
   - Right-click host → "Assign Credential"
   - Select the credential you created

3. **Connect:**
   - Right-click host → "Connect via SSH"
   - Observe terminal

### Expected:
- [ ] Terminal opens with sshpass command
- [ ] Password auto-filled, no manual entry needed
- [ ] **NEW HOST TEST:** First connection to unknown host should auto-accept host key (StrictHostKeyChecking=accept-new)
- [ ] Logs show: "[SshLauncher] Using key-based authentication" or sshpass info

---

## Test 5: SSH Key Authentication

### Prerequisites:
- SSH key pair (e.g., `~/.ssh/id_ed25519`)
- Server configured for key auth

### Steps:
1. **Create key credential:**
   - Cmd+Shift+P → "Remote Server Manager: Manage Credentials"
   - Add credential with:
     - Strategy: "SSH Key"
     - Identity File: `~/.ssh/id_ed25519`

2. **Assign and connect:**
   - Right-click host → "Assign Credential"
   - Right-click host → "Connect via SSH"

### Expected:
- [ ] SSH command includes `-i /path/to/key`
- [ ] Connection uses key authentication
- [ ] No password prompt if key has no passphrase

---

## Test 6: SFTP Connection

### Steps:
1. Right-click on a host with SSH capability
2. Select "Connect via SFTP"

### Expected:
- [ ] Terminal opens with sftp command
- [ ] Auto-login works if credential assigned
- [ ] SFTP prompt appears after authentication

---

## Test 7: RDP Connection (macOS)

### Prerequisites:
- Microsoft Remote Desktop installed
- Windows server accessible

### Steps:
1. Create a host entry with `remote_mgr_connection_type=rdp`:
   ```ini
   [windows]
   winserver.example.com remote_mgr_connection_type=rdp ansible_user=Administrator
   ```
2. Right-click → "Connect via RDP"

### Expected:
- [ ] Microsoft Remote Desktop launches
- [ ] Connection profile created with correct host
- [ ] Auto-login if credential configured (AppleScript automation)

---

## Test 8: AWS EC2 Discovery

### Prerequisites:
- AWS CLI configured: `aws configure`
- Or AWS credentials in `~/.aws/credentials`
- IAM permissions: `ec2:DescribeInstances`, `ec2:DescribeRegions`

### Steps:
1. Cmd+Shift+P → "Remote Server Manager: Add Cloud Source"
2. Select "AWS EC2"
3. Choose profile (default) or enter custom
4. Configure:
   - Regions: `us-east-1` (or your region)
   - Status filter: `running` (optional)
5. Click OK

### Expected:
- [ ] Progress indicator shows "Discovering AWS EC2 instances..."
- [ ] New source appears in tree with cloud icon (yellow)
- [ ] Expanding shows groups by region/VPC
- [ ] Each instance shows with name and IP
- [ ] Logs show: "[InventoryManager] AWS EC2 discovered X instances"

---

## Test 9: GCP Compute Discovery

### Prerequisites:
- Google Cloud SDK installed: `brew install google-cloud-sdk`
- Authenticated: `gcloud auth application-default login`
- IAM permissions: `compute.instances.list`, `compute.zones.list`

### Steps:
1. Cmd+Shift+P → "Remote Server Manager: Add Cloud Source"
2. Select "GCP Compute Engine"
3. Enter Project ID
4. Configure:
   - Zones: `us-central1-a` (specific) or empty for all zones
   - Use Application Default Credentials: Yes
5. Click OK

### Expected:
- [ ] Progress indicator shows "Discovering GCP Compute instances..."
- [ ] Discovery completes (parallel zone scanning should be faster)
- [ ] New source appears with cloud icon (blue)
- [ ] Instances grouped by zone
- [ ] Logs show: "[InventoryManager] GCP Compute discovered X instances"

---

## Test 10: SSH Port Forwarding - Local Forward

### Scenario:
Forward local port 8080 to remote server's port 80

### Steps:
1. Expand "PORT FORWARDING" section in sidebar
2. Click "+" or Cmd+Shift+P → "Remote Server Manager: Add Port Forward"
3. Configure:
   - Type: Local (-L)
   - Host: Select a server
   - Local Port: 8080
   - Remote Host: localhost
   - Remote Port: 80
4. Click Start

### Expected:
- [ ] Tunnel appears in PORT FORWARDING list
- [ ] Status shows "Active" with green indicator
- [ ] `curl http://localhost:8080` returns content from remote port 80
- [ ] Logs show: "[TunnelLauncher] Starting tunnel: ssh -L ..."

---

## Test 11: SSH Port Forwarding - Dynamic (SOCKS Proxy)

### Scenario:
Create SOCKS5 proxy on local port 1080

### Steps:
1. Add Port Forward:
   - Type: Dynamic (-D)
   - Host: Select a server
   - Local Port: 1080
2. Start tunnel

### Expected:
- [ ] Tunnel active
- [ ] Configure browser/system to use SOCKS5 proxy at localhost:1080
- [ ] Traffic routes through remote server
- [ ] Check IP: `curl --socks5 localhost:1080 ifconfig.me` shows remote IP

---

## Test 12: SSH Port Forwarding - Remote Forward

### Scenario:
Expose local port 3000 on remote server's port 9000

### Steps:
1. Add Port Forward:
   - Type: Remote (-R)
   - Host: Select a server
   - Remote Port: 9000
   - Local Host: localhost
   - Local Port: 3000
2. Start tunnel

### Expected:
- [ ] Tunnel active
- [ ] On remote server: `curl localhost:9000` reaches your local port 3000
- [ ] Requires `GatewayPorts yes` in sshd_config for external access

---

## Test 13: Stop/Restart Tunnels

### Steps:
1. With active tunnel, right-click → "Stop Tunnel"
2. Verify tunnel stops
3. Right-click → "Start Tunnel"

### Expected:
- [ ] Tunnel stops, status changes to inactive
- [ ] Tunnel restarts successfully
- [ ] Port forwarding works again

---

## Test 14: Import SSH Config

### Setup:
Ensure `~/.ssh/config` has entries:
```
Host myserver
    HostName 192.168.1.100
    User admin
    Port 22
    IdentityFile ~/.ssh/id_rsa
```

### Steps:
1. Cmd+Shift+P → "Remote Server Manager: Import SSH Config"
2. Select entries to import

### Expected:
- [ ] Hosts from SSH config appear as options
- [ ] Selected hosts added to inventory
- [ ] Identity file paths preserved
- [ ] Jump hosts (ProxyJump) handled correctly

---

## Test 15: Server Tags and Filtering

### Setup:
Add tags to hosts in inventory:
```ini
[webservers]
web1.example.com remote_mgr_tags=production,frontend
web2.example.com remote_mgr_tags=staging,frontend
```

### Steps:
1. Reload inventory
2. Use filter/search in tree view

### Expected:
- [ ] Tags visible in host details
- [ ] Can filter by tags
- [ ] Production/staging indicators work

---

## Test 16: Quick Connect

### Steps:
1. Cmd+Shift+P → "Remote Server Manager: Quick Connect"
2. Enter: `ssh://admin@192.168.1.100:22`

### Expected:
- [ ] Parses connection string correctly
- [ ] Opens SSH connection to specified host
- [ ] Works for various formats: `host`, `user@host`, `user@host:port`

---

## Test 17: View Logs

### Steps:
1. Perform various operations (connect, add source, etc.)
2. Open Output panel → Select "Remote Server Manager"

### Expected:
- [ ] Logs show with timestamps: `[2026-01-21 12:00:00] [INFO] message`
- [ ] Errors shown with [ERROR] level
- [ ] All operations logged

---

## Test 18: Cloud Source Refresh

### Steps:
1. With AWS or GCP source configured
2. Right-click the cloud source → "Refresh"

### Expected:
- [ ] Source re-discovers instances
- [ ] New instances appear, removed instances disappear
- [ ] Timestamp updates

---

## Test 19: Remove Cloud Source

### Steps:
1. Right-click cloud source → "Remove Source"
2. Confirm

### Expected:
- [ ] Source removed from tree
- [ ] Configuration updated

---

## Test 20: Environment Labels

### Setup:
Add environment to hosts:
```ini
[production]
prod1.example.com remote_mgr_environment=production

[staging]
stage1.example.com remote_mgr_environment=staging
```

### Steps:
1. Connect to production server

### Expected:
- [ ] Warning dialog appears for production environment
- [ ] User must confirm before connecting
- [ ] Color coding in tree view (red for production)

---

## Regression Tests

### Verify these still work from v0.1.0/v0.2.0:
- [ ] Basic SSH connections
- [ ] Credential storage and retrieval
- [ ] Most Connected tracking
- [ ] Multiple inventory files
- [ ] Read-only inventory files
- [ ] Host display names
- [ ] Jump host connections

---

## Error Scenarios to Test

1. **Invalid inventory file:**
   - Add non-existent file path
   - Expected: Error shown, other sources still work

2. **AWS without credentials:**
   - Try to add AWS source without configured credentials
   - Expected: Clear error message about missing credentials

3. **GCP without permissions:**
   - Try to discover with account lacking compute.viewer
   - Expected: Permission denied error in logs

4. **SSH to unreachable host:**
   - Connect to non-existent IP
   - Expected: Timeout, clear error message

5. **Port already in use:**
   - Start tunnel on port already bound
   - Expected: Error indicating port conflict

---

## Performance Notes

- GCP discovery with all zones: May take 30-60 seconds (parallel scanning helps)
- Large AWS regions: May take 10-30 seconds
- Recommend specifying zones/regions for faster discovery

---

## Checklist Summary

| Feature | Status |
|---------|--------|
| Extension activation | [ ] |
| Inventory loading | [ ] |
| SSH manual login | [ ] |
| SSH auto-login (sshpass) | [ ] |
| SSH key authentication | [ ] |
| SFTP connection | [ ] |
| RDP connection | [ ] |
| AWS EC2 discovery | [ ] |
| GCP Compute discovery | [ ] |
| Local port forwarding | [ ] |
| Dynamic port forwarding | [ ] |
| Remote port forwarding | [ ] |
| Tunnel management | [ ] |
| SSH config import | [ ] |
| Quick connect | [ ] |
| Logging output | [ ] |
| Cloud source refresh | [ ] |
| Environment warnings | [ ] |

---

*Generated for Remote Server Manager v0.3.0*

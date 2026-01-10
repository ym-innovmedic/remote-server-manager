# Feature Roadmap: Remote Server Manager

## Missing Essential Features (Priority Analysis)

### 🔴 Critical (Should have before v1.0)

| Feature | Competitors Have It | Impact | Effort |
|---------|:------------------:|:------:|:------:|
| **SSH Key Authentication** | All | High | Medium |
| **Linux Support** | Royal TS, Termius, RDM | High | Medium |
| **Windows Support** | mRemoteNG, Royal TS, RDM | High | High |
| **Connection Folders/Tags** | All | Medium | Low |
| **Import from Other Tools** | RDM, Royal TS | Medium | Medium |

### 🟡 Important (v1.x releases)

| Feature | Competitors Have It | Impact | Effort |
|---------|:------------------:|:------:|:------:|
| **VNC Support** | mRemoteNG, Royal TS, RDM | Medium | Medium |
| **Telnet Support** | mRemoteNG, Royal TS, Termius | Low | Low |
| **Connection Timeout Settings** | All | Medium | Low |
| **Jump Host / Bastion Support** | Termius, RDM | High | Medium |
| **Port Forwarding UI** | Termius, RDM | Medium | Medium |
| **Session Recording** | RDM | Medium | High |
| **Bulk Operations** | Royal TS, RDM | Medium | Medium |

### 🟢 Nice to Have (Future)

| Feature | Competitors Have It | Impact | Effort |
|---------|:------------------:|:------:|:------:|
| **Team Sync / Sharing** | Termius, RDM | High | High |
| **Web-based Access** | RDM | Medium | Very High |
| **Mobile App** | Royal TS, Termius, RDM | Low | Very High |
| **Audit Logging** | RDM | Medium | Medium |
| **Two-Factor Auth** | Termius, RDM | Medium | High |

---

## Detailed Gap Analysis

### 1. SSH Key Authentication 🔴
**Current:** Password-only
**Needed:** Support for SSH keys (id_rsa, id_ed25519, etc.)

**Why Critical:**
- Most production servers disable password auth
- Security best practice
- All competitors support this

**Implementation:**
```typescript
// Add to ConnectionOptions
sshKeyPath?: string;
sshKeyPassphrase?: string;
```

---

### 2. Linux Support 🔴
**Current:** macOS only
**Needed:** Ubuntu, Debian, Fedora, etc.

**Why Critical:**
- Large developer user base
- Many DevOps engineers use Linux workstations

**Implementation:**
- RDP: Use Remmina or xfreerdp
- SSH: Native terminal or gnome-terminal
- Credentials: libsecret for secure storage

---

### 3. Windows Support 🔴
**Current:** macOS only
**Needed:** Windows 10/11

**Why Critical:**
- Largest desktop OS market share
- Enterprise environments

**Implementation:**
- RDP: Native mstsc.exe
- SSH: Windows Terminal or cmd
- Credentials: Windows Credential Manager

---

### 4. Connection Folders/Tags 🔴
**Current:** Ansible groups only
**Needed:** User-defined folders and tags

**Why Critical:**
- Users want custom organization beyond Ansible structure
- All competitors have this

**Implementation:**
```typescript
interface Connection {
  // existing fields...
  tags?: string[];
  folder?: string;
}
```

---

### 5. Jump Host / Bastion Support 🟡
**Current:** Direct connections only
**Needed:** SSH through bastion/jump hosts

**Why Important:**
- Common in enterprise/cloud environments
- AWS, GCP, Azure all use bastion patterns

**Implementation:**
```bash
# ProxyJump support
ssh -J bastion@jump.example.com user@internal-server
```

---

### 6. Port Forwarding UI 🟡
**Current:** Not supported
**Needed:** Local/Remote port forwarding setup

**Why Important:**
- Access internal services through SSH tunnel
- Database connections, web apps, etc.

**Implementation:**
```typescript
interface PortForward {
  type: 'local' | 'remote' | 'dynamic';
  localPort: number;
  remoteHost: string;
  remotePort: number;
}
```

---

### 7. Import from Other Tools 🟡
**Current:** JSON import only
**Needed:** Import from mRemoteNG, Royal TS, PuTTY, etc.

**Why Important:**
- Reduces migration friction
- Users have existing connection databases

**Formats to support:**
- mRemoteNG: XML
- PuTTY: Registry export
- Royal TS: JSON export
- SSH config: ~/.ssh/config

---

## Recommended Priority Order

### Phase 1: v0.2.0 (Essential)
1. ✅ SSH Key Authentication
2. ✅ Connection Tags
3. ✅ Import from SSH config (~/.ssh/config)

### Phase 2: v0.3.0 (Platform Expansion)
4. Linux Support
5. Jump Host / Bastion Support
6. Port Forwarding UI

### Phase 3: v0.4.0 (Windows + Polish)
7. Windows Support
8. Import from mRemoteNG/PuTTY
9. Connection Timeout Settings

### Phase 4: v1.0.0 (Feature Complete)
10. VNC Support
11. Bulk Operations
12. Session History

---

## Feature Comparison: Current vs Target

| Feature | Now | v0.2 | v0.3 | v1.0 |
|---------|:---:|:----:|:----:|:----:|
| RDP | ✅ | ✅ | ✅ | ✅ |
| SSH (password) | ✅ | ✅ | ✅ | ✅ |
| SSH (key) | ❌ | ✅ | ✅ | ✅ |
| SFTP | ✅ | ✅ | ✅ | ✅ |
| FTP | ✅ | ✅ | ✅ | ✅ |
| VNC | ❌ | ❌ | ❌ | ✅ |
| macOS | ✅ | ✅ | ✅ | ✅ |
| Linux | ❌ | ❌ | ✅ | ✅ |
| Windows | ❌ | ❌ | ❌ | ✅ |
| Tags/Folders | ❌ | ✅ | ✅ | ✅ |
| Jump Hosts | ❌ | ❌ | ✅ | ✅ |
| Port Forward | ❌ | ❌ | ✅ | ✅ |
| Import Tools | ❌ | Partial | ✅ | ✅ |

---

## Conclusion

**Most Critical Missing Features:**
1. **SSH Key Authentication** - Blocks enterprise adoption
2. **Linux/Windows Support** - Limits market to macOS users only
3. **Jump Host Support** - Required for cloud/enterprise environments

**Our Unique Advantages to Maintain:**
- Ansible inventory native (no competitor has this)
- Environment detection + prod warnings (unique)
- VS Code integration (only multi-protocol extension)
- Free for small teams (price leader)

**Recommendation:** Prioritize SSH key auth and Linux support in next release to address the biggest gaps while maintaining our unique differentiators.

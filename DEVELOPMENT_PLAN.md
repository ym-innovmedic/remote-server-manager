# Remote Server Manager - Development Plan

## Vision

The **ultimate DevOps connection manager** for VS Code - integrating with the tools DevOps engineers already use: Ansible, Terraform, Kubernetes, AWS/Azure/GCP, HashiCorp Vault, and more.

---

## Current State (v0.1.0) ✅

### Completed Features
- **Protocols**: RDP, SSH, SFTP, FTP
- **Platform**: macOS (full support with auto-login)
- **Storage**: Ansible inventory (INI format)
- **Credentials**: VS Code Secrets API with environment labels
- **Safety**: Production environment detection + warnings
- **Organization**: Groups, favorites, most-connected, search

---

## DevOps Integrations Roadmap

### Tier 1: Infrastructure Discovery (High Value)

| Integration | Description | DevOps Value |
|-------------|-------------|--------------|
| **Terraform State** | Import hosts from `terraform.tfstate` | Use existing IaC definitions |
| **AWS EC2** | Discover EC2 instances via AWS API | Auto-sync cloud inventory |
| **Azure VMs** | Discover VMs via Azure API | Auto-sync cloud inventory |
| **GCP Compute** | Discover instances via GCP API | Auto-sync cloud inventory |
| **SSH Config** | Import from `~/.ssh/config` | Migrate existing SSH setup |

### Tier 2: Container & Orchestration

| Integration | Description | DevOps Value |
|-------------|-------------|--------------|
| **Kubernetes** | List pods/nodes, exec into containers | K8s native workflow |
| **Docker** | List containers, exec/attach | Container debugging |
| **Docker Compose** | Parse compose files for services | Local dev environments |

### Tier 3: Service Discovery & Secrets

| Integration | Description | DevOps Value |
|-------------|-------------|--------------|
| **HashiCorp Vault** | Fetch credentials dynamically | Zero static secrets |
| **HashiCorp Consul** | Service discovery integration | Dynamic host lists |
| **AWS Secrets Manager** | Fetch credentials from AWS | Cloud-native secrets |
| **1Password CLI** | Integrate with 1Password | Team credential sharing |

### Tier 4: Import/Migration

| Integration | Description | DevOps Value |
|-------------|-------------|--------------|
| **mRemoteNG** | Import from XML export | Easy migration |
| **PuTTY** | Import from registry/sessions | Windows user migration |
| **Royal TS** | Import from JSON export | Power user migration |
| **SecureCRT** | Import sessions | Enterprise migration |

---

## Feature Phases

### Phase 1: v0.2.0 - Core Enhancements

#### Features
| Feature | Priority | Effort | Description |
|---------|:--------:|:------:|-------------|
| SSH Key Authentication | 🔴 Critical | Medium | Support id_rsa, id_ed25519, etc. |
| SSH Config Import | 🔴 Critical | Low | Import from ~/.ssh/config |
| Connection Tags | 🟡 High | Low | User-defined tags for organization |
| Jump Host / Bastion | 🟡 High | Medium | ProxyJump support for SSH |

#### Files to Modify
- `src/launchers/SshLauncher.ts` - Add key auth support
- `src/services/ImportService.ts` - Add SSH config parser
- `src/models/Connection.ts` - Add tags field
- `src/providers/ConnectionTreeProvider.ts` - Tag filtering UI

#### Success Criteria
- [ ] SSH with key files works (id_rsa, id_ed25519)
- [ ] Import from ~/.ssh/config with all hosts
- [ ] Tags visible in tree view with filter
- [ ] Jump host connections work

---

### Phase 2: v0.3.0 - Cloud Discovery

#### Features
| Feature | Priority | Effort | Description |
|---------|:--------:|:------:|-------------|
| AWS EC2 Discovery | 🔴 Critical | Medium | List EC2 instances via AWS SDK |
| Terraform State Import | 🔴 Critical | Medium | Parse tfstate for hosts |
| Linux Support | 🔴 Critical | Medium | Remmina/xfreerdp for RDP |
| Port Forwarding UI | 🟡 High | Medium | Local/remote/dynamic tunnels |

#### New Files
- `src/integrations/AwsIntegration.ts`
- `src/integrations/TerraformIntegration.ts`
- `src/launchers/LinuxRdpLauncher.ts`
- `src/services/PortForwardService.ts`

#### AWS Integration Design
```typescript
interface AwsIntegration {
  // Discover EC2 instances
  discoverInstances(profile?: string, region?: string): Promise<AwsInstance[]>;

  // Convert to our connection format
  toConnection(instance: AwsInstance): Connection;

  // Auto-refresh on interval
  startAutoRefresh(intervalMs: number): void;
}

interface AwsInstance {
  instanceId: string;
  name: string;           // From Name tag
  publicIp?: string;
  privateIp: string;
  state: 'running' | 'stopped' | etc;
  tags: Record<string, string>;
  keyName?: string;       // SSH key pair name
}
```

#### Terraform Integration Design
```typescript
interface TerraformIntegration {
  // Parse tfstate file
  parseState(statePath: string): TerraformState;

  // Extract connectable resources
  extractHosts(state: TerraformState): TerraformHost[];

  // Supported resource types
  // - aws_instance
  // - azurerm_virtual_machine
  // - google_compute_instance
}
```

#### Success Criteria
- [ ] AWS EC2 instances appear in tree view
- [ ] Terraform state imports correctly
- [ ] Linux RDP works with Remmina
- [ ] Port forwarding UI functional

---

### Phase 3: v0.4.0 - Container & K8s

#### Features
| Feature | Priority | Effort | Description |
|---------|:--------:|:------:|-------------|
| Kubernetes Integration | 🔴 Critical | High | List pods, exec into containers |
| Docker Integration | 🟡 High | Medium | List containers, exec/attach |
| Azure VM Discovery | 🟡 High | Medium | List VMs via Azure SDK |
| Windows Support | 🟡 High | High | Native mstsc.exe for RDP |

#### Kubernetes Integration Design
```typescript
interface KubernetesIntegration {
  // List contexts from kubeconfig
  listContexts(): Promise<K8sContext[]>;

  // List pods in namespace
  listPods(context: string, namespace?: string): Promise<K8sPod[]>;

  // Exec into pod
  execIntoPod(pod: K8sPod, container?: string): Promise<void>;

  // Port forward to pod
  portForward(pod: K8sPod, localPort: number, remotePort: number): Promise<void>;
}
```

#### Success Criteria
- [ ] K8s pods visible in tree view
- [ ] kubectl exec works from extension
- [ ] Docker containers visible
- [ ] Azure VMs discoverable
- [ ] Windows platform works

---

### Phase 4: v0.5.0 - Secrets & Advanced

#### Features
| Feature | Priority | Effort | Description |
|---------|:--------:|:------:|-------------|
| HashiCorp Vault | 🟡 High | High | Dynamic credential fetching |
| GCP Compute Discovery | 🟡 High | Medium | List instances via GCP SDK |
| Consul Service Discovery | 🟢 Medium | Medium | Dynamic host from Consul |
| Bulk Operations | 🟢 Medium | Medium | Multi-select actions |

#### Vault Integration Design
```typescript
interface VaultIntegration {
  // Authenticate to Vault
  authenticate(config: VaultConfig): Promise<void>;

  // Fetch credential for connection
  getCredential(path: string): Promise<VaultCredential>;

  // Supported auth methods
  // - Token
  // - AppRole
  // - OIDC
  // - AWS IAM
}
```

#### Success Criteria
- [ ] Vault credentials work for SSH/RDP
- [ ] GCP instances visible
- [ ] Consul services resolve to hosts
- [ ] Multi-select delete/connect works

---

### Phase 5: v1.0.0 - Polish & Enterprise

#### Features
| Feature | Priority | Effort | Description |
|---------|:--------:|:------:|-------------|
| VNC Support | 🟢 Medium | Medium | Screen sharing connections |
| Session Recording | 🟢 Medium | High | Record terminal sessions |
| Import from Other Tools | 🟢 Medium | Medium | mRemoteNG, PuTTY, etc. |
| Audit Logging | 🟢 Medium | Medium | Track all connections |
| 1Password Integration | 🟢 Medium | Medium | Team credential sharing |

#### Success Criteria
- [ ] All major protocols supported
- [ ] All major platforms supported
- [ ] Migration path from competitors
- [ ] Enterprise-ready features

---

## Integration Priority Matrix

| Integration | DevOps Value | User Demand | Effort | Priority |
|-------------|:------------:|:-----------:|:------:|:--------:|
| SSH Keys | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Medium | 🔴 v0.2 |
| SSH Config | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Low | 🔴 v0.2 |
| AWS EC2 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Medium | 🔴 v0.3 |
| Terraform | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Medium | 🔴 v0.3 |
| Kubernetes | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | High | 🟡 v0.4 |
| Docker | ⭐⭐⭐⭐ | ⭐⭐⭐ | Medium | 🟡 v0.4 |
| Vault | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | High | 🟡 v0.5 |
| Azure VMs | ⭐⭐⭐⭐ | ⭐⭐⭐ | Medium | 🟡 v0.4 |
| GCP Compute | ⭐⭐⭐⭐ | ⭐⭐⭐ | Medium | 🟡 v0.5 |
| Consul | ⭐⭐⭐⭐ | ⭐⭐ | Medium | 🟢 v0.5 |

---

## Unique Value Propositions

### vs. Competitors

| USP | Description | No Competitor Has |
|-----|-------------|:-----------------:|
| **Ansible Native** | Use existing inventory files | ✅ |
| **Terraform Import** | IaC to connections | ✅ |
| **Cloud Auto-Discovery** | AWS/Azure/GCP in VS Code | ✅ |
| **Prod Safety** | Environment detection + warnings | ✅ |
| **VS Code Native** | No app switching | ✅ |
| **K8s + SSH + RDP** | All in one extension | ✅ |

### Target Users
1. **DevOps Engineers** - Terraform, Ansible, K8s users
2. **Cloud Engineers** - AWS, Azure, GCP admins
3. **Platform Engineers** - Multi-tool environments
4. **SREs** - Quick incident response
5. **Developers** - Local + remote debugging

---

## Verification Plan

### v0.2.0 Testing
```bash
# SSH Key Auth
ssh -i ~/.ssh/id_rsa user@host  # Should work via extension

# SSH Config Import
cat ~/.ssh/config  # All hosts should import

# Jump Host
ssh -J bastion user@internal  # Should work via extension
```

### v0.3.0 Testing
```bash
# AWS Discovery
aws ec2 describe-instances  # Should match extension list

# Terraform Import
terraform show -json  # Hosts should appear in extension

# Linux RDP
remmina  # Extension should launch it
```

### v0.4.0 Testing
```bash
# Kubernetes
kubectl get pods  # Should match extension list
kubectl exec -it pod -- /bin/bash  # Should work via extension

# Docker
docker ps  # Should match extension list
```

---

## Architecture: Integration System

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code Extension                     │
├─────────────────────────────────────────────────────────┤
│                  Integration Manager                     │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┐   │
│  │ Ansible │Terraform│   AWS   │   K8s   │  Vault  │   │
│  │ Parser  │ Parser  │   SDK   │  Client │  Client │   │
│  └────┬────┴────┬────┴────┬────┴────┬────┴────┬────┘   │
│       │         │         │         │         │         │
│       v         v         v         v         v         │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Unified Connection Model              │   │
│  │  - hostname, ip, port, type, credentials        │   │
│  │  - source (ansible/terraform/aws/k8s/vault)     │   │
│  │  - tags, environment, metadata                  │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│                          v                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Connection Launchers                │   │
│  │  RDP │ SSH │ SFTP │ FTP │ K8s Exec │ Docker     │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Key Files Reference

### Current Architecture
- **Language**: TypeScript (strict mode)
- **Framework**: VS Code Extension API
- **Bundler**: Webpack
- **Storage**: Ansible INI format + VS Code Secrets API

### Files for Future Development
- `src/services/ImportService.ts` - Add new integrations here
- `src/launchers/` - Platform-specific launchers
- `src/providers/ConnectionTreeProvider.ts` - Tree view updates
- `src/models/Connection.ts` - Add new source types

---

## Competitive Moat

By v1.0, no other tool will offer:
- Terraform state → connections
- AWS/Azure/GCP discovery in VS Code
- K8s exec + SSH + RDP in one interface
- Ansible inventory + cloud + containers unified
- Production safety features (unique)

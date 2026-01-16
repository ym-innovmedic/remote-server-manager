# Remote Server Manager v0.3.0 - Implementation Plan

## Overview

Version 0.3.0 adds two major features:
1. **Cloud Provider Discovery** - AWS EC2 and GCP Compute Engine instance discovery
2. **SSH Port Forwarding** - Local, remote, and dynamic (SOCKS) tunnels

## Current Status

### Build Status
- **TypeScript Compilation**: PASSING
- **Webpack Build**: PASSING
- **ESLint**: PASSING (all 24 errors fixed)

---

## Feature 1: Cloud Provider Discovery

### Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| `CloudSource.ts` | Complete | Models, constants, helper functions |
| `InventorySource.ts` | Complete | Extended for cloud sources |
| `AwsCredentialProvider.ts` | Complete | Profile/manual auth, region selection |
| `AwsEc2DiscoveryService.ts` | Complete | Multi-region discovery, grouping |
| `GcpCredentialProvider.ts` | Complete | ADC/service account auth |
| `GcpComputeDiscoveryService.ts` | Complete | Zone discovery, grouping |
| `InventoryManager.ts` | Complete | Cloud source integration |
| `ConnectionTreeProvider.ts` | Complete | Cloud source icons and context menus |
| `extension.ts` | Complete | Commands registered |
| `package.json` | Complete | Settings, commands, menus |

---

## Feature 2: SSH Port Forwarding

### Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| `PortForward.ts` | Complete | Models, presets, factory functions |
| `TunnelLauncher.ts` | Complete | SSH process management |
| `PortForwardingService.ts` | Complete | Lifecycle, events, prompts |
| `PortForwardingTreeProvider.ts` | Complete | Tree view with grouping |
| `extension.ts` | Complete | All commands registered |
| `package.json` | Complete | View, commands, menus |

---

## Completed Fixes

### ConnectionTreeProvider Cloud Source Handling
- Added `sourceId` to tree items for cloud source removal
- Different icons for AWS (yellow cloud) and GCP (blue cloud) sources
- Set `contextValue = 'cloudSource'` to enable right-click menu

### Lint Errors Fixed (24 total)

| File | Errors | Fix |
|------|--------|-----|
| `TunnelLauncher.ts` | 14 | Added `net` import, fixed async methods |
| `AwsCredentialProvider.ts` | 2 | Fixed credential provider return type, made `listProfiles` sync |
| `GcpCredentialProvider.ts` | 5 | Made sync methods non-async, added type assertion for JSON parse |
| `InventoryManager.ts` | 1 | Cast `never` type to string in template literal |
| `PortForwardingService.ts` | 2 | Added `void` for fire-and-forget promise, made `createRemoteForward` sync |

---

## Testing Checklist

### Cloud Discovery
- [ ] Add AWS EC2 source with profile authentication
- [ ] Add AWS EC2 source with manual credentials
- [ ] Add GCP Compute source with ADC
- [ ] Add GCP Compute source with service account key
- [ ] Refresh cloud sources
- [ ] Remove cloud source (right-click menu)
- [ ] Verify instances appear in tree view with correct icons
- [ ] Connect to discovered instance

### Port Forwarding
- [ ] Create local forward (MySQL preset)
- [ ] Create local forward (custom port)
- [ ] Create dynamic/SOCKS proxy
- [ ] View active tunnels in tree view
- [ ] Stop single tunnel
- [ ] Stop all tunnels
- [ ] Restart tunnel
- [ ] Verify status bar shows tunnel count
- [ ] Test port availability checking
- [ ] Test alternate port suggestion

---

## Documentation Updates Needed

1. **README.md** - Add v0.3.0 features:
   - Cloud provider discovery section
   - Port forwarding section
   - AWS/GCP setup instructions

2. **CHANGELOG.md** - Add v0.3.0 entry

---

## Release Checklist

- [x] Fix all lint errors (24 total)
- [x] Fix ConnectionTreeProvider cloud source handling
- [ ] Manual testing of all features
- [ ] Update README.md
- [ ] Update CHANGELOG.md
- [ ] Run `npm run package`
- [ ] Test VSIX installation
- [ ] Tag release

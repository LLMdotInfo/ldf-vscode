# VS Code Remote Development Support - Requirements

## Overview

Enable the LDF VS Code extension to work seamlessly in remote development environments including Remote-SSH, Remote-Containers (Dev Containers), WSL, and GitHub Codespaces. This allows developers to use LDF tooling regardless of where their code executes.

## Background

VS Code Remote Development extensions split execution between:
- **UI Extension Host** - Runs locally, handles UI elements
- **Workspace Extension Host** - Runs on remote, has file system access

Currently, the LDF extension assumes local execution and uses Node.js `fs` and `path` modules directly, which fails in remote contexts.

## User Stories

### US-1: Remote-SSH Support

**As a** developer working on a remote server via SSH
**I want to** use LDF extension features
**So that** I can run lints, audits, and tests on the remote machine

**Acceptance Criteria:**
- [ ] AC-1.1: Extension activates in Remote-SSH workspace
- [ ] AC-1.2: Spec tree view loads from remote file system
- [ ] AC-1.3: `ldf lint` executes on remote machine
- [ ] AC-1.4: Terminal commands run in remote shell
- [ ] AC-1.5: Guardrails panel loads remote guardrails.yaml

### US-2: Dev Container Support

**As a** developer using Dev Containers
**I want to** use LDF extension features inside the container
**So that** my development environment is consistent and reproducible

**Acceptance Criteria:**
- [ ] AC-2.1: Extension activates inside Dev Container
- [ ] AC-2.2: Auto-detects ldf in container's virtualenv
- [ ] AC-2.3: All commands execute inside container
- [ ] AC-2.4: File watchers work for spec changes

### US-3: WSL Support

**As a** Windows developer using WSL
**I want to** use LDF extension with my Linux environment
**So that** I can develop in Linux while using Windows VS Code

**Acceptance Criteria:**
- [ ] AC-3.1: Extension activates in WSL workspace
- [ ] AC-3.2: Uses Linux paths (not Windows paths)
- [ ] AC-3.3: Detects ldf in WSL virtualenv

### US-4: GitHub Codespaces Support

**As a** developer using GitHub Codespaces
**I want to** use LDF extension in my cloud environment
**So that** I can develop from any device

**Acceptance Criteria:**
- [ ] AC-4.1: Extension works in Codespaces browser and desktop
- [ ] AC-4.2: Pre-build support (extension installs during prebuild)

## Technical Requirements

### TR-1: Virtual File System API

Replace direct `fs` usage with VS Code's virtual file system API:

```typescript
// Before (local only)
import * as fs from 'fs';
const content = fs.readFileSync(filePath, 'utf-8');

// After (works remotely)
import * as vscode from 'vscode';
const uri = vscode.Uri.file(filePath);
const content = await vscode.workspace.fs.readFile(uri);
```

### TR-2: URI Scheme Handling

Handle different URI schemes:
- `file://` - Local files
- `vscode-remote://ssh-remote+host/path` - Remote-SSH
- `vscode-remote://dev-container+id/path` - Dev Containers
- `vscode-remote://wsl+distro/path` - WSL

### TR-3: Extension Kind Declaration

Declare extension runs in workspace (remote) context:

```json
// package.json
{
  "extensionKind": ["workspace"]
}
```

### TR-4: Path Handling

Use `vscode.Uri` for all path operations instead of `path.join`:

```typescript
// Before
const specsDir = path.join(workspacePath, '.ldf', 'specs');

// After
const specsUri = vscode.Uri.joinPath(workspaceUri, '.ldf', 'specs');
```

## Question-Pack Answers

### Security
- **Authentication:** Relies on VS Code's remote authentication (SSH keys, container auth)
- **Authorization:** Uses remote user's file system permissions
- **Secrets:** No additional secrets; uses existing remote context

### Testing
- **Unit tests:** Mock `vscode.workspace.fs` API
- **Integration tests:** Test matrix across remote types
- **Manual testing:** Required for each remote type

### API Design
- **Compatibility:** Maintain backward compatibility with local development
- **Async:** All file operations become async (breaking change internally)

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks/Tests | Owner | Status |
|-----------|--------------|--------|-------------|-------|--------|
| 1. Testing Coverage | [US-1 to US-4] | [TBD] | [TBD] | [TBD] | TODO |
| 2. Security Basics | [TR-2] | [TBD] | [TBD] | [TBD] | TODO |
| 3. Error Handling | [All] | [TBD] | [TBD] | [TBD] | TODO |
| 5. API Design | [TR-1, TR-4] | [TBD] | [TBD] | [TBD] | TODO |
| 8. Documentation | [All] | [TBD] | [TBD] | [TBD] | TODO |

## Dependencies

- VS Code 1.74+ (stable remote APIs)
- Remote Development extension pack installed by user
- LDF CLI installed in remote environment

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking change to file operations | High | Feature flag for gradual rollout |
| Test matrix explosion (4 remote types x 3 OS) | Medium | Focus on Remote-SSH + WSL initially |
| Performance (remote file system is slower) | Medium | Add caching layer with invalidation |

## Out of Scope

- Remote-Tunnels (newer, less adopted)
- Codespaces-specific features (prebuild hooks)
- Multi-root workspaces with mixed local/remote

## Effort Estimate

- **Size:** Large (architectural changes)
- **Risk:** Medium-High (breaking internal APIs)
- **Recommended approach:** Phase behind feature flag, dogfood internally first

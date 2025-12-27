# VS Code MCP Server Management - Requirements

## Overview

Provide a visual interface for managing Model Context Protocol (MCP) servers within VS Code. This enables developers to start, stop, monitor, and configure MCP servers that power AI assistant integrations without leaving the IDE.

## Background

LDF includes MCP servers that expose spec data to AI assistants:
- **spec_inspector** - Provides spec content, task status, guardrail coverage
- **coverage_reporter** - Analyzes test coverage against guardrails
- **db_inspector** - Database schema introspection (optional)

Currently, MCP servers are:
1. Configured via `ldf mcp-config` (generates JSON for Claude/Cursor)
2. Started automatically by the AI assistant
3. Monitored via `ldf mcp-health`

This spec adds direct management from VS Code.

## User Stories

### US-1: Server Status Dashboard

**As a** developer using AI assistants
**I want to** see MCP server status at a glance
**So that** I know if my AI tools have proper access to project data

**Acceptance Criteria:**
- [ ] AC-1.1: Tree view panel showing all configured MCP servers
- [ ] AC-1.2: Status indicator per server (running/stopped/error)
- [ ] AC-1.3: Auto-refresh status every 30 seconds
- [ ] AC-1.4: Manual refresh button

### US-2: Start/Stop Servers

**As a** developer troubleshooting AI integration
**I want to** manually start and stop MCP servers
**So that** I can restart a misbehaving server

**Acceptance Criteria:**
- [ ] AC-2.1: Start button for stopped servers
- [ ] AC-2.2: Stop button for running servers
- [ ] AC-2.3: Restart button for running servers
- [ ] AC-2.4: Confirmation prompt before stopping
- [ ] AC-2.5: Status updates after action completes

### US-3: Server Logs

**As a** developer debugging MCP issues
**I want to** view server logs
**So that** I can diagnose connection or data issues

**Acceptance Criteria:**
- [ ] AC-3.1: Output channel per MCP server
- [ ] AC-3.2: Click server to open its log channel
- [ ] AC-3.3: Log level configuration (debug/info/warn/error)
- [ ] AC-3.4: Clear logs action

### US-4: Configuration Management

**As a** developer setting up AI tools
**I want to** generate and copy MCP configuration
**So that** I can easily configure Claude Desktop or Cursor

**Acceptance Criteria:**
- [ ] AC-4.1: "Copy Config" button generates `ldf mcp-config` output
- [ ] AC-4.2: Option to copy for specific tool (Claude/Cursor/generic)
- [ ] AC-4.3: Quick action to open config file location
- [ ] AC-4.4: Validation that config matches running servers

### US-5: Health Monitoring

**As a** developer
**I want to** be alerted when MCP servers have issues
**So that** I can fix problems before they impact my workflow

**Acceptance Criteria:**
- [ ] AC-5.1: Status bar indicator when any server is unhealthy
- [ ] AC-5.2: Notification when server crashes
- [ ] AC-5.3: Auto-restart option for crashed servers
- [ ] AC-5.4: Health history (last 10 checks)

## Technical Requirements

### TR-1: MCP Server Process Management

```typescript
interface MCPServerManager {
  /** List configured servers */
  getServers(): MCPServerInfo[];

  /** Start a server */
  start(serverId: string): Promise<void>;

  /** Stop a server */
  stop(serverId: string): Promise<void>;

  /** Restart a server */
  restart(serverId: string): Promise<void>;

  /** Check server health */
  checkHealth(serverId: string): Promise<HealthStatus>;

  /** Get server logs */
  getLogs(serverId: string, lines?: number): Promise<string[]>;
}

interface MCPServerInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  port?: number;
  status: 'running' | 'stopped' | 'error' | 'unknown';
  pid?: number;
  lastHealthCheck?: Date;
}

interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  error?: string;
  capabilities: string[];
}
```

### TR-2: Process Lifecycle

```
┌─────────────────────────────────────────────────────────┐
│                    Server Lifecycle                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ┌─────────┐    start()    ┌─────────┐                 │
│   │ Stopped │ ────────────► │Starting │                 │
│   └─────────┘               └────┬────┘                 │
│        ▲                         │                       │
│        │                         ▼                       │
│        │ stop()            ┌─────────┐   crash          │
│        └─────────────────  │ Running │ ──────┐          │
│                            └────┬────┘       │          │
│                                 │            ▼          │
│                            health check  ┌───────┐      │
│                                 │        │ Error │      │
│                                 ▼        └───┬───┘      │
│                            ┌─────────┐       │          │
│                            │ Healthy │ ◄─────┘          │
│                            └─────────┘   auto-restart   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### TR-3: Tree View Structure

```
MCP Servers
├── ● spec_inspector (Running)
│   ├── Port: 3100
│   ├── PID: 12345
│   ├── Uptime: 2h 15m
│   └── [View Logs] [Restart] [Stop]
├── ○ coverage_reporter (Stopped)
│   └── [Start]
└── ⚠ db_inspector (Error)
    ├── Error: Connection refused
    └── [View Logs] [Restart]
```

### TR-4: Settings Schema

```json
{
  "ldf.mcp.autoStart": {
    "type": "boolean",
    "default": false,
    "description": "Automatically start MCP servers when workspace opens"
  },
  "ldf.mcp.autoRestart": {
    "type": "boolean",
    "default": true,
    "description": "Automatically restart crashed servers"
  },
  "ldf.mcp.healthCheckInterval": {
    "type": "number",
    "default": 30,
    "description": "Health check interval in seconds"
  },
  "ldf.mcp.logLevel": {
    "type": "string",
    "enum": ["debug", "info", "warn", "error"],
    "default": "info",
    "description": "MCP server log level"
  }
}
```

## Question-Pack Answers

### Security
- **Process isolation:** Each server runs in separate process
- **Port binding:** Use ephemeral ports, don't expose externally
- **Secrets:** MCP servers may access project files; rely on workspace trust

### Testing
- **Unit tests:** Mock process spawning
- **Integration tests:** Start real servers in test environment
- **Manual testing:** Verify UI interactions

### API Design
- **Commands:** `ldf.mcp.start`, `ldf.mcp.stop`, `ldf.mcp.restart`, `ldf.mcp.copyConfig`
- **Tree view:** `ldf-mcp-servers` view in sidebar

### Data Model
- **State:** Server PIDs stored in extension context
- **Persistence:** Remember last state across restarts
- **Cleanup:** Kill managed processes on extension deactivate

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks/Tests | Owner | Status |
|-----------|--------------|--------|-------------|-------|--------|
| 1. Testing Coverage | [US-1 to US-5] | [TBD] | [TBD] | [TBD] | TODO |
| 2. Security Basics | [TR-1] | [TBD] | [TBD] | [TBD] | TODO |
| 3. Error Handling | [US-5] | [TBD] | [TBD] | [TBD] | TODO |
| 4. Logging & Observability | [US-3] | [TBD] | [TBD] | [TBD] | TODO |
| 5. API Design | [TR-1, TR-4] | [TBD] | [TBD] | [TBD] | TODO |
| 8. Documentation | [All] | [TBD] | [TBD] | [TBD] | TODO |

## Dependencies

- LDF CLI with MCP servers installed (`pip install -e ".[mcp]"`)
- Python available in PATH or venv
- Ports available for server binding

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Orphan processes on crash | Medium | Track PIDs, cleanup on activate |
| Port conflicts | Low | Use ephemeral ports, detect conflicts |
| Multiple VS Code windows | Medium | Use workspace-specific state |

## Out of Scope

- Custom MCP server registration (only LDF built-in servers)
- MCP protocol debugging/inspection
- Server performance profiling
- Multi-project server sharing

## Effort Estimate

- **Size:** Medium
- **Risk:** Medium (process management is tricky)
- **Recommended approach:** Start with status view only, add start/stop later

# VS Code Extension v2 - Requirements

## Overview

Enhance the LDF VS Code extension with integrated testing, coverage analysis, diagnostics, and CI workflow features. These additions surface key LDF CLI capabilities directly in the IDE, reducing context-switching and improving developer workflow.

## User Stories

### US-1: Run Tests with Coverage

**As a** developer working on a spec
**I want to** run tests with coverage from VS Code
**So that** I can verify my implementation without leaving the IDE

**Acceptance Criteria:**
- [ ] AC-1.1: Command palette action "LDF: Run Tests" executes pytest with coverage
- [ ] AC-1.2: Option to run tests for specific spec or all specs
- [ ] AC-1.3: Test output displayed in integrated terminal
- [ ] AC-1.4: Coverage summary shown in notification after completion
- [ ] AC-1.5: Works cross-platform (Windows/macOS/Linux)

### US-2: Generate Coverage Report

**As a** developer reviewing test coverage
**I want to** generate and view coverage reports
**So that** I can identify gaps in test coverage against guardrails

**Acceptance Criteria:**
- [ ] AC-2.1: Command palette action "LDF: Generate Coverage" runs `ldf coverage`
- [ ] AC-2.2: Coverage report opens in editor or webview panel
- [ ] AC-2.3: Guardrail coverage status visible in tree view
- [ ] AC-2.4: Quick action to jump to uncovered code sections

### US-3: Project Diagnostics

**As a** developer setting up or troubleshooting LDF
**I want to** run diagnostics from VS Code
**So that** I can quickly identify and fix configuration issues

**Acceptance Criteria:**
- [ ] AC-3.1: Command palette action "LDF: Doctor" runs `ldf doctor`
- [ ] AC-3.2: Results displayed in output channel or webview
- [ ] AC-3.3: Quick fix actions for auto-fixable issues
- [ ] AC-3.4: Status bar indicator when issues detected

### US-4: Project Status Panel

**As a** developer working across multiple specs
**I want to** see overall project status at a glance
**So that** I can prioritize work and track progress

**Acceptance Criteria:**
- [ ] AC-4.1: Status bar item showing spec completion percentage
- [ ] AC-4.2: Hover shows summary (X/Y specs complete, Z tasks remaining)
- [ ] AC-4.3: Click opens detailed status panel
- [ ] AC-4.4: Auto-refresh when spec files change

### US-5: Preflight Checks

**As a** developer preparing to commit
**I want to** run all CI checks locally
**So that** I can catch issues before pushing

**Acceptance Criteria:**
- [ ] AC-5.1: Command palette action "LDF: Preflight" runs `ldf preflight`
- [ ] AC-5.2: Progress indicator during multi-step checks
- [ ] AC-5.3: Summary notification with pass/fail status
- [ ] AC-5.4: Quick action to view detailed results

### US-6: MCP Server Health

**As a** developer using AI assistants with MCP
**I want to** check MCP server status
**So that** I can ensure AI tools have proper access

**Acceptance Criteria:**
- [ ] AC-6.1: Command palette action "LDF: MCP Health" runs `ldf mcp-health`
- [ ] AC-6.2: Status indicator in tree view or status bar
- [ ] AC-6.3: Quick action to restart/configure MCP servers

## Question-Pack Answers

### Security
- **Authentication:** N/A - extension runs local CLI commands
- **Authorization:** Uses VS Code workspace trust model
- **Secrets:** No secrets stored; uses existing venv executables

### Testing
- **Unit tests:** Mocha tests for utility functions
- **Integration tests:** VS Code extension test framework
- **Coverage target:** 80% for new utility code

### API Design
- **Commands:** Follow VS Code command naming: `ldf.<action>`
- **Settings:** Extend existing `ldf.*` configuration namespace
- **Output:** Use VS Code output channels and notifications

### Data Model
- **State:** Minimal - rely on file system as source of truth
- **Caching:** Cache coverage data with file watcher invalidation
- **Persistence:** Use VS Code workspace state API where needed

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks/Tests | Owner | Status |
|-----------|--------------|--------|-------------|-------|--------|
| 1. Testing Coverage | [US-1, US-2] | [TBD] | [TBD] | [TBD] | TODO |
| 2. Security Basics | [US-1 AC-1.5] | [TBD] | [TBD] | [TBD] | TODO |
| 3. Error Handling | [US-3] | [TBD] | [TBD] | [TBD] | TODO |
| 4. Logging & Observability | [US-3, US-4] | [TBD] | [TBD] | [TBD] | TODO |
| 5. API Design | [All] | [TBD] | [TBD] | [TBD] | TODO |
| 6. Data Validation | [US-1, US-5] | [TBD] | [TBD] | [TBD] | TODO |
| 8. Documentation | [All] | [TBD] | [TBD] | [TBD] | TODO |

## Technical Considerations

### Cross-Platform Executable Resolution
All features that invoke venv executables must use a shared helper function:
```typescript
function getVenvExecutablePath(basePath: string, name: string): string
```
This resolves platform-specific paths:
- **POSIX:** `.venv/bin/<name>`
- **Windows:** `.venv/Scripts/<name>.exe`

### Executables Required
| Tool | Purpose | Invoked By |
|------|---------|------------|
| `ldf` | Core CLI | All features |
| `python` | Run modules | MCP server startup |
| `pytest` | Run tests | US-1 |
| `coverage` | Generate reports | US-2 |

### Output Channels
- `LDF` - General extension output
- `LDF Tests` - Test execution output
- `LDF Doctor` - Diagnostic results

## Dependencies

- VS Code 1.74+ (for latest extension APIs)
- LDF CLI with all features installed (`pip install -e ".[mcp,automation]"`)
- pytest and coverage.py in same venv

## Out of Scope

- Remote development support (future consideration)
- Custom test framework support (pytest only for v2)
- Real-time coverage gutter indicators (future consideration)
- MCP server management UI (start/stop/restart)

## Priority Order

1. **P0:** Cross-platform executable helper (blocks all other features)
2. **P1:** Run Tests, Preflight (highest developer value)
3. **P2:** Doctor, Status Panel (debugging and visibility)
4. **P3:** Coverage Report, MCP Health (nice-to-have)

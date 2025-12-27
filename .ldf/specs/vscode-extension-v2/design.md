# VS Code Extension v2 - Design

## Architecture Overview

Extend the existing extension architecture with new command handlers that invoke LDF CLI and Python venv executables. A shared utility layer handles cross-platform path resolution.

## Components

### Component 1: Venv Executable Resolver

**Purpose:** Cross-platform resolution of Python virtualenv executables

**Interface:**
```typescript
// src/utils.ts

/**
 * Get the path to an executable in a Python virtualenv.
 * Handles platform differences (bin/ vs Scripts/, .exe suffix).
 *
 * @param basePath - Project root containing .venv
 * @param name - Executable name without extension (e.g., 'ldf', 'python', 'pytest')
 * @returns Full path to the executable
 */
export function getVenvExecutablePath(basePath: string, name: string): string {
    const isWindows = process.platform === 'win32';
    const venvDir = path.join(basePath, '.venv');

    if (isWindows) {
        // Windows: .venv/Scripts/name.exe (or .cmd for some tools)
        const exePath = path.join(venvDir, 'Scripts', `${name}.exe`);
        const cmdPath = path.join(venvDir, 'Scripts', `${name}.cmd`);
        // Prefer .exe, fall back to .cmd
        return fs.existsSync(exePath) ? exePath : cmdPath;
    } else {
        // POSIX: .venv/bin/name
        return path.join(venvDir, 'bin', name);
    }
}

/**
 * Check if a venv executable exists.
 */
export function venvExecutableExists(basePath: string, name: string): boolean {
    const execPath = getVenvExecutablePath(basePath, name);
    return fs.existsSync(execPath);
}
```

**Usage:**
```typescript
// Clone & Install flow
const ldfExecutable = getVenvExecutablePath(ldfPath, 'ldf');

// Run Tests
const pytestPath = getVenvExecutablePath(workspacePath, 'pytest');
terminal.sendText(`${shellQuote(pytestPath)} --cov`);

// Coverage
const coveragePath = getVenvExecutablePath(workspacePath, 'coverage');
```

### Component 2: Test Runner

**Purpose:** Execute pytest with coverage from VS Code

**Interface:**
```typescript
// src/testRunner.ts

interface TestRunOptions {
    specName?: string;      // Run tests for specific spec
    withCoverage?: boolean; // Enable coverage collection
    verbose?: boolean;      // Verbose output
}

async function runTests(
    workspacePath: string,
    options: TestRunOptions
): Promise<void>;
```

**Implementation Notes:**
- Uses integrated terminal for output
- Parses pytest exit codes for pass/fail notification
- Coverage data written to `.ldf/coverage.json` for later analysis

### Component 3: Status Provider

**Purpose:** Track and display project status in status bar

**Interface:**
```typescript
// src/statusProvider.ts

interface ProjectStatus {
    totalSpecs: number;
    completedSpecs: number;
    totalTasks: number;
    completedTasks: number;
    lastUpdated: Date;
}

class StatusProvider implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;

    refresh(): void;
    getStatus(): ProjectStatus;
}
```

**Status Bar Format:**
```
LDF: 3/5 specs | 12/20 tasks
```

### Component 4: Doctor Output Handler

**Purpose:** Parse and display `ldf doctor` output with quick fixes

**Interface:**
```typescript
// src/doctorView.ts

interface DoctorCheck {
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
    fixHint?: string;
    autoFixable: boolean;
}

async function runDoctor(workspacePath: string): Promise<DoctorCheck[]>;
function showDoctorResults(checks: DoctorCheck[]): void;
```

## Command Registration

New commands to add in `package.json`:

```json
{
  "commands": [
    {
      "command": "ldf.runTests",
      "title": "LDF: Run Tests"
    },
    {
      "command": "ldf.runTestsForSpec",
      "title": "LDF: Run Tests for Spec"
    },
    {
      "command": "ldf.generateCoverage",
      "title": "LDF: Generate Coverage"
    },
    {
      "command": "ldf.doctor",
      "title": "LDF: Doctor"
    },
    {
      "command": "ldf.preflight",
      "title": "LDF: Preflight"
    },
    {
      "command": "ldf.mcpHealth",
      "title": "LDF: MCP Health"
    }
  ]
}
```

## Settings

New settings to add:

```json
{
  "ldf.testArgs": {
    "type": "string",
    "default": "",
    "description": "Additional arguments to pass to pytest"
  },
  "ldf.coverageThreshold": {
    "type": "number",
    "default": 80,
    "description": "Minimum coverage percentage to show success"
  },
  "ldf.showStatusBar": {
    "type": "boolean",
    "default": true,
    "description": "Show LDF status in status bar"
  }
}
```

## Guardrail Mapping

| Guardrail | Implementation | Section |
|-----------|---------------|---------|
| 1. Testing | Unit tests for utils, integration tests for commands | [T-1] |
| 2. Security | Shell quoting, path validation | [getVenvExecutablePath] |
| 3. Error Handling | Try/catch in all commands, user notifications | [All components] |
| 5. API Design | Consistent command naming, VS Code patterns | [Commands] |
| 6. Data Validation | Validate paths exist before execution | [venvExecutableExists] |

## Security Considerations

- All executable paths resolved through `getVenvExecutablePath` - no user input directly in paths
- Shell arguments quoted with existing `shellQuote()` utility
- No secrets or credentials stored
- Relies on VS Code workspace trust model

## Migration Path

1. **Phase 1:** Add `getVenvExecutablePath` to utils.ts, update Clone & Install
2. **Phase 2:** Add Run Tests and Preflight commands
3. **Phase 3:** Add Doctor and Status Panel
4. **Phase 4:** Add Coverage Report and MCP Health

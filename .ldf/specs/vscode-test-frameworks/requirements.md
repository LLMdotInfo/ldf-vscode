# VS Code Custom Test Framework Support - Requirements

## Overview

Extend the LDF VS Code extension to support multiple test frameworks beyond pytest, enabling teams with different testing stacks to use LDF's spec-driven testing features.

## Background

The current implementation assumes pytest for all test operations. However, projects may use:
- **Python:** unittest, nose2, ward, hypothesis
- **JavaScript/TypeScript:** Jest, Vitest, Mocha, AVA
- **Multi-language:** Projects with both Python and JS tests

This spec defines a pluggable test framework architecture.

## User Stories

### US-1: Framework Auto-Detection

**As a** developer with an existing test setup
**I want to** LDF to automatically detect my test framework
**So that** I don't have to manually configure it

**Acceptance Criteria:**
- [ ] AC-1.1: Detect pytest from pytest.ini, pyproject.toml, or conftest.py
- [ ] AC-1.2: Detect unittest from test file patterns (test_*.py with unittest imports)
- [ ] AC-1.3: Detect Jest from jest.config.js or package.json jest key
- [ ] AC-1.4: Detect Vitest from vite.config.ts with test config
- [ ] AC-1.5: Allow manual override via settings

### US-2: Unified Test Runner Interface

**As a** developer
**I want to** run tests with a single command regardless of framework
**So that** I have a consistent experience across projects

**Acceptance Criteria:**
- [ ] AC-2.1: `LDF: Run Tests` works for all supported frameworks
- [ ] AC-2.2: `LDF: Run Tests for Spec` maps spec to relevant test files
- [ ] AC-2.3: Test output displayed in integrated terminal
- [ ] AC-2.4: Pass/fail status shown in notification

### US-3: Coverage Integration

**As a** developer
**I want to** generate coverage reports regardless of framework
**So that** I can track coverage against guardrails

**Acceptance Criteria:**
- [ ] AC-3.1: Coverage works with pytest-cov
- [ ] AC-3.2: Coverage works with coverage.py (unittest)
- [ ] AC-3.3: Coverage works with Jest --coverage
- [ ] AC-3.4: Coverage works with Vitest c8/istanbul
- [ ] AC-3.5: Normalize coverage data to common format for guardrail analysis

### US-4: Multi-Framework Projects

**As a** developer on a full-stack project
**I want to** run both Python and JavaScript tests
**So that** I can validate my entire codebase

**Acceptance Criteria:**
- [ ] AC-4.1: Detect multiple frameworks in same project
- [ ] AC-4.2: `Run All Tests` executes both framework runners
- [ ] AC-4.3: Aggregate pass/fail across frameworks
- [ ] AC-4.4: Combine coverage from multiple frameworks

## Technical Requirements

### TR-1: Test Framework Adapter Interface

```typescript
interface TestFrameworkAdapter {
  /** Unique identifier */
  id: string;

  /** Display name */
  name: string;

  /** File patterns for test discovery */
  testFilePatterns: string[];

  /** Detect if this framework is used in the project */
  detect(workspacePath: string): Promise<boolean>;

  /** Build command to run all tests */
  buildRunAllCommand(options: TestRunOptions): string;

  /** Build command to run tests for specific files */
  buildRunFilesCommand(files: string[], options: TestRunOptions): string;

  /** Parse test output for results */
  parseOutput(output: string): TestResult[];

  /** Get coverage command arguments */
  getCoverageArgs(): string[];

  /** Parse coverage output to normalized format */
  parseCoverage(coveragePath: string): CoverageData;
}
```

### TR-2: Built-in Adapters

| Framework | Language | Detection | Coverage Tool |
|-----------|----------|-----------|---------------|
| pytest | Python | pytest.ini, pyproject.toml [tool.pytest] | pytest-cov |
| unittest | Python | test_*.py with `import unittest` | coverage.py |
| Jest | JS/TS | jest.config.*, package.json | Built-in |
| Vitest | JS/TS | vite.config.* with test | c8/istanbul |
| Mocha | JS/TS | .mocharc.*, package.json | nyc |

### TR-3: Normalized Coverage Format

```typescript
interface CoverageData {
  /** Total line coverage percentage */
  lineCoverage: number;

  /** Total branch coverage percentage */
  branchCoverage: number;

  /** Per-file coverage */
  files: {
    path: string;
    lines: { covered: number; total: number };
    branches: { covered: number; total: number };
    uncoveredLines: number[];
  }[];

  /** Source framework */
  source: 'pytest-cov' | 'coverage.py' | 'jest' | 'vitest' | 'nyc';
}
```

### TR-4: Settings Schema

```json
{
  "ldf.testFramework": {
    "type": "string",
    "enum": ["auto", "pytest", "unittest", "jest", "vitest", "mocha"],
    "default": "auto",
    "description": "Test framework to use (auto-detect by default)"
  },
  "ldf.testFrameworks": {
    "type": "array",
    "items": { "type": "string" },
    "description": "Frameworks to use for multi-framework projects"
  },
  "ldf.testCommand.pytest": {
    "type": "string",
    "default": "pytest",
    "description": "Custom pytest command"
  },
  "ldf.testCommand.jest": {
    "type": "string",
    "default": "npx jest",
    "description": "Custom Jest command"
  }
}
```

## Question-Pack Answers

### Security
- **Command injection:** All test commands built through adapter, not user input
- **Path validation:** Test file paths validated before execution

### Testing
- **Unit tests:** Test each adapter's detection and parsing logic
- **Integration tests:** Run against sample projects for each framework
- **Coverage:** 80% for adapter code

### API Design
- **Extensibility:** Adapter interface allows community extensions
- **Defaults:** Sensible defaults, zero config for common setups

### Data Model
- **Coverage normalization:** Common format enables cross-framework comparison
- **Caching:** Cache detected framework per workspace

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks/Tests | Owner | Status |
|-----------|--------------|--------|-------------|-------|--------|
| 1. Testing Coverage | [US-2, US-3] | [TBD] | [TBD] | [TBD] | TODO |
| 3. Error Handling | [US-2 AC-2.4] | [TBD] | [TBD] | [TBD] | TODO |
| 5. API Design | [TR-1] | [TBD] | [TBD] | [TBD] | TODO |
| 6. Data Validation | [TR-4] | [TBD] | [TBD] | [TBD] | TODO |
| 8. Documentation | [All] | [TBD] | [TBD] | [TBD] | TODO |

## Dependencies

- Respective test frameworks installed in user's project
- Coverage tools installed (pytest-cov, nyc, etc.)

## Priority Order

1. **P0:** Framework adapter interface
2. **P1:** pytest adapter (current behavior, refactored)
3. **P1:** Jest adapter (most popular JS framework)
4. **P2:** Vitest adapter (growing adoption)
5. **P3:** unittest, Mocha adapters

## Out of Scope

- Test explorer integration (VS Code has built-in test API)
- Inline test running (click to run single test)
- Test debugging
- Framework-specific configuration UI
- Less common frameworks (ward, hypothesis, AVA, tape)

## Effort Estimate

- **Size:** Medium-Large
- **Risk:** Medium (well-defined interface, incremental delivery)
- **Recommended approach:** Ship pytest adapter first, add others incrementally

# VS Code Extension v2 - Tasks

## Phase 1: Cross-Platform Foundation

- [ ] **Task 1.1:** Add `getVenvExecutablePath()` helper to utils.ts
- [ ] **Task 1.2:** Add `venvExecutableExists()` helper to utils.ts
- [ ] **Task 1.3:** Update Clone & Install to use new helper
- [ ] **Task 1.4:** Add unit tests for venv path helpers
- [ ] **Task 1.5:** Test on Windows (manual or CI)

## Phase 2: Run Tests & Preflight

- [ ] **Task 2.1:** Add `ldf.runTests` command
- [ ] **Task 2.2:** Add `ldf.runTestsForSpec` command with spec picker
- [ ] **Task 2.3:** Add `ldf.preflight` command
- [ ] **Task 2.4:** Register commands in package.json
- [ ] **Task 2.5:** Add test runner settings (`ldf.testArgs`)
- [ ] **Task 2.6:** Parse exit codes and show pass/fail notifications

## Phase 3: Doctor & Status

- [ ] **Task 3.1:** Add `ldf.doctor` command
- [ ] **Task 3.2:** Create output channel for doctor results
- [ ] **Task 3.3:** Add status bar item
- [ ] **Task 3.4:** Implement status provider with file watching
- [ ] **Task 3.5:** Add `ldf.showStatusBar` setting

## Phase 4: Coverage & MCP

- [ ] **Task 4.1:** Add `ldf.generateCoverage` command
- [ ] **Task 4.2:** Add `ldf.mcpHealth` command
- [ ] **Task 4.3:** Show coverage summary in notification
- [ ] **Task 4.4:** Add `ldf.coverageThreshold` setting

## Phase 5: Documentation & Polish

- [ ] **Task 5.1:** Update README with new features
- [ ] **Task 5.2:** Add keyboard shortcuts for common actions
- [ ] **Task 5.3:** Update CHANGELOG.md
- [ ] **Task 5.4:** Test full workflow on clean install

## Completion Checklist

- [ ] All tasks completed
- [ ] Tests passing (36+ existing + new)
- [ ] Works on macOS
- [ ] Works on Windows
- [ ] Documentation updated
- [ ] Version bumped for release

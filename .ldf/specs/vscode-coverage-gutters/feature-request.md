# Feature Request: Coverage Gutters Integration

## Summary

Integrate with the popular [Coverage Gutters](https://marketplace.visualstudio.com/items?itemName=ryanluker.vscode-coverage-gutters) extension to display real-time test coverage indicators in the editor gutter.

## Problem Statement

Currently, LDF's coverage features show aggregate statistics (e.g., "85% line coverage"). Developers must open coverage reports or navigate to specific files to see which lines are covered. This creates friction when trying to identify untested code paths.

## Proposed Solution

Rather than building custom gutter rendering (complex, duplicates existing work), integrate with Coverage Gutters:

1. **Generate compatible coverage files** - Output coverage in lcov or Cobertura format
2. **Auto-trigger Coverage Gutters** - After `ldf coverage`, signal Coverage Gutters to refresh
3. **Document the integration** - Guide users on setup

## User Experience

```
┌─────────────────────────────────────────────────────────┐
│  1  │ ✓ │ def calculate_total(items):                   │
│  2  │ ✓ │     total = 0                                 │
│  3  │ ✓ │     for item in items:                        │
│  4  │ ✓ │         total += item.price                   │
│  5  │   │     if apply_discount:           # uncovered  │
│  6  │   │         total *= 0.9             # uncovered  │
│  7  │ ✓ │     return total                              │
└─────────────────────────────────────────────────────────┘
```

Green = covered, Red/blank = not covered

## Integration Points

### 1. Coverage File Generation

`ldf coverage` should output in Coverage Gutters-compatible format:

```bash
# Current: generates .ldf/coverage.json (custom format)
ldf coverage

# Enhanced: also generate lcov.info
ldf coverage --format lcov --output coverage/lcov.info
```

### 2. VS Code Settings Sync

Configure Coverage Gutters to find LDF's coverage output:

```json
{
  "coverage-gutters.coverageFileNames": [
    "coverage/lcov.info",
    ".ldf/coverage/lcov.info"
  ]
}
```

### 3. Command Chaining

After running tests, trigger Coverage Gutters refresh:

```typescript
// After ldf.runTests completes
await vscode.commands.executeCommand('coverage-gutters.displayCoverage');
```

## Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| **Integrate with Coverage Gutters** | Leverages mature extension, minimal code | Dependency on external extension |
| **Build custom gutter renderer** | Full control, no dependencies | Complex, duplicates existing work |
| **Webview coverage panel** | Rich visualization | Not inline, context switch |
| **Do nothing** | No effort | Poor DX for coverage analysis |

## Requirements for Full Spec

If this feature request is approved, a full spec should address:

1. **Coverage format support** - lcov, Cobertura, or both?
2. **Auto-trigger behavior** - Always trigger, or setting to disable?
3. **Multi-framework coverage** - Merge coverage from pytest + Jest?
4. **Guardrail overlay** - Show which lines satisfy which guardrails?

## Dependencies

- [Coverage Gutters extension](https://marketplace.visualstudio.com/items?itemName=ryanluker.vscode-coverage-gutters) (optional, graceful degradation)
- Coverage tool that outputs lcov format:
  - pytest-cov: `pytest --cov --cov-report=lcov`
  - Jest: `jest --coverage --coverageReporters=lcov`

## Effort Estimate

- **Integration only:** Small (add lcov output, document setup)
- **With auto-trigger:** Small-Medium (detect extension, chain commands)
- **Full guardrail overlay:** Large (custom rendering, requires full spec)

## Recommendation

Start with documentation showing how to manually integrate Coverage Gutters with LDF. If adoption is high, add auto-trigger and format generation in a future release.

## References

- [Coverage Gutters GitHub](https://github.com/ryanluker/vscode-coverage-gutters)
- [lcov format spec](https://github.com/linux-test-project/lcov)
- [pytest-cov lcov output](https://pytest-cov.readthedocs.io/en/latest/reporting.html)

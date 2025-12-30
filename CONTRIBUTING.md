# Contributing to LDF VS Code Extension

Thank you for your interest in contributing to the LDF VS Code extension!

## Development Setup

1. Clone the repository
2. Run `npm install` to install dependencies
3. Press F5 in VS Code to launch the Extension Development Host

## VS Code Extension Development Guidelines

### Dependency Rules

- **NEVER** add runtime dependencies to `devDependencies`
- Prefer VS Code native APIs over npm packages when possible:
  - Use `vscode.workspace.findFiles()` instead of `glob`
  - Use `vscode.workspace.fs` instead of Node.js `fs` when appropriate
- Run `npm run compile && npm run lint` before every PR

### TreeDataProvider Pattern

All TreeDataProvider implementations MUST include:

1. `onDidChangeTreeData` event emitter
2. `refresh()` method that fires the event

```typescript
class MyTreeProvider implements vscode.TreeDataProvider<MyItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MyItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
    // ... getTreeItem, getChildren, etc.
}
```

### Activation Events

- Views require explicit `onView:viewId` activation events in package.json
- While VS Code docs claim views auto-activate since 1.74, this is unreliable in practice
- Always include `activationEvents` for contributed views:
  ```json
  "activationEvents": [
    "onView:ldf-specs",
    "onView:ldf-guardrails",
    "onView:ldf-tasks"
  ]
  ```

### Command Registration

- Commands that need cross-module access must be exported from their defining module
- Never use placeholder stubs that just open settings
- All commands in package.json must have working implementations

### Pre-Release Checklist

1. `npm run compile` - No TypeScript errors
2. `npm run lint` - No ESLint warnings
3. `npm run package` - VSIX builds successfully
4. `npx vsce ls` - Verify packaged files are correct
5. Test installation: `code --install-extension *.vsix --force`
6. Check Extension Host logs (Help → Toggle Developer Tools → Console) for activation errors

## Pull Request Process

1. Ensure CI passes (compile, lint, package)
2. Test the extension locally in the Extension Development Host
3. Update CHANGELOG.md with your changes
4. Request review from maintainers

## Reporting Issues

When reporting issues, please include:

1. VS Code version
2. Extension version
3. Extension Host logs (Help → Toggle Developer Tools → Console)
4. Steps to reproduce

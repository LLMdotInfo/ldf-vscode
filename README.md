# LDF VS Code Extension

[![Version](https://img.shields.io/visual-studio-marketplace/v/llmdotinfo.ldf-vscode)](https://marketplace.visualstudio.com/items?itemName=llmdotinfo.ldf-vscode)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/llmdotinfo.ldf-vscode)](https://marketplace.visualstudio.com/items?itemName=llmdotinfo.ldf-vscode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Visual tools for spec-driven development with [LDF (LLM Development Framework)](https://github.com/LLMdotInfo/ldf).

## Features

### Spec Tree View
Browse all specs in your project with status indicators:
- **Draft** (orange edit icon): Requirements incomplete
- **In Review** (yellow eye icon): Awaiting approval
- **Approved** (green check icon): Ready for implementation
- **In Progress** (blue sync icon): Implementation started
- **Complete** (green double-check icon): All tasks done

### Guardrail Coverage Panel
Track guardrail coverage across all specs:
- See which guardrails are covered by which specs
- Identify gaps in coverage
- Visual status indicators (covered, partial, not covered)

### Task Progress View
Track implementation progress:
- Shows next task to work on and pending tasks
- Click to jump to task in tasks.md
- Mark tasks complete directly from the view

### Commands

| Command | Description |
|---------|-------------|
| `LDF: Create New Spec` | Create a new spec with templates |
| `LDF: Lint Spec` | Run linter on a specific spec |
| `LDF: Lint All Specs` | Run linter on all specs |
| `LDF: Run Audit` | Run audit on a spec |
| `LDF: Initialize LDF Project` | Set up LDF in current workspace |
| `LDF: Setup LDF (Clone & Install)` | Install LDF from GitHub |
| `LDF: Refresh Specs` | Refresh all views |
| `LDF: Switch Project` | Switch active project in multi-project workspace |
| `LDF: Workspace Report` | Show status of all projects in workspace |

### Snippets

Type these prefixes in markdown files to insert templates:

| Prefix | Description |
|--------|-------------|
| `ldf-story` | User story with EARS format |
| `ldf-ac` | Acceptance criterion |
| `ldf-matrix` | Guardrail coverage matrix |
| `ldf-task` | Task checkbox |
| `ldf-phase` | Task phase with multiple tasks |
| `ldf-api` | API endpoint documentation |
| `ldf-component` | Design component |
| `ldf-model` | Data model entity |
| `ldf-security` | Security considerations section |
| `ldf-req-template` | Complete requirements template |

## Installation

### From Marketplace

1. Open VS Code
2. Go to Extensions (Cmd+Shift+X / Ctrl+Shift+X)
3. Search for "LDF Spec-Driven Development"
4. Click Install

Or install from command line:
```bash
code --install-extension llmdotinfo.ldf-vscode
```

### From VSIX (Development)

1. Clone and build:
   ```bash
   git clone https://github.com/LLMdotInfo/ldf-vscode.git
   cd ldf-vscode
   npm install
   npm run compile
   npm run package
   ```

2. Install the VSIX:
   - Open VS Code
   - Press `Cmd+Shift+P` (or `Ctrl+Shift+P`)
   - Type "Install from VSIX"
   - Select the generated `.vsix` file

## Configuration

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ldf.executablePath` | `ldf` | Path to the ldf executable |
| `ldf.specsDirectory` | `.ldf/specs` | Directory containing spec files |
| `ldf.guardrailsFile` | `.ldf/guardrails.yaml` | Path to guardrails configuration |
| `ldf.autoRefresh` | `true` | Auto-refresh when files change |

### Recommended Workspace Settings

```json
{
  "ldf.specsDirectory": ".ldf/specs",
  "ldf.autoRefresh": true,
  "files.associations": {
    "*.md": "markdown"
  }
}
```

### Multi-Root Workspace Support

The extension fully supports VS Code multi-root workspaces, including:
- Separate spec trees per workspace folder
- Independent guardrail configurations per workspace
- Workspace-aware lint/audit commands
- Hierarchical tree views with project folders

**Duplicate folder names:** If you have multiple workspace folders with the same name (e.g., two folders named "app"), the extension distinguishes them by their full path internally while displaying the basename in the UI.

**Primary Guardrail Workspace:** Use the `LDF: Select Primary Guardrail Workspace` command to apply one workspace's guardrails.yaml configuration to all workspaces. This is useful when you want consistent guardrails across multiple projects.

### Multi-Project Workspace Support (ldf-workspace.yaml)

The extension supports LDF's multi-project workspace feature, which uses `ldf-workspace.yaml` to manage multiple LDF projects:

- **Automatic Detection** - Detects and parses `ldf-workspace.yaml` workspace manifests
- **Project Aliases** - Uses project aliases from the manifest in tree views and status bar
- **Switch Project Command** - Use `LDF: Switch Project` to change the active project
- **Workspace Report** - Use `LDF: Workspace Report` to see status of all projects
- **Status Bar Indicator** - Shows active project; click to switch

To create a multi-project workspace, run `ldf workspace init` in the terminal to create an `ldf-workspace.yaml` manifest.

## Requirements

- VS Code 1.85.0 or higher
- [LDF CLI](https://github.com/LLMdotInfo/ldf) installed
- An LDF-initialized project (`.ldf/` directory)

## Getting Started

1. Install the extension
2. Open a project with LDF initialized (or use `LDF: Setup LDF` to install)
3. Look for the "LDF Specs" icon in the Activity Bar
4. Create your first spec with `LDF: Create New Spec`

## Extension Views

### LDF Specs Panel

Located in the Activity Bar (checklist icon), contains three views:

1. **Specifications** - Tree of all specs with status
2. **Guardrail Coverage** - Coverage matrix visualization
3. **Current Tasks** - In-progress and pending tasks

## Development

```bash
# Clone the repository
git clone https://github.com/LLMdotInfo/ldf-vscode.git
cd ldf-vscode

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Run tests
npm test

# Run linting
npm run lint

# Package for distribution
npm run package
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related

- [LDF CLI & Framework](https://github.com/LLMdotInfo/ldf) - The main LDF repository
- [LDF Documentation](https://github.com/LLMdotInfo/ldf/tree/main/docs) - Full documentation
- [Installation Guide](https://github.com/LLMdotInfo/ldf/blob/main/docs/installation/quick-install.md) - Getting started with LDF

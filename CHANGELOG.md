# Changelog

All notable changes to the LDF VS Code Extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-12-27

### Added

#### Multi-Project Workspace Support
- **`ldf-workspace.yaml` Detection** - Automatically detects and parses workspace manifests
- **Switch Project Command** - `LDF: Switch Project` to change active project in workspace
- **Workspace Report Command** - `LDF: Workspace Report` shows status of all projects
- **Project Status Bar** - Status bar indicator showing active project with click-to-switch
- **Project Aliases** - Uses project aliases from workspace manifest in tree views

#### Enhanced Tree Views
- **Hierarchical Grouping** - Multi-root workspaces now show specs/tasks grouped under project folders
- **Project Alias Display** - Shows project alias from manifest (or folder name fallback)
- **Workspace Folder Icons** - Visual distinction for project folders in tree view

#### Integration
- **Workspace File Watcher** - Auto-refreshes when `ldf-workspace.yaml` changes
- **Workspace Context API** - Extension exports `isInWorkspace()`, `getActiveProject()`, `getWorkspaceManifest()` for other extensions

### Changed
- Version number now aligns with LDF CLI version (1.1.0)
- Tree view providers use hierarchical structure in multi-root mode

## [1.0.0] - 2025-12-26

### Added

#### Core Views
- **Spec Tree View** - Browse all specs with status indicators (Draft, In Review, Approved, In Progress, Complete)
- **Guardrail Coverage Panel** - Track guardrail coverage across specs with visual indicators
- **Task Progress View** - Monitor pending tasks, mark complete from UI

#### Multi-Root Workspace Support
- **Per-Workspace Detection** - All LDF projects in multi-root workspaces detected and displayed
- **Workspace Folder Indicators** - Tree items show folder prefix when multiple LDF projects exist
- **Per-Workspace Guardrails** - Each workspace loads its own guardrails.yaml configuration
- **Isolated Coverage** - Each workspace shows only its own specs in guardrail coverage
- **Dynamic Folder Handling** - Providers update when workspace folders are added/removed

#### Guardrail Features
- **Coverage Statuses** - Support for DONE, PARTIAL, N/A, and TODO statuses
- **Per-Workspace Guardrail Sections** - Multi-root workspaces show guardrails grouped by folder
- **Primary Workspace Setting** - `ldf.primaryGuardrailWorkspace` to designate primary for multi-root
- **Conflict Detection** - Warn when same guardrail ID has different name/severity across workspaces

#### Configuration
- **`ldf.showNextTask` Setting** - Opt-in setting to auto-label first pending task as "next"
- **`ldf.outputMode` Setting** - Choose between terminal or output panel for lint/audit results
- **`ldf.skipAutoDetect` Setting** - Option to disable automatic ldf executable detection
- **CLI Version Detection** - Automatically detect installed LDF CLI version for project init

#### Developer Experience
- **Clone & Install Wizard** - One-click LDF installation from VS Code
- **Cross-platform Support** - Works on Windows, macOS, and Linux
- **Auto-detection** - Automatically finds `ldf` in PATH or virtualenv locations
- **10+ Markdown Snippets** - Quick templates for specs, user stories, tasks
- **File Watchers** - Auto-refresh views when spec files change
- **Guardrails Validation** - Schema validation with user-friendly error messages
- **Lazy Activation** - Extension only loads when interacting with LDF views/commands

#### Security
- **Shell-safe Execution** - Uses `execFile` (no shell) for safe command execution
- **Input Validation** - Spec names validated before shell execution
- **Audit Type Allowlist** - Only approved audit types can be executed

### Commands
- `LDF: Create New Spec` - Create a new spec with templates
- `LDF: Lint Spec` - Validate a specific spec
- `LDF: Lint All Specs` - Validate all specs in project
- `LDF: Run Audit` - Run security, gap analysis, or other audits
- `LDF: Initialize LDF Project` - Set up LDF in current workspace
- `LDF: Setup LDF (Clone & Install)` - Install LDF from GitHub
- `LDF: Refresh Specs` - Refresh all views
- `LDF: Mark Task Complete` - Mark a task as complete

### Snippets
- `ldf-story` - User story with EARS format
- `ldf-ac` - Acceptance criterion
- `ldf-matrix` - Guardrail coverage matrix
- `ldf-task` - Task checkbox
- `ldf-phase` - Task phase with multiple tasks
- `ldf-api` - API endpoint documentation
- `ldf-component` - Design component
- `ldf-model` - Data model entity
- `ldf-security` - Security considerations section
- `ldf-req-template` - Complete requirements template

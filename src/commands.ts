/**
 * LDF Extension Commands
 *
 * Registers and implements all extension commands:
 * - Create spec
 * - Lint spec/all specs
 * - Run audit
 * - Open spec files
 * - Mark task complete
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SpecTreeProvider, SpecTreeItem } from './specView';
import { GuardrailTreeProvider, GuardrailTreeItem } from './guardrailView';
import { TaskTreeProvider, TaskTreeItem } from './taskView';
import { isValidSpecName, VALID_AUDIT_TYPES, execFileAsync } from './utils';
import {
    getActiveProject,
    setActiveProject,
    getWorkspaceManifest,
    getWorkspaceRoot,
    isInWorkspace,
    ActiveProject
} from './extension';
import { resolveProjects, isLdfProject } from './workspace';

interface CommandContext {
    specProvider: SpecTreeProvider;
    guardrailProvider: GuardrailTreeProvider;
    taskProvider: TaskTreeProvider;
    workspacePath: string;
}

export function registerCommands(
    context: vscode.ExtensionContext,
    ctx: CommandContext
): void {
    const { specProvider, guardrailProvider, taskProvider, workspacePath } = ctx;

    // Refresh specs
    context.subscriptions.push(
        vscode.commands.registerCommand('ldf.refreshSpecs', () => {
            specProvider.refresh();
            guardrailProvider.refresh();
            taskProvider.refresh();
            vscode.window.showInformationMessage('LDF: Specs refreshed');
        })
    );

    // Create new spec
    context.subscriptions.push(
        vscode.commands.registerCommand('ldf.createSpec', async () => {
            const specName = await vscode.window.showInputBox({
                prompt: 'Enter spec name (e.g., user-authentication)',
                placeHolder: 'feature-name',
                validateInput: (value) => {
                    if (!value) return 'Spec name is required';
                    if (!/^[a-z0-9-]+$/.test(value)) {
                        return 'Use lowercase letters, numbers, and hyphens only';
                    }
                    return null;
                },
            });

            if (!specName) return;

            // Use active project path if set, otherwise default workspace
            const activeProject = getActiveProject();
            const targetPath = activeProject ? activeProject.path : workspacePath;

            const config = vscode.workspace.getConfiguration('ldf');
            const specsDir = path.join(
                targetPath,
                config.get('specsDirectory', '.ldf/specs')
            );
            const specPath = path.join(specsDir, specName);

            if (fs.existsSync(specPath)) {
                vscode.window.showErrorMessage(`Spec '${specName}' already exists`);
                return;
            }

            // Create spec directory and requirements.md
            try {
                fs.mkdirSync(specPath, { recursive: true });
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to create spec directory: ${err}`);
                return;
            }

            const requirementsTemplate = `# ${specName} - Requirements

## Overview

[Brief description of the feature]

## User Stories

### US-1: [Story Title]

**As a** [user type]
**I want to** [action]
**So that** [benefit]

**Acceptance Criteria:**
- [ ] AC-1.1: [Criterion]
- [ ] AC-1.2: [Criterion]

## Question-Pack Answers

### Security
- Authentication: [answer]
- Authorization: [answer]

### Data Model
- Tables: [answer]
- Relationships: [answer]

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks/Tests | Owner | Status |
|-----------|--------------|--------|-------------|-------|--------|
| 1. Testing Coverage | [US-1] | [TBD] | [TBD] | [TBD] | TODO |
| 2. Security Basics | [US-1] | [TBD] | [TBD] | [TBD] | TODO |
| 3. Error Handling | [US-1] | [TBD] | [TBD] | [TBD] | TODO |
| 4. Logging & Observability | [US-1] | [TBD] | [TBD] | [TBD] | TODO |
| 5. API Design | [US-1] | [TBD] | [TBD] | [TBD] | TODO |
| 6. Data Validation | [US-1] | [TBD] | [TBD] | [TBD] | TODO |
| 7. Database Migrations | [US-1] | [TBD] | [TBD] | [TBD] | TODO |
| 8. Documentation | [US-1] | [TBD] | [TBD] | [TBD] | TODO |

## Dependencies

- [List any dependencies]

## Out of Scope

- [What's explicitly not included]
`;

            try {
                fs.writeFileSync(
                    path.join(specPath, 'requirements.md'),
                    requirementsTemplate
                );
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to create requirements.md: ${err}`);
                return;
            }

            specProvider.refresh();

            // Open the new requirements file
            const doc = await vscode.workspace.openTextDocument(
                path.join(specPath, 'requirements.md')
            );
            await vscode.window.showTextDocument(doc);

            vscode.window.showInformationMessage(`LDF: Created spec '${specName}'`);
        })
    );

    // Lint single spec
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ldf.lintSpec',
            async (item?: SpecTreeItem) => {
                let specName: string | undefined;
                let targetPath: string;

                if (item?.specInfo) {
                    specName = item.specInfo.name;
                    // Use the item's workspace folder path (multi-root support)
                    targetPath = item.specInfo.folderPath || workspacePath;
                } else {
                    // Prompt for spec name with workspace context
                    const specs = specProvider.getSpecs();
                    const isMultiRoot = specs.some(s => s.folderName);

                    // Create QuickPick items with workspace info for multi-root
                    const quickPickItems = specs.map((s) => ({
                        label: s.name,
                        description: isMultiRoot ? s.folderName : undefined,
                        spec: s
                    }));

                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        placeHolder: 'Select spec to lint',
                    });

                    if (!selected) return;

                    specName = selected.spec.name;
                    // Use the selected spec's workspace path
                    targetPath = selected.spec.folderPath || workspacePath;
                }

                if (!specName) return;

                await runLint(targetPath, specName);
            }
        )
    );

    // Lint all specs
    context.subscriptions.push(
        vscode.commands.registerCommand('ldf.lintAllSpecs', async () => {
            await runLint(workspacePath);
        })
    );

    // Open spec (generic)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ldf.openSpec',
            async (item?: SpecTreeItem) => {
                if (!item?.specInfo) return;
                // Use the item's workspace folder path (multi-root support)
                const targetPath = item.specInfo.folderPath || workspacePath;
                await openSpecFile(targetPath, item.specInfo.name, 'requirements');
            }
        )
    );

    // Open requirements
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ldf.openRequirements',
            async (item?: SpecTreeItem) => {
                if (!item?.specInfo) return;
                const targetPath = item.specInfo.folderPath || workspacePath;
                await openSpecFile(targetPath, item.specInfo.name, 'requirements');
            }
        )
    );

    // Open design
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ldf.openDesign',
            async (item?: SpecTreeItem) => {
                if (!item?.specInfo) return;
                const targetPath = item.specInfo.folderPath || workspacePath;
                await openSpecFile(targetPath, item.specInfo.name, 'design');
            }
        )
    );

    // Open tasks
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ldf.openTasks',
            async (item?: SpecTreeItem) => {
                if (!item?.specInfo) return;
                const targetPath = item.specInfo.folderPath || workspacePath;
                await openSpecFile(targetPath, item.specInfo.name, 'tasks');
            }
        )
    );

    // Run audit
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ldf.runAudit',
            async (item?: SpecTreeItem) => {
                let specName: string | undefined;
                let targetPath: string;

                if (item?.specInfo) {
                    specName = item.specInfo.name;
                    // Use the item's workspace folder path (multi-root support)
                    targetPath = item.specInfo.folderPath || workspacePath;
                } else {
                    // Prompt for spec name with workspace context
                    const specs = specProvider.getSpecs();
                    const isMultiRoot = specs.some(s => s.folderName);

                    // Create QuickPick items with workspace info for multi-root
                    const quickPickItems = specs.map((s) => ({
                        label: s.name,
                        description: isMultiRoot ? s.folderName : undefined,
                        spec: s
                    }));

                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        placeHolder: 'Select spec to audit',
                    });

                    if (!selected) return;

                    specName = selected.spec.name;
                    // Use the selected spec's workspace path
                    targetPath = selected.spec.folderPath || workspacePath;
                }

                if (!specName) return;

                const auditType = await vscode.window.showQuickPick(
                    [
                        { label: 'Spec Review', value: 'spec-review' },
                        { label: 'Security Check', value: 'security-check' },
                        { label: 'Gap Analysis', value: 'gap-analysis' },
                        { label: 'Edge Cases', value: 'edge-cases' },
                    ],
                    { placeHolder: 'Select audit type' }
                );

                if (!auditType) return;

                await runAudit(targetPath, specName, auditType.value);
            }
        )
    );

    // Show guardrail details
    // Handler accepts either a GuardrailTreeItem (from context menu) or number (from code)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ldf.showGuardrailDetails',
            async (itemOrId?: GuardrailTreeItem | number) => {
                // Extract guardrail ID from tree item or use directly
                let guardrailId: number | undefined;
                if (typeof itemOrId === 'number') {
                    guardrailId = itemOrId;
                } else if (itemOrId?.guardrailId) {
                    guardrailId = itemOrId.guardrailId;
                }

                const coverage = guardrailProvider.getCoverage();
                const guardrail = coverage.find((c) => c.guardrail.id === guardrailId);

                if (!guardrail) {
                    vscode.window.showWarningMessage('Guardrail not found');
                    return;
                }

                // Show all specs with their status, not just DONE specs
                const specsInfo = guardrail.specCoverage.length > 0
                    ? guardrail.specCoverage.map(sc => `${sc.specName} (${sc.status})`).join(', ')
                    : 'No specs';

                const message = [
                    `**${guardrail.guardrail.name}**`,
                    ``,
                    guardrail.guardrail.description,
                    ``,
                    `Severity: ${guardrail.guardrail.severity}`,
                    `Status: ${guardrail.status}`,
                    `Covered by: ${specsInfo}`,
                ].join('\n');

                vscode.window.showInformationMessage(message, { modal: true });
            }
        )
    );

    // Mark task complete
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ldf.markTaskComplete',
            async (item?: TaskTreeItem) => {
                if (!item?.taskId) return;

                const success = await taskProvider.markTaskComplete(item.taskId);
                if (success) {
                    vscode.window.showInformationMessage(
                        `LDF: Task marked complete`
                    );
                } else {
                    vscode.window.showErrorMessage(
                        `LDF: Failed to mark task complete`
                    );
                }
            }
        )
    );

    // Initialize project
    context.subscriptions.push(
        vscode.commands.registerCommand('ldf.initProject', async () => {
            const config = vscode.workspace.getConfiguration('ldf');
            const ldfDir = path.join(workspacePath, '.ldf');
            const configFile = path.join(ldfDir, 'config.yaml');
            const specsDir = path.join(
                workspacePath,
                config.get('specsDirectory', '.ldf/specs')
            );

            // Check for existing config.yaml (more accurate than checking specs dir)
            if (fs.existsSync(configFile)) {
                const result = await vscode.window.showWarningMessage(
                    'LDF config already exists. Reinitialize? This will overwrite config.yaml.',
                    'Reinitialize',
                    'Cancel'
                );
                if (result !== 'Reinitialize') return;
            } else if (fs.existsSync(specsDir)) {
                const result = await vscode.window.showWarningMessage(
                    'LDF specs directory exists but config.yaml is missing. Create config?',
                    'Create',
                    'Cancel'
                );
                if (result !== 'Create') return;
            }

            // Create directory structure
            fs.mkdirSync(specsDir, { recursive: true });
            fs.mkdirSync(path.join(ldfDir, 'answerpacks'), { recursive: true });

            // Detect CLI version (with fallback)
            const frameworkVersion = await getLdfVersion();

            // Create config.yaml with schema matching LDF CLI expectations
            const projectName = path.basename(workspacePath);
            const timestamp = new Date().toISOString();
            const configYaml = `# LDF Configuration
version: "1.0"
framework_version: "${frameworkVersion}"
framework_updated: "${timestamp}"

project:
  name: "${projectName}"
  specs_dir: .ldf/specs

guardrails:
  preset: custom
  overrides: {}

question_packs:
  - security
  - testing
  - api-design
  - data-model

mcp_servers:
  - spec_inspector
  - coverage_reporter

lint:
  strict: false
  auto_fix: false
`;
            fs.writeFileSync(configFile, configYaml);

            specProvider.refresh();
            guardrailProvider.refresh();
            taskProvider.refresh();

            vscode.window.showInformationMessage(`LDF: Project initialized (framework v${frameworkVersion})`);
        })
    );

    // Select primary guardrail workspace (for multi-root)
    context.subscriptions.push(
        vscode.commands.registerCommand('ldf.selectPrimaryGuardrailWorkspace', async () => {
            const folders = vscode.workspace.workspaceFolders || [];

            if (folders.length < 2) {
                vscode.window.showInformationMessage('LDF: This command is only useful in multi-root workspaces.');
                return;
            }

            // Build picker items: "None" option + all workspace folders
            const items: Array<{ label: string; description: string; path: string }> = [
                {
                    label: '$(close) None',
                    description: 'Load guardrails per-workspace (default)',
                    path: ''
                },
                ...folders.map(f => ({
                    label: f.name,
                    description: f.uri.fsPath,
                    path: f.uri.fsPath
                }))
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select workspace to use as primary guardrails source',
                title: 'Primary Guardrail Workspace'
            });

            if (selected) {
                const config = vscode.workspace.getConfiguration('ldf');
                await config.update('primaryGuardrailWorkspace', selected.path, vscode.ConfigurationTarget.Workspace);
                guardrailProvider.refresh();

                if (selected.path) {
                    vscode.window.showInformationMessage(`LDF: Using guardrails from '${selected.label}' for all workspaces`);
                } else {
                    vscode.window.showInformationMessage('LDF: Using per-workspace guardrails');
                }
            }
        })
    );

    // Switch active project (workspace mode)
    context.subscriptions.push(
        vscode.commands.registerCommand('ldf.switchProject', async () => {
            // Check if we're in a workspace
            if (!isInWorkspace()) {
                vscode.window.showInformationMessage(
                    'LDF: Project switching requires an ldf-workspace.yaml file. ' +
                    'Use "ldf workspace init" in the terminal to create one.'
                );
                return;
            }

            const manifest = getWorkspaceManifest();
            const wsRoot = getWorkspaceRoot();

            if (!manifest || !wsRoot) {
                vscode.window.showErrorMessage('LDF: Failed to read workspace configuration');
                return;
            }

            // Resolve all projects
            const projects = await resolveProjects(manifest, wsRoot);

            if (projects.length === 0) {
                vscode.window.showInformationMessage('LDF: No projects found in workspace');
                return;
            }

            const currentProject = getActiveProject();

            // Build QuickPick items
            const items = projects.map(p => {
                const projectPath = path.resolve(wsRoot, p.path);
                const isActive = currentProject?.path === projectPath;
                const isInitialized = isLdfProject(projectPath);

                return {
                    label: `${isActive ? '$(check) ' : ''}${p.alias}`,
                    description: p.path,
                    detail: isInitialized ? 'Initialized' : 'Not initialized',
                    project: p,
                    projectPath: projectPath
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select project to activate',
                title: `Switch Project (${manifest.name})`
            });

            if (!selected) return;

            // Set the active project
            const newActiveProject: ActiveProject = {
                alias: selected.project.alias,
                path: selected.projectPath,
                name: selected.project.alias
            };

            setActiveProject(newActiveProject);

            // Refresh tree views to reflect the change
            specProvider.refresh();
            guardrailProvider.refresh();
            taskProvider.refresh();

            vscode.window.showInformationMessage(`LDF: Switched to project '${selected.project.alias}'`);
        })
    );

    // Workspace report command
    context.subscriptions.push(
        vscode.commands.registerCommand('ldf.workspaceReport', async () => {
            // Check if we're in a workspace
            if (!isInWorkspace()) {
                vscode.window.showInformationMessage(
                    'LDF: Workspace Report requires an ldf-workspace.yaml file. ' +
                    'Use "ldf workspace init" in the terminal to create one.'
                );
                return;
            }

            const manifest = getWorkspaceManifest();
            const wsRoot = getWorkspaceRoot();

            if (!manifest || !wsRoot) {
                vscode.window.showErrorMessage('LDF: Failed to read workspace configuration');
                return;
            }

            // Resolve all projects
            const projects = await resolveProjects(manifest, wsRoot);

            // Create output channel for report
            const outputChannel = getOutputChannel();
            outputChannel.clear();
            outputChannel.show(true);

            outputChannel.appendLine('═══════════════════════════════════════════════════');
            outputChannel.appendLine(`  LDF Workspace Report: ${manifest.name}`);
            outputChannel.appendLine('═══════════════════════════════════════════════════');
            outputChannel.appendLine('');
            outputChannel.appendLine(`Workspace Root: ${wsRoot}`);
            outputChannel.appendLine(`Schema Version: ${manifest.version}`);
            outputChannel.appendLine(`Projects: ${projects.length}`);
            outputChannel.appendLine('');

            // Report on each project
            outputChannel.appendLine('───────────────────────────────────────────────────');
            outputChannel.appendLine('  Projects');
            outputChannel.appendLine('───────────────────────────────────────────────────');

            for (const project of projects) {
                const projectPath = path.resolve(wsRoot, project.path);
                const initialized = isLdfProject(projectPath);
                const statusIcon = initialized ? '✓' : '○';
                const statusText = initialized ? 'Initialized' : 'Not initialized';

                outputChannel.appendLine('');
                outputChannel.appendLine(`  ${statusIcon} ${project.alias}`);
                outputChannel.appendLine(`    Path: ${project.path}`);
                outputChannel.appendLine(`    Status: ${statusText}`);

                // Count specs if initialized
                if (initialized) {
                    const specsDir = path.join(projectPath, '.ldf', 'specs');
                    if (fs.existsSync(specsDir)) {
                        try {
                            const specFolders = fs.readdirSync(specsDir, { withFileTypes: true })
                                .filter(d => d.isDirectory())
                                .length;
                            outputChannel.appendLine(`    Specs: ${specFolders}`);
                        } catch {
                            outputChannel.appendLine(`    Specs: (unable to read)`);
                        }
                    } else {
                        outputChannel.appendLine(`    Specs: 0`);
                    }
                }
            }

            outputChannel.appendLine('');
            outputChannel.appendLine('───────────────────────────────────────────────────');
            outputChannel.appendLine('  Shared Resources');
            outputChannel.appendLine('───────────────────────────────────────────────────');
            outputChannel.appendLine('');

            const sharedPath = path.join(wsRoot, manifest.shared.path);
            const sharedExists = fs.existsSync(sharedPath);
            outputChannel.appendLine(`  Path: ${manifest.shared.path}`);
            outputChannel.appendLine(`  Status: ${sharedExists ? 'Found' : 'Not found'}`);

            if (sharedExists) {
                outputChannel.appendLine(`  Inherit Guardrails: ${manifest.shared.inheritGuardrails ? 'Yes' : 'No'}`);
                outputChannel.appendLine(`  Inherit Templates: ${manifest.shared.inheritTemplates ? 'Yes' : 'No'}`);
                outputChannel.appendLine(`  Inherit Question Packs: ${manifest.shared.inheritQuestionPacks ? 'Yes' : 'No'}`);
                outputChannel.appendLine(`  Inherit Macros: ${manifest.shared.inheritMacros ? 'Yes' : 'No'}`);
            }

            outputChannel.appendLine('');
            outputChannel.appendLine('═══════════════════════════════════════════════════');

            // Show active project
            const activeProject = getActiveProject();
            if (activeProject) {
                outputChannel.appendLine(`  Active Project: ${activeProject.alias}`);
            } else {
                outputChannel.appendLine('  Active Project: None (use Switch Project to select)');
            }
            outputChannel.appendLine('═══════════════════════════════════════════════════');
        })
    );
}

async function openSpecFile(
    workspacePath: string,
    specName: string,
    fileType: 'requirements' | 'design' | 'tasks'
): Promise<void> {
    const config = vscode.workspace.getConfiguration('ldf');
    const specsDir = path.join(
        workspacePath,
        config.get('specsDirectory', '.ldf/specs')
    );
    const filePath = path.join(specsDir, specName, `${fileType}.md`);

    if (!fs.existsSync(filePath)) {
        const create = await vscode.window.showQuickPick(['Create', 'Cancel'], {
            placeHolder: `${fileType}.md doesn't exist. Create it?`,
        });

        if (create !== 'Create') return;

        // Create with template
        const templates: Record<string, string> = {
            design: `# ${specName} - Design

## Architecture Overview

[High-level architecture description]

## Components

### Component 1

**Purpose:** [What it does]

**Interface:**
\`\`\`typescript
interface Component1 {
  // Define interface
}
\`\`\`

## Data Model

### Entity 1

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK |

## API Endpoints

### POST /api/v1/resource

**Request:**
\`\`\`json
{
  "field": "value"
}
\`\`\`

**Response:**
\`\`\`json
{
  "id": "uuid"
}
\`\`\`

## Guardrail Mapping

| Guardrail | Implementation | Section |
|-----------|---------------|---------|
| 1. Testing | Unit tests + Integration | [T-1] |

## Security Considerations

- [Security consideration 1]
`,
            tasks: `# ${specName} - Tasks

## Phase 1: Setup

- [ ] **Task 1.1:** Create initial structure
- [ ] **Task 1.2:** Set up dependencies

## Phase 2: Implementation

- [ ] **Task 2.1:** Implement core functionality
- [ ] **Task 2.2:** Add error handling
- [ ] **Task 2.3:** Add validation

## Phase 3: Testing

- [ ] **Task 3.1:** Write unit tests
- [ ] **Task 3.2:** Write integration tests

## Phase 4: Documentation

- [ ] **Task 4.1:** Update API documentation
- [ ] **Task 4.2:** Add inline comments

## Completion Checklist

- [ ] All tasks completed
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Code reviewed
`,
        };

        const template = templates[fileType] || `# ${specName} - ${fileType}\n\n`;
        fs.writeFileSync(filePath, template);
    }

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
}

function getLdfCommand(): string {
    const config = vscode.workspace.getConfiguration('ldf');
    return config.get('executablePath', 'ldf');
}

/**
 * Detect the installed LDF CLI version.
 * Falls back to '1.0.0' if detection fails.
 */
async function getLdfVersion(): Promise<string> {
    const ldf = getLdfCommand();
    try {
        // Use execFileAsync (no shell) for safe execution
        const { stdout } = await execFileAsync(ldf, ['--version']);
        // Parse version from output like "ldf 1.2.0" or "LDF Framework 1.2.0" or just "1.2.0"
        const match = stdout.match(/(\d+\.\d+\.\d+)/);
        return match ? match[1] : '1.0.0';
    } catch {
        // CLI not available or version command failed
        return '1.0.0';
    }
}

// Output channel for LDF commands (reused for output panel mode)
let ldfOutputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
    if (!ldfOutputChannel) {
        ldfOutputChannel = vscode.window.createOutputChannel('LDF');
    }
    return ldfOutputChannel;
}

async function runLint(workspacePath: string, specName?: string): Promise<void> {
    const ldf = getLdfCommand();
    const config = vscode.workspace.getConfiguration('ldf');
    const outputMode = config.get<string>('outputMode', 'terminal');

    if (specName) {
        // Validate spec name before execution
        if (!isValidSpecName(specName)) {
            vscode.window.showErrorMessage(
                'Invalid spec name. Use only letters, numbers, hyphens, underscores, and dots.'
            );
            return;
        }
    }

    // Build command arguments
    const args = specName ? ['lint', specName] : ['lint', '--all'];

    if (outputMode === 'outputPanel') {
        // Output panel mode: capture output to LDF channel
        await runCommandToOutputChannel(ldf, args, workspacePath, 'Lint');
    } else {
        // Terminal mode: use VS Code Task API with ProcessExecution
        await runCommandInTerminal(ldf, args, workspacePath, 'LDF Lint');
    }
}

async function runAudit(
    workspacePath: string,
    specName: string,
    auditType: string
): Promise<void> {
    // Validate audit type against allowlist
    if (!VALID_AUDIT_TYPES.includes(auditType)) {
        vscode.window.showErrorMessage(`Invalid audit type: ${auditType}`);
        return;
    }

    // Validate spec name before execution
    if (!isValidSpecName(specName)) {
        vscode.window.showErrorMessage(
            'Invalid spec name. Use only letters, numbers, hyphens, underscores, and dots.'
        );
        return;
    }

    const ldf = getLdfCommand();
    const config = vscode.workspace.getConfiguration('ldf');
    const outputMode = config.get<string>('outputMode', 'terminal');

    // Build command arguments
    const args = ['audit', '--type', auditType, '--spec', specName];

    if (outputMode === 'outputPanel') {
        // Output panel mode: capture output to LDF channel
        await runCommandToOutputChannel(ldf, args, workspacePath, 'Audit');
    } else {
        // Terminal mode: use VS Code Task API with ProcessExecution
        await runCommandInTerminal(ldf, args, workspacePath, 'LDF Audit');
    }
}

/**
 * Run a command using VS Code Task API with ProcessExecution.
 * Shows output in integrated terminal with proper cwd.
 */
async function runCommandInTerminal(
    executable: string,
    args: string[],
    cwd: string,
    taskName: string
): Promise<void> {
    // Find the workspace folder that contains the cwd path
    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
        folder => cwd.startsWith(folder.uri.fsPath)
    ) || vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    const task = new vscode.Task(
        { type: 'ldf', task: taskName.toLowerCase().replace(/\s+/g, '-') },
        workspaceFolder,
        taskName,
        'ldf',
        new vscode.ProcessExecution(executable, args, { cwd })
    );
    task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        focus: true,
        panel: vscode.TaskPanelKind.Shared
    };

    await vscode.tasks.executeTask(task);
}

/**
 * Run a command and capture output to the LDF output channel.
 * Uses execFile (no shell) for safe handling of paths with spaces.
 */
async function runCommandToOutputChannel(
    executable: string,
    args: string[],
    cwd: string,
    operation: string
): Promise<void> {
    const outputChannel = getOutputChannel();
    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine(`Running LDF ${operation}...`);
    outputChannel.appendLine(`Command: ${executable} ${args.join(' ')}`);
    outputChannel.appendLine(`Working directory: ${cwd}`);
    outputChannel.appendLine('---');

    try {
        // Use execFileAsync (no shell) for safe argument handling
        const { stdout, stderr } = await execFileAsync(executable, args, { cwd });

        if (stdout) {
            outputChannel.appendLine(stdout);
        }
        if (stderr) {
            outputChannel.appendLine('Errors/Warnings:');
            outputChannel.appendLine(stderr);
        }
        outputChannel.appendLine('---');
        outputChannel.appendLine(`LDF ${operation} completed.`);
    } catch (error) {
        const err = error as { stdout?: string; stderr?: string; message?: string };
        if (err.stdout) {
            outputChannel.appendLine(err.stdout);
        }
        if (err.stderr) {
            outputChannel.appendLine('Errors:');
            outputChannel.appendLine(err.stderr);
        }
        outputChannel.appendLine('---');
        outputChannel.appendLine(`LDF ${operation} failed: ${err.message || 'Unknown error'}`);
        vscode.window.showErrorMessage(`LDF ${operation} failed. See output panel for details.`);
    }
}

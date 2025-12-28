/**
 * LDF VS Code Extension
 *
 * Provides visual tools for spec-driven development:
 * - Spec tree view with status indicators
 * - Guardrail coverage panel
 * - Task progress tracking
 * - Command palette actions
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SpecTreeProvider } from './specView';
import { GuardrailTreeProvider } from './guardrailView';
import { TaskTreeProvider } from './taskView';
import { registerCommands } from './commands';
import { findInPath, getVenvCandidates, getVenvExecutablePath } from './utils';
import {
    detectWorkspaceContext,
    findWorkspaceRoot,
    resolveProjects,
    WorkspaceManifest,
    ProjectEntry,
    WORKSPACE_MANIFEST
} from './workspace';

let specProvider: SpecTreeProvider;
let guardrailProvider: GuardrailTreeProvider;
let taskProvider: TaskTreeProvider;

// Status bar for active project indicator
let projectStatusBar: vscode.StatusBarItem;

// Active project state
export interface ActiveProject {
    alias: string;
    path: string;
    name: string;
}

let activeProject: ActiveProject | null = null;

// Workspace context
let workspaceRoot: string | null = null;
let workspaceManifest: WorkspaceManifest | null = null;

/**
 * Get the current active project.
 */
export function getActiveProject(): ActiveProject | null {
    return activeProject;
}

/**
 * Set the active project and update status bar.
 */
export function setActiveProject(project: ActiveProject | null): void {
    activeProject = project;
    updateProjectStatusBar();
    // Refresh tree views to reflect active project
    refreshAll();
}

/**
 * Get the workspace manifest if we're in a multi-project workspace.
 */
export function getWorkspaceManifest(): WorkspaceManifest | null {
    return workspaceManifest;
}

/**
 * Get the workspace root if we're in a multi-project workspace.
 */
export function getWorkspaceRoot(): string | null {
    return workspaceRoot;
}

/**
 * Check if we're in a multi-project workspace.
 */
export function isInWorkspace(): boolean {
    return workspaceManifest !== null;
}

/**
 * Update status bar to show active project.
 */
function updateProjectStatusBar(): void {
    if (!projectStatusBar) {
        return;
    }

    if (activeProject) {
        projectStatusBar.text = `$(project) ${activeProject.alias}`;
        projectStatusBar.tooltip = `LDF Project: ${activeProject.alias}\nClick to switch project`;
        projectStatusBar.show();
    } else if (workspaceManifest) {
        projectStatusBar.text = `$(root-folder) ${workspaceManifest.name || 'Workspace'}`;
        projectStatusBar.tooltip = 'LDF Workspace - Click to select project';
        projectStatusBar.show();
    } else {
        projectStatusBar.hide();
    }
}

/**
 * Initialize workspace detection.
 */
async function initializeWorkspaceContext(
    context: vscode.ExtensionContext,
    primaryFolder: string
): Promise<void> {
    // Check for workspace manifest
    const wsInfo = detectWorkspaceContext(primaryFolder);

    if (wsInfo) {
        workspaceRoot = wsInfo.root;
        workspaceManifest = wsInfo.manifest;

        // Store in workspace state for commands to access
        await context.workspaceState.update('ldf.workspaceRoot', wsInfo.root);
        await context.workspaceState.update('ldf.workspaceManifest', wsInfo.manifest);

        console.log(`LDF: Detected workspace "${wsInfo.manifest.name}" at ${wsInfo.root}`);

        // Resolve all projects
        const projects = await resolveProjects(wsInfo.manifest, wsInfo.root);
        console.log(`LDF: Found ${projects.length} projects in workspace`);

        // Set context for command visibility
        vscode.commands.executeCommand('setContext', 'ldf.hasWorkspace', true);
        vscode.commands.executeCommand('setContext', 'ldf.projectCount', projects.length);
    } else {
        workspaceRoot = null;
        workspaceManifest = null;
        await context.workspaceState.update('ldf.workspaceRoot', undefined);
        await context.workspaceState.update('ldf.workspaceManifest', undefined);
        vscode.commands.executeCommand('setContext', 'ldf.hasWorkspace', false);
    }

    updateProjectStatusBar();
}

/**
 * Try to find ldf executable in common locations.
 * Cross-platform: supports Windows, macOS, and Linux.
 */
function detectLdfPath(workspacePath: string): string | null {
    const config = vscode.workspace.getConfiguration('ldf');
    const configuredPath = config.get<string>('executablePath', 'ldf');

    // If user has configured a custom path, verify it exists
    if (configuredPath !== 'ldf') {
        if (fs.existsSync(configuredPath)) {
            return configuredPath;
        }
        return null; // Custom path doesn't exist
    }

    // Check if ldf is in PATH (cross-platform, non-blocking)
    const inPath = findInPath('ldf');
    if (inPath) {
        return 'ldf'; // Use simple command name if in PATH
    }

    // Check common virtualenv locations
    const candidates = getVenvCandidates(workspacePath);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

/**
 * Find all workspace folders that contain an LDF project (.ldf/config.yaml)
 */
function getLdfEnabledFolders(): string[] {
    const folders: string[] = [];
    for (const folder of vscode.workspace.workspaceFolders || []) {
        const configPath = path.join(folder.uri.fsPath, '.ldf', 'config.yaml');
        if (fs.existsSync(configPath)) {
            folders.push(folder.uri.fsPath);
        }
    }
    return folders;
}

/**
 * Prompt user before auto-configuring ldf path
 */
async function promptAutoConfig(detectedPath: string): Promise<void> {
    const action = await vscode.window.showInformationMessage(
        `LDF found at: ${detectedPath}`,
        'Use This Path',
        'Keep Default',
        "Don't Ask Again"
    );

    const config = vscode.workspace.getConfiguration('ldf');

    if (action === 'Use This Path') {
        await config.update('executablePath', detectedPath, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage('LDF path configured');
        console.log('LDF: User accepted auto-config:', detectedPath);
    } else if (action === "Don't Ask Again") {
        await config.update('skipAutoDetect', true, vscode.ConfigurationTarget.Global);
        console.log('LDF: User disabled auto-detect');
    } else {
        console.log('LDF: User declined auto-config, keeping default');
    }
}

/**
 * Show notification to help user configure ldf path
 */
async function promptLdfSetup(_workspacePath: string): Promise<void> {
    const result = await vscode.window.showWarningMessage(
        'LDF: Could not find ldf executable.',
        'Clone & Install',
        'Open Settings',
        'View Guide'
    );

    if (result === 'Clone & Install') {
        await cloneAndInstallLdf();
    } else if (result === 'Open Settings') {
        // Open settings directly to the ldf.executablePath setting
        await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:llmdotinfo.ldf-vscode executablePath'
        );
    } else if (result === 'View Guide') {
        // Open the LDF installation documentation
        vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/LLMdotInfo/ldf/blob/main/docs/installation/quick-install.md')
        );
    }
}

/**
 * Clone and install ldf from GitHub
 */
async function cloneAndInstallLdf(): Promise<void> {
    // Get user's home directory as default
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const defaultUri = vscode.Uri.file(homeDir);
    const defaultLdfPath = path.join(homeDir, 'ldf');

    // Prompt user to select installation directory
    const selectedFolder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: defaultUri,
        openLabel: 'Select Install Location',
        title: 'Choose where to clone LDF'
    });

    let installDir: string;

    if (!selectedFolder || selectedFolder.length === 0) {
        // User cancelled - offer default location
        const useDefault = await vscode.window.showInformationMessage(
            `Install LDF to default location? (${defaultLdfPath})`,
            'Install to Home',
            'Cancel'
        );

        if (useDefault !== 'Install to Home') {
            return;
        }
        installDir = homeDir;
    } else {
        installDir = selectedFolder[0].fsPath;
    }
    const ldfPath = path.join(installDir, 'ldf');
    const ldfExecutable = getVenvExecutablePath(ldfPath, 'ldf');

    // Check if ldf already exists there
    if (fs.existsSync(ldfPath)) {
        const overwrite = await vscode.window.showWarningMessage(
            `LDF already exists at ${ldfPath}. Use existing installation?`,
            'Use Existing',
            'Cancel'
        );
        if (overwrite === 'Use Existing') {
            // Try to use existing installation
            if (fs.existsSync(ldfExecutable)) {
                const config = vscode.workspace.getConfiguration('ldf');
                await config.update('executablePath', ldfExecutable, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`LDF configured: ${ldfExecutable}`);
            } else {
                vscode.window.showWarningMessage('Existing installation found but no executable. Run install manually.');
            }
        }
        return;
    }

    // Show prerequisite warning
    vscode.window.showInformationMessage(
        'LDF Setup requires git and python3 in PATH. Starting installation...'
    );

    // Create terminal - use cmd.exe on Windows for consistent behavior
    const isWindows = process.platform === 'win32';
    const terminal = vscode.window.createTerminal({
        name: 'LDF Setup',
        cwd: installDir,
        // Force cmd.exe on Windows to ensure batch file activation works
        shellPath: isWindows ? 'cmd.exe' : undefined
    });
    terminal.show();

    // Determine OS-specific activation command
    // Windows: use 'call' for batch file activation in cmd.exe
    const activateCmd = isWindows
        ? 'call .venv\\Scripts\\activate.bat'
        : 'source .venv/bin/activate';

    // Build installation script
    // Windows uses 'python', POSIX uses 'python3'
    const installScript = isWindows
        ? `git clone https://github.com/LLMdotInfo/ldf.git && cd ldf && python -m venv .venv && ${activateCmd} && pip install -e ".[mcp]" && ldf --version`
        : `git clone https://github.com/LLMdotInfo/ldf.git && cd ldf && python3 -m venv .venv && ${activateCmd} && pip install -e ".[mcp]" && echo && echo "Installation complete! Run: ldf --version" && ldf --version`;

    terminal.sendText(installScript);

    // Show info message with next steps
    const action = await vscode.window.showInformationMessage(
        'LDF installation started. After it completes, click "Configure Path" to set up the extension.',
        'Configure Path'
    );

    if (action === 'Configure Path') {
        // Auto-configure the path
        const config = vscode.workspace.getConfiguration('ldf');
        await config.update('executablePath', ldfExecutable, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`LDF path configured: ${ldfExecutable}`);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('LDF extension is now active');

    // Register setup command first - it should always be available regardless of workspace state
    context.subscriptions.push(
        vscode.commands.registerCommand('ldf.setupLdf', () => cloneAndInstallLdf())
    );

    // Create status bar for project indicator
    projectStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    projectStatusBar.command = 'ldf.switchProject';
    context.subscriptions.push(projectStatusBar);

    try {
        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            console.log('LDF: No workspace folder found');
            vscode.window.showWarningMessage('LDF: No workspace folder open');
            // Still register commands even without workspace so they don't error
            registerEmptyCommands(context);
            return;
        }

        // Find all LDF-enabled workspace folders (contain .ldf/config.yaml)
        const ldfFolders = getLdfEnabledFolders();
        console.log('LDF folders found:', ldfFolders.length);

        // Use first folder for auto-detection prompt
        const primaryFolder = ldfFolders[0] || workspaceFolder.uri.fsPath;

        // Initialize workspace context (detects ldf-workspace.yaml)
        initializeWorkspaceContext(context, primaryFolder).catch(err =>
            console.error('LDF: Workspace context initialization failed:', err)
        );

        // Auto-detect ldf and prompt user before configuring
        const detectedPath = detectLdfPath(primaryFolder);
        const config = vscode.workspace.getConfiguration('ldf');
        const skipAutoDetect = config.get<boolean>('skipAutoDetect', false);

        if (!skipAutoDetect && detectedPath && detectedPath !== 'ldf') {
            const currentPath = config.get<string>('executablePath', 'ldf');

            // Only prompt if not already configured
            if (currentPath === 'ldf') {
                // Prompt user before modifying settings (fire-and-forget with error handling)
                promptAutoConfig(detectedPath).catch(err =>
                    console.error('LDF: Auto-config prompt failed:', err)
                );
            }
        } else if (!detectedPath && !skipAutoDetect) {
            // ldf not found, prompt user (fire-and-forget with error handling)
            promptLdfSetup(primaryFolder).catch(err =>
                console.error('LDF: Setup prompt failed:', err)
            );
        }

        // Initialize tree providers with all LDF folders (or first workspace as fallback)
        const workspacePaths = ldfFolders.length > 0 ? ldfFolders : [workspaceFolder.uri.fsPath];
        specProvider = new SpecTreeProvider(workspacePaths);
        guardrailProvider = new GuardrailTreeProvider(workspacePaths);
        taskProvider = new TaskTreeProvider(workspacePaths);

        // Register tree views
        const specTreeView = vscode.window.createTreeView('ldf-specs', {
            treeDataProvider: specProvider,
            showCollapseAll: true,
        });

        const guardrailTreeView = vscode.window.createTreeView('ldf-guardrails', {
            treeDataProvider: guardrailProvider,
            showCollapseAll: true,
        });

        const taskTreeView = vscode.window.createTreeView('ldf-tasks', {
            treeDataProvider: taskProvider,
            showCollapseAll: false,
        });

        // Note: ldf.setupLdf already registered at the top of activate()

        // Register commands (use first LDF folder or first workspace as primary)
        registerCommands(context, {
            specProvider,
            guardrailProvider,
            taskProvider,
            workspacePath: primaryFolder,
        });

        // Listen for workspace folder changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders((event) => {
                for (const added of event.added) {
                    const configPath = path.join(added.uri.fsPath, '.ldf', 'config.yaml');
                    if (fs.existsSync(configPath)) {
                        console.log('LDF folder added:', added.uri.fsPath);
                        // Null checks to prevent crashes if providers weren't initialized
                        specProvider?.addWorkspaceFolder(added.uri.fsPath);
                        guardrailProvider?.addWorkspaceFolder(added.uri.fsPath);
                        taskProvider?.addWorkspaceFolder(added.uri.fsPath);
                    }
                }
                for (const removed of event.removed) {
                    console.log('Workspace folder removed:', removed.uri.fsPath);
                    // Null checks to prevent crashes if providers weren't initialized
                    specProvider?.removeWorkspaceFolder(removed.uri.fsPath);
                    guardrailProvider?.removeWorkspaceFolder(removed.uri.fsPath);
                    taskProvider?.removeWorkspaceFolder(removed.uri.fsPath);
                }
            })
        );

        // Watch for file changes across all workspace folders
        if (config.get('autoRefresh', true)) {
            const specsDir = config.get('specsDirectory', '.ldf/specs');
            const guardrailsFile = config.get('guardrailsFile', '.ldf/guardrails.yaml');

            for (const folder of vscode.workspace.workspaceFolders || []) {
                // Watch spec markdown files
                const specsWatcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(folder, `${specsDir}/**/*.md`)
                );
                specsWatcher.onDidChange(() => refreshAll());
                specsWatcher.onDidCreate(() => refreshAll());
                specsWatcher.onDidDelete(() => refreshAll());
                context.subscriptions.push(specsWatcher);

                // Watch guardrails.yaml for config changes
                const guardrailsWatcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(folder, guardrailsFile)
                );
                guardrailsWatcher.onDidChange(() => guardrailProvider.refresh());
                guardrailsWatcher.onDidCreate(() => guardrailProvider.refresh());
                guardrailsWatcher.onDidDelete(() => guardrailProvider.refresh());
                context.subscriptions.push(guardrailsWatcher);

                // Watch ldf-workspace.yaml for workspace changes
                const workspaceWatcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(folder, `**/${WORKSPACE_MANIFEST}`)
                );
                const refreshWorkspace = () => {
                    initializeWorkspaceContext(context, primaryFolder).catch(err =>
                        console.error('LDF: Workspace context refresh failed:', err)
                    );
                    refreshAll();
                };
                workspaceWatcher.onDidChange(refreshWorkspace);
                workspaceWatcher.onDidCreate(refreshWorkspace);
                workspaceWatcher.onDidDelete(refreshWorkspace);
                context.subscriptions.push(workspaceWatcher);
            }
        }

        // Add disposables
        context.subscriptions.push(specTreeView);
        context.subscriptions.push(guardrailTreeView);
        context.subscriptions.push(taskTreeView);

        // Initial refresh
        refreshAll();

        console.log('LDF extension activated successfully');
    } catch (error) {
        console.error('LDF extension activation failed:', error);
        vscode.window.showErrorMessage(`LDF: Activation failed - ${error}`);
        // Register empty commands so buttons don't error
        registerEmptyCommands(context);
    }
}

function refreshAll() {
    specProvider?.refresh();
    guardrailProvider?.refresh();
    taskProvider?.refresh();
}

function registerEmptyCommands(context: vscode.ExtensionContext) {
    // Register placeholder commands that show a message when no workspace is open
    const commands = [
        'ldf.refreshSpecs',
        'ldf.createSpec',
        'ldf.lintSpec',
        'ldf.lintAllSpecs',
        'ldf.openSpec',
        'ldf.openRequirements',
        'ldf.openDesign',
        'ldf.openTasks',
        'ldf.runAudit',
        'ldf.showGuardrailDetails',
        'ldf.markTaskComplete',
        'ldf.initProject',
        'ldf.selectPrimaryGuardrailWorkspace',
        'ldf.switchProject',
        'ldf.workspaceReport',
    ];

    for (const cmd of commands) {
        context.subscriptions.push(
            vscode.commands.registerCommand(cmd, () => {
                vscode.window.showWarningMessage('LDF: Please open a workspace folder first');
            })
        );
    }

    // Register empty tree providers with helpful messages
    const emptyProvider = new EmptyTreeProvider('Open a folder to view specs');
    const emptyGuardrailProvider = new EmptyTreeProvider('Open a folder to view guardrails');
    const emptyTaskProvider = new EmptyTreeProvider('Open a folder to view tasks');

    context.subscriptions.push(
        vscode.window.createTreeView('ldf-specs', { treeDataProvider: emptyProvider }),
        vscode.window.createTreeView('ldf-guardrails', { treeDataProvider: emptyGuardrailProvider }),
        vscode.window.createTreeView('ldf-tasks', { treeDataProvider: emptyTaskProvider })
    );

    // Note: ldf.setupLdf is registered at the top of activate() before this function
    // is called, so it's already available and works without a workspace
}

/**
 * Empty tree provider that shows a helpful message
 */
class EmptyTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    constructor(private message: string) {}

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): vscode.TreeItem[] {
        const item = new vscode.TreeItem(this.message);
        item.iconPath = new vscode.ThemeIcon('info');
        return [item];
    }
}

export function deactivate() {
    console.log('LDF extension is now deactivated');
}

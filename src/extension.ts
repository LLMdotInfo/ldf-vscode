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
import {
    findInPath,
    getVenvExecutablePath,
    getCommonLdfPaths,
    getPipxLdfPath,
    getWorkspaceVenvCandidates,
    verifyLdfExecutable,
    LdfDetectionResult,
} from './utils';
import {
    detectWorkspaceContext,
    resolveProjects,
    WorkspaceManifest,
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

// Resolved projects from ldf-workspace.yaml (includes subprojects)
export interface ResolvedProject {
    path: string;       // Full absolute path to the project
    alias: string;      // Display name for the project
    isSubproject: boolean;  // True if project is in a subfolder (not workspace root)
}
let resolvedProjects: ResolvedProject[] = [];

// Track subproject watchers for cleanup on re-initialization
// Without this, watchers accumulate when ldf-workspace.yaml changes
let subprojectWatchers: vscode.Disposable[] = [];

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
 * Get all resolved projects from ldf-workspace.yaml (includes subprojects).
 * Returns empty array if not in a multi-project workspace.
 */
export function getResolvedProjects(): ResolvedProject[] {
    return resolvedProjects;
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

        // Resolve all projects (includes subprojects from ldf-workspace.yaml)
        const projects = await resolveProjects(wsInfo.manifest, wsInfo.root);
        console.log(`LDF: Found ${projects.length} projects in workspace`);

        // Build resolved project list with full absolute paths
        resolvedProjects = projects.map(p => ({
            path: path.resolve(wsInfo.root, p.path),
            alias: p.alias,
            isSubproject: p.path !== '.'
        }));

        // Get all project paths for provider initialization
        const projectPaths = resolvedProjects.map(p => p.path);

        // Update tree providers with ALL resolved project paths (not just workspace folders)
        // This enables monorepo support where projects can be in subfolders
        if (specProvider && guardrailProvider && taskProvider) {
            specProvider.setWorkspacePaths(projectPaths);
            guardrailProvider.setWorkspacePaths(projectPaths);
            taskProvider.setWorkspacePaths(projectPaths);
            console.log(`LDF: Updated providers with ${projectPaths.length} project paths`);

            // Refresh providers to load data from new paths
            // setWorkspacePaths() only updates internal state; refresh() loads actual data
            refreshAll();
        }

        // Create watchers for subproject paths (monorepo support)
        // This MUST happen inside initializeWorkspaceContext() because resolvedProjects
        // is populated asynchronously - if we created watchers in activate(), the array
        // would be empty at that point due to async timing
        const config = vscode.workspace.getConfiguration('ldf');
        if (config.get('autoRefresh', true)) {
            const specsDir = config.get('specsDirectory', '.ldf/specs');
            const guardrailsFile = config.get('guardrailsFile', '.ldf/guardrails.yaml');

            // Dispose existing subproject watchers to prevent accumulation
            // This is critical: without cleanup, watchers accumulate on every
            // ldf-workspace.yaml change, causing duplicate refresh calls
            for (const watcher of subprojectWatchers) {
                watcher.dispose();
            }
            subprojectWatchers = [];

            for (const project of resolvedProjects) {
                if (project.isSubproject) {
                    const projectUri = vscode.Uri.file(project.path);

                    // Watch subproject spec files
                    const subSpecsWatcher = vscode.workspace.createFileSystemWatcher(
                        new vscode.RelativePattern(projectUri, `${specsDir}/**/*.md`)
                    );
                    subSpecsWatcher.onDidChange(() => refreshAll());
                    subSpecsWatcher.onDidCreate(() => refreshAll());
                    subSpecsWatcher.onDidDelete(() => refreshAll());
                    subprojectWatchers.push(subSpecsWatcher);
                    context.subscriptions.push(subSpecsWatcher);

                    // Watch subproject guardrails.yaml
                    // Use optional chaining because watchers may fire before providers
                    // are initialized (async timing during activation)
                    const subGuardrailsWatcher = vscode.workspace.createFileSystemWatcher(
                        new vscode.RelativePattern(projectUri, guardrailsFile)
                    );
                    subGuardrailsWatcher.onDidChange(() => guardrailProvider?.refresh());
                    subGuardrailsWatcher.onDidCreate(() => guardrailProvider?.refresh());
                    subGuardrailsWatcher.onDidDelete(() => guardrailProvider?.refresh());
                    subprojectWatchers.push(subGuardrailsWatcher);
                    context.subscriptions.push(subGuardrailsWatcher);

                    console.log(`LDF: Added watchers for subproject: ${project.alias}`);
                }
            }
        }

        // Set context for command visibility
        vscode.commands.executeCommand('setContext', 'ldf.hasWorkspace', true);
        vscode.commands.executeCommand('setContext', 'ldf.projectCount', projects.length);
    } else {
        // Clear active project when leaving workspace mode
        // Without this, status bar and tree views remain filtered to stale project
        activeProject = null;

        // Dispose subproject watchers when leaving workspace mode
        // Without this, stale watchers keep firing on removed subproject paths
        for (const watcher of subprojectWatchers) {
            watcher.dispose();
        }
        subprojectWatchers = [];

        // Reset provider paths to prevent stale subproject data
        // Fall back to VS Code workspace folders (standard non-monorepo mode)
        if (specProvider && guardrailProvider && taskProvider) {
            const fallbackPaths = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
            specProvider.setWorkspacePaths(fallbackPaths);
            guardrailProvider.setWorkspacePaths(fallbackPaths);
            taskProvider.setWorkspacePaths(fallbackPaths);
            refreshAll();
        }

        workspaceRoot = null;
        workspaceManifest = null;
        resolvedProjects = [];
        await context.workspaceState.update('ldf.workspaceRoot', undefined);
        await context.workspaceState.update('ldf.workspaceManifest', undefined);
        vscode.commands.executeCommand('setContext', 'ldf.hasWorkspace', false);
    }

    updateProjectStatusBar();
}

/**
 * Quick detection of LDF executable (no verification, just fs.existsSync).
 * Used on activation for fast startup.
 */
function quickDetectLdf(workspacePath: string): LdfDetectionResult {
    const config = vscode.workspace.getConfiguration('ldf');

    // 1. Check global setting first (highest priority)
    const globalPath = config.inspect<string>('executablePath')?.globalValue;
    if (globalPath && globalPath !== 'ldf') {
        if (fs.existsSync(globalPath)) {
            return { found: true, path: globalPath, source: 'global-setting', verified: false };
        }
        // Global path is stale - will be handled by validateCachedPath
    }

    // 2. Check workspace setting
    const workspaceSettingPath = config.inspect<string>('executablePath')?.workspaceValue;
    if (workspaceSettingPath && workspaceSettingPath !== 'ldf') {
        if (fs.existsSync(workspaceSettingPath)) {
            return { found: true, path: workspaceSettingPath, source: 'workspace-setting', verified: false };
        }
    }

    // 3. Check system PATH
    const inPath = findInPath('ldf');
    if (inPath) {
        return { found: true, path: 'ldf', source: 'path', verified: false };
    }

    // 4. Check current workspace venvs (expanded patterns)
    const venvCandidates = getWorkspaceVenvCandidates(workspacePath);
    for (const candidate of venvCandidates) {
        if (fs.existsSync(candidate)) {
            return { found: true, path: candidate, source: 'workspace-venv', verified: false };
        }
    }

    // 5. Check common installation locations
    const commonPaths = getCommonLdfPaths();
    for (const commonPath of commonPaths) {
        if (fs.existsSync(commonPath)) {
            return { found: true, path: commonPath, source: 'common-location', verified: false };
        }
    }

    // 6. Check pipx installation
    const pipxPath = getPipxLdfPath();
    if (pipxPath) {
        return { found: true, path: pipxPath, source: 'pipx', verified: false };
    }

    return { found: false, path: null, source: 'not-found', verified: false };
}

/**
 * Full detection with verification (runs ldf --version).
 * Used when user triggers auto-detect explicitly.
 */
async function fullDetectLdf(workspacePath: string): Promise<LdfDetectionResult> {
    const detection = quickDetectLdf(workspacePath);

    if (detection.found && detection.path) {
        const verification = await verifyLdfExecutable(detection.path);
        return {
            ...detection,
            verified: verification.valid,
            error: verification.error,
        };
    }

    return detection;
}

/**
 * Validate cached path still exists. Clears stale paths with warning.
 * Checks both workspace-level and global settings.
 */
async function validateCachedPath(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('ldf');
    const inspection = config.inspect<string>('executablePath');
    let cleared = false;

    // Check workspace-level setting first (higher priority)
    const workspacePath = inspection?.workspaceValue;
    if (workspacePath && workspacePath !== 'ldf' && !fs.existsSync(workspacePath)) {
        await config.update('executablePath', undefined, vscode.ConfigurationTarget.Workspace);
        console.log('LDF: Cleared stale workspace path:', workspacePath);
        cleared = true;
    }

    // Check global setting
    const globalPath = inspection?.globalValue;
    if (globalPath && globalPath !== 'ldf' && !fs.existsSync(globalPath)) {
        await config.update('executablePath', undefined, vscode.ConfigurationTarget.Global);
        console.log('LDF: Cleared stale global path:', globalPath);
        cleared = true;
    }

    if (cleared) {
        vscode.window.showWarningMessage(
            'Previously configured LDF path no longer exists. Running auto-detection...'
        );
        return false;
    }

    return true;
}

/**
 * Find all workspace folders that contain an LDF project (.ldf/config.yaml)
 * In multi-project workspaces, uses resolved projects from ldf-workspace.yaml
 */
export function getLdfEnabledFolders(): string[] {
    // If we have resolved projects from ldf-workspace.yaml, use those
    if (resolvedProjects.length > 0) {
        return resolvedProjects.map(p => p.path);
    }

    // Fallback: scan workspace folders for .ldf/config.yaml
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
 * Clear workspace-level executablePath setting if it exists.
 * Called when saving globally to prevent the stale workspace setting from overriding.
 */
async function clearConflictingWorkspaceSetting(): Promise<void> {
    const config = vscode.workspace.getConfiguration('ldf');
    const workspaceValue = config.inspect<string>('executablePath')?.workspaceValue;

    if (workspaceValue && workspaceValue !== 'ldf') {
        await config.update('executablePath', undefined, vscode.ConfigurationTarget.Workspace);
        console.log('LDF: Cleared workspace-level executablePath to prevent conflict with global setting');
    }
}

/**
 * Prompt user when LDF is found - two-step "Use This / Change" flow.
 */
async function promptFoundLdf(detection: LdfDetectionResult): Promise<void> {
    if (!detection.found || !detection.path) return;

    const sourceLabel = {
        'global-setting': 'configured globally',
        'workspace-setting': 'configured for workspace',
        'path': 'in PATH',
        'workspace-venv': 'in workspace venv',
        'common-location': 'in common location',
        'pipx': 'via pipx',
        'not-found': '',
    }[detection.source];

    // Step 1: "Use This" or "Change..."
    const action = await vscode.window.showInformationMessage(
        `LDF found ${sourceLabel}: ${detection.path}`,
        'Use This',
        'Change...',
        "Don't Ask Again"
    );

    const config = vscode.workspace.getConfiguration('ldf');

    if (action === 'Use This') {
        // Step 2: Save globally or to workspace?
        const saveScope = await vscode.window.showInformationMessage(
            'Save this LDF path for all workspaces or just this one?',
            'Save Globally',
            'Save to Workspace'
        );

        // User dismissed the dialog without making a choice - don't persist anything
        if (!saveScope) {
            console.log('LDF: User dismissed save scope dialog, path not saved');
            return;
        }

        // Clear conflicting workspace setting when saving globally
        if (saveScope === 'Save Globally') {
            await clearConflictingWorkspaceSetting();
        }

        const target = saveScope === 'Save Globally'
            ? vscode.ConfigurationTarget.Global
            : vscode.ConfigurationTarget.Workspace;

        await config.update('executablePath', detection.path, target);

        // Update context to refresh views
        vscode.commands.executeCommand('setContext', 'ldf.ldfNotFound', false);
        refreshAll();

        const scopeLabel = saveScope === 'Save Globally' ? 'globally' : 'for this workspace';
        vscode.window.showInformationMessage(`LDF path saved ${scopeLabel}`);
        console.log('LDF: User saved path:', detection.path, 'scope:', saveScope);
    } else if (action === 'Change...') {
        await browseLdfPath();
    } else if (action === "Don't Ask Again") {
        await config.update('skipAutoDetect', true, vscode.ConfigurationTarget.Global);
        console.log('LDF: User disabled auto-detect');
    }
}

/**
 * Show improved onboarding prompt when LDF is not found.
 */
async function promptLdfOnboarding(workspacePath: string): Promise<void> {
    const result = await vscode.window.showWarningMessage(
        'LDF CLI not found. Set up LDF to enable spec-driven development.',
        'Auto-Detect',
        'Browse...',
        'Install LDF',
        'View Guide'
    );

    if (result === 'Auto-Detect') {
        await runAutoDetectWithUI(workspacePath);
    } else if (result === 'Browse...') {
        await browseLdfPath();
    } else if (result === 'Install LDF') {
        await cloneAndInstallLdf();
    } else if (result === 'View Guide') {
        vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/LLMdotInfo/ldf/blob/main/docs/installation/quick-install.md')
        );
    }
}

/**
 * Clear the configured LDF path (both global and workspace).
 * Exported for use by commands.ts
 */
export async function clearLdfPathConfig(): Promise<void> {
    const config = vscode.workspace.getConfiguration('ldf');
    await config.update('executablePath', undefined, vscode.ConfigurationTarget.Global);
    await config.update('executablePath', undefined, vscode.ConfigurationTarget.Workspace);
    vscode.commands.executeCommand('setContext', 'ldf.ldfNotFound', true);
    vscode.window.showInformationMessage('LDF path cleared. Reload window to re-detect.');
}

/**
 * Run full auto-detection with UI feedback.
 * Exported for use by commands.ts
 */
export async function runAutoDetectWithUI(workspacePath: string): Promise<void> {
    const detection = await fullDetectLdf(workspacePath);

    if (detection.found && detection.path) {
        if (detection.verified) {
            await promptFoundLdf(detection);
        } else {
            // Found but verification failed
            await handleVerificationFailure(detection.path, detection.error || 'Unknown error');
        }
    } else {
        vscode.window.showWarningMessage(
            'Could not find LDF installation. Use "Install LDF" or "Browse..." to configure.',
            'Install LDF',
            'Browse...'
        ).then(action => {
            if (action === 'Install LDF') {
                cloneAndInstallLdf();
            } else if (action === 'Browse...') {
                browseLdfPath();
            }
        });
    }
}

/**
 * Let user browse for LDF executable with validation.
 * Exported for use by commands.ts
 */
export async function browseLdfPath(): Promise<void> {
    const isWindows = process.platform === 'win32';

    const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Select LDF Executable',
        title: 'Locate the ldf executable',
        filters: isWindows
            ? { 'Executables': ['exe', 'cmd', 'bat'], 'All Files': ['*'] }
            : undefined
    });

    if (!selected || selected.length === 0) return;

    const selectedPath = selected[0].fsPath;

    // Verify it works
    vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Verifying LDF executable...' },
        async () => {
            const verification = await verifyLdfExecutable(selectedPath);

            if (verification.valid) {
                const saveScope = await vscode.window.showInformationMessage(
                    `LDF v${verification.version} verified successfully!`,
                    'Save Globally',
                    'Save to Workspace'
                );

                // User dismissed the dialog without making a choice - don't persist anything
                if (!saveScope) {
                    console.log('LDF: User dismissed save scope dialog, path not saved');
                    return;
                }

                // Clear conflicting workspace setting when saving globally
                if (saveScope === 'Save Globally') {
                    await clearConflictingWorkspaceSetting();
                }

                const config = vscode.workspace.getConfiguration('ldf');
                const target = saveScope === 'Save Globally'
                    ? vscode.ConfigurationTarget.Global
                    : vscode.ConfigurationTarget.Workspace;

                await config.update('executablePath', selectedPath, target);

                // Update context to refresh views
                vscode.commands.executeCommand('setContext', 'ldf.ldfNotFound', false);
                refreshAll();

                vscode.window.showInformationMessage(`LDF path configured: ${selectedPath}`);
            } else {
                await handleVerificationFailure(selectedPath, verification.error || 'Unknown error');
            }
        }
    );
}

/**
 * Handle verification failure with detailed error and options.
 */
async function handleVerificationFailure(execPath: string, error: string): Promise<void> {
    const action = await vscode.window.showWarningMessage(
        `Found executable at ${execPath} but verification failed.`,
        'Show Details',
        'Browse...',
        'Open Docs'
    );

    if (action === 'Show Details') {
        vscode.window.showErrorMessage(`Verification error: ${error}`);
    } else if (action === 'Browse...') {
        await browseLdfPath();
    } else if (action === 'Open Docs') {
        vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/LLMdotInfo/ldf#troubleshooting')
        );
    }
    // Don't save the broken path
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
            // Set context for viewsWelcome (no workspace)
            vscode.commands.executeCommand('setContext', 'ldf.ldfNotFound', true);
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

        // Validate cached path (clears stale paths)
        validateCachedPath().catch(err =>
            console.error('LDF: Path validation failed:', err)
        );

        // Quick detection of LDF executable (fast, no verification)
        const detection = quickDetectLdf(primaryFolder);
        const config = vscode.workspace.getConfiguration('ldf');
        const skipAutoDetect = config.get<boolean>('skipAutoDetect', false);

        // Set context for viewsWelcome
        vscode.commands.executeCommand('setContext', 'ldf.ldfNotFound', !detection.found);

        if (detection.found) {
            console.log('LDF: Found at', detection.path, 'via', detection.source);

            // If found from common-location or pipx and not already saved globally, prompt
            if (!skipAutoDetect &&
                (detection.source === 'common-location' || detection.source === 'pipx')) {
                // Prompt user to save globally (fire-and-forget with error handling)
                promptFoundLdf(detection).catch(err =>
                    console.error('LDF: Found prompt failed:', err)
                );
            }
        } else if (!skipAutoDetect) {
            // LDF not found, show onboarding prompt (fire-and-forget with error handling)
            promptLdfOnboarding(primaryFolder).catch(err =>
                console.error('LDF: Onboarding prompt failed:', err)
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
    const workspaceRequiredCommands = [
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

    for (const cmd of workspaceRequiredCommands) {
        context.subscriptions.push(
            vscode.commands.registerCommand(cmd, () => {
                vscode.window.showWarningMessage('LDF: Please open a workspace folder first');
            })
        );
    }

    // Register commands that work without a workspace
    context.subscriptions.push(
        vscode.commands.registerCommand('ldf.browseLdfPath', () => browseLdfPath()),
        vscode.commands.registerCommand('ldf.autoDetectLdf', () => {
            vscode.window.showWarningMessage('LDF: Open a workspace folder to auto-detect LDF');
        }),
        vscode.commands.registerCommand('ldf.clearLdfPath', async () => {
            const config = vscode.workspace.getConfiguration('ldf');
            await config.update('executablePath', undefined, vscode.ConfigurationTarget.Global);
            await config.update('executablePath', undefined, vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage('LDF path configuration cleared');
        })
    );

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
 * Empty tree provider that shows a helpful message.
 * Properly implements TreeDataProvider with onDidChangeTreeData event.
 */
class EmptyTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private message: string) {}

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): vscode.TreeItem[] {
        const item = new vscode.TreeItem(this.message);
        item.iconPath = new vscode.ThemeIcon('info');
        return [item];
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

export function deactivate() {
    console.log('LDF extension is now deactivated');
}

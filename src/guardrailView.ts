/**
 * Guardrail Coverage View Provider
 *
 * Displays guardrail coverage across all specs:
 * - Shows each guardrail with coverage status
 * - Indicates which specs cover each guardrail
 * - Highlights gaps in coverage
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { getActiveProject } from './extension';

interface Guardrail {
    id: number;
    name: string;
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    enabled: boolean;
}

interface GuardrailConfig {
    preset?: string;
    overrides?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
    disabled?: Array<number | string>;
    custom?: Guardrail[];
    selected_ids?: number[];
}

type SpecStatus = 'done' | 'todo' | 'partial' | 'n/a';

interface SpecCoverage {
    specName: string;
    status: SpecStatus;
    justification?: string; // Reason for N/A status, if provided
}

interface GuardrailCoverage {
    guardrail: Guardrail;
    coveredBy: string[]; // spec names (for backward compatibility)
    specCoverage: SpecCoverage[]; // detailed per-spec status
    status: 'covered' | 'partial' | 'not-covered' | 'not-applicable';
    justifications: string[]; // Collected justifications for N/A statuses
}

type TreeItem = GuardrailTreeItem | WorkspaceFolderItem;

export class GuardrailTreeProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> =
        new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    // Per-workspace data structures for multi-root support
    private guardrailsPerWorkspace: Map<string, Guardrail[]> = new Map();
    private coveragePerWorkspace: Map<string, GuardrailCoverage[]> = new Map();
    private guardrailsFilePathPerWorkspace: Map<string, string> = new Map();
    private presetsPerWorkspace: Map<string, string | undefined> = new Map();

    // Flat views for backward compatibility and single-root mode
    private guardrails: Guardrail[] = [];
    private coverage: GuardrailCoverage[] = [];
    private workspacePaths: Array<{ path: string; name: string }> = [];
    private lastParseError: string | null = null;
    private guardrailsFilePath: string | null = null;

    constructor(workspacePath: string | string[]) {
        this.setWorkspacePaths(workspacePath);
        this.loadGuardrails();
    }

    /**
     * Update workspace paths (supports single path or array for multi-root)
     */
    setWorkspacePaths(workspacePath: string | string[]): void {
        if (Array.isArray(workspacePath)) {
            this.workspacePaths = workspacePath.map(p => ({
                path: p,
                name: path.basename(p)
            }));
        } else {
            this.workspacePaths = [{
                path: workspacePath,
                name: path.basename(workspacePath)
            }];
        }
    }

    /**
     * Add a workspace folder
     */
    addWorkspaceFolder(folderPath: string): void {
        if (!this.workspacePaths.some(w => w.path === folderPath)) {
            this.workspacePaths.push({
                path: folderPath,
                name: path.basename(folderPath)
            });
            this.refresh();
        }
    }

    /**
     * Remove a workspace folder
     */
    removeWorkspaceFolder(folderPath: string): void {
        this.workspacePaths = this.workspacePaths.filter(w => w.path !== folderPath);
        this.refresh();
    }

    refresh(): void {
        this.loadGuardrails();
        this.analyzeCoverage();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        if (!element) {
            // Root level: show workspace folders (multi-root) or guardrails directly (single-root)
            // When active project is set, skip folder grouping and show guardrails directly
            const activeProject = getActiveProject();
            const showFolderGrouping = this.workspacePaths.length > 1 && !activeProject;

            if (showFolderGrouping) {
                // Multi-root: filter out workspaces with no guardrails
                const workspacesWithGuardrails = this.workspacePaths.filter(ws =>
                    this.guardrailsPerWorkspace.has(ws.path) &&
                    (this.guardrailsPerWorkspace.get(ws.path)?.length ?? 0) > 0
                );
                return Promise.resolve(workspacesWithGuardrails.map(ws =>
                    new WorkspaceFolderItem(ws.name, ws.path)
                ));
            }

            // Single-root or active project: show guardrails for the target workspace
            const targetPath = activeProject?.path || this.workspacePaths[0]?.path;
            return Promise.resolve(this.getGuardrailItemsForWorkspace(targetPath));
        }

        if (element instanceof WorkspaceFolderItem) {
            // Workspace level: show guardrails for this workspace (use full path)
            return Promise.resolve(this.getGuardrailItemsForWorkspace(element.workspacePath));
        }

        if (element instanceof GuardrailTreeItem && element.contextValue === 'guardrail') {
            // Guardrail level: show covering specs (use full path)
            return Promise.resolve(this.getCoverageItems(element.guardrailId!, element.workspacePath));
        }

        return Promise.resolve([]);
    }

    /**
     * Get workspace folder items for multi-root display
     */
    private getWorkspaceFolderItems(): WorkspaceFolderItem[] {
        return this.workspacePaths.map(ws => new WorkspaceFolderItem(ws.name, ws.path));
    }

    // Core guardrails (always available)
    private static readonly CORE_GUARDRAILS: Guardrail[] = [
        { id: 1, name: 'Testing Coverage', description: 'Minimum test coverage thresholds', severity: 'critical', enabled: true },
        { id: 2, name: 'Security Basics', description: 'OWASP Top 10 prevention', severity: 'critical', enabled: true },
        { id: 3, name: 'Error Handling', description: 'Consistent error responses', severity: 'high', enabled: true },
        { id: 4, name: 'Logging & Observability', description: 'Structured logging, correlation IDs', severity: 'high', enabled: true },
        { id: 5, name: 'API Design', description: 'Versioning, pagination, error format', severity: 'high', enabled: true },
        { id: 6, name: 'Data Validation', description: 'Input validation at boundaries', severity: 'critical', enabled: true },
        { id: 7, name: 'Database Migrations', description: 'Reversible, separate from backfills', severity: 'high', enabled: true },
        { id: 8, name: 'Documentation', description: 'API docs, README, inline comments', severity: 'medium', enabled: true },
    ];

    // Preset-specific guardrails
    private static readonly PRESET_GUARDRAILS: Record<string, Guardrail[]> = {
        saas: [
            { id: 9, name: 'Multi-Tenancy Isolation', description: 'Tenant data isolation', severity: 'critical', enabled: true },
            { id: 10, name: 'Row-Level Security', description: 'Database-level tenant isolation', severity: 'critical', enabled: true },
            { id: 11, name: 'Subscription Billing', description: 'Billing and subscription handling', severity: 'high', enabled: true },
            { id: 12, name: 'Audit Logging', description: 'Security event tracking', severity: 'high', enabled: true },
            { id: 13, name: 'Data Export/Portability', description: 'User data export capability', severity: 'medium', enabled: true },
        ],
        fintech: [
            { id: 14, name: 'Double-Entry Ledger', description: 'Balanced financial transactions', severity: 'critical', enabled: true },
            { id: 15, name: 'Decimal Precision', description: 'Accurate monetary calculations', severity: 'critical', enabled: true },
            { id: 16, name: 'Transaction Idempotency', description: 'Safe retry handling for payments', severity: 'critical', enabled: true },
            { id: 17, name: 'Audit Trail', description: 'Immutable financial records', severity: 'critical', enabled: true },
            { id: 18, name: 'Regulatory Compliance', description: 'Financial regulation adherence', severity: 'high', enabled: true },
            { id: 19, name: 'Reconciliation', description: 'Balance verification processes', severity: 'high', enabled: true },
            { id: 20, name: 'Currency Handling', description: 'Multi-currency support', severity: 'high', enabled: true },
        ],
        healthcare: [
            { id: 21, name: 'HIPAA Compliance', description: 'PHI protection requirements', severity: 'critical', enabled: true },
            { id: 22, name: 'PHI Encryption', description: 'Protected health info encryption', severity: 'critical', enabled: true },
            { id: 23, name: 'Access Logging', description: 'PHI access audit trail', severity: 'critical', enabled: true },
            { id: 24, name: 'Consent Management', description: 'Patient consent tracking', severity: 'high', enabled: true },
            { id: 25, name: 'Data Retention', description: 'PHI retention policies', severity: 'high', enabled: true },
            { id: 26, name: 'Breach Notification', description: 'HIPAA breach procedures', severity: 'critical', enabled: true },
        ],
        'api-only': [
            { id: 27, name: 'API Versioning', description: 'Backward-compatible versions', severity: 'high', enabled: true },
            { id: 28, name: 'Rate Limiting', description: 'Request throttling per client', severity: 'high', enabled: true },
            { id: 29, name: 'API Key Management', description: 'Secure key lifecycle', severity: 'critical', enabled: true },
            { id: 30, name: 'Webhook Delivery', description: 'Reliable event notifications', severity: 'high', enabled: true },
        ],
    };

    private loadGuardrails(): void {
        const vsConfig = vscode.workspace.getConfiguration('ldf');
        const guardrailsFileName = vsConfig.get('guardrailsFile', '.ldf/guardrails.yaml');
        // Setting now stores full path (set via picker command)
        const primaryWorkspacePath = vsConfig.get<string>('primaryGuardrailWorkspace', '');

        this.guardrailsPerWorkspace.clear();
        this.guardrailsFilePathPerWorkspace.clear();
        this.presetsPerWorkspace.clear();
        this.lastParseError = null;

        // Determine which workspaces to load guardrails from
        // Priority: 1) Active project, 2) Primary guardrail workspace, 3) All workspaces
        const activeProject = getActiveProject();
        let workspacesToLoad = activeProject
            ? this.workspacePaths.filter(w => w.path === activeProject.path)
            : this.workspacePaths;

        // If primary workspace is set and no active project, use only that workspace's guardrails
        if (!activeProject && primaryWorkspacePath) {
            const primaryWs = this.workspacePaths.find(w => w.path === primaryWorkspacePath);
            if (primaryWs) {
                workspacesToLoad = [primaryWs];
            }
        }

        // Load guardrails for each workspace
        for (const workspace of workspacesToLoad) {
            const { guardrails, preset } = this.loadGuardrailsForWorkspace(workspace.path, guardrailsFileName);
            // Use full path as key to avoid basename collisions
            this.guardrailsPerWorkspace.set(workspace.path, guardrails);
            this.presetsPerWorkspace.set(workspace.path, preset);
        }

        // If using primary workspace, apply its guardrails to all workspaces
        if (primaryWorkspacePath && workspacesToLoad.length === 1) {
            const primaryWs = workspacesToLoad[0];
            const primaryGuardrails = this.guardrailsPerWorkspace.get(primaryWs.path);
            if (primaryGuardrails) {
                for (const workspace of this.workspacePaths) {
                    this.guardrailsPerWorkspace.set(workspace.path, primaryGuardrails);
                }
            }
        }

        // Build flat guardrails array (union of all unique guardrails for backward compatibility)
        const guardrailMap = new Map<number, Guardrail>();
        for (const guardrails of this.guardrailsPerWorkspace.values()) {
            for (const g of guardrails) {
                if (!guardrailMap.has(g.id)) {
                    guardrailMap.set(g.id, g);
                }
            }
        }
        this.guardrails = Array.from(guardrailMap.values()).sort((a, b) => a.id - b.id);

        // Set guardrailsFilePath for backward compatibility (first workspace)
        if (this.workspacePaths.length > 0) {
            this.guardrailsFilePath = path.join(
                this.workspacePaths[0].path,
                guardrailsFileName
            );
        }

        // Warn about conflicting guardrail configs in multi-root workspaces
        this.checkForConflictingConfigs(primaryWorkspacePath);
    }

    /**
     * Check for conflicting guardrail configs across workspaces and warn user.
     * Detects both preset conflicts and ID-level conflicts (same ID with different name/severity).
     */
    private checkForConflictingConfigs(primaryWorkspacePath: string): void {
        // Only relevant for multi-root workspaces without a primary set
        if (this.workspacePaths.length <= 1 || primaryWorkspacePath) {
            return;
        }

        // Check 1: Preset conflicts
        const uniquePresets = new Set<string>();
        for (const [, preset] of this.presetsPerWorkspace) {
            if (preset !== undefined) {
                uniquePresets.add(preset);
            }
        }

        if (uniquePresets.size > 1) {
            vscode.window
                .showWarningMessage(
                    `LDF: Multiple guardrail presets detected (${Array.from(uniquePresets).join(', ')}). Coverage may be inconsistent. Consider setting ldf.primaryGuardrailWorkspace.`,
                    'Open Settings'
                )
                .then((action) => {
                    if (action === 'Open Settings') {
                        vscode.commands.executeCommand(
                            'workbench.action.openSettings',
                            'ldf.primaryGuardrailWorkspace'
                        );
                    }
                });
            return; // Don't show multiple warnings
        }

        // Check 2: ID-level conflicts (same ID with different name or severity)
        const idConflicts: string[] = [];
        const seenGuardrails = new Map<number, { name: string; severity: string; workspaceDisplay: string }>();

        for (const [workspacePath, guardrails] of this.guardrailsPerWorkspace) {
            // Use basename for display in error messages
            const workspaceDisplay = path.basename(workspacePath);
            for (const g of guardrails) {
                const existing = seenGuardrails.get(g.id);
                if (existing) {
                    if (existing.name !== g.name || existing.severity !== g.severity) {
                        idConflicts.push(
                            `ID ${g.id}: '${existing.name}' (${existing.workspaceDisplay}) vs '${g.name}' (${workspaceDisplay})`
                        );
                    }
                } else {
                    seenGuardrails.set(g.id, { name: g.name, severity: g.severity, workspaceDisplay });
                }
            }
        }

        if (idConflicts.length > 0) {
            // Show first conflict as example, mention total count if more
            const example = idConflicts[0];
            const message = idConflicts.length === 1
                ? `LDF: Guardrail ID conflict detected (${example}). Consider setting ldf.primaryGuardrailWorkspace.`
                : `LDF: ${idConflicts.length} guardrail ID conflicts detected (e.g., ${example}). Consider setting ldf.primaryGuardrailWorkspace.`;

            vscode.window
                .showWarningMessage(message, 'Open Settings')
                .then((action) => {
                    if (action === 'Open Settings') {
                        vscode.commands.executeCommand(
                            'workbench.action.openSettings',
                            'ldf.primaryGuardrailWorkspace'
                        );
                    }
                });
        }
    }

    /**
     * Load guardrails for a single workspace
     * Returns { guardrails, preset } where preset is the configured preset or undefined
     */
    private loadGuardrailsForWorkspace(workspacePath: string, guardrailsFileName: string): { guardrails: Guardrail[], preset: string | undefined } {
        // Start with core guardrails (deep copy to avoid mutation)
        let guardrails: Guardrail[] = GuardrailTreeProvider.CORE_GUARDRAILS.map(g => ({ ...g }));
        let preset: string | undefined;

        const guardrailsFilePath = path.join(workspacePath, guardrailsFileName);
        // Use full path as key to avoid basename collisions
        this.guardrailsFilePathPerWorkspace.set(workspacePath, guardrailsFilePath);

        if (!fs.existsSync(guardrailsFilePath)) {
            return { guardrails, preset };
        }

        try {
            const content = fs.readFileSync(guardrailsFilePath, 'utf-8');
            const config = yaml.load(content) as GuardrailConfig | null;

            if (!config) {
                return { guardrails, preset };
            }

            // Validate schema before applying
            const validationErrors = this.validateGuardrailConfig(config);
            if (validationErrors.length > 0) {
                this.lastParseError = validationErrors.join('; ');
                const wsDisplay = path.basename(workspacePath);
                // Pass full path for correct file lookup, use basename for display
                this.showParseError(`Schema validation errors in ${wsDisplay}: ${this.lastParseError}`, workspacePath);
                return { guardrails, preset };
            }

            // Track the preset for conflict detection
            preset = config.preset;

            // Apply preset guardrails
            if (config.preset && config.preset !== 'custom' && GuardrailTreeProvider.PRESET_GUARDRAILS[config.preset]) {
                const presetGuardrails = GuardrailTreeProvider.PRESET_GUARDRAILS[config.preset].map(g => ({ ...g }));
                guardrails = [...guardrails, ...presetGuardrails];
            }

            // Apply overrides (keyed by string ID)
            if (config.overrides) {
                for (const guardrail of guardrails) {
                    const override = config.overrides[String(guardrail.id)];
                    if (override) {
                        if (typeof override.enabled === 'boolean') {
                            guardrail.enabled = override.enabled;
                        }
                    }
                }
            }

            // Apply disabled list (accepts IDs or names)
            if (config.disabled && Array.isArray(config.disabled)) {
                for (const guardrail of guardrails) {
                    const isDisabled = config.disabled.some(
                        (d) => d === guardrail.id || d === String(guardrail.id) || d === guardrail.name
                    );
                    if (isDisabled) {
                        guardrail.enabled = false;
                    }
                }
            }

            // Add custom guardrails
            if (config.custom && Array.isArray(config.custom)) {
                for (const custom of config.custom) {
                    if (custom.id && custom.name) {
                        guardrails.push({
                            id: custom.id,
                            name: custom.name,
                            description: custom.description || '',
                            severity: custom.severity || 'medium',
                            enabled: custom.enabled ?? true,
                        });
                    }
                }
            }

            // Apply selected_ids filter (from ldf init --custom)
            if (config.selected_ids && Array.isArray(config.selected_ids)) {
                const selectedSet = new Set(config.selected_ids);
                guardrails = guardrails.filter(g => selectedSet.has(g.id));
                // Re-order to match selected_ids order
                const guardrailsById = new Map(guardrails.map(g => [g.id, g]));
                guardrails = config.selected_ids
                    .filter(id => guardrailsById.has(id))
                    .map(id => guardrailsById.get(id)!);
            }

            return { guardrails, preset };
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            this.lastParseError = errorMessage;
            const wsDisplay = path.basename(workspacePath);
            console.error(`Failed to load guardrails for ${wsDisplay}:`, e);
            // Pass full path for correct file lookup, use basename for display
            this.showParseError(`Failed to parse guardrails.yaml in ${wsDisplay}: ${errorMessage}`, workspacePath);
            return { guardrails, preset };
        }
    }

    /**
     * Validate guardrail config schema before applying
     */
    private validateGuardrailConfig(config: GuardrailConfig): string[] {
        const errors: string[] = [];

        // Validate preset
        if (config.preset !== undefined) {
            if (typeof config.preset !== 'string') {
                errors.push('preset must be a string');
            }
        }

        // Validate overrides
        if (config.overrides !== undefined) {
            if (typeof config.overrides !== 'object' || config.overrides === null) {
                errors.push('overrides must be an object');
            } else {
                for (const [key, value] of Object.entries(config.overrides)) {
                    if (typeof value !== 'object' || value === null) {
                        errors.push(`overrides.${key} must be an object`);
                    }
                }
            }
        }

        // Validate disabled
        if (config.disabled !== undefined) {
            if (!Array.isArray(config.disabled)) {
                errors.push('disabled must be an array');
            } else {
                for (let i = 0; i < config.disabled.length; i++) {
                    const item = config.disabled[i];
                    if (typeof item !== 'number' && typeof item !== 'string') {
                        errors.push(`disabled[${i}] must be a number or string`);
                    }
                }
            }
        }

        // Validate custom guardrails
        if (config.custom !== undefined) {
            if (!Array.isArray(config.custom)) {
                errors.push('custom must be an array');
            } else {
                for (let i = 0; i < config.custom.length; i++) {
                    const custom = config.custom[i];
                    if (typeof custom !== 'object' || custom === null) {
                        errors.push(`custom[${i}] must be an object`);
                    } else {
                        if (typeof custom.id !== 'number') {
                            errors.push(`custom[${i}].id must be a number`);
                        }
                        if (typeof custom.name !== 'string') {
                            errors.push(`custom[${i}].name must be a string`);
                        }
                        if (custom.severity !== undefined) {
                            const validSeverities = ['critical', 'high', 'medium', 'low'];
                            if (!validSeverities.includes(custom.severity)) {
                                errors.push(`custom[${i}].severity must be one of: ${validSeverities.join(', ')}`);
                            }
                        }
                    }
                }
            }
        }

        // Validate selected_ids
        if (config.selected_ids !== undefined) {
            if (!Array.isArray(config.selected_ids)) {
                errors.push('selected_ids must be an array');
            } else {
                for (let i = 0; i < config.selected_ids.length; i++) {
                    if (typeof config.selected_ids[i] !== 'number') {
                        errors.push(`selected_ids[${i}] must be a number`);
                    }
                }
            }
        }

        return errors;
    }

    /**
     * Show parse error to user with quick action to open the file
     * @param message Error message to display
     * @param workspacePath Full path to workspace folder to open the correct guardrails.yaml
     */
    private showParseError(message: string, workspacePath?: string): void {
        vscode.window
            .showWarningMessage(
                `LDF: ${message}`,
                'Open guardrails.yaml'
            )
            .then((action) => {
                if (action === 'Open guardrails.yaml') {
                    // Use workspace-specific path if available, otherwise fall back to first workspace
                    const filePath = workspacePath
                        ? this.guardrailsFilePathPerWorkspace.get(workspacePath)
                        : this.guardrailsFilePath;
                    if (filePath) {
                        vscode.workspace.openTextDocument(filePath).then(
                            (doc) => {
                                vscode.window.showTextDocument(doc);
                            },
                            (err) => {
                                console.error('Failed to open guardrails.yaml:', err);
                            }
                        );
                    }
                }
            });
    }

    private analyzeCoverage(): void {
        // Initialize per-workspace coverage
        this.coveragePerWorkspace.clear();

        const config = vscode.workspace.getConfiguration('ldf');
        const specsPath = config.get('specsDirectory', '.ldf/specs');

        // Filter to active project if one is selected
        const activeProject = getActiveProject();
        const workspacesToAnalyze = activeProject
            ? this.workspacePaths.filter(w => w.path === activeProject.path)
            : this.workspacePaths;

        for (const workspace of workspacesToAnalyze) {
            // Use full path as key for lookups
            const guardrails = this.guardrailsPerWorkspace.get(workspace.path) || [];

            // Initialize coverage for this workspace's guardrails
            const workspaceCoverage: GuardrailCoverage[] = guardrails.map((g) => ({
                guardrail: g,
                coveredBy: [],
                specCoverage: [],
                status: 'not-covered' as const,
                justifications: [],
            }));

            // Scan specs for this workspace
            const specsDir = path.join(workspace.path, specsPath);
            if (fs.existsSync(specsDir)) {
                const specs = fs.readdirSync(specsDir, { withFileTypes: true })
                    .filter((d) => d.isDirectory())
                    .map((d) => d.name);

                for (const specName of specs) {
                    const reqPath = path.join(specsDir, specName, 'requirements.md');
                    if (fs.existsSync(reqPath)) {
                        const content = fs.readFileSync(reqPath, 'utf-8');
                        this.parseGuardrailCoverageForWorkspace(specName, content, workspaceCoverage);
                    }
                }
            }

            // Update status for each guardrail in this workspace
            for (const cov of workspaceCoverage) {
                cov.status = this.calculateOverallStatus(cov.specCoverage);
            }

            // Use full path as key to avoid basename collisions
            this.coveragePerWorkspace.set(workspace.path, workspaceCoverage);
        }

        // Also maintain flat coverage for backward compatibility (getCoverage() method)
        this.coverage = this.guardrails.map((g) => ({
            guardrail: g,
            coveredBy: [],
            specCoverage: [],
            status: 'not-covered' as const,
            justifications: [],
        }));

        // Aggregate coverage from all workspaces into flat view
        for (const [workspacePath, workspaceCoverage] of this.coveragePerWorkspace) {
            const isMultiRoot = this.workspacePaths.length > 1;
            // Use basename for display purposes
            const workspaceDisplay = path.basename(workspacePath);
            for (const wsCov of workspaceCoverage) {
                const flatCov = this.coverage.find(c => c.guardrail.id === wsCov.guardrail.id);
                if (flatCov) {
                    for (const sc of wsCov.specCoverage) {
                        const displayName = isMultiRoot ? `${workspaceDisplay}/${sc.specName}` : sc.specName;
                        flatCov.specCoverage.push({ specName: displayName, status: sc.status });
                        if (sc.status === 'done') {
                            flatCov.coveredBy.push(displayName);
                        }
                    }
                }
            }
        }

        // Update flat coverage status
        for (const cov of this.coverage) {
            cov.status = this.calculateOverallStatus(cov.specCoverage);
        }
    }

    /**
     * Calculate overall guardrail status from individual spec statuses
     */
    private calculateOverallStatus(specCoverage: SpecCoverage[]): GuardrailCoverage['status'] {
        if (specCoverage.length === 0) {
            return 'not-covered';
        }

        const statuses = specCoverage.map(sc => sc.status);
        const hasDone = statuses.includes('done');
        const hasTodo = statuses.includes('todo');
        const hasPartial = statuses.includes('partial');
        const allNA = statuses.every(s => s === 'n/a');

        // All specs marked N/A = not applicable
        if (allNA) {
            return 'not-applicable';
        }

        // Any explicit partial status, or mix of done and todo = partial
        if (hasPartial || (hasDone && hasTodo)) {
            return 'partial';
        }

        // All done (excluding N/A) = covered
        if (hasDone && !hasTodo && !hasPartial) {
            return 'covered';
        }

        // Only todo statuses = not covered
        return 'not-covered';
    }

    /**
     * Parse guardrail coverage from a spec's requirements.md for a specific workspace
     */
    private parseGuardrailCoverageForWorkspace(specName: string, content: string, workspaceCoverage: GuardrailCoverage[]): void {
        // Look for guardrail coverage matrix in requirements
        // Format: | 1. Testing Coverage | [US-1] | [S3.2] | [T-1] | Alice | DONE |
        // Accept status values: DONE, TODO, PARTIAL, N/A, N/A - <justification>
        const matrixPattern = /\|\s*(\d+)\.\s*([^|]+)\s*\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|\s*([^|]+?)\s*\|/gi;
        let match;

        while ((match = matrixPattern.exec(content)) !== null) {
            const guardrailId = parseInt(match[1]);
            const rawStatusText = match[3].trim();
            const statusText = rawStatusText.toUpperCase();

            // Parse status from the matrix
            let status: SpecStatus;
            let justification: string | undefined;

            if (statusText === 'DONE') {
                status = 'done';
            } else if (statusText.startsWith('N/A') || statusText === 'NA' || statusText === 'NOT APPLICABLE') {
                status = 'n/a';
                // Extract justification if present: "N/A - reason" -> "reason"
                if (rawStatusText.includes('-')) {
                    justification = rawStatusText.split('-').slice(1).join('-').trim();
                }
            } else if (statusText === 'PARTIAL' || statusText === 'IN PROGRESS') {
                status = 'partial';
            } else {
                // TODO, empty, or any other status
                status = 'todo';
            }

            const coverage = workspaceCoverage.find((c) => c.guardrail.id === guardrailId);
            if (coverage) {
                // Check if spec already tracked (avoid duplicates)
                const existingSpec = coverage.specCoverage.find(sc => sc.specName === specName);
                if (!existingSpec) {
                    coverage.specCoverage.push({ specName, status, justification });
                    // Maintain coveredBy for display (only DONE specs)
                    if (status === 'done' && !coverage.coveredBy.includes(specName)) {
                        coverage.coveredBy.push(specName);
                    }
                    // Collect justifications for N/A statuses
                    if (status === 'n/a' && justification) {
                        coverage.justifications.push(justification);
                    }
                }
            }
        }
    }

    /**
     * Get guardrail items for a specific workspace, grouped by severity
     * @param workspacePath Full path to the workspace folder
     */
    private getGuardrailItemsForWorkspace(workspacePath?: string): GuardrailTreeItem[] {
        if (!workspacePath) return [];

        const workspaceCoverage = this.coveragePerWorkspace.get(workspacePath) || [];

        // Group by severity
        const items: GuardrailTreeItem[] = [];
        for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
            const filtered = workspaceCoverage
                .filter((c) => c.guardrail.severity === severity && c.guardrail.enabled)
                .map((c) => new GuardrailTreeItem(c, workspacePath));
            items.push(...filtered);
        }

        return items;
    }

    /**
     * Get coverage items (specs) for a guardrail, optionally filtered by workspace
     * Shows ALL specs that reference the guardrail, with their status (not just DONE)
     * @param workspacePath Full path to the workspace folder
     */
    private getCoverageItems(guardrailId: number, workspacePath?: string): GuardrailTreeItem[] {
        // If workspace specified, use per-workspace coverage
        if (workspacePath) {
            const workspaceCoverage = this.coveragePerWorkspace.get(workspacePath) || [];
            const coverage = workspaceCoverage.find((c) => c.guardrail.id === guardrailId);
            // Use specCoverage (all statuses) instead of coveredBy (DONE only)
            if (!coverage || coverage.specCoverage.length === 0) {
                return [
                    new GuardrailTreeItem(
                        undefined,
                        undefined,
                        'No specs cover this guardrail'
                    ),
                ];
            }
            // Show all specs with their status indicator
            return coverage.specCoverage.map(
                (sc) =>
                    new GuardrailTreeItem(
                        undefined,
                        undefined,
                        `${sc.specName} (${sc.status})`,
                        'spec-reference'
                    )
            );
        }

        // Fall back to flat coverage (backward compatibility)
        const coverage = this.coverage.find((c) => c.guardrail.id === guardrailId);
        // Use specCoverage (all statuses) instead of coveredBy (DONE only)
        if (!coverage || coverage.specCoverage.length === 0) {
            return [
                new GuardrailTreeItem(
                    undefined,
                    undefined,
                    'No specs cover this guardrail'
                ),
            ];
        }

        // Show all specs with their status indicator
        return coverage.specCoverage.map(
            (sc) =>
                new GuardrailTreeItem(
                    undefined,
                    undefined,
                    `${sc.specName} (${sc.status})`,
                    'spec-reference'
                )
        );
    }

    getCoverage(): GuardrailCoverage[] {
        return this.coverage;
    }
}

/**
 * Tree item for workspace folder in multi-root mode
 */
export class WorkspaceFolderItem extends vscode.TreeItem {
    constructor(
        public readonly workspaceName: string,
        public readonly workspacePath: string
    ) {
        super(workspaceName, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'workspace-folder';
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

export class GuardrailTreeItem extends vscode.TreeItem {
    public readonly guardrailId?: number;
    /** Full path to workspace folder for lookups (avoids basename collisions) */
    public readonly workspacePath?: string;

    constructor(
        coverage?: GuardrailCoverage,
        /** Full path to workspace folder */
        workspacePath?: string,
        label?: string,
        contextValue?: string
    ) {
        if (coverage) {
            super(
                `${coverage.guardrail.id}. ${coverage.guardrail.name}`,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            this.guardrailId = coverage.guardrail.id;
            this.workspacePath = workspacePath;
            this.contextValue = 'guardrail';

            // Build tooltip with description and N/A justification if applicable
            let tooltipText = coverage.guardrail.description;
            if (coverage.status === 'not-applicable' && coverage.justifications.length > 0) {
                // Show unique justifications
                const uniqueJustifications = [...new Set(coverage.justifications)];
                tooltipText += `\n\nNot Applicable: ${uniqueJustifications.join('; ')}`;
            }
            this.tooltip = tooltipText;

            // Use specCoverage.length to show all specs (not just DONE)
            this.description = `${coverage.specCoverage.length} specs`;
            this.iconPath = GuardrailTreeItem.getStatusIcon(coverage);
            // Pass guardrail ID explicitly in command arguments for reliable invocation
            this.command = {
                command: 'ldf.showGuardrailDetails',
                title: 'Show Guardrail Details',
                arguments: [coverage.guardrail.id]
            };
        } else {
            super(label || '', vscode.TreeItemCollapsibleState.None);
            this.contextValue = contextValue || 'info';
            if (contextValue === 'spec-reference') {
                this.iconPath = new vscode.ThemeIcon('file');
            }
        }
    }

    private static getStatusIcon(coverage: GuardrailCoverage): vscode.ThemeIcon {
        switch (coverage.status) {
            case 'covered':
                return new vscode.ThemeIcon(
                    'check',
                    new vscode.ThemeColor('charts.green')
                );
            case 'partial':
                return new vscode.ThemeIcon(
                    'warning',
                    new vscode.ThemeColor('charts.yellow')
                );
            case 'not-covered':
                return new vscode.ThemeIcon(
                    'circle-slash',
                    new vscode.ThemeColor('charts.red')
                );
            case 'not-applicable':
                return new vscode.ThemeIcon('circle-large-outline', new vscode.ThemeColor('disabledForeground'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}

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
}

interface GuardrailCoverage {
    guardrail: Guardrail;
    coveredBy: string[]; // spec names (for backward compatibility)
    specCoverage: SpecCoverage[]; // detailed per-spec status
    status: 'covered' | 'partial' | 'not-covered' | 'not-applicable';
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
            if (this.workspacePaths.length > 1) {
                return Promise.resolve(this.getWorkspaceFolderItems());
            }
            // Single-root: show guardrails for the only workspace
            const workspaceName = this.workspacePaths[0]?.name;
            return Promise.resolve(this.getGuardrailItemsForWorkspace(workspaceName));
        }

        if (element instanceof WorkspaceFolderItem) {
            // Workspace level: show guardrails for this workspace
            return Promise.resolve(this.getGuardrailItemsForWorkspace(element.workspaceName));
        }

        if (element instanceof GuardrailTreeItem && element.contextValue === 'guardrail') {
            // Guardrail level: show covering specs
            return Promise.resolve(this.getCoverageItems(element.guardrailId!, element.workspaceName));
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
        const primaryWorkspaceName = vsConfig.get<string>('primaryGuardrailWorkspace', '');

        this.guardrailsPerWorkspace.clear();
        this.guardrailsFilePathPerWorkspace.clear();
        this.presetsPerWorkspace.clear();
        this.lastParseError = null;

        // Determine which workspaces to load guardrails from
        let workspacesToLoad = this.workspacePaths;

        // If primary workspace is set, use only that workspace's guardrails
        if (primaryWorkspaceName) {
            const primaryWs = this.workspacePaths.find(w => w.name === primaryWorkspaceName);
            if (primaryWs) {
                workspacesToLoad = [primaryWs];
            }
        }

        // Load guardrails for each workspace
        for (const workspace of workspacesToLoad) {
            const { guardrails, preset } = this.loadGuardrailsForWorkspace(workspace.path, guardrailsFileName);
            this.guardrailsPerWorkspace.set(workspace.name, guardrails);
            this.presetsPerWorkspace.set(workspace.name, preset);
        }

        // If using primary workspace, apply its guardrails to all workspaces
        if (primaryWorkspaceName && workspacesToLoad.length === 1) {
            const primaryGuardrails = this.guardrailsPerWorkspace.get(primaryWorkspaceName);
            if (primaryGuardrails) {
                for (const workspace of this.workspacePaths) {
                    this.guardrailsPerWorkspace.set(workspace.name, primaryGuardrails);
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
        this.checkForConflictingConfigs(primaryWorkspaceName);
    }

    /**
     * Check for conflicting guardrail configs across workspaces and warn user.
     * Detects both preset conflicts and ID-level conflicts (same ID with different name/severity).
     */
    private checkForConflictingConfigs(primaryWorkspaceName: string): void {
        // Only relevant for multi-root workspaces without a primary set
        if (this.workspacePaths.length <= 1 || primaryWorkspaceName) {
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
        const seenGuardrails = new Map<number, { name: string; severity: string; workspace: string }>();

        for (const [workspaceName, guardrails] of this.guardrailsPerWorkspace) {
            for (const g of guardrails) {
                const existing = seenGuardrails.get(g.id);
                if (existing) {
                    if (existing.name !== g.name || existing.severity !== g.severity) {
                        idConflicts.push(
                            `ID ${g.id}: '${existing.name}' (${existing.workspace}) vs '${g.name}' (${workspaceName})`
                        );
                    }
                } else {
                    seenGuardrails.set(g.id, { name: g.name, severity: g.severity, workspace: workspaceName });
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
        this.guardrailsFilePathPerWorkspace.set(path.basename(workspacePath), guardrailsFilePath);

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
                this.showParseError(`Schema validation errors in ${path.basename(workspacePath)}: ${this.lastParseError}`);
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
            console.error(`Failed to load guardrails for ${path.basename(workspacePath)}:`, e);
            this.showParseError(`Failed to parse guardrails.yaml in ${path.basename(workspacePath)}: ${errorMessage}`);
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
     */
    private showParseError(message: string): void {
        vscode.window
            .showWarningMessage(
                `LDF: ${message}`,
                'Open guardrails.yaml'
            )
            .then((action) => {
                if (action === 'Open guardrails.yaml' && this.guardrailsFilePath) {
                    vscode.workspace.openTextDocument(this.guardrailsFilePath).then((doc) => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });
    }

    private analyzeCoverage(): void {
        // Initialize per-workspace coverage
        this.coveragePerWorkspace.clear();

        const config = vscode.workspace.getConfiguration('ldf');
        const specsPath = config.get('specsDirectory', '.ldf/specs');

        for (const workspace of this.workspacePaths) {
            const guardrails = this.guardrailsPerWorkspace.get(workspace.name) || [];

            // Initialize coverage for this workspace's guardrails
            const workspaceCoverage: GuardrailCoverage[] = guardrails.map((g) => ({
                guardrail: g,
                coveredBy: [],
                specCoverage: [],
                status: 'not-covered' as const,
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

            this.coveragePerWorkspace.set(workspace.name, workspaceCoverage);
        }

        // Also maintain flat coverage for backward compatibility (getCoverage() method)
        this.coverage = this.guardrails.map((g) => ({
            guardrail: g,
            coveredBy: [],
            specCoverage: [],
            status: 'not-covered' as const,
        }));

        // Aggregate coverage from all workspaces into flat view
        for (const [workspaceName, workspaceCoverage] of this.coveragePerWorkspace) {
            const isMultiRoot = this.workspacePaths.length > 1;
            for (const wsCov of workspaceCoverage) {
                const flatCov = this.coverage.find(c => c.guardrail.id === wsCov.guardrail.id);
                if (flatCov) {
                    for (const sc of wsCov.specCoverage) {
                        const displayName = isMultiRoot ? `${workspaceName}/${sc.specName}` : sc.specName;
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
        // Accept status values: DONE, TODO, PARTIAL, N/A
        const matrixPattern = /\|\s*(\d+)\.\s*([^|]+)\s*\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|\s*([^|]+?)\s*\|/gi;
        let match;

        while ((match = matrixPattern.exec(content)) !== null) {
            const guardrailId = parseInt(match[1]);
            const statusText = match[3].trim().toUpperCase();

            // Parse status from the matrix
            let status: SpecStatus;
            if (statusText === 'DONE') {
                status = 'done';
            } else if (statusText === 'N/A' || statusText === 'NA' || statusText === 'NOT APPLICABLE') {
                status = 'n/a';
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
                    coverage.specCoverage.push({ specName, status });
                    // Maintain coveredBy for display (only DONE specs)
                    if (status === 'done' && !coverage.coveredBy.includes(specName)) {
                        coverage.coveredBy.push(specName);
                    }
                }
            }
        }
    }

    /**
     * Get guardrail items for a specific workspace, grouped by severity
     */
    private getGuardrailItemsForWorkspace(workspaceName?: string): GuardrailTreeItem[] {
        if (!workspaceName) return [];

        const workspaceCoverage = this.coveragePerWorkspace.get(workspaceName) || [];

        // Group by severity
        const items: GuardrailTreeItem[] = [];
        for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
            const filtered = workspaceCoverage
                .filter((c) => c.guardrail.severity === severity && c.guardrail.enabled)
                .map((c) => new GuardrailTreeItem(c, workspaceName));
            items.push(...filtered);
        }

        return items;
    }

    /**
     * Get coverage items (specs) for a guardrail, optionally filtered by workspace
     * Shows ALL specs that reference the guardrail, with their status (not just DONE)
     */
    private getCoverageItems(guardrailId: number, workspaceName?: string): GuardrailTreeItem[] {
        // If workspace specified, use per-workspace coverage
        if (workspaceName) {
            const workspaceCoverage = this.coveragePerWorkspace.get(workspaceName) || [];
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
    public readonly workspaceName?: string;

    constructor(
        coverage?: GuardrailCoverage,
        workspaceName?: string,
        label?: string,
        contextValue?: string
    ) {
        if (coverage) {
            super(
                `${coverage.guardrail.id}. ${coverage.guardrail.name}`,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            this.guardrailId = coverage.guardrail.id;
            this.workspaceName = workspaceName;
            this.contextValue = 'guardrail';
            this.tooltip = coverage.guardrail.description;
            this.description = `${coverage.coveredBy.length} specs`;
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
                return new vscode.ThemeIcon('dash');
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}

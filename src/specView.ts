/**
 * Spec Tree View Provider
 *
 * Displays specs in a tree view with status indicators:
 * - Draft: requirements incomplete
 * - In Review: awaiting approval
 * - Approved: ready for implementation
 * - In Progress: implementation started
 * - Complete: all tasks done
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface SpecInfo {
    name: string;
    path: string;
    status: SpecStatus;
    hasRequirements: boolean;
    hasDesign: boolean;
    hasTasks: boolean;
    taskProgress?: { completed: number; total: number };
    folderName?: string;  // For multi-root workspace display
    folderPath?: string;  // Workspace folder this spec belongs to
}

export enum SpecStatus {
    Draft = 'draft',
    InReview = 'in-review',
    Approved = 'approved',
    InProgress = 'in-progress',
    Complete = 'complete',
    Error = 'error',
}

export class SpecTreeProvider implements vscode.TreeDataProvider<SpecTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SpecTreeItem | undefined | null | void> =
        new vscode.EventEmitter<SpecTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SpecTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private workspacePaths: Array<{ path: string; name: string }> = [];
    private specs: SpecInfo[] = [];

    constructor(workspacePath: string | string[]) {
        this.setWorkspacePaths(workspacePath);
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
        this.loadSpecs();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SpecTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SpecTreeItem): Thenable<SpecTreeItem[]> {
        if (!element) {
            // Root level - show specs
            return Promise.resolve(this.getSpecItems());
        } else if (element.contextValue === 'spec') {
            // Spec level - show files
            return Promise.resolve(this.getSpecFileItems(element.specInfo!));
        }
        return Promise.resolve([]);
    }

    private loadSpecs(): void {
        this.specs = [];
        const config = vscode.workspace.getConfiguration('ldf');
        const specsPath = config.get('specsDirectory', '.ldf/specs');
        const isMultiRoot = this.workspacePaths.length > 1;

        for (const workspace of this.workspacePaths) {
            const specsDir = path.join(workspace.path, specsPath);

            if (!fs.existsSync(specsDir)) {
                continue;
            }

            const entries = fs.readdirSync(specsDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const specPath = path.join(specsDir, entry.name);
                    const specInfo = this.parseSpec(entry.name, specPath);
                    // Add folder context for multi-root workspaces
                    if (isMultiRoot) {
                        specInfo.folderName = workspace.name;
                    }
                    specInfo.folderPath = workspace.path;
                    this.specs.push(specInfo);
                }
            }
        }

        // Sort by status priority, then folder (if multi-root), then name
        this.specs.sort((a, b) => {
            const statusOrder = {
                [SpecStatus.InProgress]: 0,
                [SpecStatus.InReview]: 1,
                [SpecStatus.Approved]: 2,
                [SpecStatus.Draft]: 3,
                [SpecStatus.Complete]: 4,
                [SpecStatus.Error]: 5,
            };
            const orderA = statusOrder[a.status] ?? 99;
            const orderB = statusOrder[b.status] ?? 99;
            if (orderA !== orderB) return orderA - orderB;
            // Group by folder in multi-root
            if (a.folderName && b.folderName && a.folderName !== b.folderName) {
                return a.folderName.localeCompare(b.folderName);
            }
            return a.name.localeCompare(b.name);
        });
    }

    private parseSpec(name: string, specPath: string): SpecInfo {
        const reqPath = path.join(specPath, 'requirements.md');
        const designPath = path.join(specPath, 'design.md');
        const tasksPath = path.join(specPath, 'tasks.md');

        const hasRequirements = fs.existsSync(reqPath);
        const hasDesign = fs.existsSync(designPath);
        const hasTasks = fs.existsSync(tasksPath);

        let status = SpecStatus.Draft;
        let taskProgress: { completed: number; total: number } | undefined;

        // Determine status based on files and content
        if (hasTasks) {
            const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
            taskProgress = this.parseTaskProgress(tasksContent);

            if (taskProgress.total > 0) {
                if (taskProgress.completed === taskProgress.total) {
                    status = SpecStatus.Complete;
                } else if (taskProgress.completed > 0) {
                    status = SpecStatus.InProgress;
                } else {
                    status = SpecStatus.Approved;
                }
            }
        } else if (hasDesign) {
            status = SpecStatus.InReview;
        } else if (hasRequirements) {
            status = SpecStatus.Draft;
        }

        return {
            name,
            path: specPath,
            status,
            hasRequirements,
            hasDesign,
            hasTasks,
            taskProgress,
        };
    }

    private parseTaskProgress(content: string): { completed: number; total: number } {
        // Count only actual task checkboxes (with task IDs), not completion checklists
        // Matches: - [ ] **Task 1.1:** Description or - [x] **Task 1.2:** Description
        const taskPattern = /- \[([xX ])\]\s+\*\*Task\s+\d+(?:\.\d+)?(?:\.\d+)?:\*\*/g;
        const matches = content.matchAll(taskPattern);

        let completed = 0;
        let total = 0;

        for (const match of matches) {
            total++;
            if (match[1].toLowerCase() === 'x') {
                completed++;
            }
        }

        return { completed, total };
    }

    private getSpecItems(): SpecTreeItem[] {
        return this.specs.map(
            (spec) =>
                new SpecTreeItem(
                    spec.name,
                    spec,
                    vscode.TreeItemCollapsibleState.Collapsed
                )
        );
    }

    private getSpecFileItems(spec: SpecInfo): SpecTreeItem[] {
        const items: SpecTreeItem[] = [];

        if (spec.hasRequirements) {
            items.push(
                new SpecTreeItem(
                    'Requirements',
                    spec,
                    vscode.TreeItemCollapsibleState.None,
                    'requirements'
                )
            );
        }

        if (spec.hasDesign) {
            items.push(
                new SpecTreeItem(
                    'Design',
                    spec,
                    vscode.TreeItemCollapsibleState.None,
                    'design'
                )
            );
        }

        if (spec.hasTasks) {
            const label = spec.taskProgress
                ? `Tasks (${spec.taskProgress.completed}/${spec.taskProgress.total})`
                : 'Tasks';
            items.push(
                new SpecTreeItem(
                    label,
                    spec,
                    vscode.TreeItemCollapsibleState.None,
                    'tasks'
                )
            );
        }

        return items;
    }

    getSpecs(): SpecInfo[] {
        return this.specs;
    }

    getSpec(name: string): SpecInfo | undefined {
        return this.specs.find((s) => s.name === name);
    }
}

export class SpecTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly specInfo: SpecInfo | undefined,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly fileType?: 'requirements' | 'design' | 'tasks'
    ) {
        super(label, collapsibleState);

        if (specInfo && !fileType) {
            // This is a spec node
            this.contextValue = 'spec';
            this.tooltip = this.getSpecTooltip(specInfo);
            this.iconPath = this.getStatusIcon(specInfo.status);
            // Show folder prefix in multi-root workspaces
            const statusDesc = this.getStatusDescription(specInfo);
            if (specInfo.folderName) {
                this.description = `${specInfo.folderName} • ${statusDesc}`;
            } else {
                this.description = statusDesc;
            }
        } else if (specInfo && fileType) {
            // This is a file node
            this.contextValue = 'spec-file';
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [
                    vscode.Uri.file(
                        path.join(specInfo.path, `${fileType}.md`)
                    ),
                ],
            };
            this.iconPath = new vscode.ThemeIcon('file');
        }
    }

    private getSpecTooltip(spec: SpecInfo): string {
        const parts = [`Status: ${spec.status}`];
        if (spec.taskProgress) {
            parts.push(
                `Tasks: ${spec.taskProgress.completed}/${spec.taskProgress.total} complete`
            );
        }
        return parts.join('\n');
    }

    private getStatusIcon(status: SpecStatus): vscode.ThemeIcon {
        switch (status) {
            case SpecStatus.Complete:
                return new vscode.ThemeIcon(
                    'check-all',
                    new vscode.ThemeColor('charts.green')
                );
            case SpecStatus.InProgress:
                return new vscode.ThemeIcon(
                    'sync~spin',
                    new vscode.ThemeColor('charts.blue')
                );
            case SpecStatus.Approved:
                return new vscode.ThemeIcon(
                    'pass',
                    new vscode.ThemeColor('charts.green')
                );
            case SpecStatus.InReview:
                return new vscode.ThemeIcon(
                    'eye',
                    new vscode.ThemeColor('charts.yellow')
                );
            case SpecStatus.Draft:
                return new vscode.ThemeIcon(
                    'edit',
                    new vscode.ThemeColor('charts.orange')
                );
            case SpecStatus.Error:
                return new vscode.ThemeIcon(
                    'error',
                    new vscode.ThemeColor('charts.red')
                );
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private getStatusDescription(spec: SpecInfo): string {
        if (spec.taskProgress && spec.taskProgress.total > 0) {
            const pct = Math.round(
                (spec.taskProgress.completed / spec.taskProgress.total) * 100
            );
            return `${pct}%`;
        }
        return spec.status;
    }
}

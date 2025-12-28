/**
 * Task Tree View Provider
 *
 * Displays current tasks from active specs:
 * - Shows "next up" task at top (first incomplete per spec)
 * - Groups by spec
 * - Allows marking tasks complete
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseTasksContent, markTaskInContent } from './utils';
import { detectWorkspaceContext, resolveProjects, getProjectDisplayName } from './workspace';
import { getActiveProject } from './extension';

export interface TaskInfo {
    id: string;
    specName: string;
    title: string;
    status: 'pending' | 'next' | 'complete';
    line: number; // Line number in tasks.md for editing
    folderName?: string;  // For multi-root workspace display
    folderPath?: string;  // Workspace folder this task belongs to
}

/** Tree item types for hierarchical display */
type TaskTreeItemType = TaskTreeItem | WorkspaceFolderItem | TaskSectionItem;

/**
 * Tree item for task section headers (Current Tasks / Completed Tasks)
 */
export class TaskSectionItem extends vscode.TreeItem {
    constructor(
        public readonly sectionType: 'current' | 'completed',
        public readonly count: number,
        public readonly workspacePath?: string // For multi-root mode
    ) {
        super(
            sectionType === 'current'
                ? `Current Tasks (${count})`
                : `Completed Tasks (${count})`,
            sectionType === 'completed'
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.Expanded
        );
        this.contextValue = 'task-section';
        this.iconPath = sectionType === 'completed'
            ? new vscode.ThemeIcon('check-all', new vscode.ThemeColor('charts.green'))
            : new vscode.ThemeIcon('tasklist');
    }
}

/**
 * Tree item for workspace/project folder in multi-root mode
 */
export class WorkspaceFolderItem extends vscode.TreeItem {
    constructor(
        public readonly workspaceName: string,
        public readonly workspacePath: string,
        public readonly projectAlias?: string
    ) {
        super(projectAlias || workspaceName, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'workspace-folder';
        this.iconPath = new vscode.ThemeIcon('folder');
        this.tooltip = workspacePath;
        if (projectAlias && projectAlias !== workspaceName) {
            this.description = workspaceName;
        }
    }
}

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskTreeItemType> {
    private _onDidChangeTreeData: vscode.EventEmitter<TaskTreeItemType | undefined | null | void> =
        new vscode.EventEmitter<TaskTreeItemType | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TaskTreeItemType | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private tasks: TaskInfo[] = [];
    private workspacePaths: Array<{ path: string; name: string; projectAlias?: string }> = [];

    constructor(workspacePath: string | string[]) {
        this.setWorkspacePaths(workspacePath);
    }

    /**
     * Update workspace paths (supports single path or array for multi-root)
     * Also detects project aliases from ldf-workspace.yaml when available
     */
    setWorkspacePaths(workspacePath: string | string[]): void {
        const paths = Array.isArray(workspacePath) ? workspacePath : [workspacePath];
        this.workspacePaths = paths.map(p => {
            const entry: { path: string; name: string; projectAlias?: string } = {
                path: p,
                name: path.basename(p)
            };
            // Try to get project alias from workspace manifest
            const wsContext = detectWorkspaceContext(p);
            if (wsContext) {
                // Find matching project in manifest
                resolveProjects(wsContext.manifest, wsContext.root).then(projects => {
                    for (const project of projects) {
                        const projectPath = path.resolve(wsContext.root, project.path);
                        if (projectPath === p || p.startsWith(projectPath + path.sep)) {
                            entry.projectAlias = getProjectDisplayName(project);
                            this._onDidChangeTreeData.fire(); // Refresh to show alias
                            break;
                        }
                    }
                });
            }
            return entry;
        });
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
        this.loadTasks();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TaskTreeItemType): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TaskTreeItemType): Thenable<TaskTreeItemType[]> {
        const config = vscode.workspace.getConfiguration('ldf');
        const showInline = config.get('showCompletedTasksInline', false);

        if (!element) {
            // Root level
            // When active project is set, skip folder grouping and show tasks directly
            const activeProject = getActiveProject();
            const showFolderGrouping = this.workspacePaths.length > 1 && !activeProject;

            if (showFolderGrouping) {
                // Multi-root: filter out workspaces with no tasks
                const workspacesWithTasks = this.workspacePaths.filter(ws =>
                    this.tasks.some(task => task.folderPath === ws.path)
                );
                return Promise.resolve(workspacesWithTasks.map(ws =>
                    new WorkspaceFolderItem(ws.name, ws.path, ws.projectAlias)
                ));
            }

            // Single-root or active project: show section headers or all tasks inline
            if (showInline) {
                return Promise.resolve(this.getTaskItems(true)); // Include completed
            }
            return Promise.resolve(this.getSectionItems());
        }

        if (element instanceof TaskSectionItem) {
            // Section level: show tasks filtered by section type
            const showCompleted = element.sectionType === 'completed';
            if (element.workspacePath) {
                return Promise.resolve(this.getTaskItemsForWorkspace(element.workspacePath, showCompleted));
            }
            return Promise.resolve(this.getTaskItems(false, showCompleted));
        }

        if (element instanceof WorkspaceFolderItem) {
            // Workspace level: show section headers or tasks inline
            if (showInline) {
                return Promise.resolve(this.getTaskItemsForWorkspace(element.workspacePath, true));
            }
            return Promise.resolve(this.getSectionItemsForWorkspace(element.workspacePath));
        }

        return Promise.resolve([]);
    }

    /**
     * Get section header items for single-root display
     */
    private getSectionItems(): TaskTreeItemType[] {
        const currentTasks = this.tasks.filter(t => t.status !== 'complete');
        const completedTasks = this.tasks.filter(t => t.status === 'complete');

        const items: TaskTreeItemType[] = [];

        if (currentTasks.length > 0 || completedTasks.length === 0) {
            items.push(new TaskSectionItem('current', currentTasks.length));
        }

        if (completedTasks.length > 0) {
            items.push(new TaskSectionItem('completed', completedTasks.length));
        }

        return items;
    }

    /**
     * Get section header items for a specific workspace
     */
    private getSectionItemsForWorkspace(workspacePath: string): TaskTreeItemType[] {
        const workspaceTasks = this.tasks.filter(t => t.folderPath === workspacePath);
        const currentTasks = workspaceTasks.filter(t => t.status !== 'complete');
        const completedTasks = workspaceTasks.filter(t => t.status === 'complete');

        const items: TaskTreeItemType[] = [];

        if (currentTasks.length > 0 || completedTasks.length === 0) {
            items.push(new TaskSectionItem('current', currentTasks.length, workspacePath));
        }

        if (completedTasks.length > 0) {
            items.push(new TaskSectionItem('completed', completedTasks.length, workspacePath));
        }

        return items;
    }

    /**
     * Get workspace folder items for multi-root display
     */
    private getWorkspaceFolderItems(): WorkspaceFolderItem[] {
        return this.workspacePaths.map(ws =>
            new WorkspaceFolderItem(ws.name, ws.path, ws.projectAlias)
        );
    }

    /**
     * Get task items for a specific workspace
     * @param workspacePath Path to the workspace folder
     * @param includeAll If true, include all tasks; if false, filter by showCompleted
     * @param showCompleted If true (and includeAll is false), show only completed; otherwise show only pending/next
     */
    private getTaskItemsForWorkspace(workspacePath: string, includeAll: boolean = false, showCompleted: boolean = false): TaskTreeItem[] {
        let workspaceTasks = this.tasks.filter(task => task.folderPath === workspacePath);

        if (!includeAll) {
            workspaceTasks = workspaceTasks.filter(task =>
                showCompleted ? task.status === 'complete' : task.status !== 'complete'
            );
        }

        if (workspaceTasks.length === 0) {
            const message = showCompleted ? 'No completed tasks' : 'No tasks found';
            return [
                new TaskTreeItem({
                    id: 'no-tasks',
                    specName: '',
                    title: message,
                    status: 'pending',
                    line: 0,
                    folderPath: workspacePath
                }),
            ];
        }

        // Don't show folder name in hierarchical mode (already shown in parent)
        return workspaceTasks.map(task => {
            const taskForDisplay = { ...task, folderName: undefined };
            return new TaskTreeItem(taskForDisplay);
        });
    }

    private loadTasks(): void {
        this.tasks = [];

        const config = vscode.workspace.getConfiguration('ldf');
        const specsPath = config.get('specsDirectory', '.ldf/specs');
        const perWorkspaceLimit = 50;

        // Filter to active project if one is selected
        const activeProject = getActiveProject();
        const workspacesToLoad = activeProject
            ? this.workspacePaths.filter(w => w.path === activeProject.path)
            : this.workspacePaths;

        const isMultiRoot = workspacesToLoad.length > 1;

        for (const workspace of workspacesToLoad) {
            const specsDir = path.join(workspace.path, specsPath);

            if (!fs.existsSync(specsDir)) {
                continue;
            }

            const specs = fs.readdirSync(specsDir, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name);

            const workspaceTasks: TaskInfo[] = [];

            for (const specName of specs) {
                const tasksPath = path.join(specsDir, specName, 'tasks.md');
                if (fs.existsSync(tasksPath)) {
                    const content = fs.readFileSync(tasksPath, 'utf-8');
                    const specTasks = this.parseTasksFile(specName, content, workspace.path);
                    // Add folder context for multi-root workspaces
                    for (const task of specTasks) {
                        if (isMultiRoot) {
                            task.folderName = workspace.name;
                        }
                        task.folderPath = workspace.path;
                    }
                    workspaceTasks.push(...specTasks);
                }
            }

            // Sort per-workspace tasks
            workspaceTasks.sort((a, b) => {
                const statusOrder = { 'next': 0, pending: 1, complete: 2 };
                return statusOrder[a.status] - statusOrder[b.status] || a.id.localeCompare(b.id);
            });

            // Apply per-workspace limit to ensure fair representation
            this.tasks.push(...workspaceTasks.slice(0, perWorkspaceLimit));
        }

        // Final sort for display (maintains folder grouping)
        this.tasks.sort((a, b) => {
            const statusOrder = { 'next': 0, pending: 1, complete: 2 };
            const orderA = statusOrder[a.status];
            const orderB = statusOrder[b.status];
            if (orderA !== orderB) return orderA - orderB;
            // Group by folder in multi-root
            if (a.folderName && b.folderName && a.folderName !== b.folderName) {
                return a.folderName.localeCompare(b.folderName);
            }
            return a.id.localeCompare(b.id);
        });
    }

    private parseTasksFile(specName: string, content: string, folderPath: string): TaskInfo[] {
        const parsed = parseTasksContent(specName, content);

        const tasks: TaskInfo[] = parsed.map((p) => ({
            id: p.id,
            specName: p.specName,
            title: `${p.taskNumber}: ${p.title}`,
            status: p.isComplete ? 'complete' : 'pending' as const,
            line: p.line,
            folderPath: folderPath,
        }));

        // Mark first incomplete task as "next" if setting enabled
        const config = vscode.workspace.getConfiguration('ldf');
        if (config.get('showNextTask', false)) {
            const firstIncomplete = tasks.find((t) => t.status === 'pending');
            if (firstIncomplete) {
                firstIncomplete.status = 'next';
            }
        }

        return tasks;
    }

    /**
     * Get task items for single-root display
     * @param includeAll If true, include all tasks; if false, filter by showCompleted
     * @param showCompleted If true (and includeAll is false), show only completed; otherwise show only pending/next
     */
    private getTaskItems(includeAll: boolean = false, showCompleted: boolean = false): TaskTreeItem[] {
        let filteredTasks = this.tasks;

        if (!includeAll) {
            filteredTasks = this.tasks.filter(t =>
                showCompleted ? t.status === 'complete' : t.status !== 'complete'
            );
        }

        if (filteredTasks.length === 0) {
            const message = showCompleted ? 'No completed tasks' : 'No tasks found';
            return [
                new TaskTreeItem({
                    id: 'no-tasks',
                    specName: '',
                    title: message,
                    status: 'pending',
                    line: 0,
                }),
            ];
        }

        return filteredTasks.map((task) => new TaskTreeItem(task));
    }

    getTasks(): TaskInfo[] {
        return this.tasks;
    }

    getTask(id: string): TaskInfo | undefined {
        return this.tasks.find((t) => t.id === id);
    }

    async markTaskComplete(taskId: string): Promise<boolean> {
        // Find the task to get its folder path
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || !task.folderPath) return false;

        // Parse taskId to get specName and task number
        const colonIndex = taskId.lastIndexOf(':');
        if (colonIndex === -1) return false;

        const specName = taskId.substring(0, colonIndex);
        const taskNumber = taskId.substring(colonIndex + 1);

        const config = vscode.workspace.getConfiguration('ldf');
        const specsDir = path.join(
            task.folderPath,
            config.get('specsDirectory', '.ldf/specs')
        );
        const tasksPath = path.join(specsDir, specName, 'tasks.md');

        if (!fs.existsSync(tasksPath)) return false;

        // Re-read the file fresh to avoid stale line numbers
        const content = fs.readFileSync(tasksPath, 'utf-8');

        // Use utility function to mark task complete
        const updatedContent = markTaskInContent(content, taskNumber);
        if (updatedContent) {
            fs.writeFileSync(tasksPath, updatedContent, 'utf-8');
            this.refresh();
            return true;
        }

        return false;
    }
}

export class TaskTreeItem extends vscode.TreeItem {
    public readonly taskId: string;

    constructor(public readonly taskInfo: TaskInfo) {
        super(taskInfo.title, vscode.TreeItemCollapsibleState.None);

        this.taskId = taskInfo.id;
        this.contextValue = taskInfo.id === 'no-tasks' ? 'info' : 'task';
        // Show folder prefix in multi-root workspaces
        if (taskInfo.folderName) {
            this.description = `${taskInfo.folderName} • ${taskInfo.specName}`;
        } else {
            this.description = taskInfo.specName;
        }

        if (taskInfo.status === 'next') {
            this.iconPath = new vscode.ThemeIcon(
                'arrow-right',
                new vscode.ThemeColor('charts.blue')
            );
            this.tooltip = 'Next up';
        } else if (taskInfo.status === 'complete') {
            this.iconPath = new vscode.ThemeIcon(
                'check',
                new vscode.ThemeColor('charts.green')
            );
            this.tooltip = 'Complete';
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
            this.tooltip = 'Pending';
        }

        // Click to open tasks.md at the task line
        if (taskInfo.line > 0 && taskInfo.specName && taskInfo.folderPath) {
            const config = vscode.workspace.getConfiguration('ldf');
            const specsDir = config.get('specsDirectory', '.ldf/specs');

            const tasksPath = path.join(
                taskInfo.folderPath,
                specsDir,
                taskInfo.specName,
                'tasks.md'
            );
            this.command = {
                command: 'vscode.open',
                title: 'Open Task',
                arguments: [
                    vscode.Uri.file(tasksPath),
                    {
                        selection: new vscode.Range(
                            taskInfo.line - 1,
                            0,
                            taskInfo.line - 1,
                            100
                        ),
                    },
                ],
            };
        }
    }
}

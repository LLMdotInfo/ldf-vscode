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

export interface TaskInfo {
    id: string;
    specName: string;
    title: string;
    status: 'pending' | 'next' | 'complete';
    line: number; // Line number in tasks.md for editing
    folderName?: string;  // For multi-root workspace display
    folderPath?: string;  // Workspace folder this task belongs to
}

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TaskTreeItem | undefined | null | void> =
        new vscode.EventEmitter<TaskTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TaskTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private tasks: TaskInfo[] = [];
    private workspacePaths: Array<{ path: string; name: string }> = [];

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
        this.loadTasks();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TaskTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TaskTreeItem): Thenable<TaskTreeItem[]> {
        if (!element) {
            return Promise.resolve(this.getTaskItems());
        }
        return Promise.resolve([]);
    }

    private loadTasks(): void {
        this.tasks = [];

        const config = vscode.workspace.getConfiguration('ldf');
        const specsPath = config.get('specsDirectory', '.ldf/specs');
        const isMultiRoot = this.workspacePaths.length > 1;

        for (const workspace of this.workspacePaths) {
            const specsDir = path.join(workspace.path, specsPath);

            if (!fs.existsSync(specsDir)) {
                continue;
            }

            const specs = fs.readdirSync(specsDir, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name);

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
                    this.tasks.push(...specTasks);
                }
            }
        }

        // Sort: next first, then pending, then complete, then by folder
        this.tasks.sort((a, b) => {
            const statusOrder = {
                'next': 0,
                pending: 1,
                complete: 2,
            };
            const orderA = statusOrder[a.status];
            const orderB = statusOrder[b.status];
            if (orderA !== orderB) return orderA - orderB;
            // Group by folder in multi-root
            if (a.folderName && b.folderName && a.folderName !== b.folderName) {
                return a.folderName.localeCompare(b.folderName);
            }
            return a.id.localeCompare(b.id);
        });

        // Limit to reasonable number
        this.tasks = this.tasks.slice(0, 50);
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

    private getTaskItems(): TaskTreeItem[] {
        if (this.tasks.length === 0) {
            return [
                new TaskTreeItem({
                    id: 'no-tasks',
                    specName: '',
                    title: 'No tasks found',
                    status: 'pending',
                    line: 0,
                }),
            ];
        }

        return this.tasks
            .filter((t) => t.status !== 'complete') // Only show incomplete
            .map((task) => new TaskTreeItem(task));
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

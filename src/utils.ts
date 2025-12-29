/**
 * Utility functions for LDF VS Code Extension
 *
 * These are pure functions that can be easily unit tested.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

/**
 * Promisified execFile for async command execution (no shell).
 * Safer than shell-based exec as it doesn't parse through a shell.
 * Returns { stdout, stderr } on success, throws on error.
 */
export const execFileAsync = promisify(execFile);

// Valid audit types - allowlist for security (must match LDF CLI audit.py)
export const VALID_AUDIT_TYPES = ['spec-review', 'security', 'gap-analysis', 'edge-cases', 'architecture'];

/**
 * Shell-escape a string for safe use in terminal commands.
 * Cross-platform: uses double quotes on Windows, single quotes on POSIX.
 */
export function shellQuote(str: string): string {
    const isWindows = process.platform === 'win32';
    if (isWindows) {
        // Windows cmd.exe: use double quotes, escape embedded quotes by doubling
        return `"${str.replace(/"/g, '""')}"`;
    } else {
        // POSIX (bash/zsh): single quotes with escape for embedded single quotes
        return `'${str.replace(/'/g, "'\\''")}'`;
    }
}

/**
 * Validate spec name is safe for shell execution.
 * Only allows alphanumeric, hyphens, underscores, and dots.
 */
export function isValidSpecName(name: string): boolean {
    return /^[a-zA-Z0-9_.-]+$/.test(name);
}

/**
 * Check if an executable exists in system PATH.
 * Cross-platform: works on Windows, macOS, and Linux.
 */
export function findInPath(executable: string): string | null {
    const isWindows = process.platform === 'win32';
    const pathSeparator = isWindows ? ';' : ':';
    const pathEnv = process.env.PATH || '';
    const pathDirs = pathEnv.split(pathSeparator);

    // On Windows, also check common extensions
    const extensions = isWindows ? ['', '.exe', '.cmd', '.bat'] : [''];

    for (const dir of pathDirs) {
        for (const ext of extensions) {
            const fullPath = path.join(dir, executable + ext);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
    }
    return null;
}

/**
 * Get virtualenv candidate paths for a given workspace.
 * Cross-platform: returns appropriate paths for Windows or POSIX.
 */
export function getVenvCandidates(workspacePath: string): string[] {
    const isWindows = process.platform === 'win32';
    const venvDirs = ['.venv', 'venv', '.env', 'env'];
    const candidates: string[] = [];

    for (const venv of venvDirs) {
        if (isWindows) {
            candidates.push(path.join(workspacePath, venv, 'Scripts', 'ldf.exe'));
            candidates.push(path.join(workspacePath, venv, 'Scripts', 'ldf.cmd'));
            candidates.push(path.join(workspacePath, venv, 'Scripts', 'ldf'));
        } else {
            candidates.push(path.join(workspacePath, venv, 'bin', 'ldf'));
        }
    }

    return candidates;
}

/**
 * Get the path to an executable in a Python virtualenv.
 * Handles platform differences (bin/ vs Scripts/, .exe suffix).
 *
 * @param basePath - Directory containing the .venv folder
 * @param name - Executable name without extension (e.g., 'ldf', 'python', 'pytest')
 * @param venvDir - Virtualenv directory name (default: '.venv')
 * @returns Full path to the executable
 */
export function getVenvExecutablePath(
    basePath: string,
    name: string,
    venvDir: string = '.venv'
): string {
    const isWindows = process.platform === 'win32';
    const venvPath = path.join(basePath, venvDir);

    if (isWindows) {
        // Windows: .venv/Scripts/name.exe (primary) or .cmd (fallback)
        const exePath = path.join(venvPath, 'Scripts', `${name}.exe`);
        const cmdPath = path.join(venvPath, 'Scripts', `${name}.cmd`);
        // Prefer .exe if it exists, otherwise return .exe path (let caller handle missing)
        if (fs.existsSync(cmdPath) && !fs.existsSync(exePath)) {
            return cmdPath;
        }
        return exePath;
    } else {
        // POSIX: .venv/bin/name
        return path.join(venvPath, 'bin', name);
    }
}

/**
 * Check if a venv executable exists.
 *
 * @param basePath - Directory containing the .venv folder
 * @param name - Executable name without extension
 * @param venvDir - Virtualenv directory name (default: '.venv')
 * @returns true if the executable exists
 */
export function venvExecutableExists(
    basePath: string,
    name: string,
    venvDir: string = '.venv'
): boolean {
    const execPath = getVenvExecutablePath(basePath, name, venvDir);
    return fs.existsSync(execPath);
}

/**
 * Task parsing result
 */
export interface ParsedTask {
    id: string;
    specName: string;
    title: string;
    taskNumber: string;
    isComplete: boolean;
    line: number;
}

/**
 * Parse tasks from a tasks.md file content.
 * Returns an array of parsed tasks.
 */
export function parseTasksContent(specName: string, content: string): ParsedTask[] {
    const tasks: ParsedTask[] = [];
    const lines = content.split('\n');

    // Look for task patterns (official bold checklist format):
    // - [ ] **Task 1.1:** Description (checkbox with bold)
    // - [x] **Task 1.2:** Description (completed)
    const boldCheckboxPattern = /^(\s*)[-*]\s+\[([ xX])\]\s+\*\*Task\s+(\d+(?:\.\d+)?(?:\.\d+)?):\*\*\s*(.+)$/;

    let lineNumber = 0;
    for (const line of lines) {
        lineNumber++;

        const match = line.match(boldCheckboxPattern);
        if (match) {
            const isComplete = match[2].toLowerCase() === 'x';
            const taskNumber = match[3];
            const title = match[4].trim();

            tasks.push({
                id: `${specName}:${taskNumber}`,
                specName,
                title,
                taskNumber,
                isComplete,
                line: lineNumber,
            });
        }
    }

    return tasks;
}

/**
 * Build a regex pattern to match a specific task by its number.
 */
export function buildTaskPattern(taskNumber: string): RegExp {
    const escapedTaskNum = taskNumber.replace(/\./g, '\\.');
    return new RegExp(
        `^(\\s*)[-*]\\s+\\[\\s\\]\\s+\\*\\*Task\\s+${escapedTaskNum}:\\*\\*`
    );
}

/**
 * Mark a task as complete in file content.
 * Returns the updated content or null if task not found.
 */
export function markTaskInContent(content: string, taskNumber: string): string | null {
    const lines = content.split('\n');
    const pattern = buildTaskPattern(taskNumber);

    for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
            const updated = lines[i].replace(/\[\s\]/, '[x]');
            if (updated !== lines[i]) {
                lines[i] = updated;
                return lines.join('\n');
            }
        }
    }

    return null;
}

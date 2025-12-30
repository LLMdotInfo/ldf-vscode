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
export const VALID_AUDIT_TYPES = [
    'spec-review',
    'code-audit',
    'security',
    'security-check',
    'pre-launch',
    'gap-analysis',
    'edge-cases',
    'architecture',
    'full',
];

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

// ============================================================================
// LDF Detection Functions
// ============================================================================

/**
 * Result of LDF executable detection.
 */
export interface LdfDetectionResult {
    found: boolean;
    path: string | null;
    source: 'global-setting' | 'workspace-setting' | 'path' |
            'workspace-venv' | 'common-location' | 'pipx' | 'not-found';
    verified: boolean;
    error?: string;
}

/**
 * Result of LDF executable verification.
 */
export interface LdfVerificationResult {
    valid: boolean;
    version?: string;
    error?: string;
}

/**
 * Get the user's home directory (cross-platform).
 */
export function getHomeDir(): string {
    return process.env.HOME || process.env.USERPROFILE || '';
}

/**
 * Get common LDF installation paths to check.
 * Cross-platform: returns appropriate paths for Windows, macOS, and Linux.
 */
export function getCommonLdfPaths(): string[] {
    const isWindows = process.platform === 'win32';
    const home = getHomeDir();

    if (!home) return [];

    const paths: string[] = [];

    if (isWindows) {
        const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

        // Windows common locations
        paths.push(
            // User venv installations
            path.join(home, 'ldf', '.venv', 'Scripts', 'ldf.exe'),
            path.join(home, 'dev', 'ldf', '.venv', 'Scripts', 'ldf.exe'),
            // Program installations
            path.join(localAppData, 'Programs', 'LDF', 'ldf.exe'),
            path.join(home, '.local', 'bin', 'ldf.exe'),
            // Scoop
            path.join(home, 'scoop', 'shims', 'ldf.exe'),
            // Chocolatey
            'C:\\ProgramData\\chocolatey\\bin\\ldf.exe',
        );

        // Python user scripts (glob pattern approximation)
        const pythonVersions = ['Python39', 'Python310', 'Python311', 'Python312', 'Python313', 'Python314'];
        for (const pyVer of pythonVersions) {
            paths.push(path.join(appData, 'Python', pyVer, 'Scripts', 'ldf.exe'));
        }
    } else {
        // macOS/Linux common locations
        paths.push(
            // User venv installations
            path.join(home, 'ldf', '.venv', 'bin', 'ldf'),
            path.join(home, 'dev', 'ldf', '.venv', 'bin', 'ldf'),
            // User local bin
            path.join(home, '.local', 'bin', 'ldf'),
            // System locations
            '/usr/local/bin/ldf',
            '/usr/bin/ldf',
        );

        // macOS Homebrew (both Intel and Apple Silicon)
        if (process.platform === 'darwin') {
            paths.push(
                '/opt/homebrew/bin/ldf',  // Apple Silicon
                '/usr/local/bin/ldf',      // Intel (already added but explicit)
            );
        }
    }

    return paths;
}

/**
 * Get pipx LDF installation path if it exists.
 * Cross-platform support.
 */
export function getPipxLdfPath(): string | null {
    const isWindows = process.platform === 'win32';
    const home = getHomeDir();

    if (!home) return null;

    // Check both possible pipx venv locations
    const pipxPaths = isWindows
        ? [
            path.join(home, '.local', 'pipx', 'venvs', 'llm-ldf', 'Scripts', 'ldf.exe'),
            path.join(home, '.local', 'pipx', 'venvs', 'ldf', 'Scripts', 'ldf.exe'),
        ]
        : [
            path.join(home, '.local', 'pipx', 'venvs', 'llm-ldf', 'bin', 'ldf'),
            path.join(home, '.local', 'pipx', 'venvs', 'ldf', 'bin', 'ldf'),
        ];

    for (const pipxPath of pipxPaths) {
        if (fs.existsSync(pipxPath)) {
            return pipxPath;
        }
    }

    return null;
}

/**
 * Get expanded workspace venv candidates.
 * Checks more patterns than the basic getVenvCandidates.
 */
export function getWorkspaceVenvCandidates(workspacePath: string): string[] {
    const isWindows = process.platform === 'win32';
    const venvDirs = ['.venv', 'venv', '.env', 'env', '.ldf/venv'];
    const candidates: string[] = [];

    for (const venv of venvDirs) {
        if (isWindows) {
            candidates.push(path.join(workspacePath, venv, 'Scripts', 'ldf.exe'));
            candidates.push(path.join(workspacePath, venv, 'Scripts', 'ldf.cmd'));
        } else {
            candidates.push(path.join(workspacePath, venv, 'bin', 'ldf'));
        }
    }

    // Check .tox environments (common in Python projects)
    const toxDir = path.join(workspacePath, '.tox');
    if (fs.existsSync(toxDir)) {
        try {
            const toxEnvs = fs.readdirSync(toxDir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);

            for (const toxEnv of toxEnvs) {
                if (isWindows) {
                    candidates.push(path.join(toxDir, toxEnv, 'Scripts', 'ldf.exe'));
                } else {
                    candidates.push(path.join(toxDir, toxEnv, 'bin', 'ldf'));
                }
            }
        } catch {
            // Ignore read errors
        }
    }

    return candidates;
}

/**
 * Verify that an LDF executable works by running --version.
 * Non-blocking with configurable timeout.
 *
 * @param execPath - Path to the LDF executable
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Verification result with version or error
 */
export async function verifyLdfExecutable(
    execPath: string,
    timeoutMs: number = 5000
): Promise<LdfVerificationResult> {
    try {
        const { stdout, stderr } = await execFileAsync(
            execPath,
            ['--version'],
            { timeout: timeoutMs }
        );

        // Check that output contains a version number (e.g., "ldf, version 1.1.0")
        const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
        if (versionMatch) {
            return { valid: true, version: versionMatch[1] };
        }

        // Version command ran but no version found
        return {
            valid: false,
            error: stderr || 'No version number found in output'
        };
    } catch (err: unknown) {
        const error = err as { killed?: boolean; code?: string; message?: string };

        if (error.killed) {
            return {
                valid: false,
                error: 'Executable timed out (may be hanging or prompting for input)'
            };
        }

        if (error.code === 'ENOENT') {
            return {
                valid: false,
                error: 'Executable not found at path'
            };
        }

        if (error.code === 'EACCES') {
            return {
                valid: false,
                error: 'Permission denied - file may not be executable'
            };
        }

        return {
            valid: false,
            error: error.message || String(err)
        };
    }
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

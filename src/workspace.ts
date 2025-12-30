/**
 * Workspace detection and parsing for multi-project support.
 *
 * This module mirrors the Python implementation in ldf/models/workspace.py
 * and ldf/project_resolver.py, providing workspace manifest detection,
 * parsing, and project resolution.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

// Workspace manifest filename
export const WORKSPACE_MANIFEST = 'ldf-workspace.yaml';

/**
 * A project entry in the workspace manifest.
 */
export interface ProjectEntry {
    /** Relative path from workspace root to project directory */
    path: string;
    /** Short name for CLI targeting (e.g., 'auth' for --project auth) */
    alias: string;
}

/**
 * Configuration for automatic project discovery.
 */
export interface DiscoveryConfig {
    /** Glob patterns to find projects (e.g., ["**\/.ldf/config.yaml"]) */
    patterns: string[];
    /** Directories to exclude from discovery */
    exclude: string[];
}

/**
 * Project configuration in workspace manifest.
 */
export interface WorkspaceProjects {
    /** Explicitly listed projects with paths and aliases */
    explicit: ProjectEntry[];
    /** Configuration for auto-discovering projects */
    discovery: DiscoveryConfig;
}

/**
 * Configuration for shared resources.
 */
export interface SharedConfig {
    /** Path to shared resources directory (relative to workspace root) */
    path: string;
    /** Whether to inherit guardrails from shared */
    inheritGuardrails: boolean;
    /** Whether to inherit templates from shared */
    inheritTemplates: boolean;
    /** Whether to inherit question packs from shared */
    inheritQuestionPacks: boolean;
    /** Whether to inherit macros from shared */
    inheritMacros: boolean;
}

/**
 * Configuration for cross-project references.
 */
export interface ReferencesConfig {
    /** Whether cross-project references are allowed */
    enabled: boolean;
}

/**
 * Configuration for aggregated reporting.
 */
export interface ReportingConfig {
    /** Whether workspace-level reporting is enabled */
    enabled: boolean;
    /** Directory for report output */
    outputDir: string;
}

/**
 * Parsed ldf-workspace.yaml manifest.
 */
export interface WorkspaceManifest {
    /** Schema version (e.g., "1.0") */
    version: string;
    /** Workspace name */
    name: string;
    /** Project configuration (explicit list and discovery) */
    projects: WorkspaceProjects;
    /** Shared resources configuration */
    shared: SharedConfig;
    /** Cross-project reference configuration */
    references: ReferencesConfig;
    /** Aggregated reporting configuration */
    reporting: ReportingConfig;
}

/**
 * Resolved project context for command execution.
 */
export interface ProjectContext {
    /** Absolute path to the project directory (contains .ldf/) */
    projectRoot: string;
    /** Absolute path to workspace root (contains ldf-workspace.yaml), null if not in workspace */
    workspaceRoot: string | null;
    /** Short alias for the project (from workspace config), null if not in workspace */
    projectAlias: string | null;
    /** True if this project is part of a workspace */
    isWorkspaceMember: boolean;
    /** Path to .ldf-shared/ directory, null if not applicable */
    sharedResourcesPath: string | null;
}

/**
 * Information about a detected workspace.
 */
export interface WorkspaceInfo {
    /** Path to workspace root directory */
    root: string;
    /** Parsed workspace manifest */
    manifest: WorkspaceManifest;
}

// Default values
const DEFAULT_DISCOVERY: DiscoveryConfig = {
    patterns: ['**/.ldf/config.yaml'],
    exclude: ['node_modules', '.venv', 'vendor', '.git', 'dist', 'build']
};

const DEFAULT_SHARED: SharedConfig = {
    path: '.ldf-shared/',
    inheritGuardrails: true,
    inheritTemplates: true,
    inheritQuestionPacks: true,
    inheritMacros: true
};

const DEFAULT_REFERENCES: ReferencesConfig = {
    enabled: true
};

const DEFAULT_REPORTING: ReportingConfig = {
    enabled: true,
    outputDir: '.ldf-reports/'
};

/**
 * Find workspace root by walking up directories from a starting path.
 *
 * @param startPath - Directory to start searching from
 * @returns Path to workspace root containing ldf-workspace.yaml, or null if not found
 */
export function findWorkspaceRoot(startPath: string): string | null {
    let current = path.resolve(startPath);
    const root = path.parse(current).root;

    while (current !== root) {
        const manifestPath = path.join(current, WORKSPACE_MANIFEST);
        if (fs.existsSync(manifestPath)) {
            return current;
        }
        current = path.dirname(current);
    }

    return null;
}

/**
 * Parse a workspace manifest from a YAML file.
 *
 * @param workspaceRoot - Path to workspace root directory
 * @returns Parsed WorkspaceManifest, or null if parsing fails
 */
export function parseWorkspaceManifest(workspaceRoot: string): WorkspaceManifest | null {
    const manifestPath = path.join(workspaceRoot, WORKSPACE_MANIFEST);

    if (!fs.existsSync(manifestPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        const data = yaml.load(content) as Record<string, unknown>;

        if (!data || typeof data !== 'object') {
            return null;
        }

        return parseManifestData(data);
    } catch (error) {
        console.error(`Failed to parse ${WORKSPACE_MANIFEST}:`, error);
        return null;
    }
}

/**
 * Parse manifest data from a parsed YAML object.
 */
function parseManifestData(data: Record<string, unknown>): WorkspaceManifest {
    const projectsData = data.projects as Record<string, unknown> | undefined;
    const sharedData = data.shared as Record<string, unknown> | undefined;
    const referencesData = data.references as Record<string, unknown> | undefined;
    const reportingData = data.reporting as Record<string, unknown> | undefined;

    return {
        version: (data.version as string) || '1.0',
        name: (data.name as string) || '',
        projects: parseProjectsConfig(projectsData),
        shared: parseSharedConfig(sharedData),
        references: parseReferencesConfig(referencesData),
        reporting: parseReportingConfig(reportingData)
    };
}

function parseProjectsConfig(data: Record<string, unknown> | undefined): WorkspaceProjects {
    if (!data) {
        return { explicit: [], discovery: DEFAULT_DISCOVERY };
    }

    const explicitData = data.explicit as Array<Record<string, unknown>> | undefined;
    const discoveryData = data.discovery as Record<string, unknown> | undefined;

    return {
        explicit: (explicitData || []).map(parseProjectEntry),
        discovery: parseDiscoveryConfig(discoveryData)
    };
}

function parseProjectEntry(data: Record<string, unknown>): ProjectEntry {
    const projectPath = (data.path as string) || '';
    return {
        path: projectPath,
        alias: (data.alias as string) || path.basename(projectPath)
    };
}

function parseDiscoveryConfig(data: Record<string, unknown> | undefined): DiscoveryConfig {
    if (!data) {
        return DEFAULT_DISCOVERY;
    }

    return {
        patterns: (data.patterns as string[]) || DEFAULT_DISCOVERY.patterns,
        exclude: (data.exclude as string[]) || DEFAULT_DISCOVERY.exclude
    };
}

function parseSharedConfig(data: Record<string, unknown> | undefined): SharedConfig {
    if (!data) {
        return DEFAULT_SHARED;
    }

    const inherit = data.inherit as Record<string, boolean> | undefined;

    return {
        path: (data.path as string) || DEFAULT_SHARED.path,
        inheritGuardrails: inherit?.guardrails ?? DEFAULT_SHARED.inheritGuardrails,
        inheritTemplates: inherit?.templates ?? DEFAULT_SHARED.inheritTemplates,
        inheritQuestionPacks: inherit?.question_packs ?? DEFAULT_SHARED.inheritQuestionPacks,
        inheritMacros: inherit?.macros ?? DEFAULT_SHARED.inheritMacros
    };
}

function parseReferencesConfig(data: Record<string, unknown> | undefined): ReferencesConfig {
    if (!data) {
        return DEFAULT_REFERENCES;
    }

    return {
        enabled: (data.enabled as boolean) ?? DEFAULT_REFERENCES.enabled
    };
}

function parseReportingConfig(data: Record<string, unknown> | undefined): ReportingConfig {
    if (!data) {
        return DEFAULT_REPORTING;
    }

    return {
        enabled: (data.enabled as boolean) ?? DEFAULT_REPORTING.enabled,
        outputDir: (data.output_dir as string) || DEFAULT_REPORTING.outputDir
    };
}

/**
 * Resolve all projects from a workspace manifest.
 *
 * This includes both explicitly defined projects and discovered projects.
 *
 * @param manifest - Parsed workspace manifest
 * @param workspaceRoot - Absolute path to workspace root
 * @returns Array of all project entries
 */
export async function resolveProjects(
    manifest: WorkspaceManifest,
    workspaceRoot: string
): Promise<ProjectEntry[]> {
    // Start with explicit projects
    const projects = [...manifest.projects.explicit];
    const existingPaths = new Set(projects.map(p => p.path));

    // Discover additional projects if discovery is configured
    if (manifest.projects.discovery.patterns.length > 0) {
        const discovered = await discoverProjects(workspaceRoot, manifest.projects.discovery);

        // Add discovered projects that aren't already explicit
        for (const project of discovered) {
            if (!existingPaths.has(project.path)) {
                projects.push(project);
                existingPaths.add(project.path);
            }
        }
    }

    return projects;
}

/**
 * Discover projects using glob patterns.
 * Uses VS Code's native findFiles API instead of external glob dependency.
 */
async function discoverProjects(
    workspaceRoot: string,
    config: DiscoveryConfig
): Promise<ProjectEntry[]> {
    const projects: ProjectEntry[] = [];

    for (const pattern of config.patterns) {
        try {
            // Use VS Code's native findFiles API (no external dependency)
            const relPattern = new vscode.RelativePattern(workspaceRoot, pattern);
            // Build exclude pattern: {**/node_modules/**,**/.venv/**,...}
            const excludePattern = config.exclude.length > 0
                ? `{${config.exclude.map(e => `**/${e}/**`).join(',')}}`
                : undefined;

            const uris = await vscode.workspace.findFiles(relPattern, excludePattern);

            for (const uri of uris) {
                // Get relative path from workspace root
                const relativeFsPath = path.relative(workspaceRoot, uri.fsPath);

                // Extract project path (parent of .ldf directory)
                const configPath = path.dirname(relativeFsPath); // .ldf
                const projectPath = path.dirname(configPath); // project root

                // Use relative path
                const relativePath = projectPath === '.' ? '.' : projectPath;
                const alias = path.basename(path.resolve(workspaceRoot, relativePath));

                projects.push({
                    path: relativePath,
                    alias: alias
                });
            }
        } catch (error) {
            console.error(`LDF: Failed to discover projects with pattern ${pattern}:`, error);
        }
    }

    return projects;
}

/**
 * Detect workspace context from a given path.
 *
 * This walks up from the given path to find a workspace manifest,
 * then determines which project the path belongs to.
 *
 * @param startPath - Path to check (typically a folder or file)
 * @returns WorkspaceInfo if found, null otherwise
 */
export function detectWorkspaceContext(startPath: string): WorkspaceInfo | null {
    const workspaceRoot = findWorkspaceRoot(startPath);

    if (!workspaceRoot) {
        return null;
    }

    const manifest = parseWorkspaceManifest(workspaceRoot);

    if (!manifest) {
        return null;
    }

    return {
        root: workspaceRoot,
        manifest: manifest
    };
}

/**
 * Resolve project context for a given path.
 *
 * @param filePath - Path to resolve (can be a file or directory)
 * @returns ProjectContext with resolved paths and metadata
 */
export async function resolveProjectContext(filePath: string): Promise<ProjectContext | null> {
    const resolvedPath = path.resolve(filePath);

    // Check for workspace
    const workspaceInfo = detectWorkspaceContext(resolvedPath);

    if (workspaceInfo) {
        // Find which project this path belongs to
        const projects = await resolveProjects(workspaceInfo.manifest, workspaceInfo.root);

        for (const project of projects) {
            const projectPath = path.resolve(workspaceInfo.root, project.path);

            // Check if resolved path is within this project
            if (resolvedPath.startsWith(projectPath + path.sep) || resolvedPath === projectPath) {
                const sharedPath = path.join(workspaceInfo.root, workspaceInfo.manifest.shared.path);

                return {
                    projectRoot: projectPath,
                    workspaceRoot: workspaceInfo.root,
                    projectAlias: project.alias,
                    isWorkspaceMember: true,
                    sharedResourcesPath: fs.existsSync(sharedPath) ? sharedPath : null
                };
            }
        }
    }

    // Check for standalone LDF project
    let current = resolvedPath;
    const root = path.parse(current).root;

    while (current !== root) {
        const ldfConfigPath = path.join(current, '.ldf', 'config.yaml');
        if (fs.existsSync(ldfConfigPath)) {
            return {
                projectRoot: current,
                workspaceRoot: null,
                projectAlias: null,
                isWorkspaceMember: false,
                sharedResourcesPath: null
            };
        }
        current = path.dirname(current);
    }

    return null;
}

/**
 * Check if a directory is an LDF project (contains .ldf/config.yaml).
 */
export function isLdfProject(dirPath: string): boolean {
    const configPath = path.join(dirPath, '.ldf', 'config.yaml');
    return fs.existsSync(configPath);
}

/**
 * Get the display name for a project.
 * Returns the alias if available, otherwise the folder name.
 */
export function getProjectDisplayName(project: ProjectEntry): string {
    return project.alias || path.basename(project.path);
}

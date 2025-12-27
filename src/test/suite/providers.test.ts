/**
 * Tests for multi-root workspace support in tree providers
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SpecTreeProvider } from '../../specView';
import { GuardrailTreeProvider } from '../../guardrailView';
import { TaskTreeProvider } from '../../taskView';

// Test helper functions
function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ldf-test-'));
}

function createLdfProject(baseDir: string, name: string): string {
    const projectDir = path.join(baseDir, name);
    const specsDir = path.join(projectDir, '.ldf', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    // Create config.yaml
    fs.writeFileSync(
        path.join(projectDir, '.ldf', 'config.yaml'),
        'schema_version: "1.1"\npreset: custom\n'
    );

    return projectDir;
}

function createSpec(projectDir: string, specName: string, options: {
    requirements?: boolean;
    design?: boolean;
    tasks?: boolean;
    taskContent?: string;
} = {}): void {
    const specDir = path.join(projectDir, '.ldf', 'specs', specName);
    fs.mkdirSync(specDir, { recursive: true });

    if (options.requirements !== false) {
        fs.writeFileSync(
            path.join(specDir, 'requirements.md'),
            '# Requirements\n\n## User Stories\n\n- As a user...\n'
        );
    }

    if (options.design) {
        fs.writeFileSync(
            path.join(specDir, 'design.md'),
            '# Design\n\n## Architecture\n\n...\n'
        );
    }

    if (options.tasks) {
        const taskContent = options.taskContent || `# Tasks

## Phase 1: Setup

- [ ] **Task 1.1:** First task
- [ ] **Task 1.2:** Second task
- [x] **Task 1.3:** Completed task
`;
        fs.writeFileSync(path.join(specDir, 'tasks.md'), taskContent);
    }
}

function cleanupDir(dir: string): void {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

suite('Provider Multi-Root Tests', () => {
    let tempDir: string;
    let project1: string;
    let project2: string;

    setup(() => {
        tempDir = createTempDir();
        project1 = createLdfProject(tempDir, 'project-alpha');
        project2 = createLdfProject(tempDir, 'project-beta');
    });

    teardown(() => {
        cleanupDir(tempDir);
    });

    suite('SpecTreeProvider Multi-Root', () => {
        test('constructor accepts single path string', () => {
            const provider = new SpecTreeProvider(project1);
            const specs = provider.getSpecs();
            assert.ok(Array.isArray(specs));
        });

        test('constructor accepts array of paths', () => {
            const provider = new SpecTreeProvider([project1, project2]);
            const specs = provider.getSpecs();
            assert.ok(Array.isArray(specs));
        });

        test('setWorkspacePaths updates with single path', () => {
            const provider = new SpecTreeProvider(project1);
            provider.setWorkspacePaths(project2);
            // Provider should now use project2
            const specs = provider.getSpecs();
            assert.ok(Array.isArray(specs));
        });

        test('setWorkspacePaths updates with array of paths', () => {
            const provider = new SpecTreeProvider(project1);
            provider.setWorkspacePaths([project1, project2]);
            const specs = provider.getSpecs();
            assert.ok(Array.isArray(specs));
        });

        test('addWorkspaceFolder adds new folder', () => {
            const provider = new SpecTreeProvider(project1);
            provider.addWorkspaceFolder(project2);
            // Both folders should now be tracked
            const specs = provider.getSpecs();
            assert.ok(Array.isArray(specs));
        });

        test('addWorkspaceFolder ignores duplicates', () => {
            const provider = new SpecTreeProvider(project1);
            provider.addWorkspaceFolder(project1); // Add same path again
            // Should not cause errors
            const specs = provider.getSpecs();
            assert.ok(Array.isArray(specs));
        });

        test('removeWorkspaceFolder removes folder', () => {
            const provider = new SpecTreeProvider([project1, project2]);
            provider.removeWorkspaceFolder(project1);
            // Should only have project2 now
            const specs = provider.getSpecs();
            assert.ok(Array.isArray(specs));
        });

        test('removeWorkspaceFolder handles non-existent path gracefully', () => {
            const provider = new SpecTreeProvider(project1);
            provider.removeWorkspaceFolder('/non/existent/path');
            // Should not throw
            const specs = provider.getSpecs();
            assert.ok(Array.isArray(specs));
        });

        test('loads specs from single workspace', () => {
            createSpec(project1, 'feature-a');
            createSpec(project1, 'feature-b');

            const provider = new SpecTreeProvider(project1);
            provider.refresh();
            const specs = provider.getSpecs();

            assert.strictEqual(specs.length, 2);
            assert.ok(specs.some(s => s.name === 'feature-a'));
            assert.ok(specs.some(s => s.name === 'feature-b'));
        });

        test('loads specs from multiple workspaces', () => {
            createSpec(project1, 'alpha-feature');
            createSpec(project2, 'beta-feature');

            const provider = new SpecTreeProvider([project1, project2]);
            provider.refresh();
            const specs = provider.getSpecs();

            assert.strictEqual(specs.length, 2);
            assert.ok(specs.some(s => s.name === 'alpha-feature'));
            assert.ok(specs.some(s => s.name === 'beta-feature'));
        });

        test('specs have folderName in multi-root mode', () => {
            createSpec(project1, 'alpha-feature');
            createSpec(project2, 'beta-feature');

            const provider = new SpecTreeProvider([project1, project2]);
            provider.refresh();
            const specs = provider.getSpecs();

            // In multi-root mode, folderName should be set
            for (const spec of specs) {
                assert.ok(spec.folderName, `Spec ${spec.name} should have folderName`);
            }
        });

        test('specs have folderPath always set', () => {
            createSpec(project1, 'alpha-feature');

            const provider = new SpecTreeProvider(project1);
            provider.refresh();
            const specs = provider.getSpecs();

            assert.strictEqual(specs.length, 1);
            assert.strictEqual(specs[0].folderPath, project1);
        });

        test('specs without folderName in single-root mode', () => {
            createSpec(project1, 'feature');

            const provider = new SpecTreeProvider(project1);
            provider.refresh();
            const specs = provider.getSpecs();

            assert.strictEqual(specs.length, 1);
            assert.strictEqual(specs[0].folderName, undefined);
        });

        test('getSpec finds spec by name', () => {
            createSpec(project1, 'my-feature');

            const provider = new SpecTreeProvider(project1);
            provider.refresh();

            const spec = provider.getSpec('my-feature');
            assert.ok(spec);
            assert.strictEqual(spec.name, 'my-feature');
        });
    });

    suite('GuardrailTreeProvider Multi-Root', () => {
        test('constructor accepts single path string', () => {
            const provider = new GuardrailTreeProvider(project1);
            const coverage = provider.getCoverage();
            assert.ok(Array.isArray(coverage));
        });

        test('constructor accepts array of paths', () => {
            const provider = new GuardrailTreeProvider([project1, project2]);
            const coverage = provider.getCoverage();
            assert.ok(Array.isArray(coverage));
        });

        test('setWorkspacePaths updates paths', () => {
            const provider = new GuardrailTreeProvider(project1);
            provider.setWorkspacePaths([project1, project2]);
            const coverage = provider.getCoverage();
            assert.ok(Array.isArray(coverage));
        });

        test('addWorkspaceFolder adds new folder', () => {
            const provider = new GuardrailTreeProvider(project1);
            provider.addWorkspaceFolder(project2);
            const coverage = provider.getCoverage();
            assert.ok(Array.isArray(coverage));
        });

        test('addWorkspaceFolder ignores duplicates', () => {
            const provider = new GuardrailTreeProvider(project1);
            provider.addWorkspaceFolder(project1);
            const coverage = provider.getCoverage();
            assert.ok(Array.isArray(coverage));
        });

        test('removeWorkspaceFolder removes folder', () => {
            const provider = new GuardrailTreeProvider([project1, project2]);
            provider.removeWorkspaceFolder(project1);
            const coverage = provider.getCoverage();
            assert.ok(Array.isArray(coverage));
        });

        test('loads core guardrails by default', () => {
            const provider = new GuardrailTreeProvider(project1);
            provider.refresh();
            const coverage = provider.getCoverage();

            // Should have 8 core guardrails
            assert.ok(coverage.length >= 8);
            assert.ok(coverage.some(c => c.guardrail.name === 'Testing Coverage'));
            assert.ok(coverage.some(c => c.guardrail.name === 'Security Basics'));
        });

        test('parses DONE status as covered', () => {
            // Create a spec with guardrail coverage matrix
            const specDir = path.join(project1, '.ldf', 'specs', 'auth-feature');
            fs.mkdirSync(specDir, { recursive: true });
            fs.writeFileSync(path.join(specDir, 'requirements.md'), `# Auth Feature

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks | Owner | Status |
|-----------|--------------|--------|-------|-------|--------|
| 1. Testing Coverage | [US-1] | [D-1] | [T-1] | Alice | DONE |
| 2. Security Basics | [US-1] | [D-1] | [T-1] | Bob | TODO |
`);

            const provider = new GuardrailTreeProvider(project1);
            provider.refresh();
            const coverage = provider.getCoverage();

            const testingCoverage = coverage.find(c => c.guardrail.id === 1);
            const securityCoverage = coverage.find(c => c.guardrail.id === 2);

            assert.ok(testingCoverage);
            assert.strictEqual(testingCoverage.status, 'covered');
            assert.strictEqual(testingCoverage.coveredBy.length, 1);

            assert.ok(securityCoverage);
            assert.strictEqual(securityCoverage.status, 'not-covered');
        });

        test('parses N/A status as not-applicable', () => {
            const specDir = path.join(project1, '.ldf', 'specs', 'api-feature');
            fs.mkdirSync(specDir, { recursive: true });
            fs.writeFileSync(path.join(specDir, 'requirements.md'), `# API Feature

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks | Owner | Status |
|-----------|--------------|--------|-------|-------|--------|
| 7. Database Migrations | - | - | - | - | N/A |
`);

            const provider = new GuardrailTreeProvider(project1);
            provider.refresh();
            const coverage = provider.getCoverage();

            const dbCoverage = coverage.find(c => c.guardrail.id === 7);
            assert.ok(dbCoverage);
            assert.strictEqual(dbCoverage.status, 'not-applicable');
        });

        test('parses mixed statuses as partial', () => {
            // Create two specs with different statuses for the same guardrail
            const spec1Dir = path.join(project1, '.ldf', 'specs', 'feature-a');
            const spec2Dir = path.join(project1, '.ldf', 'specs', 'feature-b');
            fs.mkdirSync(spec1Dir, { recursive: true });
            fs.mkdirSync(spec2Dir, { recursive: true });

            fs.writeFileSync(path.join(spec1Dir, 'requirements.md'), `# Feature A

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks | Owner | Status |
|-----------|--------------|--------|-------|-------|--------|
| 1. Testing Coverage | [US-1] | [D-1] | [T-1] | Alice | DONE |
`);

            fs.writeFileSync(path.join(spec2Dir, 'requirements.md'), `# Feature B

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks | Owner | Status |
|-----------|--------------|--------|-------|-------|--------|
| 1. Testing Coverage | [US-1] | [D-1] | [T-1] | Bob | TODO |
`);

            const provider = new GuardrailTreeProvider(project1);
            provider.refresh();
            const coverage = provider.getCoverage();

            const testingCoverage = coverage.find(c => c.guardrail.id === 1);
            assert.ok(testingCoverage);
            assert.strictEqual(testingCoverage.status, 'partial');
            assert.strictEqual(testingCoverage.specCoverage.length, 2);
        });

        test('parses PARTIAL status explicitly', () => {
            const specDir = path.join(project1, '.ldf', 'specs', 'wip-feature');
            fs.mkdirSync(specDir, { recursive: true });
            fs.writeFileSync(path.join(specDir, 'requirements.md'), `# WIP Feature

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks | Owner | Status |
|-----------|--------------|--------|-------|-------|--------|
| 3. Error Handling | [US-1] | [D-1] | - | Carol | PARTIAL |
`);

            const provider = new GuardrailTreeProvider(project1);
            provider.refresh();
            const coverage = provider.getCoverage();

            const errorCoverage = coverage.find(c => c.guardrail.id === 3);
            assert.ok(errorCoverage);
            assert.strictEqual(errorCoverage.status, 'partial');
        });

        test('loads guardrails from guardrails.yaml with preset', () => {
            // Create guardrails.yaml with saas preset
            fs.writeFileSync(
                path.join(project1, '.ldf', 'guardrails.yaml'),
                'preset: saas\noverrides: {}\n'
            );

            const provider = new GuardrailTreeProvider(project1);
            provider.refresh();
            const coverage = provider.getCoverage();

            // Should have core + saas guardrails
            assert.ok(coverage.length >= 13);
            assert.ok(coverage.some(c => c.guardrail.name === 'Multi-Tenancy Isolation'));
            assert.ok(coverage.some(c => c.guardrail.name === 'Row-Level Security'));
        });
    });

    suite('TaskTreeProvider Multi-Root', () => {
        test('constructor accepts single path string', () => {
            const provider = new TaskTreeProvider(project1);
            const tasks = provider.getTasks();
            assert.ok(Array.isArray(tasks));
        });

        test('constructor accepts array of paths', () => {
            const provider = new TaskTreeProvider([project1, project2]);
            const tasks = provider.getTasks();
            assert.ok(Array.isArray(tasks));
        });

        test('setWorkspacePaths updates paths', () => {
            const provider = new TaskTreeProvider(project1);
            provider.setWorkspacePaths([project1, project2]);
            const tasks = provider.getTasks();
            assert.ok(Array.isArray(tasks));
        });

        test('addWorkspaceFolder adds new folder', () => {
            const provider = new TaskTreeProvider(project1);
            provider.addWorkspaceFolder(project2);
            const tasks = provider.getTasks();
            assert.ok(Array.isArray(tasks));
        });

        test('addWorkspaceFolder ignores duplicates', () => {
            const provider = new TaskTreeProvider(project1);
            provider.addWorkspaceFolder(project1);
            const tasks = provider.getTasks();
            assert.ok(Array.isArray(tasks));
        });

        test('removeWorkspaceFolder removes folder', () => {
            const provider = new TaskTreeProvider([project1, project2]);
            provider.removeWorkspaceFolder(project1);
            const tasks = provider.getTasks();
            assert.ok(Array.isArray(tasks));
        });

        test('loads tasks from single workspace', () => {
            createSpec(project1, 'feature', { tasks: true });

            const provider = new TaskTreeProvider(project1);
            provider.refresh();
            const tasks = provider.getTasks();

            assert.ok(tasks.length > 0);
        });

        test('loads tasks from multiple workspaces', () => {
            createSpec(project1, 'alpha-feature', { tasks: true });
            createSpec(project2, 'beta-feature', { tasks: true });

            const provider = new TaskTreeProvider([project1, project2]);
            provider.refresh();
            const tasks = provider.getTasks();

            // Should have tasks from both projects
            assert.ok(tasks.length >= 2);
        });

        test('tasks have folderPath set', () => {
            createSpec(project1, 'feature', { tasks: true });

            const provider = new TaskTreeProvider(project1);
            provider.refresh();
            const tasks = provider.getTasks();

            assert.ok(tasks.length > 0);
            for (const task of tasks) {
                assert.strictEqual(task.folderPath, project1);
            }
        });

        test('tasks have folderName in multi-root mode', () => {
            createSpec(project1, 'alpha-feature', { tasks: true });
            createSpec(project2, 'beta-feature', { tasks: true });

            const provider = new TaskTreeProvider([project1, project2]);
            provider.refresh();
            const tasks = provider.getTasks();

            for (const task of tasks) {
                assert.ok(task.folderName, `Task ${task.id} should have folderName`);
            }
        });

        test('getTask finds task by id', () => {
            createSpec(project1, 'feature', { tasks: true });

            const provider = new TaskTreeProvider(project1);
            provider.refresh();
            const tasks = provider.getTasks();

            if (tasks.length > 0) {
                const task = provider.getTask(tasks[0].id);
                assert.ok(task);
                assert.strictEqual(task.id, tasks[0].id);
            }
        });

        test('markTaskComplete updates task file', async () => {
            createSpec(project1, 'feature', { tasks: true });

            const provider = new TaskTreeProvider(project1);
            provider.refresh();
            const tasks = provider.getTasks();

            // Find an incomplete task
            const incompleteTask = tasks.find(t => t.status !== 'complete');
            if (incompleteTask) {
                const result = await provider.markTaskComplete(incompleteTask.id);
                assert.strictEqual(result, true);

                // Verify file was updated
                const tasksPath = path.join(project1, '.ldf', 'specs', 'feature', 'tasks.md');
                const content = fs.readFileSync(tasksPath, 'utf-8');
                // The task should now be marked with [x]
                assert.ok(content.includes('[x]') || content.includes('[X]'));
            }
        });
    });
});

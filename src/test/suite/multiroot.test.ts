/**
 * Tests for multi-root workspace duplicate basename handling
 *
 * These tests verify that workspaces with the same folder name (basename)
 * are correctly distinguished by their full paths.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GuardrailTreeProvider } from '../../guardrailView';

// Test helper functions
function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ldf-multiroot-test-'));
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

function createGuardrailsConfig(projectDir: string, preset: string): void {
    const guardrailsPath = path.join(projectDir, '.ldf', 'guardrails.yaml');
    fs.writeFileSync(guardrailsPath, `preset: ${preset}\n`);
}

function createSpecWithGuardrailCoverage(
    projectDir: string,
    specName: string,
    guardrailId: number,
    status: 'DONE' | 'TODO' | 'PARTIAL'
): void {
    const specDir = path.join(projectDir, '.ldf', 'specs', specName);
    fs.mkdirSync(specDir, { recursive: true });

    const content = `# ${specName} Requirements

## Guardrail Coverage Matrix

| Guardrail | Requirements | Design | Tasks/Tests | Owner | Status |
|-----------|--------------|--------|-------------|-------|--------|
| ${guardrailId}. Testing Coverage | [US-1] | [D-1] | [T-1] | Alice | ${status} |
`;
    fs.writeFileSync(path.join(specDir, 'requirements.md'), content);
}

function cleanupDir(dir: string): void {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

suite('Multi-Root Duplicate Basename Tests', () => {
    let tempDir: string;
    let clientADir: string;
    let clientBDir: string;
    let projectA: string;
    let projectB: string;

    setup(() => {
        tempDir = createTempDir();

        // Create two directories with the SAME basename "app"
        // This simulates: /projects/client-a/app and /projects/client-b/app
        clientADir = path.join(tempDir, 'client-a');
        clientBDir = path.join(tempDir, 'client-b');
        fs.mkdirSync(clientADir, { recursive: true });
        fs.mkdirSync(clientBDir, { recursive: true });

        // Both projects have the same basename "app"
        projectA = createLdfProject(clientADir, 'app');
        projectB = createLdfProject(clientBDir, 'app');
    });

    teardown(() => {
        cleanupDir(tempDir);
    });

    suite('GuardrailTreeProvider Duplicate Basenames', () => {
        test('should handle two workspaces with same basename', () => {
            // Verify both projects have the same basename
            assert.strictEqual(path.basename(projectA), 'app');
            assert.strictEqual(path.basename(projectB), 'app');

            // But different full paths
            assert.notStrictEqual(projectA, projectB);

            // Provider should handle both without error
            const provider = new GuardrailTreeProvider([projectA, projectB]);
            provider.refresh();

            // Should have coverage entries (even if empty)
            const coverage = provider.getCoverage();
            assert.ok(Array.isArray(coverage));
        });

        test('should maintain separate guardrails per workspace with same basename', () => {
            // Give each project a different guardrail preset
            createGuardrailsConfig(projectA, 'saas');
            createGuardrailsConfig(projectB, 'fintech');

            const provider = new GuardrailTreeProvider([projectA, projectB]);
            provider.refresh();

            // Both should be loaded without one overwriting the other
            const coverage = provider.getCoverage();

            // Should have guardrails from BOTH presets (saas has IDs 9-13, fintech has 14-20)
            const guardrailIds = coverage.map(c => c.guardrail.id);

            // Core guardrails (1-8) should be present
            assert.ok(guardrailIds.includes(1), 'Should have core guardrail 1');

            // SaaS guardrails from projectA
            assert.ok(guardrailIds.includes(9), 'Should have SaaS guardrail 9 (Multi-Tenancy)');

            // Fintech guardrails from projectB
            assert.ok(guardrailIds.includes(14), 'Should have Fintech guardrail 14 (Double-Entry)');
        });

        test('should maintain separate coverage per workspace with same basename', () => {
            // Create specs with different coverage in each workspace
            createSpecWithGuardrailCoverage(projectA, 'feature-x', 1, 'DONE');
            createSpecWithGuardrailCoverage(projectB, 'feature-y', 1, 'TODO');

            const provider = new GuardrailTreeProvider([projectA, projectB]);
            provider.refresh();

            const coverage = provider.getCoverage();
            const guardrail1 = coverage.find(c => c.guardrail.id === 1);

            assert.ok(guardrail1, 'Should have guardrail 1');

            // Should have coverage from BOTH specs (not just one overwriting the other)
            assert.strictEqual(
                guardrail1!.specCoverage.length,
                2,
                'Should have coverage entries from both workspaces'
            );

            // Check that we have both specs
            const specNames = guardrail1!.specCoverage.map(sc => sc.specName);
            assert.ok(
                specNames.some(n => n.includes('feature-x')),
                'Should include feature-x from projectA'
            );
            assert.ok(
                specNames.some(n => n.includes('feature-y')),
                'Should include feature-y from projectB'
            );
        });

        test('should store correct guardrails file path per workspace', () => {
            createGuardrailsConfig(projectA, 'saas');
            createGuardrailsConfig(projectB, 'fintech');

            const provider = new GuardrailTreeProvider([projectA, projectB]);
            provider.refresh();

            // Both workspaces should be tracked correctly
            // This test verifies internal state isn't corrupted by basename collision
            const coverage = provider.getCoverage();

            // If basename collision occurred, we'd only have one set of guardrails
            // With the fix, we should have guardrails from both presets
            const hasMultiTenancy = coverage.some(c => c.guardrail.name === 'Multi-Tenancy Isolation');
            const hasDoubleLedger = coverage.some(c => c.guardrail.name === 'Double-Entry Ledger');

            assert.ok(hasMultiTenancy, 'Should have SaaS guardrail from projectA');
            assert.ok(hasDoubleLedger, 'Should have Fintech guardrail from projectB');
        });
    });
});

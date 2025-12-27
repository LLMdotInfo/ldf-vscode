import * as assert from 'assert';
import {
    shellQuote,
    isValidSpecName,
    VALID_AUDIT_TYPES,
    parseTasksContent,
    buildTaskPattern,
    markTaskInContent,
    getVenvCandidates,
    getVenvExecutablePath,
    venvExecutableExists,
} from '../../utils';

suite('Utils Test Suite', () => {
    suite('shellQuote', () => {
        const isWindows = process.platform === 'win32';

        test('should wrap simple string in quotes', () => {
            if (isWindows) {
                assert.strictEqual(shellQuote('hello'), '"hello"');
            } else {
                assert.strictEqual(shellQuote('hello'), "'hello'");
            }
        });

        test('should escape quotes in string', () => {
            if (isWindows) {
                // Windows: double quotes are escaped by doubling
                assert.strictEqual(shellQuote('say "hello"'), '"say ""hello"""');
            } else {
                // POSIX: single quotes with escape
                assert.strictEqual(shellQuote("it's"), "'it'\\''s'");
            }
        });

        test('should handle empty string', () => {
            if (isWindows) {
                assert.strictEqual(shellQuote(''), '""');
            } else {
                assert.strictEqual(shellQuote(''), "''");
            }
        });

        test('should handle strings with spaces', () => {
            if (isWindows) {
                assert.strictEqual(shellQuote('hello world'), '"hello world"');
            } else {
                assert.strictEqual(shellQuote('hello world'), "'hello world'");
            }
        });

        test('should handle strings with special characters', () => {
            if (isWindows) {
                assert.strictEqual(shellQuote('$HOME'), '"$HOME"');
                assert.strictEqual(shellQuote('path\\to\\file'), '"path\\to\\file"');
            } else {
                assert.strictEqual(shellQuote('$HOME'), "'$HOME'");
                assert.strictEqual(shellQuote('`whoami`'), "'`whoami`'");
                assert.strictEqual(shellQuote('$(pwd)'), "'$(pwd)'");
            }
        });

        test('should handle multiple quotes', () => {
            if (isWindows) {
                assert.strictEqual(shellQuote('a"b"c'), '"a""b""c"');
            } else {
                assert.strictEqual(shellQuote("a'b'c"), "'a'\\''b'\\''c'");
            }
        });
    });

    suite('isValidSpecName', () => {
        test('should accept alphanumeric names', () => {
            assert.strictEqual(isValidSpecName('myspec'), true);
            assert.strictEqual(isValidSpecName('MySpec123'), true);
        });

        test('should accept names with hyphens', () => {
            assert.strictEqual(isValidSpecName('my-spec'), true);
            assert.strictEqual(isValidSpecName('user-authentication'), true);
        });

        test('should accept names with underscores', () => {
            assert.strictEqual(isValidSpecName('my_spec'), true);
            assert.strictEqual(isValidSpecName('user_auth'), true);
        });

        test('should accept names with dots', () => {
            assert.strictEqual(isValidSpecName('v1.0'), true);
            assert.strictEqual(isValidSpecName('spec.v2'), true);
        });

        test('should reject names with spaces', () => {
            assert.strictEqual(isValidSpecName('my spec'), false);
        });

        test('should reject names with shell metacharacters', () => {
            assert.strictEqual(isValidSpecName('spec;rm -rf'), false);
            assert.strictEqual(isValidSpecName('spec$(whoami)'), false);
            assert.strictEqual(isValidSpecName('spec`id`'), false);
            assert.strictEqual(isValidSpecName("spec'test"), false);
            assert.strictEqual(isValidSpecName('spec"test'), false);
            assert.strictEqual(isValidSpecName('spec|cat'), false);
            assert.strictEqual(isValidSpecName('spec&bg'), false);
        });

        test('should reject empty string', () => {
            assert.strictEqual(isValidSpecName(''), false);
        });
    });

    suite('VALID_AUDIT_TYPES', () => {
        test('should contain expected audit types', () => {
            assert.ok(VALID_AUDIT_TYPES.includes('spec-review'));
            assert.ok(VALID_AUDIT_TYPES.includes('security-check'));
            assert.ok(VALID_AUDIT_TYPES.includes('gap-analysis'));
            assert.ok(VALID_AUDIT_TYPES.includes('edge-cases'));
        });

        test('should have exactly 4 types', () => {
            assert.strictEqual(VALID_AUDIT_TYPES.length, 4);
        });
    });

    suite('parseTasksContent', () => {
        test('should parse basic task format', () => {
            const content = '- [ ] **Task 1.1:** Create initial structure';
            const tasks = parseTasksContent('my-spec', content);

            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].id, 'my-spec:1.1');
            assert.strictEqual(tasks[0].taskNumber, '1.1');
            assert.strictEqual(tasks[0].title, 'Create initial structure');
            assert.strictEqual(tasks[0].isComplete, false);
            assert.strictEqual(tasks[0].line, 1);
        });

        test('should parse completed tasks', () => {
            const content = '- [x] **Task 1.1:** Done task';
            const tasks = parseTasksContent('spec', content);

            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].isComplete, true);
        });

        test('should parse multiple tasks', () => {
            const content = `# Tasks

- [ ] **Task 1.1:** First task
- [ ] **Task 1.2:** Second task
- [x] **Task 2.1:** Completed task`;

            const tasks = parseTasksContent('spec', content);

            assert.strictEqual(tasks.length, 3);
            assert.strictEqual(tasks[0].taskNumber, '1.1');
            assert.strictEqual(tasks[1].taskNumber, '1.2');
            assert.strictEqual(tasks[2].taskNumber, '2.1');
            assert.strictEqual(tasks[0].line, 3);
            assert.strictEqual(tasks[1].line, 4);
            assert.strictEqual(tasks[2].line, 5);
        });

        test('should handle nested task numbers', () => {
            const content = '- [ ] **Task 1.2.3:** Nested task';
            const tasks = parseTasksContent('spec', content);

            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].taskNumber, '1.2.3');
        });

        test('should handle asterisk bullets', () => {
            const content = '* [ ] **Task 1.1:** Asterisk bullet';
            const tasks = parseTasksContent('spec', content);

            assert.strictEqual(tasks.length, 1);
        });

        test('should handle indented tasks', () => {
            const content = '  - [ ] **Task 1.1:** Indented task';
            const tasks = parseTasksContent('spec', content);

            assert.strictEqual(tasks.length, 1);
        });

        test('should ignore non-task lines', () => {
            const content = `# Header
Some text
- Regular list item
- [ ] Not a task format
- [ ] **Task 1.1:** Real task`;

            const tasks = parseTasksContent('spec', content);

            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].taskNumber, '1.1');
        });

        test('should handle uppercase X for completed', () => {
            const content = '- [X] **Task 1.1:** Done';
            const tasks = parseTasksContent('spec', content);

            assert.strictEqual(tasks[0].isComplete, true);
        });
    });

    suite('buildTaskPattern', () => {
        test('should match simple task number', () => {
            const pattern = buildTaskPattern('1.1');
            assert.ok(pattern.test('- [ ] **Task 1.1:** Description'));
        });

        test('should match nested task number', () => {
            const pattern = buildTaskPattern('1.2.3');
            assert.ok(pattern.test('- [ ] **Task 1.2.3:** Description'));
        });

        test('should not match completed tasks', () => {
            const pattern = buildTaskPattern('1.1');
            assert.ok(!pattern.test('- [x] **Task 1.1:** Description'));
        });

        test('should not match different task numbers', () => {
            const pattern = buildTaskPattern('1.1');
            assert.ok(!pattern.test('- [ ] **Task 1.2:** Description'));
            assert.ok(!pattern.test('- [ ] **Task 2.1:** Description'));
        });

        test('should escape dots properly', () => {
            const pattern = buildTaskPattern('1.1');
            // Should not match 1X1 where X is any character
            assert.ok(!pattern.test('- [ ] **Task 1X1:** Description'));
        });
    });

    suite('markTaskInContent', () => {
        test('should mark task as complete', () => {
            const content = '- [ ] **Task 1.1:** My task';
            const result = markTaskInContent(content, '1.1');

            assert.strictEqual(result, '- [x] **Task 1.1:** My task');
        });

        test('should only mark specified task', () => {
            const content = `- [ ] **Task 1.1:** First
- [ ] **Task 1.2:** Second`;

            const result = markTaskInContent(content, '1.2');

            assert.ok(result?.includes('- [ ] **Task 1.1:**'));
            assert.ok(result?.includes('- [x] **Task 1.2:**'));
        });

        test('should return null for non-existent task', () => {
            const content = '- [ ] **Task 1.1:** My task';
            const result = markTaskInContent(content, '9.9');

            assert.strictEqual(result, null);
        });

        test('should return null for already completed task', () => {
            const content = '- [x] **Task 1.1:** My task';
            const result = markTaskInContent(content, '1.1');

            assert.strictEqual(result, null);
        });

        test('should preserve other content', () => {
            const content = `# Tasks

- [ ] **Task 1.1:** My task

Some notes here`;

            const result = markTaskInContent(content, '1.1');

            assert.ok(result?.startsWith('# Tasks'));
            assert.ok(result?.endsWith('Some notes here'));
        });
    });

    suite('getVenvCandidates', () => {
        test('should return array of candidates', () => {
            const candidates = getVenvCandidates('/workspace');

            assert.ok(Array.isArray(candidates));
            assert.ok(candidates.length > 0);
        });

        test('should include common venv directories', () => {
            const candidates = getVenvCandidates('/workspace');
            const candidateStr = candidates.join(' ');

            // Should check .venv, venv, .env, env
            assert.ok(candidateStr.includes('.venv'));
            assert.ok(candidateStr.includes('/venv/') || candidateStr.includes('\\venv\\'));
        });

        test('should use correct path separator for platform', () => {
            const candidates = getVenvCandidates('/workspace');
            const isWindows = process.platform === 'win32';

            if (isWindows) {
                assert.ok(candidates.some(c => c.includes('Scripts')));
            } else {
                assert.ok(candidates.some(c => c.includes('/bin/')));
            }
        });
    });

    suite('getVenvExecutablePath', () => {
        const isWindows = process.platform === 'win32';

        test('should return correct path for ldf executable', () => {
            const result = getVenvExecutablePath('/project', 'ldf');

            if (isWindows) {
                assert.ok(result.includes('Scripts'));
                assert.ok(result.endsWith('.exe') || result.endsWith('.cmd'));
            } else {
                assert.ok(result.includes('/bin/'));
                assert.ok(result.endsWith('/ldf'));
            }
        });

        test('should return correct path for python executable', () => {
            const result = getVenvExecutablePath('/project', 'python');

            if (isWindows) {
                assert.ok(result.includes('Scripts'));
                assert.ok(result.includes('python'));
            } else {
                assert.ok(result.includes('/bin/python'));
            }
        });

        test('should return correct path for pytest executable', () => {
            const result = getVenvExecutablePath('/project', 'pytest');

            if (isWindows) {
                assert.ok(result.includes('Scripts'));
                assert.ok(result.includes('pytest'));
            } else {
                assert.ok(result.includes('/bin/pytest'));
            }
        });

        test('should use default .venv directory', () => {
            const result = getVenvExecutablePath('/project', 'ldf');
            assert.ok(result.includes('.venv'));
        });

        test('should use custom venv directory when specified', () => {
            const result = getVenvExecutablePath('/project', 'ldf', 'venv');
            assert.ok(result.includes('/venv/') || result.includes('\\venv\\'));
            assert.ok(!result.includes('.venv'));
        });

        test('should handle different venv directory names', () => {
            const envResult = getVenvExecutablePath('/project', 'ldf', '.env');
            assert.ok(envResult.includes('.env'));

            const customResult = getVenvExecutablePath('/project', 'ldf', 'my-venv');
            assert.ok(customResult.includes('my-venv'));
        });
    });

    suite('venvExecutableExists', () => {
        test('should return false for non-existent path', () => {
            const result = venvExecutableExists('/nonexistent/path', 'ldf');
            assert.strictEqual(result, false);
        });

        test('should return false for non-existent executable', () => {
            // Use temp directory that exists but doesn't have a venv
            const result = venvExecutableExists('/tmp', 'ldf');
            assert.strictEqual(result, false);
        });
    });
});

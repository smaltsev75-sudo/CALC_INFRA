/**
 * tests/run.js supports scoped targets so local loops can run only the
 * relevant unit slice while npm test remains the full parallel suite.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const runner = readFileSync(join(ROOT, 'tests/run.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('tests/run.js scoped targets', () => {
    it('collects explicit file/directory targets from CLI args', () => {
        assert.match(runner, /const\s+targets\s*=\s*args\.filter/);
        assert.match(runner, /function\s+collectTarget\(/);
        assert.match(runner, /statSync\(full\)/);
        assert.match(runner, /findTests\(full,\s*\[\]\)/);
    });

    it('keeps full npm test and adds focused scripts', () => {
        assert.equal(pkg.scripts.test, 'node tests/run.js');
        assert.match(pkg.scripts['test:quick'], /tests\/unit\/domain/);
        assert.match(pkg.scripts['test:architecture'], /tests\/unit\/architecture/);
        assert.match(pkg.scripts['test:ui'], /tests\/unit\/ui/);
        assert.match(pkg.scripts['test:integration'], /tests\/integration/);
    });
});

/**
 * Design-tokens (Этап 12.2.2/12.2.3/12.2.4):
 * - css/base.css содержит --space-* и --font-* токены.
 * - css/components.css содержит базовый .pill с модификаторами.
 *
 * Линтер защищает токены от случайного удаления — новые правила должны
 * использовать токены вместо магических px/rem.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const baseCss       = readFileSync(join(REPO_ROOT, 'css', 'base.css'),       'utf8');
const componentsCss = readFileSync(join(REPO_ROOT, 'css', 'components.css'), 'utf8');

describe('Design tokens: spacing (Этап 12.2.2)', () => {
    const tokens = ['--space-1', '--space-2', '--space-3', '--space-4',
                    '--space-5', '--space-6', '--space-8', '--space-10'];
    for (const t of tokens) {
        it(`base.css определяет ${t}`, () => {
            const re = new RegExp(`${t}\\s*:\\s*\\d+px`);
            assert.match(baseCss, re);
        });
    }
});

describe('Design tokens: font-size (Этап 12.2.3)', () => {
    /* После UI-ревью 2026-05-05 крупные токены (lg/xl/2xl) переведены на clamp()
     * для fluid typography. Базовые (xs/sm/base/md) остаются rem-литералами. */
    const fixedTokens = ['--font-xs', '--font-sm', '--font-base', '--font-md'];
    for (const t of fixedTokens) {
        it(`base.css определяет ${t} как фиксированный rem`, () => {
            const re = new RegExp(`${t}\\s*:\\s*[\\d.]+rem`);
            assert.match(baseCss, re);
        });
    }
    const fluidTokens = ['--font-lg', '--font-xl', '--font-2xl'];
    for (const t of fluidTokens) {
        it(`base.css определяет ${t} как clamp() с rem-границами`, () => {
            // clamp(<min-rem>, <preferred>, <max-rem>) — fluid typography.
            const re = new RegExp(`${t}\\s*:\\s*clamp\\(\\s*[\\d.]+rem`);
            assert.match(baseCss, re);
        });
    }
});

describe('Pill component (Этап 12.2.4)', () => {
    it('components.css содержит базовый .pill', () => {
        assert.match(componentsCss, /^\s*\.pill\s*\{/m);
    });

    for (const variant of ['pill-success', 'pill-warn', 'pill-danger', 'pill-info']) {
        it(`components.css содержит модификатор .${variant}`, () => {
            const re = new RegExp(`\\.${variant}\\s*\\{`);
            assert.match(componentsCss, re);
        });
    }

    it('.pill использует spacing-токены вместо магических px', () => {
        const pillBlock = componentsCss.match(/\.pill\s*\{[^}]*\}/);
        assert.ok(pillBlock, '.pill блок должен существовать');
        assert.match(pillBlock[0], /var\(--space-/, '.pill должен использовать --space-* токены');
    });
});

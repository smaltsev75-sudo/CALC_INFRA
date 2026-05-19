/**
 * WCAG 2.3.3 Animation from Interactions:
 * css/base.css обязан содержать @media (prefers-reduced-motion: reduce)
 * блок, обнуляющий длительности анимаций и переходов.
 *
 * Линтер защищает регрессию: если правило случайно удалят, тест падает
 * с понятным сообщением о том, какой именно фрагмент исчез.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAtMediaBody } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const BASE_CSS  = join(REPO_ROOT, 'css', 'base.css');

describe('A11y: prefers-reduced-motion (WCAG 2.3.3)', () => {
    const css = readFileSync(BASE_CSS, 'utf8');

    /* 12.U31 (Code Review Followup, D-P1-2): литералы проверяем ВНУТРИ блока
       @media (prefers-reduced-motion: reduce), а не где-либо в файле. Раньше
       тест использовал `assert.match(css, /animation-duration: 0.01ms/)` —
       false-pass, если правило вынесут наружу @media (что сломает UX, но
       литерал останется в файле). */

    it('css/base.css содержит @media (prefers-reduced-motion: reduce)', () => {
        const block = extractAtMediaBody(css, 'prefers-reduced-motion: reduce');
        assert.ok(block, 'блок @media (prefers-reduced-motion: reduce) должен существовать');
    });

    it('@media-блок обнуляет animation-duration', () => {
        const block = extractAtMediaBody(css, 'prefers-reduced-motion: reduce');
        assert.match(block, /animation-duration\s*:\s*0\.01ms\s*!important/,
            'правило обязано быть ВНУТРИ @media (prefers-reduced-motion: reduce)');
    });

    it('@media-блок обнуляет transition-duration', () => {
        const block = extractAtMediaBody(css, 'prefers-reduced-motion: reduce');
        assert.match(block, /transition-duration\s*:\s*0\.01ms\s*!important/);
    });

    it('@media-блок обнуляет animation-iteration-count', () => {
        const block = extractAtMediaBody(css, 'prefers-reduced-motion: reduce');
        assert.match(block, /animation-iteration-count\s*:\s*1\s*!important/);
    });
});

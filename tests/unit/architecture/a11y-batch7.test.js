/**
 * Batch 7 контракты (Этапы 12.2.6, 12.3.1, 12.3.2):
 *   - css/base.css содержит .skip-link с position:absolute и :focus → top:0.
 *   - css/comparison.css содержит .comparison-export-actions (а не inline-style).
 *   - js/ui/comparison.js НЕ использует inline style: { marginBottom: ... }.
 *   - js/ui/modals/helpModal.js импортирует HOTKEYS — секция «Горячие клавиши».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const baseCss        = readFileSync(join(REPO_ROOT, 'css', 'base.css'),       'utf8');
const comparisonCss  = readFileSync(join(REPO_ROOT, 'css', 'comparison.css'), 'utf8');
const comparisonJs   = readFileSync(join(REPO_ROOT, 'js', 'ui', 'comparison.js'),    'utf8');
const helpModalJs    = readFileSync(join(REPO_ROOT, 'js', 'ui', 'modals', 'helpModal.js'), 'utf8');

describe('Skip-link (Этап 12.3.1, WCAG 2.4.1)', () => {
    it('css/base.css содержит .skip-link с position:absolute', () => {
        assert.match(baseCss, /\.skip-link\s*\{[\s\S]*?position\s*:\s*absolute/);
    });

    it('css/base.css содержит .skip-link:focus → top:0 (становится видимым)', () => {
        assert.match(baseCss, /\.skip-link:focus[\s\S]{0,400}top\s*:\s*0/);
    });
});

describe('Comparison: inline-style вынесен в CSS (Этап 12.3.2)', () => {
    it('css/comparison.css содержит .comparison-export-actions', () => {
        assert.match(comparisonCss, /\.comparison-export-actions\s*\{/);
    });

    it('js/ui/comparison.js НЕ использует inline style: marginBottom', () => {
        assert.doesNotMatch(comparisonJs, /style\s*:\s*\{[^}]*marginBottom/);
    });
});

describe('Help-модалка: секция «Горячие клавиши» (Этап 12.2.6)', () => {
    it('helpModal.js импортирует HOTKEYS из constants', () => {
        assert.match(helpModalJs, /import\s*\{\s*HOTKEYS\s*\}\s*from\s*['"][^'"]*constants\.js['"]/);
    });

    it('helpModal.js рендерит секцию «Горячие клавиши»', () => {
        assert.match(helpModalJs, /Горячие клавиши/);
    });

    it('helpModal.js строит таблицу из HOTKEYS', () => {
        // ищем .map от HOTKEYS как признак рендера всех хоткеев
        assert.match(helpModalJs, /HOTKEYS\.map/);
    });
});

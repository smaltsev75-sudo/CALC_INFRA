/**
 * UI-улучшения после ревью (2026-05-05): @supports фолбэк для backdrop-filter.
 *
 * `backdrop-filter` (CSS Filters Level 2) поддерживается современными браузерами
 * (Chrome 76+, Safari 9+, Firefox 103+, Edge 17+), но в старых WebView и
 * корпоративных средах может отсутствовать. Без размытия фона полупрозрачный
 * overlay/topbar теряет читаемость — фон под ним просвечивает и сливается
 * с текстом.
 *
 * Решение — `@supports not (backdrop-filter: blur(1px)) { ... }` блок,
 * который усиливает непрозрачность фона / делает его полностью непрозрачным
 * для тех браузеров, которые не поддерживают backdrop-filter.
 *
 * Проверяем три места, где backdrop-filter используется:
 *   - .modal-overlay  (modals.css)
 *   - .app-topbar     (layout.css)
 *   - .questionnaire-footer (forms.css)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
function loadCss(rel) {
    return stripCssComments(fs.readFileSync(path.resolve(here, '../../../css', rel), 'utf8'));
}

/* Regex с балансом вложенных скобок: `[^{]+\{` до открывающей `{` body
 * @supports — захватывает условие целиком, включая внутренний `blur(1px)`. */
const ATSUPPORTS_NOT = /@supports\s+not\s*\(\s*backdrop-filter[^{]+\{/;

describe('@supports фолбэк для backdrop-filter', () => {
    it('modals.css содержит @supports not (backdrop-filter) для .modal-overlay', () => {
        const css = loadCss('modals.css');
        // @supports not (backdrop-filter: ...) с правилом .modal-overlay внутри.
        assert.match(css, ATSUPPORTS_NOT,
            'modals.css должен иметь @supports not (backdrop-filter: ...) фолбэк');
        // Найдём body @supports и проверим, что .modal-overlay внутри.
        const startIdx = css.search(ATSUPPORTS_NOT);
        assert.ok(startIdx >= 0);
        // Простой поиск .modal-overlay в части после начала @supports.
        const tail = css.slice(startIdx);
        assert.match(tail, /\.modal-overlay\s*\{/,
            '.modal-overlay должен быть внутри @supports not (backdrop-filter)');
    });

    it('фолбэк modal-overlay усиливает прозрачность фона до ≥0.9', () => {
        const css = loadCss('modals.css');
        const startIdx = css.search(ATSUPPORTS_NOT);
        assert.ok(startIdx >= 0, 'не нашёл @supports в modals.css');
        // Берём содержимое до конца файла — этого достаточно для матчинга rgba.
        const tail = css.slice(startIdx);
        assert.match(tail, /rgba\([^)]*0\.9[\d]*\s*\)/,
            'фолбэк должен усилить непрозрачность фона до ≥0.9 (без blur полупрозрачный фон ' +
            'теряет читаемость и просвечивает контент)');
    });

    it('layout.css содержит @supports not (backdrop-filter) для .app-topbar', () => {
        const css = loadCss('layout.css');
        assert.match(css, ATSUPPORTS_NOT,
            'layout.css должен иметь @supports not (backdrop-filter) фолбэк');
        const startIdx = css.search(ATSUPPORTS_NOT);
        const tail = css.slice(startIdx);
        assert.match(tail, /\.app-topbar\s*\{/,
            '.app-topbar должен быть внутри @supports not (backdrop-filter)');
    });

    it('forms.css содержит @supports not (backdrop-filter) для .questionnaire-footer', () => {
        const css = loadCss('forms.css');
        assert.match(css, ATSUPPORTS_NOT,
            'forms.css должен иметь @supports not (backdrop-filter) фолбэк');
        const startIdx = css.search(ATSUPPORTS_NOT);
        const tail = css.slice(startIdx);
        assert.match(tail, /\.questionnaire-footer\s*\{/,
            '.questionnaire-footer должен быть внутри @supports not (backdrop-filter)');
    });

    it('каждый файл с backdrop-filter имеет соответствующий @supports фолбэк', () => {
        const files = ['modals.css', 'layout.css', 'forms.css'];
        for (const file of files) {
            const css = loadCss(file);
            // Проверяем обычное использование (не -webkit-, не свойство @supports condition).
            const hasFiltered = /[^-]backdrop-filter\s*:/.test(' ' + css);
            if (hasFiltered) {
                assert.match(css, /@supports\s+not\s*\(\s*backdrop-filter/,
                    `${file} использует backdrop-filter, но не имеет @supports not (backdrop-filter) фолбэка`);
            }
        }
    });
});

/**
 * Архитектурный инвариант (PATCH 2.20.5): все `<input type="number">` в UI-слое
 * обязаны иметь `step: 'any'` (или отсутствие step-атрибута — но это рискованно,
 * HTML5-default = step:1 блокирует дробные).
 *
 * Прецедент 2026-05-20: жалоба пользователя «нельзя вводить дробные числа».
 * Корень — SEED-уровневые `step: N` (1/5/10/1000) в renderer'ах number-input
 * передавались напрямую в DOM. HTML5 `:invalid` validation отвергала любое
 * значение, кратное step'у дробью. Замена на `step="any"` снимает это
 * ограничение, min/max валидация продолжает работать.
 *
 * Этот тест предотвращает регрессию: если кто-то через 2 недели добавит новое
 * number-input с `step: 1` (или числовым step), invariant провалится в CI.
 *
 * Что разрешено:
 *   - `step: 'any'`
 *   - `step: 1` ВНУТРИ `<input type="range">` (slider — там это шаг slider'а,
 *     а не валидация дробных). Такие случаи помечаются явным комментарием
 *     `// allow-numeric-step: range-slider`.
 *
 * Что запрещено в production-коде (исключая тесты):
 *   - Любой числовой литерал в `step: N` для `<input type="number">`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(__filename, '..', '..', '..', '..');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (st.isFile() && entry.endsWith('.js')) out.push(full);
    }
    return out;
}

describe('number-input step="any" invariant — все <input type="number"> принимают дробные', () => {
    it('в js/ui/ нет числовых step:N в number-input (кроме range slider)', () => {
        const uiFiles = walk(join(ROOT, 'js', 'ui'));
        const violations = [];

        for (const file of uiFiles) {
            const src = readFileSync(file, 'utf8');
            // Снимаем комментарии: упоминания step:1 в JSDoc легитимны
            // и не должны валить тест. Проверяем только исполняемый код.
            const code = stripJsComments(src);

            /* Ищем все `step: <число>` (с пробелом и без), в любом контексте. */
            const stepRegex = /step\s*:\s*(\d[\d._]*)/g;
            let match;
            while ((match = stepRegex.exec(code)) !== null) {
                const lineStart = code.lastIndexOf('\n', match.index) + 1;
                const lineEnd = code.indexOf('\n', match.index);
                const line = code.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
                /* Whitelist: если ближайший type:'range' в окне 200 символов
                 * до этого `step:N` — это slider, разрешено. */
                const windowStart = Math.max(0, match.index - 400);
                const windowText = code.slice(windowStart, match.index);
                const isRangeSlider = /type\s*:\s*['"]range['"]/.test(windowText);
                if (isRangeSlider) continue;

                violations.push({
                    file: file.replace(ROOT, '').replace(/\\/g, '/'),
                    line: line.trim().slice(0, 100),
                    matched: match[0]
                });
            }
        }

        assert.equal(violations.length, 0,
            'Найдены number-input с числовым step (блокирует дробные). ' +
            'Заменить на `step: \'any\'`:\n' +
            violations.map(v => `  ${v.file}: ${v.matched} → ${v.line}`).join('\n'));
    });

    it('renderNumberInput в questionnaire.js использует step="any" как stepAttr', () => {
        const src = readFileSync(join(ROOT, 'js', 'ui', 'questionnaire.js'), 'utf8');
        const code = stripJsComments(src);
        /* Должна быть строка `const stepAttr = 'any';` или эквивалент. */
        assert.match(code, /stepAttr\s*=\s*['"]any['"]/,
            'renderNumberInput должен явно ставить stepAttr = "any" (не q.step из SEED)');
    });

    it('guidedCompletionModal.js использует step="any" для number-input', () => {
        const src = readFileSync(join(ROOT, 'js', 'ui', 'modals', 'guidedCompletionModal.js'), 'utf8');
        const code = stripJsComments(src);
        assert.match(code, /inputAttrs\.step\s*=\s*['"]any['"]/,
            'guidedCompletionModal renderNumberInput должен ставить inputAttrs.step = "any"');
    });
});

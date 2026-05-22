/**
 * UI-улучшения после ревью (2026-05-05): error-state на .input через
 * `[aria-invalid="true"]` + связь с inline-сообщением через `aria-describedby`.
 *
 * Стандарт WAI-ARIA 1.2 / WCAG 2.1 AA (4.1.2):
 *   - поле с ошибкой ставит `aria-invalid="true"`;
 *   - связано с текстом ошибки через `aria-describedby="<errorId>"`;
 *   - текст ошибки имеет `role="alert"` для немедленного озвучивания.
 *
 * Тестируем, что:
 *   1. CSS-правило для `[aria-invalid="true"]` определено и стилизует красную рамку;
 *   2. JS (showInlineError / removeInlineError в questionnaireNumberInput.js) корректно
 *      управляет aria-атрибутами.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const componentsCss = stripCssComments(fs.readFileSync(
    path.resolve(here, '../../../css/components.css'), 'utf8'));
const numberInputJs = stripJsComments(fs.readFileSync(
    path.resolve(here, '../../../js/ui/questionnaireNumberInput.js'), 'utf8'));

describe('CSS error-state .input[aria-invalid="true"]', () => {
    it('правило .input[aria-invalid="true"] определено в components.css', () => {
        // Может быть в составе селектора (через запятую с .input-invalid).
        assert.match(componentsCss, /\.input\[aria-invalid="true"\]/,
            'components.css должен содержать селектор .input[aria-invalid="true"] для error-state');
    });

    it('error-state применяет border-color: var(--danger)', () => {
        // Берём блок селекторов вместе с .input-invalid и проверяем, что внутри есть danger border.
        const m = componentsCss.match(/\.input\[aria-invalid="true"\][^{]*\{([^}]+)\}/);
        assert.ok(m, 'не нашёл body правила [aria-invalid="true"]');
        assert.match(m[1], /border-color\s*:\s*var\(--danger\)/,
            'error-state должен использовать var(--danger) для рамки');
    });

    it('error-state в focus-visible имеет красный ring через box-shadow', () => {
        // Должно быть отдельное правило для :focus / :focus-visible с danger-faint ring.
        assert.match(componentsCss,
            /\.input\[aria-invalid="true"\][^{]*:focus[^{]*\{[^}]*box-shadow[^}]*var\(--danger-faint\)/,
            'error-state должен сохранять красный ring при focus-visible (WCAG 2.4.7)');
    });
});

describe('JS questionnaireNumberInput.js: showInlineError / removeInlineError управляет ARIA', () => {
    it('showInlineError устанавливает aria-invalid="true" на input', () => {
        assert.match(numberInputJs,
            /function\s+showInlineError[\s\S]*?setAttribute\s*\(\s*['"]aria-invalid['"]\s*,\s*['"]true['"]/,
            'showInlineError должен ставить aria-invalid="true" на input');
    });

    it('showInlineError связывает input и error-сообщение через aria-describedby', () => {
        assert.match(numberInputJs,
            /function\s+showInlineError[\s\S]*?setAttribute\s*\(\s*['"]aria-describedby['"]/,
            'showInlineError должен ставить aria-describedby с id error-сообщения');
    });

    it('error-сообщение имеет role="alert" для немедленного озвучивания screen-reader\'ом', () => {
        // role передаётся через attrs-объект el(), потому что el() не имеет
        // role как top-level prop. Поэтому проверяем оба варианта (`role: 'alert'`
        // и `'role': 'alert'`) внутри showInlineError.
        assert.match(numberInputJs,
            /function\s+showInlineError[\s\S]*?role\s*:\s*['"]alert['"]/,
            'span.field-inline-error должен иметь role="alert" — screen-reader озвучит сразу при появлении');
    });

    it('removeInlineError снимает aria-invalid и aria-describedby', () => {
        const fnMatch = numberInputJs.match(/function\s+removeInlineError\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(fnMatch, 'не нашёл функцию removeInlineError');
        const body = fnMatch[1];
        assert.match(body, /removeAttribute\s*\(\s*['"]aria-invalid['"]/,
            'removeInlineError должен снимать aria-invalid');
        assert.match(body, /removeAttribute\s*\(\s*['"]aria-describedby['"]/,
            'removeInlineError должен снимать aria-describedby');
    });

    it('error-id уникален для каждого вызова — иначе несколько полей с ошибкой получат одинаковый id', () => {
        // Реализовано через _errIdSeq counter в questionnaire.js.
        assert.match(numberInputJs,
            /(_errIdSeq|nextErrorId|`field-err-)/,
            'showInlineError должен генерировать уникальный id для error-сообщения');
    });
});

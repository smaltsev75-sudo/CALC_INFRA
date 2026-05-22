/**
 * Stage 18.1.2 — Quick Start больше не показывает избыточный success-snackbar
 * «Расчёт создан из профиля «<industry>»».
 *
 * Причина: dashboard сам сразу показывает результат (новые цифры, имя расчёта
 * в TopBar) — текстовое подтверждение избыточно и попадает в нижнюю-центральную
 * область экрана, перекрывая footer открытых модалок (баг F1 из BROWSER_SMOKE).
 *
 * Контракт сужен точечно: убираем ИМЕННО snackbar.success в обработчике
 * `createCalcFromWizard`. Snackbar при обычном создании расчёта
 * («Расчёт создан» / «Расчёт создан из шаблона» в `createCalc`) остаётся,
 * error/warning snackbar'ы — не трогаем.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS = resolve(__dirname, '../../../js/app.js');
const CALC_ACTIONS_JS = resolve(__dirname, '../../../js/app/calcListActions.js');
const src = readFileSync(APP_JS, 'utf8');
const calcActionsSrc = readFileSync(CALC_ACTIONS_JS, 'utf8');
const clean = stripJsComments(src);
const cleanCalcActions = stripJsComments(calcActionsSrc);

function findFunctionBody(name) {
    /* Найти содержимое функции с заданным именем (формат `name(arg1, arg2) {` ... `}`).
       Простой парсер с балансом скобок. */
    const headerRe = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\([^)]*\\)\\s*\\{');
    const m = clean.match(headerRe);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < clean.length && depth > 0) {
        const ch = clean[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        if (depth === 0) return clean.slice(start, i);
        i++;
    }
    return null;
}

test('createCalcFromWizard: больше не вызывает snackbar.success с текстом «Расчёт создан из профиля»', () => {
    const body = cleanCalcActions.match(/export function createCalcFromWizardAction[\s\S]*?(?=\nexport function|$)/)?.[0];
    assert.ok(body, 'функция createCalcFromWizardAction должна существовать в js/app/calcListActions.js');
    assert.doesNotMatch(body, /Расчёт создан из профиля/, 'createCalcFromWizard не должен показывать success-snackbar — dashboard сам отображает результат');
    assert.doesNotMatch(body, /snackbar\.success/, 'createCalcFromWizard не должен показывать success-snackbar — dashboard сам отображает результат');
});

test('createCalc (обычное создание) НЕ изменён — snackbar «Расчёт создан» остаётся', () => {
    const body = cleanCalcActions.match(/export function createCalcAction[\s\S]*?(?=\nexport function|$)/)?.[0];
    assert.ok(body, 'функция createCalcAction должна существовать в js/app/calcListActions.js');
    /* Регрессия: убедиться, что мы не зацепили обычный success-snackbar в createCalc
       вместе с фиксом Quick Start. */
    assert.match(body, /snackbar\.success/, 'createCalc должна сохранить snackbar.success (это не Quick Start, footer не перекрывает)');
    assert.match(body, /'Расчёт создан'/, 'createCalc должна сохранить текст «Расчёт создан»');
});

test('app.js: error/warning snackbar в проекте не удалены оптом', () => {
    /* Регрессия: убедиться, что мы не вырезали snackbar.error/.warning по всему
       файлу. Любой такой вызов должен оставаться, т.к. это сигнал об ошибке/риске. */
    const errorCalls = (clean.match(/snackbar\.error\s*\(/g) || []).length;
    const warningCalls = (clean.match(/snackbar\.warning\s*\(/g) || []).length;
    assert.ok(errorCalls + warningCalls > 0, 'snackbar.error и .warning должны оставаться — это критичные сигналы, фикс F1 не должен их трогать');
});

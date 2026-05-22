/**
 * PATCH 2.14.17 — UI / source-tests для рендера description + units
 * в модалке Cost Optimization Planner.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stripJsComments, ruleBody } from '../../_helpers/source.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..', '..');

function read(rel) {
    return readFileSync(resolve(ROOT, rel), 'utf8');
}

function readPlannerModalParts() {
    return [
        'js/ui/modals/costOptimizationPlannerModal.js',
        'js/ui/modals/costOptimizationPlannerModalControls.js',
        'js/ui/modals/costOptimizationPlannerModalFormat.js',
        'js/ui/modals/costOptimizationPlannerModalLevers.js',
        'js/ui/modals/costOptimizationPlannerModalSummary.js'
    ].map(read).join('\n');
}

/* ----------------- renderLeverItem рендерит description ----------------- */

test('renderLeverItem вставляет элемент .cop-lever-description с lever.description', () => {
    const src = stripJsComments(readPlannerModalParts());
    const fnStart = src.indexOf('function renderLeverItem(');
    assert.ok(fnStart > 0, 'функция renderLeverItem не найдена');
    const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
    const fn = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 3000);
    // должен быть el('p', { class: 'cop-lever-description', ...})
    assert.match(
        fn, /'cop-lever-description'/,
        'renderLeverItem должен использовать класс cop-lever-description'
    );
    // и обращаться к lever.description
    assert.match(fn, /lever\.description/, 'renderLeverItem должен читать lever.description');
});

test('renderLeverItem НЕ рендерит description, если он пустой', () => {
    const src = stripJsComments(readPlannerModalParts());
    const fnStart = src.indexOf('function renderLeverItem(');
    const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
    const fn = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 3000);
    // ожидаем условный рендер вида descShort ? el(...) : null
    assert.match(
        fn, /descShort\s*\?\s*el\(|description.*\?\s*el\(/,
        'description-блок должен рендериться условно (пустой → null), не как обязательный элемент'
    );
});

/* ----------------- formatValueShort использует lever.unit ----------------- */

test('formatValueShort читает lever.unit', () => {
    const src = stripJsComments(readPlannerModalParts());
    const fnStart = src.indexOf('function formatValueShort(');
    assert.ok(fnStart > 0);
    const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
    const fn = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 3000);
    assert.match(fn, /lever\??\.unit/, 'formatValueShort должен использовать lever.unit');
});

test('formatValueShort: percent editor + unit «% от ПРОМ» → выводит «X % от ПРОМ»', async () => {
    // Косвенный тест через source-grep — формат строки.
    const src = stripJsComments(readPlannerModalParts());
    const fnStart = src.indexOf('function formatValueShort(');
    const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
    const fn = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 3000);
    assert.match(
        fn, /% от ПРОМ/,
        'formatValueShort должен поддерживать unit «% от ПРОМ» для stand ratios'
    );
});

test('formatValueShort: planningHorizonYears → склонение год/года/лет', () => {
    const src = stripJsComments(readPlannerModalParts());
    // Helper pluralYears должен существовать в файле
    assert.match(src, /function pluralYears\(/, 'должен быть helper pluralYears');
    // Используется в formatValueShort для planningHorizonYears
    const fnStart = src.indexOf('function formatValueShort(');
    const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
    const fn = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 3000);
    assert.match(fn, /pluralYears|setting:planningHorizonYears/);
});

/* ----------------- CSS .cop-lever-description присутствует и стиль muted ----------------- */

test('CSS .cop-lever-description определён с приглушённым цветом', () => {
    const body = ruleBody(read('css/dashboard.css'), '.cop-lever-description');
    assert.match(body, /color:\s*var\(--text-muted\)/,
        '.cop-lever-description должен использовать var(--text-muted)');
    assert.match(body, /font-size:/, '.cop-lever-description должен иметь font-size');
});

/* ----------------- Architecture: domain → UI flow ----------------- */

test('buildEditableLevers возвращает description + unit поля на каждом lever', () => {
    const src = stripJsComments(read('js/domain/costOptimizationPlanner.js'));
    const fnStart = src.indexOf('export function buildEditableLevers(');
    assert.ok(fnStart > 0);
    // В out.push({...}) должны быть description и unit поля
    const fnEnd = src.indexOf('\n/* ', fnStart + 1);
    const fn = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 5000);
    assert.match(fn, /description:\s*resolveLeverDescription\(/,
        'buildEditableLevers должен включать description через resolveLeverDescription');
    assert.match(fn, /unit:\s*deriveLeverUnit\(/,
        'buildEditableLevers должен включать unit через deriveLeverUnit');
});

test('metadata-first: resolveLeverDescription выше fallback в управляющем потоке', () => {
    const src = stripJsComments(read('js/domain/costOptimizationPlanner.js'));
    const fnStart = src.indexOf('export function resolveLeverDescription(');
    assert.ok(fnStart > 0);
    const fnEnd = src.indexOf('\nexport ', fnStart + 1);
    const fn = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 2000);
    // SETTINGS_DESCRIPTIONS должен быть проверен ДО `spec.description || ''`
    const idxMeta = fn.indexOf('SETTINGS_DESCRIPTIONS');
    const idxAnswer = fn.indexOf('questions.find');
    const idxFallback = fn.indexOf('spec.description');
    assert.ok(idxMeta > 0 && idxAnswer > 0 && idxFallback > 0,
        'все три ветки должны присутствовать');
    assert.ok(idxMeta < idxFallback,
        'SETTINGS_DESCRIPTIONS должен проверяться ДО fallback на spec.description');
    assert.ok(idxAnswer < idxFallback,
        'questions.description должен проверяться ДО fallback на spec.description');
});

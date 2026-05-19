/**
 * PATCH 2.14.15 — Resource-row value: flex-column парная AI-метрикам
 *
 * Симптом: длинные mono-значения «9 068,76 ТБ» / «1 589,99 ТБ» выходили за
 * границы ячейки `.dash-resource-row` в Hero (auto-fit minmax(56px, 1fr))
 * и в стенд-карточках. Причина — `inline-flex; align-items: baseline` на
 * .dash-resource-row-value: не shrink'ался ниже intrinsic min-content, unit
 * не переносился на новую строку.
 *
 * Решение — перенос paтterna от .dash-ai-metric-row-value (PATCH 2.4.36):
 *   display: flex; flex-direction: column; align-items: flex-start; gap: 0;
 *   min-width: 0;
 *
 * Инвариант: hardware-resource и AI-metric value-блоки должны иметь
 * идентичную layout-модель, чтобы сетка дашборда читалась единообразно
 * (Hero и стенд-карточки используют оба блока бок-о-бок).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ruleBody } from '../../_helpers/source.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..', '..');

function read(rel) {
    return readFileSync(resolve(ROOT, rel), 'utf8');
}

/* ----------------- flex-column паттерн ----------------- */

test('.dash-resource-row-value использует flex-direction: column', () => {
    const body = ruleBody(read('css/dashboard.css'), '.dash-resource-row-value');
    assert.match(body, /display:\s*flex\b/, '.dash-resource-row-value должен быть display: flex');
    assert.match(body, /flex-direction:\s*column/, '.dash-resource-row-value должен быть flex-direction: column');
});

test('.dash-resource-row-value не использует inline-flex / align-items: baseline', () => {
    const body = ruleBody(read('css/dashboard.css'), '.dash-resource-row-value');
    assert.equal(
        /display:\s*inline-flex/.test(body), false,
        '.dash-resource-row-value не должен быть inline-flex (PATCH 2.14.15: длинные числа выходили за border)'
    );
    assert.equal(
        /align-items:\s*baseline/.test(body), false,
        '.dash-resource-row-value не должен быть align-items: baseline (qty/unit должны стекаться в колонку)'
    );
});

test('.dash-resource-row-value имеет min-width: 0 (разрешает шринк ниже min-content)', () => {
    const body = ruleBody(read('css/dashboard.css'), '.dash-resource-row-value');
    assert.match(
        body, /min-width:\s*0/,
        '.dash-resource-row-value должен иметь min-width: 0 — иначе flex-item ' +
        'не шринкается ниже intrinsic min-content, и длинные mono-числа всё ' +
        'равно выходят за border ячейки'
    );
});

/* ----------------- паритет layout с AI-метрикой ----------------- */

test('parity: .dash-resource-row-value и .dash-ai-metric-row-value имеют одинаковую layout-модель', () => {
    const src = read('css/dashboard.css');
    const hw = ruleBody(src, '.dash-resource-row-value');
    const ai = ruleBody(src, '.dash-ai-metric-row-value');

    // Обе должны быть flex-column с align-items: flex-start и min-width: 0
    for (const [name, body] of [['hardware', hw], ['ai', ai]]) {
        assert.match(body, /display:\s*flex\b/, `${name}: display: flex`);
        assert.match(body, /flex-direction:\s*column/, `${name}: flex-direction: column`);
        assert.match(body, /align-items:\s*flex-start/, `${name}: align-items: flex-start`);
        assert.match(body, /min-width:\s*0/, `${name}: min-width: 0`);
    }
});

/* ----------------- tabular-nums сохранён на qty ----------------- */

test('.dash-resource-row-qty имеет tabular-nums (выравнивание разрядов)', () => {
    const body = ruleBody(read('css/dashboard.css'), '.dash-resource-row-qty');
    assert.match(
        body, /font-variant-numeric:\s*tabular-nums/,
        '.dash-resource-row-qty должен иметь tabular-nums — иначе разряды в ' +
        'столбцах ресурсов разъезжаются'
    );
});

/* ----------------- Hero-override ----------------- */

test('Hero override: .dash-card-hero .dash-resource-row-value центрирует qty/unit', () => {
    const body = ruleBody(read('css/dashboard.css'), '.dash-card-hero .dash-resource-row-value');
    // qty («9 068,76») заметно шире unit («ТБ») — без align-items: center
    // qty/unit стекались бы flush-left относительно блока, центрированного
    // в Hero parent'е, и unit визуально съезжал бы влево.
    assert.match(
        body, /align-items:\s*center/,
        '.dash-card-hero .dash-resource-row-value должен иметь align-items: center ' +
        'для визуального центрирования qty/unit относительно друг друга в Hero'
    );
});

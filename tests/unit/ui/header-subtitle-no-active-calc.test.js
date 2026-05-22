/**
 * Пользователь (2026-05-18): убрать строку «Создайте или откройте расчёт
 * во вкладке «Расчёты» · Калькулятор инфраструктуры» — она выводилась как
 * subtitle в topbar когда нет активного расчёта.
 *
 * Контракт:
 *   - При !state.activeCalc — subtitle НЕ рендерится (только titleText).
 *   - При state.activeCalc — subtitle «Текущий расчёт · » рендерится (как раньше).
 *   - В исходнике header.js нет литерала «Создайте или откройте расчёт во вкладке».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const headerSrc = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'header.js'),
    'utf8'
);

describe('header при !activeCalc: весь блок title скрыт (2026-05-18, повтор)', () => {
    it('header.js не содержит литерал «Создайте или откройте расчёт во вкладке»', () => {
        assert.ok(
            !headerSrc.includes('Создайте или откройте расчёт во вкладке'),
            'Литерал subtitle для пустого state должен быть удалён из header.js'
        );
    });

    it('header.js не содержит fallback-литерал «Калькулятор инфраструктуры» в title', () => {
        /* Sidebar (sidebar.js) уже выводит «Калькулятор инфраструктуры v2.x.x»
         * как logo. Повторение в topbar = дубль, пользователь явно отказал. */
        assert.ok(
            !headerSrc.includes("'Калькулятор инфраструктуры'"),
            'fallback-title «Калькулятор инфраструктуры» в topbar дублирует sidebar logo — удалён'
        );
    });

    it('subtitle для активного расчёта («Текущий расчёт») остаётся', () => {
        /* Регресс-якорь: при активном calc subtitle всё ещё выводится. */
        assert.ok(
            headerSrc.includes('Текущий расчёт'),
            'subtitle «Текущий расчёт» должен оставаться для непустого state'
        );
    });

    it('renderHeader структура: topbar-title рендерится через `calc && el(...)` — не безусловно', () => {
        /* Гарантия что title-блок завёрнут в conditional (calc &&), а не
         * безусловный el('div', ..., titleText). */
        const renderFnStart = headerSrc.indexOf('export function renderHeader');
        const fnSrc = headerSrc.slice(renderFnStart, renderFnStart + 1500);
        assert.match(fnSrc, /calc\s*&&\s*el\('div',\s*\{\s*class:\s*'app-topbar-title'/,
            'topbar-title должен быть обёрнут в `calc && el(...)` для пустого-state-гайда');
    });
});

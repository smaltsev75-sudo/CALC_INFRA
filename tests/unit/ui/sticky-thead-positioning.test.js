/**
 * Regression-тесты к 12.U30 (1.4c): sticky-thead и sticky-totals в больших
 * таблицах прилипают ПОД sticky `.app-topbar` (z-index 40, ~60px высоты).
 *
 * Корень проблемы был двоякий:
 *   1. `.details-table thead th { top: 0 }` → thead прилипал к top:0 viewport,
 *      но визуально закрывался app-topbar (z-index выше). Решение — `top:
 *      var(--topbar-height)`.
 *   2. `.app-main { overflow-x: hidden }` через CSS-spec автоматически делает
 *      `overflow-y: auto` → создаёт scroll-context → sticky привязывается к
 *      .app-main, а не к viewport, и уезжает вверх вместе с body-scroll.
 *      Решение — убрать любой overflow с .app-main.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseCss   = readFileSync(join(__dirname, '..', '..', '..', 'css', 'base.css'),    'utf8');
const layoutCss = readFileSync(join(__dirname, '..', '..', '..', 'css', 'layout.css'),  'utf8');
const tablesCss = readFileSync(join(__dirname, '..', '..', '..', 'css', 'tables.css'),  'utf8');
const cmpCss    = readFileSync(join(__dirname, '..', '..', '..', 'css', 'comparison.css'), 'utf8');

function ruleBody(src, selector) {
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}');
    const m = src.match(re);
    if (!m) throw new Error(`CSS-правило ${selector} не найдено`);
    return m[1];
}

describe('Sticky thead/totals — позиция под app-topbar (12.U30 1.4c)', () => {
    it('--topbar-height объявлен в :root в base.css', () => {
        assert.match(baseCss, /--topbar-height:\s*\d+px/,
            'переменная --topbar-height нужна для расчёта sticky-top больших таблиц');
    });

    it('.app-main НЕ имеет overflow-x: hidden (создаёт scroll-context, ломает sticky)', () => {
        const body = ruleBody(layoutCss, '.app-main');
        assert.doesNotMatch(body, /overflow-x:\s*hidden/,
            '.app-main { overflow-x: hidden } автоматически делает overflow-y: auto, ' +
            'из-за чего sticky-thead привязывается к .app-main, а не к viewport, ' +
            'и уезжает вверх вместе с body-scroll. См. CSS-spec для overflow-x.');
        assert.doesNotMatch(body, /overflow-y:\s*(auto|scroll|hidden)/,
            '.app-main НЕ должен иметь overflow-y ≠ visible — иначе sticky сломается');
    });

    it('.details-table thead th прилипает к top: var(--topbar-height) (НЕ top: 0)', () => {
        const body = ruleBody(tablesCss, '.details-table thead th');
        assert.match(body, /position:\s*sticky/, 'должна быть position: sticky');
        assert.match(body, /top:\s*var\(--topbar-height\)/,
            'top должен быть var(--topbar-height) — иначе thead закрывается app-topbar (z=40)');
    });

    it('.details-table totals-row-grand прилипает под header-row (topbar + 60px)', () => {
        const body = ruleBody(tablesCss, '.details-table .details-thead-row-totals-grand td');
        // 13.U10-fix: header-row реально до 60px из-за 2-line wrap «ИТОГО / МЕС»
        // и «ТИП РАСХОДА». 56→60 даёт запас, чтобы строка ИТОГО не обрезалась
        // сверху, если шапка чуть подросла (font/padding/word-break).
        assert.match(body, /top:\s*calc\(var\(--topbar-height\)\s*\+\s*60px\)/,
            'totals-grand должен прилипать ПОД header-row, с учётом topbar и реальной высоты header (60px)');
    });

    it('.details-table totals-row-capex и opex имеют корректные смещения', () => {
        const capex = ruleBody(tablesCss, '.details-table .details-thead-row-totals-capex td');
        const opex  = ruleBody(tablesCss, '.details-table .details-thead-row-totals-opex td');
        assert.match(capex, /top:\s*calc\(var\(--topbar-height\)\s*\+\s*60px\s*\+\s*26px\)/,
            'totals-capex top = topbar + 60 + 26 (header + grand)');
        assert.match(opex, /top:\s*calc\(var\(--topbar-height\)\s*\+\s*60px\s*\+\s*26px\s*\+\s*22px\)/,
            'totals-opex top = topbar + 60 + 26 + 22 (header + grand + capex)');
    });

    it('.items-table thead th и .questions-table thead th — top: var(--topbar-height)', () => {
        // 12.U30-fix: sticky перенесён с <thead> на каждый <th> (Chrome нестабилен на thead).
        const re = /\.items-table thead th,\s*\.questions-table thead th\s*\{([^}]+)\}/;
        const m = tablesCss.match(re);
        assert.ok(m, 'должно быть общее правило .items-table thead th, .questions-table thead th');
        assert.match(m[1], /position:\s*sticky/, 'th должен быть sticky');
        assert.match(m[1], /top:\s*var\(--topbar-height\)/,
            'sticky-thead Элементов и Вопросов должен прилипать под app-topbar');
    });

    it('comparison-table-unified: 3 яруса используют var(--topbar-height) в top', () => {
        const l1 = ruleBody(cmpCss, '.comparison-table-unified thead th.cmp-th-l1');
        const l2 = ruleBody(cmpCss, '.comparison-table-unified thead th.cmp-th-l2');
        const l3 = ruleBody(cmpCss, '.comparison-table-unified thead th.cmp-th-l3');
        assert.match(l1, /top:\s*var\(--topbar-height\)/,
            'ярус 1 (header) должен прилипать к topbar-height');
        assert.match(l2, /top:\s*calc\(var\(--topbar-height\)\s*\+\s*var\(--cmp-row-h\)\)/,
            'ярус 2 (Стоимость/мес) — topbar + 1 row');
        assert.match(l3, /top:\s*calc\(var\(--topbar-height\)\s*\+\s*var\(--cmp-row-h\)\s*\*\s*2\)/,
            'ярус 3 (Стоимость/год) — topbar + 2 rows');
    });
});

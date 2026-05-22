/**
 * Regression-тест к 12.U31 (Code Review Followup, Subagent C P1-001):
 * `.comparison-table-wrap` НЕ должен создавать scroll-context.
 *
 * Та же ловушка что для `.app-main` (12.U30 1.4c) и `.items-table-wrap`
 * (12.U30 1.5e): любое `overflow ≠ visible` на ancestor sticky-thead
 * по CSS-spec автоматически активирует overflow-y → создаёт scroll-context →
 * sticky-th привязывается к wrap, а не к viewport, и при body-scroll
 * уезжает вверх вместе с таблицей.
 *
 * Sticky 3-ярусного thead в Сравнении (12.U28) реально сломан в браузере:
 * Playwright-аудит показал thL1Top = -850px при scrollY=1200.
 * Фикс — убрать `overflow-x: auto` с `.comparison-table-wrap`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cmpCss = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'comparison.css'),
    'utf8'
);

import { ruleBody } from '../../_helpers/source.js';

describe('comparison-table-wrap: НЕ scroll-context (sticky-thead зависит от viewport)', () => {
    it('.comparison-table-wrap НЕ имеет overflow / overflow-x / overflow-y ≠ visible', () => {
        const body = ruleBody(cmpCss, '.comparison-table-wrap');
        assert.doesNotMatch(body, /overflow(-x|-y)?\s*:\s*(auto|scroll|hidden)/,
            'overflow на .comparison-table-wrap создаёт scroll-context → sticky-thead ' +
            'привязывается к wrap, а не к viewport, и не подъезжает под app-topbar. ' +
            'Та же ловушка, что было с .app-main (12.U30 1.4c) и .items-table-wrap (12.U30 1.5e).');
    });
});

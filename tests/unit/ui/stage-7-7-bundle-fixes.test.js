/**
 * PATCH 2.4.35 — Bundle of 4 user-reported UI fixes:
 *
 *   1. AI-метрики на Hero — 2×2 раскладка, не 3+1.
 *      .dash-card-hero .dash-ai-metrics-grid Hero-override raньше использовал
 *      auto-fit minmax(140px, 1fr) и давал «обрубок» 3+1 на широком Hero.
 *      Базовое .dash-ai-metrics-grid (PATCH 2.4.30) уже было 2×2, но более
 *      специфичный селектор перебивал каскад. Пользователь просил трижды.
 *
 *   2. AI-нагрузка стенды — порядок ПРОМ ↔ Нагрузка переставлен.
 *      Раньше: DEV / IFT / PSI / PROD / LOAD. Теперь: DEV / IFT / PSI / LOAD
 *      / PROD. ПРОМ читается как финальный эталон, к которому стремятся
 *      остальные (естественный лево-направо порядок жизненного цикла стенда).
 *
 *   3. Description top-aligned в .questionnaire-grid .field.
 *      align-self: end → align-self: start. Раньше end прижимал desc к низу
 *      stretched cell — между полями с 1-line и 2-line descriptions создавался
 *      visual gap у короткой desc (она «отлетала» от своего поля).
 *
 *   4. Details horizontal scroll — убран min-width: 0 с .app-main-col.
 *      Раньше .app-main-col мог сжиматься ниже min-content children (Details
 *      с 16-17 колонками nowrap-цифрами). Body не получал overflow → правые
 *      колонки клипались внутри fixed-width main-col без возможности до них
 *      доскроллить. PATCH 2.4.31 снял overflow-x:hidden с body, но без снятия
 *      min-width:0 — half-fix.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments, ruleBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PATCH 2.4.35 / fix #1 — Hero AI-metrics 2×2', () => {
    const dashboardCss = read('css/dashboard.css');

    it('.dash-card-hero .dash-ai-metrics-grid использует repeat(2, ...) — не auto-fit', () => {
        const body = ruleBody(dashboardCss, '.dash-card-hero .dash-ai-metrics-grid');
        assert.match(body,
            /grid-template-columns:\s*repeat\(\s*2\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/,
            'Hero-override должен фиксировать 2 колонки (repeat(2, minmax(0, 1fr)))');
        assert.doesNotMatch(body, /auto-fit/,
            'auto-fit удалён — давал 3+1 при 4 AI-метриках на широком Hero');
    });
});

describe('PATCH 2.4.35 / fix #2 — AI stand-factors order', () => {
    const js = stripJsComments(read('js/ui/questionnaireStandSettings.js'));

    it('renderAiStandFactors располагает PROD ПОСЛЕ LOAD', () => {
        const fnStart = js.indexOf('function renderAiStandFactors');
        assert.ok(fnStart > 0, 'renderAiStandFactors должна существовать');
        const fnEnd = js.indexOf('\nfunction ', fnStart + 30);
        const body = js.slice(fnStart, fnEnd > 0 ? fnEnd : js.length);

        // Старый паттерн: ordered = [...fields.slice(0, 3), prodField, fields[3]]
        // → DEV/IFT/PSI/PROD/LOAD. PATCH 2.4.35 убирает .slice — prodField в конце.
        assert.doesNotMatch(body,
            /ordered\s*=\s*\[\s*\.\.\.\s*fields\.slice\s*\(\s*0\s*,\s*3\s*\)\s*,\s*prodField\s*,\s*fields\[3\]\s*\]/,
            'старый порядок DEV/IFT/PSI/PROD/LOAD не должен сохраняться');
        assert.match(body,
            /ordered\s*=\s*\[\s*\.\.\.\s*fields\s*,\s*prodField\s*\]/,
            'новый порядок: spread fields (DEV/IFT/PSI/LOAD) затем prodField — PROM в конце');
    });
});

describe('PATCH 2.4.35 / fix #3 — questionnaire description top-aligned', () => {
    const formsCss = read('css/forms.css');

    it('.questionnaire-grid .field > .field-description имеет align-self: start', () => {
        const body = ruleBody(formsCss, '.questionnaire-grid .field > .field-description');
        assert.match(body, /align-self:\s*start\b/,
            'description top-aligned (PATCH 2.4.35) — desc сразу под input');
        assert.doesNotMatch(body, /align-self:\s*end\b/,
            'align-self: end удалён — создавал visual gap при разной высоте siblings');
    });
});

describe('PATCH 2.4.35 / fix #4 — details horizontal scroll via .app-main-col', () => {
    const layoutCss = stripCssComments(read('css/layout.css'));

    it('.app-main-col НЕ содержит min-width: 0', () => {
        const body = ruleBody(layoutCss, '.app-main-col');
        assert.doesNotMatch(body, /min-width:\s*0\b/,
            'min-width: 0 удалён — он не давал .app-main-col расти под широкий Details (16-17 колонок); body не получал horizontal overflow');
    });

    it('.app-main-col сохраняет flex: 1 + flex-direction: column (regression-guard)', () => {
        const body = ruleBody(layoutCss, '.app-main-col');
        assert.match(body, /flex:\s*1\b/, 'flex: 1 не должен быть удалён');
        assert.match(body, /flex-direction:\s*column/, 'flex-direction: column не должен быть удалён');
    });
});

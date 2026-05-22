/**
 * Stage 7.X (PATCH 2.4.25) — Highlight top-expensive ЭК per category
 * в блоке «Тарифы провайдера».
 *
 * Renderer-level source-grep тесты:
 *   • renderProviderPriceSummary вычисляет max value по rows runtime
 *     (без мутации module-scope PROVIDER_PRICE_CATEGORIES).
 *   • Класс is-top-expensive применяется conditionally к row, чьё
 *     value === maxValue.
 *   • При rows.length < 2 подсветка не применяется (нечего сравнивать —
 *     одиночная позиция не требует scan-anchor).
 *   • CSS правило использует var(--accent) + font-weight: 600 (адаптация
 *     к dark/light темам автоматическая).
 *   • Подсветка живёт только в expanded-ветке (collapsed early-return
 *     до неё, .provider-price-row там не рендерится вообще).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, stripCssComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function extractRenderProviderBody(src) {
    const fnStart = src.indexOf('function renderProviderPriceSummary');
    assert.ok(fnStart > 0, 'renderProviderPriceSummary должна существовать');
    const fnEnd = src.indexOf('\nfunction ', fnStart + 30);
    return src.slice(fnStart, fnEnd > 0 ? fnEnd : src.length);
}

describe('Stage 7.X / Provider price — top-expensive highlight', () => {
    const js = stripJsComments(read('js/ui/providerPriceSummary.js'));
    const css = stripCssComments(read('css/forms.css'));

    it('renderProviderPriceSummary вычисляет maxValue runtime через Math.max', () => {
        const body = extractRenderProviderBody(js);
        assert.match(body,
            /const\s+maxValue\s*=\s*rows\.length\s*>\s*1\s*\?\s*Math\.max\s*\(\s*\.\.\.rows\.map\s*\(\s*r\s*=>\s*r\.value\s*\)\s*\)\s*:\s*null/,
            'maxValue должен быть Math.max(...rows.map(r=>r.value)) при rows.length>1, иначе null'
        );
    });

    it('isTopExpensive вычисляется корректно (maxValue !== null && r.value === maxValue)', () => {
        const body = extractRenderProviderBody(js);
        assert.match(body,
            /isTopExpensive\s*=\s*maxValue\s*!==\s*null\s*&&\s*r\.value\s*===\s*maxValue/,
            'формула должна явно проверять non-null maxValue + равенство значений'
        );
    });

    it('класс is-top-expensive применяется к li через массив-форму class', () => {
        const body = extractRenderProviderBody(js);
        assert.match(body,
            /class:\s*\[\s*['"]provider-price-row['"]\s*,\s*isTopExpensive\s*&&\s*['"]is-top-expensive['"]\s*\]/,
            'class должен быть массивом ["provider-price-row", isTopExpensive && "is-top-expensive"]'
        );
    });

    it('подсветка не применяется к категориям с одной строкой', () => {
        const body = extractRenderProviderBody(js);
        assert.match(body, /rows\.length\s*>\s*1\s*\?\s*Math\.max/,
            'guard rows.length > 1 защищает от подсветки одиночных позиций');
    });

    it('CSS правило .provider-price-row.is-top-expensive использует var(--accent)', () => {
        assert.match(css,
            /\.provider-price-row\.is-top-expensive[\s\S]{0,400}?color:\s*var\(--accent\)/,
            'правило должно ссылаться на --accent (адаптация к dark/light темам)'
        );
    });

    it('CSS правило применяет font-weight: 600 (визуальное выделение)', () => {
        assert.match(css,
            /\.provider-price-row\.is-top-expensive[\s\S]{0,400}?font-weight:\s*600/,
            'font-weight: 600 для визуального выделения top-expensive строки'
        );
    });

    it('правило таргетит и .provider-price-row-name, и .provider-price-row-value', () => {
        // Оба child-span'а получают accent — пара «лейбл + цена» читается
        // как одна выделенная строка, не дробится по полу-строке.
        assert.match(css,
            /\.provider-price-row\.is-top-expensive\s+\.provider-price-row-name[\s\S]*?\.provider-price-row\.is-top-expensive\s+\.provider-price-row-value/,
            'оба дочерних селектора (-name и -value) должны быть в правиле'
        );
    });

    it('подсветка живёт только в expanded-ветке (collapsed early-return до неё)', () => {
        const body = extractRenderProviderBody(js);
        const earlyReturn = body.indexOf('if (!expanded)');
        assert.ok(earlyReturn > 0, 'функция должна early-return при !expanded');
        // Берём блок от if (!expanded) до его }, плюс немного буфера.
        const collapsedSection = body.slice(earlyReturn, earlyReturn + 200);
        assert.doesNotMatch(collapsedSection, /is-top-expensive/,
            'is-top-expensive не должно фигурировать в collapsed-ветке (там .provider-price-row не рендерится)');
    });
});

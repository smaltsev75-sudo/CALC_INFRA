/**
 * Stage 5.A — Sweep линтер для sizing-полировки.
 *
 * Защищает три набора инвариантов:
 *   1. Switch (.switch-track) — 42×22 px, knob 16×16 с offset translateX(20px).
 *      Меняется один раз в Sprint 4 — после этого должен быть стабилен. Регрессия
 *      на этих числах визуально заметна, но в code review легко пропускается.
 *
 *   2. Toggle-row (.qs-toggle-row) — padding var(--space-3) var(--space-4) = 12×16.
 *      Это единый pattern для бинарных toggle'ов (ПДн/AI в Quick Start). Если
 *      кто-то поставит здесь литерал «12px 16px» — теряется консистентность с
 *      design-system токенами; если поставит другой токен — расходится с
 *      остальными toggle-row'ами.
 *
 *   3. Provider price summary — обязан иметь @media (max-width: 720px) override
 *      для адаптации на тачах. Реализация — wrap (white-space: normal), а не
 *      horizontal scroll: для top-5 чтения столбиком удобнее, чем горизонтальная
 *      прокрутка (пользователь читает категорически слева-направо, не любит
 *      сканирование скрытых ячеек).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, ruleBody, extractAtMediaBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Stage 5.A / Switch sizing 42×22 (regression linter)', () => {
    it('components.css: .switch-track имеет width 42px и height 22px', () => {
        const css = read('css/components.css');
        const body = ruleBody(css, '.switch-track');
        assert.match(body, /width:\s*42px\b/,
            '.switch-track width должен быть 42px (Stage 5.A инвариант)');
        assert.match(body, /height:\s*22px\b/,
            '.switch-track height должен быть 22px (Stage 5.A инвариант)');
    });

    it('components.css: knob (.switch-track::after) имеет 16×16 px', () => {
        const css = read('css/components.css');
        const body = ruleBody(css, '.switch-track::after');
        assert.match(body, /width:\s*16px\b/,
            'knob switch должен быть 16px шириной');
        assert.match(body, /height:\s*16px\b/,
            'knob switch должен быть 16px высотой');
    });

    it('components.css: knob translation = 20px при checked (42 - 16 - 2*2 = 20)', () => {
        const css = read('css/components.css');
        const stripped = stripCssComments(css);
        // .switch input:checked + .switch-track::after { transform: translateX(20px); ... }
        const re = /\.switch\s+input:checked\s*\+\s*\.switch-track::after\s*\{([^}]+)\}/;
        const m = stripped.match(re);
        assert.ok(m, 'правило для активного knob должно существовать');
        assert.match(m[1], /translateX\(20px\)/,
            'knob при checked должен сдвигаться на 20px (= 42 - 16 - 2*2 padding 2px с каждой стороны)');
    });
});

describe('Stage 5.A / Toggle-row padding 12×16 (regression linter)', () => {
    it('modals.css: .qs-toggle-row имеет padding var(--space-3) var(--space-4)', () => {
        const css = read('css/modals.css');
        const body = ruleBody(css, '.qs-toggle-row');
        assert.match(body, /padding:\s*var\(--space-3\)\s+var\(--space-4\)/,
            '.qs-toggle-row padding должен быть var(--space-3) var(--space-4) — токены, не литералы');
    });

    it('base.css: --space-3 = 12px и --space-4 = 16px (источник правды)', () => {
        const css = read('css/base.css');
        const stripped = stripCssComments(css);
        assert.match(stripped, /--space-3:\s*12px\b/,
            '--space-3 должен быть 12px (toggle-row vertical padding)');
        assert.match(stripped, /--space-4:\s*16px\b/,
            '--space-4 должен быть 16px (toggle-row horizontal padding)');
    });
});

describe('Stage 5.A / Provider price summary responsive ≤720px', () => {
    /* Linter: для overlay на узких экранах должен быть @media (max-width: 720px)
       блок с переопределением .provider-price-summary, .provider-price-summary-header
       и .provider-price-summary-line. Реализация wrap (white-space: normal) —
       deliberate Stage 4.6 decision: для top-5 чтения столбиком удобнее, чем
       горизонтальный scroll.

       В forms.css несколько @media (max-width: 720px) блоков (questionnaire grid,
       settings grid, provider summary). extractAtMediaBody возвращает первый —
       поэтому ищем КОНКРЕТНЫЙ блок, содержащий .provider-price-summary,
       через ручную балансировку фигурных скобок. */

    function extractProviderMediaBlock(css) {
        const stripped = stripCssComments(css);
        const re = /@media\s*\(max-width:\s*720px\)\s*\{/g;
        let match;
        while ((match = re.exec(stripped)) !== null) {
            let i = match.index + match[0].length;
            let depth = 1;
            const start = i;
            while (i < stripped.length && depth > 0) {
                const ch = stripped[i];
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
                if (depth === 0) {
                    const body = stripped.slice(start, i);
                    if (/\.provider-price-summary/.test(body)) return body;
                    break;
                }
                i++;
            }
        }
        return null;
    }

    it('forms.css: блок @media (max-width: 720px) с правилами для provider-price-summary существует', () => {
        const block = extractProviderMediaBlock(read('css/forms.css'));
        assert.ok(block,
            'forms.css должен содержать @media (max-width: 720px) с правилами для .provider-price-summary');
    });

    it('forms.css: на ≤720px .provider-price-summary-line использует white-space: normal (wrap, не nowrap)', () => {
        const block = extractProviderMediaBlock(read('css/forms.css'));
        assert.ok(block);
        const lineRule = block.match(/\.provider-price-summary-line\s*\{([^}]+)\}/);
        assert.ok(lineRule, '.provider-price-summary-line должен переопределяться внутри @media ≤720px');
        assert.match(lineRule[1], /white-space:\s*normal\b/,
            'на ≤720px line должен иметь white-space: normal — wrap > horizontal scroll для top-5');
    });

    it('forms.css: на ≤720px .provider-price-summary-body схлопывается в 1fr (одна колонка)', () => {
        const block = extractProviderMediaBlock(read('css/forms.css'));
        assert.ok(block);
        const bodyRule = block.match(/\.provider-price-summary-body\s*\{([^}]+)\}/);
        assert.ok(bodyRule, '.provider-price-summary-body должен переопределяться внутри @media ≤720px');
        assert.match(bodyRule[1], /grid-template-columns:\s*1fr\b/,
            'на ≤720px body должен схлопываться в одну колонку — категории друг под другом');
    });
});

describe('Stage 5.A / Provider price summary остаётся top-5 в header', () => {
    /* Защита от регрессии Stage 4.6 — header показывает 5 категорий
       (vCPU/RAM/SSD/HDD/Объектное хранилище). Если кто-то откатит до top-3 —
       линтер ловит. */
    it('providerPriceSummary.js: PROVIDER_PRICE_SUMMARY_PICKS содержит ровно 5 категорий', () => {
        const src = read('js/ui/providerPriceSummary.js');
        const arrMatch = src.match(/const\s+PROVIDER_PRICE_SUMMARY_PICKS\s*=\s*\[([\s\S]*?)\];/);
        assert.ok(arrMatch, 'PROVIDER_PRICE_SUMMARY_PICKS должен быть массивом');
        const items = arrMatch[1].match(/\{\s*id:/g) || [];
        assert.equal(items.length, 5,
            `PROVIDER_PRICE_SUMMARY_PICKS должен содержать 5 категорий (Stage 4.6), сейчас ${items.length}`);
    });

    it('providerPriceSummary.js: 5 категорий покрывают vCPU / RAM / SSD / HDD / Объектное хранилище', () => {
        const src = read('js/ui/providerPriceSummary.js');
        const arrMatch = src.match(/const\s+PROVIDER_PRICE_SUMMARY_PICKS\s*=\s*\[([\s\S]*?)\];/);
        const arr = arrMatch[1];
        assert.match(arr, /id:\s*'cpu-vcpu-shared'/, 'Должна быть категория vCPU');
        assert.match(arr, /id:\s*'ram-gb'/, 'Должна быть категория RAM');
        assert.match(arr, /id:\s*'storage-ssd-tb'/, 'Должна быть категория SSD');
        assert.match(arr, /id:\s*'storage-hdd-tb'/, 'Должна быть категория HDD');
        assert.match(arr, /id:\s*'storage-object-tb'/, 'Должна быть категория Объектное хранилище');
        assert.match(arr, /label:\s*'Объектное хранилище'/,
            'Label для storage-object-tb должен быть на русском (Stage 4.6 fix — было «Object»)');
    });
});

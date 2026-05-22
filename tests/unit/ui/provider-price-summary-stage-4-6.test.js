/**
 * Sprint 4 Stage 4.6 — Overlay & Price UX enhancements.
 *
 * Source-grep тесты на:
 *   1. PROVIDER_PRICE_SUMMARY_PICKS расширен с 3 до 5 позиций
 *      (vCPU shared / RAM / SSD / HDD / Object storage).
 *   2. Tooltip price-summary-header содержит scope-warning
 *      «применяется ко всему расчёту».
 *   3. field-description provider'а упоминает что тарифы calc-wide,
 *      не зависят от сценария.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_PATH = path.resolve(__dirname, '../../../js/ui/providerPriceSummary.js');
const QUEST_PATH = path.resolve(__dirname, '../../../js/ui/questionnaireProviderSettings.js');
/* После Stage 10.2 источник расщеплён: PICKS / CATEGORIES /
   renderProviderPriceSummary / renderProviderUpdateRow живут в
   providerPriceSummary.js, а renderProviderField живёт в questionnaireProviderSettings.js. */
const QUEST_SRC = fs.readFileSync(PROVIDER_PATH, 'utf8');
const QUEST_FORM_SRC = fs.readFileSync(QUEST_PATH, 'utf8');

describe('Stage 4.6 / Increment 1: PROVIDER_PRICE_SUMMARY_PICKS top-5', () => {
    it('содержит блок объявления PROVIDER_PRICE_SUMMARY_PICKS', () => {
        assert.match(QUEST_SRC, /const\s+PROVIDER_PRICE_SUMMARY_PICKS\s*=\s*\[/,
            'PROVIDER_PRICE_SUMMARY_PICKS должен быть объявлен в providerPriceSummary.js');
    });

    it('включает все 5 ожидаемых ЭК для header inline-сводки', () => {
        const block = extractPicksBlock(QUEST_SRC);
        assert.ok(block.includes("'cpu-vcpu-shared'"), 'vCPU shared должен быть в picks');
        assert.ok(block.includes("'ram-gb'"), 'RAM должен быть в picks');
        assert.ok(block.includes("'storage-ssd-tb'"), 'SSD должен быть в picks');
        assert.ok(block.includes("'storage-hdd-tb'"), 'HDD должен быть в picks (Stage 4.6)');
        assert.ok(block.includes("'storage-object-tb'"), 'Object storage должен быть в picks (Stage 4.6)');
    });

    it('PROVIDER_PRICE_SUMMARY_PICKS содержит ровно 5 объектов', () => {
        const block = extractPicksBlock(QUEST_SRC);
        const matches = block.match(/\{\s*id:/g) || [];
        assert.equal(matches.length, 5,
            `Stage 4.6: ожидаем 5 picks (vCPU/RAM/SSD/HDD/Объектное хранилище), нашли ${matches.length}`);
    });

    it('label для storage-object-tb написан на русском (не «Object»)', () => {
        // Anti-regression: «Object» в русском UI = жаргон, не индустриальная
        // аббревиатура. SSD/HDD/RAM/vCPU узнаваемы без расшифровки, Object
        // — нет. Должен быть бизнес-русский «Объектное хранилище» (как в
        // expanded-body PROVIDER_PRICE_CATEGORIES).
        const block = extractPicksBlock(QUEST_SRC);
        const objectEntry = block.match(/storage-object-tb[^}]+\}/);
        assert.ok(objectEntry, 'запись storage-object-tb должна существовать в picks');
        const entryText = objectEntry[0];
        assert.ok(/[А-Яа-я]/.test(entryText),
            `label для storage-object-tb должен содержать кириллицу (бизнес-русский), получено: ${entryText}`);
        assert.ok(!/label:\s*['"]Object['"]/i.test(entryText),
            'label не должен быть «Object» — нечитаемо для русского пользователя');
    });
});

describe('Stage 4.6 / Increment 2: scope-warning tooltip', () => {
    it('renderProviderPriceSummary содержит «не зависят от сценария»', () => {
        // Tooltip на header'е accordion: пользователь должен видеть что тарифы
        // calc-wide перед открытием дропдауна или сводки.
        const body = extractFunctionBody(QUEST_SRC, 'renderProviderPriceSummary');
        assert.ok(body.length > 0, 'renderProviderPriceSummary должен существовать');
        assert.ok(/не\s+зависят\s+от\s+сценария/i.test(body),
            'header price-summary должен иметь tooltip с предупреждением про calc-wide scope');
    });

    it('renderProviderPriceSummary содержит «применяются ко всему расчёту»', () => {
        const body = extractFunctionBody(QUEST_SRC, 'renderProviderPriceSummary');
        assert.ok(/применяются\s+ко\s+всему\s+расчёту/i.test(body),
            'header price-summary должен явно говорить «применяются ко всему расчёту»');
    });

    it('header price-summary использует расширенный title (не короткий)', () => {
        // Защита от регрессии: если кто-то вернёт title к одному предложению,
        // scope-warning потеряется. Проверяем, что title price-summary header
        // привязан к переменной (а не литералу) — это то, что мы ввели Stage 4.6.
        const body = extractFunctionBody(QUEST_SRC, 'renderProviderPriceSummary');
        assert.ok(/headerTitle/.test(body),
            'price-summary-header должен использовать переменную headerTitle с многострочным сообщением');
    });
});

describe('Stage 4.6 / Increment 3: field-description со scope-hint', () => {
    it('tooltip provider-field упоминает calc-wide / все сценарии', () => {
        // tooltip — строка, передаваемая в title= и field-description у provider.
        // Stage 4.6 расширяет её одним предложением про calc-wide применение.
        const renderProviderField = extractFunctionBody(QUEST_FORM_SRC, 'renderProviderField');
        assert.ok(/(?:ко всему расчёту|на весь расчёт|все сценарии|всех сценариев)/i.test(renderProviderField),
            'renderProviderField должен иметь упоминание calc-wide scope в field-description');
    });
});

/* helpers ---------------------------------------------------- */

function extractPicksBlock(src) {
    const start = src.indexOf('const PROVIDER_PRICE_SUMMARY_PICKS');
    if (start === -1) return '';
    const end = src.indexOf('];', start);
    return src.slice(start, end + 2);
}

function extractFunctionBody(src, name) {
    const re = new RegExp(`function\\s+${name}\\s*\\(`);
    const match = re.exec(src);
    if (!match) return '';
    let i = src.indexOf('{', match.index);
    if (i === -1) return '';
    let depth = 1;
    let j = i + 1;
    while (j < src.length && depth > 0) {
        const ch = src[j];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        j++;
    }
    return src.slice(i, j);
}

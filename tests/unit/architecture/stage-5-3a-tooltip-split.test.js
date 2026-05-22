/**
 * Stage 5.3.A — Tooltip Short/Full spread (Settings + Quick Start).
 *
 * Pilot для масштабного применения паттерна на seed-вопросы (Stage 5.3.B/C).
 * Покрывает 14 settings + 9 Quick Start полей, ~20 ключей в UI_TOOLTIPS_SHORT.
 *
 * Инвариант:
 *   • UI_TOOLTIPS_SHORT.<key> существует для каждого targeted поля
 *   • tooltipShort ≤ 100 символов (видимый под полем — не должен переполнять)
 *   • render-функции (renderPercentField, renderSelectField, renderGeoChipsField,
 *     renderToggleRow) принимают/выводят shortHint в `field-description`
 *   • Inline-fields (phaseDurationMonths, planningHorizonYears, vatEnabled)
 *     имеют видимую field-description с конкретным текстом из UI_TOOLTIPS_SHORT
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';
import { UI_TOOLTIPS_SHORT } from '../../../js/utils/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SETTINGS_KEYS = [
    'phaseDurationMonths', 'planningHorizonYears', 'applyRiskFactors',
    'bufferTask', 'bufferProject', 'kInflation', 'kContingency',
    'kSeasonal', 'kScheduleShift', 'vatEnabled', 'vatRate',
    'provider', 'standSizeRatio', 'aiStandFactor'
];

const QS_KEYS = [
    'qs.name', 'qs.product_type', 'qs.industry', 'qs.scale',
    'qs.geography', 'qs.provider', 'qs.pdn', 'qs.activity', 'qs.ai_used'
];

describe('Stage 5.3.A / UI_TOOLTIPS_SHORT — наполнение каталога', () => {
    it('UI_TOOLTIPS_SHORT экспортируется из constants.js и Object.frozen', () => {
        assert.ok(UI_TOOLTIPS_SHORT, 'UI_TOOLTIPS_SHORT должен быть экспортирован');
        assert.equal(typeof UI_TOOLTIPS_SHORT, 'object');
        assert.ok(Object.isFrozen(UI_TOOLTIPS_SHORT),
            'UI_TOOLTIPS_SHORT должен быть Object.freeze (immutable конфигурация)');
    });

    it('UI_TOOLTIPS_SHORT покрывает все 14 settings-ключей', () => {
        for (const key of SETTINGS_KEYS) {
            assert.ok(UI_TOOLTIPS_SHORT[key],
                `UI_TOOLTIPS_SHORT.${key} должен быть задан`);
            assert.equal(typeof UI_TOOLTIPS_SHORT[key], 'string');
            assert.ok(UI_TOOLTIPS_SHORT[key].length > 0);
        }
    });

    it('UI_TOOLTIPS_SHORT покрывает все 9 Quick Start-ключей', () => {
        for (const key of QS_KEYS) {
            assert.ok(UI_TOOLTIPS_SHORT[key],
                `UI_TOOLTIPS_SHORT[${key}] должен быть задан`);
        }
    });

    it('каждый tooltipShort ≤ 120 символов (видимый текст под полем)', () => {
        // 100 — целевой максимум, 120 — мягкая граница (для бизнес-русского
        // с длинными словами «персональные данные» / «риск-коэффициенты»).
        const all = [...SETTINGS_KEYS, ...QS_KEYS];
        for (const key of all) {
            const text = UI_TOOLTIPS_SHORT[key];
            assert.ok(text.length <= 120,
                `UI_TOOLTIPS_SHORT[${key}] длиной ${text.length}: «${text}» — должен быть ≤120 символов`);
        }
    });

    it('каждый tooltipShort заканчивается точкой (бизнес-русский, пунктуация)', () => {
        const all = [...SETTINGS_KEYS, ...QS_KEYS];
        for (const key of all) {
            const text = UI_TOOLTIPS_SHORT[key];
            assert.match(text, /[.!?…]$/,
                `UI_TOOLTIPS_SHORT[${key}] должен заканчиваться знаком препинания: «${text}»`);
        }
    });
});

describe('Stage 5.3.A / questionnairePercentField.js — renderPercentField получает shortHint', () => {
    const src = stripJsComments(read('js/ui/questionnairePercentField.js'));

    it('импортирует UI_TOOLTIPS_SHORT из constants', () => {
        assert.match(src, /import\s*\{[^}]*UI_TOOLTIPS_SHORT[^}]*\}\s*from\s*['"]\.\.\/utils\/constants\.js['"]/,
            'questionnairePercentField.js должен импортировать UI_TOOLTIPS_SHORT');
    });

    it('renderPercentField принимает shortHint параметром', () => {
        assert.match(src, /function\s+renderPercentField\s*\([^)]*shortHint/,
            'renderPercentField должен иметь параметр shortHint в сигнатуре');
    });

    it('renderPercentField резолвит shortHint из UI_TOOLTIPS_SHORT по setting-key', () => {
        assert.match(src, /resolvedShort\s*=\s*shortHint\s*\?\?\s*\(.*UI_TOOLTIPS_SHORT/,
            'renderPercentField должен фолбэчить shortHint на UI_TOOLTIPS_SHORT[settingKey]');
    });

    it('renderPercentField рендерит <span class="field-description"> при resolvedShort', () => {
        // Ищем фрагмент `resolvedShort && el('span', { class: 'field-description'`
        assert.match(src, /resolvedShort\s*&&\s*el\(\s*['"]span['"][^)]*field-description/,
            'renderPercentField должен conditionally рендерить field-description');
    });
});

describe('Stage 5.3.A / questionnaireSettings.js — inline settings имеют field-description', () => {
    const src = [
        read('js/ui/questionnaireSettings.js'),
        read('js/ui/questionnaireVatSettings.js')
    ].join('\n');

    it('phaseDurationMonths field содержит UI_TOOLTIPS_SHORT.phaseDurationMonths', () => {
        // Берём ~600 символов вокруг 'phaseDurationMonths' — должен быть рядом field-description
        const idx = src.indexOf("text: 'Длительность этапа проекта");
        assert.ok(idx > 0, 'rendering phaseDurationMonths должен существовать');
        const window = src.slice(idx, idx + 1500);
        assert.match(window, /field-description['"]?\s*,\s*text:\s*UI_TOOLTIPS_SHORT\.phaseDurationMonths/,
            'phaseDurationMonths должен иметь field-description с UI_TOOLTIPS_SHORT.phaseDurationMonths');
    });

    it('planningHorizonYears field содержит UI_TOOLTIPS_SHORT.planningHorizonYears', () => {
        const idx = src.indexOf("text: 'Горизонт планирования");
        assert.ok(idx > 0);
        const window = src.slice(idx, idx + 2500);
        assert.match(window, /field-description['"]?\s*,\s*text:\s*UI_TOOLTIPS_SHORT\.planningHorizonYears/,
            'planningHorizonYears должен иметь field-description с UI_TOOLTIPS_SHORT.planningHorizonYears');
    });

    it('vatEnabled field содержит UI_TOOLTIPS_SHORT.vatEnabled', () => {
        const idx = src.indexOf("text: 'Учитывать НДС'");
        assert.ok(idx > 0);
        const window = src.slice(idx, idx + 2500);
        assert.match(window, /field-description['"]?\s*,\s*text:\s*UI_TOOLTIPS_SHORT\.vatEnabled/,
            'vatEnabled должен иметь field-description с UI_TOOLTIPS_SHORT.vatEnabled');
    });
});

describe('Stage 5.3.A / quickStartModal.js — render-функции принимают infoShort', () => {
    const src = stripJsComments(read('js/ui/modals/quickStartModal.js'));

    it('импортирует UI_TOOLTIPS_SHORT', () => {
        assert.match(src, /import\s*\{\s*UI_TOOLTIPS_SHORT\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/constants\.js['"]/);
    });

    it('renderSelectField имеет параметр infoShort и рендерит field-description', () => {
        assert.match(src, /function\s+renderSelectField\(\s*\{[^}]*infoShort[^}]*\}\s*\)/,
            'renderSelectField должен принимать infoShort');
        // Внутри тела: infoShort ? el('span', { class: 'field-description'
        const fnStart = src.indexOf('function renderSelectField');
        const fnBody = src.slice(fnStart, fnStart + 1200);
        assert.match(fnBody, /infoShort\s*\?\s*el\(\s*['"]span['"][^)]*field-description/,
            'renderSelectField conditional render field-description с infoShort');
    });

    it('renderGeoChipsField имеет параметр infoShort и рендерит field-description', () => {
        assert.match(src, /function\s+renderGeoChipsField\(\s*\{[^}]*infoShort[^}]*\}\s*\)/);
        const fnStart = src.indexOf('function renderGeoChipsField');
        const fnBody = src.slice(fnStart, fnStart + 1500);
        assert.match(fnBody, /infoShort\s*\?\s*el\(\s*['"]span['"][^)]*field-description/);
    });

    it('renderToggleRow имеет параметр infoShort и оборачивает в qs-toggle-cell', () => {
        assert.match(src, /function\s+renderToggleRow\(\s*\{[^}]*infoShort[^}]*\}\s*\)/);
        const fnStart = src.indexOf('function renderToggleRow');
        const fnBody = src.slice(fnStart, fnStart + 2500);
        assert.match(fnBody, /qs-toggle-cell/,
            'renderToggleRow должен оборачивать в .qs-toggle-cell при infoShort');
        assert.match(fnBody, /field-description['"]?\s*,\s*text:\s*infoShort/,
            'renderToggleRow должен рендерить field-description с infoShort');
    });

    it('все 4 renderSelectField call-site передают UI_TOOLTIPS_SHORT[qs.X]', () => {
        // product_type, industry, scale, activity
        const cases = ['qs.product_type', 'qs.industry', 'qs.scale', 'qs.activity'];
        for (const key of cases) {
            const re = new RegExp(`infoShort:\\s*UI_TOOLTIPS_SHORT\\[['"]${key.replace('.', '\\.')}['"]\\]`);
            assert.match(src, re, `renderSelectField должен передавать UI_TOOLTIPS_SHORT['${key}']`);
        }
    });

    it('renderGeoChipsField call-site передаёт UI_TOOLTIPS_SHORT[qs.geography]', () => {
        assert.match(src,
            /renderGeoChipsField\(\s*\{[^}]*infoShort:\s*UI_TOOLTIPS_SHORT\[['"]qs\.geography['"]\]/,
            'renderGeoChipsField call-site должен передавать UI_TOOLTIPS_SHORT[qs.geography]');
    });

    it('оба renderToggleRow call-sites передают infoShort из UI_TOOLTIPS_SHORT', () => {
        // pdn + ai_used
        for (const key of ['qs.pdn', 'qs.ai_used']) {
            const re = new RegExp(`infoShort:\\s*UI_TOOLTIPS_SHORT\\[['"]${key.replace('.', '\\.')}['"]\\]`);
            assert.match(src, re, `renderToggleRow должен передавать UI_TOOLTIPS_SHORT['${key}']`);
        }
    });
});

describe('Stage 5.3.A / modals.css — .qs-toggle-cell wrapper класс', () => {
    it('modals.css содержит .qs-toggle-cell с flex-direction: column', () => {
        const css = read('css/modals.css');
        // Берём блок .qs-toggle-cell без захвата комментариев (они могут содержать «column»)
        const m = css.match(/\.qs-toggle-cell\s*\{([^}]+)\}/);
        assert.ok(m, '.qs-toggle-cell должен быть определён в modals.css');
        assert.match(m[1], /display:\s*flex/,
            '.qs-toggle-cell должен использовать flex layout');
        assert.match(m[1], /flex-direction:\s*column/,
            '.qs-toggle-cell должен ставить toggle-row + field-description в колонку');
    });
});

/**
 * Stage 5.5.3 — Quick Start preset delta-pill.
 *
 * computePresetDelta(draft) сравнивает draft с пресетом «Стандартный B2B»
 * (PRESETS[0]) и возвращает массив отличий. Используется для рендера
 * delta-pill ряда под preset-grid'ом — пользователь видит, чем его
 * настройка отличается от стандарта.
 *
 * Возвращает null когда:
 *   - draft пуст / null
 *   - draft точно совпадает с одним из пресетов
 *
 * Иначе возвращает { presetLabel, diffs: [...] }.
 *
 * Stage 17.2: empty preset удалён, isEmpty-ветка из computePresetDelta убрана.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, ruleBody } from '../../_helpers/source.js';
import { computePresetDelta } from '../../../js/ui/modals/quickStartModal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* «Стандартный B2B» preset из quickStartModal.js — PRESETS[0]. */
const STANDARD_DRAFT = {
    product_type: 'b2b',
    industry:     'corporate',
    scale:        'm',
    geography:    'ru',
    activity:     'medium',
    pdn:          true,
    ai_used:      false
};

describe('Stage 5.5.3 / computePresetDelta — null cases', () => {
    it('null draft → null', () => {
        assert.equal(computePresetDelta(null), null);
    });

    it('undefined draft → null', () => {
        assert.equal(computePresetDelta(undefined), null);
    });

    it('draft точно совпадает с «Стандартный» → null', () => {
        assert.equal(computePresetDelta({ ...STANDARD_DRAFT }), null);
    });
});

describe('Stage 5.5.3 / computePresetDelta — реальные различия', () => {
    it('одно отличие (AI вкл) → diffs.length=1, presetLabel выставлен', () => {
        const result = computePresetDelta({ ...STANDARD_DRAFT, ai_used: true });
        assert.ok(result, 'результат не null');
        assert.equal(result.diffs.length, 1);
        const aiDiff = result.diffs[0];
        assert.equal(aiDiff.key, 'ai_used');
        assert.equal(aiDiff.label, 'AI');
        assert.equal(aiDiff.was, 'Нет');
        assert.equal(aiDiff.now, 'Да');
        assert.ok(typeof result.presetLabel === 'string' && result.presetLabel.length > 0);
    });

    it('два отличия (Размер L + Глобально) → diffs.length=2 в правильном порядке', () => {
        const result = computePresetDelta({
            ...STANDARD_DRAFT,
            scale: 'l',
            geography: 'global'
        });
        assert.ok(result);
        assert.equal(result.diffs.length, 2);
        // Порядок задан DELTA_FIELD_LABELS: type, industry, scale, geo, activity, pdn, ai_used
        assert.equal(result.diffs[0].key, 'scale');
        assert.equal(result.diffs[0].now, 'L');
        assert.equal(result.diffs[1].key, 'geography');
        assert.equal(result.diffs[1].now, 'Глобально');
    });

    it('boolean toggle (pdn выкл) показывает «Да»/«Нет», а не true/false', () => {
        const result = computePresetDelta({ ...STANDARD_DRAFT, pdn: false });
        assert.ok(result);
        const pdnDiff = result.diffs[0];
        assert.equal(pdnDiff.was, 'Да');
        assert.equal(pdnDiff.now, 'Нет');
    });

    it('product_type меняет на B2C → label «B2C», не «b2c»', () => {
        const result = computePresetDelta({ ...STANDARD_DRAFT, product_type: 'b2c' });
        assert.ok(result);
        assert.equal(result.diffs[0].now, 'B2C');
    });

    it('industry на FinTech → label «FinTech»', () => {
        const result = computePresetDelta({ ...STANDARD_DRAFT, industry: 'fintech' });
        assert.ok(result);
        assert.equal(result.diffs[0].now, 'FinTech');
    });
});

describe('Stage 5.5.3 / quickStartModal.js — render integration', () => {
    const src = stripJsComments(read('js/ui/modals/quickStartModal.js'));

    it('renderPresetDelta функция определена и принимает draft', () => {
        assert.match(src, /function\s+renderPresetDelta\s*\(\s*draft\s*\)/,
            'renderPresetDelta должна быть определена');
    });

    it('renderPresetDelta возвращает null когда delta пустая', () => {
        const fnStart = src.indexOf('function renderPresetDelta');
        const fnBody = src.slice(fnStart, fnStart + 1500);
        assert.match(fnBody, /if\s*\(\s*!\s*delta\s*\)\s*return\s+null/,
            'renderPresetDelta должна делать early-return null когда delta=null');
    });

    it('renderPresetDelta использует .qs-preset-delta класс', () => {
        const fnStart = src.indexOf('function renderPresetDelta');
        const fnBody = src.slice(fnStart, fnStart + 1500);
        assert.match(fnBody, /class:\s*['"]qs-preset-delta['"]/,
            'контейнер должен иметь класс qs-preset-delta');
        assert.match(fnBody, /class:\s*['"]qs-preset-delta-label['"]/,
            'label должен иметь класс qs-preset-delta-label');
        assert.match(fnBody, /class:\s*['"]qs-preset-delta-pill['"]/,
            'каждый pill должен иметь класс qs-preset-delta-pill');
    });

    it('renderPresetDelta вставлен в renderQuickStartModal после renderPresetGrid', () => {
        // Ищем последовательность: renderPresetGrid(...) -> renderPresetDelta(draft)
        assert.match(src, /renderPresetGrid\([^)]*\)\s*,\s*[\s\S]{0,400}?renderPresetDelta\(\s*draft\s*\)/,
            'renderPresetDelta должен быть вызван в renderQuickStartModal после renderPresetGrid');
    });

    it('renderPresetDelta скрыт в edit-режиме (Stage 17.2: isEmptyCreate удалён)', () => {
        // !isEdit && renderPresetDelta(draft) — после Stage 17.2 нет isEmptyCreate-ветки
        assert.match(src, /!isEdit\s*&&\s*renderPresetDelta\(\s*draft\s*\)/,
            'renderPresetDelta должен быть отключён только в edit-режиме (после Stage 17.2)');
    });
});

describe('Stage 5.5.3 / modals.css — стили delta-pill', () => {
    it('.qs-preset-delta — flex-row с border-left accent', () => {
        const body = ruleBody(read('css/modals.css'), '.qs-preset-delta');
        assert.match(body, /display:\s*flex/,
            '.qs-preset-delta должен использовать flex layout');
        assert.match(body, /border-left:\s*2px\s+solid\s+var\(--accent\)/,
            '.qs-preset-delta должен иметь accent border-left как маркер «отличие»');
    });

    it('.qs-preset-delta-pill — pill-форма с cursor:help (для tooltip)', () => {
        const body = ruleBody(read('css/modals.css'), '.qs-preset-delta-pill');
        assert.match(body, /border-radius:\s*999px/,
            'pill должен быть полностью округлым (border-radius 999px)');
        assert.match(body, /cursor:\s*help/,
            'pill должен иметь cursor: help — пользователь должен hover за «было/стало»');
    });
});

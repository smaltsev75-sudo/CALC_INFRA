/**
 * QS Preset preview — после PATCH 2.18.1.
 *
 * Раньше (Stage 6.3.B / PATCH 2.4.24) preview скрывался через opacity:0 +
 * max-height:0 и раскрывался на :hover/:focus-visible, показывая diff
 * `computeChangesForPreset(preset, draft)`. MINOR 2.18.0 сделал preview
 * всегда видимым (фикс мерцания карточек по высоте). После 2.18.0 проявилась
 * вторая проблема: содержимое preview было динамическое (diff против draft),
 * → при кликах по карточкам параметры перепрыгивали с карточки на карточку,
 * а на активной карточке весь блок «Изменится: ...» исчезал.
 *
 * PATCH 2.18.1: preview показывает АБСОЛЮТНЫЕ параметры пресета через
 * `formatPresetParams(preset)` — список одинаков для каждой карточки всегда,
 * не меняется при кликах, не исчезает у активной.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, ruleBody } from '../../_helpers/source.js';
import { formatPresetParams } from '../../../js/ui/modals/quickStartModal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const STANDARD_PRESET = {
    id: 'std_b2b',
    label: 'Стандартный',
    draft: {
        product_type: 'b2b', industry: 'corporate', scale: 'm',
        geography: 'ru', activity: 'medium', pdn: true, ai_used: false
    }
};
const HIGH_AI_PRESET = {
    id: 'high_ai',
    label: 'Высокая нагрузка',
    draft: {
        product_type: 'b2c', industry: 'consumer', scale: 'l',
        geography: 'global', activity: 'high', pdn: false, ai_used: true
    }
};

describe('PATCH 2.18.1 / formatPresetParams — абсолютные параметры пресета', () => {
    it('null preset → []', () => {
        assert.deepEqual(formatPresetParams(null), []);
    });

    it('preset без draft → []', () => {
        assert.deepEqual(formatPresetParams({ id: 'x', label: 'X' }), []);
    });

    it('STANDARD_PRESET → 7 параметров (полный набор)', () => {
        const params = formatPresetParams(STANDARD_PRESET);
        assert.equal(params.length, 7,
            'все 7 полей DELTA_FIELD_LABELS — type/industry/scale/geo/activity/pdn/ai_used');
    });

    it('каждый параметр содержит { key, label, value }', () => {
        const params = formatPresetParams(STANDARD_PRESET);
        for (const p of params) {
            assert.ok(p.key, 'key обязателен');
            assert.ok(p.label, 'label обязателен');
            assert.ok(p.value, 'value обязателен');
            assert.equal(p.was, undefined,
                'абсолютные параметры не имеют «was/now» — это полный snapshot');
        }
    });

    it('result детерминирован — не зависит от внешнего state', () => {
        const a = formatPresetParams(STANDARD_PRESET);
        const b = formatPresetParams(STANDARD_PRESET);
        assert.deepEqual(a, b,
            'функция чистая: одинаковый preset → одинаковый результат всегда');
    });

    it('boolean форматируется как Да/Нет', () => {
        const params = formatPresetParams(STANDARD_PRESET);
        const pdn = params.find(p => p.key === 'pdn');
        assert.equal(pdn.value, 'Да', 'pdn=true → «Да»');
        const ai = params.find(p => p.key === 'ai_used');
        assert.equal(ai.value, 'Нет', 'ai_used=false → «Нет»');
    });

    it('string значения используют короткие labels (B2B, B2C, не полные)', () => {
        const std = formatPresetParams(STANDARD_PRESET);
        const stdType = std.find(p => p.key === 'product_type');
        assert.equal(stdType.value, 'B2B', 'short label «B2B»');

        const hai = formatPresetParams(HIGH_AI_PRESET);
        const haiType = hai.find(p => p.key === 'product_type');
        assert.equal(haiType.value, 'B2C', 'short label «B2C»');
    });

    it('разные пресеты → разные параметры (стабильность не означает дублирование)', () => {
        const std = formatPresetParams(STANDARD_PRESET);
        const hai = formatPresetParams(HIGH_AI_PRESET);
        const stdType = std.find(p => p.key === 'product_type').value;
        const haiType = hai.find(p => p.key === 'product_type').value;
        assert.notEqual(stdType, haiType,
            'STANDARD = B2B, HIGH_AI = B2C — параметры должны отличаться');
    });
});

describe('PATCH 2.18.1 / quickStartModal.js — render integration', () => {
    const src = stripJsComments(read('js/ui/modals/quickStartModal.js'));

    it('renderPresetGrid вычисляет presetParams через formatPresetParams (не от draft)', () => {
        const fnStart = src.indexOf('function renderPresetGrid');
        const fnBody = src.slice(fnStart, fnStart + 2500);
        assert.match(fnBody, /presetParams\s*=\s*formatPresetParams\s*\(\s*p\s*\)/,
            'для каждого preset должны вычисляться presetParams через formatPresetParams(p) — БЕЗ draft');
        assert.doesNotMatch(fnBody, /computeChangesForPreset/,
            'старый diff-against-draft не должен использоваться (он создавал «прыжки»)');
    });

    it('preview span получает класс qs-preset-preview (CSS-структура сохранена)', () => {
        const fnStart = src.indexOf('function renderPresetGrid');
        const fnBody = src.slice(fnStart, fnStart + 2500);
        assert.match(fnBody, /class:\s*['"]qs-preset-preview['"]/);
        assert.match(fnBody, /class:\s*['"]qs-preset-preview-label['"]/);
        assert.match(fnBody, /class:\s*['"]qs-preset-preview-pill['"]/);
    });

    it('label preview-блока — «Параметры: » (не «Изменится: »)', () => {
        const fnStart = src.indexOf('function renderPresetGrid');
        const fnBody = src.slice(fnStart, fnStart + 2500);
        assert.match(fnBody, /text:\s*['"]Параметры:\s/,
            'label сменился с «Изменится» на «Параметры» — это абсолютный snapshot, не diff');
        assert.doesNotMatch(fnBody, /text:\s*['"]Изменится:/,
            'старый label «Изменится» не должен остаться (создаёт ложное обещание динамики)');
    });

    it('preview имеет role="note" + aria-label для a11y', () => {
        const fnStart = src.indexOf('function renderPresetGrid');
        const fnBody = src.slice(fnStart, fnStart + 2500);
        assert.match(fnBody, /role:\s*['"]note['"]/,
            'role=note (не status) — preview не «изменяется», это описание');
        assert.match(fnBody, /'aria-label':\s*`Параметры пресета:/,
            'aria-label описывает содержимое для screen-reader');
    });

    it('preview рендерится conditionally (пустой массив → не рендерим)', () => {
        const fnStart = src.indexOf('function renderPresetGrid');
        const fnBody = src.slice(fnStart, fnStart + 2500);
        assert.match(fnBody, /presetParams\.length\s*>\s*0\s*\?\s*el\(\s*['"]span['"]/,
            'preview должен быть conditionally — при пустом массиве не рендерим');
    });
});

describe('PATCH 2.18.1 / modals.css — стили preview (всегда видны, стабильны)', () => {
    it('.qs-preset-preview виден всегда (без opacity:0 / max-height:0)', () => {
        const body = ruleBody(read('css/modals.css'), '.qs-preset-preview');
        assert.doesNotMatch(body, /opacity:\s*0\b/,
            'opacity: 0 удалено в 2.18.0 — preview всегда виден');
        assert.doesNotMatch(body, /max-height:\s*0\b/,
            'max-height: 0 удалено — нет collapsed-состояния');
        assert.doesNotMatch(body, /pointer-events:\s*none/,
            'pointer-events: none удалено');
    });

    it('правило .qs-preset-card:hover .qs-preset-preview удалено', () => {
        const css = read('css/modals.css');
        const m = css.match(/\.qs-preset-card:hover\s+\.qs-preset-preview/);
        assert.equal(m, null,
            'hover-раскрытие убрано — карточки не меняют высоту при наведении');
    });

    it('.qs-preset-preview-pill использует accent-faint фон', () => {
        const body = ruleBody(read('css/modals.css'), '.qs-preset-preview-pill');
        assert.match(body, /background:\s*var\(--accent-faint\)/);
        assert.match(body, /color:\s*var\(--accent\)/);
        assert.match(body, /border-radius:\s*999px/);
    });

    it('у .qs-preset-preview нет transition (анимировать нечего — состояние одно)', () => {
        const body = ruleBody(read('css/modals.css'), '.qs-preset-preview');
        assert.doesNotMatch(body, /transition\s*:/,
            'transition удалена вместе с hover-разворачиванием');
    });
});

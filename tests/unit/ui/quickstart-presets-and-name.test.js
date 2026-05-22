/**
 * Sprint 4 Stage 4.3: Quick Start Launchpad-редизайн.
 *
 * Тесты:
 *   1. autoName(productType, industry) формирует «{Type} {Ind-short} расчёт»
 *      по утверждённому шаблону.
 *   2. PRESETS содержит 3 пресета с утверждёнными значениями полей.
 *   3. findActivePresetId(draft) возвращает id пресета при точном совпадении
 *      и null при отклонении хотя бы по одному полю.
 *   4. Source-grep: модалка содержит preset-grid, geo-chips, toggle-pair,
 *      flash-marker'ы; section-divider'ы убраны.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoName, findActivePresetId, PRESETS, INDUSTRY_SHORT, formatPresetTooltip }
    from '../../../js/ui/modals/quickStartModal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const modalSource = readFileSync(join(ROOT, 'js', 'ui', 'modals', 'quickStartModal.js'), 'utf8');
const modelSource = readFileSync(join(ROOT, 'js', 'ui', 'modals', 'quickStartModel.js'), 'utf8');
const quickStartSource = `${modalSource}\n${modelSource}`;
const cssSource   = readFileSync(join(ROOT, 'css', 'modals.css'), 'utf8');

describe('autoName: «{Type} {Ind-short} расчёт»', () => {
    it('B2B + corporate → «B2B CRM расчёт»', () => {
        assert.equal(autoName('b2b', 'corporate'), 'B2B CRM расчёт');
    });
    it('B2C + consumer → «B2C Consumer расчёт»', () => {
        assert.equal(autoName('b2c', 'consumer'), 'B2C Consumer расчёт');
    });
    it('Internal + corporate → «Internal CRM расчёт»', () => {
        assert.equal(autoName('internal', 'corporate'), 'Internal CRM расчёт');
    });
    it('B2B + fintech → «B2B FinTech расчёт»', () => {
        assert.equal(autoName('b2b', 'fintech'), 'B2B FinTech расчёт');
    });
    it('B2C + edtech → «B2C EdTech расчёт»', () => {
        assert.equal(autoName('b2c', 'edtech'), 'B2C EdTech расчёт');
    });
    it('Неизвестный type/industry → пустые сегменты сжимаются', () => {
        assert.equal(autoName('xxx', 'corporate'), 'CRM расчёт');
        assert.equal(autoName('b2b', 'xxx'), 'B2B расчёт');
    });
    it('INDUSTRY_SHORT покрывает все 4 индустрии', () => {
        for (const k of ['corporate', 'edtech', 'fintech', 'consumer']) {
            assert.ok(INDUSTRY_SHORT[k], `INDUSTRY_SHORT.${k} должен быть определён`);
        }
    });
});

describe('PRESETS — 3 пресета (Stage 17.2: empty preset removed)', () => {
    it('Ровно 3 пресета (Stage 17.2: «Пустой расчёт» удалён, дублировал «Расчёты → Новый расчёт»)', () => {
        assert.equal(PRESETS.length, 3);
    });

    it('Stage 17.2: empty preset больше не существует', () => {
        const p = PRESETS.find(x => x.id === 'empty');
        assert.equal(p, undefined,
            'preset id=empty удалён в Stage 17.2 — пустой расчёт создаётся ' +
            'через «Расчёты → Новый расчёт», без дубля в Quick Start.');
    });

    it('Стандартный B2B = B2B + Corporate + 100k + medium + RU + ПДн✓ + AI✗', () => {
        const p = PRESETS.find(x => x.id === 'std_b2b');
        assert.ok(p, 'preset id=std_b2b существует');
        // Stage 4.3.3: label очищен от Type-префикса — пресет = shortcut, не дубль.
        assert.equal(p.label, 'Стандартный');
        // Карточка показывает 3 chips: AI / География / ПДн (без Type и Size).
        assert.deepEqual(p.chips, ['Без AI', 'Россия', 'ПДн: да']);
        assert.deepEqual(p.draft, {
            product_type: 'b2b',
            industry:     'corporate',
            scale:        'm',
            geography:    'ru',
            activity:     'medium',
            pdn:          true,
            ai_used:      false
        });
    });

    it('Высокая нагрузка (AI) = B2C + Consumer + 1M + high + Global + ПДн✓ + AI✓', () => {
        const p = PRESETS.find(x => x.id === 'high_ai');
        assert.ok(p, 'preset id=high_ai существует');
        assert.equal(p.label, 'Высокая нагрузка');
        assert.deepEqual(p.chips, ['С AI', 'Глобально', 'ПДн: да']);
        assert.deepEqual(p.draft, {
            product_type: 'b2c',
            industry:     'consumer',
            scale:        'l',
            geography:    'global',
            activity:     'high',
            pdn:          true,
            ai_used:      true
        });
    });

    it('Внутренний инструмент = Internal + Corporate + 10k + low + RU + ПДн✗ + AI✗', () => {
        const p = PRESETS.find(x => x.id === 'internal');
        assert.ok(p, 'preset id=internal существует');
        assert.equal(p.label, 'Внутренний инструмент');
        assert.deepEqual(p.chips, ['Без AI', 'Россия', 'Без ПДн']);
        assert.deepEqual(p.draft, {
            product_type: 'internal',
            industry:     'corporate',
            scale:        's',
            geography:    'ru',
            activity:     'low',
            pdn:          false,
            ai_used:      false
        });
    });

    it('Все пресеты заморожены (Object.freeze)', () => {
        assert.ok(Object.isFrozen(PRESETS), 'PRESETS заморожен');
        for (const p of PRESETS) {
            assert.ok(Object.isFrozen(p), `${p.id} заморожен`);
            assert.ok(Object.isFrozen(p.draft), `${p.id}.draft заморожен`);
            assert.ok(Object.isFrozen(p.chips), `${p.id}.chips заморожен`);
        }
    });

    it('У каждого пресета ровно 3 chips (AI / География / ПДн)', () => {
        for (const p of PRESETS) {
            assert.equal(p.chips.length, 3,
                `${p.id} должен иметь ровно 3 chips: AI, География, ПДн (без Type/Size).`);
        }
    });
});

describe('formatPresetTooltip: 5 параметров без Type/Size (Stage 4.3.3)', () => {
    it('Tooltip начинается с фразы «Этот пресет настраивает:»', () => {
        const t = formatPresetTooltip(PRESETS[0]);
        assert.match(t, /^Этот пресет настраивает:/,
            'Tooltip должен начинаться с явной фразы — пользователь сразу понимает, ' +
            'что hover показывает изменения пресета.');
    });

    it('Tooltip перечисляет 5 параметров (Industry/Activity/Geo/PDn/AI)', () => {
        const t = formatPresetTooltip(PRESETS[0]);
        assert.match(t, /Индустрия:/,   'есть строка «Индустрия»');
        assert.match(t, /Активность:/,  'есть строка «Активность»');
        assert.match(t, /География:/,   'есть строка «География»');
        assert.match(t, /ПДн.*ФЗ-152/,  'есть строка «ПДн (ФЗ-152)»');
        assert.match(t, /AI \/ LLM:/,   'есть строка «AI / LLM»');
    });

    it('Tooltip НЕ содержит Type и Size (они в самой форме как поля)', () => {
        const t = formatPresetTooltip(PRESETS[0]);
        assert.doesNotMatch(t, /(?:^|\n)\s*•?\s*Тип:/,
            'Tooltip не должен дублировать Type-поле формы.');
        assert.doesNotMatch(t, /(?:^|\n)\s*•?\s*Размер:/,
            'Tooltip не должен дублировать «Размер аудитории» поле формы.');
    });

    it('std_b2b tooltip содержит конкретные значения (Corporate / Russia / AI выключен)', () => {
        const t = formatPresetTooltip(PRESETS.find(p => p.id === 'std_b2b'));
        assert.match(t, /Индустрия:\s*Corporate/);
        assert.match(t, /География:\s*Россия/);
        assert.match(t, /AI \/ LLM:\s*выключен/);
        assert.match(t, /ПДн.*да/);
    });

    it('high_ai tooltip: AI включён, География Глобально', () => {
        const t = formatPresetTooltip(PRESETS.find(p => p.id === 'high_ai'));
        assert.match(t, /AI \/ LLM:\s*включён/);
        assert.match(t, /География:\s*Глобально/);
    });

    it('internal tooltip: ПДн нет, AI выключен', () => {
        const t = formatPresetTooltip(PRESETS.find(p => p.id === 'internal'));
        assert.match(t, /ПДн.*нет/);
        assert.match(t, /AI \/ LLM:\s*выключен/);
    });

    it('Tooltip — ровно 6 строк (заголовок + 5 параметров)', () => {
        const t = formatPresetTooltip(PRESETS[0]);
        assert.equal(t.split('\n').length, 6,
            'Заголовок + 5 параметров = 6 строк (без Type/Size — они в форме).');
    });
});

describe('findActivePresetId: точное совпадение draft с пресетом', () => {
    it('draft = std_b2b → возвращает «std_b2b»', () => {
        const std = PRESETS[0].draft;
        assert.equal(findActivePresetId({ ...std, name: 'irrelevant' }), 'std_b2b');
    });

    it('draft = high_ai → возвращает «high_ai»', () => {
        const high = PRESETS[1].draft;
        assert.equal(findActivePresetId({ ...high }), 'high_ai');
    });

    it('Любое отклонённое поле → возвращает null', () => {
        const std = PRESETS[0].draft;
        assert.equal(findActivePresetId({ ...std, scale: 'l' }), null,
            'std_b2b отличается от std в scale → null');
        assert.equal(findActivePresetId({ ...std, pdn: false }), null,
            'std_b2b отличается в pdn → null');
        assert.equal(findActivePresetId({ ...std, ai_used: true }), null,
            'std_b2b отличается в ai_used → null');
    });

    it('Imports null/undefined draft → null', () => {
        assert.equal(findActivePresetId(null), null);
        assert.equal(findActivePresetId(undefined), null);
    });

    it('boolean coercion: pdn=1 совпадает с pdn=true', () => {
        const std = PRESETS[0].draft;
        const draft = { ...std, pdn: 1, ai_used: 0 };
        assert.equal(findActivePresetId(draft), 'std_b2b');
    });
});

describe('Source-grep: новая структура модалки (Stage 4.3)', () => {
    it('renderQuickStartModal вызывает renderPresetGrid в режиме create', () => {
        assert.match(modalSource, /renderPresetGrid/,
            'Модалка должна рендерить preset-grid в create-mode.');
    });

    it('Пресет-карточки — это <button type=button> (semantic)', () => {
        assert.match(modalSource, /el\(['"]button['"]/,
            'Пресет-карточки должны быть <button> для keyboard-доступности.');
        assert.match(modalSource, /qs-preset-card/,
            'Класс .qs-preset-card используется в render.');
    });

    it('renderGeoChipsField заменил select на chip-row', () => {
        assert.match(modalSource, /renderGeoChipsField/,
            'География рендерится через renderGeoChipsField.');
        assert.match(modalSource, /qs-geo-chip/,
            'Класс .qs-geo-chip используется в render.');
    });

    it('Облачный провайдер — активный select с провайдерами из ctx, а не disabled Cloud.ru-only поле', () => {
        assert.match(quickStartSource, /listActiveProvidersForQuickStart/,
            'Quick Start должен брать список активных провайдеров через ctx.');
        assert.match(modalSource, /renderProviderField\(\s*\{[\s\S]*value:\s*draft\.provider/,
            'renderProviderField должен получать текущее значение draft.provider.');
        assert.match(modalSource, /onChange:\s*v\s*=>\s*patch\(\s*\{\s*provider:\s*v\s*\}\s*\)/,
            'смена provider в select должна обновлять draft.provider.');

        const fnStart = modalSource.indexOf('function renderProviderField');
        assert.ok(fnStart >= 0, 'renderProviderField должен существовать.');
        const fnBody = modalSource.slice(fnStart, fnStart + 2500);
        assert.doesNotMatch(fnBody, /disabled\s*:\s*['"]disabled['"]/,
            'Quick Start provider-select не должен быть заблокирован.');
        assert.doesNotMatch(fnBody, /Cloud\.ru[\s\S]{0,200}Yandex Cloud[\s\S]{0,200}VK Cloud/,
            'Список провайдеров не должен быть зашит прямо в UI — source of truth приходит через ctx.');
        assert.match(fnBody, /options\.map/,
            'Provider select должен рендерить options из переданного списка.');
    });

    it('Toggle-pair: ПДн и AI в grid 2-col', () => {
        assert.match(modalSource, /qs-toggle-pair/,
            'Класс .qs-toggle-pair используется для пары PDn+AI.');
    });

    it('Section-divider убран — нет visible <div class="quickstart-section-divider">', () => {
        assert.doesNotMatch(modalSource, /quickstart-section-divider/,
            'Section-divider убран по ТЗ Stage 4.3 — секции разделяются gap+fieldset.');
    });

    it('flash-marker .qs-flash-target ставится на input/chip/toggle', () => {
        assert.match(modalSource, /qs-flash-target/,
            'Поля формы помечены .qs-flash-target — для триггера flash-анимации.');
    });

    it('triggerFlash() — двойной requestAnimationFrame', () => {
        assert.match(modalSource, /requestAnimationFrame[\s\S]*requestAnimationFrame/,
            'triggerFlash должен использовать двойной rAF — гарантия выполнения после rerender\'а.');
    });

    it('autoName + INDUSTRY_SHORT + PRESETS + formatPresetTooltip экспортируются (для тестов)', () => {
        assert.match(modelSource, /export\s+function\s+autoName/,
            'autoName экспортирован из quickStartModel.');
        // Модалка сохраняет прежний публичный контракт через re-export.
        const exportBlock = modalSource.match(/export\s*\{[\s\S]*?\}\s*from\s*['"]\.\/quickStartModel\.js['"]/);
        assert.ok(exportBlock, 'quickStartModal re-export-ит preset/model API');
        assert.match(exportBlock[0], /\bPRESETS\b/);
        assert.match(exportBlock[0], /\bINDUSTRY_SHORT\b/);
        assert.match(exportBlock[0], /\bautoName\b/);
        assert.match(exportBlock[0], /\bformatPresetTooltip\b/,
            'formatPresetTooltip экспортирован для unit-тестов на tooltip.');
    });
});

describe('Source-grep: CSS modals.css содержит новые классы Stage 4.3', () => {
    it('.qs-preset-grid + .qs-preset-card + .qs-preset-card-active определены', () => {
        assert.match(cssSource, /\.qs-preset-grid\s*\{/);
        assert.match(cssSource, /\.qs-preset-card\s*\{/);
        assert.match(cssSource, /\.qs-preset-card-active\s*\{/);
    });

    it('.qs-preset-card-chips + .qs-preset-mini-chip определены (Stage 4.3.3)', () => {
        assert.match(cssSource, /\.qs-preset-card-chips\s*\{/,
            '.qs-preset-card-chips должен быть определён — flex-row для 3 mini-chips на карточке.');
        assert.match(cssSource, /\.qs-preset-mini-chip\s*\{/,
            '.qs-preset-mini-chip должен быть определён — pill-style chip с border + font-xs.');
    });

    it('.qs-geo-chips + .qs-geo-chip + .qs-geo-chip-active определены', () => {
        assert.match(cssSource, /\.qs-geo-chips\s*\{/);
        assert.match(cssSource, /\.qs-geo-chip\s*\{/);
        assert.match(cssSource, /\.qs-geo-chip-active\s*\{/);
    });

    it('.qs-toggle-pair: grid 2-col', () => {
        const m = cssSource.match(/\.qs-toggle-pair\s*\{([^}]+)\}/);
        assert.ok(m, '.qs-toggle-pair определён');
        assert.match(m[1], /grid-template-columns\s*:\s*1fr\s+1fr/,
            'qs-toggle-pair должен быть grid 2-col для PDn+AI.');
    });

    it('@keyframes qsFlash определён', () => {
        assert.match(cssSource, /@keyframes\s+qsFlash\b/,
            'Анимация подсветки полей при apply preset должна быть определена через @keyframes.');
    });

    it('prefers-reduced-motion отключает flash-анимацию', () => {
        assert.match(cssSource, /@media\s*\(prefers-reduced-motion[\s\S]*?\.qs-flash[\s\S]*?animation\s*:\s*none/,
            'WCAG: prefers-reduced-motion должен обнулять flash-анимацию.');
    });

    it('.qs-sr-only: visually-hidden helper', () => {
        const m = cssSource.match(/\.qs-sr-only\s*\{([^}]+)\}/);
        assert.ok(m, '.qs-sr-only должен быть определён');
        assert.match(m[1], /clip\s*:\s*rect\(0,?\s*0,?\s*0,?\s*0\)/,
            '.qs-sr-only должен использовать clip:rect(0,0,0,0) для visually-hidden.');
    });

    it('Старый .quickstart-section-divider удалён (или не используется)', () => {
        // Класс может остаться в CSS как dead-code, главное что модалка
        // его не рендерит (проверено выше). Здесь — только soft-проверка.
        const stillUsesInModal = modalSource.includes('quickstart-section-divider');
        assert.ok(!stillUsesInModal,
            'модалка не должна использовать .quickstart-section-divider после Stage 4.3.');
    });
});

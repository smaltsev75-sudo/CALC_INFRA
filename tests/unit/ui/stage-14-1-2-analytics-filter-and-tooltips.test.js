/**
 * Stage 14.1 + 14.2 (PATCH 2.7.1) — analytics filter UI, persist, delta-pill tooltips.
 *
 * 14.1 — per-category фильтр в providerAnalyticsModal:
 *   • visibleCategories присутствует в state.modals.providerAnalytics.
 *   • Фильтр-pill кнопка `.analytics-cat-toggle` рендерится с aria-pressed.
 *   • Toggle вызывает ctx.patchModal + ctx.setProviderAnalyticsVisibleCategories.
 *   • Persist: ctx.setProviderAnalyticsVisibleCategories пишет через
 *     persist.saveProviderAnalyticsVisibleCategories.
 *   • Restore: ctx.openProviderAnalyticsModal читает persisted через
 *     persist.loadProviderAnalyticsVisibleCategories.
 *
 * 14.2 — унифицированный tooltip delta-pill «Старая X ₽ → Новая Y ₽ (Δ%)»:
 *   • providerAnalyticsModal.
 *   • providerPriceSummary._renderDeltaPill.
 *   • deltaHistoryModal topUp/topDown.
 *   • (Stage 16.6: whatIfPriceSimModal удалён вместе со всем What-if UI.)
 *
 * CSS:
 *   • .analytics-cat-toggle объявлен с padding/border-radius pill-формы.
 *   • prefers-reduced-motion обнуляет transition.
 *
 * STORAGE_KEYS / state:
 *   • PROVIDER_ANALYTICS_VISIBLE_CATEGORIES = 'calc.providerAnalyticsVisibleCategories'.
 *   • state.modals.providerAnalytics.visibleCategories: null дефолт.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, stripCssComments, ruleBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Stage 14.1 / STORAGE_KEYS + state', () => {
    it('PROVIDER_ANALYTICS_VISIBLE_CATEGORIES добавлен в STORAGE_KEYS', () => {
        const constants = stripJsComments(read('js/utils/constants.js'));
        assert.match(constants,
            /PROVIDER_ANALYTICS_VISIBLE_CATEGORIES:\s*['"]calc\.providerAnalyticsVisibleCategories['"]/);
    });

    it('state.modals.providerAnalytics.visibleCategories: null в initialState', () => {
        const store = stripJsComments(read('js/state/store.js'));
        assert.match(store,
            /providerAnalytics:\s*\{[\s\S]{0,300}?visibleCategories:\s*null/,
            'visibleCategories должен быть инициализирован null (дефолт = все категории)');
    });
});

describe('Stage 14.1 / persistence helpers', () => {
    const js = stripJsComments(read('js/state/persistence.js'));

    it('loadProviderAnalyticsVisibleCategories экспортирован', () => {
        assert.match(js,
            /export\s+function\s+loadProviderAnalyticsVisibleCategories\s*\(/);
    });

    it('saveProviderAnalyticsVisibleCategories экспортирован', () => {
        assert.match(js,
            /export\s+function\s+saveProviderAnalyticsVisibleCategories\s*\(/);
    });

    it('load возвращает null при отсутствии или corrupt JSON', () => {
        assert.match(js,
            /loadProviderAnalyticsVisibleCategories[\s\S]{0,300}?if\s*\(\s*v\s*===\s*null\s*\)\s*return\s+null/);
        assert.match(js,
            /loadProviderAnalyticsVisibleCategories[\s\S]{0,400}?if\s*\(\s*!Array\.isArray\(v\)\s*\)\s*return\s+null/);
    });
});

describe('Stage 14.1 / providerAnalyticsModal filter UI', () => {
    const js = stripJsComments(read('js/ui/modals/providerAnalyticsModal.js'));

    it('visibleCategories извлекается из state.modals.providerAnalytics', () => {
        assert.match(js,
            /(const|let)\s+visibleCategories\s*=\s*Array\.isArray\(\s*m\.visibleCategories\s*\)/);
    });

    it('пилюли фильтра рендерятся с классом analytics-cat-toggle', () => {
        assert.match(js, /['"]analytics-cat-toggle['"]/);
    });

    it('toggle вызывает ctx.patchModal + ctx.setProviderAnalyticsVisibleCategories', () => {
        assert.match(js,
            /ctx\.patchModal\s*\(\s*['"]providerAnalytics['"]\s*,\s*\{[^}]*visibleCategories:/);
        assert.match(js,
            /ctx\.setProviderAnalyticsVisibleCategories\s*\(\s*next\s*\)/);
    });

    it('aria-pressed выставляется в зависимости от is-active', () => {
        assert.match(js,
            /'aria-pressed':\s*active\s*\?\s*['"]true['"]\s*:\s*['"]false['"]/);
    });

    it('итог пересчитывается через computeRowTotal по visibleCategories', () => {
        assert.match(js,
            /computeRowTotal[\s\S]{0,300}?for\s*\(\s*const\s+cat\s+of\s+visibleCategories/);
    });

    it('эмпти-сообщение когда все категории скрыты', () => {
        assert.match(js,
            /visibleCategories\.length\s*===\s*0[\s\S]{0,400}?Все категории скрыты/);
    });
});

describe('Stage 14.1 / app.js ctx wiring', () => {
    const actions = stripJsComments(read('js/app/providerActions.js'));

    it('openProviderAnalyticsModal читает persisted visibleCategories', () => {
        assert.match(actions,
            /openProviderAnalyticsModalAction\s*\([^)]*\)\s*\{[\s\S]{0,500}?persist\.loadProviderAnalyticsVisibleCategories\s*\(\s*\)/);
    });

    it('setProviderAnalyticsVisibleCategories ctx-метод проксирует persist', () => {
        assert.match(actions,
            /setProviderAnalyticsVisibleCategoriesAction\s*\([^)]*\)\s*\{[\s\S]{0,300}?persist\.saveProviderAnalyticsVisibleCategories/);
    });
});

describe('Stage 14.2 / унифицированный tooltip delta-pill «Старая X → Новая Y»', () => {
    /* Stage 16.6: список сокращён с 4 до 3 — whatIfPriceSimModal удалена
       вместе со всем What-if UI workflow'ом. Формат delta-pill tooltip'а
       по-прежнему един во всех оставшихся местах рендеринга. */
    const samples = [
        ['js/ui/modals/providerAnalyticsModal.js', 'providerAnalyticsModal'],
        ['js/ui/providerPriceSummary.js',          'providerPriceSummary'],
        ['js/ui/modals/deltaHistoryModal.js',      'deltaHistoryModal']
    ];

    for (const [relPath, label] of samples) {
        it(`${label}: tooltip содержит подстроку 'Старая ... → Новая'`, () => {
            const src = stripJsComments(read(relPath));
            /* Tooltip может задаваться напрямую `title: '...'` либо через
               переменную `titleAttr = \`...\``. Ищем подстроку "Старая ... →
               ... Новая" где-либо в файле в пределах 100 символов. */
            assert.match(src, /Старая[\s\S]{0,80}→[\s\S]{0,40}Новая/,
                `${label} должен использовать единый формат tooltip'а delta-pill`);
        });
    }
});

describe('Stage 14.1 / CSS .analytics-cat-toggle', () => {
    const cssRaw = read('css/forms.css');

    it('правило объявлено с pill-формой (border-radius: 999px)', () => {
        const rule = ruleBody(cssRaw, '.analytics-cat-toggle');
        assert.match(rule, /border-radius:\s*999px/);
        assert.match(rule, /padding:/);
    });

    it('.is-active меняет background', () => {
        const rule = ruleBody(cssRaw, '.analytics-cat-toggle.is-active');
        assert.match(rule, /background:/);
    });

    it('prefers-reduced-motion обнуляет transition', () => {
        const css = stripCssComments(cssRaw);
        assert.match(css,
            /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.analytics-cat-toggle\s*\{\s*transition:\s*none/);
    });
});

describe('Stage 14.2 / Mobile glow regression — paint-only', () => {
    /* Glow-классы (.field-recent / .section-recent / .questionnaire-subgroup-recent)
       должны использовать ТОЛЬКО paint-properties (box-shadow / animation / opacity)
       — не padding/margin/border, иначе на mobile (<720px) layout shift. */
    const cssRaw = read('css/forms.css');

    const glowSelectors = ['.section-recent', '.questionnaire-subgroup-recent'];

    for (const sel of glowSelectors) {
        it(`${sel} использует только animation (paint-only)`, () => {
            const rule = ruleBody(cssRaw, sel);
            /* Никаких box-model изменений в самом правиле — animation
               действует на @keyframes через box-shadow. */
            assert.doesNotMatch(rule, /padding:/);
            assert.doesNotMatch(rule, /margin:/);
            assert.doesNotMatch(rule, /border:\s+/,
                `${sel} не должен менять border (только box-shadow в keyframes)`);
            assert.match(rule, /animation:/,
                `${sel} должен иметь animation (paint-only эффект)`);
        });
    }

    it('@keyframes section-highlight использует только box-shadow', () => {
        const css = stripCssComments(cssRaw);
        const m = css.match(/@keyframes\s+section-highlight\s*\{([^}]*\}[^}]*)\}/);
        if (m) {
            const body = m[1];
            /* Внутри keyframes — box-shadow в нескольких ключевых кадрах. */
            assert.match(body, /box-shadow:/,
                'section-highlight должен использовать box-shadow для glow');
            assert.doesNotMatch(body, /padding:|margin:|width:|height:/,
                'box-model properties в keyframes ломают layout на mobile');
        }
    });

    it('@keyframes subgroup-highlight использует только box-shadow', () => {
        const css = stripCssComments(cssRaw);
        const m = css.match(/@keyframes\s+subgroup-highlight\s*\{([^}]*\}[^}]*)\}/);
        if (m) {
            const body = m[1];
            assert.match(body, /box-shadow:/);
            assert.doesNotMatch(body, /padding:|margin:|width:|height:/);
        }
    });
});

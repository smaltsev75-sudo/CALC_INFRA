/**
 * Stage 10.4 → Stage 17.2: Прайс-бенчмарк модалка (read-only сравнение цен провайдеров).
 *
 * Stage 17.2: bulk-update провайдеров (чекбоксы + «Обновить выбранных») удалён.
 * Тесты bulk-блока (checkbox UI, ctx.bulkUpdateProviderPrices, .analytics-bulk-update-btn,
 * .analytics-row--unchecked) удалены. Прайс-бенчмарк остаётся как read-only сравнение.
 *
 * Source-grep тесты:
 *   1. js/ui/modals/providerAnalyticsModal.js существует, exports
 *      renderProviderAnalyticsModal.
 *   2. Регистрация в MODAL_RENDERERS / MODAL_ORDER в index.js.
 *   3. state.modals.providerAnalytics shape в store.js.
 *   4. ctx.openProviderAnalyticsModal / ctx.aggregateProviderPrices в app.js.
 *   5. controller re-export aggregateProviderPrices из providerAnalytics.js.
 *   6. Кнопка «Сравнить» в renderProviderUpdateRow.
 *   7. CSS .analytics-* + .provider-analytics-btn в forms.css.
 *   8. Иконки table-2 + chevron-up + chevron-down в icons.js.
 *   9. Layer-compliance: домен providerAnalytics.js не импортирует services.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

const MODAL_SRC      = stripJsComments(read('js/ui/modals/providerAnalyticsModal.js'));
const INDEX_SRC      = stripJsComments(read('js/ui/index.js'));
const STORE_SRC      = stripJsComments(read('js/state/store.js'));
const APP_SRC        = stripJsComments(read('js/app.js'));
const CONTROLLER_SRC = stripJsComments(read('js/controllers/providerController.js'));
const PROVIDER_UI    = stripJsComments(read('js/ui/providerUpdateRow.js'));
const DOMAIN_SRC     = stripJsComments(read('js/domain/providerAnalytics.js'));
const ICONS_SRC      = read('js/ui/icons.js');
const FORMS_CSS      = stripCssComments(read('css/forms.css'));
const MODALS_CSS     = stripCssComments(read('css/modals.css'));

describe('Stage 10.4 — providerAnalyticsModal.js файл-модуль', () => {
    it('export renderProviderAnalyticsModal', () => {
        assert.match(MODAL_SRC, /export\s+function\s+renderProviderAnalyticsModal\s*\(/);
    });

    it('использует modalShell', () => {
        assert.match(MODAL_SRC, /modalShell\s*\(/);
    });

    it('return null если m.open=false', () => {
        assert.match(MODAL_SRC, /if\s*\(\s*!m\??\.\s*open\s*\)\s*return\s+null/);
    });

    it('содержит таблицу analytics-table с thead и tbody', () => {
        assert.match(MODAL_SRC, /['"]analytics-table['"]/);
        assert.match(MODAL_SRC, /el\(\s*['"]thead['"]/);
        assert.match(MODAL_SRC, /el\(\s*['"]tbody['"]/);
    });

    it('Stage 17.2: bulk-update удалён — нет ctx.bulkUpdateProviderPrices в модалке', () => {
        assert.doesNotMatch(MODAL_SRC, /bulkUpdateProviderPrices/);
    });

    it('Stage 17.2: checkbox bulk-выборки удалён — нет analytics-th-check / analytics-td-check', () => {
        assert.doesNotMatch(MODAL_SRC, /analytics-th-check|analytics-td-check/);
    });

    it('использует широкий размер modal-analytics для desktop-бенчмарка', () => {
        assert.match(MODAL_SRC, /size:\s*['"]analytics['"]/);
    });

    it('дата актуальности прайса не дублируется в матрице доверия', () => {
        const m = MODAL_SRC.match(/const\s+renderTrustMatrix\s*=[\s\S]+?const\s+thead\s*=/);
        assert.ok(m, 'не нашёл renderTrustMatrix');
        assert.doesNotMatch(m[0], /renderProviderActuality/,
            'в матрице доверия не нужно повторять дату: она остаётся в основной таблице цен');
    });

    it('Stage 17.2: sort работает через ctx.patchModal (категория → sortBy)', () => {
        assert.match(MODAL_SRC, /ctx\.patchModal\s*\(\s*['"]providerAnalytics['"]/);
    });

    it('сортировка через handleSort + ctx.patchModal', () => {
        assert.match(MODAL_SRC, /handleSort\s*=/);
        assert.match(MODAL_SRC, /sortBy:\s*col/);
    });

    it('читает effective-цены через ctx.getEffectivePricesForProvider (UI не лезет в services)', () => {
        assert.match(MODAL_SRC, /ctx\.getEffectivePricesForProvider/);
    });

    it('calc-specific benchmark передаёт Cloud.ru как эталонный прайс для выбора ЭК', () => {
        assert.match(MODAL_SRC, /PROVIDER_BENCHMARK_REFERENCE_PROVIDER/);
        assert.match(MODAL_SRC, /referencePrices:\s*effectiveByProvider\[PROVIDER_BENCHMARK_REFERENCE_PROVIDER\]/);
    });
});

describe('Stage 10.4 — store.modals.providerAnalytics', () => {
    it('shape: open=false, sortBy=total, sortDir=asc', () => {
        assert.match(STORE_SRC,
            /providerAnalytics\s*:\s*\{\s*open:\s*false[\s\S]*?sortBy:\s*['"]total['"][\s\S]*?sortDir:\s*['"]asc['"]/);
    });

    it('Stage 17.2: selectedIds удалён из store.modals.providerAnalytics', () => {
        const m = STORE_SRC.match(/providerAnalytics\s*:\s*\{[^}]+\}/);
        assert.ok(m, 'state.modals.providerAnalytics присутствует');
        assert.doesNotMatch(m[0], /selectedIds/,
            'selectedIds удалён из shape вместе с bulk-UI (Stage 17.2)');
    });
});

describe('Stage 10.4 — модалка в index.js', () => {
    it('импорт renderProviderAnalyticsModal', () => {
        assert.match(INDEX_SRC,
            /import\s*\{\s*renderProviderAnalyticsModal\s*\}\s*from\s*['"]\.\/modals\/providerAnalyticsModal\.js['"]/);
    });

    it('включена в MODAL_ORDER', () => {
        const m = INDEX_SRC.match(/const\s+MODAL_ORDER\s*=\s*\[([^\]]+)\]/);
        assert.ok(m);
        assert.match(m[1], /['"]providerAnalytics['"]/);
    });

    it('включена в MODAL_RENDERERS', () => {
        assert.match(INDEX_SRC,
            /\[\s*['"]providerAnalytics['"]\s*,\s*renderProviderAnalyticsModal\s*\]/);
    });
});

describe('Stage 10.4 — ctx-методы и controller re-exports', () => {
    it('ctx.openProviderAnalyticsModal в app.js', () => {
        assert.match(APP_SRC, /openProviderAnalyticsModal\s*\(\s*\)/);
    });

    it('ctx.aggregateProviderPrices(providerIds, effective, benchmarkItems) в app.js', () => {
        assert.match(APP_SRC,
            /aggregateProviderPrices\s*\(\s*providerIds\s*,\s*effectiveByProvider\s*,\s*benchmarkItems\s*=\s*null\s*\)/);
    });

    it('controller re-export aggregateProviderPrices из providerAnalytics.js', () => {
        assert.match(CONTROLLER_SRC,
            /export\s*\{\s*aggregateProviderPrices\s*\}\s*from\s*['"]\.\.\/domain\/providerAnalytics\.js['"]/);
    });
});

describe('Stage 10.4 — кнопка «Сравнить» в provider-update-row', () => {
    it('analytics-btn рендерится в renderProviderUpdateRow', () => {
        const fn = PROVIDER_UI.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}\s*\n/);
        assert.ok(fn);
        assert.match(fn[0], /provider-analytics-btn/);
    });

    it('кнопка вызывает ctx.openProviderAnalyticsModal()', () => {
        const fn = PROVIDER_UI.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}\s*\n/);
        assert.match(fn[0], /openProviderAnalyticsModal\s*&&\s*ctx\.openProviderAnalyticsModal\s*\(\s*\)/);
    });
});

describe('Stage 10.4 — иконки', () => {
    it('table-2 уже зарегистрирован', () => {
        assert.match(ICONS_SRC, /['"]table-2['"]\s*:/);
    });

    it('chevron-up зарегистрирован (Stage 10.4 add)', () => {
        assert.match(ICONS_SRC, /['"]chevron-up['"]\s*:/);
    });

    it('chevron-down уже зарегистрирован', () => {
        assert.match(ICONS_SRC, /['"]chevron-down['"]\s*:/);
    });
});

describe('Stage 10.4 — CSS .analytics-* + .provider-analytics-btn', () => {
    it('.analytics-table', () => assert.match(FORMS_CSS, /\.analytics-table\s*\{/));
    it('.analytics-th-cat', () => assert.match(FORMS_CSS, /\.analytics-th-cat\b/));
    it('.analytics-td-cat', () => assert.match(FORMS_CSS, /\.analytics-td-cat\b/));
    it('.provider-analytics-btn', () => assert.match(FORMS_CSS, /\.provider-analytics-btn\s*\{/));
    it('.modal-analytics', () => assert.match(MODALS_CSS, /\.modal-analytics\s*\{[^}]*max-width\s*:\s*min\(1540px,\s*calc\(100vw - 32px\)\)/));
    /* Stage 17.2: .analytics-row--unchecked + .analytics-bulk-update-btn — bulk-only классы.
       JS-callsite удалён, CSS будет убран в Phase 4 cleanup. Для текущей фазы только
       проверяем, что bulk не рендерится. */
});

describe('Stage 10.4 — domain/providerAnalytics layer compliance', () => {
    it('НЕ импортирует services/', () => {
        assert.doesNotMatch(DOMAIN_SRC, /from\s+['"][^'"]*\/services\//);
    });

    it('НЕ импортирует controllers/', () => {
        assert.doesNotMatch(DOMAIN_SRC, /from\s+['"][^'"]*\/controllers\//);
    });

    it('НЕ импортирует state/', () => {
        assert.doesNotMatch(DOMAIN_SRC, /from\s+['"][^'"]*\/state\//);
    });

    it('НЕ импортирует ui/', () => {
        assert.doesNotMatch(DOMAIN_SRC, /from\s+['"][^'"]*\/ui\//);
    });
});

describe('Stage 10.4 — providerAnalyticsModal layer compliance', () => {
    it('НЕ импортирует controllers/', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s+['"][^'"]*\/controllers\//);
    });

    it('НЕ импортирует state/', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s+['"][^'"]*\/state\//);
    });
});

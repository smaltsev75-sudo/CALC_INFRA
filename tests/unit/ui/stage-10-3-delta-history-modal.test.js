/**
 * Stage 10.3: DeltaHistoryPanel модалка — UI-источник + интеграция в систему
 * модалок.
 *
 * Source-grep тесты:
 *   1. js/ui/modals/deltaHistoryModal.js существует и экспортирует
 *      renderDeltaHistoryModal.
 *   2. Модалка зарегистрирована в MODAL_RENDERERS и MODAL_ORDER.
 *   3. state.modals.deltaHistory объявлен в store с правильным shape.
 *   4. ctx.openProviderHistoryModal / ctx.restoreProviderOverrideAt /
 *      ctx.getCurrentProviderOverride / ctx.getProviderOverrideHistory
 *      объявлены в app.js.
 *   5. providerPriceSummary.js: кнопка «История» появляется в stale-block.
 *   6. Иконка clock зарегистрирована в icons.js.
 *   7. CSS .delta-history-* классы присутствуют в forms.css.
 *   8. Layer-compliance: deltaHistoryModal.js НЕ импортирует controllers/state.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

const MODAL_SRC   = stripJsComments(read('js/ui/modals/deltaHistoryModal.js'));
const INDEX_SRC   = stripJsComments(read('js/ui/index.js'));
const STORE_SRC   = stripJsComments(read('js/state/store.js'));
const APP_SRC     = stripJsComments(read('js/app.js'));
const ACTIONS_SRC = stripJsComments(read('js/app/providerActions.js'));
const PROVIDER_UI = stripJsComments(read('js/ui/providerUpdateRow.js'));
const ICONS_SRC   = read('js/ui/icons.js');
const FORMS_CSS   = stripCssComments(read('css/forms.css'));

describe('Stage 10.3 — deltaHistoryModal.js файл-модуль', () => {
    it('export renderDeltaHistoryModal', () => {
        assert.match(MODAL_SRC, /export\s+function\s+renderDeltaHistoryModal\s*\(/);
    });

    it('импортирует formatTimeAgo из format.js', () => {
        assert.match(MODAL_SRC,
            /import\s*\{[^}]*formatTimeAgo[^}]*\}\s*from\s*['"]\.\.\/\.\.\/services\/format\.js['"]/);
    });

    it('импортирует computePricesDelta из calcVersioning.js', () => {
        assert.match(MODAL_SRC,
            /import\s*\{[^}]*computePricesDelta[^}]*\}\s*from\s*['"]\.\.\/\.\.\/domain\/calcVersioning\.js['"]/);
    });

    it('использует modalShell из baseModal', () => {
        assert.match(MODAL_SRC, /modalShell\s*\(/);
    });

    it('return null если m.open=false', () => {
        assert.match(MODAL_SRC, /if\s*\(\s*!m\??\.\s*open\s*\)\s*return\s+null/);
    });
});

describe('Stage 10.3 — store.modals.deltaHistory объявлен', () => {
    it('shape содержит open:false и providerId:null (Stage 14.4 добавил expandedIds)', () => {
        /* Stage 14.4 (PATCH 2.7.2) расширил shape: добавлено поле expandedIds.
           Тест ослаблен до проверки наличия двух базовых полей. */
        assert.match(STORE_SRC,
            /deltaHistory\s*:\s*\{[\s\S]{0,200}?open:\s*false[\s\S]{0,200}?providerId:\s*null/);
    });
});

describe('Stage 10.3 — модалка зарегистрирована в index.js', () => {
    it('импортирует renderDeltaHistoryModal', () => {
        assert.match(INDEX_SRC, /import\s*\{\s*renderDeltaHistoryModal\s*\}\s*from\s*['"]\.\/modals\/deltaHistoryModal\.js['"]/);
    });

    it('включает deltaHistory в MODAL_ORDER', () => {
        const m = INDEX_SRC.match(/const\s+MODAL_ORDER\s*=\s*\[([^\]]+)\]/);
        assert.ok(m);
        assert.match(m[1], /['"]deltaHistory['"]/);
    });

    it('включает [\'deltaHistory\', renderDeltaHistoryModal] в MODAL_RENDERERS', () => {
        assert.match(INDEX_SRC,
            /\[\s*['"]deltaHistory['"]\s*,\s*renderDeltaHistoryModal\s*\]/);
    });
});

describe('Stage 10.3 — ctx-методы в app.js', () => {
    it('ctx.openProviderHistoryModal(providerId) объявлен', () => {
        assert.match(APP_SRC, /openProviderHistoryModal\s*\(\s*providerId\s*\)/);
    });

    it('ctx.openProviderHistoryModal вызывает store.openModal(\'deltaHistory\', ...)', () => {
        const m = ACTIONS_SRC.match(/export function openProviderHistoryModalAction[\s\S]*?(?=\nexport function|$)/);
        assert.ok(m);
        assert.match(m[0], /openModal\s*\(\s*['"]deltaHistory['"]/);
    });

    it('ctx.restoreProviderOverrideAt(triggerEvent, providerId, idx) объявлен', () => {
        assert.match(APP_SRC,
            /restoreProviderOverrideAt\s*\(\s*triggerEvent\s*,\s*providerId\s*,\s*idx\s*\)/);
    });

    it('ctx.getCurrentProviderOverride и getProviderOverrideHistory объявлены', () => {
        assert.match(APP_SRC, /getCurrentProviderOverride\s*\(\s*providerId\s*\)/);
        assert.match(APP_SRC, /getProviderOverrideHistory\s*\(\s*providerId\s*\)/);
    });
});

describe('Stage 10.3 — кнопка «История» в provider-update-row', () => {
    it('кнопка provider-history-btn рендерится в renderProviderUpdateRow', () => {
        const fn = PROVIDER_UI.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}\s*\n/);
        assert.ok(fn);
        assert.match(fn[0], /class:\s*\[\s*['"]provider-history-btn['"]/);
    });

    it('кнопка вызывает ctx.openProviderHistoryModal(providerId)', () => {
        const fn = PROVIDER_UI.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}\s*\n/);
        assert.match(fn[0], /openProviderHistoryModal\s*\(\s*providerId\s*\)/);
    });

    it('кнопка показывается когда есть override ИЛИ history', () => {
        const fn = PROVIDER_UI.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}\s*\n/);
        /* showHistoryBtn = !!overrideVersion || historyEntries.length > 0 */
        assert.match(fn[0], /showHistoryBtn/);
        assert.match(fn[0], /getProviderOverrideHistory/);
    });
});

describe('Stage 10.3 — clock иконка в icons.js', () => {
    it('clock зарегистрирован', () => {
        assert.match(ICONS_SRC, /clock\s*:\s*\n?\s*['"]<circle/);
    });
});

describe('Stage 10.3 — CSS .delta-history-* классы', () => {
    it('.delta-history-body объявлен', () => {
        assert.match(FORMS_CSS, /\.delta-history-body\s*\{/);
    });

    it('.delta-history-row + .delta-history-row--current', () => {
        assert.match(FORMS_CSS, /\.delta-history-row\s*\{/);
        assert.match(FORMS_CSS, /\.delta-history-row--current\s*\{/);
    });

    it('.delta-history-row-rollback кнопка', () => {
        assert.match(FORMS_CSS, /\.delta-history-row-rollback\s*\{/);
    });

    it('.provider-history-btn кнопка для триггера', () => {
        assert.match(FORMS_CSS, /\.provider-history-btn\s*\{/);
    });
});

describe('Stage 10.3 — layer compliance', () => {
    it('deltaHistoryModal.js НЕ импортирует controllers/', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s+['"][^'"]*\/controllers\//);
    });

    it('deltaHistoryModal.js НЕ импортирует state/', () => {
        assert.doesNotMatch(MODAL_SRC, /from\s+['"][^'"]*\/state\//);
    });
});

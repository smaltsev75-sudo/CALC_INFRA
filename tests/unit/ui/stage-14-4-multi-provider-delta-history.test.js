/**
 * Stage 14.4 (PATCH 2.7.2) — multi-provider delta history accordion.
 *
 * Расширяет существующий per-provider deltaHistoryModal до accordion-формата:
 * один компонент показывает ВСЕ провайдеры (имеющие current override и/или
 * history) одновременно. Пользователь раскрывает интересующего → видит ту же
 * историю, что и раньше (current + до 3 snapshot'ов + rollback).
 *
 * Контракт:
 *   • state.modals.deltaHistory имеет поле `expandedIds: string[] | null`.
 *     null = «не сохранено» → UI применяет дефолт = [providerId] (preselected).
 *   • STORAGE_KEYS.DELTA_HISTORY_EXPANDED_PROVIDERS добавлен в whitelist.
 *   • persist.loadDeltaHistoryExpandedProviders / saveDeltaHistoryExpandedProviders
 *     экспортированы.
 *   • providerController.getAllProvidersWithHistory() возвращает массив
 *     { id, label, hasCurrentOverride, historyCount } для всех ACTIVE провайдеров,
 *     у которых есть current override или history.length > 0.
 *   • ctx.setDeltaHistoryProviderExpanded(providerId, isExpanded) patches
 *     state.modals.deltaHistory.expandedIds + персистит.
 *   • UI рендерит .delta-history-accordion-row с .delta-history-accordion-toggle
 *     (button) + aria-expanded.
 *
 * Backward-compat: existing openProviderHistoryModal(providerId) кнопка
 * работает как раньше — providerId автоматически добавлен в expandedIds (если
 * expandedIds === null), пользователь видит привычную развёрнутую панель.
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

describe('Stage 14.4 / STORAGE_KEYS', () => {
    it('DELTA_HISTORY_EXPANDED_PROVIDERS добавлен в STORAGE_KEYS', () => {
        const constants = stripJsComments(read('js/utils/constants.js'));
        assert.match(constants,
            /DELTA_HISTORY_EXPANDED_PROVIDERS:\s*['"]calc\.deltaHistoryExpandedProviders['"]/);
    });
});

describe('Stage 14.4 / persistence helpers', () => {
    const js = stripJsComments(read('js/state/persistence.js'));

    it('loadDeltaHistoryExpandedProviders экспортирован', () => {
        assert.match(js,
            /export\s+function\s+loadDeltaHistoryExpandedProviders\s*\(/);
    });

    it('saveDeltaHistoryExpandedProviders экспортирован', () => {
        assert.match(js,
            /export\s+function\s+saveDeltaHistoryExpandedProviders\s*\(/);
    });

    it('load возвращает null при отсутствии или corrupt JSON', () => {
        assert.match(js,
            /loadDeltaHistoryExpandedProviders[\s\S]{0,300}?if\s*\(\s*v\s*===\s*null\s*\)\s*return\s+null/);
        assert.match(js,
            /loadDeltaHistoryExpandedProviders[\s\S]{0,400}?if\s*\(\s*!Array\.isArray\(v\)\s*\)\s*return\s+null/);
    });
});

describe('Stage 14.4 / store schema', () => {
    it('state.modals.deltaHistory.expandedIds: null в initialState', () => {
        const store = stripJsComments(read('js/state/store.js'));
        assert.match(store,
            /deltaHistory:\s*\{[\s\S]{0,300}?expandedIds:\s*null/,
            'expandedIds должен быть инициализирован null (дефолт = только preselected providerId)');
    });
});

describe('Stage 14.4 / providerController.getAllProvidersWithHistory', () => {
    const js = stripJsComments(read('js/controllers/providerController.js'));

    it('экспортирован', () => {
        assert.match(js,
            /export\s+function\s+getAllProvidersWithHistory\s*\(\s*\)/);
    });

    it('использует listProviders для перечисления провайдеров', () => {
        assert.match(js, /listProviders\s*\(/);
    });

    it('фильтрует только провайдеров с current override или непустой history', () => {
        /* В теле должна быть ссылка на historyCount или history.length —
           продолжить итерацию, только если есть current override ИЛИ history. */
        assert.match(js,
            /getAllProvidersWithHistory[\s\S]{0,1500}?(historyCount|history\.length)/);
    });
});

describe('Stage 14.4 / app.js ctx wiring', () => {
    const js = stripJsComments(read('js/app.js'));
    const actions = stripJsComments(read('js/app/providerActions.js'));

    it('ctx.getAllProvidersWithHistory проксирует контроллер', () => {
        assert.match(js,
            /getAllProvidersWithHistory\s*\(\s*\)\s*\{[\s\S]{0,200}?providerCtl\.getAllProvidersWithHistory/);
    });

    it('ctx.setDeltaHistoryProviderExpanded patches state + persist', () => {
        assert.match(actions,
            /setDeltaHistoryProviderExpandedAction\s*\([^)]*\)\s*\{[\s\S]{0,1200}?persist\.saveDeltaHistoryExpandedProviders/);
    });

    it('openProviderHistoryModal восстанавливает persisted expandedIds', () => {
        assert.match(actions,
            /openProviderHistoryModalAction\s*\([^)]*\)\s*\{[\s\S]{0,500}?persist\.loadDeltaHistoryExpandedProviders\s*\(\s*\)/);
    });
});

describe('Stage 14.4 / deltaHistoryModal accordion UI', () => {
    const js = stripJsComments(read('js/ui/modals/deltaHistoryModal.js'));

    it('читает expandedIds из state.modals.deltaHistory', () => {
        assert.match(js,
            /(const|let)\s+expandedIds\s*=[\s\S]{0,200}?m\.expandedIds/);
    });

    it('рендерит accordion-row с классом .delta-history-accordion-row', () => {
        assert.match(js, /['"]delta-history-accordion-row['"]/);
    });

    it('toggle-кнопка имеет класс .delta-history-accordion-toggle', () => {
        assert.match(js, /['"]delta-history-accordion-toggle['"]/);
    });

    it('toggle-кнопка имеет aria-expanded', () => {
        assert.match(js,
            /'aria-expanded':\s*\(?\s*(isExpanded|expanded)/);
    });

    it('toggle вызывает ctx.setDeltaHistoryProviderExpanded', () => {
        assert.match(js,
            /ctx\.setDeltaHistoryProviderExpanded\s*\(/);
    });

    it('итерирует ctx.getAllProvidersWithHistory()', () => {
        assert.match(js,
            /ctx\.getAllProvidersWithHistory\s*\(\s*\)/);
    });

    it('эмпти-сообщение когда нет провайдеров с историей', () => {
        assert.match(js,
            /(нет\s+истори|истори[^.]*пуст|никто\s+не\s+имеет)/i);
    });
});

describe('Stage 14.4 / CSS .delta-history-accordion', () => {
    const cssRaw = read('css/forms.css');

    it('.delta-history-accordion-toggle объявлен', () => {
        const rule = ruleBody(cssRaw, '.delta-history-accordion-toggle');
        assert.ok(rule.length > 0, '.delta-history-accordion-toggle должен быть объявлен');
        assert.match(rule, /cursor:\s*pointer/);
    });

    it('.delta-history-accordion-row объявлен', () => {
        const rule = ruleBody(cssRaw, '.delta-history-accordion-row');
        assert.ok(rule.length > 0, '.delta-history-accordion-row должен быть объявлен');
    });

    it('prefers-reduced-motion обнуляет анимации accordion', () => {
        const css = stripCssComments(cssRaw);
        assert.match(css,
            /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]{0,2000}?\.delta-history-accordion[a-z-]*\s*\{[^}]*(transition|animation):\s*none/);
    });
});

describe('Stage 14.4 / Backward-compat: per-provider entry point работает', () => {
    const js = stripJsComments(read('js/ui/providerUpdateRow.js'));

    it('кнопка .provider-history-btn по-прежнему вызывает openProviderHistoryModal', () => {
        assert.match(js,
            /openProviderHistoryModal\s*\(\s*providerId\s*\)/);
    });
});

describe('Stage 14.4 / Helper: providerId auto-добавляется в expandedIds', () => {
    /* При первом открытии (expandedIds === null) UI применяет дефолт =
       [providerId]. providerId === null означает «глобальный entry point»,
       список раскрытых пуст. Логика — в renderer'е модалки. */
    const js = stripJsComments(read('js/ui/modals/deltaHistoryModal.js'));

    it('default expandedSet вычисляется из providerId если expandedIds=null', () => {
        /* Проверяем что в renderer'е есть fallback:
           expandedIds === null && providerId → [providerId] */
        assert.match(js,
            /expandedIds[\s\S]{0,400}?providerId/);
    });
});

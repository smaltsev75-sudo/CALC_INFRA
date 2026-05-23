/**
 * Главный рендер: собирает state → DOM. Используется requestAnimationFrame
 * для дебаунса (планировщик в app.js вызывает renderApp с уже обновлённым state).
 *
 * При каждом rerender'е сохраняется и восстанавливается фокус активного
 * input/textarea/select по атрибуту data-focus-key (см. ui/focus.js).
 */

import { el, replace } from './dom.js';
import { renderHeader } from './header.js';
import { renderSidebar } from './sidebar.js';
import { renderCalcList } from './calcList.js';
import { renderQuestionnaire } from './questionnaire.js';
import { renderDashboard } from './dashboard.js';
import { renderDetails } from './details.js';
import { renderItemsTab } from './itemsTab.js';
import { renderQuestionsTab } from './questionsTab.js';
import { renderComparison } from './comparison.js';

import { renderMessageModal } from './modals/messageModal.js';
import { renderConfirmModal } from './modals/confirmModal.js';
import { renderInputModal } from './modals/inputModal.js';
import { renderFormulaModal } from './modals/formulaModal.js';
import { renderItemEditModal } from './modals/itemEditModal.js';
import { renderQuestionEditModal } from './modals/questionEditModal.js';
import { renderHelpModal } from './modals/helpModal.js';
import { renderResetModal } from './modals/resetModal.js';
import { renderDuplicateImportModal } from './modals/duplicateImportModal.js';
import { renderAssumptionsModal } from './modals/assumptionsModal.js';
import { renderPrintAnswersOptionsModal } from './modals/printAnswersOptionsModal.js';
import { renderDetailsPrintOptionsModal } from './modals/detailsPrintOptionsModal.js';
import { renderQuickStartModal } from './modals/quickStartModal.js';
import { renderReapplyConfirmModal } from './modals/reapplyConfirmModal.js';
import { renderScenarioMenuModal } from './modals/scenarioMenuModal.js';
import { renderScenarioRenameModal } from './modals/scenarioRenameModal.js';
import { renderScenarioDuplicateModal } from './modals/scenarioDuplicateModal.js';
import { renderDeltaHistoryModal } from './modals/deltaHistoryModal.js';
import { renderProviderAnalyticsModal } from './modals/providerAnalyticsModal.js';
import { renderProviderScenarioComparisonModal } from './modals/providerScenarioComparisonModal.js';
import { renderCalculationHealthModal } from './modals/calculationHealthModal.js';
import { renderAssumptionsRegisterModal } from './modals/assumptionsRegisterModal.js';
import { renderSensitivityAnalysisModal } from './modals/sensitivityAnalysisModal.js';
import { renderBudgetGuardrailsModal } from './modals/budgetGuardrailsModal.js';
import { renderCostOptimizationPlannerModal } from './modals/costOptimizationPlannerModal.js';
import { renderDecisionMemoModal } from './modals/decisionMemoModal.js';
import { renderGuidedCompletionModal } from './modals/guidedCompletionModal.js';
import { renderPriceImportMappingModal } from './modals/priceImportMappingModal.js';
import { renderVatPolicyChoiceModal } from './modals/vatPolicyChoiceModal.js';

import { captureFocus, restoreFocus, focusFirstIn, trapTabIn } from './focus.js';

let _root = null;
let _modalsRoot = null;

let _prevTopModal = null;
let _prevActiveTab = null;
let _untrap = null;
/* 12.U22: множество модалок, которые были открыты в ПРЕДЫДУЩЕМ рендере.
 * Используется, чтобы запускать CSS-анимацию `fadeIn`/`modalIn` ТОЛЬКО для
 * только что открывшихся модалок, а не на каждом re-render'е (patchModal на
 * draft вызывает пересоздание всего modals-root, и без этого фильтра overlay
 * мерцает при любом изменении внутри модалки). */
let _prevOpenModals = new Set();

/**
 * Список модалок в порядке z-приоритета: последняя в списке = самая «верхняя».
 * Используется `topOpenModalName()` для решения, чьему overlay'у отдать focus-trap
 * и первичный фокус, если открыто несколько модалок.
 *
 * ВАЖНО: множество имён здесь обязано совпадать с множеством в MODAL_RENDERERS.
 * Если модалка рендерится, но её нет в MODAL_ORDER, `topOpenModalName()` её не
 * увидит → focus не попадёт внутрь, Tab будет уходить за overlay (нарушение WCAG).
 * Линтер `tests/unit/architecture/modal-order-sync.test.js` ловит расхождение.
 *
 * Порядок здесь смысловой (z-приоритет), а в MODAL_RENDERERS — порядок DOM
 * (для фиксированных оверлеев не критичен). Поэтому два списка содержат
 * одинаковый набор, но не обязаны быть в одинаковом порядке.
 */
const MODAL_ORDER = [
    'message', 'confirm', 'duplicateImport', 'input', 'quickStart',
    'reset', 'help', 'printAnswersOptions', 'detailsPrintOptions',
    'assumptions', 'assumptionsRegister', 'calculationHealth',
    'sensitivity', 'budgetGuardrails', 'decisionMemo',
    'costOptimizationPlanner', 'guidedCompletion',
    'formula', 'itemEdit', 'questionEdit',
    'reapplyConfirm', 'scenarioMenu', 'scenarioRename', 'scenarioDuplicate',
    'deltaHistory', 'providerAnalytics', 'priceImportMapping',
    'scenarioComparison', 'vatPolicyChoice'
];

export function mountUi() {
    _root = document.getElementById('app');
    _modalsRoot = document.getElementById('app-modals');
    if (!_root) throw new Error('Не найден контейнер #app');
    if (!_modalsRoot) {
        _modalsRoot = el('div', { id: 'app-modals' });
        document.body.appendChild(_modalsRoot);
    }
}

export function renderApp(state, ctx) {
    if (!_root) mountUi();

    const focusSnap = captureFocus();
    const topModalBefore = _prevTopModal;
    const topModalAfter  = topOpenModalName(state);

    const tabContent = renderTabContent(state, ctx);
    // fadeIn-анимацию для .tab-pane включаем только при реальной смене вкладки —
    // иначе на каждый setAnswer (boolean-переключатель) вкладка мигает заново.
    if (tabContent && tabContent.classList && state.activeTab !== _prevActiveTab) {
        tabContent.classList.add('tab-pane-fresh');
    }
    _prevActiveTab = state.activeTab;

    const view = el('div', { class: 'app-layout' },
        // Skip-link (WCAG 2.4.1 Bypass Blocks) — даёт keyboard-пользователю
        // мгновенно перепрыгнуть навигацию sidebar и попасть в основной контент.
        el('a', {
            class: 'skip-link',
            attrs: { href: '#main-content' },
            text: 'Перейти к основному контенту'
        }),
        renderSidebar(state, ctx),
        el('div', { class: 'app-main-col' },
            renderHeader(state, ctx),
            el('main', { class: 'app-main', id: 'main-content', attrs: { tabindex: '-1' } }, tabContent)
        )
    );
    replace(_root, view);
    renderModals(state, ctx);

    // Фокус-логика:
    //   1. Если только что открылась модалка — фокус на её первом поле.
    //   2. Если модалка только что закрылась — фокус восстанавливается из снимка.
    //   3. Иначе восстанавливаем фокус по data-focus-key.
    if (topModalAfter && topModalAfter !== topModalBefore) {
        const modalEl = _modalsRoot.lastElementChild;
        focusFirstIn(modalEl);
    } else {
        restoreFocus(focusSnap);
    }

    // Focus trap для модалок: пере-устанавливаем на каждый render.
    if (_untrap) { _untrap(); _untrap = null; }
    if (topModalAfter) {
        _untrap = trapTabIn(_modalsRoot.lastElementChild);
    }

    _prevTopModal = topModalAfter;
}

function topOpenModalName(state) {
    for (let i = MODAL_ORDER.length - 1; i >= 0; i--) {
        const name = MODAL_ORDER[i];
        if (state.modals[name]?.open) return name;
    }
    return null;
}

function renderTabContent(state, ctx) {
    switch (state.activeTab) {
        case 'calculations':  return renderCalcList(state, ctx);
        case 'questionnaire': return renderQuestionnaire(state, ctx);
        case 'dashboard':     return renderDashboard(state, ctx);
        case 'details':       return renderDetails(state, ctx);
        case 'comparison':    return renderComparison(state, ctx);
        case 'items':         return renderItemsTab(state, ctx);
        case 'questions':     return renderQuestionsTab(state, ctx);
        default:              return renderCalcList(state, ctx);
    }
}

/* 12.U22: каждая модалка рендерится через свой helper, который возвращает
 * либо overlay-узел, либо null (если модалка закрыта). Связка [name, render]
 * нужна, чтобы пометить классом `modal-overlay-fresh` ТОЛЬКО только что
 * открывшиеся модалки — для запуска CSS-анимации появления один раз. */
const MODAL_RENDERERS = [
    ['message',         renderMessageModal],
    ['confirm',         renderConfirmModal],
    ['duplicateImport', renderDuplicateImportModal],
    ['input',           renderInputModal],
    ['quickStart',      renderQuickStartModal],
    ['formula',         renderFormulaModal],
    ['itemEdit',        renderItemEditModal],
    ['questionEdit',    renderQuestionEditModal],
    ['help',            renderHelpModal],
    ['reset',           renderResetModal],
    ['assumptions',          renderAssumptionsModal],
    ['assumptionsRegister',  renderAssumptionsRegisterModal],
    ['calculationHealth',    renderCalculationHealthModal],
    ['sensitivity',          renderSensitivityAnalysisModal],
    ['budgetGuardrails',     renderBudgetGuardrailsModal],
    ['decisionMemo',         renderDecisionMemoModal],
    ['costOptimizationPlanner', renderCostOptimizationPlannerModal],
    ['guidedCompletion',     renderGuidedCompletionModal],
    ['priceImportMapping',   renderPriceImportMappingModal],
    ['printAnswersOptions', renderPrintAnswersOptionsModal],
    ['detailsPrintOptions', renderDetailsPrintOptionsModal],
    ['reapplyConfirm',  renderReapplyConfirmModal],
    ['scenarioMenu',    renderScenarioMenuModal],
    ['scenarioRename',  renderScenarioRenameModal],
    ['scenarioDuplicate', renderScenarioDuplicateModal],
    ['deltaHistory',    renderDeltaHistoryModal],
    ['providerAnalytics', renderProviderAnalyticsModal],
    ['scenarioComparison', renderProviderScenarioComparisonModal],
    ['vatPolicyChoice', renderVatPolicyChoiceModal]
];

/**
 * Чистая функция: для каждого имени модалки решает, нужно ли подсветить
 * overlay классом `modal-overlay-fresh` (только что открылась → анимация
 * появления должна сыграть). Уже открытая в прошлом рендере модалка
 * НЕ получает класс — иначе при каждом patchModal на draft анимация
 * перезапускается, и пользователь видит «мерцание».
 *
 * @param {Array<[string, HTMLElement|null]>} renderedList — пары (name, overlay|null)
 * @param {Set<string>} prevOpenSet — имена модалок, открытых в прошлый рендер
 * @returns {Set<string>} имена модалок, которым нужна анимация появления
 */
export function _computeFreshModals(renderedList, prevOpenSet) {
    const fresh = new Set();
    for (const [name, overlay] of renderedList) {
        if (overlay && !prevOpenSet.has(name)) fresh.add(name);
    }
    return fresh;
}

function renderModals(state, ctx) {
    const rendered = MODAL_RENDERERS.map(([name, fn]) => [name, fn(state, ctx)]);
    const fresh = _computeFreshModals(rendered, _prevOpenModals);

    // Обновляем «прошлый» снимок ДО append'а — на случай исключения в DOM-операциях,
    // следующий рендер всё равно увидит правильное состояние.
    const nextOpen = new Set();
    for (const [name, overlay] of rendered) {
        if (overlay) nextOpen.add(name);
    }

    /* Снимок scrollTop у .modal-body каждой модалки, которая остаётся открытой
       между предыдущим и текущим рендером. _modalsRoot целиком пересоздаётся
       ниже через replace(), и без явного восстановления scrollTop сбрасывается
       в 0 — пользователь видит «прыжок наверх» при любой state-мутации
       (toggle accordion, edit lever, change constraint). Имя модалки берём
       из data-modal-name, который ставит modalShell для каждой overlay. */
    const scrollSnapshot = new Map();
    if (_modalsRoot && _prevOpenModals.size > 0) {
        for (const overlay of _modalsRoot.children) {
            const name = overlay?.dataset?.modalName;
            if (!name || !nextOpen.has(name)) continue;
            const body = overlay.querySelector('.modal-body');
            if (body && body.scrollTop > 0) scrollSnapshot.set(name, body.scrollTop);
        }
    }

    _prevOpenModals = nextOpen;

    replace(_modalsRoot, null);
    for (const [name, overlay] of rendered) {
        if (!overlay) continue;
        if (fresh.has(name)) overlay.classList.add('modal-overlay-fresh');
        /* data-modal-name нужен следующему рендеру: scrollTop-снапшот
           идентифицирует overlay по этому ключу. */
        overlay.dataset.modalName = name;
        _modalsRoot.appendChild(overlay);
        /* Восстанавливаем scrollTop после append'а (до этого нет layout =
           setting scrollTop игнорируется). Для свежих модалок снимка нет —
           скролл стартует с 0, что и нужно. */
        const savedTop = scrollSnapshot.get(name);
        if (savedTop != null) {
            const body = overlay.querySelector('.modal-body');
            if (body) body.scrollTop = savedTop;
        }
    }

    if (nextOpen.size > 0) document.body.classList.add('has-modal');
    else document.body.classList.remove('has-modal');
}
